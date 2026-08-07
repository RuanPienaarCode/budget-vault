# Budget Vault

A household budgeting plugin whose source of truth is the markdown in the vault,
not the plugin. Every figure the plugin shows is derived from a file the user
could have written by hand.

## Language

### Periods

**Period**:
The window a budget and its transactions are measured over. A period has a
*name* the user's files are addressed by, and *boundaries* that decide which
transactions fall inside it. The two are deliberately separate concepts — for
monthly periods, retuning the boundaries never changes the name.
_Avoid_: month, cycle, budget month

**Payday month**:
A monthly period that begins on a chosen day of the previous calendar month
rather than the 1st, so the window lines up with when the household is paid.
Named after the calendar month it ends in.
_Avoid_: financial month, custom month

**Pay cycle**:
The household's own rhythm of being paid, which a period length is chosen to
match. Deliberately never named in the plugin's vocabulary — "fortnightly" is
idiomatic in some of the countries the plugin ships to and foreign in others,
and "bi-weekly" means both every two weeks and twice a week. A period is
described by its length in days instead, which reads the same everywhere.
_Avoid_: pay frequency, pay period, payroll cycle

**Period length**:
How long a period runs, counted in days. Its absence means the payday month,
whose length the calendar decides rather than the household.
_Avoid_: period type, frequency, cadence, fortnightly, bi-weekly

**Anchor**:
A known start date of one period, from which every other period of an
interval-based type is derived. Meaningful only relative to the interval: two
anchors a whole number of intervals apart describe the same set of periods.
_Avoid_: start date, first payday, epoch

### Money

**Transaction**:
A single dated row of money in or out of an account. Stored under the calendar
month it fell in, regardless of which period it belongs to.
_Avoid_: entry, line, row

**Budget**:
The set of per-category target amounts for one period. Targets only — a budget
never holds actual spend.
_Avoid_: plan, allocation, envelope

**Excluded transaction**:
A row the user has vetoed from income and spend totals. Still listed everywhere
transactions are shown, so nothing silently disappears.
_Avoid_: ignored, hidden, skipped

**Non-budget account**:
An account whose every transaction sits outside income and spend totals. The
per-account counterpart to an excluded transaction.
_Avoid_: off-budget, untracked, external

### Saving

**Contribution**:
Money the household moves into a savings or investment account out of its own
funds. Wears the budget category it came from rather than one of its own, so it
is recognised by what it is not — an inflow that isn't growth.
_Avoid_: deposit, top-up, payment in, investment

**Withdrawal**:
Money taken back out of a savings or investment account. The counterpart to a
contribution.
_Avoid_: drawdown, redemption, disinvestment

**Growth**:
What an account earned without the household putting anything in. Deliberately
not the balance less what was put in — that figure counts every contribution as
growth, and was wrong on all four real accounts it was measured against.
_Avoid_: return, gain, profit, yield, performance

**Interest**:
Growth the institution credits as a dated transaction of its own. Kept out of
income and spend totals, because it cannot be spent in the period it lands in —
but read directly by everything that reports growth or taxable earnings, since
being excluded from a total was never the same as being invisible.
_Avoid_: interest earned, investment income

### Balances

**Stated balance**:
What the user says an account holds, and the date they last said it. A claim
with an age, never a fact.
_Avoid_: current balance, actual balance

**Implied balance**:
What an account would hold if every transaction recorded since the stated
balance is complete and correct. The second opinion, not the answer.
_Avoid_: calculated balance, derived balance, true balance

**Reconciliation**:
Measuring the stated balance against the implied one and showing the reader the
disagreement. It never silently overwrites either figure — the reader is the one
who decides which is wrong.
_Avoid_: sync, refresh, auto-update, verification
