'use strict';
/* The what's-left card, five defects from the 2026-09-29 totals audit.

   Each one was a figure or a sentence on the card that described a different
   set of accounts, rows or income than the arithmetic beside it. All are
   pinned on synthetic households: the audit ran over a real vault, and none of
   its figures belong in the repo.

     1. F2   "N accounts · M unconfirmed" counted stale in-budget accounts,
             while cash sums only accounts with a POSITIVE implied balance. On
             the real vault it printed "2 accounts · 1 unconfirmed" where the
             unconfirmed one was a cash account that contributed nothing. The
             unplaced-rows and confirmation-day sentences qualified the same
             wider set.
     2. F6   An unreadable balance ("about 300") parses to 0 and was still
             counted as cash PLUS the rows since. balanceBook() holds such an
             account out of both bases; this card did not.
     3. F3   A foreign band printed `committedOther + cardDue` as "still
             committed" while `free` leaves cardDue out inside a settlement
             cycle, so the three printed terms did not add up.
     4. F4   Rule 2 (a debt already paid this period) reads `settleRows`, which
             was built from the PERIOD's rows only. usualDay(paid) then lost the
             instalment's habitual day: the "was due" flag vanished on a
             monthly period and the instalment vanished from "still committed"
             on a 14-day one.
     5.      The repeating-credit search was offered transfer rows, so a
             R35 000 monthly "from money market" transfer beat a R30 000 salary
             as the income that was "landing".

     node tests/dashboard-audit-whatsleft.test.cjs */
const assert = require('assert');
const { B, tx, base, account, find, hasClass, textOf, figNumber, renderDash } = require('./helpers/dash-audit.cjs');
const { cashOnHand, cardsOwed, whatsLeft, debtCommitments } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

(async () => {
  /* ---- 1. the unconfirmed count and the two caveats follow the cash --------- */
  {
    const files = {
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '20000.00', balance_updated: '2026-09-27' }),
      /* Counted (positive) and stale. */
      [`${B}/Accounts/Wallet.md`]: account('Wallet', { balance: '500.00', balance_updated: '2026-06-01' }),
      /* Stale, but its implied balance is negative: it contributes nothing to
         cash, so the "unconfirmed" count must not include it. It also holds a
         row on its confirmation day and one whose date names no day, both of
         which would qualify a total this account is not part of. */
      [`${B}/Accounts/Old cash.md`]: account('Old cash', { balance: '0.00', balance_updated: '2026-06-01' }),
      [`${B}/Transactions/Old cash/2026-06.md`]: tx([
        ['2026-06-01', 'Float', 'Groceries', -20],
        ['2026-06-10', 'Petrol', 'Groceries', -30],
        ['end of June', 'Mystery', 'Groceries', -5],
      ]),
    };
    const { nodes, t } = await renderDash(files, { today: '2026-09-29' });
    const left = t('#leftBody');
    ok(/2 accounts · 1 unconfirmed/.test(left),
      `unconfirmed counts only the stale account that is inside the cash: ${left}`);
    ok(!/2 unconfirmed/.test(left), 'the negative stale account is not counted as unconfirmed');
    ok(!/confirmation day/.test(left), 'the confirmation-day sentence does not qualify an uncounted account');
    ok(!/cannot read/.test(left), 'nor does the unreadable-dates sentence');
    eq(figNumber(nodes.get('#leftBody'), 'left-cash'), 20500, 'cash is the two positive accounts');

    /* The seam, without a page: cashOnHand names what it counted. */
    const c = cashOnHand([
      { name: 'A', dated: true, implied: 100, stale: true },
      { name: 'B', dated: true, implied: 50, stale: false },
      { name: 'C', dated: true, implied: -10, stale: true },
    ]);
    eq([c.counted, c.staleCounted], [2, 1], 'staleCounted is a subset of counted');
  }

  /* ---- 1b. a caveat on a counted account still shows -------------------------
     The other half of the rule: narrowing the caveats to the counted set must
     not silence the ones that DO qualify the figure. */
  {
    const files = {
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '1000.00', balance_updated: '2026-09-20' }),
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([
        ['2026-09-20', 'Deposit', 'Salary', 500],
        ['2026-09-25', 'Shop', 'Groceries', -50],
        ['not a date', 'Mystery', 'Groceries', -5],
      ]),
    };
    const { t } = await renderDash(files, { today: '2026-09-29' });
    const left = t('#leftBody');
    ok(/confirmation day/.test(left), `the confirmation-day sentence survives on a counted account: ${left}`);
    ok(/cannot read/.test(left), 'and so does the unreadable-dates sentence');
  }

  /* ---- 2. an unreadable balance is unknown, not zero plus the rows since ---- */
  {
    const mk = bal => ({
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '20000.00', balance_updated: '2026-09-27' }),
      [`${B}/Accounts/Wallet.md`]: account('Wallet', { balance: bal, balance_updated: '2026-08-15' }),
      [`${B}/Transactions/Wallet/2026-08.md`]: tx([['2026-08-20', 'Cash in', 'Transfer', 500]]),
    });
    const readable = await renderDash(mk('300.00'), { today: '2026-09-29' });
    eq(figNumber(readable.nodes.get('#leftBody'), 'left-cash'), 20800,
      'a readable balance plus the row since is counted (control)');

    const unreadable = await renderDash(mk('about 300'), { today: '2026-09-29' });
    eq(figNumber(unreadable.nodes.get('#leftBody'), 'left-cash'), 20000,
      'an unreadable balance is held out, exactly as balanceBook() holds it out');
    const left = unreadable.t('#leftBody');
    ok(/1 account balance could not be read/.test(left), `and the card says so: ${left}`);
    ok(/ 1 account ·/.test(left) && !/2 accounts/.test(left), `the counted accounts exclude it: ${left}`);

    /* Pure seam: `readable: false` is unknown in cash and in the card owed. */
    const c = cashOnHand([{ name: 'W', dated: true, implied: 500, readable: false }]);
    eq([c.cash, c.counted, c.unreadable], [0, 0, ['W']], 'cashOnHand: an unreadable balance is not cash');
    eq(cardsOwed([{ name: 'Visa', type: 'credit_card', dated: true, implied: -800, readable: false }]).owed, 0,
      'cardsOwed: nor is an unreadable card balance a debt of 800');
  }

  /* ---- 3. the foreign band's three terms add up ----------------------------- */
  {
    const euro = (extra = {}) => ({
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '1000.00', balance_updated: '2026-09-01' }),
      [`${B}/Accounts/Euro cheque.md`]: account('Euro cheque', { currency: '"€"', balance: '6000.00', balance_updated: '2026-09-01' }),
      [`${B}/Accounts/Euro card.md`]: account('Euro card', {
        type: 'credit_card', currency: '"€"', settle_monthly: 'true', balance: '-1000.00', balance_updated: '2026-09-01',
      }),
      [`${B}/Transactions/Euro card/2026-09.md`]: tx([['2026-09-01', 'CAFE', 'Groceries', -500]]),
      ...extra,
    });
    const payroll = {};
    for (const m of ['05', '06', '07', '08']) {
      payroll[`${B}/Transactions/Euro cheque/2026-${m}.md`] = tx([[`2026-${m}-25`, 'ACME GMBH PAYROLL', 'Salary', 3000]]);
    }

    /* Inside a settlement cycle `free` is cash − committedOther. */
    const cyc = await renderDash(euro(payroll), { today: '2026-09-02' });
    const band = find(cyc.nodes.get('#leftBody'), n => hasClass(n, 'left-fx-txt')).map(textOf).join(' | ');
    ok(/€/.test(band), `the euro band renders: ${band}`);
    ok(/actually free € ?6[  ]?000/.test(band), `free is the whole cash inside a cycle: ${band}`);
    ok(!/still committed/.test(band),
      `so the band does not print a committed term the free figure did not subtract: ${band}`);

    /* Outside a cycle the card IS a claim on the cash, and the band says so. */
    const flat = await renderDash(euro(), { today: '2026-09-02' });
    const band2 = find(flat.nodes.get('#leftBody'), n => hasClass(n, 'left-fx-txt')).map(textOf).join(' | ');
    ok(/still committed € ?1[  ]?000/.test(band2) && /actually free € ?5[  ]?000/.test(band2),
      `without a cycle the card is committed and free is cash less it: ${band2}`);

    /* The seam: one field, whichever branch `free` took. */
    const acc = (name, extra) => ({ name, inBudget: true, dated: true, type: 'checking', ...extra });
    const inCycle = whatsLeft({
      accounts: [acc('Cheque', { implied: 6000 }), acc('Card', { type: 'credit_card', settleMonthly: true, implied: -1000 })],
      services: [], debts: [], rows: [],
      cardRows: [{ date: '2026-09-01', amount: -500 }],
      incomeRows: [
        { date: '2026-06-25', amount: 3000, desc: 'PAYROLL' }, { date: '2026-07-25', amount: 3000, desc: 'PAYROLL' },
        { date: '2026-08-25', amount: 3000, desc: 'PAYROLL' },
      ],
      periodStart: '2026-09-01', periodEnd: '2026-09-30', today: '2026-09-02',
    });
    ok(inCycle.cycle, 'fixture forms a cycle');
    eq(inCycle.committedShown, inCycle.committedOther, 'in a cycle committedShown is committedOther');
    eq(inCycle.cash - inCycle.committedShown - inCycle.earmarked, inCycle.free, 'and cash − shown = free');
  }

  /* ---- 4. rule 2 keeps its history --------------------------------------------- */
  {
    const debts = '---\nkind: debts\n---\n\n'
      + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
      + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n'
      + '| Car | Bank | vehicle | 90000.00 | 100000.00 | 10.00 | 1500.00 | 0.00 |  | Car loan | active | | |\n';
    const paid = [];
    for (const m of ['01', '02', '03', '04', '05', '06', '07', '08', '09']) paid.push([`2026-${m}-10`, 'CAR FIN', 'Car loan', -1500]);
    const mk = extraSettings => ({
      ...base(extraSettings),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '50000.00', balance_updated: '2026-10-01' }),
      [`${B}/Debts.md`]: debts,
      [`${B}/Transactions/Cheque/2026-01.md`]: tx(paid.slice(0, 3)),
      [`${B}/Transactions/Cheque/2026-04.md`]: tx(paid.slice(3, 6)),
      [`${B}/Transactions/Cheque/2026-07.md`]: tx(paid.slice(6, 9)),
    });

    /* Payday month 22nd–21st: the period Sep 22 – Oct 21, read on the 15th
       with the October instalment (usually the 10th) not yet paid. */
    const monthly = await renderDash({
      ...mk(''),
      [`${B}/Settings.md`]: '---\nmonth_start_day: 22\ncurrency: "R"\ncountry: za\n---\n',
    }, { today: '2026-10-15' });
    const left = monthly.t('#leftBody');
    ok(/was due 2026-10-10/.test(left),
      `the instalment keeps the day its history taught it, and is flagged overdue: ${left}`);
    eq(figNumber(monthly.nodes.get('#leftBody'), 'left-committed'), 1500, 'and is still committed');

    /* A 14-day period: the instalment's day (the 10th) falls inside it, and
       used to be dropped as "unplaceable" because the history had been cut. */
    const fortnight = await renderDash(mk('period_days: 14\nperiod_anchor: 2026-10-01\n'), { today: '2026-10-02' });
    eq(figNumber(fortnight.nodes.get('#leftBody'), 'left-committed'), 1500,
      `on a 14-day period the instalment stays in "still committed": ${fortnight.t('#leftBody')}`);

    /* A payment made THIS period still settles it (rule 2 is unchanged). */
    const settled = await renderDash({
      ...mk('period_days: 14\nperiod_anchor: 2026-10-01\n'),
      [`${B}/Transactions/Cheque/2026-10.md`]: tx([['2026-10-10', 'CAR FIN', 'Car loan', -1500]]),
    }, { today: '2026-10-12' });
    ok(!/Car/.test(settled.t('#leftBody')), 'a payment dated in this period still settles the instalment');

    /* Pure: the same instalment given only this period's rows is the bug. */
    const hist = paid.map(([date, desc, cat, amount]) => ({ date, desc, cat, amount }));
    const d = [{ name: 'Car', category: 'Car loan', payment: 1500, status: 'active' }];
    const args = { debts: d, from: '2026-10-02', to: '2026-10-14', periodStart: '2026-10-01', periodDays: 14, today: '2026-10-02' };
    eq(debtCommitments({ ...args, settleRows: hist }).length, 1, 'with history the instalment is placed on its usual day');
    eq(debtCommitments({ ...args, settleRows: [] }).length, 0, 'with none it cannot be placed in a short period (why the view must pass history)');
  }

  /* ---- 5. incoming salary is never a transfer ---------------------------------- */
  {
    const files = {
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-15' }),
      [`${B}/Accounts/Money market.md`]: account('Money market', { type: 'savings', balance: '200000.00', balance_updated: '2026-09-15' }),
    };
    const months = ['05', '06', '07', '08'];
    for (const m of months) {
      files[`${B}/Transactions/Cheque/2026-${m}.md`] = tx([
        [`2026-${m}-25`, 'ACME PAYROLL', 'Salary', 30000],
        [`2026-${m}-26`, 'FROM MONEY MARKET', 'Transfer', 35000],
      ]);
    }
    const { t } = await renderDash(files, { today: '2026-09-20' });
    const left = t('#leftBody');
    ok(/30[  ]?000 lands on 2026-09-25/.test(left), `the salary is the income that is landing: ${left}`);
    ok(!/35[  ]?000 lands/.test(left), 'not the transfer between the household\'s own accounts');
  }

  console.log(`PASS dashboard-audit-whatsleft (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
