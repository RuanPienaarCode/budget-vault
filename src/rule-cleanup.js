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

   • Exact duplicates (same normalised pattern, same category) are judged
     apart from the replay. The copy that sits first in the file always beats
     the later ones in matchRule, so a later copy can never answer anything the
     first does not: the first stays and the rest are redundant whatever the
     history holds. Judging them by replay made the verdict depend on which
     transaction file loaded first (2026-11-25 audit, RUL-11).

   • Same pattern with DIFFERENT categories is a conflict, not a duplicate. The
     later copy is already dead, but which of the two the household meant is
     theirs to say, so neither is removed and the pair is reported in
     `conflicts` for the preview to list.

   Pure: no vault, no DOM, no Obsidian. Tested directly.  */

const { matchRule, autoCategorise, ruleText, patternMatches, patternCovers, answerKey, ruleSubcategory } = require('./rules');

/* rules: [{pattern, category}] in file order (order decides ties).
   descriptions: every transaction description in the vault, dupes welcome.
   An entry is either the description string or `{ desc, cat }`, where `cat`
   is the category that row is filed under. The filed category is optional
   and is only ever used as evidence that a cover is ambiguous (below). It
   never changes what the replay compares, which is the rules' own answers.

   Returns { remove, redundant, dormant, blank, conflicts, kept, checked, total }
   where `remove` is the full set safe to delete — `redundant` plus `blank`, and
   deliberately NOT `dormant`. `conflicts` is [{ pattern, categories, indices }],
   one per pattern the file answers with more than one category; nothing in it
   is ever in `remove` unless it is also a true duplicate of an earlier line. */
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
    if (p) {
      const sub = ruleSubcategory(r);
      prepared.push(sub ? { p, category: r.category, subcategory: sub, i } : { p, category: r.category, i });
    }
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
  /* What each description answers today, subcategory included (ADR-0010
     section 5). The replay below asks "does the answer survive this removal"
     of THIS, not of `base`: a longer rule that files the same category under a
     different subcategory changes the answer, so it is never the redundant one
     (issue #185). `base` stays the category alone for `ambiguous`, which is a
     question about kinds of spending and not about their labels. */
  const baseKey = descs.map(d => answerKey(matchRule(d, prepared)));

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

  /* Same pattern, grouped. Within a group the first line beats every later
     one in matchRule (an exact match returns the first, and the longest-match
     scan only replaces on a strictly longer pattern), so a later line with the
     first's category adds nothing in any statement, present or future. Those
     are the duplicates. A group holding more than one category is a conflict:
     reported, and none of its lines is a candidate below. The category is
     compared as written (trimmed): categories are looked up by name, so
     "food" is not asserted to be "Food". */
  const groups = new Map();
  prepared.forEach((r, pi) => {
    if (!groups.has(r.p)) groups.set(r.p, []);
    groups.get(r.p).push(pi);
  });
  /* A line's answer, and how it is named when it has to be. A duplicate is the
     same category AND the same subcategory; one pattern filed under one
     category with two subcategories is a conflict like two categories, because
     the later line is just as dead and which one the household meant is as much
     theirs to say. The name is the category alone when there is no
     subcategory, so a conflict of categories reads exactly as it did. */
  const answerOf = pi => answerKey(prepared[pi]);
  const labelOf = pi => {
    const cat = String(prepared[pi].category ?? '').trim();
    return prepared[pi].subcategory ? `${cat} / ${prepared[pi].subcategory}` : cat;
  };
  const dupes = new Set();
  const inConflict = new Set();
  const conflicts = [];
  for (const [p, members] of groups) {
    if (members.length < 2) continue;
    const firstOf = new Map();
    for (const pi of members) {
      const c = answerOf(pi);
      if (firstOf.has(c)) dupes.add(pi); else firstOf.set(c, pi);
    }
    if (firstOf.size > 1) {
      members.forEach(pi => inConflict.add(pi));
      conflicts.push({
        pattern: p,
        categories: [...firstOf.values()].map(labelOf),
        indices: members.map(pi => prepared[pi].i),
      });
    }
  }
  conflicts.sort((a, b) => a.indices[0] - b.indices[0]);

  const order = prepared.map((_, pi) => pi)
    .sort((a, b) => prepared[b].p.length - prepared[a].p.length || a - b);

  /* The duplicates are out of the working set before any replay, so no other
     candidate's verdict can lean on a copy that is about to go, and the
     survivor of each set is the one the replay sees. Removing them changes no
     answer (above), so `base` needs no recomputing. */
  const redundant = [];
  for (const pi of dupes) {
    const rule = prepared[pi];
    redundant.push({
      index: rule.i,
      pattern: all[rule.i].pattern,
      category: rule.category,
      coveredBy: rule.p,
      hits: touches[pi].length,
    });
  }
  const working = prepared.filter((_, pi) => !dupes.has(pi));
  const dormant = [];
  for (const pi of order) {
    if (dupes.has(pi)) continue;
    const rule = prepared[pi];
    const hits = touches[pi];
    if (!hits.length) {
      dormant.push({ index: rule.i, pattern: all[rule.i].pattern, category: rule.category });
      continue;
    }
    if (inConflict.has(pi)) continue;   // the household's call, never ours
    const at = working.indexOf(rule);
    if (at === -1) continue;
    /* The descriptions this rule actually ANSWERS today. A hit that a longer
       rule wins before and after is no evidence about this rule, so it must not
       be the one the cover is judged on: with the history in another order the
       verdict used to change (RUL-11). */
    const won = hits.filter(di => matchRule(descs[di], working) === rule);
    working.splice(at, 1);
    if (!hits.every(di => answerKey(matchRule(descs[di], working)) === baseKey[di])) {
      working.splice(at, 0, rule);   // same slot: order decides ties
      continue;
    }
    /* Every description it wins needs an acceptable cover, not just the first.
       A rule that wins nothing is not removed on this evidence: there is no
       answer to check a cover against. */
    const covers = won.map(di => matchRule(descs[di], working));
    const cover = covers[0];
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
    if (!covers.length || covers.some(c => !c || !patternCovers(c.p, rule.p) || ambiguous(c))) {
      working.splice(at, 0, rule);
      continue;
    }
    redundant.push({
      index: rule.i,
      pattern: all[rule.i].pattern,
      category: rule.category,
      coveredBy: cover.p,
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
    conflicts,
    kept: all.length - remove.length,
    checked: descs.length,
    total: all.length,
  };
}

module.exports = { analyseRules };
