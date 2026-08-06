'use strict';
/* Rule cleanup — the safety proof for a bulk delete on the user's own file.

   analyseRules decides which categorisation rules can be deleted without
   changing how a single transaction already in the vault is categorised. It is
   allowed to be conservative and leave rules behind. It is NOT allowed to
   remove a rule that changes an answer, because the user approves a count and
   a list, not a re-derivation — if the analysis is wrong, the preview is a
   confident lie and the categories quietly move.

   So the tests here are mostly adversarial: the cases where a naive
   "is some shorter pattern a substring of this one?" heuristic would delete
   something load-bearing.

     • equal-length patterns, where removal promotes a rule the length test
       calls a tie and file order actually decides
     • overlapping patterns where neither contains the other
     • a middle rule in a chain whose removal exposes a DIFFERENT category
     • exact duplicates, where removing "the redundant one" twice removes both
       and the category disappears entirely

   The end-to-end guard is the last block: for a randomised rule set and
   history, re-categorising every description through the surviving rules must
   reproduce the original answer exactly. That is the property the preview
   promises, checked directly rather than argued.

   Runs in bare node. Wired into ./build.sh.
     node tests/rule-cleanup.test.cjs
*/

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

const { prepareRules, autoCategorise } = require('../src/util');
const { analyseRules } = require('../src/rule-cleanup');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const R = pairs => pairs.map(([pattern, category]) => ({ pattern, category }));
const removed = report => report.remove.map(r => r.pattern).sort();

/* The invariant the whole feature rests on: whatever survives must answer
   every description exactly as the full set did. */
function assertAnswersUnchanged(rules, descs, report, why) {
  const drop = new Set(report.remove.map(r => r.index));
  const survivors = rules.filter((_, i) => !drop.has(i));
  const before = prepareRules(rules);
  const after = prepareRules(survivors);
  for (const d of descs) {
    assert.strictEqual(autoCategorise(d, after), autoCategorise(d, before),
      `${why} — "${d}" changed category after cleanup`);
  }
  checks++;
}

/* ==================== the plain case this exists for ==================== */
{
  const rules = R([
    ['CORNER MART', 'Groceries'],
    ['CORNER MART CENTRAL', 'Groceries'],
    ['CORNER MART NORTH', 'Groceries'],
  ]);
  const descs = ['CORNER MART CENTRAL', 'CORNER MART NORTH', 'CORNER MART WEST'];
  const report = analyseRules(rules, descs);
  eq(removed(report), ['CORNER MART CENTRAL', 'CORNER MART NORTH'],
    'the specific rules go and the general one that answers for them stays');
  eq(report.kept, 1, 'one rule left');
  assertAnswersUnchanged(rules, descs, report, 'plain case');
}

/* ===================== a genuinely more specific rule ==================== */
{
  const rules = R([
    ['CORNER MART', 'Groceries'],
    ['CORNER MART FUEL', 'Transport'],
  ]);
  const descs = ['CORNER MART CENTRAL', 'CORNER MART FUEL BAY 3'];
  const report = analyseRules(rules, descs);
  eq(removed(report), [], 'a rule that disagrees with the general one is never removed');
  assertAnswersUnchanged(rules, descs, report, 'specific disagreement');
}

/* ============ the chain: removing the middle exposes a third ============= */
{
  // Lengths: 'FUEL DEPOT CENTRAL' > 'FUEL DEPOT' > 'FUEL'. Removing the middle
  // rule would drop 'FUEL DEPOT NORTH' from Transport onto Utilities.
  const rules = R([
    ['FUEL', 'Utilities'],
    ['FUEL DEPOT', 'Transport'],
    ['FUEL DEPOT CENTRAL', 'Transport'],
  ]);
  const descs = ['FUEL DEPOT CENTRAL', 'FUEL DEPOT NORTH', 'FUEL LEVY'];
  const report = analyseRules(rules, descs);
  eq(removed(report), ['FUEL DEPOT CENTRAL'],
    'only the leaf goes; the middle rule is load-bearing for its own descriptions');
  assertAnswersUnchanged(rules, descs, report, 'chain');
}

/* ================== overlap where neither contains the other ============= */
{
  // 'ALPHA BETA' and 'BETA GAMMA' both match 'ALPHA BETA GAMMA' and are the
  // same length, so file order decides. Neither may be removed silently.
  const rules = R([
    ['ALPHA BETA', 'Groceries'],
    ['BETA GAMMA', 'Eating out'],
  ]);
  const descs = ['ALPHA BETA GAMMA'];
  const report = analyseRules(rules, descs);
  ok(report.remove.length <= 1, 'at most one of an equal-length overlap can go');
  assertAnswersUnchanged(rules, descs, report, 'equal-length overlap');
}

/* ========================== exact duplicates ============================ */
{
  const rules = R([
    ['CORNER MART', 'Groceries'],
    ['CORNER MART', 'Groceries'],
    ['CORNER MART', 'Groceries'],
  ]);
  const descs = ['CORNER MART CENTRAL'];
  const report = analyseRules(rules, descs);
  eq(report.remove.length, 2, 'duplicates collapse to one, never to zero');
  eq(report.kept, 1, 'exactly one survivor');
  assertAnswersUnchanged(rules, descs, report, 'exact duplicates');
}

/* ============ a broad rule is never deleted for a narrow one ============= */
{
  /* The replay alone would delete 'ACSA' here: every description containing it
     in this history also contains the longer rule, which wins and keeps its own
     category, so nothing measurable changes. It is still the wrong answer — the
     history has simply never seen a bare "ACSA PARKING", and deleting the broad
     rule means the next statement that does arrives uncategorised.

     Found by running the cleanup against a real 1,342-rule vault and reading
     what it proposed, which is the argument for building the preview first. */
  const rules = R([
    ['ACSA', 'Fuel and transport'],
    ['ACSA CIA CAPE TOWN', 'Travel & Holidays'],
  ]);
  const descs = ['ACSA CIA CAPE TOWN 4', 'ACSA CIA CAPE TOWN 9'];
  const report = analyseRules(rules, descs);
  eq(removed(report), [], 'neither rule goes: one disagrees, the other is the broader of the pair');
  assertAnswersUnchanged(rules, descs, report, 'broad rule protection');

  // Every proposed removal must be strictly more specific than what covers it,
  // which is what makes the removal safe for statements not yet imported.
  const wide = analyseRules(
    R([['CORNER MART', 'Groceries'], ['CORNER MART CENTRAL', 'Groceries']]),
    ['CORNER MART CENTRAL 12']);
  ok(wide.redundant.every(r => r.pattern.toLowerCase().includes(r.coveredBy)),
    'a removed rule always contains the rule that covers it');
}

/* ===================== dormant rules are never removed =================== */
{
  const rules = R([
    ['CORNER MART', 'Groceries'],
    ['A MERCHANT NOT BILLED YET', 'Medical'],
  ]);
  const descs = ['CORNER MART CENTRAL'];
  const report = analyseRules(rules, descs);
  eq(removed(report), [], 'a rule matching nothing is reported, not deleted');
  eq(report.dormant.map(d => d.pattern), ['A MERCHANT NOT BILLED YET'],
    'and it is named so the preview can say it is being kept');
  eq(report.kept, 2, 'both rules survive');
}

/* ============================ blank patterns ============================= */
{
  const rules = R([['CORNER MART', 'Groceries'], ['', 'Groceries'], ['   ', 'Medical']]);
  const report = analyseRules(rules, ['CORNER MART CENTRAL']);
  eq(report.blank.length, 2, 'a hand-edited blank pattern is dead weight by definition');
  eq(report.remove.length, 2, 'and is included in the removal set');
}

/* ======================= degenerate inputs ============================== */
{
  const empty = analyseRules([], []);
  eq(empty.remove.length, 0, 'no rules, nothing to remove');
  eq(empty.total, 0, 'and the totals say so rather than throwing');

  const noHistory = analyseRules(R([['CORNER MART', 'Groceries']]), []);
  eq(noHistory.remove.length, 0, 'with no transactions nothing is provably redundant');
  eq(noHistory.dormant.length, 1, 'every rule is dormant against an empty history');

  eq(analyseRules(null, null).total, 0, 'null inputs do not throw');
}

/* ============ the property, over randomised rules and history =========== */
{
  // Deterministic PRNG so a failure is reproducible from the seed alone.
  let seed = 20260806;
  const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const WORDS = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'MART', 'FUEL', 'CAFE', 'CLINIC'];
  const CATS = ['Groceries', 'Transport', 'Medical', 'Eating out'];

  for (let round = 0; round < 200; round++) {
    const rules = [];
    for (let i = 0; i < 1 + rnd(10); i++) {
      const len = 1 + rnd(3);
      const pattern = Array.from({ length: len }, () => WORDS[rnd(WORDS.length)]).join(' ');
      rules.push({ pattern, category: CATS[rnd(CATS.length)] });
    }
    const descs = [];
    for (let i = 0; i < 1 + rnd(12); i++) {
      const len = 1 + rnd(4);
      descs.push(Array.from({ length: len }, () => WORDS[rnd(WORDS.length)]).join(' '));
    }
    const report = analyseRules(rules, descs);
    assertAnswersUnchanged(rules, descs, report, `random round ${round} (seed 20260806)`);
    ok(report.remove.length + report.kept === report.total,
      `round ${round}: removed + kept accounts for every rule`);
  }
}

console.log(`PASS — rule cleanup never changes an answer (${checks} assertions).`);
