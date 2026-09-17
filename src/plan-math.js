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
   committed = allocated − spent. That identity is what makes the three
   segments meaningful side by side; planSummary is the only place it is
   computed, so it is the only place it can break.

   A fifth figure, `left` = pot − spent, answers a question the four above
   never do on their own: "how much do I still have?" It agrees with
   committed + free only while nothing is clamped — see the note on `left`
   below for why it is derived independently rather than added from those
   two.

   A sixth and seventh, `overspend` and `placeable`, were added on 1.45.0 after
   a live vault showed that `free` is the WRONG answer to "what can I still
   place?" once a bucket has been overspent — see their notes below. The short
   version: free is blind to spent, so an overspent plan overstates by exactly
   the overspend, and nothing on the page said so. */

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

function planSummary(plan) {
  const sources = plan.sources || [];
  const envelopes = plan.envelopes || [];
  const items = plan.items || [];

  const pot = round2(sum(sources, s => s.amount));
  const received = round2(sum(sources.filter(isReceived), s => s.amount));
  const allocated = round2(sum(envelopes, e => e.amount));
  const spent = round2(sum(items, i => i.spent));

  return {
    pot,
    received,
    expected: round2(pot - received),
    allocated,
    spent,
    /* Allocated but not yet gone. Clamped at zero because spending MORE than an
       envelope holds is legal and recorded honestly (the item's spent exceeds
       its planned amount) — but a negative "spoken for" segment would render as
       a bar growing leftwards, which reads as a bug rather than as overspend.
       The overspend is still visible: it pushes `free` down. */
    committed: round2(Math.max(0, allocated - spent)),
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
    /* WHAT WENT PAST THE BUCKETS. Zero on every healthy plan, and the figure
       the page had no way to name before: `committed` clamps this to nothing
       and `free` never sees it at all, so an overspend of R 5 377 against
       R 28 282 placed showed up only as "Spoken for R 0,00" — a row that reads
       as "nothing is earmarked" rather than as "you are over". */
    overspend: round2(Math.max(0, spent - allocated)),
    /* WHAT CAN STILL BE PLACED, which is NOT `free` the moment anything is
       overspent — and the bug this pair was added to close.

       Placing a rand in a bucket needs it to be two things at once: not
       already in another bucket (that is `free`) AND not already gone (that is
       `left`). `free` alone was what the hero offered and what the envelope
       slider's ceiling was built from, and `free` is blind to `spent`: money
       that leaves an OVERSPENT bucket leaves the pot without reducing it. A
       live vault on 13 Sep 2026 was therefore invited to place R 19 918 when
       R 14 541 remained, the R 5 377 difference being exactly the overspend.

       So it is min(free, left) — derived HERE, once, rather than min()'d at
       the two call sites, because two figures for the same thing derived by
       two different rules is the failure this module exists to prevent. Left
       unclamped: negative means the plan is past its own pot, which the hero
       says in words, and clamping it here would hide that from the one place
       that can. */
    placeable: round2(pot - Math.max(allocated, spent)),
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
   by tests/plan.test.cjs against randomised plans. */
function barSegments(summary) {
  const { pot, spent, allocated } = summary;
  if (pot <= 0) return { spent: 0, committed: 0, free: 0 };
  const effAllocated = Math.min(pot, Math.max(allocated, spent));
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

/* Share of the pot, as a whole number for the badge on each envelope. Guards
   the empty plan: a pot of zero would otherwise make every envelope NaN%. */
function sharePct(value, pot) {
  if (!pot) return 0;
  return Math.round((value / pot) * 100);
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

module.exports = { planSummary, barSegments, envelopeGap, envelopeBar, sharePct, round2,
  isReceived, envelopeOverState, SOURCE_KINDS };
