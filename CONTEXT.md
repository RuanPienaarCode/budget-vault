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

**Set-aside**:
Money that left a budget account under a savings- or investment-typed category
in a period. Counted inside gross spend, and named separately so the one
question it must not answer — "how much is left to spend" — can take it back
out. The budget's own envelopes of those types are set-aside envelopes.
_Avoid_: saved, contribution (that is the receiving account's word), transfer

**Budget used**:
`(spend − set-aside + assume-spent provision) / budgeted` for one period, where
`budgeted` is the envelopes that are not set-aside and the provision is what an
`assume_spent` category is treated as having consumed beyond what really moved.
One rule (ADR-0005), read by every surface that prints the phrase; the Score
averages it over its trailing window and says so.
_Avoid_: adherence, consumption share, spent %

**Lens**:
A named set of row vetoes and a sign rule, under which a total is taken.
Three exist — BUDGET, HOUSEHOLD, ACCOUNT (ADR-0006). A figure is a field of a
tally under one lens, and two figures may differ only by the lens they were
taken under.
_Avoid_: filter, view (that is a page), scope

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

### Owning

**Asset**:
Something the household owns that is not an account — a house, a car, the
contents of it, gold, a ring. Held on its own page rather than as an account,
because it has no transactions, no institution and no balance to reconcile
against: the only thing the vault knows about it is what somebody says it is
worth. Counted in net worth alongside positive account balances.
_Avoid_: possession, property, item, holding

**Valuation**:
What an asset would sell for, and the date that was last worked out. A stated
balance for a thing that issues no statements — so its age is the only check
there is, and it is shown on every row. Goes stale on a year's clock rather
than the thirty days a bank balance does, because nobody re-values a house
monthly and a rule that flagged every row forever would be ignored.
_Avoid_: appraisal, market value, worth, estimate

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

### Accounts and their folders

See `docs/accounts-and-transaction-folders.html` for the mechanism and the two
ways it fails silently.

**Transaction folder**:
The folder under `Transactions/` holding an account's monthly files. A separate
thing from the account file, joined to it only by a string.
_Avoid_: account folder, ledger

**Transaction label** (`tx_label`):
An OVERRIDE, naming the transaction folder when it differs from the account's
own name. Reading accepts three names — `tx_label`, the account name, or the
filesystem-cleaned account name — but importing writes to exactly one,
`tx_label || name`. So a `tx_label` naming a folder that does not exist reads
perfectly and, on the next import, creates a second folder and re-imports every
row as new. It must name a folder that exists, or be absent.
_Avoid_: display name, folder name

**Orphan folder**:
A transaction folder no account claims by any of the three names. Its rows still
appear in Transactions and still count toward period totals, but they contribute
to no account balance, never appear in a reconciliation, and are absent from the
cash figure. Deliberate — the loader will not invent an account — but silent.
_Avoid_: unlinked folder, stray folder

**Account number**:
The bank's own number for an account. It routes a statement file to the right
folder, and it is what lets a transfer between the reader's own accounts be
recognised as a transfer rather than imported as income.
_Avoid_: account ID, reference
