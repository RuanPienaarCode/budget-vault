# "Budget used" is one figure, derived by one rule

Status: accepted (2026-09-03)

## The problem

On 1.38.0 the phrase "budget used" was computed four ways on three pages, and
the four could disagree about one household in one month:

| Surface | Numerator | Denominator |
|---|---|---|
| Dashboard hero | `periodSummary().spend − periodSummary().setAside` | `budgetTotals().spend` |
| Score flow chip (`money-flow.js`) | `spend − (savings-typed entries found in periodSpend()'s net map)` | `budgetTotals().spend` |
| Score ring (`health-data.js` → `health-math.js`) | sum of `periodSpend()`'s net map, savings/investment types dropped, averaged | `budgetTotals().spend`, averaged over planned periods |
| Budget page totals strip | `periodSummary().spend + assumed spend` (set-aside **included**) | envelopes with set-aside **excluded** |

The chip's answer depended on an account flag with nothing to do with the
question: a contribution into a savings account that is inside the budget has
both legs in the category map, nets to zero there, and so was never subtracted.
Flag the same account `budget: false` and the chip moved from 51% to 38% on the
same rows. The ring differed from the hero by refunds netted and uncategorised
spend dropped, even with a single counted period, while the caption under the
chip blamed the six-period window. The Budget page's tile put set-aside in the
numerator and took it out of the denominator.

Each rule had a comment defending it. None of the comments could see the other
three. This is the "two figures derived by different rules" shape the codebase
has fixed nine times by commit message; this ADR fixes the shape rather than
the occurrence.

## The decision

There is one rule, and it is the Dashboard hero's, carrying the Budget page's
assume-spent provision with it:

    used = (spend − setAside + assumed) / budgeted

where `spend` and `setAside` are `periodSummary(p)`'s gross outgoings and the
part of them under a savings- or investment-typed category, `assumed` is the
assume-spent provision (for each `assume_spent` category, its budgeted amount
less whatever really moved, floored at zero), and `budgeted` is
`budgetTotals(p).spend`, the envelopes that are not set-aside. Money moved into
the household's own funds is not spending, so it leaves the numerator; the
envelopes for that money are not budget to spend, so they are not in the
denominator; money a carried overspend or a cash envelope has already
consumed is spending whether or not a statement line shows it, so it joins.
What remains is what the household consumed against what it planned to
consume.

The rule lives in one place, `budgetUsedShare()` in `src/money-flow.js` (with
`budgetSpent()` for the numerator on its own and `assumedProvision()` for the
provision), and the one period-level reading of it is `budgetUsed(p, opts)` in
`src/period.js`, which returns `{ spent, budgeted, assumed, setAside, used }`.
`opts.rows` lets the Budget page measure its unsaved draft; `opts.today` drives
the as-of boundary. Every surface reads one of those two:

- the Dashboard hero and the Budget page's totals strip call `budgetUsed(p)`;
- `periodFlow()` takes `setAsideSpent` and `assumedSpent` as inputs and hands
  them to `budgetUsedShare()`; it no longer infers set-aside from the category
  map, and the rand figure its chip prints beside the percentage is
  `budget.spent`, the same numerator;
- `healthSnapshot()` pushes `budgetUsed(p).spent` as each period's
  `consumptionBudget`, so the six-period average in `health-math.js` is an
  average of the same numerator the hero prints.

## Consequences

- The Score chip and the Score ring now agree with the hero whenever there is
  one counted period, and differ from it only by the trailing window when
  there are more. The caption under the chip is now true.
- The Budget page's tile no longer counts set-aside as spent, and discloses
  the amount it left out the way the Dashboard hero does. The Dashboard hero
  now counts the assume-spent provision, as the Budget page always did and as
  the Dashboard's own Budget-vs-Actual table already showed per row. Only
  vaults with `assume_spent` categories see the hero move. These are the two
  user-visible changes that are product decisions rather than corrections.
- `periodFlow()`'s `living` band still nets savings-typed spend it finds in the
  category map. That is the rail's own reading and is out of scope here; it is
  named in ADR-0006 as one of the walks the lens work will fold.
- `assumedSpend()` in `period.js`, published on `ctx` and called by nothing,
  is deleted. It counted an assume-spent row's whole amount even when real
  spend already covered it; the surviving rule, `assumedProvision()`, counts
  only the shortfall, which is what the Budget page had been doing on its own.
  `assumedActual()` moves from the Budget view into `money-flow.js` beside the
  rule it serves; the view re-exports it so nothing downstream moves.
- `tests/budget-used-one-rule.test.cjs` pins the rule, the consumers, and the
  absence of the old copies. The numbers ledger did not move: the committed
  fixture household has no set-aside envelope and no assume-spent category, so
  every figure it pins is unchanged. Giving that fixture one of each is a
  follow-up worth doing, so the ledger guards this rule too.

## Second pass (2026-09-06): the rand figures beside the rule

The decision above moved the Dashboard hero's *headline*, its meter and its
"% used" tag onto `budgetUsed()`. It did not move the two rand figures printed
between them, and an audit six weeks later measured what that left on screen.

On the fixture household the hero read "R 3 400 remaining" above "R 13 600,00
spent of R 15 500,00 budgeted" — a sub-line that subtracts to R 1 900 — with a
"Total spent" stat of R 13 600 beside a "78% used" tag whose numerator was
R 12 100. The percentage agreed with the wrong rand figure only by arithmetic
accident: 12 100/15 500 and 13 600/17 500 both round to 78. On a real vault the
same card read "Over budget R 6 161" above "R 47 054,27 spent of R 36 814,00
budgeted", which subtracts to R 10 240; the difference was exactly the R 4 079
of set-aside named two lines to its right.

Three further surfaces were still on the old numerator:

- **the Score page's "Left in the budget"** was `budgeted − spentTotal`, a
  second answer to the question the hero's headline already answers (R 1 900
  against R 3 400 on the fixture; R −10 240 against R 6 161 on the real vault);
- **the trend chart** plotted gross spend against the spend-only envelopes and
  passed an "R X over/under budget" verdict on that pair, which is the mixed
  comparison ISSUE 40 exists to forbid;
- **the Report export** paired gross spend with the whole plan, a third
  pairing that no reader could reconcile to either screen.

All four now read `budgetUsed(p).spent`. What makes them differ from gross is
named rather than left to subtraction: the hero prints a line under its
sub-line carrying the set-aside held out, the assume-spent provision added in,
and any refunds netted off inside the period — the last of these because a
refunded purchase counted gross is the single largest reason a real household's
"over budget" figure is not the one they would compute themselves.

The donut keeps gross slices, because a spending *split* is about where money
went, and it now says so: the set-aside amount is disclosed in its note beside
the uncategorised and netted figures it already declared.

Pinned by `tests/one-spent-rule-on-screen.test.cjs`, which asserts the rendered
card rather than the seam — the gap above survived `tests/budget-used-one-rule.test.cjs`
for two releases because that file never read a rendered hero. Term 4 of
`tests/vocabulary.test.cjs`, which had *declared* the hero's gross stat as
correct, is now a unified term; a declaration is worth something only while
what it declares is still true.
