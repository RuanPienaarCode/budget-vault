'use strict';
/* A debt row that states no rate must not report an interest figure.

   1.35.0 taught the Report's Debt SECTION the difference between "no
   interest" and "interest unknown": with no rate anywhere it withholds the
   total and says a rate would make it knowable. The per-debt TABLE underneath
   it was the same false claim one layer down, and it is the sharper one,
   because the rate cell immediately to its left already prints '—' for the
   very same missing figure. A reader seeing

     | Car | R 164000.00 | — | R 0.00 |

   is being told the last column was worked out from the third, and that this
   debt costs nothing to carry.

   Both serialisers are pinned here, because "one object, two serialisers"
   is only worth anything if they agree about a null. The JSON carries
   `interest: null` where the Markdown prints '—'; zero would tell a parsing
   consumer the thing the section total above it already refuses to say.

   Runs in bare node against the REAL report builders.
     node tests/report-debt-row-rate.test.cjs      # non-zero exit on failure */

const assert = require('assert');
const { financialReportMarkdown, financialReportJson } = require('../src/report');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const money = v => `R ${Number(v).toFixed(2)}`;

/* One rated card, one unrated car loan. The mixed shape is the one that
   matters: an all-unrated book never reaches this table's interest column
   with a number worth arguing about, and an all-rated book cannot regress. */
const DATA = {
  generated: '2026-09-02 09:00',
  periodLabel: 'September 2026',
  rangeNote: '',
  detail: 'summary',
  currency: 'R',
  income: 0, spend: 0, net: 0, budgetIncome: 0, budgetSpend: 0,
  categories: [], spendByCategory: [], categoryGap: { uncat: 0, netted: 0 },
  savings: null,
  debts: {
    count: 2, active: 2, total: 182400,
    perMonth: 3400, interest: 341.17,
    coverage: { shown: 1, total: 2, missing: 1 },
    rows: [
      { name: 'Visa Gold', balance: 18400, rate: 22.25, interest: 341.17 },
      { name: 'Car', balance: 164000, rate: 0, interest: 0 },
    ],
  },
  netWorth: { net: 0, assets: 0, liabilities: 0 },
  health: null,
  transactions: null,
};

const md = financialReportMarkdown(DATA, money);
const json = JSON.parse(financialReportJson(DATA));

/* ---- 1. the Markdown row ---- */
{
  const section = md.split(`## ${i18n.t('report.section.debt')}`)[1].split('\n## ')[0];
  const carLine = section.split('\n').find(l => l.includes('| Car |'));
  ok(carLine, 'the unrated debt is still listed — holding a figure back is not hiding the row');
  ok(!/R 0\.00/.test(carLine),
    'an unrated debt does not report R 0.00 of monthly interest');
  eq(carLine.split('|').map(c => c.trim()).filter(Boolean),
    ['Car', 'R 164000.00', '—', '—'],
    'rate and interest both read as unknown, in the same idiom, side by side');

  const visaLine = section.split('\n').find(l => l.includes('| Visa Gold |'));
  eq(visaLine.split('|').map(c => c.trim()).filter(Boolean),
    ['Visa Gold', 'R 18400.00', '22.25%', 'R 341.17'],
    'a rated debt is untouched — this changes nothing a reader could already trust');
}

/* ---- 2. the JSON twin agrees about the null ---- */
{
  const car = json.debts.rows.find(r => r.name === 'Car');
  const visa = json.debts.rows.find(r => r.name === 'Visa Gold');
  eq(car.interest, null, 'JSON carries null, not 0, where the Markdown prints a dash');
  eq(car.rate, 0, 'the rate it was missing is still reported as it was stored');
  eq(visa.interest, 341.17, 'a rated row is unchanged in the JSON too');
}

/* ---- 3. negative control: the old behaviour would have failed section 1 ----
   Restating the pre-fix expression rather than trusting the assertions above
   to be load-bearing. If money(d.interest) came back, the row reads R 0.00 and
   section 1's second assertion goes red. */
{
  const oldCell = money(DATA.debts.rows[1].interest);
  eq(oldCell, 'R 0.00', 'the pre-fix cell really did render a zero — this test has teeth');
}

console.log(`PASS — an unrated debt reports no interest, in both serialisers (${checks} checks).`);
