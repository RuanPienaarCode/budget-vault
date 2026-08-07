'use strict';
/* Categorisation rules: learning one from a description, and resolving a
   description against the set.

   Kept apart from the statement parsing it feeds because the rules outlive any
   one import — they are a file in the vault the user can edit, and rule-cleanup
   replays real descriptions through matchRule to decide what is redundant. Both
   readers have to agree exactly, so there is one implementation.

   Pure — no DOM, no obsidian import. */

/* Trim trailing reference noise (masked card numbers, statement refs, phone /
   meter numbers, caps+digit ref codes) from a transaction description so a
   learned categorisation rule generalises to next month's version of the same
   merchant. Internal whitespace is preserved byte-for-byte — rule matching is
   exact/substring against the raw description, so collapsing spaces would
   break it. Falls back to the untrimmed description if trimming would leave
   fewer than 4 characters. */
function learnPattern(desc) {
  let s = (desc ?? '').toString().trim();
  for (;;) {
    const m = s.match(/^(.*\S)[ \t]+(\S+)$/);
    if (!m) break;
    const w = m[2];
    const digits = (w.match(/\d/g) || []).length;
    const noise = /\*{2,}/.test(w) ||                          // masked card: 000000******0000
      /\d{4,}/.test(w) ||                                      // long digit run: refs, phone, meter numbers
      (digits > 0 && digits / w.length >= 0.4) ||              // digit-heavy token: X0000000
      (digits > 0 && w.length >= 8 && /^[A-Z0-9]+$/.test(w));  // long caps+digit ref: VODREF0000000
    if (!noise) break;
    s = m[1];
  }
  return s.length >= 4 ? s : (desc ?? '').toString().trim();
}

/* Normalise the rule list ONCE per pass, not once per row. Rules grow with the
   history, so lowercasing inside the match loop was rows × rules: measured
   51ms at 1,200 rows and 2,000 rules on desktop, several hundred on a phone. */
function prepareRules(rules) {
  return (rules || [])
    .map(r => ({ p: (r.pattern ?? '').trim().toLowerCase(), category: r.category }))
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
function matchRule(desc, rules) {
  const d = (desc ?? '').toString().trim().toLowerCase();
  let best = null, bestLen = 0;
  for (const r of rules) {
    if (r.p === d) return r;
    if (r.p.length > bestLen && d.includes(r.p)) { best = r; bestLen = r.p.length; }
  }
  return best;
}

function autoCategorise(desc, rules) {
  const r = matchRule(desc, rules);
  return r ? r.category : '';
}

module.exports = { learnPattern, prepareRules, matchRule, autoCategorise };
