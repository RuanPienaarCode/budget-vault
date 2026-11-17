'use strict';
/* A single Amount column that marks money IN with "Cr" and leaves money out
   bare reads money out as money in (2026-11-17 audit, M2).

   normalizeAmount reads a Cr/Dr marker per value, so "500.00 Cr" is +500 and a
   bare "1,234.56" is +1234.56: both positive, and negating the column cannot
   tell them apart. The decision is the COLUMN's - a lone cell cannot know -
   and it is deliberately narrow: at least one non-zero value carries Cr, and no
   value anywhere carries Dr/DB, a minus, brackets or a plus. Then the bare
   non-zero values are debits. Everything else reads exactly as before.

   The balance column keeps the last word. With one, the rule stands only when
   the balances reconcile under it and NOT under today's reading; otherwise the
   column is read as it always was, with the verdict and warning that reading
   always got.

   This is PLAUSIBLE only: the parse is confirmed, but no supported bank is
   known to export this way. It is pinned so that it cannot disturb the formats
   that are (no existing fixture carries a Cr-marked statement amount).

     node tests/import-credit-marked-column.test.cjs */

const assert = require('assert');
const { mountReview } = require('./helpers/import-review-ctx.cjs');
const { creditMarkedColumn, readAmountColumn, amountMark } = require('../src/amount');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const GREEN = 'Amounts check out against this statement’s own balance column.';
const ACC = { name: 'Cheque', tx_label: 'Cheque', type: 'checking', in_budget: true };

/* Invented. Opening balance 1000.00, oldest first. */
const NAMES = ['SALARY ACME', 'GROCER ONE', 'COFFEE BAR', 'REFUND SHOP', 'FUEL STOP'];
const HEAD = 'Date,Description,Amount,Balance';
const line = (i, amt, bal) => `2026-08-0${i + 1},${NAMES[i]},${amt},${bal}`;
/* what the balances say: +500, -1234.56, -20, +1000, -300 */
const GOOD_BAL = ['1500.00', '265.44', '245.44', '1245.44', '945.44'];
/* the balances of a statement whose bare values really ARE money in */
const OLD_BAL = ['1500.00', '2734.56', '2754.56', '3754.56', '4054.56'];
/* balances that belong to no reading of these amounts */
const NO_BAL = ['1500.00', '1111.11', '2222.22', '3333.33', '4444.44'];
const CELLS = ['500.00 Cr', '"1,234.56"', '20.00', '1 000.00 Cr', '300.00'];
const csv = (cells, bals) => [HEAD, ...cells.map((c, i) => line(i, c, bals[i]))].join('\n');
const csvNoBalance = cells => ['Date,Description,Amount', ...cells.map((c, i) => `2026-08-0${i + 1},${NAMES[i]},${c}`)].join('\n');

async function read(text) {
  const v = mountReview({ accounts: [ACC] });
  const p = await v.load(text, 'statement.csv');
  p.label = 'Cheque'; v.ctx.renderImportReview();
  return { v, p, amounts: p.items.map(i => i.amount), warn: v.els['#impReconcile'].classList.contains('imp-reconcile-warn'), banner: v.banner() };
}

(async () => {
  /* ---- 0. the pure decision -------------------------------------------------- */
  {
    ok(creditMarkedColumn(['500.00 Cr', '1,234.56', '20.00', '1 000.00 Cr']), 'Cr on some, nothing on the rest: a credit-marked column');
    ok(creditMarkedColumn(['CR 500.00', '20.00']) && creditMarkedColumn(['500.00CR', '20.00']), 'a leading marker and a glued trailing one count too');
    ok(!creditMarkedColumn(['500.00 Cr', '20.00 Dr']), 'a Dr anywhere: not this shape');
    ok(!creditMarkedColumn(['500.00 Cr', '20.00 DB']), 'DB too');
    ok(!creditMarkedColumn(['500.00 Cr', '-20.00']), 'a minus anywhere');
    ok(!creditMarkedColumn(['500.00 Cr', '20.00-']), 'a trailing minus');
    ok(!creditMarkedColumn(['500.00 Cr', '(20.00)']), 'brackets');
    ok(!creditMarkedColumn(['500.00 Cr', 'R-20.00']), 'a minus inside a currency symbol');
    ok(!creditMarkedColumn(['500.00 Cr', '+20.00']), 'an explicit plus is not a bare value');
    ok(!creditMarkedColumn(['500.00 Cr', '0.00 Dr']), 'a debit marker on a ZERO value still counts: the column uses debit markers');
    ok(!creditMarkedColumn(['20.00', '1,234.56']), 'no markers at all');
    ok(!creditMarkedColumn(['0.00 Cr', '20.00']), 'a zero credit is not evidence');
    ok(!creditMarkedColumn(['CRC 1 000', 'CRC 250']), 'a currency code that starts with CR is not a marker');
    ok(!creditMarkedColumn(['1 000 IDR', '250 IDR']), 'nor is one that ends in DR');
    ok(!creditMarkedColumn([]) && !creditMarkedColumn(undefined), 'an empty column');
    eq(['500.00 Cr', 'CR 5', '5 Dr', '(5)', '-5', '5-', '+5', '5', '', 'CRC 5'].map(amountMark),
      ['credit', 'credit', 'debit', 'debit', 'debit', 'debit', 'positive', 'plain', null, 'unsure'], 'what each shape states about itself');
    const col = readAmountColumn(['500.00 Cr', '1,234.56', '20.00', '1 000.00 Cr']);
    eq(col.values, [500, -1234.56, -20, 1000], 'credits stay positive, bare values are money out');
    eq(col.plain, [500, 1234.56, 20, 1000], 'and the per-cell reading is kept for a fallback');
    ok(col.applied, 'applied');
    const dr = readAmountColumn(['500.00 Cr', '1,234.56', '20.00 Dr']);
    eq(dr.values, [500, 1234.56, -20], 'with a Dr in the column, exactly the per-cell reading');
    ok(!dr.applied, 'not applied');
    eq(readAmountColumn(['500.00 Cr', '', 'n/a', '0.00', '20']).values, [500, null, null, 0, -20], 'blank, unreadable and zero cells are left alone');
  }

  /* ---- 1. the audit's column, balances reconcile under the rule ---------------- */
  {
    const r = await read(csv(CELLS, GOOD_BAL));
    eq(r.amounts, [500, -1234.56, -20, 1000, -300], 'credits are money in, the bare values are money out');
    ok(r.p.reconcile.verified && !r.p.reconcile.flipped && !r.p.reconcile.inverted, 'and the balance column verifies it');
    ok(r.banner.startsWith(GREEN), `the usual green sentence leads: ${r.banner}`);
    ok(/Cr/.test(r.banner) && /unmarked/.test(r.banner), `and the review SAYS what it did: ${r.banner}`);
    ok(!r.warn, 'no warning styling');
  }

  /* ---- 2. the balances only reconcile under today's reading -------------------- */
  {
    const r = await read(csv(CELLS, OLD_BAL));
    eq(r.amounts, [500, 1234.56, 20, 1000, 300], "the old reading: the balances proved it, the rule does not override them");
    ok(r.p.reconcile.verified && !r.p.reconcile.flipped, 'with the verdict it always had');
    eq(r.banner, GREEN, 'and nothing added to the banner');
  }

  /* ---- 2b. both readings reconcile (a contrived run): the one that already
          proved itself is the one that stays ------------------------------------ */
  {
    // Four equal Cr credits then one bare value, balances climbing by 100: read
    // newest-first the rule's reading fits, oldest-first today's does.
    const r = await read(csv(['100.00 Cr', '100.00 Cr', '100.00 Cr', '100.00 Cr', '100.00'], ['1100.00', '1200.00', '1300.00', '1400.00', '1500.00']));
    eq(r.amounts, [100, 100, 100, 100, 100], 'both readings fit the balances: today\'s reading, which the file proved without the rule, is kept');
    eq(r.banner, GREEN, 'with the sentence it always had');
  }

  /* ---- 3. the balances reconcile under neither: today's reading and warning ---- */
  {
    const r = await read(csv(CELLS, NO_BAL));
    eq(r.amounts, [500, 1234.56, 20, 1000, 300], 'unproven: exactly today\'s reading');
    ok(!r.p.reconcile.verified && r.warn, 'unverified, and the warning styling is on');
    ok(/Could not check these amounts against the balance column/.test(r.banner) && !/unmarked/.test(r.banner),
      `today's warning, and no claim about a rule that was not applied: ${r.banner}`);
  }

  /* ---- 4. any Dr, minus or no marker: exactly today's result -------------------- */
  {
    const dr = await read(csv(['500.00 Cr', '"1,234.56"', '20.00 Dr', '1 000.00 Cr', '300.00'], GOOD_BAL));
    eq(dr.amounts, [500, 1234.56, -20, 1000, 300], 'one Dr value: the per-cell reading, unchanged');
    ok(!/unmarked/.test(dr.banner), 'and no claim about the rule');
    const minus = await read(csv(['500.00 Cr', '"1,234.56"', '-20.00', '1 000.00 Cr', '300.00'], GOOD_BAL));
    eq(minus.amounts, [500, 1234.56, -20, 1000, 300], 'a minus sign anywhere: unchanged');
    const none = await read(csv(['500.00', '"1,234.56"', '20.00', '1 000.00', '300.00'], GOOD_BAL));
    eq(none.amounts, [500, 1234.56, 20, 1000, 300], 'no markers at all: unchanged');
  }

  /* ---- 5. no balance column: the rule is the column's own, and it is said ------- */
  {
    const r = await read(csvNoBalance(CELLS));
    eq(r.amounts, [500, -1234.56, -20, 1000, -300], 'nothing to prove it against, so the explicit markers decide');
    ok(r.p.reconcile.unchecked, 'and the review still says the amounts could not be checked');
    ok(/unmarked/.test(r.banner), `plus what was done: ${r.banner}`);
    const dr = await read(csvNoBalance(['500.00 Cr', '"1,234.56"', '20.00 Dr', '1 000.00 Cr', '300.00']));
    eq(dr.amounts, [500, 1234.56, -20, 1000, 300], 'without balance, a Dr in the column: unchanged');
  }

  /* ---- 6. a Money out / Money in pair is out of scope --------------------------- */
  {
    const pair = ['Date,Description,Money out,Money in,Balance',
      '2026-08-01,SALARY ACME,,500.00 Cr,1500.00',
      '2026-08-02,GROCER ONE,"1,234.56",,265.44',
      '2026-08-03,COFFEE BAR,20.00,,245.44',
      '2026-08-04,REFUND SHOP,,1 000.00 Cr,1245.44',
      '2026-08-05,FUEL STOP,300.00,,945.44'].join('\n');
    const r = await read(pair);
    eq(r.amounts, [500, -1234.56, -20, 1000, -300], 'a pair is read by its column names, as before');
    eq(r.banner, GREEN, 'with no rule claimed');
  }

  console.log(`PASS import-credit-marked-column — a Cr-only-marked amount column reads its bare values as money out, only when nothing contradicts it (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
