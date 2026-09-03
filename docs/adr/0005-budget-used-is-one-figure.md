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
