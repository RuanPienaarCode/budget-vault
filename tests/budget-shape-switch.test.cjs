'use strict';
/* What a vault looks like just after someone changes the period length.

   Budgets saved under the other period-name shape are not deleted and not
   lost — they simply can't be addressed while the current length is active.
   Nothing in the app said so, which is how a switch reads as "my budget was
   wiped": every category reappears from S.categories, but every amount is
   zero, and the files holding the old amounts are invisible.

   Two promises are pinned here, because both are the kind that quietly stop
   being true. First, that the app can still SEE the other budgets, so it can
   say where they went. Second, that carrying structure across never carries an
   amount — halving a monthly figure is right for groceries and wrong for rent,
   and nothing on screen would say which line had been guessed at.

   Runs in bare node. Wired into ./build.sh.
     node tests/budget-shape-switch.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The budgets view needs only S and the period helpers for the two functions
   under test — neither touches the DOM, which is why they were split out. */
function budgetsCtx(period_days, period_anchor, budgets) {
  const ctx = makeCtx({}, { settings: { month_start_day: 23, period_days, period_anchor } });
  ctx.S.txFiles = {};
  ctx.S.budgets = budgets;
  ctx.S.categories = [];
  ctx.registerDirty = () => {};
  require('../src/period')(ctx);
  require('../src/views/budgets')(ctx);
  return ctx;
}

const MONTHLY_BUDGET = [
  { category: 'Groceries', type: 'expense', amount: 5000, amountRaw: null, notes: 'weekly shop' },
  { category: 'Rent', type: 'expense', amount: 12000, amountRaw: null, notes: '' },
  { category: 'Salary', type: 'income', amount: 40000, amountRaw: null, notes: '' },
];

/* ---- the app can still see budgets it cannot currently address ---- */
{
  const onCycle = budgetsCtx(14, '2026-08-07', {
    '2026-07': MONTHLY_BUDGET, '2026-08': MONTHLY_BUDGET, '2026-08-07': [],
  });
  eq(onCycle.otherShapeBudgets(), ['2026-07', '2026-08'],
    'on a pay cycle, the month-named budgets are the ones that need explaining');

  const onMonths = budgetsCtx(0, '', {
    '2026-08': MONTHLY_BUDGET, '2026-07-24': MONTHLY_BUDGET, '2026-08-07': MONTHLY_BUDGET,
  });
  eq(onMonths.otherShapeBudgets(), ['2026-07-24', '2026-08-07'],
    'and back on payday months, the date-named ones are');

  eq(onMonths.otherShapeBudgets()[onMonths.otherShapeBudgets().length - 1], '2026-08-07',
    'sorted, so the newest is the one offered — a lexical sort is chronological for both shapes');

  // An empty budget file explains nothing and must not trigger the note.
  eq(budgetsCtx(14, '2026-08-07', { '2026-08': [] }).otherShapeBudgets(), [],
    'an empty budget on the other side is not worth a banner');
  eq(budgetsCtx(0, '', { '2026-08': MONTHLY_BUDGET }).otherShapeBudgets(), [],
    'and neither is a vault that has never switched');

  /* A switch between two CYCLE lengths strands files too, and this was the
     silent case: 7 → 14 leaves every second weekly budget sitting between the
     new boundaries. They are date-named either way, so a shape check called
     them addressable and the page said nothing at all. */
  const shortened = budgetsCtx(14, '2026-08-07', {
    '2026-07-24': MONTHLY_BUDGET, '2026-07-31': MONTHLY_BUDGET,
    '2026-08-07': [], '2026-08-14': MONTHLY_BUDGET,
  });
  eq(shortened.otherShapeBudgets(), ['2026-07-31', '2026-08-14'],
    'weekly budgets left off-phase by a switch to 14 days are named as stranded');
  eq(budgetsCtx(7, '2026-08-07', {
    '2026-07-24': MONTHLY_BUDGET, '2026-08-14': MONTHLY_BUDGET,
  }).otherShapeBudgets(), [],
  'while going the other way strands nothing — every fortnightly start is also a weekly one');
}

/* ---- the settings tab counts the same files the Budgets page names ---- */
{
  /* noticeBudgetsKept used to return early whenever both lengths were cycles,
     on the reasoning that date-named files stay addressable. That only holds
     when the new length divides the old, so it went silent through exactly the
     7 → 14 case above. Counted here off the same phase rule period.js
     validates against — if the two ever disagreed, the notice would promise a
     file was reachable that the app then refused to open. */
  const { BudgetSettingTab } = require('../src/settings-tab');

  function tabWith(budgetBasenames, period_anchor = '2026-08-07') {
    const tab = Object.create(BudgetSettingTab.prototype);
    tab.plugin = { settings: { budgetFolder: 'Budget' }, settingsMdPath: () => 'Budget/Settings.md' };
    tab.app = {
      vault: {
        getMarkdownFiles: () => budgetBasenames.map(b => new (require('./helpers/harness.cjs').TFile)(`Budget/Budgets/${b}.md`)),
        getAbstractFileByPath: () => null,
      },
      metadataCache: { getFileCache: () => null },
    };
    tab.mdSettings = () => ({ period_anchor });
    return tab;
  }

  const mixed = tabWith(['2026-07', '2026-08', '2026-07-24', '2026-07-31', '2026-08-07', '2026-08-14']);
  eq(mixed.strandedBudgetCount(0, 14), 2, 'monthly → cycle strands the month-named files');
  eq(mixed.strandedBudgetCount(14, 0), 4, 'cycle → monthly strands the date-named ones');
  eq(mixed.strandedBudgetCount(7, 14), 2,
    '7 → 14 strands the two off-phase weeks — the case that used to pass in silence');
  eq(mixed.strandedBudgetCount(14, 7), 0, 'and 14 → 7 strands nothing, so it still says nothing');
  eq(mixed.strandedBudgetCount(0, 0), 0, 'a no-op change says nothing');

  eq(tabWith(['2026-07', '2026-08']).strandedBudgetCount(7, 14), 0,
    'month-named files are not counted against a cycle → cycle switch — they were already out of reach');
  eq(tabWith(['2026-08-07'], 'not-a-date').strandedBudgetCount(7, 14), 0,
    'and with no usable anchor there is no phase to measure, so it stays quiet rather than guessing');
}

/* ---- carrying structure never carries an amount ---- */
{
  const { carryStructure } = budgetsCtx(14, '2026-08-07', {});

  const draft = [];
  const brought = carryStructure(MONTHLY_BUDGET, draft);
  eq(brought, 3, 'every category comes across');
  eq(draft.map(d => d.category).sort(), ['Groceries', 'Rent', 'Salary'], 'by name');
  eq(draft.map(d => d.type).sort(), ['expense', 'expense', 'income'], 'carrying their type');
  eq(draft.map(d => d.amount), [0, 0, 0],
    'and NOT their amounts — this is the whole promise, and R12,000 of rent is the reason');
  eq(draft.map(d => d.amountRaw), [null, null, null], 'no raw amount smuggles a figure across either');
  eq(draft.find(d => d.category === 'Groceries').notes, 'weekly shop', 'notes DO come across — they cost nothing to re-read');

  // A value already set for THIS period is never overwritten.
  const held = [{ category: 'Groceries', type: 'expense', amount: 2500, amountRaw: null, notes: 'set for this fortnight', inFile: true }];
  eq(carryStructure(MONTHLY_BUDGET, held), 2, 'only the categories not already present come across');
  eq(held.find(d => d.category === 'Groceries').amount, 2500, 'an amount set for this period survives');
  eq(held.find(d => d.category === 'Groceries').notes, 'set for this fortnight', 'as does its note');

  // Running it twice must be a no-op, not a duplicator.
  const twice = [];
  carryStructure(MONTHLY_BUDGET, twice);
  eq(carryStructure(MONTHLY_BUDGET, twice), 0, 'a second pass brings nothing over');
  eq(twice.length, 3, 'and adds no duplicate rows');
}

console.log(`PASS — period-length switch: other-shape budgets visible, amounts never carried (${checks} assertions).`);
