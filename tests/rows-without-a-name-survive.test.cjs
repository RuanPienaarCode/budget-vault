'use strict';
/* A row whose FIRST cell is blank is still the household's row, and a save must
   write it back.

   "Someone owes us R500 for the flat deposit — name to follow" and "R750 for
   the school trip, category to be decided" are exactly the rows a household
   types by hand: the figure is known before the name is. The loader skipped
   every such row (`if (!c[0]) continue;` on all four flat tables) and the
   Budget page's persistedRows() filtered them out (`d.category && …`), so the
   next save of the page — for an edit to any OTHER row — deleted them, amount,
   note and all (2026-10-07 round-trip audit, L3-12).

   Two different readings, because the two kinds of file are read differently:

   - Owed / Debts / Assets / Services rows are read by row, never keyed by
     name (no consumer builds a name-keyed map or matches on a name; a
     service's merchant tokens drop short and empty words), so a nameless row
     is loaded as an ordinary row with an empty name: it is listed, it counts,
     and it is written back where it was. The money is real whether or not the
     name has been typed yet.
   - A budget row with no category is NOT given to the figures. Every budget
     reader keys rows by category, and the blank category is where
     uncategorised spend lives (ledger.js byCat['']): a nameless row there
     would take the period's uncategorised spending as its own Actual, and two
     of them would collide into one. So it is kept beside the period's rows
     (S.budgetMeta), written back in its own place on every save, and the
     Budget page says plainly that it is in the file and counted nowhere until
     it has a category.

   A row with nothing in any cell is still not a row (parseMdTable already reads
   one as a separator line), and is not kept.

   Synthetic household. Real loader, real serializers, real Budget page.
     node tests/rows-without-a-name-survive.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { find, textOf } = require('./helpers/dash-audit.cjs');
const { worth } = require('../src/worth');
const { owedSummary } = require('../src/owed-math');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nlanguage: en\n---\n';

const OWED = ['---', 'kind: owed', '---', '', '# Owed Money', '',
  'Money owed to the household. `status` is `outstanding` or `paid`.',
  '`Repaid` is how much has come back; `Lent` is when it went out.', '',
  '| Person | Amount | Description | Due date | Status | Repaid | Lent |',
  '|--------|-------:|-------------|----------|--------|-------:|------|',
  '| Sam | 250.00 | lunch | 2026-10-31 | outstanding | 0.00 | 2026-09-01 |',
  '|  | 500.00 | deposit for the flat, name to follow |  | outstanding | 0.00 | 2026-09-15 |', ''].join('\n');

const ASSETS = ['---', 'kind: assets', '---', '', '# Assets', '',
  'What the household owns that is not an account — property, vehicles, contents,',
  'jewellery, metals. `Value` is what it would sell for today and `Valued` is when',
  'that was last worked out. Money owed against any of these lives on the Debt page.', '',
  '| Item | Kind | Value | Valued | Notes |', '|------|------|------:|--------|-------|',
  '| Car | vehicle | 90000.00 | 2026-03-01 |  |',
  '|  | other | 12000.00 | 2026-03-01 | inherited, still to list |', ''].join('\n');

const DEBTS = ['---', 'kind: debts', '---', '', '# Debts', '',
  'Money the household owes. `rate` is the annual interest rate as a percentage,',
  '`payment` the contracted monthly amount and `extra` anything paid on top of it.',
  '`status` is `active` or `paid`.', '',
  '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |',
  '|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|',
  '|  | Shop Bank | credit card | 1200.00 | 3000.00 | 21.00 | 150.00 | 0.00 | 2024-01-01 |  | active | which card? |', ''].join('\n');

const SERVICES = ['---', 'kind: services', '---', '', '# Services & Subscriptions', '',
  'Recurring services and subscriptions. `cycle` is one of: weekly, fortnightly, monthly, annual.', '',
  '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |',
  '|------|----------|-------:|-------|--------------|----------|--------|-------|',
  '|  | GymCo | 450.00 | monthly | 2026-10-01 | Food | yes | new contract |', ''].join('\n');

const RANGE = 'With `month_start_day: 1`, this period is the calendar month — the 1st to the last day of the month.';
const budget = rows => ['---', 'period: 2026-10', '---', '', '# Budget — 2026-10', '', RANGE, '',
  '| Category | Type | Amount | Notes |', '|----------|------|-------:|-------|', ...rows, ''].join('\n');
const BUDGET = budget(['| Salary | income | 30000.00 |  |', '| Food | expense | 4000.00 |  |',
  '|  | expense | 750.00 | school trip, category TBC |']);

const FILES = {
  [`${B}/Settings.md`]: SETTINGS,
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 100.00\nbalance_updated: 2026-10-06\n---\n',
  /* An uncategorised outgoing in the same period — the money a nameless
     budget row would wrongly claim as its own Actual if it reached the figures. */
  [`${B}/Transactions/Cheque/2026-10.md`]: '---\naccount: "Cheque"\nmonth: 2026-10\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n'
    + '| 2026-10-02 | Card purchase |  | -300.00 |  |  |\n| 2026-10-03 | Shop | Food | -1000.00 |  |  |\n',
  [`${B}/Budgets/2026-10.md`]: BUDGET,
};

async function flat(kind, path, text, view, ser) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/${path}`]: text });
  const S = await loadInto(ctx);
  require(`../src/views/${view}`)(ctx);
  return { S, rows: S[kind], save: () => ctx[ser]() };
}

(async () => {
  /* ---- 1. the four flat tables: listed, counted, written back ---- */
  {
    const o = await flat('owed', 'Owed Money.md', OWED, 'owed', 'serializeOwed');
    eq(o.rows.map(r => r.person), ['Sam', ''], 'Owed: the row with no Person is loaded, not skipped');
    eq(o.rows[1].amount, 500, '…with its amount');
    eq(owedSummary(o.S.owed, '2026-10-07', 'R').outstanding, 750,
      '…and the R500 is counted as owed — the money is real before the name is typed');
    eq(o.save(), OWED, 'Owed: a no-change save keeps the row, byte for byte, in its place');

    const a = await flat('assets', 'Assets.md', ASSETS, 'assets', 'serializeAssets');
    eq(a.rows.map(r => r.name), ['Car', ''], 'Assets: the nameless row is loaded');
    eq(worth([], [], a.S.assets, 'R', []).net, 102000, '…and counts in net worth');
    eq(a.save(), ASSETS, 'Assets: a no-change save keeps it');

    const d = await flat('debts', 'Debts.md', DEBTS, 'debts', 'serializeDebts');
    eq(d.rows.map(r => [r.name, r.balance]), [['', 1200]], 'Debts: the nameless debt is loaded with its balance');
    eq(d.save(), DEBTS, 'Debts: a no-change save keeps it');

    const s = await flat('services', 'Services.md', SERVICES, 'services', 'serializeServices');
    eq(s.rows.map(r => [r.name, r.provider]), [['', 'GymCo']], 'Services: the nameless service is loaded');
    eq(s.save(), SERVICES, 'Services: a no-change save keeps it');

    /* An edit to ANOTHER row is the save the audit found deleting it. */
    o.S.owed[0].description = 'lunch and coffee';
    const edited = o.save();
    ok(edited.includes('|  | 500.00 | deposit for the flat, name to follow |  | outstanding | 0.00 | 2026-09-15 |'),
      'Owed: an edit to another row does not take the nameless row with it');
    ok(edited.includes('lunch and coffee'), '…and the edit itself took');
  }

  /* ---- 2. a budget row with no category ---- */
  const unpin = pinClock('2026-10-07');
  try {
    const M = await mountFor(FILES, { period: '2026-10' });
    const { ctx, S } = M;
    eq(S.budgets['2026-10'].map(r => r.category), ['Salary', 'Food'],
      'the nameless budget row is not one of the period\'s category rows — every budget reader keys rows by category');
    eq(ctx.planFigures('2026-10').total, 4000,
      'so the plan counts only the rows that have a category — R750 is not quietly added to any total');
    eq(ctx.budgetVsActualRows('2026-10').filter(r => !r.cat).length, 0,
      'and no row with a blank category exists to take the uncategorised R300 as its Actual');

    /* The page says what it is not counting. */
    ctx.renderBudgets();
    const note = find(M.nodes.get('#budTable'), n => n.attrs && n.attrs['data-fig'] === 'bud-unnamed')[0];
    ok(note, 'the Budget page names the row it is not counting');
    const expected = i18n.t('bud.unnamed.note', { count: 1, amount: ctx.money(750) });
    ok(expected !== 'bud.unnamed.note' && /no category/.test(expected), `the disclosure has words of its own: ${expected}`);
    eq(textOf(note), expected, 'and they carry the count and the amount');

    /* A no-change save writes it back in its own place. */
    ctx.invalidateBudgetDraft();
    await ctx.saveBudget();
    const out = ctx.vault._store.get(`${B}/Budgets/2026-10.md`);
    eq(out, BUDGET, 'a no-change Budget Save gives the file back byte for byte, nameless row included');

    /* An edit to another row keeps it too — and keeps it where it was. */
    S.budgets['2026-10'][1].amount = 4500;
    ctx.invalidateBudgetDraft();
    await ctx.saveBudget();
    eq(ctx.vault._store.get(`${B}/Budgets/2026-10.md`), budget(['| Salary | income | 30000.00 |  |',
      '| Food | expense | 4500.00 |  |', '|  | expense | 750.00 | school trip, category TBC |']),
    'after an edit to Food the nameless row is still there, still last, still R750');
  } finally { unpin(); }

  console.log(`PASS rows-without-a-name-survive (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
