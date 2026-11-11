'use strict';
/* The ledger's `splitParent` stamp is tx-role's `supersededBySplit`, not the
   Split cell alone (2026-11-11 audit, task 6).

   tx-role.js states the invariant in its own header: a parent is superseded
   only while it carries BOTH the `parent` role AND the Excluded tick, so that
   "no reader can ever skip a row that the period totals are counting". The
   ledger was the last raw-row reader that ignored the tick — it stamped
   `splitParent: role === SPLIT_PARENT` and the ACCOUNT and HOUSEHOLD lenses
   dropped on that stamp.

   The state that reaches it is the documented hand reversal of a split:
   untick Excluded, delete the parts, and leave `parent` sitting in the Split
   cell. On the audit's repro the Budget page and reconcile() counted that row
   (R1 000) while the Accounts flow chips and the Score dropped it (R0) — money
   on one page and gone from another, with nothing on screen to say why.

   Three readings of one row, which must agree:
     1. the stamp itself, on hand-built rows (pure, no loader);
     2. the lenses over the REAL loader — BUDGET (the page that was right),
        ACCOUNT and HOUSEHOLD (the two that were wrong);
     3. reconcile(), the account-level reader that was right, as the control.

     node tests/ledger-split-parent-needs-excluded.test.cjs */
const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { stamp, tally, LENSES, keeps } = require('../src/ledger');
const { supersededBySplit } = require('../src/tx-role');
const { reconcile } = require('../src/reconcile');
const { atAuditDate } = require('./_audit-seed.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const cents = v => { const n = Math.round(v * 100); return n === 0 ? 0 : n; };
const eqMoney = (a, b, m) => eq(cents(a), cents(b), `${m} (got ${a}, want ${b})`);

/* ---- 1. the stamp, on rows a hand could have typed ----------------------- */
{
  const rows = [
    { label: 'Cheque', date: '2026-07-20', desc: 'reversed', cat: 'Groceries', amount: -1000, excluded: false, split: 'parent' },
    { label: 'Cheque', date: '2026-07-21', desc: 'live split', cat: 'Groceries', amount: -900, excluded: true, split: 'parent' },
    { label: 'Cheque', date: '2026-07-21', desc: 'live split', cat: 'Groceries', amount: -900, excluded: false, split: 'part' },
    { label: 'Cheque', date: '2026-07-22', desc: 'plain veto', cat: 'Groceries', amount: -50, excluded: true, split: '' },
  ];
  const st = stamp(rows, {});
  for (const s of st) {
    eq(s.splitParent, supersededBySplit(s.row),
      `"${s.row.desc}" (${s.row.split || 'no role'}, excluded ${s.row.excluded}): the stamp IS supersededBySplit, whatever the Split cell says`);
  }
  eq(st.map(s => s.splitParent), [false, true, false, false],
    'only the parent that still carries its Excluded tick is superseded — a `parent` cell on a counted row is a leftover word, not a veto');
  ok(keeps(LENSES.ACCOUNT, st[0]), 'ACCOUNT keeps the reversed parent: the money moved through the account');
  ok(keeps(LENSES.HOUSEHOLD, st[0]), 'HOUSEHOLD keeps it: the household spent it');
  ok(!keeps(LENSES.ACCOUNT, st[1]) && !keeps(LENSES.HOUSEHOLD, st[1]),
    'negative control: a live split\'s parent is still dropped by both, or the 1.11.9 double count is back');
  /* The invariant tx-role.js names, as a property of the lens table rather
     than of this fixture: whatever BUDGET keeps, no lens may drop for being a
     split parent. */
  for (const s of st) {
    if (keeps(LENSES.BUDGET, s)) ok(!s.splitParent, `"${s.row.desc}": a row the period totals count is never stamped splitParent`);
  }
}

/* ---- 2. the lenses, through the real loader ------------------------------ */
const B = 'Budget';
const HEAD = '---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const txFile = rows => HEAD + rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  | ${r[5] || ''} |\n`).join('');
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ninput_mode: manual\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 20000.00\nbalance_updated: 2026-06-30\n---\n',
  /* The reversal exactly as the documentation describes it and as a hand
     leaves it: Excluded unticked, the two parts deleted, `parent` still in
     the Split cell. One salary row beside it so the Score has an income. */
  [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
    ['2026-07-01', 'Salary', 'Salary', 30000],
    ['2026-07-20', 'Big shop', 'Groceries', -1000, '', 'parent'],
  ]),
};

atAuditDate(async () => {
  const ctx = makeCtx(FILES, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  ctx.S.period = '2026-07';
  const row = ctx.txInPeriod('2026-07').find(r => r.desc === 'Big shop');
  ok(row && !row.excluded && row.split === 'parent', 'the loader hands the row back as typed: counted, with the role word still in its cell');
  ok(!supersededBySplit(row), 'and tx-role says it is an ordinary row again');

  const st = ctx.ledger('2026-07-01', '2026-07-31');
  const budget = tally(st, LENSES.BUDGET);
  const account = tally(st, LENSES.ACCOUNT);
  const household = tally(st, LENSES.HOUSEHOLD);
  eqMoney(budget.spend, 1000, 'BUDGET counts the purchase — the page that was already right');
  eqMoney(account.outflow, -1000, 'ACCOUNT counts it too: the Accounts flow chips read R0 for this row before');
  eqMoney(account.net, 30000 - 1000, 'so the account\'s net over the period is salary less the purchase');
  eqMoney(household.consumption, 1000, 'HOUSEHOLD counts it: the Score\'s consumption read R0 for this row before');
  eq(household.spendByCat, { Groceries: 1000 }, 'under the category the row names');

  /* ---- 3. reconcile(), the account reader that never disagreed ----------- */
  const cheque = ctx.S.accounts.find(a => a.name === 'Cheque');
  const rec = reconcile(cheque, ctx.accountIndex().get(cheque).rows, '2026-09-15');
  eq(rec.state, 'drift', 'reconcile() reads the account as moved since its 2026-06-30 balance');
  eqMoney(rec.delta, account.net,
    'reconcile() and the ACCOUNT lens now move the same account by the same amount — the two halves of the app agree the row exists');

  console.log(`PASS — the ledger's splitParent stamp is supersededBySplit: a parent without its Excluded tick is an ordinary row under every lens (${checks} checks)`);
}, '2026-09-15').catch(e => { console.error(e); process.exit(1); });
