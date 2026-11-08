'use strict';
/* src/miles.js — reading a Discovery Miles export, and putting it in rand.

   Pure node, no obsidian, no DOM. The fixture below is INVENTED — merchants,
   dates and figures are made up and only the SHAPES are the real export's
   (header, ISO dates newest-first, signed whole Miles, a rand value printed in
   the Type of a redemption, a stray control character in Additional
   information, `No reward` rows at 0.00, an empty Type, identical rows on one
   day). Never put real statement data in this repo; it is public.

   What is pinned, and why each one is here:

     1. DETECTION. A Miles file is recognised by its header (a Miles column, no
        amount column) — and the three negative controls matter as much as the
        positive: a sheet that has BOTH a Miles and an Amount column keeps its
        amount; a Date/Description/Miles sheet with no Type column (a mileage
        log) is only a Miles export when its filename says so; and an ordinary
        bank statement is nothing to do with any of it.
     2. ONE RATE. amount = Miles x rate, to the cent, sign preserved. The
        synthetic file reproduces the real file's trap: redemptions print rand
        values at ~7.4 Miles to the rand while Miles are earned at 10, so
        booking the PRINTED value drives the account balance negative while
        the Miles balance is positive. The test computes both and asserts that
        only the single rate keeps `balance = total Miles x rate`.
     3. WHAT A ROW BECOMES. Description (with the Type's label in front of it
        except on a plain Base Miles earn), the Note, cat left empty, and the
        rows that are skipped — counted apart, never silently.
     4. THE NOTE ROUND-TRIPS. parseMilesNote recovers the exact Miles count, the
        printed value and the info from what milesNote wrote, survives text
        appended after it, and refuses anything that is not ours.
     5. DEDUPE with multiplicity, through the real src/dedupe.js: re-importing
        the same export adds nothing; an overlapping later export adds only
        what is new; and three identical rows on one day against four
        identical rows on one day adds exactly one.

     node tests/miles.test.cjs */

const assert = require('assert');
const {
  detectMilesExport, milesRows, milesToRand, milesNote, parseMilesNote,
  milesFilenameNumber, isMilesFilename, milesRate, milesDescription, splitType,
  MILES_RATE_DEFAULT, MILES_RATE_MAX,
} = require('../src/miles');
const { parseStatement, detectStatementColumns } = require('../src/statement');
const { buildIndex, addToIndex, flagItems } = require('../src/dedupe');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ------------------------------------------------------------- the fixture */
const HEADER = ['Value Date', 'Type', 'Description', 'Additional information', 'Miles'];
/* The bank's own file: every field quoted, CRLF line ends. Built as text and
   read back through parseStatement, so the test goes through the same reader
   the importer does and not through a hand-made array of arrays. */
const toCsv = rows => [HEADER, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\r\n') + '\r\n';
const COFFEE = ['2026-10-18', 'Basket value - R 25.00', 'Discovery Miles Redeemed For Coffee Bar', '', '-190.00'];
const ROWS_A = [
  ['2026-10-20', 'Base Miles', 'Fuel Stop Central', '2026-10-20 - R 480.00', '48.00'],
  ['2026-10-19', 'Vitality Money', 'Fuel Station', '2026-10-19 \u0014  R 833.00', '83.00'],
  ['2026-10-18', 'Basket value - R 1,019.00', 'Discovery Miles Redeemed For Outdoor Shop', '', '-7500.00'],
  COFFEE, COFFEE, COFFEE,
  ['2026-10-17', 'No reward', 'Streaming Service 99.00 Zar', '', '0.00'],
  ['2026-10-16', 'Prepaid Electricity - R150.00', 'Cape Town', '', '-1100.00'],
  ['2026-10-15', '', 'Gameboard - Coin tile', '', '20.00'],
  ['2026-10-14', 'Base Miles Reverse', 'Fuel Stop Central', '2026-10-14 - R 480.00-', '-48.00'],
  ['2026-10-10', 'Miles Received', 'From Alex', ' - ', '10000.00'],
  ['2026-10-01', 'Base Miles', 'Greengrocer Plaza', '2026-10-01 - R 1,250.00', '125.00'],
];
const read = rows => parseStatement(toCsv(rows));
const FILE_A = 'DiscoveryBankMiles_12345678901_20221001_20261020.csv';

const rowsA = read(ROWS_A);
const mapA = detectMilesExport(rowsA, FILE_A);

/* ---- 1. detection ---- */
ok(mapA, 'the Discovery Miles header is recognised');
eq([mapA.iDate, mapA.iType, mapA.iDesc, mapA.iInfo, mapA.iMiles], [0, 1, 2, 3, 4], 'columns resolved by header name');
eq([mapA.iAmount, mapA.iDebit, mapA.iCredit, mapA.iBalance, mapA.dataStart, mapA.headerIdx], [-1, -1, -1, -1, 1, 0],
  'shaped like a statement column map, so "Columns wrong?" can reopen the mapper on it');
ok(detectMilesExport(rowsA, 'whatever.csv'), 'the Type column makes the header enough: no filename needed');
/* The premise this feature was first written on — "no amount column, so the
   statement reader rejects it and the manual mapper opens" — is FALSE, and this
   pins what actually happens. The header names no amount, so it is not read as a
   header at all; the headerless SHAPE detector then runs, finds a date in column
   0, text to its left and a column of numbers on the right, and answers with the
   Miles column as the Amount and "Additional information" as the description.
   No mapper, no question: a Miles file dropped today imports one rand per Mile
   (R667,502 of "income" on the real file) under a review screen that looks
   routine. That is why Miles is asked BEFORE detectStatementColumns. */
const naive = detectStatementColumns(rowsA, true);
eq([naive.iAmount, naive.iDesc, naive.headerIdx], [4, 3, -1],
  'the statement reader does NOT reject it: it reads Miles as the amount, 1 rand a Mile, with no header and no question');

// Negative controls.
const sheet = (head, ...rows) => parseStatement([head, ...rows].map(r => r.join(',')).join('\n') + '\n');
ok(detectMilesExport(sheet(['Date', 'Description', 'Miles', 'Amount'], ['2026-01-02', 'Fuel', '12', '-40.00']), 'DiscoveryBankMiles_1234_x.csv') === null,
  'a file with an Amount column keeps its amount, filename or not');
ok(detectMilesExport(sheet(['Date', 'Description', 'Miles', 'Debit', 'Credit'], ['2026-01-02', 'Fuel', '12', '40.00', '']), 'x.csv') === null,
  'and so does a Debit/Credit pair');
ok(detectMilesExport(sheet(['Date', 'Description', 'Miles'], ['2026-01-02', 'Work trip', '312']), 'trips.csv') === null,
  'Date/Description/Miles with no Type column and no Miles in the filename is a mileage log, not a rewards export');
ok(detectMilesExport(sheet(['Date', 'Description', 'Miles'], ['2026-01-02', 'Work trip', '312']), 'DiscoveryBankMiles_1234_x.csv'),
  'the same thin header IS a Miles export when the filename says so');
ok(detectMilesExport(sheet(['Date', 'Description', 'Amount', 'Balance'], ['2026-01-02', 'Shop', '-5.00', '95.00']), 'DiscoveryBank_12345678901_x.csv') === null,
  'an ordinary bank statement is not a Miles export');
ok(detectMilesExport([], 'x.csv') === null && detectMilesExport(null, 'x.csv') === null, 'nothing in, nothing detected');
ok(detectMilesExport(sheet(['Type', 'Description', 'Miles'], ['Base Miles', 'Shop', '5']), 'x.csv') === null,
  'no date column, no export');

eq(milesFilenameNumber(FILE_A), '12345678901', 'the account number is read out of the filename');
eq(milesFilenameNumber('DiscoveryBank_12345678901_20220101_20221231.csv'), '', 'a bank statement filename is not a Miles one');
eq(milesFilenameNumber('statement.csv'), '', 'no number, no answer');
ok(isMilesFilename(FILE_A) && !isMilesFilename('DiscoveryBank_1234_x.csv'), 'isMilesFilename');

/* ---- 2. one rate ---- */
const r = milesRows(rowsA, mapA, { rate: 0.1 });
eq(r.items.length, 11, 'twelve data rows less the one 0.00 row are imported');
eq([r.zero, r.skipped, r.tooSmall], [1, 0, 0], 'the zero row is counted apart, nothing is "unparseable"');
eq(r.miles, 1058, 'the signed Miles total of what was imported');
const cents = list => list.reduce((s, i) => s + Math.round(i.amount * 100), 0);
eq(cents(r.items), 10580, 'balance = total Miles x rate: 1058 Miles at 10 to the rand is R105.80');
eq(r.items.map(i => i.amount).slice(0, 3), [4.8, 8.3, -750], 'every row is its own Miles x rate (48 -> 4.80, 83 -> 8.30, -7500 -> -750.00)');

/* The trap, reproduced: book each redemption at the rand value it PRINTED and
   the same file's balance goes negative while its Miles balance is positive. */
const printedRand = r.items.reduce((s, i) => {
  const n = parseMilesNote(i.note);
  return s + (n.printed != null ? Math.sign(i.miles) * n.printed : i.miles * 0.1);
}, 0);
ok(printedRand < 0 && r.miles > 0,
  `booking printed values gives ${printedRand.toFixed(2)} for a file with a positive Miles balance — the reason the rate is fixed`);
ok(cents(r.items) > 0, 'whereas the single rate keeps the balance positive with the Miles');

// A different rate scales everything, and a reversal is exactly its earn negated.
/* A rate that is not a whole number of cents per Mile is rounded PER ROW (the
   module header says so). That can drift from total Miles x rate by up to half a
   cent a row — here 10.375 -> 10.38 pushes R132.25 to R132.26 — and the Miles
   count in each Note stays exact, so nothing is lost. Pinned as a bound, not as
   a number to be argued with: the drift never exceeds half a cent per row. */
const odd125 = milesRows(rowsA, mapA, { rate: 0.125 });
ok(Math.abs(cents(odd125.items) - 1058 * 12.5) <= odd125.items.length / 2,
  `at 12.5c a Mile the per-row rounding stays within half a cent a row (R${cents(odd125.items) / 100} against R132.25)`);
ok(odd125.items.every(i => i.amount === milesToRand(i.miles, 0.125)), 'and every row is its own Miles x rate');
const earn = milesToRand(48, 0.1), back = milesToRand(-48, 0.1);
eq(earn, -back, 'a reversal is exactly the negative of the earn it reverses');
eq(milesToRand(0.05, 0.1) , 0.01, 'half a cent rounds AWAY from zero …');
eq(milesToRand(-0.05, 0.1), -0.01, '… in both directions (Math.round alone would send -0.5 toward zero)');
eq(milesToRand(62.31, 0.1), 6.23, 'two-place Miles are rounded to the cent');
eq(milesToRand(500, 0.1), 50, 'whole Miles at the default rate are exact');
eq(milesToRand(7500, 'junk'), 750, 'an unreadable rate is the default, not zero');

eq(milesRate(undefined), MILES_RATE_DEFAULT, 'absent rate is the default');
eq(milesRate(''), MILES_RATE_DEFAULT, 'blank rate is the default');
eq(milesRate('abc'), MILES_RATE_DEFAULT, 'unreadable rate is the default — not the minimum');
eq(milesRate(0), MILES_RATE_DEFAULT, 'a zero rate would value every Mile at nothing: default');
eq(milesRate(-3), MILES_RATE_DEFAULT, 'negative: default');
eq(milesRate('0,12'), 0.12, 'a decimal comma is read as one');
eq(milesRate(' 0.125 '), 0.125, 'whitespace is not a parse failure');
eq(milesRate(10), MILES_RATE_MAX, 'above the ceiling clamps for a hand-edited file');

// A rate too small to make a cent of a fractional Mile: named, not dropped.
const tiny = milesRows(read([['2026-10-20', 'Base Miles', 'Shop', '', '0.04'], ['2026-10-20', 'Base Miles', 'Shop 2', '', '5.00']]),
  detectMilesExport(read([]), 'x') || { ...mapA, dataStart: 1 }, { rate: 0.1 });
eq([tiny.items.length, tiny.tooSmall, tiny.zero], [1, 1, 0], 'a Miles figure the rate rounds to R0.00 is counted as too small, not lost silently');

/* ---- 3. what a row becomes ---- */
const byDesc = d => r.items.find(i => i.desc === d);
eq(r.items[0].desc, 'Fuel Stop Central', 'a plain Base Miles earn keeps the merchant alone as its description');
eq(byDesc('Prepaid Electricity — Cape Town').amount, -110, 'a redemption says what it was, not just where: "Prepaid Electricity — Cape Town"');
eq(byDesc('Vitality Money — Fuel Station').amount, 8.3, 'a Vitality earn leads with its Type (the same description recurs under two Types)');
eq(byDesc('Base Miles Reverse — Fuel Stop Central').amount, -4.8, 'a reversal is told from the earn it undoes');
eq(byDesc('Gameboard - Coin tile').amount, 2, 'an empty Type is the description alone');
eq(byDesc('Miles Received — From Alex').amount, 1000, 'Miles Received leads with its Type too');
ok(r.items.some(i => i.desc === 'Basket value — Discovery Miles Redeemed For Outdoor Shop'), 'a basket redemption is labelled');
ok(r.items.every(i => i.cat === '' && i.include === true && i.excluded === false), 'uncategorised, ticked, not excluded');
eq(milesDescription('Vitality Money', 'Vitality Money rewards'), 'Vitality Money rewards', 'a description that already leads with the label is not said twice');
eq(milesDescription('Base Miles', 'Shop'), 'Shop', 'Base Miles — case-insensitive');
eq(milesDescription('base miles', 'Shop'), 'Shop', 'Base Miles is judged without case');
eq(milesDescription('Prepaid airtime', ''), 'Prepaid airtime', 'an empty description is the label');
eq(splitType('Basket value - R 1,019.00'), { label: 'Basket value', printed: 1019 }, 'the printed value comes off the Type, grouping comma and all');
eq(splitType('Data bundle - R89.00'), { label: 'Data bundle', printed: 89 }, 'without a space after the R');
eq(splitType(' - R150.00'), { label: '', printed: 150 }, 'with nothing before the dash');
eq(splitType('Plan R5'), { label: 'Plan R5', printed: null }, 'a Type that merely ends in R5 is a name, not a value');
eq(splitType('Base Miles'), { label: 'Base Miles', printed: null }, 'no value, no printed');

// The bank's stray control character and its "nothing" dash.
const vit = byDesc('Vitality Money — Fuel Station');
eq(vit.note, 'Miles: 83.00 · Info: 2026-10-19 R 833.00', 'the control character becomes a space and runs collapse');
ok(!/[\u0000-\u001f|\n\r]/.test(r.items.map(i => i.desc + i.note).join('')), 'no control character, pipe or newline reaches a markdown cell');
eq(byDesc('Miles Received — From Alex').note, 'Miles: 10000.00', 'a lone dash in Additional information is "nothing", not a fact');
eq(byDesc('Prepaid Electricity — Cape Town').note, 'Miles: -1100.00 · Printed: R150.00', 'a redemption keeps its printed value in the note');

// Rows that are not rows.
const odd = milesRows(read([
  ['2026-10-20', 'Base Miles', 'Shop', '', '5.00'],
  ['not a date', 'Base Miles', 'Shop', '', '5.00'],     // a Miles figure but no readable date: skipped
  ['2026-10-20', 'Base Miles', 'Shop', '', 'n/a'],      // a date but no readable Miles: skipped
  ['2026-10-20', '', '', '', '5.00'],                   // nothing to call it: skipped
  ['', '', '', '', ''],                                 // a blank line: ignored without a word
]), mapA, { rate: 0.1 });
eq([odd.items.length, odd.skipped, odd.zero], [1, 3, 0], 'three unusable rows are reported as skipped; the blank line is not');

/* ---- 4. the note round-trips ---- */
for (const it of r.items) {
  const n = parseMilesNote(it.note);
  ok(n && n.miles === it.miles, `the Miles count survives the note: ${it.note}`);
}
eq(parseMilesNote(milesNote({ miles: -1019.5, printed: 1019, info: '2026-10-18 - R 1,019.00' })),
  { miles: -1019.5, printed: 1019, info: '2026-10-18 - R 1,019.00' }, 'miles, printed and info come back as written');
eq(parseMilesNote('Miles: 48.00 · Info: x · Excluded during import').miles, 48, 'text an importer appends after ours leaves the count readable');
eq(parseMilesNote('Miles: 48.00 and my own words'), null, 'but the lead segment itself must be exactly the count — a note we did not write is refused');
eq(parseMilesNote('paid 48 miles'), null, 'loose digits are not a count');
eq(parseMilesNote(''), null, 'blank');
eq(parseMilesNote(undefined), null, 'absent');
eq(parseMilesNote(milesNote({ miles: 5, printed: null, info: 'a · b' })).info, 'a - b', 'the separator cannot be smuggled into the info');

/* ---- 5. dedupe, with multiplicity, through the real src/dedupe.js ---- */
const LAB = 'discovery miles';
const importInto = (index, items) => {
  const flags = flagItems(items, index, LAB, null);
  for (const it of items) if (!it.dup) addToIndex(index, it.date, it.desc, it.amount, LAB);
  return { ...flags, added: items.filter(i => !i.dup).length };
};
const vault = buildIndex({});
const first = importInto(vault, milesRows(rowsA, mapA, { rate: 0.1 }).items);
eq([first.dupes, first.added], [0, 11], 'into an empty vault every row is new — including all three identical coffee rows');

const again = importInto(vault, milesRows(read(ROWS_A), detectMilesExport(read(ROWS_A), FILE_A), { rate: 0.1 }).items);
eq([again.dupes, again.added], [11, 0], 're-importing the same export adds nothing');

// An overlapping, later export: drops the oldest rows, keeps the 14-20 Oct window
// (with a FOURTH identical coffee row on the 18th) and adds two new days.
const ROWS_B = [
  ['2026-11-02', 'Base Miles', 'Greengrocer Plaza', '2026-11-02 - R 300.00', '30.00'],
  ['2026-10-28', 'Base Miles', 'Fuel Stop Central', '2026-10-28 - R 500.00', '50.00'],
  ...ROWS_A.slice(0, 5), COFFEE, ...ROWS_A.slice(5, 10),
];
const rowsB = read(ROWS_B);
const overlap = importInto(vault, milesRows(rowsB, detectMilesExport(rowsB, 'DiscoveryBankMiles_12345678901_20221001_20261102.csv'), { rate: 0.1 }).items);
eq(overlap.added, 3, 'an overlapping export adds the two new days and the fourth identical coffee row — and nothing else');
eq(overlap.dupes, 9, 'the nine rows the vault already had (the 14-20 Oct window, 3 coffee rows among them) are recognised');

// Identical rows against identical rows, one for one.
const three = milesRows(read([COFFEE, COFFEE, COFFEE]), mapA, { rate: 0.1 }).items;
const four = milesRows(read([COFFEE, COFFEE, COFFEE, COFFEE]), mapA, { rate: 0.1 }).items;
const v2 = buildIndex({});
importInto(v2, three);
const f4 = importInto(v2, four);
eq([f4.dupes, f4.added], [3, 1], 'three identical rows in the vault against four on the statement: exactly one is new');

console.log(`PASS miles — a Discovery Miles export is read in rand at one rate, notes round-trip, dedupe counts identical rows (${checks} checks)`);
