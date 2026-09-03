'use strict';
/* THE THIRD AUDIT BATCH — #61, #62, #70, #71, #72, #73, #74.

   Seven defects, each reproduced in bare node before it was touched.

     #61  accountIndex called accountForLabel — a linear scan with two
          safeSeg calls per account — once per transaction FILE, rebuilt ~15
          times per Dashboard render. O(files x accounts), 47 ms at forty
          accounts with the row count held constant, a million safeSeg calls.
     #62  The date convention was the HOUSEHOLD's, not the file's. A US
          export on a day-first household read 01/03 as 1 March, scattered a
          three-month statement across five month files, and said nothing —
          while its own row order disproved the reading.
     #70  A file with no grouping evidence parsed "250.000" as two hundred
          and fifty on a dot-grouping household, and flipped scale the month
          one two-group row appeared.
     #71  A four-letter stem ("cash", "fees") matched as a bare substring, so
          COFFEES BY THE SEA became Bank charges and CASHBUILD a cash
          withdrawal — and rule-cleanup keeps the shorter rule by design.
     #72  Two accounts claiming one transaction folder: the second silently got
          no rows, reconciled as `no-tx` forever, and still counted its full
          balance in net worth.
     #73  A period that had not STARTED handed its whole window back as both
          the headline figures and `scheduled`, so the hero printed the same
          money twice under "Up to today"; and periodFinished was true for it,
          letting incomeBaseFor fall back to income that had not arrived.
     #74  The debt due day was a numeric median of days-of-month, so payments
          on the 31st and the 1st landed on the 16th — a day no payment ever
          fell on, and on a fortnight the half holding the payment said
          nothing was due.

     node tests/audit-batch-three.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { SEED, PERIOD } = require('./_audit-seed.cjs');
const { debtCommitments } = require('../src/committed');
const { learnPattern, prepareRules, autoCategorise } = require('../src/rules');
const { parseStatementDate } = require('../src/statement');
const registerImport = require('../src/views/import');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const SETTINGS = { [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' };
const tx = rows => '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} |  |  |  |\n`).join('');

/* ================= #71 — short stems are words ========================== */
{
  const rules = prepareRules([
    { pattern: learnPattern('FEES 000123456'), category: 'Bank charges' },
    { pattern: learnPattern('CASH 000000000'), category: 'Cash withdrawal' },
    { pattern: 'woolworths', category: 'Groceries' },
  ]);
  eq(learnPattern('FEES 000123456'), 'FEES', 'the stem really is four letters');
  eq(autoCategorise('COFFEES BY THE SEA', rules), '', '"fees" inside COFFEES is not a bank charge');
  eq(autoCategorise('CASHBUILD PAARL 1234', rules), '', 'nor is CASHBUILD a cash withdrawal');
  eq(autoCategorise('PICK N PAY CASHIER 12', rules), '', 'nor a cashier');
  eq(autoCategorise('FEES 000999', rules), 'Bank charges', 'the rule still matches the merchant it was learned from');
  eq(autoCategorise('CASH-000111', rules), 'Cash withdrawal', 'across punctuation, which is a boundary');
  eq(autoCategorise('Monthly fees', rules), 'Bank charges', 'and as a whole word anywhere');
  eq(autoCategorise('WOOLWORTHS FOOD V&A', rules), 'Groceries', 'a long pattern still matches as a substring — it is specific enough');
}

/* ================= #74 — days of the month are a circle ================= */
{
  const CARD = { name: 'Card', balance: 8000, payment: 500, extra: 0, start: '2025-01-15', category: 'Debt', status: 'active' };
  const due = (paid, ps, pe, days) => debtCommitments({
    debts: [CARD], rows: paid.map(d => ({ date: d, cat: 'Debt', amount: -500 })),
    from: ps, to: pe, periodStart: ps, periodDays: days, today: ps,
  }).map(i => i.due);
  eq(due(['2026-07-01', '2026-07-31'], '2026-09-01', '2026-09-14', 14), ['2026-09-01'],
    'payments on the 31st and the 1st are due around the 1st — NOT the 16th');
  eq(due(['2026-07-01', '2026-07-31'], '2026-09-15', '2026-09-28', 14), [],
    'and the half of the month that never held a payment claims nothing');
  eq(due(['2026-07-14', '2026-08-16'], '2026-09-01', '2026-09-30', 30), ['2026-09-15'],
    'a cluster that does not straddle a month end still takes the plain median');
  eq(due(['2026-07-14', 'end of June'], '2026-09-01', '2026-09-30', 30), ['2026-09-14'],
    'an unreadable date is dropped rather than poisoning the median with NaN');
}

/* ================= #62 — the file's own order is evidence ============== */
{
  const us = ['01/03/2026', '01/28/2026', '02/05/2026', '02/11/2026', '03/02/2026', '03/19/2026'];
  const asDayFirst = us.map(d => parseStatementDate(d, true));
  ok(!asDayFirst.every((d, i) => !i || d >= asDayFirst[i - 1]),
    'the household reading puts a US file out of order — the pure parser is unchanged and this is the evidence');
}

(async () => {
  /* ================= #61 — one lookup, built once ====================== */
  {
    const F = { ...SETTINGS };
    for (let a = 0; a < 40; a++) {
      F[`${B}/Accounts/Acct ${a}.md`] = `---\ntype: checking\ntx_label: "Acct ${a}"\nbalance: 1\n---\n`;
      for (let m = 1; m <= 8; m++) {
        const mm = String(m).padStart(2, '0');
        F[`${B}/Transactions/Acct ${a}/2026-${mm}.md`] = tx(Array.from({ length: 30 }, (_, r) => [`2026-${mm}-${String((r % 27) + 1).padStart(2, '0')}`, 'Shop', '', -10]));
      }
    }
    const ctx = makeCtx(F, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);
    const t0 = process.hrtime.bigint();
    let idx; for (let i = 0; i < 15; i++) idx = ctx.accountIndex();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    eq(idx.size, 40, 'every account is indexed');
    for (const [a, e] of idx) eq(e.rows.length, 240, `${a.name} has all its rows`);
    ok(ms < 60, `fifteen rebuilds at 40 accounts x 320 files stay cheap (${ms.toFixed(0)} ms; the scan took ~47)`);
    /* Equivalence with the scan it replaced, on the labels that could differ:
       case, NFC/NFD and a sanitised colon. */
    for (const label of ['Acct 3', 'acct 3', 'ACCT 3']) {
      const viaScan = ctx.accountForLabel(label);
      let viaIdx = null; for (const [a, e] of idx) if (e.labels.has('Acct 3')) viaIdx = a;
      eq(viaScan, viaIdx, `"${label}" resolves to the same account either way`);
    }
    void S;
  }

  /* ================= #72 — two accounts, one folder, named ============= */
  {
    const ctx = makeCtx({ ...SETTINGS,
      [`${B}/Accounts/Cheque One.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000\n---\n',
      [`${B}/Accounts/Cheque Two.md`]: '---\ntype: checking\ntx_label: "cheque"\nbalance: 5000\n---\n',
      [`${B}/Accounts/Savings.md`]: '---\ntype: savings\ntx_label: "Savings"\nbalance: 5000\n---\n',
    }, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);
    eq(S.accountsDuplicated, [{ label: 'cheque', first: 'Cheque One', second: 'Cheque Two' }],
      'a case-only collision is still one folder, and both claimants are named');
    const clean = makeCtx(SETTINGS, { settings: { month_start_day: 1 } });
    eq((await loadInto(clean)).accountsDuplicated, [], 'and a vault with no collision reports none');
  }

  /* ================= #73 — a future period has nothing so far ========== */
  {
    const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx); S.period = PERIOD;
    const ahead = ctx.periodSummary(PERIOD, '2026-08-31');
    eq([ahead.income, ahead.spend], [0, 0], 'viewed before it starts, the period has earned and spent nothing');
    eq(ahead.scheduled, { income: 40000, spend: 6590, count: 11, from: '2026-09-01' },
      'and everything it holds is scheduled — stated ONCE, not in both places');
    eq(ahead.asOf, '2026-09-01', 'as of the day it begins');
    const done = ctx.periodSummary(PERIOD, '2026-10-05');
    eq([done.income, done.spend, done.scheduled.count], [40000, 6590, 0], 'a finished period is whole, nothing ahead');
  }

  /* ================= #62 / #70 — through the real importer ============= */
  {
    const { FakeEl } = makeDom();
    const mk = loc => {
      const els = {};
      const ctx = {
        S: { settings: { currency: 'R', country: 'za', month_start_day: 1 }, accounts: [], categories: [], rules: [], txFiles: {}, budgets: {}, period: '2026-08' },
        $: sel => (els[sel] ||= new FakeEl('div')), $$: () => [], app: {},
        money: v => `R ${Number(v).toFixed(2)}`, moneyIn: (s, v) => `${s} ${Number(v).toFixed(2)}`,
        toast() {}, async writeFile() {}, currentPeriod: () => '2026-08',
        periodRange: () => ({ start: '2026-08-01', end: '2026-08-31' }), periodTitle: () => 'Aug',
        deferredCatSelect: () => new FakeEl('select'), serializeTxFile: () => '',
        locale: () => loc, learnRules() {}, txSegment: s => s, accountForLabel: () => null,
        provide(o) { Object.assign(ctx, o); }, _els: els,
      };
      registerImport(ctx); return ctx;
    };
    const file = t => ({ name: 's.csv', async arrayBuffer() { return new TextEncoder().encode(t).buffer; } });
    const ZA = { dayFirst: true, thousands: ' ', decimal: ',', banks: null, importHint: '' };

    const us = mk(ZA);
    await us.handleStatementFile(file('Date,Description,Amount\n01/03/2026,A,-10.00\n01/28/2026,B,-10.00\n02/05/2026,C,-10.00\n02/11/2026,D,-10.00\n03/02/2026,E,-10.00\n03/19/2026,F,-10.00\n'));
    const d = us.S.pendingImport.items.map(i => i.date);
    eq(d, ['2026-01-03', '2026-01-28', '2026-02-05', '2026-02-11', '2026-03-02', '2026-03-19'],
      'a US file on a day-first household is read the way its own order supports');
    eq(us.S.pendingImport.dateReading, 'month-first', 'and the decision is recorded');
    ok(us._els['#impDateReading'].textContent.length > 20, 'and said on the review screen');

    const za = mk(ZA);
    await za.handleStatementFile(file('Date,Description,Amount\n03/01/2026,A,-10.00\n28/01/2026,B,-10.00\n05/02/2026,C,-10.00\n'));
    eq(za.S.pendingImport.dateReading, null, 'a genuine DD/MM file keeps the household reading, with no banner');

    const eu = mk({ dayFirst: true, thousands: '.', decimal: ',', banks: null, importHint: '' });
    await eu.handleStatementFile(file('Date,Description,Amount\n01.08.2026,A,-250.000\n02.08.2026,B,-75.000\n03.08.2026,C,850.000\n'));
    eq(eu.S.pendingImport.items.map(i => i.amount), [-250000, -75000, 850000],
      'with no evidence in the file, the household\'s own separator decides — not a thousandfold guess');
    const usd = mk({ dayFirst: false, thousands: ',', decimal: '.', banks: null, importHint: '' });
    await usd.handleStatementFile(file('Date,Description,Amount\n08/01/2026,A,-250.000\n'));
    eq(usd.S.pendingImport.items.map(i => i.amount), [-250], 'and on a comma household 250.000 is a decimal');
    const ev = mk({ dayFirst: false, thousands: ',', decimal: '.', banks: null, importHint: '' });
    await ev.handleStatementFile(file('Date,Description,Amount\n08/01/2026,A,-250.000\n08/02/2026,B,-1.500.000\n'));
    eq(ev.S.pendingImport.items.map(i => i.amount), [-250000, -1500000], 'evidence in the file still beats the profile');
  }

  console.log(`PASS audit-batch-three (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
