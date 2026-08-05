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

**Period type**:
The rhythm periods repeat on — monthly, or a fixed interval of days.
_Avoid_: frequency, period length, cadence

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
