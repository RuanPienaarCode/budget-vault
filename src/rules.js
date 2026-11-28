'use strict';
/* Categorisation rules: learning one from a description, and resolving a
   description against the set.

   Kept apart from the statement parsing it feeds because the rules outlive any
   one import — they are a file in the vault the user can edit, and rule-cleanup
   replays real descriptions through matchRule to decide what is redundant. Both
   readers have to agree exactly, so there is one implementation.

   Pure — no DOM, no obsidian import. */

const { stripControls } = require('./csv');

/* One whitespace-separated token of a description that identifies the
   transaction rather than the merchant: a masked card number, a statement
   reference, a phone or meter number, a caps-and-digits ref code.
   learnPattern trims these off the end so a rule generalises to next month's
   statement. dedupe.js reads the same tokens for the opposite purpose: two
   rows from one merchant that carry different references are two
   transactions. One predicate for both, so they cannot disagree about what a
   reference is. */
function isReferenceToken(w) {
  const digits = (w.match(/\d/g) || []).length;
  return /\*{2,}/.test(w) ||                                 // masked card: 000000******0000
    /\d{4,}/.test(w) ||                                      // long digit run: refs, phone, meter numbers
    (digits > 0 && digits / w.length >= 0.4) ||              // digit-heavy token: X0000000
    (digits > 0 && w.length >= 8 && /^[A-Z0-9]+$/.test(w));  // long caps+digit ref: VODREF0000000
}

/* A foreign-currency card row ends in the price it was charged at:
   "SpotifyZA 79.99 ZAR". The amount is a reference token on its own, but the
   code after it is not, so learnPattern stopped at the code and the learned
   rule only ever matched that one price (2026-11-25 audit, RUL-4).

   The pair is trimmed only when both halves look like what they are. The
   amount must carry decimals, so a model number ("BMW 320 GTI") is not one;
   thousands groups are allowed in either convention. The code must be an ISO
   4217 code, so a merchant that ends in a three-letter word ("PICK N PAY",
   "CAPE GAS") is not eaten. The list is spelled out HERE rather than shared
   with amount.js's UNIT_WORDS: that set is for letters stuck to a number and
   mixes in non-ISO markers ("KR", "RM", "FR"), which would be wrong for a
   merchant-name tail, and this module stays free of imports it does not need.
   Upper case only, because that is how a statement prints a code. */
const ISO_CODES = new Set((
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY ' +
  'COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR ' +
  'IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR ' +
  'MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD ' +
  'SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF ' +
  'XPF YER ZAR ZMW ZWL'
).split(' '));
const PRICE_TAIL = /^(.*\S)[ \t]+\d+(?:[.,]\d{3})*[.,]\d{2}[ \t]+([A-Z]{3})$/;

/* Trim trailing reference noise (masked card numbers, statement refs, phone /
   meter numbers, caps+digit ref codes) from a transaction description so a
   learned categorisation rule generalises to next month's version of the same
   merchant. Internal whitespace is preserved byte-for-byte — rule matching is
   exact/substring against the raw description, so collapsing spaces would
   break it. Falls back to the untrimmed description if trimming would leave
   fewer than 4 characters. */
function learnPattern(desc) {
  /* Capped BEFORE the loop, because the loop is quadratic: each pass re-runs
     the full-string match and removes one token, so cost grows with the square
     of the length — measured 1.7s for a single 200KB description, and import
     calls this once per row with no field-length limit upstream. A statement
     CSV is untrusted input; fifty such cells was a frozen app. No real bank
     prints a 512-char description, and matchRule is substring-based, so a
     pattern learned from a capped description still matches the full one. */
  const capped = (desc ?? '').toString().trim().slice(0, 512);
  let s = capped;
  for (;;) {
    const price = s.match(PRICE_TAIL);
    if (price && ISO_CODES.has(price[2])) { s = price[1]; continue; }
    const m = s.match(/^(.*\S)[ \t]+(\S+)$/);
    if (!m) break;
    if (!isReferenceToken(m[2])) break;
    s = m[1];
  }
  return s.length >= 4 ? s : capped;
}

/* The text a rule is matched on, for a pattern and for the description it is
   matched against alike: trimmed, lower-cased, and without the C0 control
   characters csvCell strips (src/csv.js). Every reader of a rule goes
   through here: prepareRules, matchRule, learnRules' duplicate check,
   governingRule and rule-cleanup.js. A reader that normalised differently
   would see a different rule set from the matcher's.

   The control-character fold is new, and it is the reason this function
   exists. Since the 2026-10-07 audit (L4A-11) csvCell drops those characters
   when it writes the rules file, so a rule learned from a description
   carrying a NUL is saved without the NUL. If the matcher kept the NUL in the
   description, the saved rule would never match the merchant it was learned
   from, and each later import would learn it again. That is the same
   dead-copy growth the formula guard caused before uncsvCell existed.
   Folding the same characters on both sides keeps the saved rule and the
   description equal. */
function ruleText(s) {
  return stripControls(s).trim().toLowerCase();
}

/* Normalise the rule list ONCE per pass, not once per row. Rules grow with the
   history, so lowercasing inside the match loop was rows × rules: measured
   51ms at 1,200 rows and 2,000 rules on desktop, several hundred on a phone. */
function prepareRules(rules) {
  return (rules || [])
    .map(r => {
      const p = ruleText(r.pattern);
      const alt = withoutCountrySuffix(p);
      const out = alt ? { p, alt, category: r.category } : { p, category: r.category };
      /* ADR-0010 section 5. Carried only when the rule has one, so a rule
         without a subcategory is prepared exactly as it always was and nothing
         that compares or prints a prepared rule can tell the difference. */
      const sub = ruleSubcategory(r);
      if (sub) out.subcategory = sub;
      return out;
    })
    .filter(r => r.p);
}

/* The label a rule sets with its category, '' for none. Trimmed, and a cell of
   spaces is none: the same reading subcategories.js subcategoryOf gives a row,
   because a rule's label ends up on a row. */
function ruleSubcategory(r) {
  return r && typeof r.subcategory === 'string' ? r.subcategory.trim() : '';
}

/* What a rule answers, as one comparable value: its category and subcategory.
   Two rules "give the same answer" only when both agree, which is the question
   learnRules (is this pair already answered?) and rule-cleanup (does the
   shorter rule answer for the longer?) both ask. JSON rather than a joined
   string, so no name can make two different pairs read as one. No rule is the
   empty string, and so is a rule that says nothing at all, which is how
   `autoCategorise` compared them when the answer was a category. */
function answerKey(r) {
  if (!r) return '';
  const category = String(r.category ?? '').trim(), sub = ruleSubcategory(r);
  return category || sub ? JSON.stringify([category, sub]) : '';
}

/* Where the rules file keeps the subcategory: the index of the header cell that
   NAMES it, or -1. Found by header and never by position, for the reason
   ADR-0010 section 4 gives for a transaction file and the rules file shares:
   the third cell of a household's file is theirs. The round-trip test's own
   file carries a `why` column there, and reading it as a subcategory would have
   put a sentence like "weekly shop" on every transaction a rule filed. Cells 0
   and 1 are the pattern and the category by position, as they always were, so
   neither can be this column. */
function rulesSubColumn(header) {
  if (!Array.isArray(header)) return -1;
  for (let i = 2; i < header.length; i++) {
    if (String(header[i] ?? '').trim().toLowerCase() === 'subcategory') return i;
  }
  return -1;
}

/* The pattern as the IMPORTER would have left a description that ended the
   same way. Discovery prints a country code on card rows ("PNP ROSEBANK ZA")
   and views/import.js strips it (`loc.stripDescSuffix`, ' ZA') before it
   categorises, so a rule typed or pasted WITH the suffix could never match the
   description it was copied from (2026-10-14 audit, L1-14: a number of rules in
   the vault the audit read were dead for exactly that reason). '' when the
   pattern has no such tail, or nothing would be left of it.

   Held as a second pattern, `alt`, tried by matchRule only when nothing else
   matched - see there for why that ordering makes it safe. The suffix itself is
   the one the ZA profile strips; it is spelled here because this module is
   profile-free, and a household whose bank adds nothing is unaffected: it has
   no description ending " za" and no rule that does. */
function withoutCountrySuffix(p) {
  if (!p.endsWith(' za')) return '';
  return p.slice(0, -3).trim();
}

/* Resolve a description against prepared rules and return the WINNING rule.
   An exact pattern wins outright; otherwise the longest matching substring
   wins, so a specific rule beats the general one it contains. The length test
   comes before includes() because it is the cheaper comparison.

   Ties are settled by rule order, which is why learnRules must not add a rule
   the existing set already answers the same way (categories.js) and why
   rule-cleanup.js restores a rejected candidate to its original slot.

   Returning the rule rather than the category is what lets the cleanup preview
   name the rule that covers a redundant one instead of merely asserting that
   one exists. */
/* ISSUE 71. A four-letter stem is a WORD, not a substring.

   learnPattern's floor is four characters, and `FEES 000123456` learns "fees",
   `CASH 000000000` learns "cash". Matched by bare includes() those rules ate
   COFFEES BY THE SEA (-> Bank charges) and CASHBUILD PAARL, PICK N PAY CASHIER
   (-> Cash withdrawal) — and rule-cleanup.js can never remove them, because
   the shorter rule is the survivor by design. Below eight characters a pattern
   must land on word boundaries; a longer one is specific enough that a
   substring is what the household meant ("woolworths" inside
   "woolworths food v&a"). Punctuation and digits count as boundaries, so
   "cash" still matches "CASH 000111" and "fees" still matches "FEES-000999". */
const SHORT = 8;
function hits(d, p) {
  if (p.length >= SHORT) return d.includes(p);
  let from = 0;
  for (;;) {
    const at = d.indexOf(p, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : d[at - 1];
    const after = d[at + p.length] || '';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

/* Does ONE prepared pattern match ONE description, by matchRule's own test?
   Both arguments are already ruleText()-normalised. Exported so
   rule-cleanup.js asks "which descriptions does this rule match" the way the
   matcher answers it, rather than with a bare includes() that ignores the
   word boundaries above. */
function patternMatches(d, p) {
  if (d === p || hits(d, p)) return true;
  const alt = withoutCountrySuffix(p);
  return !!alt && (d === alt || hits(d, alt));
}

/* Can `general` answer for `specific` on every description, ever? That is,
   does every description the matcher lets `specific` match also match
   `general`? Both are ruleText()-normalised patterns.

   rule-cleanup.js deletes a rule only when what answers in its place passes
   this. Its own comment says why: the replay proves the deletion is safe for
   the statements already imported, and this proves it for the ones still to
   come. It used to ask `specific.includes(general)`. That was the right
   question before ISSUE 71 and the wrong one after: a SHORT `general` only
   matches on word boundaries, so `tool` sits inside `toolshed depot` and
   matches none of the descriptions that pattern does (2026-10-07 audit,
   TIDY-COVER).

   So a short `general` has to sit inside `specific` with a boundary on both
   sides that every matching description keeps. Inside `specific` the
   neighbouring character is fixed. At an edge of `specific` it is whatever
   the description has there: a boundary when `specific` is short itself
   (it matches on boundaries too), and anything at all when `specific` is
   long and matches as a bare substring. `fees` therefore covers `vat fees
   charged` and `fees 2`, and does not cover `fees monthly`, because
   `xfees monthly` matches that one and not `fees`. */
const WORD_CHAR = /[a-z0-9]/;
function patternCovers(general, specific) {
  if (!general || !specific) return false;
  if (general === specific) return true;
  if (general.length >= SHORT) return specific.includes(general);
  const edgeIsBoundary = specific.length < SHORT;
  for (let at = specific.indexOf(general); at >= 0; at = specific.indexOf(general, at + 1)) {
    const end = at + general.length;
    const before = at > 0 ? !WORD_CHAR.test(specific[at - 1]) : edgeIsBoundary;
    const after = end < specific.length ? !WORD_CHAR.test(specific[end]) : edgeIsBoundary;
    if (before && after) return true;
  }
  return false;
}

function matchRule(desc, rules) {
  const d = ruleText(desc);
  let best = null, bestLen = 0;
  for (const r of rules) {
    if (r.p === d) return r;
    if (r.p.length > bestLen && hits(d, r.p)) { best = r; bestLen = r.p.length; }
  }
  if (best) return best;
  /* Only when no rule matched as written: a pattern that ends " za" is tried
     again without it (see withoutCountrySuffix). Second pass and strictly a
     fallback, so it can turn "no category" into one but can never change which
     rule wins a description some rule already matched - no existing
     categorisation, learned rule or cleanup verdict moves. */
  for (const r of rules) {
    if (!r.alt) continue;
    if (r.alt === d) return r;
    if (r.alt.length > bestLen && hits(d, r.alt)) { best = r; bestLen = r.alt.length; }
  }
  return best;
}

function autoCategorise(desc, rules) {
  const r = matchRule(desc, rules);
  return r ? r.category : '';
}

/* autoCategorise with the subcategory the winning rule sets beside the
   category. A rule with none answers the category alone, as every rule did
   before the third column existed. */
function autoCategoriseWithSub(desc, rules) {
  const r = matchRule(desc, rules);
  return r ? { category: r.category, subcategory: ruleSubcategory(r) } : { category: '', subcategory: '' };
}

module.exports = {
  learnPattern, prepareRules, matchRule, autoCategorise, autoCategoriseWithSub,
  answerKey, rulesSubColumn, ruleSubcategory,
  ruleText, patternMatches, patternCovers, isReferenceToken,
};
