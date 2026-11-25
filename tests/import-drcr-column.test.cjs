'use strict';
/* An Amount column beside a Dr/Cr marker column is read BY the marker
   (2026-11-25 audit, IMP-1).

   A statement whose amounts are all positive, with a separate column saying
   which way each one went (`Dr/Cr`, `Debit/Credit`, `Type` holding D/C...),
   had the marker ignored. With a balance column, reconcileAmounts then found
   that "every amount negated" agreed on five pairs out of six — inside its 80%
   slack — and flipped EVERY row, so the salary imported as R25 000 of spending
   under "Checked against its balance column and corrected". Without a balance
   column every purchase imported as income.

   Pinned here, through the real view:
     0. the pure pieces: which headings name a marker column, which cells are
        markers, and that a column holding anything else is not one;
     1. the audit's file: the marker decides each row, the balances agree, the
        salary is income, and the review says the signs came from the marker;
     2. the same file with NO balance column: the same signs, said as unchecked;
     3. a marker column the balances contradict on EVERY row: the balance
        column wins, and the review says the two disagree rather than "corrected";
     4. a marker the balances contradict on ONE row: that row is left as the
        marker says, unticked, with the reason beside it;
     5. a whole-file flip (no marker) is not allowed to flip a row whose own
        balance step says it was right as read: left as read, unticked, reasoned;
     6. a credit card with a marker column reads purchases as money out;
     7. header, footer, opening-balance and repeated-header lines leave the
        marker column recognised and the rows as they should be;
     8. the column mapper offers the marker as a field, prefilled on "Columns
        wrong?", and a hand-mapped marker is applied.

   Everything is synthetic.

     node tests/import-drcr-column.test.cjs */

const assert = require('assert');
const { mountReview } = require('./helpers/import-review-ctx.cjs');
const { detectStatementColumns, parseStatement, drCrOf, balanceStepVerdicts } = require('../src/statement');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const GREEN = 'Amounts check out against this statement’s own balance column.';
const ACCOUNTS = [
  { name: 'Cheque', tx_label: 'Cheque', type: 'checking', in_budget: true },
  { name: 'Card', tx_label: 'Card', type: 'credit_card', in_budget: true },
];

/* The audit's reproduction, verbatim. */
const AUDIT = [
  'Date,Description,Amount,Dr/Cr,Balance',
  '2026/11/01,SHOP A,100.00,Dr,4900.00',
  '2026/11/02,SHOP B,200.00,Dr,4700.00',
  '2026/11/03,SHOP C,300.00,Dr,4400.00',
  '2026/11/04,SALARY ACME,25000.00,Cr,29400.00',
  '2026/11/05,SHOP D,400.00,Dr,29000.00',
  '2026/11/06,SHOP E,500.00,Dr,28500.00',
  '2026/11/07,SHOP F,50.00,Dr,28450.00',
].join('\n');
const TRUTH = [-100, -200, -300, 25000, -400, -500, -50];
const dropCol = (csv, i) => csv.split('\n').map(l => l.split(',').filter((_, k) => k !== i).join(',')).join('\n');

async function read(csv, label = 'Cheque') {
  const v = mountReview({ accounts: ACCOUNTS });
  const p = await v.load(csv, 'statement.csv');
  if (label) { p.label = label; v.ctx.renderImportReview(); }
  return { v, p, amounts: p.items.map(i => i.amount), banner: v.banner(),
    warn: v.els['#impReconcile'].classList.contains('imp-reconcile-warn') };
}

(async () => {
  /* ---- 0. the pure pieces -------------------------------------------------- */
  {
    eq(['Dr', 'DR', 'dr.', 'D', 'Debit', 'debiet', 'Soll', 'Débit', 'Cr', 'CR', 'c', 'Credit', 'Krediet', 'Haben', 'Crédito', '', 'POS', 'Card', 'X']
      .map(drCrOf),
      ['debit', 'debit', 'debit', 'debit', 'debit', 'debit', 'debit', 'debit', 'credit', 'credit', 'credit', 'credit', 'credit', 'credit', 'credit', null, null, null, null],
      'what each cell says about its row');
    const map = csv => detectStatementColumns(parseStatement(csv), true);
    eq(map(AUDIT).iDrCr, 3, 'a "Dr/Cr" heading over Dr/Cr cells is the marker column');
    eq(map(AUDIT.replace('Dr/Cr', 'Debit/Credit')).iDrCr, 3, '"Debit/Credit" too');
    const dc = map(AUDIT.replace('Dr/Cr', 'Debit/Credit'));
    ok(dc.iDebit === -1 && dc.iCredit === -1 && dc.iAmount === 2,
      `and "Debit/Credit" is not ALSO read as a debit/credit pair: ${JSON.stringify(dc)}`);
    eq(map(AUDIT.replace('Dr/Cr', 'DR / CR')).iDrCr, 3, '"DR / CR", spaced');
    eq(map(AUDIT.replace('Dr/Cr', 'Type').replace(/,Dr,/g, ',D,').replace(/,Cr,/g, ',C,')).iDrCr, 3, 'a "Type" column holding D / C');
    eq(map(AUDIT.replace('Dr/Cr', 'Debiet/Krediet').replace(/,Dr,/g, ',Debiet,').replace(/,Cr,/g, ',Krediet,')).iDrCr, 3,
      'Afrikaans heading and markers');
    eq(map(AUDIT.replace('Dr/Cr', 'Type').replace(/,Dr,/g, ',POS Purchase,').replace(/,Cr,/g, ',EFT,')).iDrCr, -1,
      'a "Type" column holding transaction kinds is NOT a marker column');
    eq(map(AUDIT.replace('Dr/Cr', 'Type').replace(',Cr,', ',EFT,')).iDrCr, -1, 'one cell that is no marker disqualifies the column');
    eq(map(dropCol(AUDIT, 3)).iDrCr, -1, 'no marker column: -1');
    const bsv = balanceStepVerdicts([{ amount: 5, balance: 105 }, { amount: 10, balance: 115 }, { amount: 7, balance: 100 }],
      { order: 'fwd', flip: false });
    eq(bsv, [null, true, false], 'per-row balance steps: the oldest row has no step, the rest agree or disagree');
  }

  /* ---- 1. the audit's file -------------------------------------------------- */
  {
    const r = await read(AUDIT);
    eq(r.amounts, TRUTH, 'the marker decides each row: Dr is money out, Cr is money in');
    ok(r.p.reconcile.verified && !r.p.reconcile.flipped, 'and the balance column agrees, with nothing flipped');
    ok(r.p.items.every(i => i.include), 'every row is ticked');
    ok(r.banner.startsWith(GREEN), `the green sentence leads: ${r.banner}`);
    ok(/“Dr\/Cr” column/.test(r.banner), `and says where the signs came from: ${r.banner}`);
    ok(!/corrected/.test(r.banner), 'never "corrected"');
  }

  /* ---- 2. no balance column ------------------------------------------------ */
  {
    const r = await read(dropCol(AUDIT, 4));
    eq(r.amounts, TRUTH, 'without a balance column the marker still decides');
    ok(r.p.reconcile.unchecked && !r.p.reconcile.oneSign, 'unchecked, and not the "every amount has the same sign" warning');
    ok(/no balance column/.test(r.banner) && /“Dr\/Cr” column/.test(r.banner), `said as unchecked, signs from the marker: ${r.banner}`);
  }

  /* ---- 3. the balances contradict the marker on every row ------------------ */
  {
    const swapped = AUDIT.replace(/,Dr,/g, ',XX,').replace(/,Cr,/g, ',Dr,').replace(/,XX,/g, ',Cr,');
    const r = await read(swapped);
    eq(r.amounts, TRUTH, 'the balance column wins over a marker column it contradicts everywhere');
    ok(r.p.reconcile.flipped, 'as a flip');
    ok(r.warn, 'with the warning styling');
    ok(/disagree/.test(r.banner) && /“Dr\/Cr”/.test(r.banner) && /balance column was followed/.test(r.banner),
      `and the review says the two disagree and which was followed: ${r.banner}`);
    ok(!/lists money out as positive/.test(r.banner), 'not the "lists money out as positive" sentence, which would be untrue here');
  }

  /* ---- 4. the balances contradict the marker on ONE row --------------------- */
  {
    const oneWrong = AUDIT.replace('SHOP D,400.00,Dr', 'SHOP D,400.00,Cr');
    const r = await read(oneWrong);
    const d = r.p.items.find(i => i.desc === 'SHOP D');
    eq(d.amount, 400, 'the disputed row is left as its marker says, not silently re-signed');
    ok(!d.include && !!d.stepFlag, 'and arrives unticked, flagged');
    eq(r.p.items.filter(i => i.desc !== 'SHOP D').map(i => i.amount), TRUTH.filter((_, k) => k !== 4), 'the rest read by their markers');
    ok(r.p.items.filter(i => i.desc !== 'SHOP D').every(i => i.include), 'and stay ticked');
    ok(/1 row/.test(r.banner) && /unticked/.test(r.banner), `the banner counts it: ${r.banner}`);
    ok(/disagree with the balance/.test(r.v.els['#impStats'].textContent), `so does the summary line: ${r.v.els['#impStats'].textContent}`);
    const tableText = r.v.els['#impTable'].textContent;
    ok(/does not move by this amount/.test(tableText), 'and the row itself says why it is unticked');
    // A re-render keeps the reader's decision.
    d.include = true; d.manualInclude = true;
    r.v.ctx.renderImportReview();
    ok(d.include, 'a row the reader ticked stays ticked through a re-render');
  }

  /* ---- 5. a whole-file flip leaves alone the row its balance says was right - */
  {
    const r = await read(dropCol(AUDIT, 3));
    ok(r.p.reconcile.verified && r.p.reconcile.flipped, 'fixture: without the marker the file still flips on 5 of 6 pairs');
    const sal = r.p.items.find(i => i.desc === 'SALARY ACME');
    eq(sal.amount, 25000, 'the salary, whose own balance step went UP, is not flipped to spending');
    ok(!sal.include && !!sal.stepFlag, 'it is unticked and flagged instead');
    eq(r.p.items.filter(i => i !== sal).map(i => i.amount), TRUTH.filter((_, k) => k !== 3), 'the rows the flip fits are flipped');
    ok(/left as the file wrote/.test(r.banner), `the banner says one row was left as written: ${r.banner}`);
    // The account pick re-decides; a liability reading must not strand the flag.
    r.p.label = 'Card'; r.v.ctx.renderImportReview();
    r.p.label = 'Cheque'; r.v.ctx.renderImportReview();
    ok(!sal.include && sal.amount === 25000, 'switching account away and back lands on the same state');
  }

  /* ---- 6. a credit card with a marker column -------------------------------- */
  {
    const card = [
      'Date,Description,Amount,Dr/Cr,Balance',
      '2026/11/01,PAYMENT THANK YOU,5000.00,Cr,0.00',
      '2026/11/02,SHOP,100.00,Dr,100.00',
      '2026/11/03,SHOP B,200.00,Dr,300.00',
      '2026/11/04,SHOP C,300.00,Dr,600.00',
      '2026/11/05,SHOP D,50.00,Dr,650.00',
    ].join('\n');
    const r = await read(card, 'Card');
    eq(r.amounts, [5000, -100, -200, -300, -50], 'on a card, Dr purchases are money out and the Cr payment is money in');
    ok(r.p.reconcile.verified && !r.p.reconcile.flipped && !r.warn, 'and the owing balance agrees');
  }

  /* ---- 7. headers, footers, opening balance, repeated header --------------- */
  {
    const messy = [
      'ACME BANK STATEMENT',
      'Account Number :,12345678',
      'Date,Description,Amount,Dr/Cr,Balance',
      '2026/11/01,SHOP A,100.00,Dr,4900.00',
      '2026/11/02,SHOP B,200.00,Dr,4700.00',
      'Date,Description,Amount,Dr/Cr,Balance',
      '2026/11/03,SHOP C,300.00,Dr,4400.00',
      '2026/11/04,SALARY ACME,25000.00,Cr,29400.00',
      '2026/11/05,SHOP D,400.00,Dr,29000.00',
      'Total,,26000.00,,',
      'Closing balance,,,,29000.00',
    ].join('\n');
    const r = await read(messy);
    eq(r.p.map.iDrCr, 3, 'a repeated header line does not disqualify the marker column');
    eq(r.amounts, [-100, -200, -300, 25000, -400], 'the rows read by their markers; header and footer lines are not rows');
    ok(r.p.reconcile.verified && !r.p.reconcile.flipped, 'and the balances agree');
  }

  /* ---- 8. the column mapper ------------------------------------------------- */
  {
    const v = mountReview({ accounts: ACCOUNTS });
    const p = await v.load(AUDIT, 'statement.csv');
    v.ctx.remapImport();
    const sel = v.els['#impMapFields'].querySelector('#impMap_iDrCr');
    ok(!!sel, 'the mapper offers the marker column as a field');
    eq(sel && sel.value, '3', 'prefilled with the detected column');
    ok(!!p, 'fixture');
    // A file whose marker heading is not one the detector knows, mapped by hand.
    const odd = AUDIT.replace('Dr/Cr', 'Flow');
    const v2 = mountReview({ accounts: ACCOUNTS });
    const p2 = await v2.load(odd, 'statement.csv');
    eq(p2.map.iDrCr, -1, 'fixture: an unknown heading is not detected');
    v2.ctx.remapImport();
    v2.els['#impMapFields'].querySelector('#impMap_iDrCr').value = '3';
    await v2.els['#impMapApply'].onclick();
    const p3 = v2.ctx.S.pendingImport;
    p3.label = 'Cheque'; v2.ctx.renderImportReview();
    eq(p3.items.map(i => i.amount), TRUTH, 'a marker column picked by hand is applied');
  }

  console.log(`PASS import-drcr-column — an Amount column is read by its Dr/Cr marker, and the balance column judges (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
