'use strict';
/* The health averages leave an incompletely imported period out.

   healthSnapshot averages the six periods before the current one and counts a
   period "completed" the moment the household did anything in it. For a
   household that imports at month end and whose periods open on the 22nd, the
   day a new period opens the period that just closed holds statements that
   stop weeks before its last day: salary in, most of the spending not yet
   imported. Counted, it pulled every average toward "saved a lot, spent
   nothing". On the real vault this was found on, nothing in the vault changed
   between 21 and 22 October, yet the Score jumped seven points and the cover and
   saving-rate lines moved with it (2026-10-14 audit, L1-04 / L2a-N04).

   The decision (Ruan's default): a period is complete only once every in-budget
   account something is imported into has been imported to (or past) its last
   day. An incomplete trailing period is left out of the averages, and "Averaged
   over your last N completed periods" stays true because N is the count of
   periods actually used. Accounts that cannot hold a period up are named in
   the negative controls below.

     node tests/health-incomplete-period.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { atAuditDate } = require('./_audit-seed.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TX_FM = '---\nkind: transactions\n---';
const table = rows =>
  `${TX_FM}\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n${rows.join('\n')}\n`;
const rowOf = (d, desc, cat, amt) => `| ${d} | ${desc} | ${cat} | ${amt.toFixed(2)} | | | |`;

/* Periods open on the 22nd: 2026-10 is 22 Sep to 21 Oct. Salary on the 22nd,
   groceries on the 5th, so a statement that stops on 26 Sep holds the salary
   and none of the month's groceries. */
const SETTINGS = { month_start_day: 22, currency: 'R', country: 'za' };
const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const monthRows = (through) => {
  const rows = [];
  for (const m of MONTHS) {
    const [y, mo] = m.split('-').map(Number);
    const prev = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
    rows.push(rowOf(`${prev}-22`, 'Salary', 'Salary', 45000));
    rows.push(rowOf(`${m}-05`, 'Groceries', 'Groceries', -10000));
  }
  return rows.filter(r => r.slice(2, 12) <= through);
};

/* One file per calendar month, the folder layout the loader reads. */
const byMonth = (label, rows) => {
  const out = {};
  for (const r of rows) (out[r.slice(2, 9)] ??= []).push(r);
  return Object.fromEntries(Object.entries(out).map(([m, rs]) => [`${B}/Transactions/${label}/${m}.md`, table(rs)]));
};

/* Imported through the last day of 2026-10: a row dated the 21st itself, since
   "imported to" is the newest row's date. */
const FULL = [...monthRows('2026-10-21'), rowOf('2026-10-21', 'Interest', 'Salary', 1)];

const files = (cheque, extra = {}) => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 22\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 50000.00\nbalance_updated: 2026-09-26\ntx_label: "Cheque"\n---\n',
  ...byMonth('Cheque', cheque),
  ...extra,
});

async function snapshotOn(today, fileMap) {
  return atAuditDate(async () => {
    const ctx = makeCtx(fileMap, { budgetFolder: B, settings: SETTINGS });
    await loadInto(ctx);
    return ctx.healthSnapshot();
  }, today);
}

(async () => {
  /* ---- 1. the reported shape: imported to 26 Sep, read on 22 Oct ---- */
  {
    const snap = await snapshotOn('2026-10-22', files(monthRows('2026-09-26')));
    const H = snap.metrics;
    /* Periods 2026-05 .. 2026-09 are complete; 2026-10 (22 Sep to 21 Oct) is
       imported only to the 26th. */
    eq(H.countedPeriods, 5, 'five periods are used, not six: the one imported to the 26th is out');
    eq(Math.round(H.monthlyConsumption), 10000, 'so the spending average is a month of groceries, not a sixth of it missing');
    eq(Math.round(H.monthlyIncome), 45000, 'and the income average is untouched');
    eq(snap.incompletePeriods.map(p => p.period), ['2026-10'], 'the period left out is named for any surface that wants to say so');
    eq(snap.incompletePeriods[0].behind, ['Cheque'], 'with the account holding it up');
  }

  /* ---- 2. NEGATIVE CONTROL: the same vault, imported through the period ---- */
  {
    const snap = await snapshotOn('2026-10-22', files(FULL));
    eq(snap.metrics.countedPeriods, 6, 'imported to the last day, the period counts');
    eq(snap.incompletePeriods, [], 'and nothing is left out');
  }

  /* ---- 3. nothing changes between 21 and 22 October that the data did not ---- */
  {
    const f = files(monthRows('2026-09-26'));
    const before = await snapshotOn('2026-10-21', f);
    eq(before.metrics.countedPeriods, 6, 'on the 21st the window is 2026-04..2026-09, all imported through their last day');
    const after = await snapshotOn('2026-10-22', f);
    eq(after.metrics.countedPeriods, 5, 'on the 22nd the window slides one period and the half-imported one is left out: still 5');
    eq(Math.round(after.metrics.monthlyConsumption), Math.round(before.metrics.monthlyConsumption),
      'so the averages do not move when only the clock does');
  }

  /* ---- 4. a second in-budget account imported less far holds earlier periods up ---- */
  {
    const card = {
      [`${B}/Accounts/Card.md`]: '---\ntype: credit_card\nbalance: 0.00\nbalance_updated: 2026-09-15\ntx_label: "Card"\n---\n',
      ...byMonth('Card', [
        rowOf('2026-07-10', 'Shop', 'Groceries', -100), rowOf('2026-08-10', 'Shop', 'Groceries', -100),
        rowOf('2026-09-15', 'Shop', 'Groceries', -100),
      ]),
    };
    const snap = await snapshotOn('2026-10-22', files(FULL, card));
    /* Card imported to 15 Sep: 2026-09 (22 Aug to 21 Sep) and 2026-10 are both
       beyond it. 2026-05 .. 2026-08 are complete. */
    eq(snap.incompletePeriods.map(p => p.period), ['2026-09', '2026-10'], 'every period past the slower account\'s import is out');
    eq(snap.metrics.countedPeriods, 4, 'and the count says how many are left');
  }

  /* ---- 5. accounts that must NOT hold a period up ---- */
  {
    const quiet = {
      /* In the budget but dormant: its last row predates the whole window. */
      [`${B}/Accounts/Old.md`]: '---\ntype: checking\nbalance: 0.00\nbalance_updated: 2026-01-01\ntx_label: "Old"\n---\n',
      ...byMonth('Old', [rowOf('2026-01-10', 'Fee', 'Groceries', -50)]),
      /* Opted out of the budget: its rows are not in the averages. */
      [`${B}/Accounts/Joint.md`]: '---\ntype: checking\nbalance: 0.00\nbalance_updated: 2026-08-01\ntx_label: "Joint"\nbudget: false\n---\n',
      ...byMonth('Joint', [rowOf('2026-08-02', 'Rent', 'Groceries', -50)]),
      /* Nothing is imported into it: kept by hand. */
      [`${B}/Accounts/Wallet.md`]: '---\ntype: cash\nbalance: 300.00\nbalance_updated: 2026-06-01\n---\n',
    };
    const snap = await snapshotOn('2026-10-22', files(FULL, quiet));
    eq(snap.metrics.countedPeriods, 6, 'a dormant account, an out-of-budget one and a hand-kept wallet do not block a complete vault');
    eq(snap.incompletePeriods, [], 'and are not named');
  }

  /* ---- 6. a vault with no transaction folders at all is unchanged ---- */
  {
    const bare = files(FULL);
    for (const k of Object.keys(bare)) if (k.includes('/Transactions/')) delete bare[k];
    const snap = await snapshotOn('2026-10-22', bare);
    eq(snap.incompletePeriods, [], 'nothing imported anywhere: no period is judged incomplete');
  }

  /* ---- 7. manual entry has no import to be behind ----
     The newest row of a household typing expenses by hand is simply the last
     thing typed; it says nothing about whether the period is whole. */
  {
    const manual = files(monthRows('2026-09-26'), {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 22\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\ninput_mode: manual\n---\n',
    });
    const snap = await snapshotOn('2026-10-22', manual);
    eq(snap.incompletePeriods, [], 'in manual mode no period is judged by when rows stop');
    eq(snap.metrics.countedPeriods, 6, 'so every period with activity counts, as before');
  }

  console.log(`PASS health-incomplete-period.test.cjs (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
