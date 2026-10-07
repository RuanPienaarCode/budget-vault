'use strict';
/* The rule a tidy deletes a rule FOR must be one the matcher will honour on
   every future statement, and it must not be a word that more than one kind
   of spending shares.

   analyseRules deletes a rule when replaying the vault's history shows that
   every answer stays the same without it, and when what answers in its place
   (its "cover") is a substring of it. The second test is what keeps the tidy
   safe for statements not yet imported. The 2026-10-07 audit (TIDY-COVER /
   L1 OOL-4) found two ways that test was weaker than it looked:

   1. A SHORT COVER IS NOT A SUBSTRING MATCH. Since ISSUE 71 a pattern under
      eight characters matches on word boundaries only (rules.js hits()). So
      `tool` covers nothing inside `toolshed depot`, even though `includes()`
      says it is in there. Replayed over a history line that also holds a
      standalone TOOL, `toolshed depot` looked redundant and was deleted. The
      next `TOOLSHED DEPOT` statement then arrived uncategorised. A cover now
      has to match the candidate the way the house matcher would
      (rules.js patternCovers).

   2. A PLACE NAME IS NOT A MERCHANT. On the audited vault, one broad
      nine-character place-name rule had been pointed at a grocery category,
      and the tidy proposed deleting thirteen specific grocery-merchant rules
      on the strength of it. The replay was right that nothing would change
      today. But the place name matches merchants of every kind in that
      town: longer rules file them under other categories, and so do the
      rows themselves. Delete the thirteen and the household's grocery
      categorisation hangs on one over-broad rule that is already wrong for
      most of what it matches. A cover whose matches are filed under more
      than one category (by the rules' own answers, or by the categories the
      rows are filed under) is ambiguous, and nothing is deleted on its
      strength.

   The invariants rule-cleanup.test.cjs pins still hold: survivors answer
   every description exactly as the full set did, and only the more specific
   rule of a pair is ever deleted. The randomised blocks below re-check that
   over random rules, history and filed categories. They also check that
   every cover a removal names really covers it, and that the cover's matches
   all sit in one category.

   Synthetic places, merchants and categories only.
     node tests/rule-cleanup-cover.test.cjs */

const assert = require('assert');
const { prepareRules, autoCategorise, ruleText, patternMatches, patternCovers } = require('../src/rules');
const { analyseRules } = require('../src/rule-cleanup');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const R = pairs => pairs.map(([pattern, category]) => ({ pattern, category }));
const removed = report => report.remove.map(r => r.pattern).sort();
const descOf = d => (d && typeof d === 'object' ? d.desc : d);

function assertAnswersUnchanged(rules, descs, report, why) {
  const drop = new Set(report.remove.map(r => r.index));
  const before = prepareRules(rules);
  const after = prepareRules(rules.filter((_, i) => !drop.has(i)));
  for (const d of descs) {
    assert.strictEqual(autoCategorise(descOf(d), after), autoCategorise(descOf(d), before),
      `${why} — "${descOf(d)}" changed category after cleanup`);
  }
  checks++;
}

/* ===================== 1. the place-name cover ========================= */
{
  const rules = R([
    ['LAKESIDE CITY', 'Groceries'],               // a town, not a shop
    ['CORNER MART LAKESIDE CITY', 'Groceries'],
    ['FRESH FARM LAKESIDE CITY', 'Groceries'],
    ['NORTH CLINIC LAKESIDE CITY', 'Medical'],
  ]);
  const descs = ['CORNER MART LAKESIDE CITY 01', 'FRESH FARM LAKESIDE CITY', 'NORTH CLINIC LAKESIDE CITY'];
  const report = analyseRules(rules, descs);
  eq(removed(report), [],
    'the merchant rules stay: the place name also matches a clinic the rules file under Medical');
  assertAnswersUnchanged(rules, descs, report, 'place-name cover');

  // Contrast: the same file without the clinic. Now the broad rule only ever
  // matches groceries, so it is a real stem and the tidy may lean on it.
  const narrow = rules.slice(0, 3);
  const narrowDescs = descs.slice(0, 2);
  const report2 = analyseRules(narrow, narrowDescs);
  eq(removed(report2), ['CORNER MART LAKESIDE CITY', 'FRESH FARM LAKESIDE CITY'],
    'with no other kind of spending under the broad rule, its specific variants are still tidied');
  assertAnswersUnchanged(narrow, narrowDescs, report2, 'unambiguous cover');
}

/* ============ 1b. the rows' own categories count as evidence ============ */
{
  const rules = R([['LAKESIDE CITY', 'Groceries'], ['CORNER MART LAKESIDE CITY', 'Groceries']]);
  // The rules alone cannot see it: the pharmacy has no rule of its own, so
  // the place name answers it as Groceries. The household filed it under
  // Medical, so the place name is ambiguous.
  const filed = [
    { desc: 'CORNER MART LAKESIDE CITY', cat: 'Groceries' },
    { desc: 'HARBOUR PHARMACY LAKESIDE CITY', cat: 'Medical' },
  ];
  eq(removed(analyseRules(rules, filed)), [],
    'a row filed under another category makes the cover ambiguous');
  eq(removed(analyseRules(rules, filed.map(d => d.desc))), ['CORNER MART LAKESIDE CITY'],
    'contrast: the same history as bare descriptions carries no such evidence, so the specific rule goes');
  const uncategorised = [filed[0], { desc: 'HARBOUR PHARMACY LAKESIDE CITY', cat: '' }];
  eq(removed(analyseRules(rules, uncategorised)), ['CORNER MART LAKESIDE CITY'],
    'an uncategorised row is no category, so it is not evidence of another');
  const sameCat = [filed[0], { desc: 'HARBOUR PHARMACY LAKESIDE CITY', cat: 'Groceries' }];
  eq(removed(analyseRules(rules, sameCat)), ['CORNER MART LAKESIDE CITY'],
    'and rows filed under the cover\'s own category are agreement, not ambiguity');
}

/* ============ 2. a short cover must land on word boundaries ============ */
{
  // The history line holds a standalone TOOL, so the replay passes. A plain
  // includes() said `tool` is inside `toolshed depot`, but the matcher never
  // lets a four-letter word match inside a longer one.
  const rules = R([['TOOL', 'Hardware'], ['TOOLSHED DEPOT', 'Hardware']]);
  const descs = ['TOOL HIRE TOOLSHED DEPOT 7'];
  const report = analyseRules(rules, descs);
  eq(removed(report), [], 'a short rule is not a cover for a pattern it only sits inside');
  assertAnswersUnchanged(rules, descs, report, 'short cover');
  eq(autoCategorise('TOOLSHED DEPOT 9', prepareRules(R([['TOOL', 'Hardware']]))), '',
    'which is right: without the longer rule, next month\'s TOOLSHED DEPOT would arrive uncategorised');

  // A short cover that does sit on word boundaries inside the candidate
  // still counts, so the tidy is not simply refusing every short rule.
  const inner = R([['FEES', 'Bank charges'], ['VAT FEES CHARGED', 'Bank charges']]);
  eq(removed(analyseRules(inner, ['VAT FEES CHARGED 04'])), ['VAT FEES CHARGED'],
    'a short cover bounded on both sides inside the candidate still covers it');
  const short = R([['FEES', 'Bank charges'], ['FEES 2', 'Bank charges']]);
  eq(removed(analyseRules(short, ['FEES 2 MONTHLY'])), ['FEES 2'],
    'and so does one inside a candidate that is itself short (it lands on word boundaries too)');
}

/* ============ 3. patternCovers is the matcher's own containment ========= */
{
  eq(patternCovers('corner mart', 'corner mart central'), true, 'a long cover inside the candidate covers it');
  eq(patternCovers('corner mart central', 'corner mart'), false, 'a longer pattern never covers a shorter one');
  eq(patternCovers('fees', 'fees'), true, 'a pattern covers its own duplicate');
  eq(patternCovers('tool', 'toolshed depot'), false, 'a short pattern does not cover a word it is glued into');
  eq(patternCovers('fees', 'vat fees charged'), true, 'a short pattern bounded inside the candidate covers it');
  eq(patternCovers('fees', 'fees 2'), true, 'a short candidate keeps its own boundaries, so its edges are safe');
  eq(patternCovers('fees', 'fees monthly'), false,
    'a short pattern on the EDGE of a long candidate does not cover it');
  // The edge case is real, not theoretical: a long pattern matches as a
  // substring, so a description can glue a letter onto its front.
  eq(autoCategorise('XFEES MONTHLY', prepareRules(R([['FEES MONTHLY', 'Bank charges']]))), 'Bank charges',
    'the long candidate matches a description with a letter glued on');
  eq(autoCategorise('XFEES MONTHLY', prepareRules(R([['FEES', 'Bank charges']]))), '',
    'the short pattern does not, so it was never a cover for it');

  // The property, over random patterns and descriptions: whenever
  // patternCovers says yes, the matcher agrees on every description.
  let seed = 7102026;
  const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const CH = ['a', 'b', 'c', ' ', '-', 'ab', 'abc', 'bc', 'abcabcab', 'x'];
  const pick = max => { let s = ''; const n = 1 + rnd(max); for (let i = 0; i < n; i++) s += CH[rnd(CH.length)]; return ruleText(s); };
  let yes = 0;
  for (let i = 0; i < 4000; i++) {
    const g = pick(3), s = pick(5);
    if (!g || !s || !patternCovers(g, s)) continue;
    yes++;
    for (let k = 0; k < 6; k++) {
      const d = ruleText(pick(2) + s + pick(2));
      if (!patternMatches(d, s)) continue;
      assert.ok(patternMatches(d, g),
        `patternCovers("${g}", "${s}") said yes, but "${d}" matches "${s}" and not "${g}" (seed 7102026)`);
    }
  }
  ok(yes > 50, `the property was exercised (${yes} covering pairs)`);
}

/* ======== 4. the property, over random rules, history and filings ======= */
{
  let seed = 20261007;
  const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const WORDS = ['ALPHA', 'BETA', 'MART', 'FUEL', 'LAKESIDE', 'CITYVILLE', 'CLINIC', 'TOOLSHED', 'CAFE'];
  const CATS = ['Groceries', 'Transport', 'Medical', 'Eating out'];
  for (let round = 0; round < 300; round++) {
    const rules = [];
    for (let i = 0; i < 1 + rnd(10); i++) {
      const len = 1 + rnd(3);
      rules.push({ pattern: Array.from({ length: len }, () => WORDS[rnd(WORDS.length)]).join(' '), category: CATS[rnd(CATS.length)] });
    }
    const history = [];
    for (let i = 0; i < 1 + rnd(12); i++) {
      const desc = Array.from({ length: 1 + rnd(4) }, () => WORDS[rnd(WORDS.length)]).join(' ');
      // A third of the rows carry no filed category, as an unedited import would.
      history.push(rnd(3) ? { desc, cat: rnd(4) ? CATS[rnd(CATS.length)] : '' } : desc);
    }
    const report = analyseRules(rules, history);
    assertAnswersUnchanged(rules, history, report, `random round ${round} (seed 20261007)`);
    ok(report.remove.length + report.kept === report.total, `round ${round}: removed + kept accounts for every rule`);

    const prepared = prepareRules(rules);
    for (const r of report.redundant) {
      const p = ruleText(r.pattern);
      assert.ok(patternCovers(r.coveredBy, p), `round ${round}: "${r.coveredBy}" does not cover removed "${p}"`);
      // Every description the cover matches sits in ONE category, by the
      // full set's answer and by the category its rows are filed under.
      const cats = new Set();
      for (const h of history) {
        const d = ruleText(descOf(h));
        if (!d || !patternMatches(d, r.coveredBy)) continue;
        const a = autoCategorise(d, prepared);
        if (a) cats.add(a);
        if (h && typeof h === 'object' && h.cat) cats.add(h.cat);
      }
      assert.ok(cats.size <= 1, `round ${round}: removed "${p}" on the strength of "${r.coveredBy}", which spans ${[...cats].join(' / ')}`);
    }
    checks++;
  }
}

console.log(`PASS — rule-cleanup-cover: a tidy only leans on a cover the matcher honours and no other category shares (${checks} assertions).`);
