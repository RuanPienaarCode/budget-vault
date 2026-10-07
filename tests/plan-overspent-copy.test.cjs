'use strict';
/* An overspent plan tells the same figures to every reader (runtime test of
   the 7 Oct 2026 audit fixes, O1 and O2).

   O1. The split bar's aria label read "R -300.00 of it still placeable" on a
       plan whose visible card clamps the same figure to R 0.00. A
       screen-reader user was told a negative amount could be placed.
   O2. On a plan whose buckets hold the whole pot, the overspent card said
       "of which R 0.00 can still be placed — not the R 0.00 the buckets alone
       suggest": a contrast between two equal figures. The clause is dropped
       when the two are the same.

   The plan: R 1 000 in, two buckets that hold all of it (R 600 + R 400), and
   R 900 spent from the first. So R 300 is overspent, R 100 is left, R 400 is
   still spoken for, and placeable is R 100 - R 400 = -R 300.

     node tests/plan-overspent-copy.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { planSummary } = require('../src/plan-math');
const registerPlan = require('../src/views/plan');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const PLAN = {
  file: 'Year-end bonus', name: 'Year-end bonus', fmRaw: '', started: '2026-09-01', status: 'active',
  sources: [{ name: 'Bonus', amount: 1000, status: 'received' }],
  envelopes: [{ name: 'Car', amount: 600 }, { name: 'Holiday', amount: 400 }],
  items: [{ name: 'Tyres', envelope: 'Car', amount: 900, spent: 900 }],
};

async function mountPlan(plan) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\n---\n' },
    { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  ctx.S.plans = { [plan.file]: plan };
  ctx.S.planName = plan.file;
  registerPlan(ctx);
  ctx.renderPlan();
  return { ctx, $ };
}

(async () => {
  /* The fixture is the shape the two findings need, checked before any copy. */
  const sum = planSummary(PLAN);
  ok(Math.abs(sum.overspend - 300) < 0.005, `R 300 is overspent (got ${sum.overspend})`);
  ok(Math.abs(sum.left - 100) < 0.005, `R 100 is left (got ${sum.left})`);
  ok(sum.placeable < -0.005, `placeable is negative before any clamp (got ${sum.placeable})`);
  ok(Math.abs(sum.free) < 0.005, `the buckets hold the whole pot (free ${sum.free})`);

  const { $ } = await mountPlan(PLAN);

  /* O1 — the aria label clamps the way the card does. */
  const split = descend($('#planPot')).find(n => n._cls && n._cls.has('plan-split'));
  ok(split, 'the split bar is drawn');
  const label = split.getAttribute('aria-label') || '';
  ok(!/R -\d/.test(label), `the split bar's label states no negative amount (got "${label}")`);
  ok(/R 0\.00 of it still placeable/.test(label),
    `and says nothing of what is left can be placed (got "${label}")`);
  ok(/R 300\.00 was spent past what its bucket held/.test(label), 'the overspend still closes the label');

  /* O2 — no contrast between two equal figures. */
  const card = $('#planFree');
  const text = card.textContent || '';
  ok(/R 0\.00 can still be placed/.test(text), `the card says R 0.00 can still be placed (got "${text}")`);
  ok(!/not the R 0\.00 the buckets alone suggest/.test(text),
    `and does not contrast it with the same R 0.00 (got "${text}")`);

  /* The contrast stays where it says something: the same plan with R 200
     left out of the buckets, so the buckets alone suggest R 200 while
     nothing can be placed. */
  const loose = { ...PLAN, file: 'Loose', name: 'Loose',
    envelopes: [{ name: 'Car', amount: 400 }, { name: 'Holiday', amount: 400 }],
    items: [{ name: 'Tyres', envelope: 'Car', amount: 900, spent: 900 }] };
  const looseSum = planSummary(loose);
  ok(Math.abs(looseSum.free - 200) < 0.005 && looseSum.placeable < 0.005,
    `the second plan has R 200 unbucketed and nothing placeable (free ${looseSum.free}, placeable ${looseSum.placeable})`);
  const { $: $2 } = await mountPlan(loose);
  ok(/not the R 200\.00 the buckets alone suggest/.test($2('#planFree').textContent || ''),
    'where the figures differ, the card still names the one the buckets suggest');

  console.log(`PASS plan-overspent-copy (${checks} checks)`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
