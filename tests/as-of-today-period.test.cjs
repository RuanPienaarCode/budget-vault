'use strict';
/* ISSUE 35 — the Dashboard counting money that has not moved.

   THE DEFECT, reproduced on 2026-09-02 against the `BudgetAudit` household
   (tests/_audit-seed.cjs). September, read on the 2nd:

     Income  R40 000   including a family gift dated 28 SEPTEMBER
     Spent   R11 590   including gym charges dated the 10th, 17th and 24th

   The arithmetic was right for the question "what does this calendar month's
   ledger add up to". Nobody opening a dashboard on the 2nd is asking that one.
   Every other figure on that card is present tense — cash on hand, net worth,
   what is still committed — and these two were the month's whole future
   wearing today's clothes.

   THE FIX closes the window at TODAY whenever the period contains it, and
   hands the remainder back as `scheduled` rather than dropping it. The money
   is real; it just has not moved.

   WHERE IT HAD TO GO. The narrowing lives in periodSummary(), not in the hero,
   and that is the load-bearing decision. The hero, the donut and the budget
   table's actuals all read this one function, and
   tests/cross-page-consistency.test.cjs pins an exact identity between them —
   narrowing the hero alone would have satisfied the issue and broken that
   identity in the same edit. "Two figures derived by different rules" is this
   repo's most-repeated bug shape, and a partial fix for it is just a new
   instance of it.

   WHAT IS PINNED

     1. The running period stops at today, and the rest is REPORTED, not lost.
     2. `scheduled` is measured over the complementary window, not by
        subtracting totals — `count` counts rows, and two windows classify
        rows independently.
     3. A FINISHED period is byte-for-byte what it always was. This is the
        whole of the history the trend chart, the score and the report read,
        and none of it may move.
     4. A FUTURE period reports the whole of itself as scheduled rather than
        clamping to nothing.
     5. Conservation still holds inside the narrowed window: income − spend
        and the by-category map describe the SAME rows.
     6. The hero says so on screen. A narrowed figure is an exclusion, and
        this app does not exclude in silence.

     node tests/as-of-today-period.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');
const { SEED, PERIOD, TODAY, atAuditDate } = require('./_audit-seed.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
  'healthCard', 'healthBody', 'healthSub', 'leftCard', 'leftBody', 'leftSub',
  'dashSplit', 'dashSplitSub', 'splitRange', 'dashBudget', 'dashBudgetSub',
  'dashPositionCard', 'dashPositionKpis', 'dashPositionSub', 'dashPositionNote'];

atAuditDate(async () => {
  const { FakeEl } = makeDom();
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;

  /* ---------------- 1. the running period stops at today ---------------- */
  const sum = ctx.periodSummary(PERIOD);
  eq(sum.asOf, TODAY, 'the summary says where it stops, rather than leaving the reader to work it out');
  eq(sum.income, 35000, 'income is the salary that landed, NOT the 28 September gift');
  /* 3 500 medical + 1 200 groceries. No gym charges from the 3rd on (this
     issue), and no R5 000 pram (ISSUE 41 — it left an earmarked fund, so it is
     reported as `fundedFromSavings` rather than as budget spend). The two
     fixes are independent and both are visible in this one figure. */
  eq(sum.spend, 4700, 'spend is what this period actually consumed, up to today');
  eq(sum.fundedFromSavings.spend, 5000, 'with the pram named separately, not lost');

  /* ------------- 2. and reports, rather than loses, the rest ------------- */
  eq(sum.scheduled.income, 5000, 'the gift is scheduled, not gone');
  eq(sum.scheduled.spend, 1890, 'and so are four gym charges and the Woolworths shop: 1 000 + 890');
  eq(sum.scheduled.from, '2026-09-03', 'from the day after the window closes');
  eq(sum.scheduled.count, 6, 'counted as ROWS by the same pass, never inferred by subtracting two totals');

  /* The two windows together are the whole period, which is the identity that
     makes "narrowed" different from "wrong". Restated here from the RAW rows
     rather than asked of the code under test. */
  const { start, end } = ctx.periodRange(PERIOD);
  const skip = ctx.nonBudgetLabels();
  /* The oracle walks the SAME row population the code under test does —
     ISSUE 41's earmarked-outgoing veto included. An oracle restating the
     arithmetic over a wider set is not an independent check of that code, it
     is a different question; tests/cross-page-consistency.test.cjs's own
     `nettingOf` says the same thing about the three vetoes that came before
     this one. */
  const earmarked = ctx.earmarkedLabels();
  let wholeIncome = 0, wholeSpend = 0;
  for (const t of ctx.txInPeriod(PERIOD)) {
    if (t.date < start || t.date > end || t.excluded || skip.has(t.label)) continue;
    if (t.amount < 0 && earmarked.has(t.label)) continue;
    if (ctx.catType(t.cat) === 'transfer') continue;
    if (t.amount > 0 && ctx.catType(t.cat) === 'income') wholeIncome += t.amount;
    if (t.amount < 0) wholeSpend += -t.amount;
  }
  eq(sum.income + sum.scheduled.income, wholeIncome,
    'so far plus scheduled is the whole period, for income');
  eq(sum.spend + sum.scheduled.spend, wholeSpend,
    'and for spend — nothing was dropped, only moved to the other side of today');

  /* --------------- 3. a finished period does not move at all ------------- */
  const aug = ctx.periodSummary('2026-08');
  eq(aug.asOf, '2026-08-31', 'August stops at its own end, because today is past it');
  eq(aug.income, 35000, 'and its income is untouched');
  eq(aug.spend, 8500, 'and so is its spend — every trailing figure the score and the trend read is history');
  eq(aug.scheduled, { income: 0, spend: 0, count: 0, from: null },
    'with nothing scheduled, because a finished period has no other side');

  /* ------------------ 4. a future period is not emptied ----------------- */
  const oct = ctx.periodSummary('2026-10');
  eq(oct.scheduled.from, '2026-10-01',
    'a period that has not started reports the whole of itself as scheduled, rather than clamping to nothing');

  /* -------- 5. conservation inside the narrowed window still holds ------- */
  {
    let byCatNet = 0;
    for (const v of Object.values(sum.byCat)) byCatNet += v;
    eq(Math.round(byCatNet * 100), Math.round(sum.net * 100),
      'the by-category map and the net describe the same rows — narrowing the window did not narrow one of them only');
  }

  /* ------------------- 6. and the card says so on screen ---------------- */
  const nodes = new Map(IDS.map(id => [id, new FakeEl(id === 'dashBudget' ? 'table' : 'div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/dashboard')(ctx);
  ctx.renderDashboard();

  const hero = nodes.get('heroCard').textContent;
  const want = i18n.t('dash.scheduledAhead', { amount: 'R 6890' });
  ok(hero.includes(want),
    `the hero names what its figures stop short of — wanted "${want}", got: ${hero}`);
  ok(hero.includes('R 35000.00'),
    `and prints the income that actually landed — got: ${hero}`);
  ok(!hero.includes('R 40000.00'),
    'never the whole-month figure that counted a gift three weeks away');

  console.log(`PASS as-of-today-period (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
