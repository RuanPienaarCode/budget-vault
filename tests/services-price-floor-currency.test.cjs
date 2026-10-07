'use strict';
/* The price check's absolute floor is in the household's money, not in
   whatever currency a service happens to be listed in.

   recurring.js's comparePrice calls a listed price and the bank's agreeing
   when they are within 4% of the listed price, or within 2 — whichever is
   wider. The 2 was written for rand, where it is the few-rand wobble a cheap
   subscription moves by, and it was 2 UNITS of any currency. That stopped
   being harmless when the Services page learned to price-check a service in
   its own currency (2026-10-07 audit, SVC-1): a subscription listed at
   $ 15.99 and billed $ 17.99 is a 12.5% rise — some R 36 a month — and read
   as agreeing, because $ 2 is "within 2". The neighbouring suite had to use a
   $ 4 gap to get a verdict at all (tests/services-own-currency-price.test.cjs,
   case 2, says so).

   The rule now: the 2-unit floor applies to a service in the household's own
   currency — a blank Currency cell, which is what the Services page writes for
   it (ADR-0004) — exactly as before; a service listed in a currency of its own
   is judged on the 4% band alone, because this app has no measure of what a
   trivial amount of THAT currency is, and a relative band means the same thing
   in every currency.

   Pinned two ways: an oracle sweep (the household's verdicts are the released
   formula's, byte for byte, across a grid of prices and gaps; the stated
   currency's are the 4% band's), and the real page, driven through the real
   loader and view.

     node tests/services-price-floor-currency.test.cjs */

const assert = require('assert');
const { pinClock } = require('./helpers/figures.cjs');
const { household, servicesPage, rowNamed } = require('./helpers/services-page.cjs');
const { comparePrice, comparePriceNow, chargeStats } = require('../src/recurring');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- 1. the verdicts, pure ---- */
{
  const at = (amount, currency, recent) => comparePrice({ name: 'Streaming', provider: 'Netflix', amount, currency }, { recent, varies: false });
  eq(at(15.99, '$', 17.99).agrees, false, 'a $ 2 rise on a $ 15.99 subscription is a rise — 12.5%, not "agreeing"');
  eq(at(15.99, '$', 16.5).agrees, true, 'a 3% wobble in its own currency still agrees');
  eq(at(15.99, '', 17.99).agrees, true, "the household's own currency keeps its floor: R 2 on R 15.99 agrees, as it always has");
  eq(at(15.99, '  ', 17.99).agrees, true, 'a Currency cell of spaces is blank — the household\'s');

  /* The household's verdicts, byte for byte the released formula. */
  const released = (stated, actual) => {
    const diff = actual - stated;
    return { stated, actual, diff, varies: false, pct: stated ? diff / stated : null, agrees: Math.abs(diff) <= Math.max(2, stated * 0.04) };
  };
  const STATED = [0.49, 1, 4.99, 9.99, 15.99, 29, 49.99, 50, 50.01, 99, 100, 129.5, 799, 1000, 4500];
  const GAPS = [0, 0.01, 0.5, 1, 1.99, 2, 2.01, 3];
  const PCTS = [0.03, 0.039, 0.04, 0.041, 0.05, 0.1, 0.2];
  let household = 0, own = 0;
  for (const stated of STATED) {
    const actuals = [...GAPS.flatMap(g => [stated + g, Math.max(0.01, stated - g)]), ...PCTS.flatMap(p => [stated * (1 + p), stated * (1 - p)])];
    for (const actual of actuals) {
      assert.deepStrictEqual(at(stated, '', actual), released(stated, actual), `household currency, ${stated} vs ${actual}`);
      household++;
      const mine = at(stated, '$', actual);
      assert.strictEqual(mine.agrees, Math.abs(actual - stated) <= stated * 0.04, `stated currency, ${stated} vs ${actual}`);
      assert.deepStrictEqual({ ...mine, agrees: null }, { ...released(stated, actual), agrees: null },
        `stated currency, ${stated} vs ${actual}: every field but the verdict is unchanged`);
      own++;
    }
  }
  checks += 2;
  ok(household > 300 && own > 300, `the sweep compared ${household} household and ${own} stated-currency verdicts`);

  /* The settled price (comparePriceNow) asks comparePrice — so the same band. */
  const charges = ['2026-06-20', '2026-07-20', '2026-08-20', '2026-09-20']
    .map((date, i) => ({ date, amount: -[19.99, 12.49, 17.99, 17.99][i], desc: 'NETFLIX.COM' }));
  const stats = chargeStats(charges);
  ok(stats.varies, 'sanity: the last three charges spread too far to be one price');
  const listed$ = comparePriceNow({ name: 'Streaming', provider: 'Netflix', amount: 15.99, currency: '$' }, stats, charges);
  eq([listed$.settled, listed$.actual, listed$.agrees], [true, 17.99, false], 'a settled $ 17.99 against a listed $ 15.99 is a rise');
  const listedR = comparePriceNow({ name: 'Streaming', provider: 'Netflix', amount: 15.99, currency: '' }, stats, charges);
  eq([listedR.settled, listedR.actual, listedR.agrees], [true, 17.99, true], 'and in the household\'s own currency, the floor it always had');
}

/* ---- 2. on the page ---- */
const DOLLAR_CARD = { 'Dollar card': 'type: credit card\ncurrency: "$"\nbalance: -40.00\nbalance_updated: 2026-10-01' };
const months = (desc, amount, label = 'Cheque') => ({ [label]: {
  '2026-07': [`| 2026-07-20 | ${desc} | Bills | ${amount} |  |  |  |`],
  '2026-08': [`| 2026-08-20 | ${desc} | Bills | ${amount} |  |  |  |`],
  '2026-09': [`| 2026-09-20 | ${desc} | Bills | ${amount} |  |  |  |`],
} });
const texts = row => row.badges.map(b => b.text.replace(/\s+/g, ' '));

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    {
      const page = await servicesPage(household({
        services: ['| Streaming | Netflix | 15.99 | monthly | 2026-10-20 | Bills | yes |  | $ |'],
        accounts: DOLLAR_CARD, tx: months('NETFLIX.COM', '-17.99', 'Dollar card'),
      }));
      eq(page.error, null, 'renders');
      const row = rowNamed(page, 'Streaming');
      eq(texts(row).length, 1, `listed $ 15.99, billed $ 17.99: one badge — got ${JSON.stringify(texts(row))}`);
      ok(/^really \$ ?18$/.test(texts(row)[0]), `the rise is named, in dollars — got "${texts(row)[0]}"`);
    }
    {
      const page = await servicesPage(household({
        services: ['| Streaming | Netflix | 15.99 | monthly | 2026-10-20 | Bills | yes |  | $ |'],
        accounts: DOLLAR_CARD, tx: months('NETFLIX.COM', '-16.49', 'Dollar card'),
      }));
      eq(texts(rowNamed(page, 'Streaming')), [], 'billed $ 16.49 (3%): agrees, no badge');
    }
    {
      const page = await servicesPage(household({
        services: ['| Music | Tunes | 15.99 | monthly | 2026-10-20 | Bills | yes |  |  |'],
        tx: months('TUNES MUSIC', '-17.99'),
      }));
      eq(texts(rowNamed(page, 'Music')), [], 'a rand service R 2 above its listed R 15.99: unchanged, the floor still holds');
    }
  } finally { unpin(); }

  console.log(`PASS — services-price-floor-currency: the 2-unit floor is the household's, a stated currency is judged on 4% (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
