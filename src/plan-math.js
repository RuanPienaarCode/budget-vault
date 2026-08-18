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
   computed, so it is the only place it can break. */

/* The presets offered when adding a source. Deliberately NOT an enum the rest
   of the code branches on — a source's kind is a label for grouping and colour
   and nothing else, and a file may carry any word at all here (someone will
   type "Inheritance"). Anything the loader reads is kept verbatim; this list
   only seeds the dropdown. */
const SOURCE_KINDS = ['Salary', 'UIF', 'Tax', 'Bonus', 'Gift', 'Sale', 'Once-off', 'Other'];

const ITEM_STATUSES = ['planned', 'part', 'done'];

const sum = (rows, pick) => rows.reduce((t, r) => t + (Number(pick(r)) || 0), 0);

/* round2 everywhere a total leaves this module. Floating-point addition over a
   dozen two-decimal amounts lands on 41249.999999999996 often enough that an
   equality check against the pot ("is this plan fully placed?") would fail on
   a plan that is exactly placed — and the reader would see a stray 0.00 card
   telling them nothing is left to place while insisting something is. */
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

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

/* Share of the pot, as a whole number for the badge on each envelope. Guards
   the empty plan: a pot of zero would otherwise make every envelope NaN%. */
function sharePct(value, pot) {
  if (!pot) return 0;
  return Math.round((value / pot) * 100);
}

module.exports = { planSummary, barSegments, envelopeGap, sharePct, round2, isReceived,
  SOURCE_KINDS, ITEM_STATUSES };
