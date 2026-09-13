'use strict';
/* THE OVERSPEND THE PLAN PAGE USED TO SWALLOW.

   Reported from a live vault, 13 Sep 2026. A plan holding R 48 200 had R 28 282
   placed across five buckets, and a second car repair pushed actual spending to
   R 33 659 — R 5 377 more than the buckets ever held. The page printed:

     LEFT TO PLACE  R 19 918,00          ← free = pot − allocated
     Spoken for     R      0,00
     Not spoken for R 19 918,00
     Already spent  R 33 659,00
     Still left     R 14 541,00          ← in small italics, under the fold

   Every figure correct; the headline a lie by omission. `free` is pot minus
   allocated and never looks at `spent`, so money that leaves an OVERSPENT
   bucket leaves the pot without reducing `free`. The reader was invited to
   place R 19 918 when only R 14 541 existed, and the R 5 377 gap between the
   two was named nowhere on the page: both the hero's alarm state and the loud
   card at the bottom keyed off `free < 0`, which is false here.

   Two figures close it, and the whole of this suite is about their edges:

     overspend = max(0, spent − allocated)      what went past the buckets
     placeable = pot − max(allocated, spent)    what can still be placed

   `placeable` is min(free, left) by construction — it is the smaller of "not
   in a bucket" and "not yet gone", because placing money requires BOTH. It is
   derived here once, from the same sums as everything else on the page, rather
   than min()'d at a call site: two figures for the same thing derived by two
   different rules is this repo's recurring bug shape.

     node tests/plan-overspend.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

const { planSummary, envelopeBar, round2 } = require('../src/plan-math');
const registerPlan = require('../src/views/plan');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ------------------------------------------------------------------ *
 * 1. The reported vault, figure for figure                            *
 * ------------------------------------------------------------------ */

/* Ruan's "August Extra Money" as it stood when the screenshot was taken: the
   file's five buckets and four items, plus the second Subaru repair that had
   just been entered. Worked by hand — 40 000 + 8 200 in; 15 412 + 5 200 +
   4 370 + 1 300 + 2 000 placed; 15 412 + 8 678 + 1 199 + 4 000 + 4 370 gone. */
const REPORTED = {
  sources: [
    { name: 'UIF Maternity Payout', amount: 40000, status: 'received' },
    { name: 'SARS Payout', amount: 8200, status: 'received' },
  ],
  envelopes: [
    { name: 'Subaru Repair', amount: 15412 },
    { name: 'Oral hygiene', amount: 5200 },
    { name: 'Emergency fund', amount: 4370 },
    { name: 'Baby Items', amount: 1300 },
    { name: 'Church Camp', amount: 2000 },
  ],
  items: [
    { name: 'Fix brittle pipe & Fix Brakes', envelope: 'Subaru Repair', amount: 15412, spent: 15412 },
    { name: 'Second car repair', envelope: 'Subaru Repair', amount: 8678, spent: 8678 },
    { name: 'Toothbrush', envelope: 'Oral hygiene', amount: 1199, spent: 1199 },
    { name: 'Dental Clean', envelope: 'Oral hygiene', amount: 4000, spent: 4000 },
    { name: 'Transfer', envelope: 'Emergency fund', amount: 4370, spent: 4370 },
  ],
};

const R = planSummary(REPORTED);

/* The figures the screenshot showed — unchanged, because none of them was
   wrong. They are pinned so a future edit to the new arithmetic cannot quietly
   move the old. */
eq(R.pot, 48200, 'pot: the two payouts');
eq(R.allocated, 28282, 'allocated: the five buckets');
eq(R.spent, 33659, 'spent: the five items, second repair included');
eq(R.committed, 0, 'committed clamps: nothing placed remains unspent');
eq(R.free, 19918, 'free is still pot minus allocated — a true fact about the buckets');
eq(R.left, 14541, 'left is still pot minus spent');

/* The two new ones, and the point of the whole exercise. */
eq(R.overspend, 5377, 'R 5 377 went past what the buckets held — the figure the page never named');
eq(R.placeable, 14541, 'only R 14 541 can still be placed, not the R 19 918 the hero used to offer');
ok(R.placeable < R.free, 'an overspent plan can place strictly less than is unbucketed — the bug in one line');

/* ------------------------------------------------------------------ *
 * 2. The definitions, held apart from the worked example              *
 * ------------------------------------------------------------------ */

/* A healthy plan must be untouched by any of this: nothing overspent, and
   placeable is exactly free, so the hero keeps saying what it always said. */
const healthy = planSummary({
  sources: [{ amount: 1000, status: 'received' }],
  envelopes: [{ amount: 400 }],
  items: [{ amount: 400, spent: 100 }],
});
eq(healthy.overspend, 0, 'nothing is overspent when the buckets hold more than has gone');
eq(healthy.placeable, healthy.free, 'on a healthy plan placeable IS free — no behaviour change');
eq(healthy.placeable, 600, 'and it is the plain figure: 1 000 pot less 400 placed');
ok(healthy.left > healthy.placeable,
  'left exceeds placeable on a healthy plan — the two hero figures say different things');

/* Overspent, but the pot still covers it: placeable collapses onto left. */
const over = planSummary({
  sources: [{ amount: 1000, status: 'received' }],
  envelopes: [{ amount: 400 }],
  items: [{ amount: 400, spent: 900 }],
});
eq(over.overspend, 500, 'R 900 gone from a R 400 bucket is R 500 overspent');
eq(over.placeable, 100, 'placeable follows the money actually gone, not the bucket');
eq(over.placeable, over.left, 'once a plan is overspent every remaining rand is unplaced');
ok(over.placeable < over.free, 'and it is strictly below free, which still reads 600');

/* Over-PLACED (buckets beyond the pot) with nothing much spent: the case that
   already worked, and must keep working. placeable goes negative through
   allocated, not through spent. */
const stretched = planSummary({
  sources: [{ amount: 1000, status: 'received' }],
  envelopes: [{ amount: 1400 }],
  items: [{ amount: 1400, spent: 200 }],
});
eq(stretched.overspend, 0, 'placing more than the pot holds is not overSPENDING — nothing has gone');
eq(stretched.placeable, -400, 'placeable is negative, exactly as free is, when the buckets overreach');
eq(stretched.placeable, stretched.free, 'and equals free, because spent is nowhere near allocated');

/* Spent clean past the pot: the worst case, and the one where placeable must
   follow spent rather than allocated. */
const ruined = planSummary({
  sources: [{ amount: 1000, status: 'received' }],
  envelopes: [{ amount: 400 }],
  items: [{ amount: 400, spent: 1300 }],
});
eq(ruined.overspend, 900, 'R 1 300 from a R 400 bucket');
eq(ruined.placeable, -300, 'you are R 300 past the pot itself — placeable says so');
eq(ruined.left, -300, 'left agrees, because past the pot the binding constraint is the money');
ok(ruined.free > 0, 'free would still have claimed R 600 was available to place');

/* An empty plan must produce neither NaN nor a throw on either new figure. */
const empty = planSummary({ sources: [], envelopes: [], items: [] });
eq(empty.overspend, 0, 'an empty plan has overspent nothing');
eq(empty.placeable, 0, 'and has nothing to place');
for (const [k, v] of Object.entries(empty)) {
  ok(Number.isFinite(v), `empty plan: ${k} must be a finite number, got ${v}`);
}

/* ------------------------------------------------------------------ *
 * 3. The invariants, over randomised plans                            *
 * ------------------------------------------------------------------ */

/* Same deterministic generator as tests/plan.test.cjs, same reason: a failure
   must be reproducible from the seed rather than vanish on the next run. */
let seed = 20260913;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const cents = () => Math.round(rnd() * 5000000) / 100;

for (let n = 0; n < 400; n++) {
  const p = {
    sources: Array.from({ length: 1 + Math.floor(rnd() * 6) },
      () => ({ amount: cents(), status: rnd() < 0.5 ? 'received' : 'expected' })),
    envelopes: Array.from({ length: Math.floor(rnd() * 7) }, () => ({ amount: cents() })),
    items: Array.from({ length: Math.floor(rnd() * 12) }, () => ({ amount: cents(), spent: cents() })),
  };
  const q = planSummary(p);

  /* placeable is the SMALLER of the two constraints, always. This is the
     assertion that would have caught the reported bug: the old hero printed
     free, and free is only the answer while it is also the smaller. */
  assert.strictEqual(q.placeable, round2(Math.min(q.free, q.left)),
    `placeable must be min(free, left) (n=${n}, seed 20260913)`);
  assert.ok(q.placeable <= q.free + 0.005,
    `placeable may never exceed free — that is the overstatement (n=${n})`);
  assert.ok(q.placeable <= q.left + 0.005,
    `placeable may never exceed what is left (n=${n})`);

  /* overspend never goes negative, and is exactly the distance between the two
     clamped figures the bar already carried. */
  assert.ok(q.overspend >= 0, `overspend is clamped at zero (n=${n})`);
  assert.strictEqual(round2(q.allocated - q.spent + q.overspend), q.committed,
    `allocated − spent + overspend must land back on committed (n=${n})`);

  /* And the relationship the page states in words: when anything is overspent,
     free overstates what can be placed by exactly the overspend. */
  if (q.overspend > 0.005) {
    assert.strictEqual(round2(q.free - q.placeable), q.overspend,
      `free overstates placeable by exactly the overspend (n=${n})`);
    assert.strictEqual(q.committed, 0,
      `an overspent plan has nothing left spoken for (n=${n})`);
  } else {
    assert.strictEqual(q.placeable, q.free,
      `with nothing overspent, placeable is free untouched (n=${n})`);
  }
}
checks += 7;

/* ------------------------------------------------------------------ *
 * 3b. envelopeBar — one bucket's own split, as three drawable widths  *
 * ------------------------------------------------------------------ */

/* The row states its remainder in words; this is the shape of that sentence.
   The only thing that can go wrong with a bar is a width that cannot be drawn,
   so that is what is pinned: three non-negative percentages totalling exactly
   100, on every bucket including the broken ones. */
eq(envelopeBar(5200, 1199), { spent: 23.06, left: 76.94, over: 0 },
  'a part-spent bucket fills green as far as the money went');
eq(envelopeBar(4370, 4370), { spent: 100, left: 0, over: 0 },
  'a bucket spent to the rand is solid green, with no sliver of "left" left over');
eq(envelopeBar(2000, 0), { spent: 0, left: 100, over: 0 },
  'an untouched bucket is all "placed and unspent"');
eq(envelopeBar(1000, 1600), { spent: 62.5, left: 0, over: 37.5 },
  'R 1 600 from a R 1 000 bucket scales to the SPENDING, so green stops where '
  + 'the bucket did and red runs to where the money did');
eq(envelopeBar(0, 0), { spent: 0, left: 0, over: 0 },
  'an empty bucket draws an empty bar rather than dividing by zero');
eq(envelopeBar(0, 500), { spent: 0, left: 0, over: 100 },
  'spending from a bucket holding nothing is all overshoot');
eq(envelopeBar(3, 1), { spent: 33.33, left: 66.67, over: 0 },
  'thirds still total 100 — left is the remainder, not a third rounding');

for (let n = 0; n < 400; n++) {
  const a = Math.round(rnd() * 500000) / 100;
  const sp = Math.round(rnd() * 500000) / 100;
  const b = envelopeBar(a, sp);
  for (const k of ['spent', 'left', 'over']) {
    assert.ok(b[k] >= 0, `envelopeBar ${k} must never be negative (a=${a} spent=${sp})`);
    assert.ok(b[k] <= 100, `envelopeBar ${k} must never exceed the track (a=${a} spent=${sp})`);
  }
  const total = round2(b.spent + b.left + b.over);
  assert.ok(total === 100 || total === 0,
    `envelopeBar widths must total exactly 100 (or 0 on an empty bucket), got ${total} (a=${a} spent=${sp})`);
  /* An overspent bucket shows red and no "left"; a healthy one the reverse.
     The two can never both be non-zero — that would be money simultaneously
     unspent and overspent. */
  assert.ok(!(b.left > 0 && b.over > 0),
    `a bucket cannot be both unspent and overspent (a=${a} spent=${sp})`);
}
checks += 5;

/* ------------------------------------------------------------------ *
 * 4. The page must SAY it — the half a pure-arithmetic test misses    *
 * ------------------------------------------------------------------ */

/* Every figure in section 1 was already correct BEFORE this fix. What was
   broken was the TELLING, so the telling is what has to be pinned: render the
   real view over the reported plan and read the text back out. Reached through
   registerPlan(ctx) the way controller.js reaches it, never a copy. */
const B = 'Budget';
const { makeDom } = require('./helpers/dom-stub.cjs');

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

const full = (file, name, extra) => ({ file, name, fmRaw: '', started: '2026-08-11',
  status: 'active', sources: [], envelopes: [], items: [], ...extra });

(async () => {
  /* ---- the reported plan ---- */
  {
    const { $ } = await mountPlan(full('August Extra Money', 'August Extra Money', REPORTED));
    const pot = $('#planPot');
    const hero = pot.textContent;
    const fig = (pot.querySelector('.pot-fig') || {}).textContent || '';

    /* THE HEADLINE, which is the whole report: R 19 918,00 must be gone from
       the hero's big figure, because the reader cannot place it. */
    ok(!/19918/.test(fig.replace(/\s/g, '')),
      `the hero must not offer the R 19 918 that overspending already took (got "${fig}")`);
    ok(/14541/.test(fig.replace(/\s/g, '')),
      `the hero must lead with the R 14 541 that can actually be placed (got "${fig}")`);

    /* THE SECOND FIGURE, at a size a reader can see, and WHICH figure it is.
       "Still left to spend" used to be a small italic subtotal rendered only
       when it disagreed with the hero — the thing reported as too small. It is
       a hero figure of its own now, EXCEPT here: on an overspent plan
       `placeable` collapses onto `left`, so printing it would show R 14 541
       twice side by side. The slot carries the overspend instead, which is the
       second most important fact in that state and the one that explains the
       first. `left` is not lost — it IS the first figure. */
    const second = pot.querySelector('.pot-fig-2');
    ok(second, 'the second hero figure is drawn');
    ok(/5377/.test((second.textContent || '').replace(/\s/g, '')),
      `an overspent plan puts the overspend in the second slot (got "${second.textContent}")`);
    ok(!/14541/.test((second.textContent || '').replace(/\s/g, '')),
      'and NOT the same number the first figure is already showing');
    ok(second._cls.has('text-danger'), 'in danger red, because it is an alarm');
    ok(!pot.querySelector('.sk2-left'),
      'the old small italic subtotal row is gone — "Still left" is not in two places at once');

    /* THE OVERSPEND, named in the key and again in the loud card. Before this
       fix neither mentioned it, because both keyed off free < 0. */
    ok(/5377/.test(hero.replace(/\s/g, '')), 'the R 5 377 overspend appears in the hero key');
    const loud = $('#planFree');
    ok(!loud._cls.has('hidden'), 'the loud card shows on an overspent plan');
    ok(/5377/.test((loud.textContent || '').replace(/\s/g, '')),
      'and states the overspend in figures');
    ok(loud._cls.has('is-over'), 'in its alarmed state, not its cheerful one');
  }

  /* ---- a healthy plan is left exactly as it was ---- */
  {
    const { $ } = await mountPlan(full('Calm', 'Calm', {
      sources: [{ name: 'Bonus', kind: 'Bonus', amount: 1000, date: '2026-08-01', status: 'received', notes: '' }],
      envelopes: [{ name: 'Bucket', amount: 400, note: '', tint: '' }],
      items: [{ name: 'Thing', envelope: 'Bucket', amount: 400, spent: 100, status: 'part', category: '', notes: '' }],
    }));
    const pot = $('#planPot');
    ok(/600/.test(((pot.querySelector('.pot-fig') || {}).textContent || '')),
      'a healthy plan still leads with free — R 600 of a R 1 000 pot, unchanged');
    ok(/900/.test(((pot.querySelector('.pot-fig-2') || {}).textContent || '')),
      'with R 900 still left to spend beside it, the two saying different things');
    ok(!(pot.querySelector('.pot-fig-2') || { _cls: new Set() })._cls.has('text-danger'),
      'and in ordinary ink — a healthy plan raises no alarm in the hero');
    ok(!/over/i.test(pot.textContent), 'and no overspend row anywhere on a healthy plan');
    ok(!$('#planFree')._cls.has('is-over'),
      'the loud card stays cheerful — R 600 to place is an invitation, not an alarm');
  }

  /* ---- 5. what is left in each bucket, on its collapsed row ----

     The row's right-hand figure is what was PLACED, and it has not moved since
     the day it was set. "Have I anything left for the dentist?" could only be
     answered by opening every bucket in turn — so each collapsed row now
     carries its own remainder, and the wording distinguishes the three states
     a bare figure conflates. */
  {
    const { $ } = await mountPlan(full('Buckets', 'Buckets', {
      sources: [{ name: 'Payout', kind: 'UIF', amount: 20000, date: '2026-08-01', status: 'received', notes: '' }],
      envelopes: [
        { name: 'Part spent', amount: 5000, note: '', tint: '' },
        { name: 'Overspent', amount: 1000, note: '', tint: '' },
        { name: 'Emptied', amount: 2000, note: '', tint: '' },
        { name: 'Untouched', amount: 3000, note: '', tint: '' },
      ],
      items: [
        { name: 'a', envelope: 'Part spent', amount: 5000, spent: 1250, status: 'part', category: '', notes: '' },
        { name: 'b', envelope: 'Overspent', amount: 1000, spent: 1600, status: 'done', category: '', notes: '' },
        { name: 'c', envelope: 'Emptied', amount: 2000, spent: 2000, status: 'done', category: '', notes: '' },
      ],
    }));
    /* The FIRST bucket is the expanded one (renderEnvelopes opens it by
       default), so the three collapsed rows are the last three. */
    const rows = $('#planEnvelopes').querySelectorAll('.env-sum');
    const rem = {};
    for (const r of rows) {
      const name = (r.querySelector('.env-sum-name') || {}).textContent || '';
      rem[name] = ((r.querySelector('.env-sum-rem') || {}).textContent || '').replace(/\s/g, '');
    }
    eq(Object.keys(rem).sort(), ['Emptied', 'Overspent', 'Untouched'],
      'the open bucket keeps its card; every other bucket is a collapsed row');
    /* R 1 600 gone from a R 1 000 bucket is R 600 OVER — the distance past the
       bucket, never the total spent and never a negative "left". */
    ok(/600/.test(rem.Overspent) && !/1600/.test(rem.Overspent),
      `an overspent bucket says how far past its amount it went (got "${rem.Overspent}")`);
    ok(/over/i.test(rem.Overspent), 'and says the word, not just the colour');
    ok(/allofitspent/i.test(rem.Emptied),
      `a bucket spent to the rand says so rather than printing R 0,00 (got "${rem.Emptied}")`);
    ok(/nothingspentyet/i.test(rem.Untouched),
      `an untouched bucket must NOT restate its placed amount as "left" (got "${rem.Untouched}")`);
    ok(!/3000/.test(rem.Untouched),
      'that restatement is exactly the duplication the hero was fixed for');

    /* THE BAR beside each remainder. Present on every collapsed row, with its
       three segments — a row that lost it silently would take the at-a-glance
       reading with it and leave the words behind, which is the failure mode
       nobody notices. */
    for (const r of rows) {
      const name = (r.querySelector('.env-sum-name') || {}).textContent || '';
      const b = r.querySelector('.env-sum-bar');
      ok(b, `${name}: the collapsed row carries its own split bar`);
      eq(b.children.length, 3, `${name}: three segments — spent, left, over`);
      ok(b.attrs['aria-hidden'] === 'true',
        `${name}: the bar is decorative — the remainder beside it is the accessible text`);
    }
    const barOf = n => rows.find(r =>
      ((r.querySelector('.env-sum-name') || {}).textContent || '') === n).querySelector('.env-sum-bar');
    ok(/width:100%/.test(barOf('Overspent').children[0].attrs.style || '') === false,
      'the overspent bucket does not fill its green to the whole track');
    ok(Number((barOf('Overspent').children[2].attrs.style || '').replace(/\D+/g, '')) > 0,
      'the overspent bucket draws a red overshoot segment');
    ok((barOf('Untouched').children[1].attrs.style || '').includes('100'),
      'the untouched bucket is all "placed and unspent"');
    ok((barOf('Emptied').children[0].attrs.style || '').includes('100'),
      'the emptied bucket is solid green');

    /* The open bucket, swapped in, proves the part-spent wording and — the
       reason envelopeRemainder takes a state rather than an envelope — that it
       agrees with the expanded card's own rail. */
    const collapsed = $('#planEnvelopes').querySelectorAll('.env-sum')
      .map(r => (r.querySelector('.env-sum-name') || {}).textContent);
    ok(!collapsed.includes('Part spent'), 'precondition: "Part spent" is the open card, not a row');
  }

  /* ---- a fresh plan must not print the pot twice ---- */
  {
    const { $ } = await mountPlan(full('Fresh', 'Fresh', {
      sources: [{ name: 'Bonus', kind: 'Bonus', amount: 1000, date: '2026-08-01', status: 'received', notes: '' }],
    }));
    ok(!$('#planPot').querySelector('.pot-fig-2'),
      'nothing spent yet means "Still left" would just restate the pot — so it is not drawn');
  }

  console.log(`plan-overspend: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
