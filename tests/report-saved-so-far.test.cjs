'use strict';
/* "R X of R Y saved so far" — Y is the saving the household PLANNED.

   1.49.1 reworded "R Y set aside, R X moved so far" into "R X of R Y saved so
   far" and said, in its own changelog, what Y now means: how much of the
   saving you planned has reached your savings accounts, worded the same way
   on the Budget page and in the report. Only the Dashboard hero was moved
   onto that meaning (planFigures().setAside). The Budget page's Total spent
   tile and the Report kept filling Y with the set-aside actually PAID this
   period (budgetUsed().setAside) — and kept the old gate, so the sentence
   vanished whenever nothing had been paid yet. On the vault this was found
   on, a 3-month report read "R X of R X saved so far" — every rand in — with
   a quarter of the plan still to go, a 12-month one understated the plan by
   a sixth, and a current-month report printed no sentence at all while the
   Dashboard said "R 0 of R Y saved so far".

   Pinned here, over the committed synthetic household through the REAL
   loader and the REAL views:

     1. the Report's sentence names the planned set-aside, summed over every
        period the selection covers, beside what moved into the funds;
     2. its JSON sibling carries the same two figures as data
        (`set_aside_planned`, `set_aside_moved`);
     3. the sentence prints whenever the PLAN holds a set-aside — paid or
        not — and never when it holds none, which is the hero's own gate;
     4. the Budget page's strip says the same thing over the same seam;
     5. the set-aside that WAS paid is still named in the Report, in the
        hero's own fragment beside the hero's own sub-line, so gross Spend
        less it plus the provision is still the numerator the document
        prints (tests/report-reconciles-to-budget-used.test.cjs);
     6. moved comes before planned in the sentence — scripts/reconcile-page.cjs
        reads the two figures by position inside the fragment.

     node tests/report-saved-so-far.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor, createReport, kids, text } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* A second set-aside envelope nothing has paid into yet: the plan now sets
   aside R3 000 (Investing R2 000 + this R1 000) while R2 000 actually left
   for Investing and R1 000 reached the emergency fund. Three different
   numbers, so a sentence filled from the wrong one cannot pass by luck. */
const withRainyDay = () => ({
  ...SEED,
  [`${B}/Categories/Rainy day.md`]: '---\ntype: savings\ncolor: "#3399cc"\n---\n',
  [`${B}/Budgets/2026-09.md`]: SEED[`${B}/Budgets/2026-09.md`] + '| Rainy day | savings | 1000.00 |  |\n',
});
const TX = `${B}/Transactions/Cheque/2026-09.md`;
const BUDGET = `${B}/Budgets/2026-09.md`;

async function report(files, opts) {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(files, { period: PERIOD, budgetFolder: B });
    const out = await createReport(M, opts);
    return { M, ...out, i18n: require('../src/i18n') };
  } finally { unpin(); }
}
async function budgetStrip(files) {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(files, { period: PERIOD, budgetFolder: B });
    M.ctx.renderBudgets();
    const frag = kids(M.nodes.get('#budTotalsTop'), n => n.attrs && n.attrs['data-fig'] === 'bud-note-setaside')[0];
    return { M, frag: frag ? text(frag) : null, i18n: require('../src/i18n') };
  } finally { unpin(); }
}
const sentence = (i18n, money, planned, moved) =>
  i18n.t('dash.stat.ofWhichSetAside', { amount: money(planned, 0), moved: money(moved, 0) });

(async () => {
  /* ---- 1-2, 5-6. one period, three different numbers -------------------- */
  {
    const r = await report(withRainyDay());
    const { ctx } = r.M;
    const planned = ctx.planFigures(PERIOD).setAside;
    const paid = ctx.budgetUsed(PERIOD).setAside;
    const moved = ctx.movedToFunds(PERIOD);
    eq([planned, paid, moved], [3000, 2000, 1000], 'fixture: planned, paid and moved are three different figures');

    ok(r.md, 'the Markdown report was written');
    const want = sentence(r.i18n, ctx.money, planned, moved);
    ok(r.md.includes(want), `the Report names the PLANNED set-aside beside what moved — expected "${want}"`);
    ok(!r.md.includes(sentence(r.i18n, ctx.money, paid, moved)),
      'and not the set-aside paid this period, which is what it used to print');

    const bu = r.json.income_vs_spend.budget_used;
    eq(bu.set_aside_planned, planned, 'JSON budget_used.set_aside_planned is planFigures().setAside');
    eq(bu.set_aside_moved, moved, 'JSON budget_used.set_aside_moved is movedToFunds()');
    eq(bu.set_aside, paid, 'JSON budget_used.set_aside is still the ADR-0005 operand (paid), unchanged');

    ok(r.md.includes(r.i18n.t('dash.stat.setAside', { amount: ctx.money(paid, 0) })),
      'the set-aside PAID is still named, in the hero\'s own fragment, so the document reconciles gross spend to the numerator');

    const at = r.md.indexOf(want);
    const line = r.md.slice(at, at + want.length);
    ok(line.indexOf(ctx.money(moved, 0)) < line.indexOf(ctx.money(planned, 0)),
      'moved is the first figure and planned the second — the order the reconcile checker reads');
  }

  /* ---- 3. the gate is the PLAN, as on the hero ---------------------------- */
  {
    /* Nothing paid toward the set-aside yet: the outflow to Investing is gone,
       the plan still sets R2 000 aside. The old gate (paid > 0) printed
       nothing here — the current-month report that said nothing while the
       Dashboard said "R 0 of R Y saved so far". */
    const files = { ...SEED, [TX]: SEED[TX].replace('| 2026-09-02 | To unit trust | Investing | -2000.00 |  |  |  |\n', '') };
    ok(files[TX] !== SEED[TX], 'fixture: the Investing outflow was removed');
    const r = await report(files);
    const { ctx } = r.M;
    eq([ctx.planFigures(PERIOD).setAside, ctx.budgetUsed(PERIOD).setAside], [2000, 0], 'fixture: planned, nothing paid');
    const want = sentence(r.i18n, ctx.money, 2000, ctx.movedToFunds(PERIOD));
    ok(r.md.includes(want), `the sentence prints although nothing was paid yet — expected "${want}"`);
    eq(r.json.income_vs_spend.budget_used.set_aside_planned, 2000, 'and JSON carries the planned figure');

    const s = await budgetStrip(files);
    ok(s.frag && s.frag.includes(want), `the Budget page's strip says the same — got ${JSON.stringify(s.frag)}`);
  }
  {
    /* No set-aside envelope in the plan, though R2 000 still left for
       Investing: no "saved so far" sentence — there is no plan to measure
       against — and the paid set-aside is still named as held out. */
    const files = { ...SEED, [BUDGET]: SEED[BUDGET].replace('| Investing | investment | 2000.00 |  |\n', '') };
    ok(files[BUDGET] !== SEED[BUDGET], 'fixture: the Investing envelope was removed');
    const r = await report(files);
    const { ctx } = r.M;
    eq([ctx.planFigures(PERIOD).setAside, ctx.budgetUsed(PERIOD).setAside], [0, 2000], 'fixture: nothing planned, R2 000 paid');
    ok(!/saved so far/.test(r.md), 'no "saved so far" sentence when the plan sets nothing aside');
    ok(r.md.includes(r.i18n.t('dash.stat.setAside', { amount: ctx.money(2000, 0) })),
      'the paid set-aside is still named as held out of spent');
    eq(r.json.income_vs_spend.budget_used.set_aside_planned, 0, 'JSON says nothing was planned, as a zero');

    const s = await budgetStrip(files);
    eq(s.frag, null, 'and the Budget page draws no saved-so-far fragment either');
  }

  /* ---- 1. several periods: the plan summed over the selection ------------ */
  {
    const r = await report(withRainyDay(), { pill: '3m' });
    const { ctx } = r.M;
    eq(r.json.period_count, 2, 'fixture: the 3-month report covers August and September');
    const periods = ['2026-08', PERIOD];
    const planned = periods.reduce((t, p) => t + ctx.planFigures(p).setAside, 0);
    const moved = periods.reduce((t, p) => t + ctx.movedToFunds(p), 0);
    eq(planned, 3000, 'fixture: August has no budget file, so the plan is September\'s R3 000');
    ok(r.md.includes(sentence(r.i18n, ctx.money, planned, moved)), 'the multi-period sentence sums the plan over the selection');
    eq(r.json.income_vs_spend.budget_used.set_aside_planned, planned, 'and JSON carries that sum');
  }

  /* ---- 4. the Budget page reads the same seam ----------------------------- */
  {
    const s = await budgetStrip(withRainyDay());
    const { ctx } = s.M;
    const want = sentence(s.i18n, ctx.money, ctx.planFigures(PERIOD).setAside, ctx.movedToFunds(PERIOD));
    ok(s.frag && s.frag.includes(want), `the strip names the planned set-aside — expected "${want}", got ${JSON.stringify(s.frag)}`);
  }

  console.log(`PASS report-saved-so-far (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
