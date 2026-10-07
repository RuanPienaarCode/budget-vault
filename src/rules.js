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
    .map(r => ({ p: ruleText(r.pattern), category: r.category }))
    .filter(r => r.p);
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
  return d === p || hits(d, p);
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
  return best;
}

function autoCategorise(desc, rules) {
  const r = matchRule(desc, rules);
  return r ? r.category : '';
}

module.exports = {
  learnPattern, prepareRules, matchRule, autoCategorise,
  ruleText, patternMatches, patternCovers, isReferenceToken,
};
