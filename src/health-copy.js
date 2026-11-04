'use strict';
/* Wording the Score page and the Dashboard's Financial health card both say,
   kept in one place so the two cannot word one fact two ways. Pure of the DOM:
   the caller hands in `money` (the page's formatter) and `loc` (locale()), so a
   guard test drives it from bare node. The arithmetic stays in health-math.js —
   this only chooses a sentence for a gap scoreBreakdown already measured. */

const i18n = require('./i18n');
const { FULL_MARKS } = require('./health-math');
const { decimalText } = require('./locale');

/* Years of income, to one place like the months of cover beside it (two places
   sat beside one, "2,40 years" by "3,9 months": 2026-10-20 audit D1-15). One
   place must not round a household UP onto the target it has not reached:
   2,96 years printed "3,0 years" beside a gap saying "to reach 3 years". Short
   of the target, a reading that would land on it is cut to the place below. */
function yearsNumber(v, loc) {
  const target = FULL_MARKS.netWorthMultiple;
  return v < target && Math.round(v * 10) / 10 >= target
    ? decimalText(Math.floor(v * 10) / 10, 1, loc) : decimalText(v, 1, loc);
}

/* The one concrete step for a pillar's gap (`pillar.gap` from scoreBreakdown),
   or '' where the vault cannot name one. Each sentence names the income its
   figure was measured against (2026-10-20 audit, M1-05/M1-06): the saving and
   net-worth gaps are shares of BUDGET income, the trim is all spending — fixed
   bills included — against HOUSEHOLD income. Moved verbatim from views/score.js
   so the Dashboard's "most points lost" line says what the Score page says. */
function gapSentence(g, { money, target }) {
  if (!g) { return ''; }
  const amount = money(g.amount, 0);
  return g.kind === 'fund' ? i18n.t('dash.health.why.fixFund', { amount, target })
    : g.kind === 'monthly' ? i18n.t('score.gap.fixMonthly', { amount, pct: Math.round(FULL_MARKS.savingsRate * 100) })
      : g.kind === 'interest' ? i18n.t('dash.health.why.fixInterest', { amount })
        : g.kind === 'trim' ? i18n.t('score.gap.fixTrim', { amount, pct: Math.round(FULL_MARKS.consumptionFloor * 100) })
          : i18n.t('score.gap.fixBuild', { amount, times: FULL_MARKS.netWorthMultiple });
}

module.exports = { yearsNumber, gapSentence };
