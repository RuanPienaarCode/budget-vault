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
sums under — and, since 2026-10-07, whether its net reading counts the
uncategorised bucket as spending (see the amendment of that date). Three lenses
cover every walk that exists on 1.38.0.

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
category, then flipped; the blank category is one more category here (amendment,
2026-10-07). This is `healthSnapshot`'s household walk today, and it feeds the
Score's essential, consumption and fixed pillars (the saving rate left this lens
on 29 Sep 2026 — see that amendment).

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

- **TREND did not drop `earmarkedOut`.** ISSUE 41 taught `summaryInRange`
  that an outflow from an earmarked fund is not budget spend; `periodSpend`
  was never taught. So the trend chart, the comparison column and the money
  rail's category map counted fund-paid spending the hero excluded. Preserved
  through Phases 2 and 3 so no figure moved on a refactor; **closed by Ruan
  on 2026-09-03**: the veto is in the TREND row, BUDGET and TREND now keep the
  same rows and differ only by sign rule, and the lens suite pins that. The
  committed fixture's fund has no outflow in its period, so the figures
  ledger did not move.
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

The one decision Phase 3 left open — the TREND lens's missing `earmarkedOut`
— was taken the same day (see the Phase 2 findings above).

## Phase 4, landed (2026-09-03)

The narratives moved. `docs/adr/0007-calculation-rules-register.md` holds
208 entries, one per rule the ten calculation and loading modules used to
carry as comments, each with its decision, the evidence the comment kept
(issue numbers, measured figures, dates, releases) and the suite that pins
it. The modules keep pointers of at most three lines. The gate was
mechanical: the comment-stripped source of every module is byte-identical
to the commit before, so nothing but comments moved. Line counts fell from
5 896 to 3 313 across the ten files, and comment share from 57–78% to
37–57%. `tests/narratives-live-in-adrs.test.cjs` keeps it so: no comment
block over twelve lines, every pointer naming a register entry, every entry
naming a function that still exists.

## Amendment, 29 Sep 2026: moved to funds and the saving rate

Decided by Ruan on 29 Sep 2026 after a walk through the August figures, in his
words: "we don't save 30%... it should be from our normal income we put aside
to save, not lump sums because it messes the number."

Two figures had been derived by different rules, and the lenses above are why
the disagreement could be named. The health card's saving rate divided
everything that crossed into a fund from outside it (the numerator,
`savedFromOutside`) by the HOUSEHOLD lens's income, which keeps rows the
household marked Excluded. In one month a large UIF-style payout sat in both: it was
Excluded on the way in and moved on into a fund, so it counted in full as
"saving" over an income base that also held it. The card read about three
times the regular rate; the regular transfers into funds were a fraction of that. The Dashboard's "R X moved
so far" counted the same payout.

**The rule now, one seam, both sides of the ratio in the same scope:**

- **Moved to funds** (`ctx.transfersIntoFunds`, read by `movedToFunds` and by
  `savingContribution`) counts an inflow into a savings or investment account
  only when it pairs with an equal outflow from another of the household's own
  non-fund accounts, by the pairing the fund-to-fund cancel already used
  (`couldBeAnInternalLeg`, `couldBeSameMovement`, the nearest date winning), and
  when neither leg is marked Excluded. Outside money landing in a fund, interest,
  and fund-to-fund shuffles are not moved.
- **Saving rate** = moved to funds, averaged over the completed periods, divided
  by the same periods' **budget** income (`periodSummary(p).income`, the figure
  the Dashboard and the Budget page print; the BUDGET lens). HOUSEHOLD stays the
  lens for what the household spent, where an Excluded bill from a joint account
  is still a bill; it is no longer the lens for the income that spending and
  saving are measured against.

**Why the transfer test alone was not enough.** Ruan believed the UIF payment
went straight into the fund. On the vault it landed in the cheque account
(Excluded) and was transferred on (Excluded, both legs), so it IS a transfer
from an own account and the pairing rule leaves it in. What removes it is the
household's own Excluded veto, read in the same place. That also settles the
earlier reversal recorded in ADR-0007 ("Nothing is skipped on the strength of a
row's own flags"): a rule that skipped income-typed Excluded rows from the
numerator alone was reverted because interest left the numerator while income
went on counting it. Here the denominator drops Excluded rows too, and `excluded`
is read as what the household stated it to be, a veto, not inferred intent.

**Consequences, stated rather than hidden.**

- The debt interest share, the instalment share and the net-worth multiple
  divide by budget income too (`avg.income`). The two SPENDING shares do not:
  fixed bills and living costs, and the "under 70% of your income" trim built
  from them, divide by household income (`avg.householdIncome`, the HOUSEHOLD
  lens's net income, Excluded rows and accounts outside the budget kept),
  because their numerators are HOUSEHOLD-lens spend with the same rows kept.
  Over budget income they read living costs above 100% of income on the real
  vault and zeroed that part of the score. Shipped in the same release;
  `tests/lane-int-health-scopes.test.cjs` pins each ratio's base. (This bullet
  said until 2026-10-07 that every ratio divides by budget income, which was the
  first draft of the change, not what shipped.)
- On 2026-10-07 the question that left open — should the spending shares
  divide by the saving rate's income? — was settled on the audit's default:
  keep household income, and NAME it. The Score says "of household income"
  beside both shares and in the trim, and states what household income averages
  and that it counts money kept out of the budget, so a reader holding the
  Dashboard's income can see why the percentages do not divide by it. On the
  audited vault the household base was about a fifth larger, and the page had
  called both "income". `tests/score-household-income-named.test.cjs`.
- The Score's saving line used to say one-off windfalls count. They no longer do.
- The Savings page growth chart is unchanged: it answers "what went into the
  fund", and a lump sum did. `splitFlows` and `monthlyFlows` keep their
  inception-date windowing.
- Fixtures: the committed ledgers do not move (their households hold no
  windfall); `tests/lane-r-moved-to-funds.test.cjs` and
  `tests/lane-r-saving-rate.test.cjs` pin the rule on a synthetic household.

## Amendment, 7 Oct 2026: the HOUSEHOLD reading counts uncategorised money, and pairs rows

Two corrections from the 7 Oct 2026 audit, both in the lens the Score reads.
The instruction for the audit's questions was "go with the defaults".

**Uncategorised money is spending under HOUSEHOLD.** `essentialTotal` has always
counted an unknown or blank type as essential — "an uncategorised debit is far
more likely a bill than a treat", so the cover figure errs toward fewer months,
never more — but no blank row ever reached it: the tally's net reading skipped
the blank bucket for every lens. On the audited vault every uncategorised
household outgoing in six trailing periods was dropped, so the Score read more
months of cover than the documented rule gives. The lens now
carries a third datum, `uncategorised: 'spend'`, and only HOUSEHOLD sets it: the
blank category is one more bucket of its net reading, netted like any named one
(an uncategorised refund lowers it), landing in `spendByCat` under the empty
name, whose type is null, so it is essential spend and consumption. HOUSEHOLD
keeps Excluded rows, so an uncategorised purchase paid from a sinking fund and
marked Excluded counts too — the audit's default. A pass-through
pair is dropped before the bucket is formed. BUDGET, TREND, ACCOUNT and MERCHANT
are unchanged: their category maps name categories, and uncategorised money is
disclosed beside them (`uncatSpend`, `uncatIncome`).
`tests/household-essential-counts-uncategorised.test.cjs`.

**A pass-through pair drops two rows, not two keys.** `passthroughPairs` found
the pairs correctly but handed back `label|date|amount|description` keys, and
`stamp()` dropped every row whose key was paired. Two identical Excluded rows on
one account — two R 500 gifts on one day, written the same way — share a key, so
pairing one of them dropped both and real spending left the Score. It returns
the paired rows now, and `stamp()` marks by identity. No real vault the audit
read holds such a collision; the rule was wrong regardless.
`tests/passthrough-pairs-by-row.test.cjs`.

**What moved.** Essential spend, living costs and everything built from them —
the cover months, the reserves gap, the living-costs share and the trim, on the
Score, on the Dashboard's health card (the same snapshot) and in the Report's
health section — rise by the uncategorised outgoings a household has. The
committed fixture households' moves are listed, figure by figure, in the change
that re-blesses the numbers ledger.

## What this does not change

Every product decision the comments record stands: gross versus net, the
as-of-today boundary, the three-calendar-month income window, the settlement
cycle, earmarks coming out of "free" only, pass-through pairing. The refactor
moves where those decisions are expressed, not what they are. ADR-0001 to
ADR-0004 are untouched.
