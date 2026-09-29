'use strict';
/* THE SAVING RATE IS REGULAR SAVING OVER NORMAL INCOME.

   Ruan, 29 Sep 2026: "we don't save 30%... it should be from our normal income
   we put aside to save, not lump sums because it messes the number." The health
   card read several times the regular rate on a vault whose regular transfers
   into funds were a fraction of that: the numerator counted every rand that
   crossed into a fund (a large UIF-style payout included) and the denominator
   was the HOUSEHOLD lens's income, which keeps rows the household marked
   Excluded.

   The rule, one scope on both sides of the ratio:

     saving rate = regular saving / budget income

     regular saving = transfers in from the household's own accounts, nothing it
                      marked Excluded, no interest, no pool-to-pool shuffle
                      (ctx.savingContribution, the very seam movedToFunds uses)
     budget income  = periodSummary(p).income, the figure the Dashboard and the
                      Budget page print (Excluded rows and non-budget accounts out)

   Synthetic household in tests/helpers/lane-r-household.cjs: R30 000 salary and
   R1 000 moved in August; a R25 000 UIF-style payout, a R5 000 tax rebate (both
   Excluded), a R2 500 gift straight into a fund and R80 of interest also reached
   the funds. Before: (1 000 + 25 000 + 5 000 + 2 500 + ...) over an income that
   held the windfalls too. After: 1 000 / 30 000.

     node tests/lane-r-saving-rate.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { B, FILES } = require('./helpers/lane-r-household.cjs');
const { renderDash, find, hasClass, textOf, pinClock, mountFor } = require('./helpers/dash-audit.cjs');
const { LENSES } = require('../src/ledger');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, m) => { assert.ok(a !== null && Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); checks++; };

/* The emergency-fund flag is what makes the Dashboard draw the health card at
   all for a household with one counted period. */
const FILES_HEALTH = { ...FILES,
  [`${B}/Accounts/Kids Fund.md`]: FILES[`${B}/Accounts/Kids Fund.md`].replace('budget: false\n', 'budget: false\nemergency_fund: true\n') };

(async () => {
  /* Sept 5: August is the one completed period behind the card. */
  const M = await renderDash(FILES_HEALTH, { today: '2026-09-05', period: '2026-09' });
  const ctx = M.ctx;
  const unpinned = pinClock('2026-09-05');
  try {
    const m = ctx.healthSnapshot().metrics;
    eq(m.countedPeriods, 1, 'August is the one counted period');

    /* ---- the denominator ---------------------------------------------------- */
    const budgetIncome = ctx.periodSummary('2026-08').income;
    near(budgetIncome, 30000, 'budget income is the salary alone: the Excluded UIF and rebate and the non-budget gift are out');
    near(m.monthlyIncome, budgetIncome, 'the health card divides by the income the Dashboard prints, not a second tally');
    const householdIncome = ctx.tally(ctx.ledger('2026-08-01', '2026-08-31'), LENSES.HOUSEHOLD).netIncome;
    ok(householdIncome > 60000, `the old base held the windfalls (${householdIncome}); this fixture only proves the fix if it did`);

    /* ---- the numerator ------------------------------------------------------ */
    near(m.monthlySavings, 1000, 'saved per month is the one regular transfer');
    near(m.monthlySavings, ctx.savingContribution('2026-08'), 'read through savingContribution, not re-assembled');
    near(m.savingsRate, 1000 / 30000, 'saving rate = regular saving / budget income');

    /* ---- every tile that divides by that income follows it ------------------ */
    // the fixture has no debts or fixed categories, so the shares are null; the
    // multiple of income is the one ratio it can check
    ok(m.netWorthMultiple === null || Math.abs(m.netWorthMultiple - m.netWorth / (budgetIncome * 12)) < 1e-9,
      'net worth as a multiple of income divides by the same income');
  } finally { unpinned(); }

  /* ---- the Dashboard health card prints it ------------------------------------ */
  const card = M.nodes.get('#healthBody');
  const tile = find(card, n => hasClass(n, 'health-fig') && /income saved on average/.test(textOf(n)))[0];
  ok(tile, 'the health card has its saving tile');
  const lv = find(tile, n => hasClass(n, 'lv'))[0];
  eq(textOf(lv).replace(/[^\d,.%]/g, ''), '3%', 'the tile prints 3% (1 000 of 30 000), not the inflated rate the windfalls made it');
  ok(/R\s?1\s?000/.test(textOf(tile).replace(/ /g, ' ')), 'and R 1 000 a month beside it');

  /* ---- the Score page reads the same snapshot -------------------------------- */
  {
    const unpin = pinClock('2026-09-05');
    try {
      const S = await mountFor(FILES_HEALTH, { period: '2026-09' });
      S.ctx.renderScore();
      const text = [...S.nodes.values()].map(n => textOf(n)).join(' \n ');
      ok(/Averaging 3% of income saved/.test(text.replace(/\u00a0/g, ' ')),
        `the Score page's saving line says 3% (found: ${(text.match(/Averaging[^\n]{0,60}/) || ['nothing'])[0]})`);
    } finally { unpin(); }
  }

  console.log(`PASS - the saving rate is regular saving over budget income (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
