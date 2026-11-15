'use strict';
/* THE PLAN BAR'S SPOKEN SENTENCE MUST NOT READ A NEGATIVE AS AN AMOUNT
   (left over from the 14 Oct 2026 audit fix wave).

   The bar under the Plan hero carries the whole split as one spoken sentence
   in its aria-label — the screen-reader twin of the figures beside it. The
   sentence printed two figures that can go below zero as if they could not:

     "… R -500,00 not yet allocated."   free = pot − allocated, negative as soon
                                        as the buckets hold more than the plan
     "R -300,00 still left, …"          left = pot − spent, negative once more
                                        has gone than the plan ever held

   A sighted reader gets the same figure in danger red beside "Not spoken for"
   or under "Still left", and the colour says which way it points. A screen
   reader gets "minus five hundred not yet allocated": a number that answers a
   question nobody asked, read in the voice of one that is fine. The loud card
   further down already words the first case properly ("R 500,00 more is
   placed than this plan holds"); the sentence now does the same, and words
   the second as what it is.

   REWORDED 15 Nov 2026 with the page: the bar is now one slice per bucket,
   each slice a button that opens it, so the strip is role=group rather than
   role=img (an image hides its children, buttons included) and keeps the
   sentence as the group's name. The words are the page's new ones — "money
   in", "allocated", "left to spend", "left to allocate" — and the rule is
   unchanged: a figure below zero is worded as what it is ("R 500,00 more is
   allocated than the money in"), never spoken as a minus.

   Drives the REAL registerPlan over the dom-stub (the same mount as
   plan-overspend.test.cjs) and reads the label back.

     node tests/plan-split-aria-label.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const registerPlan = require('../src/views/plan');
const { planSummary } = require('../src/plan-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
async function splitBar(plan) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\n---\n' },
    { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  /* Signed, the way the real formatter is: a negative prints its minus. */
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  ctx.S.plans = { [plan.file]: plan };
  ctx.S.planName = plan.file;
  registerPlan(ctx);
  ctx.renderPlan();
  return $('#planPot').querySelector('.plan-split');
}
async function splitLabel(plan) {
  const bar = await splitBar(plan);
  return bar ? bar.getAttribute('aria-label') : null;
}
const full = (file, extra) => ({ file, name: file, fmRaw: '', started: '2026-09-01',
  status: 'active', sources: [], envelopes: [], items: [], ...extra });
const NEG = /R -\d/;

(async () => {
  /* ---- 1. over-placed: the buckets hold R 500 more than the plan ---- */
  {
    const plan = full('Over placed', {
      sources: [{ name: 'Bonus', kind: 'Bonus', date: '2026-09-01', amount: 10000, status: 'received', notes: '' }],
      envelopes: [{ name: 'Car', amount: 6000, note: '', tint: '' }, { name: 'Holiday', amount: 4500, note: '', tint: '' }],
    });
    eq(planSummary(plan).free, -500, 'precondition: free is negative on this plan');
    const label = await splitLabel(plan);
    ok(label, 'the split bar carries an aria-label');
    ok(!NEG.test(label), `the spoken split prints no negative amount (got "${label}")`);
    ok(!/is not allocated/.test(label),
      `and does not call an over-allocation "not allocated" (got "${label}")`);
    /* In the words under the bar, "more is allocated than the money in" — one
       word per quantity, seen and spoken alike (2026-10-20 audit, D2-14;
       tests/plan-spoken-for-words.test.cjs). */
    ok(/R 500\.00 more is allocated than the money in/.test(label),
      `it names the R 500 allocated past the money in instead (got "${label}")`);
    ok(/R 10000\.00 left to spend/.test(label), `the parts that were right stay as they were (got "${label}")`);
  }

  /* ---- 2. spent past the pot: R 300 more gone than the plan held ---- */
  {
    const plan = full('Over spent', {
      sources: [{ name: 'Refund', kind: 'Refund', date: '2026-09-01', amount: 1000, status: 'received', notes: '' }],
      envelopes: [{ name: 'Repairs', amount: 1000, note: '', tint: '' }],
      items: [{ name: 'Geyser', envelope: 'Repairs', amount: 1300, spent: 1300, status: 'done', category: '', notes: '' }],
    });
    eq(planSummary(plan).left, -300, 'precondition: left is negative on this plan');
    const label = await splitLabel(plan);
    ok(!NEG.test(label), `the spoken split prints no negative amount (got "${label}")`);
    ok(!/left to spend/.test(label), `and does not call an overrun "left to spend" (got "${label}")`);
    ok(/R 300\.00 more spent than the money in/.test(label),
      `it names the R 300 spent past the plan instead (got "${label}")`);
    ok(/R 300\.00 was spent past what its bucket held/.test(label),
      `the bucket overspend sentence is unchanged (got "${label}")`);
  }

  /* ---- 3. a healthy plan reads exactly as before ---- */
  {
    const plan = full('Healthy', {
      sources: [{ name: 'Bonus', kind: 'Bonus', date: '2026-09-01', amount: 10000, status: 'received', notes: '' }],
      envelopes: [{ name: 'Car', amount: 6000, note: '', tint: '' }],
      items: [{ name: 'Tyres', envelope: 'Car', amount: 2000, spent: 2000, status: 'done', category: '', notes: '' }],
    });
    const bar = await splitBar(plan);
    eq(bar.getAttribute('aria-label'),
      'Money in R 10000.00. R 6000.00 allocated, of which R 2000.00 is spent. R 4000.00 is not allocated. '
      + 'R 8000.00 left to spend, R 4000.00 of it left to allocate.',
      'a plan with nothing over reads in the words the hero prints (2026-10-20 audit, D2-14)');
    /* role=img would hide the slice buttons from a screen reader; a group
       keeps them reachable and still names itself with the sentence. */
    eq(bar.attrs.role, 'group', 'the bar is a group of slice buttons, not an image');
  }

  console.log(`PASS plan-split-aria-label (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
