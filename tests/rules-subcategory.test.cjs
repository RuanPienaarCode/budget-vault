'use strict';
/* A categorisation rule can carry a subcategory (ADR-0010 section 5, issue
   #185): the pure half. Matching returns the subcategory with the category,
   a rule with none sets the category alone, a rule's category and subcategory
   change together or not at all, and the tidy never treats two rules that
   differ only in subcategory as one.

   Everything here is synthetic and runs in bare node. The file and the pages
   are in tests/rules-subcategory-csv.test.cjs, import-rule-subcategory.test.cjs
   and transactions-learn-subcategory.test.cjs.
     node tests/rules-subcategory.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

const { prepareRules, matchRule, autoCategorise, autoCategoriseWithSub, answerKey, rulesSubColumn } = require('../src/rules');
const { setRuleCategory } = require('../src/subcategories');
const { analyseRules } = require('../src/rule-cleanup');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1. the third column is found by its header, never by position -------- */
{
  eq(rulesSubColumn(['pattern', 'category']), -1, 'a two-column header has none');
  eq(rulesSubColumn(['pattern', 'category', 'subcategory']), 2, 'the plain three-column header');
  eq(rulesSubColumn(['Pattern', 'Category', ' Subcategory ']), 2, 'trimmed and case-folded');
  eq(rulesSubColumn(['pattern', 'category', 'why']), -1, 'a household column in the third slot is theirs, not a subcategory');
  eq(rulesSubColumn(['pattern', 'category', 'why', 'Subcategory']), 3, 'found where it sits after the household\'s own column');
  eq(rulesSubColumn(['subcategory', 'category']), -1, 'cells 0 and 1 are the pattern and the category, whatever they say');
  eq(rulesSubColumn(['pattern', 'subcategory']), -1, 'so a header with it in the category slot is not a subcategory column');
  eq(rulesSubColumn(null), -1, 'no header at all');
  eq(rulesSubColumn(undefined), -1, 'an absent header');
  eq(rulesSubColumn('pattern,category,subcategory'), -1, 'a non-array is no header');
  eq(rulesSubColumn(['pattern', 'category', '', 'subcategory', 'subcategory']), 3, 'the first one wins');
}

/* ---- 2. matching returns the subcategory with the category ---------------- */
{
  const rules = prepareRules([
    { pattern: 'ENGEN', category: 'Car', subcategory: 'Fuel' },
    { pattern: 'ENGEN QUICKSHOP', category: 'Groceries' },                 // longer, blank subcategory
    { pattern: 'CORNER SERVICE STATION', category: 'Car', subcategory: '  Services ' },
    { pattern: 'CITY TOLL PLAZA ZA', category: 'Car', subcategory: 'Tolls' },
    { pattern: 'BLANK CELL', category: 'Home', subcategory: '' },
    { pattern: 'SPACES ONLY', category: 'Home', subcategory: '   ' },
    { pattern: 'NO FIELD AT ALL', category: 'Home' },
  ]);
  eq(autoCategoriseWithSub('ENGEN RONDEBOSCH 0042', rules), { category: 'Car', subcategory: 'Fuel' }, 'a rule with a subcategory sets both');
  eq(autoCategoriseWithSub('ENGEN QUICKSHOP RONDEBOSCH', rules), { category: 'Groceries', subcategory: '' },
    'the longer rule wins and brings its own (blank) subcategory, not the shorter one\'s');
  eq(autoCategoriseWithSub('corner service station newlands', rules), { category: 'Car', subcategory: 'Services' }, 'a subcategory is trimmed');
  eq(autoCategoriseWithSub('CITY TOLL PLAZA', rules), { category: 'Car', subcategory: 'Tolls' },
    'the country-suffix fallback match carries the subcategory too');
  eq(autoCategoriseWithSub('BLANK CELL', rules), { category: 'Home', subcategory: '' }, 'a blank subcategory sets the category alone');
  eq(autoCategoriseWithSub('SPACES ONLY', rules), { category: 'Home', subcategory: '' }, 'a cell of spaces is blank');
  eq(autoCategoriseWithSub('NO FIELD AT ALL', rules), { category: 'Home', subcategory: '' }, 'a rule with no subcategory field at all');
  eq(autoCategoriseWithSub('SOMETHING ELSE', rules), { category: '', subcategory: '' }, 'no rule: nothing');
  eq(autoCategorise('ENGEN RONDEBOSCH 0042', rules), 'Car', 'autoCategorise still answers the category alone');
  eq(matchRule('ENGEN RONDEBOSCH', rules).subcategory, 'Fuel', 'matchRule hands back the rule, subcategory on it');

  const plain = prepareRules([{ pattern: 'CORNER MART', category: 'Groceries', extra: [] }]);
  eq(plain, [{ p: 'corner mart', category: 'Groceries' }], 'a rule with no subcategory is prepared exactly as it always was');
  ok(!('subcategory' in plain[0]), 'with no subcategory key at all');

  eq(answerKey(null), '', 'no rule has no answer');
  eq(answerKey({ category: '' }), '', 'and a rule that says nothing answers nothing, as it did when the answer was a category');
  ok(answerKey({ category: 'Car', subcategory: 'Fuel' }) !== answerKey({ category: 'Car', subcategory: 'Services' }), 'same category, different subcategory: different answers');
  ok(answerKey({ category: 'Car', subcategory: 'Fuel' }) !== answerKey({ category: 'Car' }), 'a subcategory and none are different answers');
  eq(answerKey({ category: 'Car', subcategory: ' Fuel ' }), answerKey({ category: 'Car', subcategory: 'Fuel' }), 'spaces around a name are not a difference');
  eq(answerKey({ category: 'Car', subcategory: '' }), answerKey({ category: 'Car' }), 'a blank subcategory is none');
  ok(answerKey({ category: 'Car' }) !== answerKey({ category: 'Car\u0000x' }), 'the key cannot be forged by a name that contains the separator');
}

/* ---- 3. a rule's category and subcategory move together ------------------- */
{
  const r = { pattern: 'ENGEN', category: 'Car', subcategory: 'Fuel', extra: ['note'] };
  eq(setRuleCategory(r, 'Car'), false, 'the same category is not a change');
  eq(r.subcategory, 'Fuel', 'and leaves the subcategory alone');
  eq(setRuleCategory(r, 'Home'), true, 'a different category is a change');
  eq(r.category, 'Home', 'the category moved');
  ok(!('subcategory' in r), 'and the subcategory went with the old category — the key is gone, not blanked');
  eq(r.extra, ['note'], 'nothing else on the rule is touched');
  eq(setRuleCategory(r, 'Car', 'Fuel'), true, 'one action may set both');
  eq([r.category, r.subcategory], ['Car', 'Fuel'], 'both are set');
  eq(setRuleCategory(r, 'Car', 'Tolls'), false, 'same category, new subcategory: not a category change');
  eq(r.subcategory, 'Tolls', 'but the subcategory is set');
  setRuleCategory(r, 'Car', '');
  ok(!('subcategory' in r), 'an explicit blank removes it');
  const none = { pattern: 'x', category: 'Car' };
  setRuleCategory(none, '', 'Fuel');
  eq([none.category, 'subcategory' in none], ['', false], 'a subcategory offered with no category is dropped');
}

/* ---- 4. the tidy never merges rules that differ in subcategory ------------ */
{
  /* Patterns of eight characters or more: a shorter one matches on word
     boundaries only and rule-cleanup's cover test (ISSUE 71) will not let it
     answer for a longer rule, which would make these cases pass or fail for
     the wrong reason. */
  const DESCS = ['SHELL GARAGE ONE', 'SHELL GARAGE TWO', 'SHELL GARAGE SERVICE BAY', 'SHELL GARAGE SERVICE BAY'];
  const CLEAN = (rules, descs = DESCS) => analyseRules(rules, descs);
  const removed = rep => rep.remove.map(x => x.pattern);

  // The existing behaviour, with subcategories on both rules: same answer, so the longer one goes.
  {
    const rep = CLEAN([
      { pattern: 'shell garage', category: 'Car', subcategory: 'Fuel' },
      { pattern: 'shell garage one', category: 'Car', subcategory: 'Fuel' },
    ]);
    eq(removed(rep), ['shell garage one'], 'a shorter rule that already answers category AND subcategory still absorbs the longer one');
  }
  // Same category, different subcategory: the longer rule is not redundant.
  {
    const rep = CLEAN([
      { pattern: 'shell garage', category: 'Car', subcategory: 'Fuel' },
      { pattern: 'shell garage service bay', category: 'Car', subcategory: 'Services' },
    ]);
    eq(removed(rep), [], 'two rules for one category with different subcategories are not merged');
  }
  // Same category: a subcategory against none.
  {
    const rep = CLEAN([
      { pattern: 'shell garage', category: 'Car' },
      { pattern: 'shell garage service bay', category: 'Car', subcategory: 'Services' },
    ]);
    eq(removed(rep), [], 'a rule that adds a subcategory to the same category is kept');
    const rep2 = CLEAN([
      { pattern: 'shell garage', category: 'Car', subcategory: 'Fuel' },
      { pattern: 'shell garage service bay', category: 'Car' },
    ]);
    eq(removed(rep2), [], 'and so is one that takes the subcategory away');
  }
  // Without any subcategory the old verdict is unchanged.
  {
    const rep = CLEAN([{ pattern: 'shell garage', category: 'Car' }, { pattern: 'shell garage one', category: 'Car' }]);
    eq(removed(rep), ['shell garage one'], 'no subcategories anywhere: the same verdict as before');
  }
  // One pattern, one category, two subcategories: a conflict, never a duplicate.
  {
    const rules = [
      { pattern: 'shell garage service bay', category: 'Car', subcategory: 'Fuel' },
      { pattern: 'shell garage service bay', category: 'Car', subcategory: 'Services' },
    ];
    const rep = CLEAN(rules);
    eq(removed(rep), [], 'the later line is dead, but which one the household meant is theirs to say');
    eq(rep.conflicts.length, 1, 'the pair is reported as a conflict');
    eq(rep.conflicts[0].indices, [0, 1], 'by index');
    eq(rep.conflicts[0].categories, ['Car / Fuel', 'Car / Services'], 'named with the subcategory, so the two lines do not read as the same thing');
  }
  // True duplicates (same category and subcategory) still go.
  {
    const rep = CLEAN([
      { pattern: 'shell garage service bay', category: 'Car', subcategory: 'Services' },
      { pattern: 'SHELL GARAGE SERVICE BAY', category: 'Car', subcategory: 'Services' },
    ]);
    eq(rep.remove.map(x => x.index), [1], 'an exact duplicate, subcategory included, is still removed');
    eq(rep.conflicts, [], 'and is no conflict');
  }
  // A conflict of categories keeps its old label.
  {
    const rep = CLEAN([{ pattern: 'shell garage', category: 'Car' }, { pattern: 'shell garage', category: 'Fuel' }]);
    eq(rep.conflicts[0].categories, ['Car', 'Fuel'], 'a category-only conflict is labelled exactly as before');
  }
}

console.log(`PASS — rules-subcategory: a rule matches, changes and tidies with its subcategory (${checks} assertions).`);
