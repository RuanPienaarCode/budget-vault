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

   • The rule that answers in a deleted rule's place (its cover) has to be one
     the household can lean on: it must cover the deleted rule by the
     matcher's own rules (word boundaries included), and it must not be a
     word that spending of more than one kind shares. On the vault audited on
     2026-10-07 a nine-character place name, pointed at a grocery category,
     would have taken thirteen specific merchant rules with it (TIDY-COVER).

   Pure: no vault, no DOM, no Obsidian. Tested directly.  */

const { matchRule, autoCategorise, ruleText, patternMatches, patternCovers } = require('./rules');

/* rules: [{pattern, category}] in file order (order decides ties).
   descriptions: every transaction description in the vault, dupes welcome.
   An entry is either the description string or `{ desc, cat }`, where `cat`
   is the category that row is filed under. The filed category is optional
   and is only ever used as evidence that a cover is ambiguous (below). It
   never changes what the replay compares, which is the rules' own answers.

   Returns { remove, redundant, dormant, blank, kept, checked, total } where
   `remove` is the full set safe to delete — `redundant` plus `blank`, and
   deliberately NOT `dormant`. */
function analyseRules(rules, descriptions) {
  const all = rules || [];
  const prepared = [];
  const blank = [];
  all.forEach((r, i) => {
    // ruleText, the matcher's own normalisation: a pattern this file reads
    // differently from prepareRules is a different rule set from the one the
    // replay is meant to be proving things about.
    const p = ruleText(r.pattern);
    // A blank pattern is already ignored by the matcher (prepareRules drops
    // it), so it is dead weight by definition rather than by measurement.
    if (p) prepared.push({ p, category: r.category, i });
    else blank.push({ index: i, pattern: r.pattern ?? '', category: r.category, reason: 'blank' });
  });

  // Distinct descriptions only: a merchant billed monthly asks the matcher the
  // same question every time, and the answer cannot differ between them. The
  // categories its rows are filed under are collected per description, since
  // those can differ between rows.
  const seen = new Map();
  const descs = [];
  const filed = [];
  for (const entry of descriptions || []) {
    const withCat = entry !== null && typeof entry === 'object';
    const k = ruleText(withCat ? entry.desc : entry);
    if (!k) continue;
    let di = seen.get(k);
    if (di === undefined) {
      di = descs.length;
      seen.set(k, di);
      descs.push(k);
      filed.push(new Set());
    }
    const cat = withCat ? String(entry.cat ?? '').trim() : '';
    if (cat) filed[di].add(cat);
  }

  const base = descs.map(d => autoCategorise(d, prepared));

  /* Is this cover ambiguous? Yes when any description it matches is in a
     category other than the cover's own, either by the full rule set's answer
     (a longer rule files it elsewhere) or by the category its row was filed
     under. A cover like that is a word shared by different kinds of
     spending, typically a town, not the merchant the deleted rule named.
     Deleting specific rules for it hangs the household's categorisation on
     its one most over-broad rule, and on the audited vault that rule was
     already wrong for most of what it matched.

     An uncategorised row is no category at all, so it is not evidence of
     another one. Memoised per cover, because one broad rule covers many
     candidates. */
  const ambiguity = new Map();
  const ambiguous = cover => {
    if (ambiguity.has(cover)) return ambiguity.get(cover);
    let found = false;
    for (let di = 0; di < descs.length && !found; di++) {
      if (!patternMatches(descs[di], cover.p)) continue;
      if (base[di] && base[di] !== cover.category) found = true;
      for (const c of filed[di]) if (c !== cover.category) found = true;
    }
    ambiguity.set(cover, found);
    return found;
  };

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
       prove it for next month's statement. A rule its cover covers (every
       description it can match, the cover matches too) stays safe forever. The
       reverse — deleting a broad rule because history happens to contain only
       a longer variant of it — is safe today and a surprise later, and this
       file is not worth a surprise.

       "Covers" is rules.js patternCovers, the matcher's own containment. This
       used to be `rule.p.includes(cover.p)`, which ignores ISSUE 71's word
       boundaries: a short cover such as `tool` passes includes() inside
       `toolshed depot` and matches none of that rule's descriptions.

       An identical pattern satisfies this too: a duplicate can only ever lose
       to the copy that outranks it, in every future statement as much as this
       one, so exactly one of each set survives.

       And the cover must not be ambiguous (see `ambiguous` above). A cover
       that also answers for other kinds of spending is safe today and not a
       rule to keep the specific ones on. */
    if (!cover || !patternCovers(cover.p, rule.p) || ambiguous(cover)) {
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
