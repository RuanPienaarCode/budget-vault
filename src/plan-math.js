'use strict';
/* Plan arithmetic — pure, no DOM, no obsidian import, so it is requirable in
   bare node and testable without a stub. Same split as owed-math.js and
   savings-math.js, and for the same reason: the Dashboard will eventually want
   to state "R 6 550 of your plan is unplaced" too, and two copies of this
   arithmetic in one app is exactly the drift these modules exist to prevent.

   THE FOUR SUMS, and the one relationship that must hold between them:

     pot        = Σ source.amount
     allocated  = Σ envelope.amount
     spent      = Σ item.spent
     free       = pot − allocated

   and the bar the page draws is spent + committed + free = pot, where
   committed is what is placed and not yet gone (allocated − spent while no
   bucket has run over). That identity is what makes the three segments
   meaningful side by side; planSummary is the only place it is computed, so
   it is the only place it can break.

   A fifth figure, `left` = pot − spent, answers a question the four above
   never do on their own: "how much do I still have?" It agrees with
   committed + free only while nothing is clamped — see the note on `left`
   below for why it is derived independently rather than added from those
   two.

   A sixth and seventh, `overspend` and `placeable`, were added on 1.45.0 after
   a live vault showed that `free` is the WRONG answer to "what can I still
   place?" once a bucket has been overspent — see their notes below. The short
   version: free is blind to spent, so an overspent plan overstates by exactly
   the overspend, and nothing on the page said so.

   Since 7 Oct 2026 those two — and `committed` — are taken BUCKET BY BUCKET,
   through `claimed` (see bucketClaims below). The plan-wide sums they used to
   be built from cannot see one bucket running over while another is untouched,
   and that is precisely when "what can I still place?" has a different
   answer. */

/* Share-of-pot badges are one partition of the pot, not independent roundings
   — see envelopeShares at the bottom of this file. */
const { sharePercents } = require('./share-percents');

/* The presets offered when adding a source. Deliberately NOT an enum the rest
   of the code branches on — a source's kind is a label for grouping and colour
   and nothing else, and a file may carry any word at all here (someone will
   type "Inheritance"). Anything the loader reads is kept verbatim; this list
   only seeds the dropdown. */
const SOURCE_KINDS = ['Salary', 'UIF', 'Tax', 'Bonus', 'Gift', 'Sale', 'Once-off', 'Other'];

const sum = (rows, pick) => rows.reduce((t, r) => t + (Number(pick(r)) || 0), 0);

/* round2 everywhere a total leaves this module. Floating-point addition over a
   dozen two-decimal amounts lands on 41249.999999999996 often enough that an
   equality check against the pot ("is this plan fully placed?") would fail on
   a plan that is exactly placed — and the reader would see a stray 0.00 card
   telling them nothing is left to place while insisting something is. */
/* The `+ 0` is not decoration: Math.round(-0.004 * 100) / 100 is NEGATIVE
   zero, which is === 0 and prints as "-0.00" through a formatter that looks at
   the sign bit. Every figure here can arrive at a hair below zero by
   subtraction — `overspend` and `placeable` most of all, since both are a
   difference of two sums that are equal on any settled plan — and a plan that
   balanced to the cent reporting "-R 0,00 overspent" would read as a defect.
   Adding zero collapses -0 to 0 and leaves every other value untouched. */
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100 + 0;

/* A source counts as money you can spend today when it has actually landed.
   The stored status wins over the date: the date says when it was EXPECTED, and
   money arrives early and late. The status is what someone confirmed. */
const isReceived = s => (s.status || 'received') !== 'expected';

/* WHAT THE BUCKETS CLAIM ON THE POT, taken one bucket at a time — the sum the
   per-bucket figures below are all derived from, and the fix for the figures
   audit of 7 Oct 2026.

   A bucket claims the larger of what it holds and what has gone from it.
   Holding R 3 000 with R 1 000 spent, it still claims R 3 000: the other
   R 2 000 is spoken for. Holding R 3 000 with R 4 500 spent, it claims
   R 4 500: that money has gone whatever the bucket said. Money spent from no
   bucket at all — an item whose bucket was renamed or deleted by hand in the
   file — is claimed by nobody, but it has gone too, so it counts in full.

   The plan-wide sums could not see this. Pot 10 000, buckets A, B and C of
   3 000 each, A spent 4 500 and B 1 000: plan-wide that is 5 500 gone against
   9 000 placed, nothing apparently past the buckets, and the page offered
   "Left to place R 1 000,00" with a button to put it in a new bucket. Per
   bucket the claims are 4 500 + 3 000 + 3 000 = 10 500, and the true figure is
   −500: A's overrun ate the unplaced 1 000 and 500 of what B and C still hold.

   An item belongs to the bucket whose name its `envelope` field names — the
   same rule the page uses to list a bucket's items, so the figures and the
   cards can never disagree about which money is whose. Two rows with one name
   are one bucket, as they are on screen. A plan whose buckets and items carry
   no names at all (some tests build them that way) is therefore ONE bucket
   holding every item, and on such a plan every figure here is exactly what
   the plan-wide sums always gave. */
function bucketClaims(envelopes, items) {
  const buckets = new Map();
  for (const e of envelopes) {
    const key = String(e.name ?? '');
    const b = buckets.get(key) || { amount: 0, spent: 0 };
    b.amount += Number(e.amount) || 0;
    buckets.set(key, b);
  }
  let claimed = 0;
  for (const i of items) {
    const b = buckets.get(String(i.envelope ?? ''));
    if (b) b.spent += Number(i.spent) || 0;
    else claimed += Number(i.spent) || 0;          // spent from no bucket: gone, and nobody's
  }
  for (const b of buckets.values()) claimed += Math.max(b.amount, b.spent);
  return claimed;
}

function planSummary(plan) {
  const sources = plan.sources || [];
  const envelopes = plan.envelopes || [];
  const items = plan.items || [];

  const pot = round2(sum(sources, s => s.amount));
  const received = round2(sum(sources.filter(isReceived), s => s.amount));
  const allocated = round2(sum(envelopes, e => e.amount));
  const spent = round2(sum(items, i => i.spent));
  /* Never below allocated or spent — each bucket claims at least what it holds
     and at least what has gone from it — so the three differences below cannot
     go negative. Exported on the summary because barSegments draws from it. */
  const claimed = round2(bucketClaims(envelopes, items));

  return {
    pot,
    received,
    expected: round2(pot - received),
    allocated,
    spent,
    claimed,
    /* Placed and not yet gone, BUCKET BY BUCKET: Σ max(0, holds − spent). It
       used to be max(0, allocated − spent) across the whole plan, which is the
       same figure until one bucket runs over — and then the clamp swallowed
       the money every OTHER bucket still holds: in the example above it read
       R 3 500 while B and C still hold R 5 000 between them, and once the
       overrun passes what is placed it read R 0,00 over buckets nobody had
       touched. Never negative, so the bar's middle segment can never grow
       leftwards. */
    committed: round2(claimed - spent),
    free: round2(pot - allocated),
    /* What is still left to spend, full stop — pot minus what has actually
       gone. Answers the question the split key never used to: "how much do I
       still have?" Deliberately NOT committed + free: that sum only agrees
       with pot − spent while nothing is clamped (committed clamps at zero once
       an envelope is overspent), and this repo's recurring bug shape is two
       figures for the same thing derived by two different rules. `left` is
       derived here, once, from the same two sums as everything else on this
       page, so the view only ever prints it. */
    left: round2(pot - spent),
    /* WHAT WENT PAST ITS BUCKET. Zero on every healthy plan, and the figure
       the page had no way to name before: `committed` clamps this to nothing
       and `free` never sees it at all, so an overspend of R 5 377 against
       R 28 282 placed showed up only as "Spoken for R 0,00" — a row that reads
       as "nothing is earmarked" rather than as "you are over".

       Per bucket since 7 Oct 2026: Σ max(0, spent − holds), plus whatever was
       spent from no bucket. It used to be max(0, spent − allocated) over the
       whole plan, which nets one bucket's overrun against money other buckets
       have not spent yet — in the example above, A's R 1 500 overrun against
       the R 5 000 B and C still hold, which read as nothing over at all.
       Always free − placeable, which is the relationship the page states in
       words. */
    overspend: round2(claimed - allocated),
    /* WHAT CAN STILL BE PLACED, which is NOT `free` the moment anything is
       overspent — and the bug this pair was added to close.

       Placing a rand in a bucket needs it to be two things at once: not
       already in another bucket (that is `free`) AND not already gone (that is
       `left`). `free` alone was what the hero offered and what the envelope
       slider's ceiling was built from, and `free` is blind to `spent`: money
       that leaves an OVERSPENT bucket leaves the pot without reducing it. A
       live vault on 13 Sep 2026 was therefore invited to place R 19 918 of a
       pot whose buckets had already run past it.

       Both conditions are about each BUCKET, not about two plan-wide totals,
       which is the 7 Oct 2026 correction: this was pot − max(allocated, spent)
       — min(free, left) — and that is the answer only while no bucket has run
       past what it holds, or the whole plan is one bucket. In the audit's
       example it offered R 1 000 when every rand left was already claimed by
       B and C. So it is the pot less what the
       buckets claim: never more than free or left, and exactly free on a plan
       where no bucket has run over. Derived HERE, once, rather than at the
       call sites, because two figures for the same thing derived by two
       different rules is the failure this module exists to prevent. Left
       unclamped: negative means the buckets claim more than the plan has,
       which the hero says in words, and clamping it here would hide that from
       the one place that can. */
    placeable: round2(pot - claimed),
    sources: sources.length,
    envelopes: envelopes.length,
    items: items.length,
  };
}

/* THE BAR'S WIDTHS, which are NOT the summary's figures, and the difference is
   the point of this function.

   planSummary tells the truth: `free` goes negative when the envelopes claim
   more than the pot holds, and `committed` clamps at zero when more has been
   spent than was ever placed. Both are correct, and neither can be drawn — a
   negative width is not a thing, and three segments that sum to 118% of the pot
   render as a bar with its last segment silently clipped off, which reads as a
   rendering bug rather than as overspend.

   So the bar gets its own clamped view, with one modelling decision behind it:
   money that HAS GONE is committed by definition, whatever the envelope beside
   it says. That is what makes the three segments sum to the pot exactly, in
   every case including the broken ones. The loud card below the bar is what
   states the overspend in words; the bar's job is only to show the shape.

   The identity `spent + committed + free === pot` is guaranteed here and pinned
   by tests/plan.test.cjs against randomised plans.

   The bar is drawn from `claimed` (planSummary, per bucket) where the summary
   carries it, so its middle segment is the money still spoken for bucket by
   bucket and its last segment is exactly `placeable` whenever that is not
   negative — the bar and the hero's big figure cannot disagree about room
   left. A summary built by hand without it falls back to max(allocated, spent),
   which is what `claimed` equals on a one-bucket plan. */
function barSegments(summary) {
  const { pot, spent, allocated } = summary;
  if (pot <= 0) return { spent: 0, committed: 0, free: 0 };
  const claimed = Number.isFinite(summary.claimed) ? summary.claimed : Math.max(allocated, spent);
  const effAllocated = Math.min(pot, Math.max(claimed, spent));
  const shown = Math.min(spent, pot);
  return {
    spent: round2(shown),
    committed: round2(effAllocated - shown),
    free: round2(pot - effAllocated),
  };
}

/* What an envelope holds minus what its items claim. Positive means money in
   the envelope nobody has named a use for yet; negative means the list already
   wants more than was placed. Zero — the common case once a plan settles — is
   rendered as nothing at all rather than as "R 0.00 unassigned". */
function envelopeGap(envelope, items) {
  return round2((Number(envelope.amount) || 0) - sum(items, i => i.amount));
}

/* ONE BUCKET'S BAR, as three widths that always sum to exactly 100.

   The same discipline as barSegments above, one level down, and for the same
   reason: the collapsed row states its remainder in words ("R 4 001,00 left",
   "R 600,00 over") and the bar beside it is the shape of that sentence. A width
   that went negative, or three that summed past 100, would render as a segment
   clipped off the end — which reads as a rendering fault rather than as
   overspend, exactly the failure barSegments was written to stop.

   THE DENOMINATOR IS max(amount, spent), NOT amount. A bucket holding R 1 000
   with R 1 600 gone has no meaningful "160% of the bar"; scaling to the larger
   of the two means the green stops where the bucket stopped and the red runs
   from there to where the money actually stopped. Each bar is about its OWN
   bucket, so bars are not comparable across rows — the % badge already on the
   row is what carries share-of-plan.

     spent  money gone, capped at what the bucket holds   (primary)
     left   placed and not yet gone                       (accent)
     over   gone beyond what the bucket holds             (danger)

   `left` is derived as the remainder rather than computed independently, so
   the three cannot sum to 99.99 on a bucket whose thirds do not divide. */
function envelopeBar(amount, spent) {
  const a = Math.max(0, Number(amount) || 0);
  const s = Math.max(0, Number(spent) || 0);
  const span = Math.max(a, s);
  if (span <= 0) return { spent: 0, left: 0, over: 0 };
  const spentPct = round2((Math.min(s, a) / span) * 100);
  const overPct = round2((Math.max(0, s - a) / span) * 100);
  return { spent: spentPct, left: round2(100 - spentPct - overPct), over: overPct };
}

/* One figure's share of the pot, as a whole number. Guards the empty plan: a
   pot of zero would otherwise make every envelope NaN%.

   For a figure that stands ALONE — the loud card's overspend as a share of
   the plan. NOT for the envelope badges: a column of shares of one pot,
   each rounded on its own, does not add up to the pot (see envelopeShares). */
function sharePct(value, pot) {
  if (!pot) return 0;
  return Math.round((value / pot) * 100);
}

/* EVERY ENVELOPE'S SHARE OF THE POT, plus the share left unplaced, as whole
   percents that sum to exactly 100 — one partition of one pot.

   The badges were sharePct per envelope, and Math.round per slice does not
   preserve a total: the 2026-10-07 figures audit found the six badges of a
   fully placed real plan summing to 101%, and 50 / 25 / 12.5 / 12.5 prints
   50 + 25 + 13 + 13. On the page whose thesis is "every rand lands somewhere"
   the column of shares was the one thing that visibly did not.

   Largest remainder (src/share-percents.js, the Dashboard donut's own rule)
   over the envelope amounts AND the unplaced remainder, so the badges and the
   loud card's "% of the plan" are slices of the same 100. Over-placed plans
   keep their true shares: the remainder slot goes negative by exactly the
   excess (700 + 700 of a 1 000 pot is 70 + 70 − 40). Each share stays within
   one point of its exact value.

   Pure, and called with a LIVE amount by the slider's drag handler as well as
   by the render — the same reason envelopeOverState is shared: a badge that
   read 45% mid-drag and 44% after release would be two rules for one figure. */
function envelopeShares(amounts, pot) {
  const vals = (amounts || []).map(a => Number(a) || 0);
  if (!(pot > 0)) return { shares: vals.map(() => 0), unplaced: 0 };
  const placed = vals.reduce((t, v) => t + v, 0);
  const all = sharePercents([...vals, pot - placed]);
  return { shares: all.slice(0, -1), unplaced: all[all.length - 1] };
}

/* TWO DISTINCT OVERSPEND SIGNALS for one envelope, not one — and the reason
   this is pure and exported rather than inlined in the view: the slider drags
   `amount` live, one input event at a time, well before `change` commits it
   and a full renderPlan() would recompute this from the plan. Both the initial
   card render and the drag handler call this SAME function with the live
   amount, so the two paths can never say different things about the same
   number — the failure shape this repo keeps repeating.

     overspent:     actual money gone (spent) exceeds what the bucket holds.
                     Already happened — the one a reader needs to see first.
     overcommitted: the item LIST claims more than the bucket holds
                     (envelopeGap < 0), whether or not any of it has been
                     spent yet — a promise, not yet a fact.

   Neither is `sum.free < 0` (the plan-wide card below the pot bar), which is
   about the pot, not this one bucket. */
function envelopeOverState(amount, items, spent) {
  const gap = envelopeGap({ amount }, items);
  const overAmt = round2(spent - amount);
  return { overAmt, isOverspent: overAmt > 0.005, gap, isOvercommitted: gap < -0.005 };
}

module.exports = { planSummary, barSegments, envelopeGap, envelopeBar, sharePct, envelopeShares, round2,
  isReceived, envelopeOverState, SOURCE_KINDS };
