'use strict';
/* Statement import: which way round the dates go, and what counts as unreadable.

   L2b-05 (Medium). decideDayFirst let the file overrule the household's date
   convention only when exactly one reading kept the rows in date order. A
   month-first export whose days are all 12 or less is in order under BOTH
   readings, so the household default won silently and the statement was dated
   months apart: "07/01 07/03 07/06 07/09 07/12/2026" read as 7 Jan, 7 Mar,
   7 Jun, 7 Sep, 7 Dec - after today, which no statement can hold - and the
   review said nothing. The decision now goes: a reading that loses rows loses;
   a reading that puts a row after today loses; the one that keeps the file in
   date order wins; then the shorter span wins (a statement covers weeks, not
   a year); and when the file STILL cannot decide, the household reading is
   kept and the review says that it was an assumption.

   L2b-06 (Low). runImport counted every dated row that did not become a
   transaction as "unparseable": the 0.00 line an FNB statement prints for a
   waived fee, the Capitec "Exc W/lim" notice with no amount. Neither is
   unreadable, so the review told the reader the importer had failed to read
   rows it had read perfectly well. Only a non-blank amount cell that cannot be
   read counts as unparseable now; a zero or blank amount is counted apart.

   Drives the REAL registerImport(ctx) through handleStatementFile.
     node tests/import-date-order-and-informational-rows.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const registerImport = require('../src/views/import');
const { decideDayFirst } = registerImport;

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1. the decision itself ---- */
ok(typeof decideDayFirst === 'function', 'decideDayFirst is reachable for a bare-node test');
const MONTH_FIRST_FILE = ['07/01/2026', '07/03/2026', '07/06/2026', '07/09/2026', '07/12/2026'];
{
  const r = decideDayFirst(MONTH_FIRST_FILE, true, '2026-07-20');
  eq([r.dayFirst, r.assumed], [false, false],
    'a month-first file on a day-first household: day-first puts four rows after today, so month-first wins - and it is a decision, not an assumption');
}
{
  const r = decideDayFirst(MONTH_FIRST_FILE, true, '2027-03-01');
  eq([r.dayFirst, r.assumed], [false, false],
    'with nothing in the future both readings are in order, and the shorter span (5 days, not 5 months) decides');
}
{
  const r = decideDayFirst(['01/07/2026', '05/07/2026', '09/07/2026'], true, '2026-07-20');
  eq([r.dayFirst, r.assumed], [true, false], 'a genuine DD/MM file keeps the household reading by the same rule - no banner');
  const us = decideDayFirst(['01/07/2026', '05/07/2026', '09/07/2026'], false, '2026-07-20');
  eq([us.dayFirst, us.assumed], [true, false], 'and the other way round: a month-first household is overruled by a day-first file');
}
{
  const r = decideDayFirst(['05/06/2026'], true, '2026-07-20');
  eq([r.dayFirst, r.assumed], [true, true], 'one ambiguous row cannot decide: household reading, flagged as assumed');
  const r2 = decideDayFirst(['05/06/2026'], false, '2026-07-20');
  eq([r2.dayFirst, r2.assumed], [false, true], 'and the household\'s other convention is kept the same way');
  const r3 = decideDayFirst(['03/04/2026', '04/03/2026'], true, '2026-07-20');
  eq(r3.assumed, true, 'two rows that fit either reading equally are flagged too (the order is no help)');
}
{
  const r = decideDayFirst(['2026-07-01', '2026-07-02'], true, '2026-07-20');
  eq([r.dayFirst, r.assumed], [true, false], 'an ISO-dated file has nothing ambiguous and says nothing');
  const none = decideDayFirst([], true, '2026-07-20');
  eq([none.dayFirst, none.assumed], [true, false], 'an empty column says nothing');
  const unsorted = decideDayFirst(['01/03/2026', '01/28/2026', '02/05/2026', '02/11/2026', '03/02/2026', '03/19/2026'], true, '2026-07-20');
  eq([unsorted.dayFirst, unsorted.assumed], [false, false], 'the existing case - a US export in date order on a day-first household - still goes month-first');
}

/* ---- 2. through the real importer ---- */
const realDate = Date;
function pinToday(iso) {
  const fixed = new realDate(`${iso}T12:00:00`).getTime();
  function Pinned(...a) { return a.length ? new realDate(...a) : new realDate(fixed); }
  Pinned.prototype = realDate.prototype;
  Pinned.now = () => fixed; Pinned.parse = realDate.parse; Pinned.UTC = realDate.UTC;
  global.Date = Pinned;
  return () => { global.Date = realDate; };
}
function mk(loc) {
  const { $, FakeEl } = makeDom();
  const ctx = {
    S: { settings: { currency: 'R', country: 'za', month_start_day: 1 }, accounts: [], categories: [], rules: [], txFiles: {}, budgets: {}, period: '2026-07' },
    $, $$: () => [], app: {},
    money: v => `R ${Number(v).toFixed(2)}`, moneyIn: (s, v) => `${s} ${Number(v).toFixed(2)}`,
    toast() {}, async writeFile() {}, currentPeriod: () => '2026-07',
    periodRange: () => ({ start: '2026-07-01', end: '2026-07-31' }), periodTitle: () => 'Jul',
    deferredCatSelect: () => new FakeEl('select'), serializeTxFile: () => '',
    locale: () => loc, learnRules() {}, txSegment: s => s, accountForLabel: () => null,
    provide(o) { Object.assign(ctx, o); },
  };
  registerImport(ctx);
  return ctx;
}
const file = (t, name = 's.csv') => ({ name, async arrayBuffer() { return new TextEncoder().encode(t).buffer; } });
const ZA = { dayFirst: true, thousands: ' ', decimal: ',', banks: null, importHint: '' };

(async () => {
  const unpin = pinToday('2026-07-20');
  try {
    /* L2b-05 end to end - the audit's own file */
    {
      const ctx = mk(ZA);
      await ctx.handleStatementFile(file(['Date,Description,Amount,Balance',
        '07/01/2026,SALARY,40000.00,40000.00', '07/03/2026,SHOP A,-100.00,39900.00', '07/06/2026,SHOP B,-200.00,39700.00',
        '07/09/2026,SHOP C,-300.00,39400.00', '07/12/2026,SHOP D,-400.00,39000.00', ''].join('\n'), 'paypal_activity.csv'));
      const p = ctx.S.pendingImport;
      eq(p.items.map(i => i.date), ['2026-07-01', '2026-07-03', '2026-07-06', '2026-07-09', '2026-07-12'],
        'a month-first export with every day <= 12 is dated 1-12 July, not scattered across the year');
      ok(p.items.every(i => i.date <= '2026-07-20'), 'and no row is after today');
      eq(p.dateReading, 'month-first', 'and the review records that the file overruled the household');
      ok(/month\/day/.test(ctx.$('#impDateReading').textContent) && !/^imp\./.test(ctx.$('#impDateReading').textContent), 'and says so on screen, in words');
    }
    /* the undecidable case: say what was assumed */
    {
      const ctx = mk(ZA);
      await ctx.handleStatementFile(file('Date,Description,Amount\n05/06/2026,SHOP,-10.00\n'));
      const p = ctx.S.pendingImport;
      eq(p.items.map(i => i.date), ['2026-06-05'], 'a single ambiguous date keeps the household reading');
      eq(p.dateReading, 'assumed-day-first', 'and records that it was an assumption');
      const said = ctx.$('#impDateReading').textContent;
      ok(/day\/month/.test(said) && /assum|either way/i.test(said) && !/^imp\./.test(said),
        `and the review says so in words, not as a raw key (${said.slice(0, 60)}...)`);
      ok(!ctx.$('#impDateReading').classList.contains('hidden'), 'with the note shown');
      const us = mk({ ...ZA, dayFirst: false });
      await us.handleStatementFile(file('Date,Description,Amount\n05/06/2026,SHOP,-10.00\n'));
      eq(us.S.pendingImport.dateReading, 'assumed-month-first', 'a month-first household is told the same thing in its own terms');
      ok(/month\/day/.test(us.$('#impDateReading').textContent), 'with the month/day wording');
    }
    /* a file with nothing ambiguous stays quiet */
    {
      const ctx = mk(ZA);
      await ctx.handleStatementFile(file('Date,Description,Amount\n2026-07-01,SHOP,-10.00\n13/07/2026,B,-5.00\n'));
      eq(ctx.S.pendingImport.dateReading, null, 'an unambiguous file carries no date banner');
    }

    /* L2b-06 */
    {
      const ctx = mk(ZA);
      await ctx.handleStatementFile(file(['Date,Description,Amount,Balance',
        '2026-07-01,SALARY,40000.00,40000.00', '2026-07-02,SHOP,-100.00,39900.00',
        '2026-07-03,CARD DECLINED - INSUFFICIENT FUNDS,0.00,39900.00', '2026-07-04,SHOP,-50.00,39850.00',
        '2026-07-05,PROVISIONAL STATEMENT ENTRY,,', '2026-07-06,SHOP,-25.00,39825.00',
        '2026-07-07,BAD ROW,12 000 R,39813.00', ''].join('\n')));
      const p = ctx.S.pendingImport;
      eq(p.items.length, 4, 'four money rows import');
      eq(p.skipped, 1, 'exactly one row is unparseable - the amount nobody can read');
      eq(p.noted, 2, 'the zero-amount line and the blank-amount line are counted apart');
      const stats = ctx.$('#impStats').textContent;
      ok(/1 unparseable/.test(stats) && !/2 unparseable|3 unparseable/.test(stats), `and the stats say "1 unparseable" (${stats.slice(-120)})`);
      ok(/2 with no amount/.test(stats), 'and name the two with no amount');
    }
    {
      // FNB: the waived-fee line prints 0.00 and the description carries a '#'.
      const ctx = mk(ZA);
      await ctx.handleStatementFile(file(['Date,Amount,Balance,Description',
        '2026/07/01,40000.00,40000.00,"SALARY ACME"', '2026/07/03,0.00,40000.00,"#Monthly Account Fee Waived"',
        '2026/07/04,-515.00,39485.00,"GROCER"', ''].join('\n')));
      const p = ctx.S.pendingImport;
      eq([p.items.length, p.skipped, p.noted], [2, 0, 1], 'a waived fee is informational: nothing unparseable');
    }
    {
      // Capitec three-amount layout: the notice row has no amount in any column.
      const ctx = mk(ZA);
      await ctx.handleStatementFile(file(['Nr,Account,Posting Date,Transaction Date,Description,Original Description,Parent Category,Category,Money In,Money Out,Fee,Balance',
        '1,1768000098,2026-07-01,2026-07-01,Salary,Salary,Income,Salary,40000.00,,,40000.00',
        '2,1768000098,2026-07-02,2026-07-02,Grocer One,Grocer One,Food,Groceries,,-515.00,,39485.00',
        '3,1768000098,2026-07-06,2026-07-06,Exc W/lim Checkers,Exc,,,,,,',
        '4,1768000098,2026-07-07,2026-07-07,Monthly Fee,Fee,Fees,Fees,,,-7.50,39477.50', ''].join('\n')));
      const p = ctx.S.pendingImport;
      eq([p.items.length, p.skipped, p.noted], [3, 0, 1], 'a Capitec notice with no amount is informational, not unparseable');
    }
    {
      // An unreadable cell in a Money Out / Money In pair still counts.
      const ctx = mk(ZA);
      await ctx.handleStatementFile(file(['Date,Description,Money Out,Money In',
        '2026-07-01,SHOP,100.00,', '2026-07-02,ODD,about fifty,', '2026-07-03,PAY,,500.00', ''].join('\n')));
      const p = ctx.S.pendingImport;
      eq([p.items.length, p.skipped, p.noted], [2, 1, 0], 'a Money Out cell that cannot be read is still unparseable');
    }
  } finally { unpin(); }
  console.log(`PASS import-date-order-and-informational-rows (${checks} checks)`);
})().catch(e => { global.Date = realDate; console.error(e); process.exit(1); });
