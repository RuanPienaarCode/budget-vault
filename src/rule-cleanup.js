'use strict';
/* Which categorisation rules can be deleted without changing a single figure.

   Rules are learned one per newly-categorised merchant, so the file only ever
   grows. Most of what accumulates is a longer pattern sitting on top of a
   shorter one that already gives the same answer: it wins the match (longest
   wins) and returns the category the shorter rule would have returned anyway.
   Measured on a real 1,342-rule vault, 62% of the file was that.

   "Redundant" here is NOT a heuristic about pattern shapes. Guessing from the
   rule file alone is unsound — two patterns of equal length, or patterns that
   overlap without one containing the other, both change the answer when one is
   removed, and no amount of staring at the CSV reveals which. So the question
   is settled the only way it can be settled: replay the descriptions actually
   in the vault through the actual matcher, once per candidate, and keep only
   the removals that leave every single answer untouched.

   Three decisions worth stating plainly, because each one is a way this could
   have quietly destroyed the user's work:

   • Every candidate is verified against the ORIGINAL answers, not against the
     working set as it shrinks. A chain of individually-safe removals can
     otherwise walk the result somewhere neither step would have gone alone.

   • A rule matching nothing in the history is reported separately and NEVER
     removed. It is unused, not redundant — it may be waiting on a merchant
     that has not been billed yet, and this file cannot see the difference
     between a dead rule and a patient one.

   • Candidates are tried longest-first, so where a specific rule and the
     general rule agree, it is the specific one that goes. The survivor is the
     one that will still match next month's variant of the same merchant.

   Pure: no vault, no DOM, no Obsidian. Tested directly.  */

const { matchRule, autoCategorise } = require('./util');

/* rules: [{pattern, category}] in file order (order decides ties).
   descriptions: every transaction description in the vault, dupes welcome.

   Returns { remove, redundant, dormant, blank, kept, checked, total } where
   `remove` is the full set safe to delete — `redundant` plus `blank`, and
   deliberately NOT `dormant`. */
function analyseRules(rules, descriptions) {
  const all = rules || [];
  const prepared = [];
  const blank = [];
  all.forEach((r, i) => {
    const p = (r.pattern ?? '').toString().trim().toLowerCase();
    // A blank pattern is already ignored by the matcher (prepareRules drops
    // it), so it is dead weight by definition rather than by measurement.
    if (p) prepared.push({ p, category: r.category, i });
    else blank.push({ index: i, pattern: r.pattern ?? '', category: r.category, reason: 'blank' });
  });

  // Distinct descriptions only: a merchant billed monthly asks the matcher the
  // same question every time, and the answer cannot differ between them.
  const seen = new Set();
  const descs = [];
  for (const d of descriptions || []) {
    const k = (d ?? '').toString().trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    descs.push(k);
  }

  const base = descs.map(d => autoCategorise(d, prepared));

  // Removing a rule can only change a description that rule matched, so each
  // candidate is re-checked against its own hits rather than the whole vault.
  const touches = prepared.map(r => {
    const hits = [];
    descs.forEach((d, di) => { if (d === r.p || d.includes(r.p)) hits.push(di); });
    return hits;
  });

  const order = prepared.map((_, pi) => pi)
    .sort((a, b) => prepared[b].p.length - prepared[a].p.length || a - b);

  const working = prepared.slice();
  const redundant = [];
  const dormant = [];
  for (const pi of order) {
    const rule = prepared[pi];
    const hits = touches[pi];
    if (!hits.length) {
      dormant.push({ index: rule.i, pattern: all[rule.i].pattern, category: rule.category });
      continue;
    }
    const at = working.indexOf(rule);
    if (at === -1) continue;
    working.splice(at, 1);
    if (!hits.every(di => autoCategorise(descs[di], working) === base[di])) {
      working.splice(at, 0, rule);   // same slot: order decides ties
      continue;
    }
    // Name the rule that now answers for it, so the preview can say why this
    // one is safe to lose rather than just asserting that it is.
    const cover = matchRule(descs[hits[0]], working);
    /* Only ever delete the MORE SPECIFIC of the two. Passing the replay proves
       a removal is safe for the transactions already in the vault; it does not
       prove it for next month's statement. A rule whose cover is a substring of
       it can only ever have matched descriptions the cover also matches, so
       that one stays safe forever. The reverse — deleting a broad rule because
       history happens to contain only a longer variant of it — is safe today
       and a surprise later, and this file is not worth a surprise.

       An identical pattern satisfies this too: a duplicate can only ever lose
       to the copy that outranks it, in every future statement as much as this
       one, so exactly one of each set survives. */
    if (!cover || !rule.p.includes(cover.p)) {
      working.splice(at, 0, rule);
      continue;
    }
    redundant.push({
      index: rule.i,
      pattern: all[rule.i].pattern,
      category: rule.category,
      coveredBy: cover ? cover.p : '',
      hits: hits.length,
    });
  }

  redundant.sort((a, b) => a.index - b.index);
  dormant.sort((a, b) => a.index - b.index);
  const remove = [...blank, ...redundant].sort((a, b) => a.index - b.index);
  return {
    remove,
    redundant,
    dormant,
    blank,
    kept: all.length - remove.length,
    checked: descs.length,
    total: all.length,
  };
}

module.exports = { analyseRules };
