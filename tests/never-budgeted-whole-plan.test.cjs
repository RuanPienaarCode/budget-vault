'use strict';
/* "Income never budgeted" is income the WHOLE plan never claimed, and the
   set-aside the plan did claim is its own line (2026-10-07 audit, L2a-03).

   On the audited vault the Score's flow card printed a "Share of income
   budgeted" over 100% beside a POSITIVE "Income never budgeted": the share
   counted the plan's set-aside envelopes (ISSUE 40's rule — a rand into the
   emergency fund is as allocated as a rand of groceries) while `neverBudgeted`
   was `income − spending envelopes`, so the planned investment debit orders
   read as income nobody had budgeted. ADR-0007 defines the figure as income the
   plan never claimed at all, negative when the plan is over-allocated — as that
   plan was.

   The rule now, one lens (BUDGET) for all three lefts:
     leftInBudget   = spending envelopes − the ADR-0005 numerator
     setAsideToMove = set-aside envelopes − set-aside sent so far
     neverBudgeted  = income − (spending envelopes + set-aside envelopes)
     together       = their sum = income − gross spend − the assume-spent provision
   "Set aside, still to move" is measured on the SENDING side (the set-aside
   term of the ADR-0005 numerator), not on the Saving band: on the committed
   household the R 2 000 investment debit order left the cheque account for an
   account the vault does not hold, so it never reaches a fund the Saving band
   can see — and it is not still to move.

   Pure periodFlow() first, then the REAL views over the committed synthetic
   household (and a variant whose plan claims more than its income), clock
   pinned.

     node tests/never-budgeted-whole-plan.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');
const { SEED, PERIOD, TODAY, B } = require('./figures/household.cjs');
const { periodFlow } = require('../src/money-flow');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-6, `${m} (got ${a}, want ${b})`); checks++; };

const base = {
  income: 40000, spentTotal: 12000, setAsideSpent: 2000, assumedSpent: 0,
  budgeted: 30000, budgetSetAside: 5000, budgetIncome: 40000, periodFinished: false,
  spendByCat: {}, fixedCats: new Set(), catType: () => null, savingContribution: 0, debts: [],
};

/* ---- 1. the three lefts, by hand ---------------------------------------- */
{
  const L = periodFlow(base).lefts;
  near(L.neverBudgeted, 40000 - (30000 + 5000), 'never budgeted: income less the WHOLE plan');
  near(L.setAsideToMove, 5000 - 2000, 'set aside, still to move: the set-aside envelopes less what was sent under them');
  near(L.leftInBudget, 30000 - (12000 - 2000), 'left in the spending budget: unchanged, against the ADR-0005 numerator');
  near(L.together, 40000 - 12000, 'together: income less everything that went out (no assume-spent provision here)');
}

/* ---- 2. the two lines on one card agree --------------------------------- */
{
  const f = periodFlow(base);
  near(f.lefts.neverBudgeted, base.budgetIncome * (1 - f.budget.allocatedOfIncome),
    '"Income never budgeted" is the part of the planned income "Share of income budgeted" leaves out');
  /* Negative control: the old rule fails that very check. */
  const oldRule = base.income - base.budgeted;
  ok(Math.abs(oldRule - base.budgetIncome * (1 - f.budget.allocatedOfIncome)) > 1,
    `negative control: income − spending envelopes (${oldRule}) disagrees with the share beside it — the check above can fail`);
}

/* ---- 3. the identity holds everywhere ------------------------------------ */
{
  let n = 0;
  for (const assumedSpent of [0, 750]) for (const budgetSetAside of [0, 5000, 50000])
    for (const setAsideSpent of [undefined, 0, 2000]) for (const budgeted of [0, 30000, 50000]) {
      const f = periodFlow({ ...base, assumedSpent, budgetSetAside, setAsideSpent, budgeted });
      const L = f.lefts;
      near(L.leftInBudget + L.setAsideToMove + L.neverBudgeted, L.together, 'the three lefts sum to together');
      near(L.together, base.income - base.spentTotal - assumedSpent,
        `together = income − gross spend − provision (assumed ${assumedSpent}, set-aside ${budgetSetAside}/${setAsideSpent}, budget ${budgeted})`);
      const D = L.display;
      ok(D.leftInBudget + D.setAsideToMove + D.neverBudgeted === D.together, 'the printed lefts add up, exactly');
      n++;
    }
  ok(n === 54, `the grid ran (${n} cases)`);
}

/* ---- 4. over-allocated: negative, never clamped ---------------------------- */
{
  const L = periodFlow({ ...base, budgetSetAside: 12000 }).lefts;
  near(L.neverBudgeted, -2000, 'a plan claiming more than its income reads negative — over-allocated, not zero');
  near(L.together, 40000 - 12000, 'and together is unmoved by how the plan was drawn up');
}

/* ---- 5. on screen ---------------------------------------------------------- */
const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textOf = e => (e ? e.textContent : '');
const chips = root => descend(root).filter(e => hasCls(e, 'score-flow-chip'))
  .map(c => ({ title: textOf(c.children.find(k => hasCls(k, 'l'))),
    rows: c.children.filter(k => hasCls(k, 'score-flow-row')).map(r => [textOf(r.children[0]), textOf(r.children[1])]) }));
/* The "Not yet spent" row's sentence on the phone tree (the Sankey caption is
   the same string, drawn only when its band is tall enough). */
const notYetSub = root => {
  const row = descend(root).filter(e => hasCls(e, 'score-flow-m-row'))
    .find(r => textOf(descend(r).find(e => hasCls(e, 'score-flow-m-name'))) === i18n.t('score.flow.notYetSpent'));
  return row ? textOf(descend(row).find(e => hasCls(e, 'score-flow-m-sub'))) : null;
};
const KEYS = ['score.flow.chip.leftsThree', 'score.flow.chip.setAsideToMove', 'score.flow.chip.overAllocated',
  'score.flow.sub.overAllocated', 'score.flow.subA.overAllocated', 'score.flow.sub.setAsideToMove'];

async function render(files) {
  const unpin = pinClock(TODAY);
  try {
    const { ctx, nodes } = await mountFor(files, { period: PERIOD });
    ctx.renderScore();
    return { ctx, root: nodes.get('#view-score') };
  } finally { unpin(); }
}

(async () => {
  for (const k of KEYS) ok(i18n.t(k) !== k, `en.js carries ${k}`);

  /* The committed household: 30 000 in, spending envelopes 15 500, set-aside
     2 000 (all of it sent), 13 600 gross spend, a 500 assume-spent provision. */
  {
    const { ctx, root } = await render(SEED);
    const lefts = chips(root).find(c => c.title === i18n.t('score.flow.chip.leftsThree'));
    ok(!!lefts, 'the lefts chip names three kinds when the plan sets money aside');
    eq(lefts.rows, [
      [i18n.t('score.flow.chip.leftInBudget'), ctx.money(3400, 0)],
      [i18n.t('score.flow.chip.setAsideToMove'), ctx.money(0, 0)],
      [i18n.t('score.flow.chip.neverBudgeted'), ctx.money(12500, 0)],
      [i18n.t('score.flow.chip.together'), ctx.money(15900, 0)],
    ], 'left 3 400 + still to move 0 + never budgeted 12 500 (30 000 − 17 500) = together 15 900');
    eq(notYetSub(root), i18n.t('score.flow.sub.notYetSpent', { inBudget: ctx.money(3400, 0), neverBudgeted: ctx.money(12500, 0) }),
      'the sentence under "Not yet spent" carries the corrected figure, and no set-aside part when nothing is still to move');
  }

  /* The same household with a plan that claims more than comes in: a 20 000
     investment envelope makes the plan 35 500 against 30 000 of income. */
  {
    const plan = SEED[`${B}/Budgets/${PERIOD}.md`].replace(/\| Investing \| investment \| 2000\.00 \|/, '| Investing | investment | 20000.00 |');
    ok(plan !== SEED[`${B}/Budgets/${PERIOD}.md`], 'fixture check: the investment envelope was rewritten');
    const { ctx, root } = await render({ ...SEED, [`${B}/Budgets/${PERIOD}.md`]: plan });
    const lefts = chips(root).find(c => c.title === i18n.t('score.flow.chip.leftsThree'));
    eq(lefts.rows, [
      [i18n.t('score.flow.chip.leftInBudget'), ctx.money(3400, 0)],
      [i18n.t('score.flow.chip.setAsideToMove'), ctx.money(18000, 0)],
      [i18n.t('score.flow.chip.overAllocated'), ctx.money(-5500, 0)],
      [i18n.t('score.flow.chip.together'), ctx.money(15900, 0)],
    ], 'over-allocated: the row says so, keeps its sign so the column still adds up, and together does not move');
    eq(notYetSub(root), i18n.t('score.flow.sub.overAllocated', { inBudget: ctx.money(3400, 0), beyond: ctx.money(5500, 0) })
      + ' · ' + i18n.t('score.flow.sub.setAsideToMove', { amount: ctx.money(18000, 0) }),
    'and the sentence under "Not yet spent" names the over-allocation in words and the set-aside still to move');
  }

  console.log(`PASS never-budgeted-whole-plan (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
