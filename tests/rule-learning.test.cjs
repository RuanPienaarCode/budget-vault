'use strict';
/* Rule learning — what learnRules is allowed to put in the user's rules CSV.

   Data/Categorisation Rules.csv is the user's file, not plugin state. Every
   line in it is a line they may one day read, and every line costs a string
   comparison on every row of every future import (rows × rules — the reason
   prepareRules normalises once per pass rather than once per row).

   learnRules grows that file by one rule per newly-categorised merchant, so
   the only thing keeping it finite is what it REFUSES to add. It refuses two
   things: a pattern it already holds, and a pattern the existing rules already
   resolve to the same category. The second is the load-bearing one — measured
   against a real 1,342-rule vault, 832 rules (62%) were already answered by a
   shorter rule pointing at the same category, i.e. they could never have
   changed an import's outcome.

   Rules that genuinely disagree with the general case must still be learned,
   which is the other half of every test here.

   Runs in bare node. Wired into ./build.sh.
     node tests/rule-learning.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();

const { prepareRules, autoCategorise } = require('../src/util');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* Build a ctx with registerCategories wired onto it, seeded with rules. */
function rulesCtx(rules = []) {
  const ctx = makeCtx({});
  ctx.S.rules = rules.map(([pattern, category]) => ({ pattern, category }));
  const written = {};
  ctx.provide({
    writeFile: async (rel, content) => { written[rel] = content; },
    fileAt: () => null,
    mdFilesIn: () => [],
  });
  require('../src/categories')(ctx);
  return { ctx, written };
}

/* ===================== the matcher these rules feed ====================== */
{
  const rules = prepareRules([
    { pattern: 'CORNER MART', category: 'Groceries' },
    { pattern: 'CORNER MART FUEL', category: 'Transport' },
  ]);
  eq(autoCategorise('CORNER MART CENTRAL', rules), 'Groceries',
    'the only matching rule wins');
  eq(autoCategorise('CORNER MART FUEL BAY 3', rules), 'Transport',
    'the longest matching rule wins, so a specific rule beats the general one');
  eq(autoCategorise('corner mart', rules), 'Groceries',
    'matching is case-insensitive');
  eq(autoCategorise('SOMEWHERE ELSE', rules), '',
    'no match returns empty, not a guess');
  // prepareRules must not crash on a hand-edited CSV row with a blank pattern.
  eq(prepareRules([{ pattern: '  ', category: 'X' }]).length, 0,
    'a blank pattern is dropped rather than matching every description');
}

/* ============ learnRules: refuse what the rules already answer =========== */
(async () => {
  {
    const { ctx, written } = rulesCtx([['CORNER MART', 'Groceries']]);
    const added = await ctx.learnRules([
      { desc: 'CORNER MART CENTRAL 000000******0000', cat: 'Groceries' },
    ]);
    eq(added, 0, 'a description the existing rules already categorise adds nothing');
    eq(ctx.S.rules.length, 1, 'and the rule list does not grow');
    ok(!written['Data/Categorisation Rules.csv'],
      'with nothing added the CSV is not rewritten at all');
  }

  {
    // The same merchant, but the user has put it somewhere else. This one
    // MUST be learned — it is the case that changes an outcome.
    const { ctx } = rulesCtx([['CORNER MART', 'Groceries']]);
    const added = await ctx.learnRules([
      { desc: 'CORNER MART FUEL BAY 3', cat: 'Transport' },
    ]);
    eq(added, 1, 'a description that disagrees with the general rule is learned');
    eq(ctx.S.rules.find(r => r.category === 'Transport').pattern, 'CORNER MART FUEL BAY',
      'and it is stored trimmed of reference noise, so it generalises');
  }

  {
    const { ctx } = rulesCtx([]);
    const added = await ctx.learnRules([
      { desc: 'TELCO CO VODREF0000000', cat: 'Utilities' },
      { desc: 'TELCO CO VODREF0000001', cat: 'Utilities' },
      { desc: 'TELCO CO VODREF0000002', cat: 'Utilities' },
    ]);
    eq(added, 1, 'one merchant billed three times learns one rule, not three');
    eq(ctx.S.rules.length, 1, 'the reference code never reaches the rules file');
  }

  {
    // Redundancy must be judged against rules learned earlier in the SAME
    // batch, not only against what was on disk when the batch started.
    const { ctx } = rulesCtx([]);
    const added = await ctx.learnRules([
      { desc: 'MEGAMART', cat: 'Groceries' },
      { desc: 'MEGAMART CENTRAL', cat: 'Groceries' },
      { desc: 'MEGAMART NORTH', cat: 'Groceries' },
    ]);
    eq(added, 1, 'later rows in a batch are measured against earlier ones');
    eq(ctx.S.rules.map(r => r.pattern), ['MEGAMART'],
      'the general rule is the one kept');
  }

  {
    // Order matters the other way too: the specific one arriving first must
    // not stop the general one being learned, because the general one covers
    // descriptions the specific one does not.
    const { ctx } = rulesCtx([]);
    const added = await ctx.learnRules([
      { desc: 'MEGAMART CENTRAL', cat: 'Groceries' },
      { desc: 'MEGAMART', cat: 'Groceries' },
    ]);
    eq(added, 2, 'a broader pattern is still learned after a narrower one');
  }

  {
    const { ctx } = rulesCtx([['CORNER MART', 'Groceries']]);
    const added = await ctx.learnRules([
      { desc: 'CORNER MART', cat: 'Eating out' },
    ]);
    eq(added, 0, 'an established rule is never silently overwritten');
    eq(ctx.S.rules[0].category, 'Groceries', 'the original category stands');
  }

  {
    const { ctx } = rulesCtx([]);
    const added = await ctx.learnRules([
      { desc: 'CORNER MART', cat: '' },
      { desc: '', cat: 'Groceries' },
    ]);
    eq(added, 0, 'an uncategorised row and an empty description both learn nothing');
  }

  {
    // The CSV is only rewritten when something changed, and it round-trips.
    const { ctx, written } = rulesCtx([['CORNER MART', 'Groceries']]);
    await ctx.learnRules([{ desc: 'FUEL DEPOT 12', cat: 'Transport' }]);
    const csv = written['Data/Categorisation Rules.csv'];
    ok(csv && csv.startsWith('pattern,category\n'), 'the CSV keeps its header');
    ok(csv.trim().split('\n').length === 3, 'header plus both rules, nothing else');
  }

  console.log(`PASS — rule learning stays finite (${checks} assertions).`);
})().catch(err => { console.error(err); process.exit(1); });
