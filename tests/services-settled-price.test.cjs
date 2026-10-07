'use strict';
/* A clean price change was reported as "varies", blamed on top-ups.

   chargeStats() calls a merchant's price the median of its last THREE charges,
   and calls the merchant "varies" when those three spread by more than 15%.
   That refusal is right for prepaid top-ups and for a biller whose products
   share one name — and wrong for the commonest change there is: a price that
   moved and then held. A fibre line billed 799, 799, then 649, 649 has a
   last three of 799 / 649 / 649 — a 23% spread — so the row read "varies"
   under a tooltip blaming "top-ups, or several products billed under one
   name", while the two newest charges agreed to the cent (2026-10-07 audit,
   SVC-2; the figures here are synthetic).

   The rule chosen in the audit (its default): when the LAST TWO charges are
   within 4% of each other, that is the price. One new charge is not enough —
   it could be a pro-rata or a double bill — so "799 then a single 649" still
   varies.

   recurring.js is shared with committed.js (the Dashboard's "still
   committed"), which reads comparePrice and chargeStats as they are, so the
   rule arrives as two NEW functions, settledPrice and comparePriceNow, and
   the Services page asks those. This file pins the new pair, and pins that
   the old pair still answers exactly what it did.

   The Per month tile keeps the LISTED amount. The page argues, it never
   corrects: the badge says what the bank is charging, and the reader decides
   whether to change their figure.
     node tests/services-settled-price.test.cjs */

const assert = require('assert');
const { pinClock } = require('./helpers/figures.cjs');
const { household, servicesPage, rowNamed } = require('./helpers/services-page.cjs');
const { chargeStats, comparePrice, settledPrice, comparePriceNow } = require('../src/recurring');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ch = (date, amount) => ({ date, desc: 'FASTNET FIBRE', amount: -amount });
const FIBRE = { name: 'Fibre', provider: 'Fastnet', amount: 799 };

(async () => {
  /* ---- 1. the pure rule ---------------------------------------------- */
  {
    const changed = [ch('2026-06-01', 799), ch('2026-07-02', 799), ch('2026-08-03', 649), ch('2026-09-01', 649)];
    eq(settledPrice(changed), 649, 'the last two charges agree, so they are the price');
    eq(settledPrice([ch('2026-08-01', 100), ch('2026-09-01', 104)]), 102, 'within 4% of each other: their median');
    eq(settledPrice([ch('2026-08-01', 100), ch('2026-09-01', 105)]), null, 'more than 4% apart: no settled price');
    eq(settledPrice([ch('2026-09-01', 649)]), null, 'one charge settles nothing');
    eq(settledPrice([]), null, 'and none settles nothing');
    /* The ORDER is the merchant's, not the caller's. Rows reach the page one
       account file at a time, so a merchant billed from two accounts arrives
       interleaved — the same trap chargeStats' own header records. */
    eq(settledPrice([ch('2026-09-01', 649), ch('2026-06-01', 799), ch('2026-08-03', 649), ch('2026-07-02', 799)]), 649,
      'charges handed over out of order are read in date order');
    eq(settledPrice([ch('2026-08-03', 649), ch('2026-09-01', 649), { date: 'end of Sep', desc: 'x', amount: -999 }]), 649,
      'an undatable charge cannot be one of the last two');

    const stats = chargeStats(changed);
    eq(stats.varies, true, 'precondition: chargeStats still calls this history "varies"');
    eq(comparePrice(FIBRE, stats).varies, true, 'and comparePrice still refuses it — its consumers see no change');
    const now = comparePriceNow(FIBRE, stats, changed);
    eq([now.varies, now.actual, now.diff, now.agrees, now.settled], [false, 649, -150, false, true],
      'comparePriceNow gives the settled verdict: R150 below the listed R799');

    // Where comparePrice already had an answer, comparePriceNow is that answer.
    const steady = [ch('2026-07-01', 799), ch('2026-08-01', 799), ch('2026-09-01', 799)];
    eq(comparePriceNow({ ...FIBRE, amount: 799 }, chargeStats(steady), steady),
      comparePrice({ ...FIBRE, amount: 799 }, chargeStats(steady)), 'no change where no price was refused');
    const flip = [ch('2026-07-01', 649), ch('2026-08-01', 799), ch('2026-09-01', 649)];
    eq(comparePriceNow(FIBRE, chargeStats(flip), flip).varies, true,
      'a last two that disagree (799 then 649) still varies');
  }

  /* ---- 2. on the page ------------------------------------------------- */
  const unpin = pinClock('2026-10-07');
  try {
    const page = async amounts => servicesPage(household({
      services: ['| Fibre 70 | Fastnet | 799.00 | monthly | 2026-10-01 | Bills | yes |  |  |'],
      tx: { Cheque: Object.fromEntries(amounts.map(([m, d, a]) => [m, [`| ${m}-${d} | FASTNET FIBRE 2000001 | Bills | -${a} |  |  |  |`]])) },
    }));
    {
      const p = await page([['2026-06', '01', '799.00'], ['2026-07', '02', '799.00'], ['2026-08', '03', '649.00'], ['2026-09', '01', '649.00']]);
      eq(p.error, null, 'renders');
      const row = rowNamed(p, 'Fibre 70');
      const badge = row.badges[0] || {};
      ok(/^really R ?649$/.test(badge.text || ''), `the settled price is the verdict — got ${JSON.stringify(row.badges.map(b => b.text))}`);
      ok(badge.cls.includes('badge-savings'), 'coloured as a price below the listed one');
      ok(/last two charges/i.test(badge.title) && /R ?649[,.]00/.test(badge.title) && /R ?799[,.]00/.test(badge.title),
        `and the tooltip says what it rests on — got "${badge.title}"`);
      ok(!row.badges.some(b => b.text === 'varies'), 'no "varies"');
      ok(/Per month\s*R ?799[,.]00/.test(p.kpis[0].replace(/\s+/g, ' ')),
        `the Per month tile keeps the listed R819 — the page argues, it does not correct (got "${p.kpis[0]}")`);
    }
    {
      // 799, 799, then a single 649: one new charge is not a new price yet.
      const p = await page([['2026-07', '02', '799.00'], ['2026-08', '03', '799.00'], ['2026-09', '01', '649.00']]);
      eq(rowNamed(p, 'Fibre 70').badges.map(b => b.text), ['varies'], 'a single changed charge still reads "varies"');
    }
  } finally { unpin(); }

  console.log(`PASS — services: a price that moved and held is a price, and the shared pair still reads as before (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
