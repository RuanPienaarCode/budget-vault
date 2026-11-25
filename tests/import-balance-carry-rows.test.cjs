'use strict';
/* A balance carried into or out of a statement is not income
   (2026-11-25 audit, IMP-4).

   Some exports open with a row like `2026/11/01, OPENING BALANCE, 5000.00,
   5000.00` — the balance printed in the Amount cell too. It imported as R5 000
   of income under the green "Amounts check out" banner, because the oldest
   row's amount is never tested against anything (statement.js reconcileAmounts:
   there is no balance before it). A CLOSING BALANCE row at the other end cost a
   pair instead, and on a short statement that alone could sink the verdict.

   Now a row whose description is a balance-carry phrase (a short, explicit
   list, English and Afrikaans) AND whose amount equals its own balance is
   UNTICKED, never deleted, with the reason beside it — and its balance is the
   point the next row is measured from, with no movement of its own, so it
   neither passes for income nor costs the statement its verdict.

   Either half alone is not enough: an "Opening balance" row with a different
   amount is a real deposit described oddly, and a row whose amount happens to
   equal its balance is the first deposit into a new account.

     node tests/import-balance-carry-rows.test.cjs */

const assert = require('assert');
const { mountReview } = require('./helpers/import-review-ctx.cjs');
const { isBalanceCarry } = require('../src/statement');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ACC = { name: 'Cheque', tx_label: 'Cheque', type: 'checking', in_budget: true };
async function read(csv) {
  const v = mountReview({ accounts: [ACC] });
  const p = await v.load(csv, 'statement.csv');
  p.label = 'Cheque'; v.ctx.renderImportReview();
  return { v, p, banner: v.banner(), stats: v.els['#impStats'].textContent };
}

(async () => {
  /* ---- 0. the pure rule ------------------------------------------------------ */
  {
    ok(isBalanceCarry('OPENING BALANCE', 5000, 5000), 'the phrase and the amount equal to the balance');
    ok(isBalanceCarry('Balance brought forward', 5000, 5000), 'brought forward');
    ok(isBalanceCarry('  closing   balance: ', 4400, 4400), 'spacing, case and a trailing colon are not part of the phrase');
    ok(isBalanceCarry('Openingsaldo', 5000, 5000) && isBalanceCarry('Saldo oorgebring', 1200, 1200), 'Afrikaans');
    ok(isBalanceCarry('OPENING BALANCE', -500, -500), 'an overdrawn opening balance');
    ok(!isBalanceCarry('OPENING BALANCE', 300, 5000), 'the phrase with a different amount is a real row');
    ok(!isBalanceCarry('SALARY', 5000, 5000), 'an amount equal to the balance alone is the first deposit into a new account');
    ok(!isBalanceCarry('OPENING BALANCE DEPOSIT FROM MUM', 5000, 5000), 'no fuzzy match: the phrase must be the whole description');
    ok(!isBalanceCarry('OPENING BALANCE', 5000, null) && !isBalanceCarry('OPENING BALANCE', 0, 0), 'no balance, or nothing in it: not this');
  }

  /* ---- 1. the audit's file: an opening row in the Amount cell ---------------- */
  {
    const r = await read([
      'ACC-NO,62000000000,Gold',
      'Date,Amount,Balance,Description',
      '2026/11/01,5000.00,5000.00,OPENING BALANCE',
      '2026/11/02,-100.00,4900.00,POS PURCHASE SHOP',
      '2026/11/03,-200.00,4700.00,POS PURCHASE SHOP B',
      '2026/11/04,-300.00,4400.00,POS PURCHASE SHOP C',
    ].join('\n'));
    const open = r.p.items.find(i => i.desc === 'OPENING BALANCE');
    ok(!!open, 'the row is kept on the review — unticked, never deleted');
    ok(!open.include && open.carry, 'and it arrives unticked, marked as a carried balance');
    ok(r.p.items.filter(i => i !== open).every(i => i.include), 'the real rows stay ticked');
    ok(r.p.reconcile.verified, 'the statement still checks out');
    ok(/carried/.test(r.banner), `the banner says why one row is unticked: ${r.banner}`);
    ok(/balance carried/.test(r.stats), `and the summary line counts it: ${r.stats}`);
    ok(/a balance, not money moving/.test(r.v.els['#impTable'].textContent), 'and the row itself says why it is unticked');
  }

  /* ---- 2. a closing row no longer costs the statement its verdict ----------- */
  {
    const r = await read([
      'Date,Description,Amount,Balance',
      '2026/11/01,SHOP,-100.00,4900.00',
      '2026/11/02,SHOP B,-200.00,4700.00',
      '2026/11/03,SHOP C,-300.00,4400.00',
      '2026/11/04,SHOP D,-50.00,4350.00',
      '2026/11/04,CLOSING BALANCE,4350.00,4350.00',
    ].join('\n'));
    const close = r.p.items.find(i => i.desc === 'CLOSING BALANCE');
    ok(close && !close.include && close.carry, 'the closing row is unticked');
    ok(r.p.reconcile.verified && r.p.reconcile.agreement === r.p.reconcile.pairs,
      `and measured as no movement, every pair agrees: ${JSON.stringify(r.p.reconcile)}`);
  }

  /* ---- 3. a newest-first statement with the opening row last ---------------- */
  {
    const r = await read([
      'Date,Description,Amount,Balance',
      '2026/11/04,SHOP C,-300.00,4400.00',
      '2026/11/03,SHOP B,-200.00,4700.00',
      '2026/11/02,SHOP,-100.00,4900.00',
      '2026/11/01,BALANCE BROUGHT FORWARD,5000.00,5000.00',
    ].join('\n'));
    const bf = r.p.items.find(i => i.desc === 'BALANCE BROUGHT FORWARD');
    ok(bf && !bf.include, 'brought forward, at the end of a newest-first file, is unticked');
    ok(r.p.reconcile.verified, 'and the file verifies');
  }

  /* ---- 4. the reader can still import it ------------------------------------ */
  {
    const r = await read([
      'Date,Description,Amount,Balance',
      '2026/11/01,OPENING BALANCE,5000.00,5000.00',
      '2026/11/02,SHOP,-100.00,4900.00',
      '2026/11/03,SHOP B,-200.00,4700.00',
      '2026/11/04,SHOP C,-300.00,4400.00',
    ].join('\n'));
    const open = r.p.items.find(i => i.desc === 'OPENING BALANCE');
    open.include = true; open.manualInclude = true;
    r.v.ctx.renderImportReview();
    ok(open.include, 'ticked by the reader, it stays ticked through a re-render');
  }

  /* ---- 5. the phrase with a real amount is an ordinary row ------------------ */
  {
    const r = await read([
      'Date,Description,Amount,Balance',
      '2026/11/01,SHOP,-100.00,4900.00',
      '2026/11/02,OPENING BALANCE,300.00,5200.00',
      '2026/11/03,SHOP B,-200.00,5000.00',
      '2026/11/04,SHOP C,-300.00,4700.00',
    ].join('\n'));
    ok(r.p.items.every(i => i.include && !i.carry), 'an "Opening balance" whose amount is not its balance is imported like any row');
  }

  console.log(`PASS import-balance-carry-rows — a balance carried in or out is unticked with its reason, and measured as no movement (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
