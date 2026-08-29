# Every ledger can state a currency, and a column nobody uses is never written

Status: accepted

Until 2026-08-29 only **accounts** could record a currency. `Accounts/<name>.md`
has carried `currency:` in its frontmatter for several releases; `Debts.md`,
`Assets.md`, `Owed Money.md` and `Services.md` had no such column and no
frontmatter equivalent that anything read.

The four-lane multi-currency audit that followed
[issue #28](https://github.com/RuanPienaarCode/budget-vault/issues/28) found that
this was not a wrong number but an **unrecordable fact**. A household with a euro
mortgage, a flat in Lisbon, a loan to a relative overseas or a dollar-billed
subscription had exactly one option: type the figure as though it were in the
household's own currency. Everything downstream then treated it as such — the
net-worth total, the debt-to-income ratio, the avalanche ordering, the payoff
schedule, the "what's left to spend" chain. Each of those was arithmetic on a
number the reader had no way to qualify.

Worse, the failure was invisible in both directions. A reader who guessed and
hand-wrote `currency: €` into `Debts.md` found that the frontmatter **survived
every round-trip** (`load.js` captures and rewrites unknown frontmatter verbatim)
and was **read by nothing**. It looked like it took.

## The decision

`currency` is appended as the last column of `assets`, `owed`, `services` and
`debts` in `src/table-schema.js`. It is a display symbol — the same thing an
account's `currency:` is, governed by the same rules in `src/currency.js`: it
never converts and it never excludes silently.

Two properties make this safe, and `tests/ledger-currencies.test.cjs` pins both.

### 1. Blank means the household's currency

Which is precisely what every file already on disk says by saying nothing. A row
truncated before the new column reads `currency: ''` — the truncation sweep in
`tests/table-schema-guards.test.cjs` proves this mechanically for every column,
and this one was added to that sweep. No migration, no reinterpretation of any
existing figure.

### 2. The column is not written until a row uses it

This is the part worth writing an ADR for, because ADR-0003 permits appending and
the naive reading of that permission would have been to widen every table
immediately. Doing so would rewrite every `Debts.md`, `Assets.md`,
`Owed Money.md` and `Services.md` in every vault on first save after upgrade, to
add an empty column — user-visible churn in files under iCloud sync, in exchange
for nothing at all for the single-currency households that are nearly all of them.
`tests/golden-tables.test.cjs` exists to make exactly that consequence loud, and
it did.

So `mdTableFile()` slices trailing columns no row uses (`usedColumns()`), and the
schema marks how many columns are optional (`optionalTail`). The **Split** column
set this precedent: `serializeTxFile` writes six columns into a transaction file
that contains no split, so a file that has never needed the seventh never grows
one. The golden gate now passes **unchanged**, which is the proof that no
existing vault is touched.

Only *trailing* unused columns are dropped. An empty cell in the middle of a row
is a real value — a blank `Category` means "no category" — and the parser is
positional, so its position must survive.

## What this does not do

- **No `currency_code`.** Accounts carry one because exchange-rate lookup needs
  an ISO code and no symbol identifies a currency on its own. These four ledgers
  have no rate lookup behind them yet, and a column nothing reads is the exact
  thing this ADR was written to end. It can be appended the day conversion
  reaches them.
- **No conversion.** A foreign figure is held out of household totals and
  **named** — `worth().otherCurrencies`, `owedSummary().otherCurrencies`,
  `foreignTotals()`. Adding it would be a wrong number; dropping it silently is
  what `src/currency.js` forbids. Neither.
- **Nothing for transactions.** A transaction's currency is a property of the
  account whose folder it lives in. A column on the row would be a second place
  to state one fact, and the two could disagree row by row — which is this
  repository's most-repeated bug shape, and the reason ADR-0003 exists.

## Consequences

- Every function that totals one of these ledgers takes an **optional** household
  symbol. Absent, it adds everything, exactly as it always did — so a caller that
  has not been taught about currencies is unchanged rather than quietly altered.
- The Dashboard's "what's left" partition groups by the union of account, service
  and debt symbols, not by accounts alone: a euro subscription in a vault with no
  euro account must still land somewhere.
- A foreign debt keeps its positional `key` from the full active list, so payoff
  projections do not repoint when one is added.
