'use strict';
/* strandedPeriodDays (src/views/budgets.js) — the OLD cycle length behind a
   re-slice suggestion, guarded against the two ways it used to lie.

   1. It used to be handed only the STRANDED subset of S.budgets (what
      otherShapeBudgets() returns) to infer a gap from. That set holds, BY
      CONSTRUCTION, only the keys the current settings cannot address — so on
      a 7 -> 14 switch its own survivors are already 14 days apart, and
      inferIntervalFromKeys read that spacing back as "the old cycle was 14",
      the NEW length wearing the old one's name. The fix hands it every
      ISO-named key the vault holds instead.

   2. Even over the full population, a small vault can still show its only
      gap landing exactly on dstDays — indistinguishable from a genuine
      coincidence. Rather than let that silently emit a factor-of-1
      suggestion flagged `scaled: true`, the length must come back null
      (unknown).

   Runs in bare node. Wired into ./build.sh.
     node tests/reslice-stranded-inference-guard.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ROW = [{ category: 'Groceries', type: 'expense', amount: 500, amountRaw: null, notes: '' }];

function budgetsCtx(period_days, period_anchor, budgets) {
  const ctx = makeCtx({}, { settings: { month_start_day: 23, period_days, period_anchor } });
  ctx.S.txFiles = {};
  ctx.S.budgets = budgets;
  ctx.S.categories = [];
  ctx.registerDirty = () => {};
  require('../src/period')(ctx);
  require('../src/views/budgets')(ctx);
  return ctx;
}

/* ---- 1. inferred from the WHOLE vault, not the stranded subset alone ---- */
{
  // A vault that ran on a 7-day cycle against anchor 2026-08-07, now switched
  // to 14. Under the new phase, a key survives (stays addressable) only when
  // it lands on the anchor mod 14 — so every SECOND weekly key goes stranded
  // (07-17, 07-31, 08-14) while the others (07-24, 08-07) stay valid. The
  // stranded trio alone is spaced 14 days apart, which is the trap: it reads
  // back as "the old cycle was 14", the length that stranded it in the first
  // place. The whole vault, ISO keys of either phase, is still 7 days apart
  // throughout.
  const budgets = {
    '2026-07-17': ROW, '2026-07-24': ROW, '2026-07-31': ROW, '2026-08-07': ROW, '2026-08-14': ROW,
  };
  const ctx = budgetsCtx(14, '2026-08-07', budgets);
  const allKeys = Object.keys(budgets);

  eq(ctx.strandedPeriodDays('2026-08-14', allKeys, 14), 7,
    'the true 7-day cycle is read off the whole vault, not the 14-day-spaced stranded trio alone');

  // The old, buggy population — otherShapeBudgets() — reads 14 back, which is
  // exactly the failure this fix removes. Restated independently here (not
  // calling the exposed function a second way) so a future regression that
  // narrows the population back down trips this line, not just the one above.
  const { inferIntervalFromKeys } = require('../src/reslice');
  const stranded = ctx.otherShapeBudgets();
  eq(stranded, ['2026-07-17', '2026-07-31', '2026-08-14'], 'sanity check: these three are the ones the new phase strands');
  eq(inferIntervalFromKeys(stranded), 14,
    'sanity check on the trap itself: the stranded-only population really does read back the NEW length');
}

/* ---- 2. a gap that lands on dstDays comes back unknown, not scaled ---- */
{
  // Only two date-named keys exist anywhere in the vault, and they happen to
  // be exactly dstDays apart — indistinguishable from a coincidence, so the
  // honest answer is "unknown", not a factor-of-1 suggestion marked scaled.
  const budgets = { '2026-08-07': ROW, '2026-08-21': ROW };
  const ctx = budgetsCtx(14, '2026-08-07', budgets);
  const allKeys = Object.keys(budgets);

  eq(ctx.strandedPeriodDays('2026-08-21', allKeys, 14), null,
    'a sole 14-day gap cannot be told apart from dstDays itself, so it is unknown, not scaled');

  // A genuinely different gap is still trusted.
  const budgets2 = { '2026-08-07': ROW, '2026-08-14': ROW };
  const ctx2 = budgetsCtx(14, '2026-08-07', budgets2);
  eq(ctx2.strandedPeriodDays('2026-08-14', Object.keys(budgets2), 14), 7,
    'a gap that does NOT collide with dstDays is still reported, not thrown away');
}

/* ---- month-named keys are measured directly and are exempt from the clamp ---- */
{
  // A stranded MONTH-named file's length comes from periodRange, not
  // inferIntervalFromKeys — landing on dstDays there is a real coincidence
  // (a 30-day month against a 30-day interval), not the ISO-inference trap,
  // so it must NOT be nulled out.
  const ctx = budgetsCtx(30, '2026-08-01', { '2026-08': ROW });
  eq(ctx.strandedPeriodDays('2026-08', ['2026-08'], 30), 31,
    'a month-named key is measured by periodRange regardless of dstDays, and August is 31 days either way');
}

console.log(`PASS — reslice stranded-days inference reads the whole vault and refuses a coincidental factor of 1 (${checks} assertions).`);
