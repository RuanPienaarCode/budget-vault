'use strict';
/* A service charged ONLY on a foreign-currency account crashed the Services
   page, and when it did render it said the charges were not there.

   This is the ISSUE 28 case chargeIndex() was written for — a subscription
   listed in rand and billed in dollars on a dollar card. The price is
   compared only against charges in the listed currency, so the price stats
   came out null, while the liveness pill and the next-billing date were built
   from EVERY charge and were set. Two readings of one row then disagreed
   (2026-10-07 audit, SVC-4):

     - svcFlags tested `if (!c.stats)` first and printed "not seen" — false,
       the charges matched — and returned before it could reach the neutral
       "billed in $" branch, which was therefore unreachable;
     - svcNextHint built its tooltip from `c.stats.day`, so whenever the stored
       Next billing differed from the predicted one (the usual case) it threw
       "Cannot read properties of null (reading 'day')". Nothing catches a
       render (controller.js render()), so the page was left half-built.

   Now "seen" is a fact about every charge, the price question is asked only
   where it can be answered, and the hint's tooltip comes from the same
   charges its date does. Driven through the real loader and the real page.
     node tests/services-foreign-only-charges.test.cjs */

const assert = require('assert');
const { pinClock } = require('./helpers/figures.cjs');
const { household, servicesPage, rowNamed } = require('./helpers/services-page.cjs');
const { matchCharges } = require('../src/recurring');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const DOLLAR_CARD = { 'Dollar card': 'type: credit card\ncurrency: "$"\nbalance: -40.00\nbalance_updated: 2026-10-01' };
const DOLLAR_CHARGES = { 'Dollar card': {
  '2026-08': ['| 2026-08-20 | NETFLIX.COM | Bills | -15.99 |  |  |  |'],
  '2026-09': ['| 2026-09-20 | NETFLIX.COM | Bills | -15.99 |  |  |  |'],
} };
const files = next => household({
  services: [`| Streaming | Netflix | 199.00 | monthly | ${next} | Bills | yes |  |  |`],
  accounts: DOLLAR_CARD, tx: DOLLAR_CHARGES,
});

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 0. the fixture really is the case that crashed ------------------
       Charges exist, and none of them is on a rand account — the exact state
       that left the price stats null while the next date was set. Without
       this, a green run below could be a fixture that never reached the
       branch. */
    {
      const svc = { name: 'Streaming', provider: 'Netflix' };
      const dollarRows = [{ date: '2026-08-20', desc: 'NETFLIX.COM', amount: -15.99 }, { date: '2026-09-20', desc: 'NETFLIX.COM', amount: -15.99 }];
      eq(matchCharges(svc, dollarRows).all.length, 2, 'precondition: the service matches its two dollar charges');
      eq(matchCharges(svc, []).charges.length, 0, 'precondition: and nothing in the rand pool');
    }

    /* ---- 1. stored Next billing differs from the prediction: the crash --- */
    {
      const page = await servicesPage(files('2026-09-20'));
      eq(page.error, null, `the page renders instead of throwing (${page.error && page.error.message})`);
      const row = rowNamed(page, 'Streaming');
      ok(row, 'and the row is there');
      const texts = row.badges.map(b => b.text);
      ok(!texts.includes('not seen'), `it does not claim the charges are missing — got ${JSON.stringify(texts)}`);
      eq(texts, ['billed in $'], 'it says, neutrally, that the charges are in another currency');
      const billed = row.badges[0];
      ok(/billed in \$/.test(billed.title) && /amount on this page is in R/.test(billed.title),
        `the tooltip names both currencies — got "${billed.title}"`);
      ok(!billed.cls.includes('badge-debt') && !billed.cls.includes('badge-savings'),
        'and carries no price-verdict colour, because no verdict is offered');

      ok(row.hint, 'the next-billing hint is offered (the stored date is behind the charges)');
      eq(row.hint.text, 'due 2026-10-20', 'stepped from the last dollar charge');
      ok(/Last charged 2026-09-20/.test(row.hint.title),
        `and its tooltip cites that same charge — got "${row.hint.title}"`);
    }

    /* ---- 2. stored Next billing already right: no hint, same badge ------ */
    {
      const page = await servicesPage(files('2026-10-20'));
      eq(page.error, null, 'renders');
      const row = rowNamed(page, 'Streaming');
      eq(row.badges.map(b => b.text), ['billed in $'], 'the same neutral badge, not "not seen"');
      eq(row.hint, null, 'and no hint, since the stored date already matches');
    }

    /* ---- 3. a service with NO charges anywhere is still "not seen" -------
       The absence badge is right when it is true; the fix narrows it to that. */
    {
      const page = await servicesPage(household({
        services: ['| Gym | Fitco | 300.00 | monthly | 2026-10-01 | Bills | yes |  |  |'],
        accounts: DOLLAR_CARD, tx: DOLLAR_CHARGES,
      }));
      eq(page.error, null, 'renders');
      eq(rowNamed(page, 'Gym').badges.map(b => b.text), ['not seen'], 'a service nothing matches is still reported unseen');
      eq(rowNamed(page, 'Gym').hint, null, 'and offers no date it cannot derive');
    }
  } finally { unpin(); }

  console.log(`PASS — services: a service billed only abroad renders, reads "billed in", and its hint cites the charge it steps from (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
