'use strict';
/* Two-digit years and month-name-first dates (2026-11-25 audit, IMP-6).

   parseStatementDate rejected `22/11/26`, `22-Nov-26` and `Nov 22, 2026`, so a
   statement written that way had every row skipped as unparseable, or went to
   the column mapper, which cannot fix a date format either.

   Each form now has an explicit rule, as the function's own note asks:

     - a two-digit year is 20YY, always (the pivot is "never 19YY": a bank
       export with a two-digit year is a recent download, and a 1990s date read
       as 2090s would be rejected later as a future date rather than silently
       filed in the past);
     - an all-two-digit date is DD/MM/YY or MM/DD/YY, chosen exactly as for a
       four-digit year — NEVER YY/MM/DD. `26/11/22` is the 26th of November
       2022, not 22 November 2026. No supported bank writes YY/MM/DD, and a
       four-digit-year ISO date is unaffected;
     - month name first: `Nov 22, 2026`, `November 22 2026`.

   Year-less dates (`22 Dec`) are NOT read: the cell carries no year and the
   only anchor this pure function could use is today's clock, which is not the
   statement's evidence — a two-year-old export would be filed in the wrong
   year without a word. They stay null.

     node tests/statement-date-forms.test.cjs */

const assert = require('assert');
const { mountReview } = require('./helpers/import-review-ctx.cjs');   // stubs obsidian before the view loads
const { parseStatementDate } = require('../src/statement');
const { decideDayFirst } = require('../src/views/import');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

for (const [cell, dayFirst, want, why] of [
  ['22/11/26', true, '2026-11-22', 'DD/MM/YY'],
  ['22-11-26', true, '2026-11-22', 'with dashes'],
  ['22.11.26', true, '2026-11-22', 'with dots'],
  ['11/22/26', false, '2026-11-22', 'MM/DD/YY under a month-first profile'],
  ['11/22/26', true, '2026-11-22', 'a day past 12 corrects the order, as for four-digit years'],
  ['01/02/26', true, '2026-02-01', 'ambiguous: follows the profile, day first'],
  ['01/02/26', false, '2026-01-02', '…or month first'],
  ['26/11/22', true, '2022-11-26', 'NEVER read as YY/MM/DD: the year is the last field'],
  ['31/02/26', true, null, 'the calendar still applies'],
  ['22/11-26', true, null, 'mixed separators in a two-digit-year date are not a date'],
  ['22/11/26 08:15', true, '2026-11-22', 'a trailing clock time is dropped first'],
  ['22-Nov-26', true, '2026-11-22', 'DD-Mon-YY'],
  ['22 Nov 26', true, '2026-11-22', 'DD Mon YY'],
  ['22Nov26', true, '2026-11-22', 'run together'],
  ['22 Okt 26', true, '2026-10-22', 'an Afrikaans month'],
  ['Nov 22, 2026', true, '2026-11-22', 'month name first, with the comma'],
  ['November 22, 2026', false, '2026-11-22', 'the whole month name'],
  ['Nov 22 2026', true, '2026-11-22', 'without the comma'],
  ['Nov. 3, 2026', true, '2026-11-03', 'an abbreviation with its full stop'],
  ['Feb 30, 2026', true, null, 'the calendar applies here too'],
  ['Nov 22, 26', true, null, 'month first takes a four-digit year only'],
  ['22 Dec', true, null, 'year-less: no year anchor this function can justify'],
  ['03 Jan', true, null, 'year-less'],
  ['JUN 12', true, null, 'still not a date'],
  ['PICK N PAY 1234', true, null, 'still not a date'],
  // Four-digit years: untouched.
  ['2026-11-22', true, '2026-11-22', 'ISO unchanged'],
  ['22/11/2026', true, '2026-11-22', 'DD/MM/YYYY unchanged'],
  ['01/02/2026', false, '2026-01-02', 'MM/DD/YYYY unchanged'],
  ['22 Nov 2026', true, '2026-11-22', 'DD Mon YYYY unchanged'],
]) {
  eq(parseStatementDate(cell, dayFirst), want, `parseStatementDate(${JSON.stringify(cell)}, ${dayFirst}) — ${why}`);
}

/* The day/month decision reads two-digit years the same way it reads four. */
eq(decideDayFirst(['10/01/26', '11/01/26', '12/01/26', '13/01/26'], false, '2026-12-01').dayFirst, true,
  'a file whose two-digit-year dates only run in order day-first is read day-first');

/* And a statement written that way now imports instead of skipping every row. */
(async () => {
  const v = mountReview({ accounts: [{ name: 'Cheque', tx_label: 'Cheque', type: 'checking', in_budget: true }] });
  const p = await v.load('Date,Description,Amount\n22/11/26,SHOP,-100.00\n23-Nov-26,SHOP B,-200.00\n"Nov 24, 2026",SHOP C,-5.00\n', 'statement.csv');
  eq(p.items.map(i => i.date), ['2026-11-22', '2026-11-23', '2026-11-24'], 'two-digit-year and month-first rows import');
  eq(p.skipped, 0, 'and none is skipped');
  console.log(`PASS statement-date-forms — two-digit years and month-first dates read by explicit rules, year-less ones left alone (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
