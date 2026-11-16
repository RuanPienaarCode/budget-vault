'use strict';
/* A headerless statement must not import its running balance as every amount.

   detectHeaderlessColumns only looked at the run of always-numeric columns at
   the RIGHT-hand end. With `date, amount, desc, balance` (or `date, desc,
   debit, credit, balance` with a sparse debit/credit pair) the only such column
   is the balance, so it became the Amount, iBalance stayed -1, and the review
   said the statement had no balance column — 1480 / 1450 / 1410 booked as
   income for -20 / -30 / -40, under a banner that blamed the missing column.

   The fix looks left of a lone trailing numeric column, but ONLY a reading the
   file's own balances verify (the same reconcileAmounts the two-number branch
   uses) is allowed to change anything. Pinned both ways: shapes that reconcile
   resolve to the real amounts, and the same shapes with balances that do not
   reconcile return exactly what they always returned. The layouts that were
   already handled must be byte-identical.

     node tests/import-headerless-balance-column.test.cjs */

const assert = require('assert');
const { mountReview } = require('./helpers/import-review-ctx.cjs');
const { parseStatement, detectHeaderlessColumns, detectStatementColumns } = require('../src/statement');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const rowsOf = lines => parseStatement(lines.join('\r\n'));

/* date, signed amount, description, running balance */
const AMOUNT_BEFORE_DESC = [
  '01/08/2026,"+1000.00","SALARY ACME","+1500.00"',
  '02/08/2026,"-20.00","WOOLWORTHS 1234 SYDNEY","+1480.00"',
  '03/08/2026,"-30.00","COLES 55 SYDNEY","+1450.00"',
  '04/08/2026,"-40.00","OPAL TRANSPORT","+1410.00"',
  '05/08/2026,"-50.00","TELSTRA","+1360.00"',
];
/* the same rows with balances that belong to some other statement */
const AMOUNT_BEFORE_DESC_BAD = AMOUNT_BEFORE_DESC.map((l, i) => l.replace(/"\+\d+\.00"$/, `"+${[1500, 1471, 1390, 1500, 1203][i]}.00"`));
/* date, description, debit, credit (each half empty), running balance */
const PAIR = [
  '08/01/2026,PAYROLL DEP,,1000.00,1500.00',
  '08/02/2026,TIM HORTONS,20.00,,1480.00',
  '08/03/2026,LOBLAWS,30.00,,1450.00',
  '08/04/2026,PRESTO,40.00,,1410.00',
];
const PAIR_BAD = PAIR.map((l, i) => l.replace(/,[\d.]+$/, `,${[1500, 1471, 1390, 1500][i]}.00`));

/* what these two shapes returned BEFORE the fix: the balance read as the amount */
const TODAY = (iDesc, iAmount) => ({ dataStart: 0, iDate: 0, iDesc, iAmount, iBalance: -1 });

/* ---- 1. amount, description, balance — reconciles ---- */
{
  const m = detectHeaderlessColumns(rowsOf(AMOUNT_BEFORE_DESC), true);
  eq(m, { dataStart: 0, iDate: 0, iDesc: 2, iAmount: 1, iBalance: 3 },
    'the amount is column 1 and the trailing column is the balance, not the amount');
  const full = detectStatementColumns(rowsOf(AMOUNT_BEFORE_DESC), true);
  eq([full.iAmount, full.iBalance, full.iDebit, full.iCredit], [1, 3, -1, -1], 'and the decision function agrees');
}

/* ---- 2. the same, balances do NOT reconcile — today's answer ---- */
{
  eq(detectHeaderlessColumns(rowsOf(AMOUNT_BEFORE_DESC_BAD), true), TODAY(2, 3),
    'balances that prove nothing license nothing: exactly what the function always returned');
}

/* ---- 3. debit / credit pair + balance — reconciles ---- */
{
  const m = detectHeaderlessColumns(rowsOf(PAIR), false);
  eq(m, { dataStart: 0, iDate: 0, iDesc: 1, iAmount: -1, iBalance: 4, iDebit: 2, iCredit: 3 },
    'the sparse pair is read as debit and credit, and the last column as the balance');
  const full = detectStatementColumns(rowsOf(PAIR), false);
  eq([full.iAmount, full.iDebit, full.iCredit, full.iBalance], [-1, 2, 3, 4],
    'detectStatementColumns keeps the pair — it used to overwrite iDebit/iCredit with -1');
  // orientation: money in is the column the balances say it is
  const swapped = PAIR.map(l => {
    const c = l.split(',');
    return [c[0], c[1], c[3], c[2], c[4]].join(',');
  });
  const s = detectHeaderlessColumns(rowsOf(swapped), false);
  eq([s.iDebit, s.iCredit], [3, 2], 'the pair is oriented by the balances, not by column order');
}

/* ---- 4. pair, balances do NOT reconcile — today's answer ---- */
{
  eq(detectHeaderlessColumns(rowsOf(PAIR_BAD), false), TODAY(1, 4),
    'an unproven pair is returned exactly as before');
}

/* ---- 5. layouts that were already handled are untouched ---- */
{
  const three = [
    '01/08/2026,ACME STORE,-20.00', '02/08/2026,COLES,-30.00', '03/08/2026,OPAL,-40.00',
    '04/08/2026,TELSTRA,-50.00', '05/08/2026,SALARY,900.00',
  ];
  eq(detectHeaderlessColumns(rowsOf(three), true), TODAY(1, 2), 'date, desc, amount is unchanged');
  const four = [
    '01/08/2026,SALARY ACME,1000.00,1500.00', '02/08/2026,WOOLWORTHS,-20.00,1480.00',
    '03/08/2026,COLES,-30.00,1450.00', '04/08/2026,OPAL TRANSPORT,-40.00,1410.00', '05/08/2026,TELSTRA,-50.00,1360.00',
  ];
  eq(detectHeaderlessColumns(rowsOf(four), true), { dataStart: 0, iDate: 0, iDesc: 1, iAmount: 2, iBalance: 3 },
    'date, desc, amount, balance is unchanged');
  const card = [
    '24-01-2026, 24-01-2026,SERVICE FEE,-20.00', '24-01-2026, 24-01-2026,VAT ON FEE,-3.00',
    '10-02-2026, 11-02-2026,PAYMENT - THANK YOU,500.00', '16-02-2026, 16-02-2026,CREDIT INTEREST,2.31',
    '17-02-2026, 17-02-2026,SOME SHOP,-9.99',
  ];
  eq(detectHeaderlessColumns(rowsOf(card), true), TODAY(2, 3), 'the two-date-column card shape is unchanged');
  eq(detectHeaderlessColumns(rowsOf(['01/08/2026,A,hello', '02/08/2026,B,there']), true), null,
    'no numeric column at all is still null');
}

/* ---- 6. an unrelated always-numeric column does not hijack the amount ---- */
{
  // A cheque-number column beside a real amount: both are numeric on every row,
  // but only the real one reconciles, and only one reconciling reading is taken.
  const lines = [
    '01/08/2026,"+1000.00",101,"SALARY ACME","+1500.00"',
    '02/08/2026,"-20.00",102,"WOOLWORTHS","+1480.00"',
    '03/08/2026,"-30.00",103,"COLES","+1450.00"',
    '04/08/2026,"-40.00",104,"OPAL","+1410.00"',
    '05/08/2026,"-50.00",105,"TELSTRA","+1360.00"',
  ];
  const m = detectHeaderlessColumns(rowsOf(lines), true);
  eq([m.iAmount, m.iBalance, m.iDesc], [1, 4, 3], 'the column that reconciles is the amount; the reference number is ignored');
}

/* ---- 7. through the review screen ---- */
(async () => {
  const ACC = { name: 'Everyday', tx_label: 'Everyday', type: 'checking', in_budget: true };
  {
    const v = mountReview({ accounts: [ACC] });
    const p = await v.load(AMOUNT_BEFORE_DESC.join('\r\n'), 'account-statement.csv');
    p.label = 'Everyday'; v.ctx.renderImportReview();
    eq(p.items.map(i => i.amount), [1000, -20, -30, -40, -50], 'the review holds the real amounts, not the balances');
    ok(p.iBalance === 3 && p.reconcile && p.reconcile.verified && !p.reconcile.unchecked, 'a verdict exists and it is verified');
    eq(v.banner(), 'Amounts check out against this statement’s own balance column.', 'the banner is the verified one');
  }
  {
    const v = mountReview({ accounts: [ACC], dayFirst: false });
    const p = await v.load(PAIR.join('\n'), 'account-statement.csv');
    p.label = 'Everyday'; v.ctx.renderImportReview();
    eq(p.items.map(i => i.amount), [1000, -20, -30, -40], 'a debit/credit pair imports signed amounts');
    ok(p.reconcile && p.reconcile.verified && !p.reconcile.inverted && !p.reconcile.unchecked, 'verified, not inverted');
    eq(v.banner(), 'Amounts check out against this statement’s own balance column.', 'verified banner on the pair too');
  }
  {
    // Unproven: today's behaviour, including the banner that says what it cannot check
    const v = mountReview({ accounts: [ACC] });
    const p = await v.load(AMOUNT_BEFORE_DESC_BAD.join('\r\n'), 'account-statement.csv');
    p.label = 'Everyday'; v.ctx.renderImportReview();
    ok(p.iBalance === -1 && p.reconcile && p.reconcile.unchecked, 'unproven shape: unchanged (no balance column, unchecked)');
  }
  console.log(`PASS import-headerless-balance-column — a balance column left of nothing is read as the balance only when it reconciles (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
