'use strict';
/* An amount written with more than two decimals keeps them.

   Every money writer rewrote a plain decimal as toFixed(2). That is right for a
   figure the app computed and harmless for `100` → `100.00`, but a cell that
   holds MORE precision than two decimals lost it on the next write of its file
   — an edit to any OTHER row: a fuel slip at `-912.345` became `-912.35`
   (2026-10-07 round-trip audit, L3-17), and a Debts.md rate of `11.125` — the
   shape a real prime-linked rate takes — became `11.13`.

   The rule now: when rewriting a cell at two decimals would CHANGE the figure,
   the cell keeps its own text (`<key>Text`) and the save writes that text back
   while the field still holds the number it produced. Anything the app sets —
   an edit, an import, a computed figure — is written at two decimals exactly as
   before, and so is every cell two decimals can already hold: `-35` still
   becomes `-35.00`, so no file on disk changes bytes because of this.

   A separate key rather than `<key>Raw`: a raw has always meant "the reader
   typed something this column could not hold" (an unreadable cell, a floored
   negative), and a readable number with an extra digit is neither.

   Synthetic. Real loader, real serializers.
     node tests/amount-decimals-kept.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { SCHEMAS, rowToObject, rowLine } = require('../src/table-schema');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nlanguage: en\n---\n';
const cellAt = (schema, row, i) => rowLine(schema, row).slice(2, -2).split(' | ')[i];

/* ---- 1. every money column of every table, at the schema ---- */
{
  const FULL = {
    assets: ['Flat', 'property', '900000.00', '2026-03-01', '', ''],
    owed: ['Sam', '250.00', 'lunch', '', 'outstanding', '0.00', '', ''],
    services: ['Gym', 'GymCo', '450.00', 'monthly', '', '', 'yes', '', ''],
    debts: ['Card', 'Bank', 'credit card', '1200.00', '3000.00', '21.00', '150.00', '0.00', '2024-01-01', '', 'active', '', ''],
    transactions: ['2026-09-01', 'Fuel', 'Car', '-1.00', '', '', ''],
  };
  for (const [name, cells] of Object.entries(FULL)) {
    const schema = SCHEMAS[name];
    schema.columns.forEach((col, i) => {
      if (col.align !== 'right') return;
      const typed = name === 'transactions' ? '-912.345' : '11.125';
      const row = rowToObject(schema, Object.assign([...cells], { [i]: typed }));
      eq(row[col.key], Number(typed), `${name}.${col.key}: "${typed}" is read at full precision`);
      eq(cellAt(schema, row, i), typed, `${name}.${col.key}: …and written back with every decimal it had`);
      row[col.key] = 12.5;
      eq(cellAt(schema, row, i), '12.50', `${name}.${col.key}: a figure the app sets is written at two decimals`);
      for (const [plain, canon] of [['100', '100.00'], ['7.5', '7.50'], ['42.10', '42.10'], ['3.100', '3.10']]) {
        const r = rowToObject(schema, Object.assign([...cells], { [i]: plain }));
        eq(cellAt(schema, r, i), canon, `${name}.${col.key}: "${plain}" two decimals can hold is still rewritten "${canon}", as always`);
        eq(r[col.key + 'Text'], undefined, `${name}.${col.key}: …and keeps no text`);
      }
    });
  }
}

(async () => {
  /* ---- 2. a transaction month: the edit is to a DIFFERENT row ---- */
  {
    const TX = '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n'
      + '|------|-------------|----------|-------:|----------|------|\n| 2026-09-01 | Fuel 41.3 l | Car | -912.345 |  |  |\n'
      + '| 2026-09-02 | Coffee | Food | -35.00 |  |  |\n';
    const ctx = makeCtx({
      [`${B}/Settings.md`]: SETTINGS,
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\n---\n',
      [`${B}/Transactions/Cheque/2026-09.md`]: TX,
    });
    const S = await loadInto(ctx);
    require('../src/views/transactions')(ctx);
    const f = S.txFiles['Cheque/2026-09'];
    eq(f.rows[0].amount, -912.345, 'the fuel slip is read at full precision');
    f.rows[1].note = 'edited';
    const out = ctx.serializeTxFile(f);
    ok(out.includes('| 2026-09-01 | Fuel 41.3 l | Car | -912.345 |  |  |'), 'an edit to the coffee row leaves the fuel slip at -912.345');
    ok(out.includes('| 2026-09-02 | Coffee | Food | -35.00 |  | edited |'), '…and the edit took');
  }

  /* ---- 3. a budget file ---- */
  const RANGE = 'With `month_start_day: 1`, this period is the calendar month — the 1st to the last day of the month.';
  const BUDGET = ['---', 'period: 2026-10', '---', '', '# Budget — 2026-10', '', RANGE, '',
    '| Category | Type | Amount | Notes |', '|----------|------|-------:|-------|',
    '| Salary | income | 30000.00 |  |', '| Fuel | expense | 1234.567 |  |', ''].join('\n');
  const unpin = pinClock('2026-10-07');
  try {
    const M = await mountFor({
      [`${B}/Settings.md`]: SETTINGS,
      [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#888888"\n---\n',
      [`${B}/Categories/Fuel.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
      [`${B}/Budgets/2026-10.md`]: BUDGET,
    }, { period: '2026-10' });
    eq(M.S.budgets['2026-10'][1].amount, 1234.567, 'the budget row is read at full precision');
    await M.ctx.saveBudget();
    eq(M.ctx.vault._store.get(`${B}/Budgets/2026-10.md`), BUDGET, 'a no-change Budget Save keeps 1234.567');
    M.S.budgets['2026-10'][0].notes = 'after tax';
    M.ctx.invalidateBudgetDraft();
    await M.ctx.saveBudget();
    ok(M.ctx.vault._store.get(`${B}/Budgets/2026-10.md`).includes('| Fuel | expense | 1234.567 |  |'),
      'so does a Save after an edit to the other row');
  } finally { unpin(); }

  /* ---- 4. Debts.md: the rate a prime-linked loan really carries ---- */
  {
    const DEBTS = ['---', 'kind: debts', '---', '', '# Debts', '',
      'Money the household owes. `rate` is the annual interest rate as a percentage,',
      '`payment` the contracted monthly amount and `extra` anything paid on top of it.',
      '`status` is `active` or `paid`.', '',
      '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |',
      '|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|',
      '| Bond | Home Bank | home loan | 850000.00 | 1000000.00 | 11.125 | 9500.00 | 0.00 | 2020-01-01 |  | active |  |', ''].join('\n');
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Debts.md`]: DEBTS });
    const S = await loadInto(ctx);
    require('../src/views/debts')(ctx);
    eq(S.debts[0].rate, 11.125, 'the payoff maths gets the rate the contract states');
    eq(ctx.serializeDebts(), DEBTS, 'and a no-change save keeps 11.125, not 11.13');
  }

  console.log(`PASS amount-decimals-kept (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
