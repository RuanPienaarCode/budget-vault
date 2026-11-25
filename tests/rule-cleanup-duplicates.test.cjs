'use strict';
/* Tidy and exact duplicates (2026-11-25 audit, RUL-11).

   analyseRules named the rule that answers in a candidate's place from the
   candidate's FIRST matching description only. That description is whichever
   transaction file loaded first, and when a longer rule happens to win it the
   cover is that longer rule, which never covers the candidate. So an exact
   duplicate (same pattern, same category, two or three times in the file)
   survived a tidy or not depending on load order, and the preview a household
   approved differed from one reload to the next.

   What is pinned here:

     1. Exact duplicates are redundant whatever they hit: the first stays, the
        rest go, with the history in either order and even with no history at
        all behind the pattern (the survivor carries it).
     2. Same pattern, DIFFERENT category, is a conflict, not a duplicate.
        Neither is removed; the report lists it under `conflicts` so a preview
        can say so. The copy that sits later in the file never wins, so
        removing it would be "safe", but which of the two the household meant
        is their call.
     3. A non-duplicate candidate is judged on every description it WINS, not
        on the first one it matches. A description a longer rule wins before and
        after is not evidence about the candidate, so it neither blocks nor
        allows the removal; one the candidate wins, and a rule that does not
        cover it would answer after, does block it.
     4. Whatever is removed leaves every known description in the category it
        had, in either order of history.

   Runs in bare node. Wired into ./build.sh.
     node tests/rule-cleanup-duplicates.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

const { prepareRules, autoCategorise } = require('../src/rules');
const { analyseRules } = require('../src/rule-cleanup');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const R = pairs => pairs.map(([pattern, category]) => ({ pattern, category }));
const gone = report => report.remove.map(r => r.index).sort((a, b) => a - b);

/* The same history in both orders: the verdict may not depend on which file
   loaded first. Returns the removed indices after checking they agree. */
function both(rules, descs, why) {
  const fwd = analyseRules(rules, descs);
  const rev = analyseRules(rules, descs.slice().reverse());
  eq(gone(rev), gone(fwd), `${why} — the same rules go whichever order the history loads in`);
  const drop = new Set(gone(fwd));
  const before = prepareRules(rules);
  const after = prepareRules(rules.filter((_, i) => !drop.has(i)));
  for (const d of descs) {
    eq(autoCategorise(d, after), autoCategorise(d, before), `${why} — "${d}" keeps its category`);
  }
  return fwd;
}

/* ---- 1. exact duplicates ------------------------------------------------ */
{
  // A longer rule wins the description that loads first; the duplicates only
  // matter on the second.
  const rules = R([
    ['checkers', 'Food'], ['checkers', 'Food'], ['checkers', 'Food'],
    ['checkers liquor', 'Liquor'],
  ]);
  const descs = ['CHECKERS LIQUOR NEWLANDS', 'CHECKERS RONDEBOSCH'];
  const report = both(rules, descs, 'duplicates behind a longer rule');
  eq(gone(report), [1, 2], 'the first copy stays and the other two go (before: none went when the longer rule loaded first)');
  eq(report.redundant.map(r => r.coveredBy), ['checkers', 'checkers'], 'each names the surviving copy as its cover');
  eq(report.kept, 2, 'two rules are left');
}
{
  // The history that loads first has only the longer rule's description.
  const rules = R([['checkers', 'Food'], ['checkers', 'Food'], ['checkers liquor', 'Liquor']]);
  eq(gone(analyseRules(rules, ['CHECKERS LIQUOR NEWLANDS'])), [1],
    'a duplicate goes even when every description it matches is won by a longer rule');
}
{
  // Duplicates that differ only in case and padding are the same pattern.
  const rules = R([['Spar Newlands', 'Food'], ['  SPAR NEWLANDS ', 'Food']]);
  eq(gone(analyseRules(rules, ['SPAR NEWLANDS 1'])), [1], 'the matcher\'s own normalisation decides what a duplicate is');
}
{
  // A duplicate of a rule nothing has matched yet: the pattern is kept (it may
  // be waiting for a merchant), the spare copy has nothing to wait for.
  const rules = R([['future merchant', 'Food'], ['future merchant', 'Food']]);
  const report = analyseRules(rules, ['SOMETHING ELSE']);
  eq(gone(report), [1], 'the spare copy of a dormant rule goes');
  eq(report.dormant.map(d => d.index), [0], 'the surviving copy is still reported as matching nothing yet');
}
{
  // Duplicates do not remove the pattern altogether, and a lone rule is untouched.
  const rules = R([['CORNER MART', 'Groceries'], ['CORNER MART', 'Groceries']]);
  eq(analyseRules(rules, ['CORNER MART CENTRAL']).kept, 1, 'duplicates collapse to one, never to zero');
}

/* ---- 2. same pattern, different category: a conflict ------------------- */
{
  const rules = R([['spar', 'Food'], ['spar', 'Liquor']]);
  const descs = ['SPAR NEWLANDS 1'];
  const report = both(rules, descs, 'a conflict');
  eq(gone(report), [], 'neither is removed (before: the later one was proposed as redundant)');
  eq(report.conflicts, [{ pattern: 'spar', categories: ['Food', 'Liquor'], indices: [0, 1] }],
    'the report lists it, with both categories and the line numbers');
}
{
  // Case differs only in the category: categories are looked up by name, so
  // "food" and "Food" are not asserted to be the same.
  const rules = R([['spar', 'Food'], ['spar', 'food']]);
  const report = analyseRules(rules, ['SPAR 1']);
  eq(gone(report), [], 'categories that differ in case are a conflict, not a duplicate');
  eq(report.conflicts.length, 1, 'and are listed');
}
{
  // A conflict that also holds a true duplicate: only the duplicate goes.
  const rules = R([['spar', 'Food'], ['spar', 'Liquor'], ['spar', 'Food']]);
  const report = analyseRules(rules, ['SPAR NEWLANDS 1']);
  eq(gone(report), [2], 'the third line duplicates the first, so it goes; the conflicting second stays');
  eq(report.conflicts[0].indices, [0, 1, 2], 'the group is still listed whole');
}
{
  eq(analyseRules(R([['spar', 'Food'], ['shell', 'Fuel']]), ['SPAR 1']).conflicts, [], 'no conflicts is an empty list');
}

/* ---- 3. judged on every description the rule wins ----------------------- */
{
  /* 'big alpha beta' wins both descriptions. After its removal the first falls
     to 'alpha' (which covers it: the stem sits between word boundaries inside
     it) and the second to 'beta shop' (which does not cover it). Judged from
     the first description alone it went; with the history the other way round
     it stayed. */
  const rules = R([['alpha', 'Food'], ['beta shop', 'Food'], ['big alpha beta', 'Food']]);
  const descs = ['BIG ALPHA BETA STORE', 'BIG ALPHA BETA SHOP'];
  const report = both(rules, descs, 'a candidate one of whose wins would be answered by a rule that is not its cover');
  eq(gone(report), [], 'it stays: it is not safe to lean on a rule that does not cover it');
}
{
  /* 'food market cape' (a survivor: nothing covers it) wins the first
     description outright, though 'woolworths food' matches it too. That
     description is no evidence about 'woolworths food', so it must not stop the
     removal. Judged from the first match alone the verdict flipped with the
     history's order. */
  const rules = R([['woolworths', 'Food'], ['woolworths food', 'Food'], ['food market cape', 'Food']]);
  const descs = ['WOOLWORTHS FOOD MARKET CAPE 1', 'WOOLWORTHS FOOD 1'];
  const report = both(rules, descs, 'a candidate that loses its first match to a longer rule');
  eq(gone(report), [1], 'it goes in either order (before: only when the history listed its own win first)');
  eq(report.redundant[0].coveredBy, 'woolworths', 'covered by the broad rule');
}
{
  // The existing guard still holds: a candidate that is the only answer stays.
  const rules = R([['alpha', 'Food'], ['alpha beta', 'Liquor']]);
  eq(gone(analyseRules(rules, ['ALPHA BETA 1', 'ALPHA 2'])), [], 'a rule whose removal changes an answer is never proposed');
}

/* ---- 4. the property, over random rules with duplicates and conflicts --- */
{
  let seed = 20261125;
  const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const WORDS = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'MART', 'FUEL', 'CAFE'];
  const CATS = ['Groceries', 'Transport', 'Medical'];
  const pick = a => a[rnd(a.length)];
  for (let round = 0; round < 150; round++) {
    const rules = [];
    for (let i = 0, n = 3 + rnd(10); i < n; i++) {
      const words = Array.from({ length: 1 + rnd(3) }, () => pick(WORDS));
      rules.push({ pattern: words.join(' '), category: pick(CATS) });
      if (rnd(3) === 0) rules.push({ ...rules[rules.length - 1] });                              // an exact duplicate
      if (rnd(8) === 0) rules.push({ pattern: rules[rules.length - 1].pattern, category: pick(CATS) }); // maybe a conflict
    }
    const descs = [];
    for (let i = 0, n = 4 + rnd(12); i < n; i++) {
      descs.push(Array.from({ length: 1 + rnd(4) }, () => pick(WORDS)).join(' ') + ' ' + (1000 + rnd(9000)));
    }
    const fwd = analyseRules(rules, descs);
    const rev = analyseRules(rules, descs.slice().reverse());
    eq(gone(rev), gone(fwd), `round ${round}: the verdict does not depend on history order`);
    const drop = new Set(gone(fwd));
    const before = prepareRules(rules);
    const after = prepareRules(rules.filter((_, i) => !drop.has(i)));
    for (const d of descs) {
      assert.strictEqual(autoCategorise(d, after), autoCategorise(d, before), `round ${round}: "${d}" changed category`);
    }
    checks++;
    // no conflicting category pair ever loses a member except to a true duplicate
    for (const c of fwd.conflicts) {
      const survivors = c.categories.filter(cat => c.indices.some(i => !drop.has(i) && rules[i].category.trim() === cat));
      assert.deepStrictEqual(survivors, c.categories, `round ${round}: every category of a conflict keeps a line`);
      checks++;
    }
  }
}

console.log(`PASS rule-cleanup-duplicates (${checks} checks)`);
