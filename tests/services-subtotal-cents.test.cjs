'use strict';
/* The Services category subtotal prints the way the tile above it does.

   2026-10-20 audit, D1-13 / D2-03 / D2-26. The "Per month" tile read
   "R 528,50" while the subtotal row under it read "R 529/mo": one figure,
   two rounding rules, one card — and a unit, "/mo", that no other sentence
   in the app uses where they say " a month". A subtotal row is a table
   figure, and tables keep cents. The other-currency side note under the
   tiles was whole too ("Plus € 10 held …" under "R 528,50"), so it follows
   the figure it sits under as well.

   Through the REAL loader and view with the REAL formatter (the
   tests/helpers/services-page.cjs household). Every figure is made up.

     node tests/services-subtotal-cents.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { household, servicesPage, txt } = require('./helpers/services-page.cjs');
const { pinClock } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const SERVICES = [
  '| Fibre | ISP | 428.50 | monthly | 2026-11-01 | Bills | yes | | |',
  '| Cloud | Host | 100.00 | monthly | 2026-11-03 | Bills | yes | | |',
  '| Storage | Abroad | 10.25 | monthly | 2026-11-05 | Bills | yes | | € |',
];

(async () => {
  const unpin = pinClock('2026-10-20');
  try {
    const page = await servicesPage(household({ services: SERVICES }));
    ok(!page.error, `the Services page renders (${page.error && page.error.message})`);
    const kpis = page.M.nodes.get('#servicesKpis');
    const tile = label => descend(kpis).filter(n => n._cls && n._cls.has('mini'))
      .find(t => descend(t).some(n => n._cls.has('l') && n.textContent === label));
    const value = t => txt(descend(t).find(n => n._cls.has('v')));
    const sub = t => txt(descend(t).find(n => n._cls.has('s')));

    const perMonth = value(tile('Per month'));
    eq(perMonth, 'R 528,50', 'sanity: the Per month tile prints the rand services in cents');

    const typeRows = descend(page.M.nodes.get('#svcTable')).filter(n => n.tagName === 'TR' && n._cls.has('type-row'));
    eq(typeRows.length, 1, 'one category, one subtotal row');
    const subtotal = txt(typeRows[0].children[typeRows[0].children.length - 1]);
    ok(!subtotal.includes('/mo'), `the subtotal never says "/mo" — got "${subtotal}"`);
    ok(subtotal.startsWith(`${perMonth} a month`),
      `the subtotal is the tile's own figure, as printed, "a month" — got "${subtotal}"`);
    ok(subtotal.includes('€ 10,25 a month'), `and its other-currency tag keeps cents and the same unit — got "${subtotal}"`);

    ok(sub(tile('Per month')).includes('€ 10,25'),
      `the other-currency note under "Per month" keeps cents like the figure it sits under — got "${sub(tile('Per month'))}"`);
    ok(sub(tile('Per year')).includes('€ 123,00'),
      `and under "Per year" too — got "${sub(tile('Per year'))}"`);
  } finally {
    unpin();
  }
  console.log(`PASS services-subtotal-cents — the category subtotal prints the tile's figure in cents and says "a month" (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
