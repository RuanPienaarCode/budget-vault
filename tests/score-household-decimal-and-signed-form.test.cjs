'use strict';
/* The Score prints numbers the way the household's other pages do (audit
   2026-10-14, L2a-N09, the Score and currency.js half).

   The Dashboard printed "2,1 months" and the Score "Now: 2.1 months covered" and
   "1.80 years of income" for the same household, because the Score formatted
   with toFixed() (a point) where the Dashboard replaces it with the country
   profile's mark; and the signed parts of the flow card read "R -900" beside a
   Dashboard printing "−R 2 300". The decimal is now the household's own; the
   signed parts take the Dashboard's form (a minus sign, U+2212, before the
   symbol), pinned where a part is negative: tests/score-flow-one-rule.test.cjs.

     node tests/score-household-decimal-and-signed-form.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock, leaves, ownText } = require('./helpers/figures.cjs');
const { SEED, PERIOD, TODAY } = require('./figures/household.cjs');
const { formatSigned, formatAmount } = require('../src/currency');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* ---- the helper ---- */
{
  const za = { thousands: ' ', decimal: ',' };
  eq(formatSigned('R', -900, 0, za), '\u2212R 900', 'a negative part: the minus before the symbol');
  eq(formatSigned('R', 900, 0, za), 'R 900', 'a positive part carries no sign');
  eq(formatSigned('R', -0.4, 0, za), 'R 0', 'a part that rounds to nothing carries no minus');
  eq(formatSigned('R', -0.005, 2, za), '\u2212R 0,01', 'but keeps it while a digit survives');
  eq(formatSigned('R', 0, 0, za), 'R 0', 'zero');
  eq(formatSigned('R', NaN, 0, za), 'R 0', 'non-finite reads 0, as formatAmount does');
  eq(formatSigned('R', -1234.5, 2, { thousands: ',', decimal: '.' }), '\u2212R 1,234.50', "and the locale's marks");
  eq(formatAmount('R', -900, 0, za), 'R -900', 'the balance form is unchanged');
}

/* ---- the Score ---- */
(async () => {
  const unpin = pinClock(TODAY);
  try {
    const { ctx, nodes } = await mountFor(SEED, { period: PERIOD });
    ctx.switchView = () => {};
    ctx.renderScore();
    const text = [...nodes.values()].map(r => [...leaves(r)].map(l => ownText(l)).join(' ')).join(' ').replace(/\s+/g, ' ');
    ok(/Now: \d+,\d months covered/.test(text), 'months covered use the household decimal comma');
    /* One place since 2026-10-20 (audit D1-15: "5,70 years" beside "3,9
       months"), and the base named (M1-05): tests/score-budget-income-base. */
    ok(/worth \d+,\d years of budget income/.test(text), 'years of income use it too');
    ok(!/\d\.\d+ (months covered|years of budget income)/.test(text), 'and neither prints a point');
  } finally { unpin(); }
  console.log(`PASS score-household-decimal-and-signed-form (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
