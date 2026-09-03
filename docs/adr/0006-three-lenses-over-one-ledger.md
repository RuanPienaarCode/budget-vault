# Three lenses over one ledger

Status: accepted as direction (2026-09-03); the code follows in phases

## Why an ADR before the code

The 2026-09-03 calculation audit found that the arithmetic in this plugin is
trivial and the complexity is upstream of it: five hand-written loops over the
same transaction rows each decide for themselves which rows count, with five
different sets of vetoes. The differences are then managed by prose comments
(62–73% of the calculation modules by line) and by identity tests that pin the
size of the disagreement rather than remove it. Each audit since 1.34.0 has
found the next loop that missed the last veto.

This ADR records the target shape so that the phases can be reviewed against
it, and so that the reasoning now scattered across those comments has one home.

## The vocabulary

A transaction row can be held out of a total for nine reasons. Each has a
name here, and each will be stamped on the row exactly once by the ledger:

| Stamp | Set by | Meaning |
|---|---|---|
| `excluded` | the row's own Excluded cell | the user's per-row veto |
| `nonBudget` | the account's `budget: false` | the user's per-account veto |
| `foreign` | the account's `currency:` differing from the household's | not household money; never summed into a rand figure |
| `earmarkedOut` | an outflow from an account whose type is savings/investment | money leaving a fund, not spending from the budget |
| `transfer` | the category's type | money moving between the reader's own pockets |
| `splitParent` | the split marker, `parent` | a row superseded by its parts; excluded by construction |
| `splitPart` | the split marker, `part` | one of the parts that carry a split row's money |
| `passthrough` | a matching opposite leg in another account in the same window | the second leg of money already counted once |
| `setAside` | an outflow under a savings/investment-typed category | money the household kept, not consumed |

Two more stamps carry a row's classification rather than a veto: `catType`
(the category file's live type) and `fixed` (the category's flag).

## The lenses

A lens is data, not a loop: the list of stamps it drops, and the sign rule it
sums under. Three lenses cover every walk that exists on 1.38.0.

**BUDGET** — "how did I do against my plan". Drops `excluded`, `nonBudget`,
`foreign`, `earmarkedOut`, `transfer`. Gross sign rule: an outflow is spend in
full; a refund inside a category is a separate positive row, not netted. This
is `summaryInRange` today, and it feeds the Dashboard hero, the Budget page,
the Report and the deficit carry. `periodSpend` is the same lens under a net
sign rule and is what the trend chart and comparison column draw from; the two
sign rules are the one documented difference between them.

**HOUSEHOLD** — "what actually moved through this household". Drops `foreign`,
`transfer`, `passthrough` and `splitParent`; keeps `excluded` and `nonBudget`
rows because a bill paid from a joint account the household marked out of the
budget is still a bill the emergency fund must cover. Net sign rule per
category, then flipped. This is `healthSnapshot`'s household walk today, and it
feeds the Score's essential, consumption, fixed and saving-rate pillars.

**ACCOUNT** — "what did this one account do". Drops only `splitPart`. Every
row moves the balance, whatever the budget thinks of it. This is `splitFlows`
and `periodActivity` today, and it feeds the Savings cards, the growth chart,
reconciliation and the Accounts page's flow chips.

Anything not in this table is a walk to be folded into one of the three or
named as a fourth lens with its own row here. The export's "money in / money
out" totals use BUDGET. The what's-left chain in `committed.js` is not a lens
over rows; it is a projection over commitments and stays as it is.

## The shape the phases build toward

    ledger(range)          → rows, each stamped once
    tally(rows, LENS)      → { income, spend, net, byCat, setAside, uncategorised,
                               unknown, foreign, scheduled, consumption, essential, fixed }
    periodFigures(p)       → the snapshot the Dashboard, Budget and Report read
    bookFigures()          → the snapshot Accounts, Savings, Debts and Assets read

Views render a snapshot; they do not walk rows. `score.js` over
`healthSnapshot` and `plan.js` over `planSummary` already have this shape and
are the two cleanest views in the codebase.

## Phases and gates

0. Freeze the numbers ledger on 1.38.0. Decide "budget used" (ADR-0005). Write
   this ADR. Delete the dead `assumedSpend` seam.
1. One owner for each vocabulary set (set-aside, pool, essential), one
   `isPoolAccount()`, one `budgetRowType()` used everywhere; a grep gate
   forbids the literals elsewhere.
2. Build `ledger()` and `tally()`. Re-implement `summaryInRange`,
   `periodSpend`, the household walk and the export totals as
   `tally(rows, LENS)` **behind the existing function names**, so every
   existing suite keeps exercising the new code through the old seams.
3. `periodFigures(p)` and `bookFigures()`; views read them only; the local
   walks in views are deleted.
4. Narratives migrate from comments to ADRs; code keeps one-line pointers.

The gate at every phase is the same: all guard suites green and
`tests/figures/ledger.txt` byte-identical, except for moves named in the
commit with the figure, the old value, the new value and the lens decision
that moved it.

## Phase 2, landed (2026-09-03)

`src/ledger.js` holds `stamp()`, `tally()`, `LENSES` and `lensDifference()`.
`summaryInRange`, `periodSpend` and the household walk in `healthSnapshot`
are tallies under BUDGET, TREND and HOUSEHOLD behind their old names; the
export's totals are a BUDGET tally over the env its page hands it.
`tests/ledger-lenses.test.cjs` proves conservation under every lens against
an independent oracle on randomised vaults, and that the gap between any two
lenses is exactly the rows `lensDifference()` names. The figures ledger is
byte-identical.

Making the lenses data made two things visible that five loops had hidden:

- **TREND does not drop `earmarkedOut`.** ISSUE 41 taught `summaryInRange`
  that an outflow from an earmarked fund is not budget spend; `periodSpend`
  was never taught. So the trend chart, the comparison column and the money
  rail's category map count fund-paid spending the hero excludes. Preserved
  in this phase so no figure moves; it is one word in the TREND row, and
  whether to add it is a Phase 3 decision, with the ledger re-blessed if it
  is.
- **HOUSEHOLD counted a split parent and its parts.** A split's parent row is
  excluded by construction; the household lens keeps excluded rows; the
  pairing that drops pass-throughs never sees a parent (same label as its
  parts). One R900 purchase split 600/300 read R1 800 in the Score's
  consumption and essential spend. Corrected in this phase by adding
  `splitParent` to the HOUSEHOLD row — a double count, not a product
  reading — and pinned in the lens suite. The committed fixture holds no
  split, so the ledger did not move; a vault that splits transactions will
  see its Score pillars change by exactly the parents it had been counting.

## Phase 3, landed (2026-09-03)

`src/figures.js` is the snapshot layer. `periodFigures(p)` hands a period
page its summary, budget, budget-used reading, trend map, budget-vs-actual
rows (each carrying its status), category split and the split's gap;
`bookFigures()` reconciles every account once and hands the cards the
figures they used to derive from three separate passes. Two pure rules moved
to money-flow.js so the serialiser reads them too: `budgetRowStatus` (the
"remaining", "unbudgeted", over, near and bar rules — the serialiser's
`unbudgeted` had already drifted from the Dashboard's and now cannot) and
`categoryGap` (the donut's decomposition, once instead of twice).

Smaller owners in the same phase: `debtMonthly` in committed.js (the Debt
page, the Report and the what's-left chain each spelled it), `growthRate` in
savings-math.js (the Savings page and the serialiser each divided it), and
`primaryTotal` replacing the Accounts page's longhand `roundedSum`. The
ACCOUNT lens is now real: the Accounts page's flow chips and sparkline read
two tallies under it, and the Debt page's paid-vs-planned reads the BUDGET
tally's gross outgoings by category instead of a walk with three of the five
vetoes. `tests/period-figures.test.cjs` pins the rules, the snapshot and the
pages' rendering of it, and gates the old arithmetic out of `src/views/`.

Still open, deliberately: the TREND lens's missing `earmarkedOut` (above).
It is one word, and it moves the trend chart, the comparison column and the
money rail on any vault with an earmarked fund; it waits for a decision and
a re-bless rather than riding in on a refactor.

## What this does not change

Every product decision the comments record stands: gross versus net, the
as-of-today boundary, the three-calendar-month income window, the settlement
cycle, earmarks coming out of "free" only, pass-through pairing. The refactor
moves where those decisions are expressed, not what they are. ADR-0001 to
ADR-0004 are untouched.
