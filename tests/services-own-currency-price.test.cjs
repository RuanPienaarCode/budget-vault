'use strict';
/* A service listed in dollars was price-checked against charges in rand.

   ADR-0004 gave Services.md a Currency column, and the page's TOTALS learned
   to read it (tests/services-currency.test.cjs). The price check never did:
   chargeIndex() compared every listed amount against charges on the
   household's own-currency accounts, under a comment that still said
   "Services.md has no currency column, so s.amount is always in the
   household's currency". So a subscription listed as "$ 15.99" and charged
   R299 on a rand card got a confident green verdict — "really R 299: Your bank
   is charging R 299,00, not R 15,99" — a 1 770% "price rise" that is a currency
   symbol and nothing else (2026-10-07 audit, SVC-1).

   A listed price is now compared only against charges in ITS OWN currency, and
   the verdict is printed in that currency. A service whose charges are all in
   some other currency gets the neutral "billed in" badge and no verdict —
   comparing them would need a rate for the day of each charge, which the vault
   does not keep. Driven through the real loader and the real page.
     node tests/services-own-currency-price.test.cjs */

const assert = require('assert');
const { pinClock } = require('./helpers/figures.cjs');
const { household, servicesPage, rowNamed } = require('./helpers/services-page.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

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
    /* ---- 1. listed in $, charged in rand: no verdict, a neutral badge ----- */
    {
      const page = await servicesPage(household({
        services: ['| Streaming | Netflix | 15.99 | monthly | 2026-10-20 | Bills | yes |  | $ |'],
        tx: months('NETFLIX.COM 15.99 USD', '-299.00'),
      }));
      eq(page.error, null, 'renders');
      const row = rowNamed(page, 'Streaming');
      ok(!texts(row).some(t => /^really/.test(t)), `no price verdict across currencies — got ${JSON.stringify(texts(row))}`);
      eq(texts(row), ['billed in R'], 'it says the charges are in rand, and stops there');
      ok(/amount on this page is in \$/.test(row.badges[0].title),
        `and the tooltip names the LISTED currency as the page's — got "${row.badges[0].title}"`);
    }

    /* ---- 2. listed in $, charged in $ at a different price: a verdict, in $
       The comparison is now possible, so it is made — and printed in the
       currency both sides are in, never under the household's symbol.
       (A $4 gap, written when comparePrice's band had a floor of 2 units in
       any currency. That floor is now the household's alone, and a $2 rise
       on a service listed in $ gets its verdict too —
       tests/services-price-floor-currency.test.cjs.) */
    {
      const page = await servicesPage(household({
        services: ['| Streaming | Netflix | 15.99 | monthly | 2026-10-20 | Bills | yes |  | $ |'],
        accounts: DOLLAR_CARD, tx: months('NETFLIX.COM', '-19.99', 'Dollar card'),
      }));
      eq(page.error, null, 'renders');
      const row = rowNamed(page, 'Streaming');
      eq(texts(row).length, 1, 'one badge');
      ok(/^really \$ ?20$/.test(texts(row)[0]), `the verdict is in dollars — got "${texts(row)[0]}"`);
      ok(/\$ ?19[,.]99/.test(row.badges[0].title) && /\$ ?15[,.]99/.test(row.badges[0].title),
        `and so is its tooltip — got "${row.badges[0].title}"`);
      ok(!/R ?1/.test(row.badges[0].title), 'with no rand figure in it');
    }

    /* ---- 3. listed in $, charged in $ at the listed price: nothing to say - */
    {
      const page = await servicesPage(household({
        services: ['| Streaming | Netflix | 15.99 | monthly | 2026-10-20 | Bills | yes |  | $ |'],
        accounts: DOLLAR_CARD, tx: months('NETFLIX.COM', '-15.99', 'Dollar card'),
      }));
      eq(texts(rowNamed(page, 'Streaming')), [], 'a price that agrees gets no badge');
    }

    /* ---- 4. the household's own currency is unchanged -------------------- */
    {
      const page = await servicesPage(household({
        services: ['| Fibre | Fastnet | 799.00 | monthly | 2026-10-01 | Bills | yes |  |  |'],
        tx: months('FASTNET FIBRE', '-849.00'),
      }));
      const row = rowNamed(page, 'Fibre');
      ok(/^really R ?849$/.test(texts(row)[0]), `a rand service charged in rand still gets its verdict — got ${JSON.stringify(texts(row))}`);
      ok(/R ?849[,.]00/.test(row.badges[0].title) && /R ?799[,.]00/.test(row.badges[0].title), 'in rand');
    }

    /* ---- 5. charged in both: the price comes from the listed currency only
       A rand service also charged once on the dollar card (a holiday top-up)
       is price-checked against its rand charges alone — the dollar row is
       evidence the service is alive, not evidence of its price. */
    {
      const tx = months('FASTNET FIBRE', '-799.00');
      tx['Dollar card'] = { '2026-09': ['| 2026-09-25 | FASTNET FIBRE | Bills | -55.00 |  |  |  |'] };
      const page = await servicesPage(household({
        services: ['| Fibre | Fastnet | 799.00 | monthly | 2026-10-20 | Bills | yes |  |  |'],
        accounts: DOLLAR_CARD, tx,
      }));
      eq(page.error, null, 'renders');
      eq(texts(rowNamed(page, 'Fibre')), [], 'the rand price agrees, and the dollar charge does not drag it');
    }
  } finally { unpin(); }

  console.log(`PASS — services: a listed price is checked only against charges in its own currency, and said in it (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
