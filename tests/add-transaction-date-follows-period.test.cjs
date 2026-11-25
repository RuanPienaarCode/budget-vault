'use strict';
/* Add transaction opens on a day inside the period the reader is looking at.

   It always opened on today. Reading August in October and adding a cash spend
   filed the row under October's month file: the list the reader was looking at
   did not change, and only the toast named the month the row had gone to
   (2026-11-25 audit, FUN-4).

   Now the date is today when today is inside the viewed period, the period's
   LAST day when it is over, and its FIRST day when it has not begun. Judged by
   the period's own boundaries, so a payday month (22 Jul – 21 Aug is "August")
   and an interval period are measured by what they hold, not by the calendar
   month their name suggests. A kept draft still wins, and "whole history" has
   no period on screen, so it is today.

     node tests/add-transaction-date-follows-period.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const asked = [];
const answers = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async (_app, title, fields) => { asked.push({ title, fields }); return answers.length ? answers.shift() : null; },
      confirmModal: async () => true,
      askSplit: async () => null, askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');

const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n';
const files = settings => ({
  [`${B}/Settings.md`]: `---\n${settings}currency: "R"\ncountry: za\n---\n`,
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-01-01\n---\n',
  [`${B}/Transactions/Cheque/2026-10.md`]: '---\naccount: "Cheque"\nmonth: 2026-10\n---\n\n' + HEAD + '| 2026-10-01 | Coffee | Food | -35.00 |  |  |\n',
});

/* The date Add transaction opened on, for a page showing `period`. */
async function openedOn(settings, period, { whole = false, draft = null } = {}) {
  const { ctx, S } = await mountFor(files(settings), { period, budgetFolder: B });
  ctx.render = () => {};
  ctx.switchView = () => {};
  S.period = period;
  if (whole) {
    const box = ctx.$('#txWholeHistory');
    box.checked = true;
  }
  if (draft) {
    // A refused add keeps its entry; the next open starts from it.
    answers.push({ ...draft });
    S.txFiles['Cheque/2026-10'].dirty = true;
    await ctx.addTransaction();
    S.txFiles['Cheque/2026-10'].dirty = false;
  }
  answers.push(null);
  await ctx.addTransaction();
  return asked[asked.length - 1].fields.find(f => f.key === 'date').value;
}

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    const MONTHLY = 'month_start_day: 1\n';

    eq(await openedOn(MONTHLY, '2026-10'), '2026-10-07', 'today is inside the viewed period: today, as before');
    eq(await openedOn(MONTHLY, '2026-08'), '2026-08-31',
      'a past period opens on its last day, so the row lands in the list being read');
    eq(await openedOn(MONTHLY, '2027-02'), '2027-02-01', 'a future period opens on its first day');
    eq(await openedOn(MONTHLY, '2028-02'), '2028-02-01', 'whatever the distance');
    eq(await openedOn(MONTHLY, '2024-02'), '2024-02-29', 'the last day is the period\'s own — a leap February ends on the 29th');

    /* A payday month is named for the month it ENDS in and runs 22nd to 21st:
       "August" is 22 Jul – 21 Aug, so its last day is 21 Aug, not 31 Aug, and
       today (7 Oct) is inside "October" (22 Sep – 21 Oct). */
    const PAYDAY = 'month_start_day: 22\n';
    eq(await openedOn(PAYDAY, '2026-08'), '2026-08-21', 'a payday month ends on its own boundary, not the calendar month\'s');
    eq(await openedOn(PAYDAY, '2026-12'), '2026-11-22', 'and a future one begins on the 22nd of the month before its name');
    eq(await openedOn(PAYDAY, '2026-10'), '2026-10-07', 'the payday month that holds today opens on today');

    /* An interval period is named for the day it starts on. 14-day periods
       from 2026-09-01: 09-29 to 10-12 holds today; 09-15 to 09-28 is over. */
    const FORTNIGHT = 'month_start_day: 1\nperiod_anchor: 2026-09-01\nperiod_days: 14\n';
    eq(await openedOn(FORTNIGHT, '2026-09-29'), '2026-10-07', 'an interval period that holds today: today');
    eq(await openedOn(FORTNIGHT, '2026-09-15'), '2026-09-28', 'an earlier one: its last day');
    eq(await openedOn(FORTNIGHT, '2026-10-13'), '2026-10-13', 'a later one: its first day');

    /* The reader's draft wins over all of it: a refused add (the month had
       unsaved edits) keeps what was typed, date included. */
    eq(await openedOn(MONTHLY, '2026-08', { draft: { date: '2026-10-03', desc: 'Bakery', label: 'Cheque', dir: 'out', amount: '20', cat: 'Food', note: '' } }),
      '2026-10-03', 'a kept draft\'s date is used, not the period\'s');

    /* Whole history has no period on screen. */
    eq(await openedOn(MONTHLY, '2026-08', { whole: true }), '2026-10-07', 'whole history: today');

    console.log(`PASS add-transaction-date-follows-period — the new row lands in the period on screen (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
