'use strict';
/* Non-budget accounts + balance reconciliation.

   Two features that both hang off the same fact — that S.txFiles already knows
   which account every transaction belongs to — driven through the REAL loader,
   the REAL periodSummary and the REAL saveAccount:

     1. `budget: false` in an account's frontmatter keeps its transactions out
        of the household income/spend totals WITHOUT hiding them anywhere else.
        An investment wrapper's interest is not income and its debit orders are
        not spending, but the rows still have to import and still have to be
        listed in Transactions.

     2. A hand-typed `balance` can be checked against the rows dated after
        `balance_updated` — the figure the Accounts page offers to reconcile to.

   Runs in bare node against an in-memory vault (tests/helpers/harness.cjs).
   Wired into ./build.sh.
     node tests/non-budget-accounts.test.cjs     # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
/* Local calendar date, matching accounts.js todayIso() — deliberately not
   toISOString(), which is UTC and returns yesterday during the small hours in
   Johannesburg. */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const TX_FM = 'tags: [finance]';
const table = rows =>
  `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n${rows.join('\n')}\n`;

/* month_start_day 1 so the period '2026-07' is simply the calendar month —
   the payday-month offset is exercised by period-and-parsers.test.cjs. */
const SETTINGS = { month_start_day: 1 };

const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',

  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Interest.md`]: '---\ntype: income\ncolor: "#111111"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#222222"\n---\n',

  // In the budget, and the balance is 30 days stale with rows after it.
  [`${B}/Accounts/FNB Cheque.md`]:
    '---\ntype: checking\ninstitution: "FNB"\nbalance: 1000.00\nbalance_updated: 2026-07-10\ntags: [finance]\n---\n\n# FNB Cheque\n\nBody survives.\n',
  // Out of the budget — the case this test exists for.
  [`${B}/Accounts/Ninety One TFSA.md`]:
    '---\ntype: investment\ninstitution: "Ninety One"\nbalance: 50000.00\nbalance_updated: 2026-07-01\nbudget: false\n---\n',
  // The folder is named differently from the account file, via tx_label.
  [`${B}/Accounts/Discovery Notice.md`]:
    '---\ntype: savings\ntx_label: "Discovery 32-day"\nbalance: 20000.00\nbudget: no\n---\n',

  [`${B}/Transactions/FNB Cheque/2026-07.md`]: table([
    '| 2026-07-05 | Woolworths | Groceries | -250.00 |  |  |',
    '| 2026-07-15 | Salary | Salary | 30000.00 |  |  |',
    '| 2026-07-20 | Debit order to TFSA | Groceries | -1000.00 |  |  |',
    '| 2026-07-25 | Rebate | Groceries | 100.00 | yes |  |',
  ]),
  [`${B}/Transactions/Ninety One TFSA/2026-07.md`]: table([
    '| 2026-07-20 | Contribution | Salary | 1000.00 |  |  |',
    '| 2026-07-28 | Interest | Interest | 300.00 |  |  |',
    '| 2026-07-29 | Admin fee | Groceries | -75.00 |  |  |',
  ]),
  [`${B}/Transactions/Discovery 32-day/2026-07.md`]: table([
    '| 2026-07-11 | Interest |  | 90.00 |  |  |',
  ]),
  /* A scheduled debit order, dated far enough ahead that this stays true
     whenever the suite is run. Money that has not moved yet is not part of what
     the account reads today — and folding it in would ALSO double-count it on
     the next reconciliation, because it would still be dated after the balance
     date just stamped. */
  [`${B}/Transactions/FNB Cheque/2099-01.md`]: table([
    '| 2099-01-15 | Scheduled debit order | Groceries | -500.00 |  |  |',
  ]),
};

(async () => {
  const ctx = makeCtx(FILES, { settings: SETTINGS });
  const S = await loadInto(ctx);
  require('../src/views/accounts')(ctx);

  const byName = n => S.accounts.find(a => a.name === n);
  const cheque = byName('FNB Cheque');
  const tfsa = byName('Ninety One TFSA');
  const notice = byName('Discovery Notice');

  /* ---------------------------- 1. the flag ---------------------------- */
  eq(cheque.in_budget, true, 'an account with no `budget` key defaults to IN — no existing vault moves on upgrade');
  eq(tfsa.in_budget, false, '`budget: false` opts an account out');
  eq(notice.in_budget, false, '`budget: no` opts an account out too');

  /* ------------------------ 2. label → account ------------------------- */
  eq(ctx.accountForLabel('FNB Cheque'), cheque, 'a folder matching the account filename resolves');
  eq(ctx.accountForLabel('Discovery 32-day'), notice, 'a folder named by tx_label resolves to its account');
  eq(ctx.accountForLabel('No Such Folder'), null, 'an orphan folder resolves to null, not to a wrong account');
  /* Case-folded, like txSegment: the filesystems this ships on resolve
     `cheque/` and `Cheque/` to one directory, and the write side already
     matched case-blind — folding only one side of the contract meant a
     folder that imported happily while every read through this door saw an
     orphan: rows in the budget, the account told to link a folder it was
     already importing from. */
  eq(ctx.accountForLabel('fnb cheque'), cheque, 'a folder differing only in case still resolves by name');
  eq(ctx.accountForLabel('DISCOVERY 32-DAY'), notice, 'and by tx_label');
  eq([...ctx.nonBudgetLabels()].sort(), ['Discovery 32-day', 'Ninety One TFSA'],
    'both excluded accounts contribute their FOLDER names, not their file names');

  /* --------------------- 3. totals skip those rows --------------------- */
  const sum = ctx.periodSummary('2026-07');
  eq(sum.income, 30000, 'only the cheque salary is income — TFSA interest and contributions are not');
  eq(sum.spend, 1250, 'only cheque spending counts (250 + 1000); the TFSA admin fee does not');
  eq(sum.uncategorised, 0, 'an uncategorised row inside an excluded account must not nag on the Dashboard');
  eq(sum.byCat.Interest, undefined, 'a category only ever seen in an excluded account never reaches the budget table');
  eq(sum.byCat.Salary, 30000, 'the TFSA contribution does not inflate the Salary line');
  eq(sum.byCat.Groceries, -1250, 'the TFSA admin fee does not reach Groceries');

  // The mirror leg: money LEAVING the cheque account for the TFSA is still
  // budgeted spending — that was the design call, so that a savings target can
  // be held to, while the arriving leg above is suppressed to stop double-count.
  ok(sum.spend >= 1000, 'the debit order out of the cheque account is still spending');

  /* -------------- 4. but the rows are still there to read -------------- */
  const all = ctx.txInPeriod('2026-07');
  eq(all.length, 8, 'txInPeriod still returns every row — Transactions hides nothing');
  eq(all.filter(t => t.label === 'Ninety One TFSA').length, 3, 'the excluded account keeps all three rows');

  /* ---------------------- 5. account → transactions -------------------- */
  const idx = ctx.accountIndex();
  eq(idx.get(cheque).rows.length, 5, 'every cheque row is indexed onto its account, across all its month files');
  eq([...idx.get(notice).labels], ['Discovery 32-day'], 'a tx_label account indexes under its folder name');
  ok(!idx.has(byName('Ninety One TFSA')) === false, 'the excluded account is still indexed — excluded ≠ invisible');

  /* -------------------------- 6. reconciliation ------------------------ */
  // balance_updated is 2026-07-10, so the window is the three rows after it:
  // +30000, -1000 and the EXCLUDED +100. That last one is the point — "exclude"
  // keeps a row out of the BUDGET, but the money still left the bank, so a
  // reconciliation that skipped it would be wrong by exactly that amount.
  const rec = ctx.accountReconcile(cheque, idx.get(cheque).rows);
  eq(rec.state, 'drift', 'rows after the balance date mean the stated figure is behind');
  eq(rec.count, 3, 'only rows dated AFTER balance_updated are in the window — the 07-05 row is not');
  eq(rec.delta, 29100, 'an excluded row still moves the bank balance (30000 - 1000 + 100)');
  ok(rec.delta !== 29000, 'specifically: dropping the excluded row would understate it by 100');
  eq(rec.implied, 30100, 'implied balance is the stated figure plus the movement since');
  eq(rec.ahead, 1, 'the 2099 debit order is reported as dated-ahead, not folded into the figure');
  ok(rec.delta !== 28600, 'specifically: it is NOT subtracted from the implied balance');

  /* The double-count this guards against: accept the implied figure, stamp
     today, and the future-dated row must STILL be pending rather than landing
     in the next window as though it had just happened. */
  const settled = { ...cheque, balance: rec.implied, balance_updated: todayIso() };
  const after = ctx.accountReconcile(settled, idx.get(cheque).rows);
  eq(after.state, 'pending', 'a reconciled account with only future rows left is up to date, not drifting');
  eq(after.ahead, 1, 'and the scheduled row is still counted exactly once, as pending');

  // The TFSA's date is 2026-07-01 and every row is after it.
  const recT = ctx.accountReconcile(tfsa, idx.get(tfsa).rows);
  eq(recT.implied, 50000 + 1000 + 300 - 75, 'reconciliation works for an excluded account too');

  eq(ctx.accountReconcile(notice, idx.get(notice).rows).state, 'no-date',
    'an account with no balance_updated cannot be reconciled — say so rather than guessing');
  eq(ctx.accountReconcile(cheque, []).state, 'no-tx',
    'an account with no transactions folder cannot be reconciled either');

  /* --------------- 7. the flag survives a write → reload --------------- */
  cheque.in_budget = false;                     // "Exclude from budget"
  await ctx.saveAccount(cheque);
  const written = ctx.vault._store.get(`${B}/Accounts/FNB Cheque.md`);
  ok(/^budget: false$/m.test(written), 'excluding an account writes `budget: false`');
  ok(/institution: "FNB"/.test(written), 'and leaves every unmodelled key byte for byte');
  ok(/tags: \[finance\]/.test(written), 'including block-style tags');
  ok(/Body survives\./.test(written), 'and the note body');

  const S2 = await loadInto(makeCtx({ ...FILES, [`${B}/Accounts/FNB Cheque.md`]: written }, { settings: SETTINGS }));
  eq(S2.accounts.find(a => a.name === 'FNB Cheque').in_budget, false,
    'the flag round-trips through the real loader');

  cheque.in_budget = true;                      // "Include in budget"
  await ctx.saveAccount(cheque);
  const back = ctx.vault._store.get(`${B}/Accounts/FNB Cheque.md`);
  ok(!/budget:/.test(back), 'including it again REMOVES the key rather than writing `budget: true`');
  ok(/institution: "FNB"/.test(back), 'and still preserves the rest of the frontmatter');

  /* ------------------- 8. the edit form's write path ------------------- */
  /* saveAccount only patches the keys it is HANDED. Passing none must leave
     every editable field alone even after the model has been changed — that is
     what stops the balance button from quietly rewriting an account's details
     to whatever the loader happened to parse. */
  tfsa.institution = 'Should Not Be Written';
  await ctx.saveAccount(tfsa);
  ok(/institution: "Ninety One"/.test(ctx.vault._store.get(`${B}/Accounts/Ninety One TFSA.md`)),
    'a save with no key list leaves editable fields untouched on disk');

  Object.assign(notice, {
    type: 'investment', institution: 'Discovery Invest', account_number: '998877',
    tx_label: 'Discovery 32-day', credit_limit: null, goal_amount: 40000,
    target_date: '2027-03-01', monthly_contribution: 1500, total_invested: 18000,
    starting_amount: null, inception_date: '2024-02-01',
  });
  await ctx.saveAccount(notice, ctx.ACCOUNT_FM_KEYS);
  const edited = ctx.vault._store.get(`${B}/Accounts/Discovery Notice.md`);
  ok(/^type: investment$/m.test(edited), 'the edit form writes a changed type');
  ok(/^institution: "Discovery Invest"$/m.test(edited), 'and a changed institution, quoted');
  ok(/^account_number: "998877"$/m.test(edited), 'and an account number as a string, not a number');
  ok(/^goal_amount: 40000\.00$/m.test(edited), 'and money fields to two decimals');
  ok(/^monthly_contribution: 1500\.00$/m.test(edited), 'and the monthly contribution');
  ok(/^inception_date: 2024-02-01$/m.test(edited), 'and dates unquoted');
  ok(!/^credit_limit:/m.test(edited), 'a field cleared to null is REMOVED, not written as "null"');
  ok(!/^starting_amount:/m.test(edited), 'same for a field that was never set');
  ok(/^budget: no$|^budget: false$/m.test(edited), 'the budget flag survives an unrelated edit');

  const S3 = await loadInto(makeCtx({ ...FILES, [`${B}/Accounts/Discovery Notice.md`]: edited }, { settings: SETTINGS }));
  const reloaded = S3.accounts.find(a => a.name === 'Discovery Notice');
  eq(reloaded.institution, 'Discovery Invest', 'edited fields round-trip through the real loader');
  eq(reloaded.goal_amount, 40000, 'including the numbers');
  eq(reloaded.tx_label, 'Discovery 32-day', 'and the transactions-folder pointer');
  eq(reloaded.credit_limit, null, 'and a cleared field reads back as unset');
  eq(reloaded.in_budget, false, 'and the account is still out of the budget');

  /* Every patch is computed against a.fmRaw. If that is not re-captured after
     each write, the SECOND save silently reverts the first — edit the details,
     then click the balance, and the details go back to whatever the file said
     when the vault was opened. This is the regression that guards it. */
  notice.balance = 21000;
  notice.balance_updated = todayIso();
  await ctx.saveAccount(notice);                 // a balance-only save, as the tile does
  const afterBalance = ctx.vault._store.get(`${B}/Accounts/Discovery Notice.md`);
  ok(/^institution: "Discovery Invest"$/m.test(afterBalance),
    'a later balance-only save must NOT revert the edit form’s changes');
  ok(/^goal_amount: 40000\.00$/m.test(afterBalance), 'nor the numbers it wrote');
  ok(/^account_number: "998877"$/m.test(afterBalance), 'nor the keys it added');
  ok(/^balance: 21000\.00$/m.test(afterBalance), 'while still writing the new balance');

  /* --------------------- 9. credit-card utilisation -------------------- */
  const card = (balance, credit_limit, type = 'credit_card') => ({ type, balance, credit_limit });
  eq(ctx.accountUtilisation(card(-15000, 30000)), { used: 15000, pct: 50, over: false, near: false, available: 15000 },
    'a card half drawn down reports 50% used');
  eq(ctx.accountUtilisation(card(-30000, 30000)).over, false, 'exactly at the limit is not yet OVER it');
  eq(ctx.accountUtilisation(card(-30000, 30000)).near, true, 'but it is in the warning band');
  eq(ctx.accountUtilisation(card(-25500, 30000)).near, true, '85% is the near threshold, matching the dashboard bars');
  eq(ctx.accountUtilisation(card(-25400, 30000)).near, false, 'just under it is not');
  const overCard = ctx.accountUtilisation(card(-31000, 30000));
  eq(overCard.over, true, 'past the limit is over');
  eq(overCard.available, -1000, 'and the shortfall is reported as negative headroom');
  eq(ctx.accountUtilisation(card(500, 30000)), { used: 0, pct: 0, over: false, near: false, available: 30000 },
    'a card sitting IN CREDIT has used nothing — not a negative share of its limit');
  eq(ctx.accountUtilisation(card(-5000, null)), null, 'no limit recorded means no bar to draw');
  eq(ctx.accountUtilisation(card(-5000, 0)), null, 'and a zero limit cannot be divided by');
  eq(ctx.accountUtilisation(card(-5000, 30000, 'checking')), null, 'an overdrawn cheque account is not a credit card');
  eq(ctx.accountUtilisation(card(-15000, 30000, 'Credit_Card')).pct, 50,
    'a hand-typed Credit_Card still gets its bar — the type test is isCreditCard, the same rule the committed chain and net worth read');

  console.log(`PASS — non-budget accounts, reconciliation, edit-form writes and card utilisation intact (${checks} assertions).`);
})().catch(e => { console.error('FAIL —', e.message); process.exit(1); });
