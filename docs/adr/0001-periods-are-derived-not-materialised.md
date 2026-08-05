# Periods are derived, never materialised

Status: accepted

Supporting pay cycles other than monthly means periods can no longer be named
`YYYY-MM`. We considered materialising them into a `Periods.md` ledger the
plugin appends to, so that a genuine pay-cycle change would preserve historic
periods exactly as they were. We rejected that and kept periods **derived** — an
interval plus an anchor date in `Settings.md`, computed on demand, with an
interval-based period addressed by its start date (`2026-08-07`) while monthly
periods keep `YYYY-MM` unchanged.

## Why

A `Periods.md` would be a plugin-authored file whose real source of truth is a
setting — precisely what `src/views/debts.js` already refuses to do when it
keeps the debt planner's inputs in the DOM rather than persisting a number to
`Debts.md` that no file owns. It would also be another file syncing through
iCloud between phone and desktop, on the platform where merge conflicts hurt
most, to guard against an event most households never experience.

## Consequences

Deriving periods means the anchor decides the boundaries of *all* history, not
just of periods created after it was set. That is survivable because:

- The anchor is meaningful only modulo the interval, so it is **stored
  normalised**. Editing it by a whole number of intervals is a genuine no-op and
  is accepted silently.
- Only a shift that is *not* a whole number of intervals re-slices anything, and
  the blast radius is budget targets alone. Transactions are stored by calendar
  month and matched by date range, so they are never orphaned — only re-bucketed
  into a different period.
- Orphaned budget files are never deleted. Reverting the anchor restores them.

So the anchor warns on a real boundary shift and stays quiet otherwise, rather
than carrying a permanent scary label it would earn on only a minority of edits.

Switching a vault between monthly and interval periods is subject to the same
rule: the old files remain on disk, unreachable while the other type is active,
and reappear on switching back.
