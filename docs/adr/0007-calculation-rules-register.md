# The calculation rules, registered

Status: accepted (2026-09-03) · Phase 4 of ADR-0006

## Why this file exists

Until Phase 4 the calculation modules carried their reasoning as comments —
60 to 78 percent of each file by line. Every entry below was one of those
comments: an issue number, a figure that was measured wrong on a real vault,
and the rule that fixed it. The comments were good. They were also the only
place the rule lived, so each new loop copied the code and not the comment,
and the same defect ("two figures derived by different rules") recurred nine
times by commit message.

The rules now live here, one entry each, in file order. The code keeps a
pointer of at most three lines — `/* ADR-0007 · <rule name>. … */` — and
`tests/narratives-live-in-adrs.test.cjs` keeps it that way: no comment block
in these modules may grow past twelve lines, and every pointer must name an
entry in this register.

## How to read an entry

**Decision** is the rule as it stands. **Why** keeps the evidence the comment
carried — issue numbers, measured figures, dates, releases — so a future reader
can re-derive the decision rather than trust it. **Pinned by** names the suite
that fails if the rule is broken; an entry with `—` there is a candidate for
one.

The code-identity gate for this phase was mechanical: the comment-stripped
source of every module below is byte-identical to the commit before it.


<!-- ADR-0007 register fragment: src/period.js and src/trend-math.js, in file order. -->

### period.js — purpose  (`period.js` → purpose)
**Decision:** A period has a name its files are addressed by and boundaries deciding which transactions fall inside it; the two are deliberately separate, and nothing is materialised.
**Why:** Two shapes of name exist. `'YYYY-MM'` is a payday month, running from `month_start_day` of the previous month to the day before it in the named month; the name is stable whatever `month_start_day` is, so retuning the boundary day re-slices the window without orphaning a file. `'YYYY-MM-DD'` is an interval period (every two weeks, and friends), named for the day it starts on and derived from `period_anchor` — one known payday — plus `period_days`. The anchor is meaningful only modulo the interval: two anchors a whole number of intervals apart describe the same set of periods, so all the maths runs off the anchor's phase rather than its literal value, and only a shift that is not a whole number of intervals moves a boundary. See CONTEXT.md and ADR-0001.
**Pinned by:** —

### Pay cycle is a number of days  (`period.js` → `intervalDays`)
**Decision:** The pay cycle is stored as its own length in days (`period_days`); absent or zero means the payday month.
**Why:** A named type would have to pick a dialect — "fortnightly" is idiomatic in za/uk/au and foreign in us/ca, "biweekly" is idiomatic there and genuinely ambiguous (every two weeks, or twice a week?) — and locale.js has no vocabulary layer to swap it per country. A number reads the same everywhere, needs no new word when a cycle is added, and lets someone paid every ten days simply work. A vault that has never heard of the setting behaves exactly as it always did. The band the value must fall in is enforced by `periodDaysOrZero` in dates.js, which the loader applies on the way in, so the stored setting and the running one can never disagree. ADR-0002 records the same decision.
**Pinned by:** —

### Month key shape  (`period.js` → `MONTH_KEY`)
**Decision:** A month key is a year 0100–9999 and a month 01–12, not any four digits and any two.
**Why:** '2026-13' is date-shaped but not a month, and Date's rollover turned it into a real 31-day window titled "undefined 2026" that the arrows would happily walk into. One step up, Date.UTC maps years 0–99 onto 1900–1999, so '0000-01' passed a bare `\d{4}` and resolved to a window starting 1899-12-23 — a period the name never claimed. That is the same relocation `isRealIsoDate` rejects by round-trip, and the two must agree: a month key it would refuse as a date must not be reachable as a month.
**Pinned by:** —

### Anchor must be a real date  (`period.js` → `anchorDay`)
**Decision:** The anchor is a day number only if `period_anchor` survives a round-trip through ISO unchanged; otherwise it is null and `intervalDays` resolves to the payday month.
**Why:** Presence alone was not enough. The loader's shape check admits 2026-13-45, which Date.UTC rolls forward to a date the file never named, and a state built without the loader at all can hold anything — which surfaced as a period literally called 'NaN-NaN-NaN'. Round-tripping the day number back to ISO is the cheapest check that catches both, because only a real date survives it unchanged. A cycle with no usable anchor has nothing to count from, and that pairing must resolve to the payday month wherever it arises.
**Pinned by:** —

### Period key must be addressable under current settings  (`period.js` → `periodKeyValid`)
**Decision:** A remembered period name is valid only if the current period length can address it: a `MONTH_KEY` under the payday month, an on-phase real date under an interval cycle.
**Why:** `S.period` is remembered across a reload, but the period length can change underneath it, and the two shapes are not interchangeable. Left unchecked, a month name under a 14-day cycle fell through every reader's interval branch and came back as a 31-day window that navigated to another month name — so a user who switched to a fortnightly cycle kept seeing month-long periods, with no way to reach their own. The reverse leaked a date-named budget file into a vault that was back on payday months. Checked on load, where the switch lands.
**Pinned by:** —

### Interval key must sit on the anchor's phase  (`period.js` → `periodKeyValid`)
**Decision:** A `YYYY-MM-DD` key is a period start only if it is a real date a whole number of cycles from the anchor.
**Why:** Every YYYY-MM-DD passes the regex, but only the dates a whole number of cycles from the anchor are period starts, and both a length change and an off-cycle anchor move redraw that set. Switching 7 → 14 left half the old starts sitting between the new boundaries, and each still looked addressable: the remembered period kept its old phase, so its window straddled two real periods, prev/next walked that off-phase track forever (only "jump to current" escaped it), and any budget saved meanwhile wrote a file no later period could ever address. Round-tripping through `isRealIsoDate` also rejects a filename like 2026-13-45, which the regex accepts and Date.UTC would silently roll into a date the name does not say.
**Pinned by:** —

### dayLabel names a day; periodShortLabel names a period  (`period.js` → `dayLabel`)
**Decision:** A full `YYYY-MM-DD` is rendered "Aug 22" by `dayLabel`; `periodShortLabel` takes a period key and renders the year as its second half, and the two are not interchangeable.
**Why:** 'Aug 26' from `periodShortLabel` means August 2026 and is right on a trend axis. Handed an end date it still printed 'Aug 26', so a period ending on the 22nd announced itself as ending on the 26th — six inches below a header reading "Jul 23 – Aug 22, 2026". Two labels, two jobs; the mistake was reaching for the axis one to name a day.
**Pinned by:** —

### accountForLabel folds case and safeSegs both sides  (`period.js` → `accountForLabel`)
**Decision:** A transaction-folder label resolves to the first account whose `tx_label` or `name` matches exactly, or matches after `safeSeg()` and case-folding on both sides; no match returns null, and an orphan folder's rows stay in the budget.
**Why:** Label and account file are usually the same string but need not be: `tx_label` points an account at a folder of another name, and `safeSeg()` strips filesystem-illegal characters on the way to disk, so this is the three-way match of `txSegment()` in load.js run the other way round. The filesystems this plugin ships on resolve `cheque/` and `Cheque/` to one directory; `txSegment` gained the fold and this side did not, so a `tx_label: cheque` against an on-disk `Cheque` folder imported happily — the write side matched — while every read through this door saw an orphan: rows counted in the budget, the account told to link a folder it was already importing from. The two halves of one contract must fold the same way. `tx_label` goes through `safeSeg` here too, being the same hand-typed frontmatter `a.name` is: a "Visa: Gold" tx_label names a folder the filesystem holds as "Visa- Gold". An orphan's rows stay in since nothing says otherwise.
**Pinned by:** —

### accountIndex hands over rows unfiltered  (`period.js` → `accountIndex`)
**Decision:** `accountIndex()` maps account → { rows, labels } in one pass over `S.txFiles`, excluded rows included; callers decide what to drop.
**Why:** It lives here rather than in a view because Accounts and Savings both need it and would otherwise keep private copies that drift. Resolving per account instead of indexing once would walk every month file once per account. The two callers that exist deliberately drop nothing: money that left the bank still left the bank whether or not it counts in the budget.
**Pinned by:** —

### One folded-key lookup per index  (`period.js` → `labelLookup`)
**Decision:** `accountIndex()` resolves labels through a Map from folded key to the first account claiming it, built once per index, instead of calling `accountForLabel` once per transaction file.
**Why:** ISSUE 61. `accountForLabel` is O(accounts) with two `safeSeg` calls per account, and `accountIndex` called it per file — O(files × accounts), rebuilt around fifteen times per Dashboard render. Measured with the row count held constant at 9 600: 2 accounts 6 ms, 40 accounts 47 ms for the fifteen rebuilds, and over a million `safeSeg` calls per render at 40. Desktop V8 shrugs; the iOS 15 floor this plugin targets does not. The map is exactly equivalent to the scan it replaces, not approximately: `find()` returns the first account in array order for which any of four tests holds — exact tx_label, exact name, folded tx_label, folded name. An exact match implies a folded match (`safeSeg(x).toLowerCase()` of an equal string is the key), so the folded tests are a superset, and a map from folded key to the first account claiming it gives the same answer for every label, colliding vaults included (#72 is about those).
**Pinned by:** —

### Implied balances are as of now, on new objects  (`period.js` → `impliedAccounts`)
**Decision:** `impliedAccounts(today)` returns every account with the balance `reconcile()` says it should read right now — a drift verdict's `implied`, otherwise the stated figure — as new objects, never by mutating `S.accounts`.
**Why:** ISSUE 44. The Dashboard held two as-of dates at once and said so in its own copy. "Money you have right now" ran every account through `reconcile()`, so a R1 200 Checkers shop on 2 September was inside its R41 800; net worth, four tiles along, called `worth()` on the raw `balance` fields and printed R120 000 built on a R43 000 cash pile that still read as of 1 September — one card, one household, two answers to "as of when", the second captioned "these do not move with the period", which is true and does not mean "these do not move". `reconcile()` is the app's one definition of "what this account should read now" and is not restated here: a drift verdict carries `implied`, and every other verdict means nothing readable has moved since the confirmation, so the stated figure is the current one. The account files are the source of truth and a stated balance is "a claim with an age, never a fact"; writing a derived figure back onto the model would make the claim unrecoverable and the next save would persist a number nobody typed. `today` passes straight through to `reconcile`'s third argument, which had always taken one.
**Pinned by:** —

### Folders resolve to accounts even when empty  (`period.js` → `accountsWithFolder`)
**Decision:** `accountsWithFolder()` resolves every name in `S.txFolders` through `accountForLabel`, so an account whose folder holds no month file yet still counts as linked.
**Why:** `accountIndex()` cannot answer this and never could: it is built from `S.txFiles`, so an account whose folder exists but holds no month file produces no entry there and is indistinguishable from one with no folder at all — both come back as zero rows, and only this set separates them. Resolving through the same door `accountIndex` uses means a `tx_label` pointing at a differently-named folder counts here exactly as it counts there; otherwise an account would be told to link the folder it is already successfully importing from.
**Pinned by:** —

### Earmarked outgoings leave the budget  (`period.js` → `isEarmarkedAccount`)
**Decision:** Outgoings from a transaction folder belonging to money the household has declared set aside are not this period's budget spend; arrivals into it are income like any other. The veto is a direction, not a whole row.
**Why:** ISSUE 41. On the `BudgetAudit` vault the baby fund (type savings, opening R8 000) held `Pram | Groceries | -5000`. That R5 000 went into Total Spent, into the Groceries envelope and therefore into "budget remaining", so buying a pram out of an earmarked fund read on screen exactly like blowing the grocery budget at Checkers — and the same R8 000 was simultaneously being counted as emergency cover by the health card. One fund, spent twice, in two directions. The asymmetry is deliberate: money leaving a fund was funded by an earlier period's income and is not this period's household spending; money arriving in one is arriving now, and a bonus paid straight into savings would otherwise vanish from the figure it belongs in. The three vetoes above this one (per-row, opted-out account, unconvertible currency) are whole-row because their subject is the row; this one's subject is a direction. `in_budget_stated` is the opt-out's opt-out: a household that genuinely runs its spending through an account it has typed savings writes `budget: true` on it and is taken at its word — an absent key is not consent, which is why load.js records whether the question was answered rather than only what the answer was.
**Pinned by:** —

### type: savings alone is not a declaration  (`period.js` → `isEarmarkedAccount`)
**Decision:** An account is earmarked only if it carries `emergency_fund` (true, or an amount), or is a savings/investment pool account with a goal on it — `goal_amount`, `target_date` or `monthly_contribution`; a bare `type: savings` does not qualify.
**Why:** The veto removes a row from the budget entirely — out of `spend`, out of `byCat`, and so off the per-category Budget table as well as the hero. That strong a response was keyed on the account's type, which classifies what kind of account it is and says nothing about whether its money is spoken for. Measured on a household whose only account is a high-interest transactional account (a real and ordinary South African product) typed `savings`, with a R35 000 salary in and R4 250 of real spending out: `periodSummary().spend` read R0, every category row read R0 of its budget, and the hero offered the whole R7 000 budget as still available. The budget stopped measuring anything, silently, off one frontmatter word — worse than the defect the veto was added to fix. So the veto requires the household to have said the money is set aside, using fields the app already asks for: a baby fund has a goal, a transactional account does not. A bare `type: savings` still earmarks the balance against "actually free" (committed.js), where the deduction is a named, visible term the reader can disagree with in one glance, and its outgoings are still labelled as funded from savings on the hero; it no longer silently deletes them from the budget. The strength of the response matches the strength of the declaration.
**Pinned by:** —

### Declared category type is null when unstated  (`period.js` → `declaredCatType`)
**Decision:** `declaredCatType(name)` returns the category's type only where the household stated one (`type_stated`), and null otherwise.
**Why:** `catType` answers "what type does this category behave as", and its `expense` default is right for every consumer that buckets a row. It is wrong for the one consumer that reads the type as evidence of intent — `savedFromOutside`'s ISSUE 32 rule, which treats a non-internal type as the household saying "this was a purchase". A default is not a statement; null means "they have not said", which that rule already handles by leaving the row matchable.
**Pinned by:** —

### Moved-to-funds is an aggregate, not per envelope  (`period.js` → `movedToFunds`)
**Decision:** `movedToFunds(p)` returns how much arrived in the household's own funds (earmarked and pool accounts) from outside them this period, via `savedFromOutside()`, and the Dashboard states it beside the budgeted set-aside figure rather than allocating it to envelopes.
**Why:** ISSUE 43. On the `BudgetAudit` vault Emergency and Investing are budgeted R2 000 each. The funding is a matched pair of rows — `To emergency fund` out of the cheque account and `From cheque` into the fund — both categorised Transfer. `summaryInRange` skips transfer-typed rows entirely, correctly: a transfer is money moving between the reader's own pockets and folding it into income or spend would count one rand twice. So the envelopes' actuals stayed at R0 and the budget went on reporting R4 000 still to set aside after the household had already moved half of it — not a wrong total, but a figure that says you have not done the thing you did this morning. There is no link from a transfer row to a budget category (the cheque leg says "Transfer", the envelope says "Emergency"), and matching on description would mean guessing at free text, which this repo refuses to do for the reason worth.js's `cardOverlap` sets out. The aggregate can be answered without guessing, so the reader compares two totals rather than being told a false zero per envelope. `savedFromOutside()` pairs the legs, so a shuffle between two funds is not counted as fresh saving — the same reading the score's own saving rate takes, from the same function; the import is reused rather than re-spelled because a second answer to the same question is the defect this audit keeps finding.
**Pinned by:** —

### Moved-to-funds windows as of today  (`period.js` → `movedToFunds`)
**Decision:** The window closes at today when the period contains today, and a period that has not started yet returns 0.
**Why:** Windowed the way `periodSummary` is (ISSUE 35), so "budgeted R4 000, moved R2 000" cannot be a comparison against a figure that includes next week's standing order. A period that has not started moves nothing, and returning its whole window would read as "you have already set aside R7 000" beside a budgeted R4 000 — a forecast wearing the past tense. `periodSummary` can state a future window because it hands back `scheduled` alongside to say what the figure is; this is a single number with nowhere to put that caveat, so it answers the question it was asked. `today` is injected like `periodSummary`'s, for the same reason.
**Pinned by:** —

### Foreign folders are held out and named  (`period.js` → `foreignLabels`)
**Decision:** Transaction folders whose account is stated in another currency are held out of every household-currency total and named, every time, through the `foreign` field `summaryInRange` returns; the set is deliberately separate from `nonBudgetLabels()`.
**Why:** ISSUE 28 (2026-08-29 audit). Currency never reached the transaction path at all: `txInRange` stamps each row with its folder label and nothing else, and `summaryInRange` then did `income += t.amount` over the lot, so a Rp 1 500 000 lunch and a R 3 000 grocery shop were the same number. Measured on a two-currency vault: the Dashboard hero read "R 1 499 000 over" where R 1 000 was actually left; the Groceries budget row read "Spent R 1 503 000" against a R 4 000 budget; the donut, the trend line and the month-on-month deadband all inherited it, and not one carried a disclosure, because the account-level figures were the only place the app had thought to put one. A household-currency total cannot include foreign spend and there is no rate to convert it with, so the rows are held out. Silence is what currency.js:14 forbids; a stated exclusion the reader can act on is what `budget: false` already is. A second set rather than one folded into `nonBudgetLabels()` because they answer different questions — "the reader opted this out" versus "this app cannot add these together" — and the disclosure a consumer writes for one is not the sentence for the other.
**Pinned by:** —

### catKnown is a separate question from catType  (`period.js` → `catKnown`)
**Decision:** `catKnown(name)` reports whether a category file actually answers to the name, by the same exact-name match through the same list `catType` uses, so the two can never disagree about which categories exist.
**Why:** `catType` returns null both for "this row has no category" and for "this row names a category that isn't there", and collapsing those two is the same mistake `detectHeaderlessColumns` made with `verified:false` — "disproved" and "no evidence" are different answers, and reading one as the other is how a guess gets laundered into a number. Both states are reachable on supported paths: `promptDeleteCategory` leaves the name on existing rows on purpose, and there is no rename UI, so renaming a category means editing its file and orphaning every row that used it.
**Pinned by:** —

### A budget row's type is the category's live type  (`period.js` → `budgetRowType`)
**Decision:** `budgetRowType(b)` is `catType(b.category) ?? b.type` — the category's live type, and only when no category file answers (no category named, or the file gone) the cell the row itself stored.
**Why:** The 2026-09-02 audit found the three readers of a budget row's type disagreeing: `budgetTotals()` had just been taught to read the live type, while the Budget page's assumed overlay and the Dashboard's `budgetVsActualRows` still read `b.type` — the cell `serializeBudgetFile` writes back verbatim, so it never heals after a category is retyped. Measured through the real loader: a category file saying `expense, assume_spent: true` whose July row still said `income` gave `budgetTotals` {income: 10 000, spend: 1 200} and assumedSpend 0 — two figures on one page from two rules. `??`, not `||`: null is the only value that means "no live answer". Published on ctx so views/dashboard.js's `budgetVsActualRows` reads the same function and the table, the hero and the Budget page cannot bucket one row three ways.
**Pinned by:** —

### Deficit excludes the assume-spent overlay  (`period.js` → `periodDeficit`)
**Decision:** A period's deficit — what actually went out less what actually came in, positive meaning overspent by that much — is measured on real transactions only, never on the assume-spent overlay.
**Why:** An assume-spent row is this period's provision for an earlier period's hole. Counting it here would carry the same overspend forward a second time, and then a third, growing by itself every month with no bank line anywhere behind it. The money that dug the hole is already in `spend`, in whichever period and category it actually left.
**Pinned by:** —

### Deficit is read off net, not spend − income  (`period.js` → `periodDeficit`)
**Decision:** `periodDeficit(p)` is `0 - periodSummary(p).net`, the signed sum of every counted row under one rule.
**Why:** `spend - income` is the same sentence written a second way and drew a different answer: `spend` is gross outgoings and counts an uncategorised payment in full, while `income` counts only income-typed rows, so the deposit beside it was credited to nothing and every period holding uncategorised money in was reported deeper in the hole than it was. On the vault this was found against, two periods' stated overspend was materially wrong, and a third was offered as a hole to carry for a period that had actually finished ahead — two figures derived by different rules, this codebase's recurring bug shape. `net`'s flat "every row, one rule" count makes three leak classes disappear at once rather than needing three fixes: an uncategorised deposit, a refund inside an expense category (nets off inside `byCat` but was never reachable from `income` or `spend`), and a deposit under a category name no file answers to (see `catKnown` — the same "credited to nothing" shape). It also covers a fourth for free: a two-legged Contribution (CONTEXT.md — money moved into savings that "wears the budget category it came from rather than one of its own") has an outgoing leg under an ordinary category and an incoming leg on the savings side under the same category, neither transfer-typed, so `net` counts both and they cancel without `periodDeficit` knowing a Contribution happened. That cancellation only holds while both legs are counted: a savings account carrying `budget: false` (its own veto, unrelated to this one) drops its own leg out of `net`, which turns the outgoing half into what looks like real spend.
**Pinned by:** tests/summary-conservation.test.cjs (the two-legged-contribution case pins both shapes side by side)

### Period figures close at today  (`period.js` → `periodSummary`)
**Decision:** When a period contains today its figures cover start..today and the rest of the window is handed back as `scheduled` rather than dropped; a finished period is untouched, and a period starting after today keeps its own range and reports the whole of itself as scheduled.
**Why:** ISSUE 35. On 2026-09-02 the `BudgetAudit` household's Dashboard read Income R40 000 and Spent R11 590 for September; inside those figures were a family gift dated 28 September and three gym charges dated the 10th, 17th and 24th — money that had not moved, on a card whose every other figure is present tense. The arithmetic was right for "what does this month's ledger add up to"; nobody reading a dashboard on the 2nd is asking that, and the reader had no way to see the padding. The money is real, just not yet spent, and this app does not remove a figure without naming it. Done here rather than in each card, which is the load-bearing part: every period figure on the Dashboard — the hero, the donut, the budget table's actuals — comes through this one function, and tests/cross-page-consistency.test.cjs pins an exact identity between them; narrowing the window in the hero alone would have satisfied the issue and broken that identity in the same edit, which is how "two figures derived by different rules" gets to eight-plus occurrences. The remainder is measured by the same function over the complementary window rather than by subtracting two totals, which would be right for `income` and `spend` and quietly wrong for `count`, since the two windows classify rows independently.
**Pinned by:** tests/cross-page-consistency.test.cjs

### today is injected  (`period.js` → `periodSummary`)
**Decision:** `periodSummary(p, todayArg)` takes an optional ISO `today`, defaulting to the clock.
**Why:** CLAUDE.md's rule for this codebase is "`today` injected rather than read off the clock", and committed.js already honours it (`whatsLeft`, `serviceCommitments` and `debtCommitments` all take it as an argument the caller supplies). This function read the clock directly when it gained its as-of boundary, which left every guard test around that boundary monkeypatching the global Date constructor to say anything at all — a test that fakes the clock proves the arithmetic and never the seam, and there was no seam. Optional, so every existing caller is unchanged and production still reads the real day. A test now names the date as an argument, which is also the only shape in which a future caller — a report generated "as at" a stated date, a what-if — can ask this question at all.
**Pinned by:** —

### A future period is all scheduled  (`period.js` → `periodSummary`)
**Decision:** For a period that starts after today the headline figures are zero, `asOf` is the period's start, and the whole window is `scheduled`.
**Why:** ISSUE 73. This used to hand back the whole window in both halves: the hero then printed "Income R40 000 · Spent R6 590" and, under it, "R46 590 more is dated later this period" — the same money twice, one line apart, captioned "Up to today" on a period today is not in. A future period is a plan, and a plan's figures live in the scheduled half.
**Pinned by:** —

### Set-aside types are one copy  (`period.js` → `budgetTotalsOf`)
**Decision:** The two category types that mean "moved, not consumed" are one set, `SET_ASIDE_TYPES` in vocabulary.js, read by both halves of the budget-used ratio — the budgeted envelopes and the actual outgoings.
**Why:** ISSUE 40. A set of types that drifted between the two halves would produce exactly the mismatch that issue is about, one level down. health-data.js's own `consumption` walk excludes the same pair for the same reason, and states it there for a reader who lands only in that file.
**Pinned by:** —

### summaryInRange is the BUDGET tally  (`period.js` → `summaryInRange`)
**Decision:** `summaryInRange(start, end)` is `tally(ledger(start, end), LENSES.BUDGET)`, with every field it returns read off that one tally.
**Why:** Phase 2 of ADR-0006. The vetoes, the gross sign rule, the disclosures (`foreign`, `fundedFromSavings`), the three category states and the conservation identity are all unchanged; the reasoning that used to sit in this file as prose is the BUDGET lens's own definition. `ledgerEnv()` resolves every household fact a veto reads once per call (`fixedCats` rides along for the HOUSEHOLD lens's `fixed` slice), and `ledger()` is the one entry point a period figure should take.
**Pinned by:** tests/ledger-lenses.test.cjs

### Monthly income averages calendar months  (`period.js` → `monthlyIncome`)
**Decision:** For a cycle that is not already monthly, monthly income is the income over the last `INCOME_MONTHS` calendar months ending at the last complete period, divided by the number of those months holding data; the payday month returns its own income untouched.
**Why:** The Debt page has to talk in months whatever the period length — an instalment is quoted monthly, and the 36% threshold only means anything against a month. Scaling a single period up by the number of periods in a month is right only when income lands every period, the fortnightly case it was written for; on a weekly cycle a monthly salary arrives in one period out of four, so the three empty ones showed no ratio at all and the fourth multiplied one paycheque by 4.35. Widened and averaged, the same salary reads the same in every week of the month. Months with no data at all are trimmed off the far end — a vault whose history starts three weeks ago must not be divided by three months of silence it was never around for — while a gap in the middle is real silence and still counts. The window is (from, endsAt], exclusive at the far end, so a payday sitting exactly on the boundary is not counted by two consecutive windows. The payday month is untouched because the period already is a month and averaging would only blur it.
**Pinned by:** —

### Income window is three calendar months, not a period count  (`period.js` → `INCOME_MONTHS`)
**Decision:** The income window is exactly three calendar months back from the window's end (`isoMinusMonths`, clamping a day the target month lacks: 31 March back one month is 28 February, not 3 March), never a count of periods.
**Why:** It used to be a count of periods chosen so that count × interval landed closest to a whole number of average months, searched between two and four months with the two roundings going opposite ways — lo rounding up to the first count at or above two months, hi rounding down to the last at or below four, after rounding hi up once let a fortnightly cycle pick 9 periods, 126 days, 4.14 months, which was only harmless because income lands every period on that cycle. Thirteen weeks is 91 days, 2.99 months, and was claimed to catch three monthly paydays every time. It does not, and neither does any other length: a monthly payday recurs every 28 to 31 days, so whether a fixed span of days contains two of them or three depends on where in the month the span begins. Swept over every start date, every candidate from 63 to 366 days holds a varying count — even a full 365 days holds eleven paydays or twelve. Measured on the code this replaces, a household earning R40 000 a month saw its stated monthly income move 50% between consecutive weeks, reading as little as R26 758 — the figure the Debt page divides by against the 36% threshold. Calendar months are exact where day counts only approximate: step back three months and you have stepped over exactly three monthly paydays, whatever day they fall on and however long those months were. Swept the same way over 5 117 windows and seven payday days, it holds three every time with zero deviation, which is why the search was removed rather than retuned.
**Pinned by:** —

### Monthly income ends at the last complete period  (`period.js` → `monthlyIncome`)
**Decision:** The window ends at the last complete period — the previous period when `p` is the current one, `p` itself when it is in the past; a vault with no complete period at all returns the running period's income scaled by `MONTH_DAYS / iv` and flagged `complete: false`.
**Why:** A period still running is a partial one: whatever has landed so far divided by a whole cycle reads low, and a low income is a high debt-to-income ratio shown in red on the strength of nothing but which day of the week it is. A vault set up this week has no completed period and would report no income while the user is looking straight at the salary they just imported; a partial figure beats a blank ratio, but the page must be told which one it is so it can label it honestly rather than implying a settled average.
**Pinned by:** —

### Budget totals bucket by the live category type  (`period.js` → `budgetTotalsOf`)
**Decision:** `budgetTotals(p)` and `budgetTotalsOf(rows)` bucket each row by `budgetRowType(b)` — one predicate, computed once per row — not by the Type cell the file happens to carry.
**Why:** That cell is written on save and never again: there is no re-type UI, so correcting a category means editing Categories/<name>.md, and `serializeBudgetFile` writes `r.type` back verbatim, so every row saved under the old type stays stale until its own next save. views/budgets.js has read the live answer since the stale-type fix (`catType(d.category) ?? d.type`, in the totals strip and for the group bars — tests/budget-stale-type-guard.test.cjs); this function did not, so the two disagreed about the same file with no save in between, and this is the one the rest of the app believes: the Dashboard hero's remaining line, the trend chart's budget line, money-flow's budgetUsed denominator, health-data.js's budget pillar in the score, and the Report. Measured on the fixture in tests/period-budget-totals-live-type.test.cjs (Bonus retyped to income in its category file, its July row still saying expense): the Budget page's own tiles read income 15 000 / budgeted 3 000 while this returned {income: 10 000, spend: 8 000}, so the Dashboard printed "R 6 800 remaining", R 5 000 too high, on the very period the Budget page had just described correctly. `??`, not `||`: `catType` returns null both for "no category named" and "no category file", and only then may the row's own stored cell stand in. One predicate per row so income and spend can never bucket the same row two different ways, which a pair of independent filters could. `budgetTotalsOf` takes any set of rows so the Budget page's tiles move as the reader types its unsaved draft.
**Pinned by:** tests/period-budget-totals-live-type.test.cjs, tests/budget-stale-type-guard.test.cjs

### Set-aside envelopes are not budget to spend  (`period.js` → `budgetTotalsOf`)
**Decision:** A budget row typed savings or investment is `setAside`, not `spend`; transfer rows are skipped; income rows are `income`; everything else is `spend`.
**Why:** ISSUE 40. "Budget remaining" was counting envelopes the household never meant to spend. On the `BudgetAudit` vault September budgeted R14 500 — Groceries 6 000, Gym 1 000, Medical 3 500, and Emergency 2 000 + Investing 2 000. Against R11 590 of spending that left R2 910 under a hero reading "Budget remaining this period". It was not money left to spend: it was R4 000 of unfilled savings envelopes less R1 090 of grocery overspend, cancelled into a number that looked like headroom, and a household reading it spends the emergency fund's allocation on groceries while the card calls it fine. Both kinds of row are budgeted and both are shown; only one answers "how much is left to spend". `budgetRowType` is the one reading of a row's type, shared with views/dashboard.js's `budgetVsActualRows`, so the hero, the table and the Budget page cannot bucket one row three ways; a category with no file falls through to the row's own `type` cell, and a household that has typed neither gets what it always got — the row counts as spend, because nothing it has written says otherwise.
**Pinned by:** —

### Budget used has one period-level reading  (`period.js` → `budgetUsed`)
**Decision:** `budgetUsed(p, opts)` returns `{ spent, budgeted, assumed, setAside, used }` by the one rule in money-flow.js's `budgetUsedShare()`: `(spend − setAside + assumed) / budgeted`.
**Why:** ADR-0005 holds the rule. It returns the operands with the share because every surface that prints the percentage prints the rand figure beside it and the two must be the same reading — the Dashboard hero's "spent", the Budget page's "Total spent" tile and the Score ring's per-period numerator are all `spent` here. `opts.today` passes through to `periodSummary` so an as-of reading can be driven; `opts.rows` lets the Budget page measure its unsaved draft, and the assume-spent provision is measured over those same rows, against this period's real spend per category, so numerator and denominator are built from one set.
**Pinned by:** — (ADR-0005 names tests/budget-used-one-rule.test.cjs)

### trend-math.js — purpose  (`trend-math.js` → purpose)
**Decision:** The trend and comparison arithmetic behind the Dashboard's trend chart and category-comparison column lives in its own pure module, registered on ctx like period.js.
**Why:** Extracted from views/dashboard.js, where ~100 lines of pure period arithmetic sat inside a DOM module against the house rule that if it can be pure, it is. Reading `S` and the period helpers off ctx makes every function testable in bare node through the same harness, without mounting the dashboard. The DOM, the range pills, the i18n labels and the colour floor all stay in the view; what lives here is every function whose output is a number, a list of periods, or a map of category totals. `today` is injectable throughout, per the repo rule: a test that reads the wall clock asserts something different every morning.
**Pinned by:** —

### An empty vault has no trend history  (`trend-math.js` → `trendPeriods`)
**Decision:** `trendPeriods(want)` stops after the current period when `earliestDataMonth()` is null, exactly where it stops before the earliest month when one exists; the current period (i === 0) is always pushed first.
**Why:** M2, 2026-08-29 audit. `earliest` is null on a vault that has imported nothing at all (an imported-but-empty file is not history either), and the old `earliest &&` guard only ever fired when it was truthy — so on a genuinely empty vault the break never ran and all `want` periods got pushed: twelve months of invented zero-spend history on the very first report a brand-new household ever generated, directly contradicting the function's own rule that periods before the data are not "months you spent nothing" but months never imported. No data at all means there is no floor to test a period against, which is the same answer as "before the earliest month there is".
**Pinned by:** —

### Elapsed days of the period on screen  (`trend-math.js` → `elapsedDays`)
**Decision:** `elapsedDays(today)` is how many days of the on-screen period have happened (at least 1), or null when the period is not the current one or today is its last day.
**Why:** This is the number the comparison column was missing. Nine days of August were being measured against three whole Julys: every category that bills late in the month showed a large green fall, every category that bills on the 1st showed a rise, and both figures were reporting nothing but today's date — the card said spending was down 39% on food in a month that had barely started. Same trap `monthlyIncome()` already sidesteps in period.js: a part-period cannot be read against whole ones. The last day of a running period counts as complete, because by then the capped window is the whole period and there is nothing left to explain.
**Pinned by:** —

### periodSpend mirrors the budget vetoes, currency included  (`trend-math.js` → `periodSpend`)
**Decision:** `periodSpend(p, days)` is `tally(ledger(p), LENSES.TREND)` — the per-row veto, the per-account one, the per-currency one, transfers dropped, income dropped, and net per category so a refund nets off — over the whole period and again over its first `days` (the same thing when `days` is null or the window runs past the period's end); `foreignLabels()` is read off ctx, never restated.
**Why:** A baseline built by different rules than the figure it is subtracted from is not a comparison. ISSUE 28, third pass: `summaryInRange()` held foreign rows out of income and spend in the first pass and `healthSnapshot()` was taught the same predicate in the second, while this function — which the Dashboard's trend chart, its comparison column and the Score's budget pillar all read — went on adding every remaining row into one per-category rand map. Three consequences, each measured on a two-currency vault: the trend chart drew a rupiah holiday month as a rand spike; the comparison column announced the same rupiah as "up R 3 000 000 on Groceries" against a rand baseline; health-data's `consumptionBudget` (the numerator of the score's `budgetUsed`) divided rupiah spending by a rand budget and read 102 954% where the household's own answer was 97% — only the numerator could go wrong there, since a plan is written in the household's currency by construction. Reading the same Map of label → symbol that `summaryInRange` filters by means the hero, this column and the score cannot come to different conclusions about which rows are household money — the repository's recurring "two figures derived by different rules" shape, landed on each time a predicate is copied rather than shared. Resolved per call, for the reason `nonBudgetLabels()` states: an account can be re-stamped with a currency between two of the six periods the trend draws. What is held out is not dropped silently (currency.js:14 forbids that); the Dashboard hero's `dash.foreignExcluded` line names the same accounts because the predicate is the same one. Phase 2 of ADR-0006 preserved and named, but did not fix, the one difference from BUDGET: TREND lacks the `earmarkedOut` veto ISSUE 41 never taught this walk (see the TREND lens's note in src/ledger.js).
**Pinned by:** —

### count ignores the cap but honours the vetoes  (`trend-math.js` → `periodSpend`)
**Decision:** `count` is the whole period's counted rows, not the capped window's, and it excludes the rows the lens vetoes.
**Why:** It answers "does the vault cover this period at all", and a month whose data starts on the 20th still happened — counting only the capped rows would drop it from the average entirely. It narrows with the rest, though: a period covered only by a rupiah account is not a rand period this vault can average, and counting it as one is what let `compareTotals` build a baseline out of months it holds no household spending for.
**Pinned by:** —

### Comparison baseline carries two totals  (`trend-math.js` → `compareTotals`)
**Decision:** `compareTotals(periods, days)` sums per-category spend over the N periods before the one on screen and returns `{ totals, full, counted }`, or null when not a single completed period has transactions.
**Why:** The two totals answer different questions. `totals` is the like-for-like baseline the change column subtracts from, measured over the same elapsed window as the period on screen; `full` is the whole of each period, and its only job is deciding whether a category is genuinely new or has merely not billed yet this month — without it, every category that charges after the 9th would be announced as new for the first week of every period. A first-month vault gets the donut it has always had rather than a column of "new" against nothing. A period with no transactions at all is not a zero-spend period but one the vault does not cover; averaging it in would halve every figure for every month before the data starts. The view adds the colour floor and the column label — presentation, not arithmetic.
**Pinned by:** —

<!-- Phase 4 register fragment: committed.js, money-flow.js, worth.js. Entries in file order. -->

## committed.js

### committed.js — purpose  (`committed.js` → header)
**Decision:** The module answers "how much money is actually free once the charges already scheduled against it are taken off", by seven rules, inventing no data of its own.
**Why:** Every other page answers what happened; the Dashboard hero's "budget left" on day 3 of a period reads like a fortune while the medical aid, the bond and four debit orders have not landed. Services (recurring.js) know what they were last charged and when, Debts.md carries a contracted instalment, reconcile.js knows what an account should read now; this module only joins them. Rule 1: cash is the IMPLIED balance, never the stated one, and an account whose balance has no readable date is counted as UNKNOWN, not zero. Rule 2, the one the card lives or dies by: a commitment already charged is not a commitment — medical aid that went off on the 1st is spent, and counting it would inflate the committed figure every period until nobody trusts the card. Rule 3: the amount is what was really charged — Services' stated amounts disagreed with the statements on four of six, so `recent` (the median of the last three charges) is used wherever a history exists and the typed figure only where there is none. Rule 4: budget targets are intentions, not commitments. Rule 5: every prediction is disclosed through `items` (what, when, where the amount came from) — a figure nobody can check is how the Services page died. Rule 6: nothing unplaceable is asserted. Rule 7: a card settled in full is a commitment, not a debt — counting the cheque account at face value while the card sits at -R8,874 reports money already owed to Discovery; opt-in per account via `settle_monthly`, because a card genuinely revolved at interest is a Debt-page row and must keep behaving like one. `today` is injected rather than read off the clock.
**Pinned by:** tests/committed.test.cjs

### Whole-month placement window  (`committed.js` → `WHOLE_MONTH_DAYS`)
**Decision:** A debt instalment whose usual payment day is unknown is only claimed inside a window of at least 28 days.
**Why:** A monthly instalment lands in every payday month, so on a monthly cycle "not paid yet" is enough to know it is still coming. On a 7- or 14-day cycle it is not: three weeks out of four would claim a bond payment that is not due, which is rule 6's whole point.
**Pinned by:** —

### One definition of a settle-monthly card  (`committed.js` → `isSettleCard`)
**Decision:** `isSettleCard` is the one predicate — the `settle_monthly`/`settleMonthly` flag only means something on a credit card; on any other account it is a no-op and the account keeps its ordinary treatment.
**Why:** Three sites used to spell it three ways — cardCommitments keyed on the flag alone, cardsOwed on the type alone, the cycle guard on both — and money dropped out through the gaps: a `settle_monthly: true` cheque account landed in cardDue (excluded from `free`) while nothing measured its spending against settling income, because its rows could never join cardRows and no cycle could form. An overdrawn cheque account is already visible as the cash it failed to contribute. Both spellings of the flag are read deliberately: whatsLeft's callers hand in the mapped shape (`settleMonthly`) while the dashboard resolves transaction folders against the raw vault account (`settle_monthly`); a second spelling of the rule is how the three definitions happened the first time.
**Pinned by:** —

### One definition of a credit card  (`committed.js` → `isCreditCard`)
**Decision:** "This account is a credit card" is `accountType(a) === 'credit_card'` — trimmed and case-folded through vocabulary.js — and every page reads it from here.
**Why:** cardOverlap (worth.js) and the importer's liability reading both compared `a.type === 'credit_card'` strictly while this file trimmed and case-folded. `type:` is hand-typed frontmatter that load.js keeps verbatim, so an account typed `Credit_Card` was a card to the committed chain and not a card to net worth or the import sign check — the same account, two answers, depending on which page asked.
**Pinned by:** —

### Days of the month are a circle  (`committed.js` → `usualDay`)
**Decision:** When a debt's payment days spread more than half a month, days below 16 are lifted by 31 before the median is taken and the result folded back; unreadable days are dropped.
**Why:** ISSUE 74. A plain median treats days as a line: two debit orders posting either side of a month end — the 31st and the 1st, one weekend apart — have a numeric median of 16, a day no payment has ever fallen on. On a monthly period the instalment was still claimed once, so only its printed date and `missed` flag were wrong; on a fortnight the half of the month that actually holds the payment reported NOTHING DUE. 31 and 1 become 31 and 32, median 32, folded to 1. NaN dates are dropped rather than allowed to poison the sort, the same discipline recurring.js's chargeStats takes since ISSUE 75.
**Pinned by:** —

### Cash on hand  (`committed.js` → `cashOnHand`)
**Decision:** Cash is the sum of positive implied balances of in-budget, dated accounts; undated accounts are named as unknown, and `counted` is only the accounts that contributed.
**Why:** A credit card at −R8,874 is not negative cash — netting a liability against cash reports money the household does not have; a settle-monthly card comes back as a commitment instead (cardCommitments). Long-term money is kept out by `budget: false`, the mechanism the app already has, with deliberately no second type-based rule on top: two overlapping ways to exclude one account leave a reader unable to explain their own total. `implied` is what reconcile() worked out and `dated` says whether the stated balance carried a date to measure from; undated accounts are never folded in at zero. `counted` used to increment before the positive check, so a card at −R8,874 padded the "N accounts counted" line beneath a cash total it formed no part of.
**Pinned by:** —

### Earmarked cash comes out of free  (`committed.js` → `earmarkOf`)
**Decision:** Money the household has declared set aside — an `emergency_fund` flag (`true` for the whole balance, or a number) or an account typed savings/investment — is measured beside cash and subtracted from `free` alone; `cash` itself does not move.
**Why:** ISSUE 48. "Actually free" on the `BudgetAudit` household on 2026-09-02 was R41 800 — the cheque account plus an emergency fund flagged `emergency_fund: true` plus a baby fund of type `savings` — offered at R1 493 a day for the 28 days left in the month, while four tiles along the health card said the household had 1.6 months of cover: one card told the reader to spend the emergency fund and the other said it was too small. Money in a savings account IS money in your accounts, so a figure captioned "in your accounts" that omitted it would be a different lie; what is wrong is calling it free. Both earmarks are the household's own declaration, not a guess: resolveEarmarks() in health-math.js owns the same `emergency_fund` reading for the score, and the rule is kept here rather than imported because committed.js and health-math.js are the two pure modules and neither may require the other; a baby fund typed savings is money set aside by the act of putting it there, and a per-day rate drawn from it is the card recommending a raid. Case-folded and trimmed because load.js only defaults `type` when the key is absent (worth.js documents that trap costing a chart R80 000). A household that genuinely spends from savings has `budget: false`, which keeps an account out of these figures entirely.
**Pinned by:** tests/earmarked-cash.test.cjs

### A stated budget: key wins over the earmark  (`committed.js` → `earmarkOf`)
**Decision:** An account whose `budget:` key is stated (`budgetStated`) is never earmarked, matching period.js's isEarmarkedAccount.
**Why:** period.js's isEarmarkedAccount opens with the same test — a stated `budget:` key means the household has said how the account is treated, and an absent one is not consent. This function had no equivalent, so one declaration produced two rules on one card: writing `budget: true` moved the hero (the fund's spending came back into the budget) while the what's-left strip four tiles away went on withholding the whole balance, understating "actually free" by it.
**Pinned by:** —

### Price from the dominant group, timing from every group  (`committed.js` → `serviceCommitments`)
**Decision:** A service's price comes from chargeStats over the dominant description group (`m.charges`); whether it has landed and when it is next due comes from every description the tokens hit (`m.all`).
**Why:** "Spotify" hits both the R94.99 subscription and the R2.50 international-payment fee on it, and averaging those quotes a price nobody pays. A merchant that renames its debit order is still taking the money: the vault has eight distinct Vodacom descriptions, and read through the dominant group alone Airtime's last charge looked like 2026-02-07 when it had gone off on 2026-08-02. The effect was silent and one-directional — a stale anchor puts the due date months in the past, `due < from` drops the service, and a real instalment vanishes from the figure telling the reader how much is safe to spend; Website Hosting was hidden the same way while its R601 had already gone off. views/services.js reached the conclusion first for its liveness pill (`chargeStats(m.all)`); this is the same rule on the half that moves money.
**Pinned by:** —

### Charged by today, not merely present  (`committed.js` → `serviceCommitments`)
**Decision:** Only charges dated on or before `from` (today, per whatsLeft) count as having happened; price is not filtered.
**Why:** A row dated later this period — pre-recorded, imported from a statement carrying scheduled debits, or typed ahead — read as history did two things at once, both suppressing the commitment it describes: it satisfied `landed`, and it dragged the cadence anchor forward so the next expected date fell past the window. On the audit household the four gym rows dated the 3rd, 10th, 17th and 24th were all in the ledger on the 2nd, and every one "proved" its own charge had gone. This is the same as-of the rest of the app takes (ISSUE 35 for the period totals, 42 for the account pills, 44 for net worth) reaching the last figure that lacked it. A scheduled debit states what the merchant charges as well as a settled one does, so only WHEN is filtered.
**Pinned by:** —

### How many charges remain  (`committed.js` → `serviceCommitments`)
**Decision:** A sub-monthly service is walked — every cadence date between the window's start and end, less the ones a ledger charge accounts for — and its item carries `amount = unit × occurrences`; monthly and annual services keep the one-charge-per-period rule exactly.
**Why:** ISSUE 47. The old rule — any charge inside the period drops the service for the rest of it — is right for a monthly bill and a lie of omission for a weekly one. Measured on the `BudgetAudit` household on 2026-09-02: Virgin Active at R250 a week, charges dated the 3rd, 10th, 17th and 24th in the ledger; the 3rd was inside the period, so the service was skipped and the card read "nothing scheduled" over R1 000 still to leave the account — the direction this figure must never be wrong in. The monthly path is unchanged since 1.20 apart from the as-of window: one charge per period is what "landed" always measured, and rewriting it would put six years of correct behaviour at risk to fix a case it never had. `due` is the first remaining date (the one a reader can act on), and `unit`/`occurrences` let the row say "4 × R250" rather than assert a R1 000 charge no statement will show.
**Pinned by:** —

### Remaining charges of a sub-monthly service  (`committed.js` → `remainingCharges`)
**Decision:** Cadence dates are anchored on the merchant's own last charge (else the typed `next`), walked backwards to the window first then forward, and a generated date is dropped when one unused real charge sits within CHARGE_MATCH_DAYS (3) of it; the walk is bounded at MAX_STEPS (400).
**Why:** ISSUE 47. "Derived first, typed second", for the same reason the amount takes it: on the reference vault every hand-typed `Next billing` was months in the past. Walking backwards first means a service last charged before the window still lands on the right days inside it. Banks post a debit order a day or two either side of its due day, so an exact-date match would claim every charge twice — once as history, once as a commitment; each charge accounts for one date only, so four charges cannot clear five expected ones. A corrupt anchor (a date in 1970) against a weekly cadence would otherwise walk a quarter of a million iterations to reach the window, inside a render.
**Pinned by:** —

### Where a debt's usual payment day comes from  (`committed.js` → `debtCommitments`)
**Decision:** The usual day comes from payments seen on the debt's linked category, falling back to the debt's start date, and failing both the instalment can only be placed in a window of a whole month or more.
**Why:** The linked category is the same link the Debt page already uses to pull real payments. The start date is honest — it is the day the agreement runs on. No day at all means rule 6 applies and WHOLE_MONTH_DAYS decides.
**Pinned by:** —

### Debt placement window is the period  (`committed.js` → `debtCommitments`)
**Decision:** A debt's due date is placed from `periodStart`, not from `from` (today); an instalment whose day has passed with no payment against it is carried as `missed` rather than dropped.
**Why:** ISSUE 46. whatsLeft starts its window at today on the argument that a charge dated earlier that never arrived is missing, not still coming — right for a service, whose charge is somebody else's to make, wrong for a contracted instalment that does not stop being owed because its day went by. Rule 2 already searched [periodStart, to] for evidence of payment, so two halves of one rule looked at two windows. Measured on the `BudgetAudit` household on 2026-09-02: an FNB card, R500 a month, due day 1, no September payment anywhere in the ledger; rule 2 correctly did not skip it, nextOnDay(today=2 Sep, 1) returned 1 October, past the period end, and the item was dropped — the card read "nothing scheduled" and "actually free" was the entire cash pile, on the one day of the month the household most needs it right. The view says "was due 1 Sep" rather than "expected", because this app argues rather than corrects: claim, date and reason are on the page and the reader decides whether the vault or the bank is wrong. The conservative direction is deliberate: a debt with no `category` can never satisfy rule 2, so it is claimed for the whole period rather than only up to its due day — over-stating committed and under-stating free, the only one of the two errors this card can afford.
**Pinned by:** —

### Rule 2 reads the ledger as of today  (`committed.js` → `debtCommitments`)
**Decision:** "Already paid" is a payment row dated in [periodStart, asOf], where `asOf` is today when today is inside the period and the period end otherwise.
**Why:** ISSUE 55. Rule 2's window used to run to `to`, the period end, so a payment row dated later this period satisfied it; services were given the as-of filter in ISSUE 47 (`charged` is `date <= from`) and the debt half was not. Measured: an FNB card, R500/month, due day 1, today 2 Sep, a payment row dated 20 Sep in the ledger the way an imported scheduled debit order is. reconcile() correctly places that row in `ahead`, so the money is still in cash — and this dropped the commitment: R500 in neither figure, "actually free" over-stated by the whole instalment, the direction the header says this card must never be wrong in. `asOf` rather than `from` because `from` is already today for a running period but falls back to periodStart when today is outside the window, and a past period must not read its own rows as "not yet taken".
**Pinned by:** —

### Settle-monthly card as a commitment  (`committed.js` → `cardCommitments`)
**Decision:** A settle-monthly card's commitment is its own outstanding implied balance, not subject to the WHOLE_MONTH_DAYS guard; `settle_day` only ever narrows the claim.
**Why:** Rule 7. The outstanding balance makes this self-correcting in a way the other two commitments are not: no prediction to get wrong and no rule-2 problem to solve. If the settlement has been paid the implied balance is at or near zero and nothing is left to claim; if not, the balance IS what is still to leave the cheque account. `implied` rather than stated, so a payment since the balance was last confirmed has come off. The whole-month guard exists because a monthly instalment cannot be placed inside a 7-day window without inventing a date; this is not a prediction — the money is owed right now, in every window. A stated settlement day falling outside the window means the balance is not due before the period ends and is not this period's problem.
**Pinned by:** —

### Card commitments carry their own currency  (`committed.js` → `cardCommitments`)
**Decision:** A card item is stamped with its account's `currency`; service and debt items are not.
**Why:** ISSUE 30. The "What's counted" table printed a Rp 4 500 000 settlement as "R 4 500 000"; that table exists so a reader can check a figure, and a line mislabelled by a factor of the exchange rate fails at its one job. Services.md and Debts.md carry no currency column at all, so those items are in the household's currency by construction (issue #30 on the four ledgers).
**Pinned by:** —

### Cards owed are stated, never folded in  (`committed.js` → `cardsOwed`)
**Decision:** Credit-card balances (in-budget, dated, typed credit_card) are reported beside the figures as a sentence — never subtracted from cash, never added to committed — with per-card entries so whatsLeft can disclose the unclaimed remainder without a second card rule.
**Why:** The other two answers are both wrong on their own: a card balance as negative cash reports money the household does not have; as a commitment it claims to leave the cheque account before the period ends, which for a card topped up several times a month cannot be placed and falls foul of rule 6. Saying nothing — what the card did until then — reported "R53 actually free" beside R17,011 of money already spent. Reported beside the figures, nothing above it moves and the reader can still add up every number on the card. Cards only: an overdrawn cheque account is already visible as the cash it failed to contribute; a card is invisible precisely because it is a separate account nobody looks at. `implied`, so a settlement since the balance was last confirmed has come off.
**Pinned by:** —

### whatsLeft inputs and outputs  (`committed.js` → `whatsLeft`)
**Decision:** `whatsLeft` takes implied `accounts` (`{ name, implied, dated, inBudget }`) from reconcile(), `services` and `debts` from S, every `rows`, `cardRows` from settle-monthly cards, `incomeRows` from in-budget accounts only, `periodStart`/`periodEnd` and an injected `today`; `free` may be negative and `perDay` is null on the last day of a period.
**Why:** `cardRows` feed the cycle comparison — spending on settled cards this period against the income that will clear it. `incomeRows` are separate from `rows` on purpose: a monthly debit order into a savings fund is a credit on that fund's statement, and predicting it as household income would announce money arriving that is only moving. A negative `free` renders as "short", never as a negative amount of free money. Dividing the balance by zero days remaining, or printing a whole balance as a daily rate, are both worse than saying nothing.
**Pinned by:** —

### Card settlement kept separable from debit orders  (`committed.js` → `whatsLeft`)
**Decision:** `cardDue` and `committedOther` are returned separately even though both are subtracted.
**Why:** A debit order is a fixed instalment somebody else takes on a known day; a card settlement is this cycle's own spending coming home. Folded into one "still committed" figure, seventeen thousand rand of card hides ninety-five rand of Spotify and the reader can see neither.
**Pinned by:** —

### The owed remainder is per card  (`committed.js` → `whatsLeft`)
**Decision:** `owedElse` is every card balance the commitment chain did not claim, derived from the claimed `items` rather than from a second reading of the account list.
**Why:** `owed` states every card in full and stays, per the both-places test. The view's sentence used to gate on `owed > 0 && cardDue === 0`, all-or-nothing where the data is per card: one settle-monthly card claimed in the chain suppressed the sentence for a second, revolving card, whose balance then appeared in no figure and no sentence — the exact silent state this disclosure exists to end. Derived from the claimed items so the two cannot disagree about which cards were taken.
**Pinned by:** —

### The settlement cycle  (`committed.js` → `whatsLeft`)
**Decision:** When an in-budget settle-monthly card exists, `cycle` compares card spending this period against the next repeating credit (`settling`), which is deliberately not gated on periodEnd; `over` is the signal that matters.
**Why:** A card settled every month is not a claim on the cash sitting in the cheque account, and subtracting it from that cash answers a question nobody asks. The household this was measured on runs its whole month through the card and clears it on payday: the work month runs the 23rd to the 22nd and the salary landing on the 23rd — day one of the next period — settles it; the cash left mid-period is the tail of last month's salary after non-card spending and was never going to pay the card. Measured against it the card reported "R16 958 short" at the same point in every cycle, a warning that fires monthly and is read by nobody. Interest is what proves this is timing, not credit: 16.5% on R40 000 would cost about R550 a month, and the real card charged R0.02, R1.92 and R23.62 across three cycles — a conduit, not a loan. A cycle whose card spend exceeds its settling income is the one case where the pattern has really stopped working. A period-end gate (right for `incoming`, "what else arrives before this window shuts") would exclude the only income that ever clears the balance, since under a payday month anchored on payday the settling salary always lands on day one of the next period.
**Pinned by:** —

### Settle-monthly re-checked inside whatsLeft  (`committed.js` → `whatsLeft`)
**Decision:** `cycle` only forms when some in-budget account passes `isSettleCard`, checked here rather than trusted from the caller's filtering of `cardRows`.
**Why:** A revolving balance must never be read as a settlement cycle — it is a real claim, and telling its holder they have "headroom before the 23rd" would be the most dangerous sentence this card could print. Leaving that guarantee in the caller is how the two drift: whatsLeft would report a cycle for any rows it was handed.
**Pinned by:** —

### One free figure  (`committed.js` → `whatsLeft`)
**Decision:** `free` is `cash − committedOther` inside a settlement cycle and `cash − committed` outside one, less the earmark; every rendered "actually free" reads this one number.
**Why:** The headline, the per-day rate, the "leaves you short/covered" sentence and the bar's aria-label must all read the same figure or the card contradicts itself out loud — a screen-reader user hearing one figure in the aria-label and a different one printed beside it is exactly that. While a cycle runs the card has its own band (`cycle`) and is no longer a claim on this cash, so cardDue leaves `free` exactly when `cycle` says the card is handled separately and committedOther alone is what is still coming out of this cash; outside a cycle cardDue is a real claim like any other and stays in.
**Pinned by:** —

### Earmark floored at cash  (`committed.js` → `whatsLeft`)
**Decision:** The earmark subtracted from `free` is `min(cash, earmarked)`.
**Why:** ISSUE 48. Earmarked money comes out of `free` and out of nothing else (see cashOnHand's note). A household whose declared earmarks exceed what it actually holds gets "R0 free" rather than a negative figure that reads as a shortfall it does not have; the over-earmark itself is the score card's finding (resolveEarmarks' `over`), not this card's. `earmarkedFrom` names which accounts, because "R23 000 is spoken for" with no way to see where invites the reader to assume it is wrong.
**Pinned by:** —

### Compared in cents  (`committed.js` → `whatsLeft`)
**Decision:** `short` and `perDay` test `Math.round(free * 100)`, never the raw float difference.
**Why:** Summing floats that were themselves fine (measured across 1,000 realistic amounts: no drift) can still leave a difference of a few units in the 13th decimal place — R4,001.60 confirmed against R1,000.70 + R3,000.90 committed nets to -4.55e-13, not zero, in IEEE 754. Read as `free < 0` a household that is exactly break-even is told it is short and shown "R -0,00". Rounding to the cent before comparing is the fix; the sums themselves are untouched.
**Pinned by:** —

### afterIncoming counts the settling salary once  (`committed.js` → `whatsLeft`)
**Decision:** `afterIncoming` is `free + incoming.amount − cardDue` inside a cycle, `free + incoming.amount` outside one, and null when nothing is arriving.
**Why:** `incoming` and `cycle.settling` are the same credit: inside a settlement cycle `free` already excludes cardDue on the grounds that the card is handled by its own band, and that band is funded by exactly this salary, so `free + incoming.amount` spent the same money twice and overstated the one figure on the card answering "what is safe to spend" by the whole card balance. Computed here, once, because the view cannot safely do it; null so the view renders no sentence rather than a sentence about zero.
**Pinned by:** —

## money-flow.js

### money-flow.js — purpose  (`money-flow.js` → header)
**Decision:** This module is the arithmetic behind the Score page's "Where the money went" card and the segmented rail, and it may not invent a second way of computing any figure that already has a home elsewhere in the app.
**Why:** Pure per the house rule (no DOM, no `require('obsidian')`); views/score.js assembles the raw material from periodSummary, periodSpend, budgetTotals and splitFlows the way health-data.js assembles for health-math.js. Where a figure needs a new judgement call it is written down rather than silently made: `spentTotal` is periodSummary(cur).spend unmodified (the Dashboard hero's "Total Spent" tile); `committed` is the same "categories flagged fixed" rule health-data.js applies to its six-period average (S.categories filter c.fixed), read for one period; `living` is spent minus committed so "what counts as living" is decided once. `saving` is contributions into savings/investment ACCOUNTS detected by splitFlows the way health-data.js detects them for the saving pillar — deliberately not "spend categorised as type savings", because health-math's consumption already excludes that (a household funding its own investments must not read as overspending) and accounts, not category labels, are what splitFlows measures money landing in. `notYetSpent` is income less the other three, floored at zero: a period that spent or saved more than it earned is a real deficit (periodDeficit argues about that on the Dashboard); this card only refuses to draw a negative slice. The two lefts are a separate identity from the four bands. `budgetUsed` is budgetUsedShare() — ADR-0005's one rule, with `setAside` supplied by the caller from periodSummary() — the same numerator the Score ring's six-period average uses, with only the window (this period here, six there) differing on purpose.
**Pinned by:** —

### periodFlow inputs  (`money-flow.js` → `periodFlow`)
**Decision:** `periodFlow` splits one period's income four ways — committed & fixed bills, living, saving, not yet spent — from `income`, `spentTotal`, `budgeted`, `spendByCat`, `fixedCats`, `catType`, `savingContribution` and `debts`, and every argument defaults safely.
**Why:** `income` and `spentTotal` are periodSummary(cur)'s income and spend (the Dashboard hero figure); `budgeted` is budgetTotals(cur).spend; `spendByCat` is periodSpend(cur, null).whole, category → positive amount; `fixedCats` is the set of category names flagged fixed in S.categories; `catType` is ctx.catType (name → type string or null); `savingContribution` is this period's splitFlows total across savings/investment accounts (the score's own saving signal); `debts` is S.debts raw. A brand-new vault (no income, no budget, no debts) returns zeroed bands rather than throwing or dividing by zero.
**Pinned by:** —

### Income base for "allocated"  (`money-flow.js` → `incomeBaseFor`)
**Decision:** The denominator for "what share of income did the plan claim" is the budget's own income figure; actual income stands in only where the budget names none AND the period has finished, and a running period with no budgeted income gets no percentage.
**Why:** The Dashboard's "N% allocated" and the Score page's "Allocated of income" answered the same question differently: on a real vault, mid-period, the Dashboard read 100% and the Score page 102% off the same files, one dividing by the income the budget states and the other by the income that had landed by that morning. A running period's actual income is a part-month number, so dividing a whole period's plan by it says nothing about the plan and everything about today's date — on this vault a R255 invoice arriving before the salary would have printed "19252% allocated", reading as a settled fact because nothing on the line said which day it was measured. A finished period's actual income is a whole figure that no longer moves.
**Pinned by:** —

### Allocated share is the whole answer  (`money-flow.js` → `allocatedShare`)
**Decision:** `allocatedShare` returns the ratio itself so the two cards cannot diverge on the edges: a budget of zero is 0% allocated whatever the income, and a real budget against an income base that does not exist yet returns null.
**Why:** With a zero numerator no denominator is needed. Null leaves the line off rather than invented.
**Pinned by:** tests/null-vs-zero.test.cjs

### Zero budget reads 0% only beside income  (`money-flow.js` → `allocatedShare`)
**Decision:** With no budget, the answer is 0 when there is some income (base or actual) and null when there is neither.
**Why:** A vault with neither budget nor income is not "0% allocated"; it is a vault nobody has filled in yet, and a figure there looks like a finding. Both halves are pinned, documenting this module's 0-vs-null convention against health-math's.
**Pinned by:** tests/null-vs-zero.test.cjs

### One budget, two denominators  (`money-flow.js` → `periodFlow`)
**Decision:** `budgetSetAside` — the savings/investment half of the plan — joins the "share of income budgeted" denominator and stays out of the "budget used" denominator; it is optional and defaults to 0.
**Why:** ISSUE 40. A rand into the emergency fund is every bit as allocated as a rand of groceries, so the whole plan is the base for the first ratio. Nothing in the budget-used numerator can ever fill a savings envelope (its funding is transfer-typed and summaryInRange drops it), so including those envelopes reports a household that has funded every envelope as under-spent. 1.36.0 split budgetTotals and moved the Dashboard hero to the first rule while this function kept receiving `spend` alone for both: on the audit household that printed "41% of income budgeted" on the Dashboard and the Budget page against "30%" on the Score, and "45% used" against "32%" — the same phrase, the same period, one household.
**Pinned by:** —

### Budget used is one rule  (`money-flow.js` → `budgetUsedShare`)
**Decision:** `budgetUsed = (spend − setAside + assumed) / budgeted`, null when there is no plan to measure against.
**Why:** docs/adr/0005-budget-used-is-one-figure.md. `spend` is a period's gross outgoings, `setAside` the part of them under a savings- or investment-typed category, `assumed` the assume-spent provision (assumedProvision), `budgeted` the envelopes that are not set-aside. Money moved into the household's own funds is not spending so it leaves the numerator; the envelopes for it are not budget to spend so they were never in the denominator; dividing by an absent budget is not "0% used". Every surface that prints the phrase — the Dashboard hero, the Budget page's totals strip, periodFlow()'s chip figure, health-data.js's per-period numerator the Score ring averages — reads this function directly or through period.js's budgetUsed(p). Four spellings became one on 2026-09-03.
**Pinned by:** tests/budget-used-one-rule.test.cjs

### Assume-spent Actual  (`money-flow.js` → `assumedActual`)
**Decision:** An assume-spent row's Actual is the larger of its budgeted amount and what really moved.
**Why:** A category flagged `assume_spent` (a carried overspend, a cash envelope) is treated as consumed at its budgeted amount even with no transaction behind it this period; a real payment larger than the budget still shows in full. One function for the Budget page's Actual column, the Dashboard's Budget-vs-Actual table, the Report and both exports — it was written twice before and the copies drifted (see the note above budgetVsActualRows in views/dashboard.js).
**Pinned by:** —

### Assume-spent provision  (`money-flow.js` → `assumedProvision`)
**Decision:** The provision is, per assume-spent row, its Actual less the real spend it already covers, clamped at zero, with `realSpendOf(row)` supplied by the caller.
**Why:** A refunded category contributes nothing rather than a negative slice. Only the caller knows which ledger the rows were measured against — the saved file, or the Budget page's unsaved draft.
**Pinned by:** —

### Budget-vs-actual row status  (`money-flow.js` → `budgetRowStatus`)
**Decision:** One rule for `remaining`, `unbudgeted`, `over`, `near` (85% of the envelope) and `pct` on every page that prints the table; an assume-spent row is never `unbudgeted`.
**Why:** Phase 3 of ADR-0006. `remaining` is what is left of the envelope; `unbudgeted` is spend under a category nobody budgeted. An assume-spent row is consumed by construction and has nothing to be "unbudgeted" about — the serialiser used to say otherwise, and the Dashboard's reading wins. `pct`, `over` and `near` are the bar's own three states.
**Pinned by:** —

### Savings-typed spend tracked before living  (`money-flow.js` → `periodFlow`)
**Decision:** `savingsTypedSpend` sums every savings/investment-typed category's spend, fixed-flagged or not, and `committedSavingsTyped` the part that is also flagged fixed.
**Why:** It is the same slice health-data.js's own `consumption` excludes for the same reason: the outgoing leg of a savings transfer is an ordinary debit inside `spent`, and the incoming leg is what `saving` already counts. Tracked here rather than folded straight into `living` because the part also flagged fixed has to be told apart from the rest first (see "Living excludes savings-typed spend once").
**Pinned by:** —

### Interest recomputed on the flow card  (`money-flow.js` → `periodFlow`)
**Decision:** "Of which interest" is monthlyInterest over the active, home-currency debts, recomputed here rather than threaded through from healthSnapshot(), and capped at `debtRepayments`.
**Why:** It is the same figure health-data.js hands the score's debt pillar (debtInterestMonthly), but score.js's renderScore() calls renderFlowCard() (which reaches this function via buildFlow()) before it calls healthSnapshot(), so the snapshot carrying health-data.js's own debtInterest does not exist yet; passing it in would mean reordering renderScore() around a card deliberately independent of the trailing-average snapshot, or calling healthSnapshot() twice per render — the audit's "leave a comment, not a refactor" case. debtInterestMonthly is a pure function of S.debts and the household's currency symbol, so the two calls agree today; if it ever grows a third argument (a date, a rate override) this call site and health-data.js's must move together or the two figures on this page drift. That has already been cashed once: debtInterestMonthly grew `household` in the ISSUE 28 second pass and this line was the copy that had to move with it — a euro mortgage was printing R1 000 of "of which interest" under the flow card while the breakdown directly beneath it, off the same book, said R333,33. `household` is optional here as it is there: an untaught caller gets what it always got. Interest is a subset of `debtRepayments`, never an addend: an instalment covers interest before principal, so the line is capped at the repayment it sits under rather than ever printing larger than its parent.
**Pinned by:** —

### Living excludes savings-typed spend once  (`money-flow.js` → `periodFlow`)
**Decision:** `living = spent − committed − (savingsTypedSpend − committedSavingsTyped)`, floored at zero.
**Why:** `living` used to be `spent − committed`, and `spent` (periodSummary's own total) includes the outgoing leg of a category categorised `savings`, whose incoming leg `saving` already counts (splitFlows on the receiving account) — so a household moving R10,000 into a savings-typed category read as R10,000 of extra living AND R10,000 of saving, two of the four bands wrong by the same amount. Subtracted the way health-data.js's own `consumption` excludes it, minus whatever is already flagged fixed: that portion already left `spent` via `committed`, and subtracting the full `savingsTypedSpend` would pull the same rand out of `living` twice.
**Pinned by:** —

### The two lefts  (`money-flow.js` → `periodFlow`)
**Decision:** `leftInBudget = budgeted − spent`, `neverBudgeted = income − budgeted`, and `together` is their sum, which is always exactly `income − spentTotal` and may legitimately read larger than the `notYetSpent` band.
**Why:** They are genuinely different questions, both real: what the household's own plan still allows (negative means over budget) and income the plan never claimed at all (negative means over-allocated). The budgeted term cancels, so the identity holds unconditionally and needs no clamping to stay true. `together` reads larger than `notYetSpent` whenever `saving` is non-zero, because notYetSpent has saving taken off it first (it is its own band) while a budget total is a plan for spending and says nothing about what left through a savings transfer; the honest reading is that `together` splits further into `saving + notYetSpent`, not that the two must render as the same width.
**Pinned by:** —

### Budget used numerator and window on the chip  (`money-flow.js` → `periodFlow`)
**Decision:** The chip's "Budget used" is not `spent / bud`; its numerator is the ADR-0005 one (periodSummary()'s `setAside` handed in as `setAsideSpent`), and only the window — one period here, six on the ring — differs from the Score ring.
**Why:** `spent` is periodSummary().spend, which includes savings-typed spend (the outgoing leg of a `savings`/`investment` category), while health-math.js's score-facing budgetUsed (avg.consumptionForBudget / avg.budgeted) excludes that leg the way its `consumption` always has ("what living cost: everything except money moved into the household's own funds" — health-data.js). Dividing the raw `spent` made the two numerators disagree under one label (tests/vocabulary.test.cjs's GAP A): a household funding an investment inside a budgeted category read as having blown its budget on this card while the ring above it, reading the adjusted figure, said the opposite. Since ADR-0005 the numerator answers "what did living actually cost, against what was planned for it" on every surface by one rule. The window difference is deliberate: the ring reads a six-period trailing average restricted to periods that carried a plan (health-math.js's `avg.consumptionForBudget` comment explains why a narrower, matched-to-`budgeted` window is the right one to average), so a single grocery-heavy period swinging this chip without moving the score's steadier read is a feature, not a second disagreement; score.js's buildFlowChips says so on screen under the row.
**Pinned by:** tests/vocabulary.test.cjs

### Set-aside comes from the caller, not byCat  (`money-flow.js` → `periodFlow`)
**Decision:** `budgetUsed` and `spentByRule` are fed `setAsideSpent` and `assumedSpent` by the caller, never by a scan of `byCat`.
**Why:** ADR-0005. `byCat` is periodSpend()'s NET reading; a contribution into a fund inside the budget has both legs in it and nets to zero, so the old scan here subtracted nothing for it and this chip read 51% where the Dashboard hero, subtracting periodSummary().setAside directly, read 38% on the same rows. `savingsTypedSpend` still shapes the `living` band; it does not shape this figure.
**Pinned by:** —

### Percentages of income past 100  (`money-flow.js` → `periodFlow`)
**Decision:** Band percentages use largestRemainder to 100 only while the bands share one whole (raw sum ≤ 100.0001); in a deficit period each band is rounded on its own.
**Why:** Living costs really can be 180% of what came in, and saying so is the point of this card. Past 100 there is no whole to allocate: `left` in share-percents goes negative, its top-up loop silently never runs, and it returns bare floors summing to anything. Rounded alone the bands are still honest, just no longer claiming to partition 100; anything laying them out as proportions must scale by their own sum rather than a hard 100 — views/score.js does, and used to not.
**Pinned by:** —

### The epsilon on the surplus branch  (`money-flow.js` → `periodFlow`)
**Decision:** The surplus test is `rawSum <= 100.0001`, not `<= 100`.
**Why:** Four quotients of the same divisor summed back up land one ULP over on an ordinary surplus period — 100.00000000000001 was measured in a fuzz round. A bare `<= 100` sent that period down the deficit branch and rounded each band alone, which is precisely the "17 + 17 + 17 = 102%" defect largestRemainder exists to prevent, on a household never in deficit. A hundredth of a percent is far below anything the card can render and far above float noise.
**Pinned by:** —

### Display bands partition the headline  (`money-flow.js` → `periodFlow`)
**Decision:** The rand figures printed beside the percents are largestRemainder over the band amounts against the rounded income, on the same branch as the percents; `roundRand` mirrors formatMoney's sign-then-abs order.
**Why:** money(x, 0) rounding each band alone is the same defect the percent column closed: on a real vault the printed bands came to R 40 241 under a "money in" headline of R 40 240 — one rand the reader can find nowhere. Allocated the way the Dashboard donut's legend money column already is (dashboard.js's rowMoney): floors plus largest remainder against the headline's own single rounding. In a deficit period there is no whole to partition and each band rounds alone exactly as its percentage does. Sign-then-abs so a negative figure pre-rounded here prints the same rand money(v, 0) would have printed for the raw value.
**Pinned by:** —

### Together is derived from the printed parts  (`money-flow.js` → `periodFlow`)
**Decision:** `display.together` is `display.leftInBudget + display.neverBudgeted`, each part rounded once; the raw identity is untouched.
**Why:** leftInBudget is the Dashboard hero's own headline and neverBudgeted its own fact against the same files, so each keeps its plain single rounding, but `together` exists only as their sum, and rounding it separately printed "38 730 − 653 = 38 078" on the one chip whose whole claim is that two rows combine into the third. Display only.
**Pinned by:** —

### Rail segments  (`money-flow.js` → `railSegments`)
**Decision:** `railSegments` returns the pillars in PILLARS' weight order with `width = shownMax`, `fill = shownPoints` and `at` unrounded, skipping pillars absent from the breakdown.
**Why:** Once drawn as a bar under the hero number, now the arithmetic behind the hero's ring (views/score.js's buildScoreRing); the shape of the data and its guarantee are unchanged. `shownMax` is already renormalised and integer-allocated by health-math's scoreBreakdown so widths sum to exactly 100, and `shownPoints` is the points earned — the two rounded figures a reader sees printed. `at` is health-math's own continuous fraction (0..1) because a segment's fill arc drawn from `shownPoints / shownMax` would show a visibly different angle than the exact fraction scoreBreakdown computed, for no reason but that two integers were handy — "16 of 25" and the arc are one fraction told two ways, not two roundings of it. A pillar the vault cannot answer is already absent from breakdown.pillars (health-math drops it and lets the rest share its weight), so filtering PILLARS to the keys present keeps the two in step without a width-zero segment.
**Pinned by:** —

## worth.js

### worth.js — purpose  (`worth.js` → header)
**Decision:** Net worth — what is owned, what is owed, and where each figure came from — has one definition, used by the Savings tiles and the chart so they cannot drift apart.
**Why:** "Owed" has two homes in this vault: an account with a negative balance (a card, an overdrawn cheque account) and a row on the Debt page. The KPI tile counted only the first, the chart beneath it counted only the first, and the subtitle disclosed the omission as a phrase — which is not a disclosure when the omitted item is a home loan and the number it qualifies is the headline of the page. Pure — no DOM, no obsidian import — so it runs in bare node.
**Pinned by:** tests/worth.test.cjs

### Net worth reads outstanding from owed-math  (`worth.js` → `owedTotal`)
**Decision:** Receivables are summed as `outstandingOf(o)` from owed-math.js, never as `amount`.
**Why:** owed-math.js owns what "still out" means — a row's amount less what has come back, floored, with a hand-set `paid` status winning over the arithmetic. A part-recovered loan (R2 000 lent, R500 back) is R1 500 of receivable, and any second copy of that subtraction is one more place for the balance sheet and the Owed page to disagree.
**Pinned by:** —

### Receivables are the third owned ledger  (`worth.js` → `owedTotal`)
**Decision:** Unsettled, home-currency Owed Money rows are added to owned; `household` absent means add them all.
**Why:** ISSUE 39. Measured on the `BudgetAudit` fixture: R2 000 lent to Thabo on 2026-06-01, still outstanding, absent from a R120 000 net worth on a card whose own copy reads "owned · owed" — where "owed" means liabilities, so the reader had no word left for the money owed TO them and no line that counted it. The Dashboard's position band already computed owedSummary() four lines from worth()'s own call site and printed the receivable in its own tile: one card, two ledgers, and the balance sheet only added one of them. Same three rules the two ledgers beside it follow: settled rows are history (activeDebts' rule, one ledger over); foreign rows are held out and named through `otherCurrencies` rather than converted, because this vault holds no rate (currency.js:10 and :14); and an absent `household` leaves every caller not taught about currencies exactly as it was.
**Pinned by:** —

### Net worth splits accounts by sign  (`worth.js` → `worth`)
**Decision:** Owned is positive account balances plus the Assets page plus receivables; owed is negative account balances plus every active debt-page balance; both returned as positive magnitudes, with the ledgers kept separable.
**Why:** Accounts split by sign rather than by type, matching the chart: a cheque account in overdraft is a liability however it is labelled, and a credit card in credit is an asset; callers negate for display. `ownedAccounts`, `ownedAssets`, `fromAccounts` and `fromDebts` stay separable because every page that states a total must also say where it came from; `fromAccounts` is the owed half of the account ledger and `ownedAccounts` the owned half — an asymmetry in the names kept because `fromAccounts`/`fromDebts` already shipped and renaming buys nothing. A house here and its bond on the Debt page is not a double count: one is owned and one is owed, which is exactly the arithmetic net worth is.
**Pinned by:** —

### `currencies` names the household first and walks accounts only  (`worth.js` → `worth`)
**Decision:** `household` (S.settings.currency), if given, passes through to currenciesIn() so the returned `currencies` list names it first, defaulting to currenciesIn()'s own "R"; the list walks accounts only.
**Why:** Optional so every existing caller (none of which passed it at the time) keeps working unchanged; a caller that wants the disclosure to name the household's real symbol should pass it. Accounts are the same list currenciesIn() already covers everywhere else (views/accounts.js:589 is the one other call site). Assets had no currency field — SCHEMAS.assets was name/type/value/valued/notes, and table-schema.js is append-only with a byte-golden gate, so adding one was a bigger decision than this fix — and a R-valued house and a €20 000 account were summed together either way; this only gave a caller something to name the mix with. (assetTotal's ISSUE 30 note records that assets can state a currency since the ADR-0003 append.)
**Pinned by:** —

### Net rounded to the cent  (`worth.js` → `worth`)
**Decision:** `net` is `owned − liabilities` rounded to the cent, then `|| 0` to collapse -0 — the same two-step `fromAccounts` already applies, extended to the difference itself.
**Why:** A household exactly break-even (50.30 owned, 10.10 + 40.20 owed) leaves a float remainder like -7.1e-15 behind; read raw, `net < 0` reports a solvent household as short and renders "-R0.00". The remainder is a read-off-the-sign bug, not a summing one — nothing above the line changes.
**Pinned by:** —

### Card overlap is reported, not deduped  (`worth.js` → `cardOverlap`)
**Decision:** When card accounts in debit and credit-card debt rows both exist, `cardOverlap` reports the two counts and lets the reader look; it never guesses a match.
**Why:** A credit card can honestly be tracked as an account or as a debt-page row, and nothing stops someone doing both — at which point net worth counts it twice. Names are free text, and "Discovery" on an account file need not match "Discovery Bank" on a debt row, so any matching rule would be wrong on real data in both directions. Silently picking one ledger would be the worse failure: it hides money either way, and without saying so.
**Pinned by:** —

### Grouped by type, largest first  (`worth.js` → `groupedByType`)
**Decision:** Rows group by trimmed `type` (else "other"), zero and negative values dropped, sorted largest first; `debtsByType` and `assetsByType` are this one grouping over different lists.
**Why:** A bond and a car loan (or a house and a car) are tellable apart in the chart rather than merged into one anonymous block; a segment of no width is noise in the legend. One function so the drop rule and the sort cannot drift between the two.
**Pinned by:** —

### Chart segments and heading from one filter  (`worth.js` → `debtsByType`)
**Decision:** `debtsByType` holds out rows stated in another currency exactly as `fromDebts` inside worth() does; `household` absent means add everything, the contract assetTotal() carries.
**Why:** A chart row's widths are shares of one scale under a single heading: the Savings composition chart took its heading from worth() (which holds foreign rows out) and its segments from here (which did not), so a two-currency vault drew R2 300 000 of blocks under a R2 100 000 heading on a track scaled to R2 100 000 — 109.5% of the bar's own width, running over its neighbour — and sharePercents then stated each wedge against the segment sum, a denominator the reader was never shown. Unlike a total, a bar has nowhere to print a disclosure inside itself, so the held-out rows are named underneath instead (views/savings.js's `worthNote`).
**Pinned by:** —

### Account groups carry unlisted types  (`worth.js` → `accountGroups`)
**Decision:** Every account is grouped by sign — the known types first in the caller's order, then any type the vault actually carries, largest first, under its own name — with `known` marking which groups came from the caller's list.
**Why:** The chart used to walk a fixed list of six types while worth() counted every account by sign, so an account whose file says `type: tfsa` — or `type: Savings` with a capital S, the same bug wearing a hat — was inside the net-worth tile and absent from the chart beneath it. Measured: one R80 000 account of an unlisted type put "Net worth R740 000" in the tile and "Net worth R660 000" in the chart's own label, on one screen, with nothing saying which was wrong. load.js only defaults the type when the key is absent, so a present-but-unrecognised value reaches here verbatim, and a vault whose files a person could have written by hand will produce them. Unlisted types keep their own name rather than being folded into "other" — the choice debtsByType and assetsByType already make — because renaming a reader's own label to make a chart tidy is the kind of quiet correction this app does not do. `known` lets the view pair known groups with their fixed labels and colours and colour-walk the rest.
**Pinned by:** —

### Account type case-folded in the chart  (`worth.js` → `accountGroups`)
**Decision:** The bucket key is `accountType(a)` — case-folded as well as trimmed — never `.trim()` alone.
**Why:** After the R80 000 lesson above named `type: Savings` as "the same bug wearing a hat", this function kept comparing `.trim()` alone, so a capital-S account still missed the sealed `savings` bucket and drew as its own unlisted group under its own label. views/savings.js and health-data.js were folded first; this was the last raw reading of the field, and the one that decides which colour a segment gets.
**Pinned by:** —

### Other-currency net disclosure  (`worth.js` → `otherCurrencyNet`)
**Decision:** Everything a net-worth figure held out is one per-symbol NET — accounts + assets + receivables − debts — with symbols that net to nothing dropped, -0 collapsed, and insertion order accounts, assets, debts, owed.
**Why:** worth() had returned `otherCurrencies` — the foreign assets and debts it filtered out — since ADR-0004 landed, and no page ever read it. Every surface disclosed the ACCOUNTS half only (splitByCurrency's `others`, computed by the caller before worth() was reached), so a €200 000 flat and a €100 000 bond vanished from the Dashboard, Savings and Report net-worth tiles with nothing said — the silent exclusion currency.js forbids, on the one figure that claims to be the whole picture. A net because the figure it sits beside is a net worth and "held" in the disclosure sentence means "in the household's position", not "in a bank"; a household whose euro flat exactly matches its euro bond does not print "€ 0" beside a rand total. Fixed insertion order so two pages listing the same household print the symbols in the same order.
**Pinned by:** —

## health-data.js

### health-data.js — purpose  (`health-data.js` → `registerHealthData`)
**Decision:** The Financial-health inputs are assembled once, here, and both the Dashboard's health card and the Score page read that one snapshot; the arithmetic lives in health-math.js.
**Why:** The two surfaces ask the same five questions of the same six periods, and assembling that twice is how the figure on the card and the figure behind the breakdown drift the moment one copy learns something the other did not. Registered on ctx like trend-math.js rather than exported as a plain function, because every input is reached through a ctx helper (periodSpend, periodSummary, accountIndex, budgetTotals) and re-deriving those would be the same duplication one level down. Pure of the DOM but not of ctx: health-math.js IS pure and is where the rules live; this module only gathers.
**Pinned by:** —

### Pass-through pairing: excluded rows that cancel each other  (`health-data.js` → `passthroughPairs`, now in `ledger.js`)
**Decision:** An excluded row is dropped from household spending only when an equal and opposite excluded row sits in a DIFFERENT account within the same period; every other excluded row counts as spending.
**Why:** `excluded` is overloaded: a reader uses it both for the second leg of money already counted once (settling a credit card, moving between own accounts, a reimbursement passing through) and for a bill that genuinely left the household but sits outside the budget for some unrelated reason. Treating every excluded row as spending double-counted a real vault by R10 453 a month and told it it had 2.2 months of emergency cover instead of 2.7; treating none of them as spending threw away real reimbursed bills, and a guard test pins that case. Same account never pairs: on a real vault the credit card holds both the R11 514.04 purchase and the R11 514.00 that later settles it — two different events, and the purchase is real spending that must survive; its partner is the R11 514.00 leaving the savings account, where the money actually came from. `label` (the transactions folder a row was read from) identifies the account without needing the account object, and two legs of one movement always sit in different ones. rowKey and passthroughPairs moved verbatim to src/ledger.js in Phase 2 of ADR-0006.
**Pinned by:** — (the comment names "a guard test" without a file)

### The pairing window is the period, not three days  (`health-data.js` → `passthroughPairs`, now in `ledger.js`)
**Decision:** Two legs pair anywhere within the period's rows handed in; there is no day window and no description-agreement test.
**Why:** The window used to be three days, and that number decided real figures: a household whose bank settled a card in four days counted the same rand twice in its spending and read a lower emergency cover than the identical household on an instant transfer — two people doing the same thing got different answers because of their bank. Every caller already hands one period's rows, so the period IS the window. Checked against a real vault before widening: it finds one more genuine pair (a plumber paid on a card on the 21st, reimbursed from the transaction account on the 29th — 22 days, invisible to a three-day rule) and no false ones. Description agreement was tried as a stricter test and rejected on the same data: it threw away four real pairs, because the two sides of one movement are written by two different banks ("Discovery Bank account...6397" against "Notice savings account payout", "VITALITY TRAVEL" against "CAPITEC D COLENBRANDER"). Equal and opposite, in two different accounts, once each, is the signal that holds.
**Pinned by:** —

### Household walks read household-currency rows only  (`health-data.js` → `healthSnapshot`)
**Decision:** Every per-period walk in the snapshot reads `homeRows(p)` — `txInPeriod(p)` with the folders in `foreignLabels()` removed — and the foreign set is resolved once per snapshot, not per period.
**Why:** ISSUE 28, second pass. Every household walk feeds a RATIO, and until this line each read `txInPeriod(p)` raw, so a vault with one rupiah holiday account divided rand by rupiah in every one of them, while the block at the foot of the function narrowed only the ACCOUNTS and the page printed "1 account in another currency (Rp) is not in these figures" beside figures that very much included it. Measured on the fixture in tests/score-currency-isolation.test.cjs: cover 3.5 months → 0.003, saving rate 11.1% → 0.02%, the score 69 → 22. A wrong total at least looks like a number; a wrong percentage looks like a measurement. `foreignLabels()` (src/period.js) is the SAME predicate summaryInRange already filters by — a Map of transaction-folder label to symbol for every folder whose account states a currency that is not the household's — so the Dashboard's period summary and this snapshot cannot disagree about which rows are household money. Resolved once because it is a property of the accounts and the six periods cannot disagree about it. What is held out is not dropped silently: the excluded folders belong to exactly the accounts `splitByCurrency` hands back as `scoreOthers`, so the page's disclosure names precisely what the walks left out; currency.js:14 forbids the alternative.
**Pinned by:** tests/score-currency-isolation.test.cjs

### The savings pool: savings and investment accounts, household currency only  (`health-data.js` → `healthSnapshot`)
**Decision:** `savers` is `poolAccounts(S.accounts)` (savings AND investment types, type case-folded and trimmed) with foreign-currency accounts removed, so the pool boundary equals the row set the pairing sees.
**Why:** Contributions into savings and investment accounts both count as saving — the rate measures money the household kept, not which wrapper it kept it in; splitFlows already knows a contribution from growth and from a split parent, so no raw-row reading happens here. The type is case-folded and trimmed against the account's own type rather than compared raw — the trap views/savings.js's `typeIs` and worth.js:122-141 name: load.js only defaults `type` when the key is ABSENT, so `type: Savings` or `type: ' savings '` reached here exactly as written and dropped straight out of the saving-rate pillar while worth() still counted the same balance toward net worth on the same score. Household currency only, matching homeRows: with the pool boundary drawn wider than the row set, a foreign savings account sat in saverLabels while none of its rows were present, so a transfer OUT of a euro savings account INTO a rand one lost its outflow leg and counted as fresh saving from outside the pool. Both sides of the pairing now see the same accounts.
**Pinned by:** —

### Pool rows are household rows filtered by label  (`health-data.js` → `healthSnapshot`)
**Decision:** The saving-rate walk reads the household rows filtered to the pool through `saverLabels` (transaction label → pool account), never accountIndex's per-account row lists.
**Why:** accountIndex's lists hold the raw file rows, which carry no `label`, so a key built from one could never match a key built from a household row and the pass-through check silently did nothing at all. Same rows either way; this is the shape that can be compared. Pass-throughs are found across the WHOLE HOUSEHOLD, not just the pool (the R40 000 UIF landed in a savings account but its matching leg left a cheque account), and gathered across the whole pool before anything is counted, because an internal transfer is only recognisable from both of its legs at once.
**Pinned by:** —

### Three spend slices per period, and one of them budget-scoped  (`health-data.js` → `healthSnapshot`)
**Decision:** Each period carries `essential` (what must be paid with no income — the emergency divisor), `consumption` (what living cost: everything except money moved into the household's own funds) and `fixed` (what cannot be stopped this month), all household-wide; plus `consumptionBudget = budgetUsed(p).spent`, budget-scoped and used for exactly one thing, "budget used".
**Why:** Without consumption distinct from spend, funding an investment reads as overspending. "Budget used" compares what was spent against THE PLAN, and a plan is budget-scoped by definition — a household-wide numerator against a budget-only denominator would be the same mixing the household walk exists to end. Under ADR-0005 `consumptionBudget` is the SAME numerator the Dashboard hero prints, so the ring's six-period average is an average of a figure the reader has already seen; it used to sum periodSpend()'s NET map with savings types dropped (refunds netted, uncategorised gone) and so differed from the hero even over a single counted period.
**Pinned by:** —

### The household walk is the HOUSEHOLD lens: every account, net then flip  (`health-data.js` → `healthSnapshot`)
**Decision:** The per-period household figures are `tally(ledger(start, end), LENSES.HOUSEHOLD)`: foreign and transfer rows dropped, pass-through pairs dropped, excluded and non-budget rows KEPT, net per category then flipped to positive spend.
**Why:** `essential` answers "what must the HOUSEHOLD keep paying with no income", and periodSpend deliberately drops `excluded` rows and `budget: false` accounts — the right rule for a BUDGET total, the wrong one here: rent paid from a joint account the household marked out of the budget is still a bill the fund has to cover the month income stops. The numerator already reads every account (resolveEarmarks walks S.accounts unfiltered), so a divisor built from the narrower budget-only set is the "two figures derived by different rules" shape this app keeps tripping on — proven on a real vault as R48,000 of real essential spend measured against an R8,000 divisor, "6 months covered" where the truth was 2. Net first, THEN drop income-typed and net-positive categories (a refund month nets a category positive and must not invert into essential spend), then flip the negative remainder to positive rand — the shape essentialTotal expects; transfers drop out before the net is built. Before Phase 2 of ADR-0006 this reproduced periodSpend's own `spendOf` (trend-math.js) rather than reusing it, because periodSpend could not be called without also pulling in the budget-scoped filter the fix exists to bypass; the HOUSEHOLD lens in src/ledger.js is now the one definition.
**Pinned by:** tests/ledger-lenses.test.cjs

### A period counts if the household did anything in it  (`health-data.js` → `healthSnapshot`)
**Decision:** `counted` is true when the budget-scoped `periodSpend` saw rows OR the household net map (`householdNet`, taken before the income/transfer drop and the sign flip) is non-empty.
**Why:** Household coverage, not budget coverage: a period whose only real activity sat in an excluded or non-budget account is still a period that happened, and dropping it from the trailing average would silently understate the very essential figure the household-wide walk exists to correct. Read off `householdNet` rather than `householdSpend` because a period that held only income transactions is still a real period too.
**Pinned by:** —

### Net worth and earmarks are measured on household-currency accounts, and the rest is named  (`health-data.js` → `healthSnapshot`)
**Decision:** The accounts are split by `splitByCurrency(impliedAccounts(), S.settings.currency)`; earmarks and net worth read `primary`, and `others` is returned as `otherCurrencies` for the page to name.
**Why:** ISSUE 28 (2026-08-29 audit). Every figure this snapshot feeds the score is a RATIO, and a ratio is the one shape where mixing currencies does more than overstate a total — it inverts the verdict. Measured on a two-currency vault: a rand emergency fund over a rupiah-polluted essential-spend average printed "0.0 months" in red where the true reading was 6.7 months in green, and the overall score fell 26 points. So the pool is narrowed to the household's own currency before any of it is divided, and what that leaves out is counted and named on the page — currency.js:14 forbids excluding an account silently, and "left out of a score" is an exclusion however good the reason. `impliedAccounts()` carries ISSUE 44's one as-of across every net worth. `otherCurrencies` is ACCOUNTS ONLY, and that is what it is for: `homeRows` narrows every period walk by account, so this names what is missing from the RATIOS; every consumer that states a NET WORTH wants `worthOtherCurrencies` instead.
**Pinned by:** tests/score-currency-isolation.test.cjs

### Debt instalments: null when nothing states a payment, foreign debts held out  (`health-data.js` → `healthSnapshot`)
**Decision:** `debtInstalments` is the sum of `payment` over active household-currency debts whose payment is above 0, or null when none states one.
**Why:** The Debts table reads a blank `Payment` cell as 0 (table-schema.js's money() reader), so a household that listed its debts and left that column empty produced instalments of 0 — full marks, indistinguishable from a household with no repayments at all. A stated 0 is treated the same as a blank deliberately: a debt you repay nothing on states no commitment either way. Some payments known and others blank still totals what IS known rather than refusing to answer: understating a burden is the safe direction, and a partial figure moves the score toward the truth where null leaves it untouched. Null, not zero, when the Debt page does not exist: a vault that has never listed a debt has not declared it has none, and full marks for an unanswered question is the one thing this must not hand out. Foreign debts are held out the same way debtInterestMonthly and worth() already hold them out: a €900 monthly repayment is not R900 of commitment, and instalmentShare divides this straight by rand income — on a two-currency book the score read a household as spending a quarter more of its income on debt than it does, against a Debt page six inches away still printing the rand-only total. This is a second figure off the same ledger, so it takes the same filter rather than trusting the other one.
**Pinned by:** —

### The Score's net worth is the household figure, and discloses every ledger it left out  (`health-data.js` → `healthSnapshot`)
**Decision:** `worth()` is called once on the household-currency accounts with debts, assets and receivables and kept whole as `netWorthFull`; `metrics.netWorth` is its `.net`, and `worthOtherCurrencies` is `otherCurrencyNet(netWorthFull, scoreOthers)`.
**Why:** ISSUE 39: receivables are passed so the score's net worth is the same figure the Dashboard tile and the report print; the score divides it by income (netWorthMultiple), so a ledger missing from it is a wrong RATIO, not just a wrong total. ISSUE 56/57: the Score printed "1 account in another currency (EUR) is not in these figures", naming EUR 500, beside a net worth that had also silently dropped a EUR 200 000 flat, a EUR 100 000 loan and EUR 500 lent out — 0.17% of what it excluded, on a figure the score divides by income. The Dashboard, the Savings page and the Report were all moved onto otherCurrencyNet when ISSUE 30 found exactly this; the Score and the exported report were the two surfaces that never were. `netWorthFull` is kept whole rather than reduced to `.net` on the spot because the disclosure is built out of the very ledgers it held out (the same reason views/savings.js reads it high in its own function).
**Pinned by:** —

### debtsRecorded reads the currency-filtered debts  (`health-data.js` → `healthSnapshot`)
**Decision:** `debtsRecorded` is true only when at least one active household-currency debt exists.
**Why:** It says whether the debt pillar rests on anything the household actually wrote; false means the pillar's full marks are an ASSUMPTION (see the five-pillars entry under health-math.js) and the surfaces say so rather than letting a reader believe the vault checked. It reads the currency-filtered `active` deliberately: a household whose only debt is a euro bond has written one down, but not one this score can measure — every figure the pillar reads is the rand book — so full marks there ARE an assumption, and saying otherwise would be the pillar quietly claiming a check it did not perform.
**Pinned by:** —

## health-math.js

### health-math.js — purpose  (`health-math.js` → module)
**Decision:** health-math.js is pure arithmetic — no DOM, no `require('obsidian')`, every figure that depends on "when" arrives as an input — and everything is normalised to MONTHLY scale (`DAYS_PER_MONTH = 30.44`) before any ratio is taken.
**Why:** The view assembles the per-period raw material (income, essential spend, contributions) from the ctx helpers that already exist — periodSpend, periodSummary, splitFlows — and this module only does arithmetic on it, so a guard test can drive every branch from bare node. A vault on a 14-day pay cycle measures its periods in fortnights, and "3.1 periods of cover" is not a sentence anyone plans an emergency around, while "6 months" is how every reader already thinks. 30.44 is the mean Gregorian month, the same constant trend-math.js uses to turn months into periods, so the two modules cannot disagree about how long a month is.
**Pinned by:** —

### Non-essential category types  (`health-math.js` → `NON_ESSENTIAL_TYPES`)
**Decision:** The category types that fall OUT of essential spending are owned by vocabulary.js (Phase 1 of ADR-0006) and re-exported here because settings-tab.js reads them from here.
**Why:** The emergency question is what the household must keep paying with no income, and by then the luxuries are cut, the giving pauses and nobody is contributing to savings — counting those inflates the divisor and understates the cover the fund really gives. Income and transfer never reach this filter (periodSpend drops them upstream), but they are listed anyway so a caller with a different upstream cannot quietly count a transfer as an essential bill.
**Pinned by:** —

### Earmarks are capped at what the account holds  (`health-math.js` → `resolveEarmarks`)
**Decision:** `emergency_fund: true` earmarks the whole balance; a number earmarks the lesser of that number and the balance; every capped account is returned on `over`; `any` is reported separately from `total`.
**Why:** A claim of R50,000 on a balance of R30,000 is R30,000 of real cover, and reporting the claim would inflate the one figure this card exists to keep honest. The claim itself is not corrected or rewritten — the app argues, it does not correct — so each capped account comes back on `over` for the view to say so out loud. `any` and `total` answer different questions: an earmarked account holding nothing is a fund at zero (show 0.0 months), while NO earmark anywhere means the reader has never been asked (show the setup hint, and keep the fund out of the score entirely).
**Pinned by:** —

### Monthly debt interest is null when debts are listed but no rate is stated  (`health-math.js` → `debtInterestMonthly`)
**Decision:** With active debts and not one stated rate, the figure is null — not zero; some rates known and others blank still totals what IS known; an empty book returns 0.
**Why:** This is the same null-vs-zero rule health-data.js applies to `payment`, and it was missing here for exactly as long: table-schema's money() reader turns a blank `Rate` cell into 0, monthlyRate(0) is 0, and a *measured* zero scored full marks on the debt pillar for a household carrying R250 000. Understating a burden is the safe direction, and a partial figure moves the score toward the truth where null leaves it untouched. An empty book stays 0 — no debts really is no interest, and that is a claim about the household, not a gap in it.
**Pinned by:** tests/degenerate-vaults.test.cjs (NC2 negative control — see the next-but-one entry)

### Foreign debts are held out of the interest bill  (`health-math.js` → `ratedDebtSlice`, `debtInterestMonthly`)
**Decision:** `household` is an OPTIONAL currency symbol; absent means add every debt; supplied, debts in another currency are removed BEFORE the all-blank-rates test.
**Why:** ISSUE 28/30. `household` is the same optional symbol worth() and owedSummary() already take, with the same contract: absent is how this function always behaved and is right for a vault whose Debts.md states no currency — all of them until someone sets one. Supplied, foreign debts are held out because this figure is a rand bill and a euro mortgage's interest is not one. It had to be: worth(), eight lines below this function's own call site in health-data.js, already filtered them (worth.js's `fromDebts`), and so did views/debts.js's KPI — so a household that recorded a euro bond saw the Debt page print R333,33 a month while the Score's debt pillar divided R1 000,00 by the same income, moving interestShare from 0.83% to 2.5% off a liability net worth had already declined to count. Three readers of one ledger, two rules — the repository's most-repeated bug shape, and the third occurrence on this exact figure. Held out before the all-blank-rates test so a book of one rand debt with no rate and one euro debt with a rate still returns null rather than reporting the foreign rate as the household's whole interest bill.
**Pinned by:** —

### One derivation of monthly interest, and one slice it is derived from  (`health-math.js` → `ratedDebtSlice`, `debtInterestMonthly`, `debtInterestCoverage`)
**Decision:** `debtInterestMonthly()` is THE derivation; every consumer of "what does this month's interest cost" reads it (or `debtInterestCoverage().monthly`, a wrapper over it), never its own reduce; `ratedDebtSlice()` is the one place "which debts" and "which of them state a rate" is answered.
**Why:** On 2026-09-02 a household with a R900 000 bond and R164 000 of car finance, both with a blank Rate cell, got TWO answers off one ledger: this function said null (rates unknown), while views/debts.js's "Interest this month" tile and views/report.js's debtsSummary() each re-spelled the aggregate inline — `list.reduce((s, d) => s + monthlyInterest(d.balance, d.rate), 0)` — and printed R0,00. Not slightly wrong: the opposite claim to the score, on the two surfaces a person actually reads, one of them the document that leaves the app. "Two figures derived by different rules" is the repository's most-repeated bug shape and "unprovable is not disproved" is its standing rule against exactly this. The slice is counted over the same narrowed `active` list the total is summed from, so a caption and the figure it captions cannot describe different books. Two callers recompute the slice rather than sharing one call: over a household's handful of debts that costs nothing, and threading the slice through a second parameter is the coupling that lets a caller pass a list the figure was not derived from.
**Pinned by:** —

### The null guard line is a negative-control fixture  (`health-math.js` → `debtInterestMonthly`)
**Decision:** The line `if (active.length && !stated.length) { return null; }` must keep exactly that spelling.
**Why:** tests/degenerate-vaults.test.cjs's NC2 negative control deletes it from a COPY of the file by literal text match and asserts the result goes red — the proof that this guard is what produces the null rather than something else in the chain. Re-spelling it (a ternary, an early object return) leaves the guard working and the proof of it silently unrun, which is the one failure mode a negative control exists to rule out.
**Pinned by:** tests/degenerate-vaults.test.cjs

### Interest coverage is disclosed, and a zero rate counts as unknown  (`health-math.js` → `debtInterestCoverage`)
**Decision:** `debtInterestCoverage()` returns `monthly` (debtInterestMonthly's own return) with `shown` (debts stating a rate above zero), `total` (active debts) and `missing`.
**Why:** The three counts exist so a caller can DISCLOSE the coverage rather than silently deciding for the reader what a partial figure means: a tile printing the interest on one of three debts with no word about the other two is a smaller version of the same false claim — the number is right and what it covers is not stated. `monthly` is never a second reduce, so the caption and the figure cannot come apart. `shown` counts rates ABOVE zero, matching the `stated` predicate the null-vs-zero rule uses: a Rate cell of 0 and a blank one are indistinguishable after table-schema's money() reader, so an interest-free store account counts as uncovered — the conservative direction, and the only one the data supports.
**Pinned by:** —

### Trailing averages skip uncovered periods and return null when nothing was counted  (`health-math.js` → `monthlyAverages`)
**Decision:** Periods with `counted: false` are excluded from every average; when no period was counted every average is null, not 0; results are divided by `monthsPerPeriod` to restate them monthly.
**Why:** A period with `counted: false` held no transactions at all — a window the vault does not cover, not a month of spending nothing — and averaging it in would halve every figure for a vault whose history starts mid-window (the same rule compareTotals applies, for the same reason). Nulls rather than zeroes when NOTHING was counted: a brand-new vault has no history to average, and 0 would read as "this household earns and spends nothing", a claim the data never made.
**Pinned by:** —

### Budgeted spend averages over planned periods only  (`health-math.js` → `monthlyAverages`)
**Decision:** `budgeted` — and the consumption figure paired against it — average over the periods that carried a plan (`budgeted > 0`), not over every counted period.
**Why:** Averaging budgeted spend the same way as income or essential punished a household that only started budgeting partway through the six-period window: six periods with a real R22,000 plan in the last two divided that total by six instead of two, "budget used" read 273% for a household that was 9% UNDER budget, and the figure moved further from the truth the longer its budgeting history ran. A period with no budget at all is not a period budgeted zero, for exactly the reason an uncovered period is not a month spent nothing — this completes that rule rather than inventing a new one.
**Pinned by:** —

### Budget used pairs consumptionBudget with budgeted over the same window  (`health-math.js` → `monthlyAverages`)
**Decision:** The numerator for budget used is `consumptionBudget` (falling back to `consumption` for a caller passing the old shape), summed over planned periods only and returned as `consumptionForBudget` — a different figure from `consumption`.
**Why:** "Budget used" asks how the spending compared to THE PLAN, and the plan only ever covered budget-scoped rows, so measuring a household-wide numerator against it would report a household spending far more of its budget than it agreed to simply because some of that spending was never in the budget. Every other share health-data reports is household-wide; this one is deliberately not, and takes its own field so the difference is impossible to miss. `consumptionForBudget` is NOT `out.consumption` — that is the six-period trailing average the consumption PILLAR scores against income; this one is paired to the same narrower window as `budgeted` so budgetUsed compares consumption and its own plan over identical periods, the way monthlyAverages promises for every other pair.
**Pinned by:** —

### Five pillars, a debt-free household earns the debt pillar, weights are one literal  (`health-math.js` → `PILLARS`)
**Decision:** The score is five weighted pillars — reserves 25 (cover), saving 20 (rate), debt 20 (interest 12, instalments 8), spending 20 (fixed 8, consumption 7, budget 5), wealth 15 (networth) — and a household with no debts keeps the debt pillar at full marks, with `debtsRecorded` reported so the surfaces say it is assumed.
**Why:** The first version weighted three measures directly; adding what a household actually turns on (what it owns, what fixed obligations eat, whether it kept to its budget) at eight equal-ish weights would have diluted every one — funding an empty emergency account barely moves the number, and "fix this first" degenerates into eight near-ties. Grouping fixes that: each pillar keeps a weight worth caring about and the measures inside share it, so `debt` is worth 20 whether the vault can see one aspect of it or both. An empty Debt page has two defensible readings — "unanswered" (drop the pillar; no credit for being debt-free) or "debt-free" (rewards them; flatters anyone whose debts are unrecorded) — and the second is chosen because the vault is the source of truth everywhere else and refusing to credit the one thing many households have achieved reads as the score being broken. The app argues; it does not assume in silence. Weights are a judgement, not a derivation, kept in one literal so they can be argued with: reserves leads because running out of money is the failure that ends households; wealth trails because it is the slowest to move and the least actionable this month.
**Pinned by:** —

### A score needs half its weight live  (`health-math.js` → `MIN_LIVE_WEIGHT`, `financialScore`)
**Decision:** `financialScore` returns null unless the pillars that can be measured carry at least `TOTAL_WEIGHT / 2`; the bar is derived from PILLARS, never typed.
**Why:** Renormalising over the live pillars is right when one genuinely does not apply (no debts should not carry a silent zero) and wrong when the pillar is dark because something is MISSING — and the two look identical from inside financialScore. Four of the five pillars are income-gated, so a household with no income has only `reserves` left, and a big pot against a small essential spend is full marks on it: the same household with the same R500 000 pot and the same R14 000 rent scored 70 while earning R40 000 a month and 100 while earning nothing. Losing your income raised your score. Rather than special-case income, the live pillars must carry half the weight: no income leaves 25 of 100 live and returns null; no debt leaves 80 and scores exactly as before. Derived so re-weighting the pillars cannot silently move the bar.
**Pinned by:** —

### Where each measure earns full marks  (`health-math.js` → `FULL_MARKS`)
**Decision:** savingsRate 0.20; interestShare full at 0, nothing at 0.10; instalmentShare full at 0, nothing at 0.35; fixed full at or below 0.35 of income, nothing at 0.60; consumption full at or below 0.70, nothing at 1.00; budget full at 1.00 of plan, nothing at 1.20; netWorthMultiple 3× annual income.
**Why:** Every threshold is a documented convention, not a derivation, kept together where a reader can disagree with them. 20% of income is the long-standing planners' savings benchmark. Nothing to interest is the goal; a tenth of income going to it is a debt problem whatever else is true. 35% of income in repayments is the classic lending ceiling — past it, lenders themselves stop saying yes. 35% fixed is comfortable; 60% is a household one lost invoice from trouble. Living costs under 70% leave room to save AND absorb a shock; at 100% every rand is already spent. Spending your budget is full marks — a budget is a plan, not a target to undercut — and 20% over it is where the plan stopped describing the household. Three times annual income is a strong net-worth position; zero or negative earns nothing, and this is where a house lands: bond and property arrive together, so the pillar moves as the bond is paid down rather than jumping on the day of purchase.
**Pinned by:** —

### Two rounds of renormalisation  (`health-math.js` → `financialScore`)
**Decision:** Within a pillar the measures that are not null share the pillar's weight; across pillars, those with anything to say share the whole 100; null when the live weight is under `MIN_LIVE_WEIGHT`.
**Why:** A vault with no debts is scored out of 100 on the four pillars it can answer rather than carrying a silent zero for the one it cannot — absence of a claim has never been a claim of nothing. A score resting on one pillar out of five is as much an invention as one resting on none, so it returns null rather than a fabrication.
**Pinned by:** —

### Ratios only where their denominator exists, and consumption is not total spend  (`health-math.js` → `healthMetrics`)
**Decision:** Every "share of income" is null without a positive income; `consumption` is passed in separately from spend and excludes what was saved or invested.
**Why:** An income of nothing (or no history at all) makes "percent of income" a division by zero wearing a percent sign, so those come back null and the card shows a dash with a reason. Moving money into a savings account leaves the cheque account as an ordinary debit, so a household saving a fifth of its income reads as spending 110% of it: measured that way one vault reported R55,744 going out against R50,435 coming in — "living beyond its means" when its real crime was funding its own investments. Consumption is what living actually cost.
**Pinned by:** —

### Budget used is gated on income like every sibling measure  (`health-math.js` → `healthMetrics`)
**Decision:** `budgetUsed` is null unless there is income, a positive averaged budget and a `consumptionForBudget`; it is otherwise `consumptionForBudget / budgeted`, the one ratio not taken against income.
**Why:** Budget adherence is spend against the household's own plan, null when nothing was budgeted because dividing by an absent plan measures the absence, not the household. The income gate is NOT because the ratio needs income — it does not — but because this was the one measure that survived a vault with no recognised income, and the outer renormalisation then handed it the whole 100: a household with a typo'd income category, R20 000 overdrawn and no savings scored 100 and was told it was "Strong", off a single 5-point measure. A score built on one surviving part is not a summary of anything, and this was the part that let it happen.
**Pinned by:** —

### The breakdown is derived from the score, and each gap is a different quantity  (`health-math.js` → `scoreBreakdown`)
**Decision:** Points per pillar are renormalised exactly as financialScore renormalises; `gap` is per-pillar money to add to a fund, per month to redirect, or per month going nowhere, and null at full marks.
**Why:** A popup whose parts sum to 67 beside a headline of 67 is the whole reason this is derived from the score rather than re-weighted here. `gap` is the one concrete number a reader can act on, and the actions differ per pillar. Null when a pillar is already at full marks: there is nothing to close, and printing "add R0" reads as a broken sentence.
**Pinned by:** —

### Income-relative gaps refuse to answer without income  (`health-math.js` → `scoreBreakdown`)
**Decision:** The `trim`, `monthly` and `build` gaps return null when `m.monthlyIncome` is falsy; `reserves` is exempt.
**Why:** All three name a rand figure AS A SHARE OF INCOME — belt and suspenders alongside the pillars' own hasIncome gates upstream (every measure behind saving/spending/wealth already comes back null without income, which keeps this branch unreached today) rather than trusting that chain to hold forever. Without it, `m.monthlyIncome || 0` quietly turned "no income" into a target of R0 and reported the household's entire living cost as the amount to trim off nothing. `reserves` is earmarks over ESSENTIAL SPEND, never an income-relative question. For spending, the honest single figure is what living costs must come down by to clear the consumption ceiling — the one a reader can act on this month without renegotiating a contract.
**Pinned by:** —

### The popup's integers are allocated so they add up  (`health-math.js` → `scoreBreakdown`)
**Decision:** `shownMax` is largest-remainder allocated over the pillars' maxima to 100 first; `shownPoints` is then allocated over `at * shownMax[i]` to the headline score; `shownLost` is the difference of the two rounded figures, never rounded itself.
**Why:** The exact figures already sum correctly but rounding each alone does not: an earlier build printed 0 + 26 + 17 beside a headline of 42. Largest-remainder is the same allocation the donut's percentage column uses, shared from share-percents.js. Two independent allocations could round one pillar's ceiling down while rounding that SAME pillar's points up, and did: an ordinary vault with no `emergency_fund` set anywhere printed "saving 27 of 26, lost -1" — a pillar earning more than its own maximum. `at * shownMax[i]` can never exceed shownMax[i] (at is capped at 1), so its floor is at most shownMax[i] and largestRemainder's +1 step can bring it to shownMax[i] exactly but never past it; deriving `shownLost` means "26 of 40" and "costing you 14" cannot disagree.
**Pinned by:** —

### Allocate in declaration order, then sort by shortfall  (`health-math.js` → `scoreBreakdown`)
**Decision:** Both largest-remainder allocations run over PILLARS' own declaration order; the sort for display (biggest shortfall first, ties to the heavier pillar) happens AFTER them.
**Why:** largestRemainder breaks a tied remainder by ORIGINAL INDEX (deliberately, per share-percents.js), so allocating after the sort let the rounding point land on whichever pillar the shortfall order put first that day — the same four live pillars allocated {saving 27, debt 27, spending 26} in one order and {saving 26, debt 27, spending 27} in the reverse. The popup leads with what is costing the most, not with whichever pillar is declared first; ties break on the heavier pillar because closing the one with more weight behind it moves the score further per rand.
**Pinned by:** —

## savings-math.js

### savings-math.js — purpose  (`savings-math.js` → module)
**Decision:** The split of a savings or investment balance into opening, contributions, growth and withdrawals is DERIVED from the account's own transactions, never recorded a second time by hand; contributions have no category of their own; the module is pure and `typeOf` is injected.
**Why:** Every provider statement reports Opening + Contributions + Growth − Withdrawals = Closing, and the app used to report `balance − total_invested` and call it growth. Those are only the same number while `total_invested` keeps pace with every contribution, and nothing makes it: a monthly debit order moves the balance and leaves the baseline, so the difference grows by the contribution and is presented as performance. Measured against four real accounts it was wrong on all four — most starkly on a tax-free account where contributions outweighed real growth by roughly twenty to one. A transfer into a fund already exists in the vault, dated and named; asking the reader to also type it into a `## Contributions` table would create a fourth hand-maintained ledger, and hand-maintained ledgers in this app die within three weeks (see docs/adr/0003). Contributions wear the budget category they came FROM — in one real vault "Baby fund Jan" is uncategorised, "Emergency savings Dec" is a savings category and "Sam Jan 26 tax" is a personal one — so any rule keyed to a single contribution category would be wrong on real data.
**Pinned by:** —

### The savings classification rule: growth is a category flag, not a type or a name  (`savings-math.js` → `classifyRow`, `poolCatType`)
**Decision:** An outflow is a withdrawal; an inflow whose category carries `interest: true` is growth; every other real, non-transfer inflow is a contribution, income-typed included. (ITEM 2, 2026-08-26, replacing the earlier "any income-typed inflow is growth" rule.)
**Why:** Growth is recognised by a category FLAG, not a name: "Interest income" is one vault's English label, and a rule keyed to that string is wrong in every other language. Not the `income` type any more because that rule had one known weakness from the day it shipped: a salary, a client payment or a UIF payment landing DIRECTLY in a savings or investment account is also an income-typed inflow and was counted as growth when it is really a contribution — `type` alone cannot tell the two apart, so the household says so itself with `interest: true` in the category's frontmatter (load.js; the same additive, opt-in, defaults-false shape `fixed` uses). Every caller must inject `poolCatType` rather than `ctx.catType`, or an income-typed Interest category answers 'income' again and silently stops being growth; poolCatType folds `type === 'income' && category.interest` to the single string 'interest'. Backward compatibility is stated rather than hidden: an existing "Interest" category with the flag unset reads as an ordinary contribution until the household ticks it — a visible move, and `growthCategories` still names whatever DOES feed growth so a miscategorised row is never invisible. Silent misclassification is the failure this module exists to end.
**Pinned by:** —

### Excluded rows count; a split parent does not  (`savings-math.js` → `classifyRow`)
**Decision:** `Excluded: yes` has no bearing on whether money entered a fund account; a split PARENT is skipped by role (`supersededBySplit`, src/tx-role.js), not by its excluded flag.
**Why:** Every transaction in a fund account is typically excluded — that keeps the money out of income and spend totals, which is right, and has nothing to do with whether it entered the account; skipping them would report every fund as having received nothing, ever. A split parent's parts are in the same list carrying the same money under finer categories, so counting the parent would count the contribution twice.
**Pinned by:** —

### poolCatType is built once and shared byte-for-byte  (`savings-math.js` → `poolCatType`)
**Decision:** `poolCatType(categories, name)` takes S.categories directly and returns 'interest' for an income-typed category flagged `interest: true`, otherwise the category's ordinary type; it is the `typeOf` every caller of this module must pass.
**Why:** Taking the categories rather than an existing `ctx.catType`-style function lets it be built ONCE and shared by views/savings.js and views/accounts.js's totalReturn() call. That sharing is load-bearing: accounts.js's totalReturn() feeds the SAME goal-cell and drawer growth figure views/savings.js shows for the same account, and this repo has already shipped once from two call sites deriving "what this account earned" independently — `balance - total_invested` disagreeing by R60 000 on one real account (see accounts.js's own comment on that call). A caller that passes `ctx.catType` straight through silently reverts to the OLD rule for itself alone: every income-typed category answers 'income' again and interest registers as growth on THAT screen while the household's flag is respected everywhere else.
**Pinned by:** —

### classifyRow is the one rule, and it does not apply the date window  (`savings-math.js` → `classifyRow`)
**Decision:** `splitFlows()` and `monthlyFlows()` both classify through `classifyRow`, which returns null for a row that does not count, and the callers filter by date AFTER classifying.
**Why:** The two answer different questions — "what does this account total" and "what did it do each month" — but a row that is growth to one and a contribution to the other would put two irreconcilable figures on the same page. The order matters: a split parent excluded here is excluded whether or not it falls inside the window, which is what stops a window whose edge lands between a parent and its parts from counting the money twice. `typeOf` is expected to be pool-aware (poolCatType), so the ONLY thing that reads as growth is the string 'interest'.
**Pinned by:** —

### An account's opening balance is inferred so the identity holds  (`savings-math.js` → `accountFlows`)
**Decision:** `opening = closing − net of the rows` when transactions exist (`basis: 'derived'`); with no rows it is the stated baseline and growth is `balance − baseline` (`basis: 'stated'`); with neither, `basis: 'none'`.
**Why:** No file records the opening balance, and inferring it makes the identity hold by construction: the figures shown to a reader must add up to the balance they can see, or the page is arguing with itself. `basis` says which figure the growth came from so the view never presents a derived split and a hand-typed one as the same claim; 'stated' is the old `balance − total_invested` formula, the best available for an account the vault holds no history for (a provider-only TFSA, say).
**Pinned by:** —

### Stated baseline: starting_amount first, and a written zero is real  (`savings-math.js` → `accountFlows`, `totalReturn`)
**Decision:** The baseline is `starting_amount` when written, else `total_invested` when written, else none — tested with `typeof === 'number'`, never truthiness — in both accountFlows and totalReturn.
**Why:** accountFlows used to read `a.total_invested || a.starting_amount || 0`, which both reversed the precedence and falsy-skipped `starting_amount: 0` (an account opened empty and funded by transfer fell through to 'none', growth 0). Masked only because the sole consumer prefers totalReturn wherever the two would disagree — a new consumer would have inherited the bug. totalReturn's `stated` test had the same drift via `total_invested`: a written `total_invested: 0` is a real baseline (an account funded entirely by transfer, nothing invested up front), and the truthy test read it as absent. fmNum writes null for an absent key and a number for a written one, so `typeof` is the "was it written" test.
**Pinned by:** —

### Total return works backwards from the balance, and reports its own trust  (`savings-math.js` → `totalReturn`)
**Decision:** `growth = balance − starting_amount − contributions + withdrawals`; `basis` is 'measured' (starting_amount set), 'stated' (no starting_amount, no rows: balance − total_invested) or 'none'; `trust` is 'ok', 'history-gap' (first row more than `HISTORY_GAP_DAYS` = 45 after inception) or 'none'.
**Why:** accountFlows() answers "what did this account RECORD", and on a market-linked fund the answer is nothing — the value moves, the balance is retyped, no row is written — so the card reads "no growth recorded" on the largest holdings on the page. This answers what the account is WORTH against what was put in: anything in the balance the household did not put there is, by definition, what it earned, which catches growth no transaction records. It buys that with a dependency the derived figure does not have: `starting_amount` must be the balance AT `inception_date`, and the vault must hold the transactions from that date onward. Where the history starts well after inception, contributions are undercounted and growth OVERSTATED — silently, in the flattering direction — so the gap is measured and reported rather than left for the reader to notice.
**Pinned by:** —

### Month keys come from real dates only  (`savings-math.js` → `monthOf`)
**Decision:** `monthOf` uses `isRealIsoDate`, not the shape-only `ISO_DATE`, and returns '' for anything else so the row routes into the UNDATABLE/pending path.
**Why:** ISO_DATE is SHAPE-only ("2026-13-45 passes", per dates.js) and this key feeds a month WALK that rolls 12 to the next year's 01 and stops at the last real month reached. A row dated '2025-13-05' — the ordinary day/month-swap typo — slipped past, was bucketed under the unwalkable key '2025-13' by monthlyFlows, and was never visited by any point on the chart: not in a band, not in `undated`, just gone. `capital + posted + undated = closing` broke under fuzzing on exactly this input class (64/4000 vaults) and no other. The fix is entirely this one gate.
**Pinned by:** —

### Capital sums are windowed from inception; the first-row test is not  (`savings-math.js` → `totalReturn`)
**Decision:** Contributions and withdrawals are summed from `inception_date` onward when it is set; `all` (unwindowed) is used only for `first` and the history-gap test.
**Why:** `starting_amount` is the balance AT `inception_date`, so it ALREADY contains everything before that date. Summing the rows unwindowed added those contributions a second time, and the error ran in the UNFLATTERING direction: capital too high, growth too low, a fund that earned R200 reporting R0 — and nothing disclosed it, because the trust check only fires when history starts LATE. Reached by importing an account's full statement history into an account whose `inception_date` marks when tracking started rather than when the account opened, the ordinary way to adopt an existing account. The gap test must see the whole record to answer "when does the history actually begin"; asking the windowed rows would always answer "on or after inception" and the gap could never be seen.
**Pinned by:** —

### Annualised return is approximate and withheld under a year  (`savings-math.js` → `totalReturn`)
**Decision:** `annualisedPct` is `(balance / capitalIn)^(1/years) − 1`, only when years ≥ 1, capital is positive and the balance is positive; every caller flags it as approximate. `returnPct` exists only where `capitalIn > 0`.
**Why:** It is NOT money-weighted: a contribution made last month is treated as invested since inception, which understates the true annual rate. A correct IRR needs a dated cash flow for every contribution, and the whole reason this function exists is accounts that date nothing. Annualising four months of a fund's noise produces "+180% a year", arithmetically defensible and completely false as a description. An account with more taken out than ever put in has a zero or negative denominator, and a percentage against that is noise, not a return.
**Pinned by:** —

### Records before the opening date are named, not swallowed  (`savings-math.js` → `totalReturn`)
**Decision:** When the unwindowed first row is real and dated before `inception_date`, `trust` is 'pre-inception' with the negative gap; the figure is still shown.
**Why:** This used to pass silently as 'ok'. Rows before the stated opening mean either the date is wrong or the baseline is not the balance at it, and both make the capital/growth split a guess — named, because the figure is still the best available. Gated on `all.first` being real: the `|| today` fallback exists so an account with NO transactions still gets the history-gap flag when its inception is old, but with no records `g` is manufactured from today rather than a row, and a future `inception_date` on an account with zero transactions measured the distance to today and asserted records exist that do not.
**Pinned by:** —

### Undatable rows keep a bucket  (`savings-math.js` → `UNDATABLE`, `monthlyFlows`)
**Decision:** A row whose date cannot be placed lands under the key '' rather than being dropped.
**Why:** splitFlows counts such a row (it filters on `from`/`to`, not on shape), so discarding it here put money in the total that appears nowhere in the bands — the identity the chart's trustworthiness rests on, broken silently and in a direction nobody would think to check. `date` is stored verbatim by the loader, so an unparseable one is a hand-edit away.
**Pinned by:** —

### monthlyFlows windows exactly as splitFlows does  (`savings-math.js` → `monthlyFlows`)
**Decision:** The `from`/`to` test is the same raw string comparison splitFlows applies, character for character.
**Why:** totalReturn windows its capital sum from `inception_date`; if the month buckets did not window identically, a row one side of that line would be counted by one and not the other, and the chart would disagree with the tiles above it by exactly that row. Which it did: windowing the sum without windowing the buckets was how a non-ISO date cell put R200 in the bands that the total had already accounted for as undated growth.
**Pinned by:** —

### The growth chart carries only dated money, and the identity must hold  (`savings-math.js` → `growthSeries`)
**Decision:** `closing = capital + posted + undated = Σ balances of included accounts`; growth no transaction records is returned separately as `undated`, never spread across months; an account that cannot satisfy the identity is excluded and COUNTED.
**Why:** A fund's value moved every day for four years and the vault holds one number, today's; spreading that across months to make a smooth line would be inventing the very measurements this module exists because nobody took. The identity is what stops the chart disagreeing with the tiles beneath it, and it forces the exclusion: an account whose growth cannot be measured would put its contributions in the bar and its growth nowhere, and the identity would fail quietly. Money that counts but carries no placeable date is folded into the first point once known — the same treatment truncation gives the months it drops: a curve starting partway up is honest, money missing from it is not. Dropping it was one of the two ways the identity could fail.
**Pinned by:** —

### chartable: measured basis AND a placeable month, and the tile counts the same set  (`savings-math.js` → `chartable`)
**Decision:** An account is chartable when `basis === 'measured'` and a month can be placed from `inception_date` or the first row totalReturn counted; exported so the Growth tile counts the SAME set the chart draws.
**Why:** 'stated' accounts have no transactions at all and would draw a flat step from a date nobody wrote down. The tile used to count anything `basis !== 'none'`, which included 'stated' accounts the chart has always excluded — a vault could read "measured 2, unmeasured 0" in the tile and "1 of 2 accounts measurable" in the chart's subtitle, on the same screen, about the same two accounts.
**Pinned by:** —

### growthTotals is the one pool aggregate, and drawn-down accounts leave the rate  (`savings-math.js` → `growthTotals`)
**Decision:** Pool growth is `growthTotals(entries, typeOf, opts)` over `[{ account, rows }]`; accounts with `capitalIn <= 0` stay in `growth` and `measured` but are excluded from `rateGrowth`/`rateCapital` and counted as `negCapital`.
**Why:** Extracted out of views/savings.js's growthTile() (2026-08-29 audit, M4) rather than left as a DOM-bound closure: the Report page needs the EXACT same number, not a second guess at what "growth" and "rate of growth" mean, which is this codebase's most-repeated bug shape; any third caller gets it free. A living annuity mid-withdrawal is still measured and its growth is real money, but it is not a ratio: the same guard totalReturn puts on `returnPct`. Without it a single drawn-down account shrinks the capital the rate is measured against and inflates the headline percentage for every other account riding along. Counted rather than dropped so views/savings.js's growthTile() sub-text and src/report.js's `report.savings.negCapital` can disclose it. `growthRate()` (Phase 3 of ADR-0006) is the one division of the two figures; views/savings.js and report.js each used to divide them.
**Pinned by:** —

### An account that can be placed nowhere is excluded, not half-included  (`savings-math.js` → `growthSeries`)
**Decision:** Exclusion is decided by `chartable(a, r)` — testing the placeable month `at` alone — and an excluded account contributes nothing to `closing`, `included` or the bands.
**Why:** With no inception_date and no transaction to borrow a date from, the account used to be counted into `closing` while its baseline went nowhere, which is how a fund with R60 000 of opening capital printed a R95 000 total over bands that topped out at R35 000 and called the difference "growth carrying no date". Exactly the market-linked holding this feature exists for: `inception_date` is optional and nothing cross-validates it against `starting_amount`, so filling one and not the other is one keystroke. The guard used to read `r.baseline && !at`, testing the BASELINE for truthiness: a 'measured' account always has a non-null baseline, but a deliberate `starting_amount: 0` made it falsy, so an unplaceable zero-baseline account skipped the exclusion and was counted INCLUDED while contributing nothing to `closing` or `undated` — `closing = Σ balances of included` broke for exactly that account. The opening capital sits AT the opening date, or at the first month the account did anything, the earliest point the vault can honestly place it.
**Pinned by:** —

### The month walk reaches the last month anything happened in  (`savings-math.js` → `growthSeries`)
**Decision:** `lastMonth` is the later of today's month and the latest bucketed month.
**Why:** A row dated next month is counted by splitFlows and bucketed by monthlyFlows, but a walk that stopped at today never accumulated it into any point — the second way the identity could fail. Future dates are not hypothetical: a scheduled transfer captured in advance, or a typo in the year, and the loader stores `date` verbatim.
**Pinned by:** —

### Money cannot arrive before it leaves  (`savings-math.js` → `couldBeSameMovement`)
**Decision:** A candidate pair of legs is ordered by DIRECTION — the inflow may be dated any time on or after the outflow, or up to `BACKSTAMP_DAYS` = 3 before it — never by a symmetric window; a leg with no readable date never matches.
**Why:** A symmetric "within N days" rule was written first and rejected: tests/household-shapes.test.cjs pins, with a negative control, that the savings rate must not move with how fast a bank settles — the shipped defect was a score stepping 66 -> 76 because two legs of one transfer landed four days apart instead of three, "one number, two cliffs, both set by a bank". A window puts that cliff straight back at the far end; direction has no cliff in that axis, because settlement lag only ever pushes the ARRIVAL later. `backstamp` is the one concession and not a settlement window: two institutions occasionally value-date one movement in the opposite order, so the receiving leg can carry the earlier date, and three days covers that artefact. Beyond it, an outflow dated after the inflow it would cancel is a later, separate decision — which is exactly what a sinking-fund purchase is. Null is not a match, the same reading reconcile.js takes of an unplaceable row; `daysBetween` is this module's own, shape-gated and null-safe.
**Pinned by:** tests/household-shapes.test.cjs

### savedFromOutside is the one answer to "how much did you save"  (`savings-math.js` → `savedFromOutside`)
**Decision:** Both health-data.js (six-period average for the savings-rate pillar) and views/score.js ("Where the money went" card) call `savedFromOutside(rows, saverLabels, catType)`; the caller decides the pool through `saverLabels`, this decides what crossed into it.
**Why:** The two used to answer differently on one screen: the card read splitFlows' gross contributions and reported R4 270 for a period in which R4 270 had simply moved from a baby fund into an emergency fund; the score, applying the pool rule, said R0. Same money, same screen, same day.
**Pinned by:** —

### The outflow's category closes the mirror case, on the outflow side only  (`savings-math.js` → `savedFromOutside`)
**Decision:** `catType` is an OPTIONAL third argument; when present, an outflow under a category typed outside `INTERNAL_LEG_TYPES` cannot be the other leg of an internal move; the inflow's category is never consulted; an unknown category stays matchable.
**Why:** ISSUE 32. The directional pairing settled the common order (a deposit on the 1st, a pram on the 28th), but the mirror is indistinguishable BY DATE: a pram bought from the baby fund on the 1st and an equal deposit into the emergency fund on the 28th looks exactly like a slow transfer, and R5 000 of real saving disappeared from the score. The signal is the OUTFLOW's category: a transfer leg leaves under a transfer- or savings-typed category (the vehicle's own name), a purchase leaves under a real expense category, and a shop is not another one of your accounts. Outflow side ONLY: a first attempt applied a category rule to the INFLOW and was reverted, because a household moving R10 000 from cheque into investments categorises it `Investing` — a savings-typed category naming the DESTINATION, the ordinary way people label real new saving. The inflow's category says where money went; only the outflow's says what it was for. Absent means every outflow stays matchable, exactly as before. An unknown category is matchable too: a row under a name no category file answers to has told us nothing, and refusing to pair it would turn "unclassified" into "definitely a purchase" — the unprovable-is-not-disproved error one direction over. `income` is excluded from the internal-leg types with the rest: an outflow under an income-typed category is a refund or reversal, not a transfer leg.
**Pinned by:** —

### The category is consulted only where the dates have run out  (`savings-math.js` → `savedFromOutside` → `couldBeAnInternalLeg`)
**Decision:** Within `BACKSTAMP_DAYS` (or with an unreadable gap) any outflow can be an internal leg whatever its category; only when the legs are further apart does `looksLikeSpending` veto the pairing.
**Why:** That narrowing is what stops ISSUE 32's fix from re-opening the bug it sits next to. tests/health-data.test.cjs pins a household moving R5 000 from one savings account to another every month and labelling it `Move`, a category it has typed `expense` — an internal move mislabelled, with legs on the SAME DAY. Read on category alone the fix would refuse to pair them and credit the household R5 000 a month of saving it did not do, which is exactly the 1.23.0 overstatement the pairing was written to end; trading one direction of error for the other is not a fix. Inside the settlement window the DATES are evidence enough: two equal and opposite rows in two pool accounts within a few days are one movement whatever the household called it. Weeks apart the dates have stopped being evidence — the whole of what ISSUE 32 reports — and the label is all that is left: an expense-typed outflow says the money went to a shop.
**Pinned by:** tests/health-data.test.cjs

### Nothing is skipped on the strength of a row's own flags  (`savings-math.js` → `savedFromOutside`)
**Decision:** Every non-zero, non-split-parent row in a pool account enters the pairing as an inflow or an outflow; `excluded` and the income type are never consulted. The only test is the pool boundary.
**Why:** Two releases got it wrong in opposite directions. The old rule paired the legs of a movement household-wide and dropped both, to stop a R40 000 UIF payment counting as saving "while the same rand is not counted as income" — a premise that was never true: `income` is built from householdNet, which filters transfer-typed rows and paired pass-throughs and NOTHING ELSE, and does not look at `excluded` at all. Measured on the vault the rule was written for, August income reads R91 627 against R44 850–R57 984 in every other month: the UIF is in the base, and always was. So the honest reading is the plain one — the household received R40 000 and put it in a fund; income counts it once, saving counts it once, and the rate that month is 100% because that is what happened. A replacement rule — skip anything income-typed AND excluded — was written, tested and reverted for the same reason: it moved the error to the other side of the ratio, taking R1 402 of interest credited into savings accounts out of the numerator while income went on counting it.
**Pinned by:** —

### Saving is what crossed into the pool from outside it  (`savings-math.js` → `savedFromOutside`)
**Decision:** Count inflows into pool accounts that have no equal-and-opposite partner leaving a DIFFERENT pool account; ignore movement within the pool in both directions; read the rows directly rather than through splitFlows' buckets.
**Why:** Gross inflow and net-of-everything both shipped, and both were wrong in opposite directions. Gross contributions (to 1.23.0) counted a rand moved from one savings account to another as fresh saving in the receiving account, with nothing taken off the sending one — on a real vault that overstated the rate by R1 250 a month. Netting ALL outflows (1.23.1) fixed that and broke something worse: it treated a sinking fund doing its job as dis-saving. A household that had paid into a Baby Fund and a Car Fund for months and then bought the pram and serviced the car was told it was saving NOTHING — R12 022 a month of "Subaru maintenance", "Private room & pram" and "Baby carrier" came straight off a real R12 224 a month of saving and drove the pillar to zero. Spending a fund you built on purpose is the fund working; the STOCK going down is a different statement from the RATE going negative, and the Savings page already tells that first story. Read off the rows directly because classifyRow sorts a positive row into growth purely on its category, which is right for the growth chart and wrong here — a salary or a UIF reimbursement paid into a savings account is exactly the household putting money aside; supersededBySplit is the same split-parent guard splitFlows applies, from the same module. KNOWN LIMIT, stated rather than hidden: money paid in and spent straight back out within the window still counts in full, because nothing in the data separates "spending what I just put in" from "drawing on a fund I built last year". This is the conventional reading of a savings RATE and the one that does not punish a sinking fund; the balance story is told by the Savings page's growth chart and per-account in/out lines.
**Pinned by:** —

### The other leg is the only test, and the dates are consulted  (`savings-math.js` → `savedFromOutside`)
**Decision:** An inflow is cancelled only by an equal-and-opposite outflow (within 0.005) in a DIFFERENT pool account that `couldBeAnInternalLeg` and `couldBeSameMovement` both allow; each outflow cancels at most one inflow.
**Why:** A first attempt also skipped any inflow whose CATEGORY was savings-typed, reasoning it names the vehicle the money came out of; on one real vault it did, in general it does not, and a guard fixture caught it — a household moving R10 000 a month from its CHEQUE account into Investments categorises that `Investing`, a savings-typed category naming the DESTINATION, and the category rule threw that real new saving away, taking a genuinely strong vault out of its band. Each outflow can only cancel one inflow, so two genuine deposits are never swallowed by one withdrawal; a sinking-fund purchase has no counterpart in another account and never reduces the rate; money from a cheque account has no counterpart in the pool and counts, whatever it is called. The date was originally never consulted at all, so any equal outflow from any other pool account anywhere in the period cancelled a deposit — on a household running sinking funds the normal month, not a coincidence: 1 Aug Emergency fund +5 000 (a real deposit from cheque), 28 Aug Baby fund −5 000 (the pram), unrelated and twenty-seven days apart, and the period reported R0 saved; price the pram at R4 999 and the same month reports R5 000 — a rounding of a shop's price moving the scored savings rate by the whole deposit. couldBeSameMovement is the smallest test that separates them without re-opening the 66 -> 76 cliff tests/household-shapes.test.cjs pins. The residual the comment named — a fund purchase EARLY in the month cancelled by an equal deposit later — was subsequently closed by ISSUE 32's optional `catType` argument (previous two entries). A leg nothing can date does not match: the app does not get to assume the convenient answer about a date it cannot read.
**Pinned by:** tests/household-shapes.test.cjs

## debt-math.js

### debt-math.js — purpose  (`debt-math.js` → purpose)
**Decision:** debt-math.js is pure, iterative debt amortisation and payoff-strategy simulation — no DOM, no obsidian import, no clock read — and `rate` is the annual nominal rate as a percentage, compounded monthly.
**Why:** Pure so the numbers the Debt view shows can be driven directly from a bare-node test. Iterative rather than closed-form on purpose: the closed-form payoff formula (-ln(1 - rB/P) / ln(1+r)) silently returns NaN for the exact case that matters most to a reader in trouble — a payment at or below the monthly interest, where the balance never falls — and iterating lets that case come back as `settled: false` with a month count instead of a blank cell. `rate` is stored the way a lender quotes it and Debts.md stores it (18.5 means 18.5%); amounts are positive numbers and a balance is what is still owed.
**Pinned by:** —

### Real start date, not a date-shaped one  (`debt-math.js` → `expectedBalance`)
**Decision:** `expectedBalance` gates `d.start` on `isRealIsoDate`, not on the shape-only `ISO_DATE`.
**Why:** ISO_DATE is shape-only (dates.js:19 — "2026-13-45 passes") and expectedBalance walks `start` as real elapsed months. A shape-valid, impossible start date used to sail through and get projected as though it had actually happened, feeding views/debts.js's "schedule says … since {date}" line a fabricated figure dressed as arithmetic. It is the same trap savings-math.js's monthOf hit in 1.23.0, fixed there the same way.
**Pinned by:** —

### Attack order and tie-break  (`debt-math.js` → `priorityOrder`)
**Decision:** Avalanche targets the highest rate first (then smallest balance), snowball the smallest balance first; ties break on name and then on key; the order is recomputed every month against live balances.
**Why:** Avalanche is mathematically cheapest; snowball closes accounts soonest. Recomputing monthly lets snowball re-target as accounts close. The name-then-key tie-break makes a run reproducible even when two debts share a name, which households do have ("Credit card" twice, one per bank).
**Pinned by:** —

### Minimum is the no-rollover baseline  (`debt-math.js` → `simulate`)
**Decision:** `strategy: 'minimum'` pays contracted payments plus each debt's own standing extra, with no pooled extra and no rollover; avalanche and snowball add `extra` per month and roll a closed debt's payment into the pool.
**Why:** The rollover is the entire point of both methods and the reason their debt-free date beats the baseline even when `extra` is 0. A debt's own standing extra is money already being paid, not a what-if, so it is part of the committed payment under every strategy.
**Pinned by:** —

### Payoff keyed by key, not name  (`debt-math.js` → `simulate`)
**Decision:** `payoff` is keyed by each debt's `key` — its own if it carries one, otherwise its position in the input array — and the map runs before the settled-debt filter.
**Why:** Keying by name looks tidier and is wrong: two debts called "Credit card" would share one entry, so the second one's payoff month would overwrite the first's and both rows would show the same clear date. Mapping before filtering keeps those positions stable even when a settled debt drops out.
**Pinned by:** —

### The payoff curve is recorded in the payoff loop  (`debt-math.js` → `simulate`)
**Decision:** `series` is the total still owed at the end of each month, with `series[0]` the opening balance before a cent is paid (so months + 1 entries), and it is recorded inside the simulation loop rather than by a second pass.
**Why:** months + 1 entries plot straight against a month axis. A payoff curve drawn from its own re-implementation would be free to disagree with the payoff date printed beside it, and the reader would have no way to tell which one lied.
**Pinned by:** —

### addMonths takes an injected date and drops the day  (`debt-math.js` → `addMonths`)
**Decision:** `addMonths(n, from)` requires `from` (a Date), returns 'YYYY-MM', and has no `new Date()` default.
**Why:** A payoff month is the honest resolution; keeping the day would invent precision the model does not have. Every production caller lives in views/debts.js, which already has an injected today (its own todayIso() import), so a clock default here would have been an untested branch no guard test could ever exercise honestly — the clock-in-a-pure-module trap the module steers away from everywhere else.
**Pinned by:** —

### Expected balance projects from the fields the row already has  (`debt-math.js` → `expectedBalance`)
**Decision:** `expectedBalance` projects where a debt should be today from `original`, `rate`, `payment` + `extra` and `start`, needing no new column.
**Why:** It is the Accounts page's reconciliation argument made on the one page where a hand-typed figure goes out of date fastest, because a debt balance moves every single month. It cannot be made the same way as an account's: a debt row carries no "balance as of" date, and payments are attributed per category rather than per debt, so three debts sharing one category would each claim the full amount.
**Pinned by:** —

### Interest before each payment  (`debt-math.js` → `expectedBalance`)
**Decision:** The projection applies interest before each payment, month by month.
**Why:** A debt does not fall by the instalment; the lender adds interest between statements. Subtracting payments alone would report a debt shrinking faster than it is, which is the flattering direction and therefore the dangerous one.
**Pinned by:** —

### Missing input is null, not a guess  (`debt-math.js` → `expectedBalance`)
**Decision:** `expectedBalance` returns null when the row cannot support the projection — no start date, no original, no instalment, or a start date in the future.
**Why:** A missing answer is the honest output; a projection from guessed inputs is not. Only `d.start` needs the real-calendar check because it comes off a hand-editable file; `today` is caller-supplied and gets the shape check so the "missing input → null" contract stays symmetric.
**Pinned by:** —

### Whole months elapsed, billing day clamped  (`debt-math.js` → `expectedBalance`)
**Decision:** Elapsed months are whole months, floored on the day of the month, with the billing day clamped to a short month's last day the way `nextOnDay()` in committed.js does it.
**Why:** A difference of month indices alone counts any part-month as a full one, so a debt starting on the 31st and read on the 1st was charged a whole month of interest and credited a whole instalment for a single day; the instalment is the larger of the two, so the error ran in the flattering direction. Without the clamp an agreement running on the 31st, debited on the 28th in February, would have that month counted as incomplete and swing the error the other way, reporting a debt larger than it is.
**Pinned by:** —

### An unanchored original/start pair returns null  (`debt-math.js` → `expectedBalance`)
**Decision:** When the row carries a real `.balance` and `original - balance` exceeds `(payment + extra) × months` + 0.01, the projection returns null.
**Why:** `original` and `start` are only ever set together, by addDebt, as `original = balance` on the day the row is created; nothing in the Debt table edits either afterward. A hand edit to Debts.md recording the loan's true original amount (which the view's own comment invites) moves `original` alone, leaving `start` reading as the row's creation date, not the day that amount was actually owed. The bound is provable, not a guess: a balance can only fall by cash actually paid, and crediting every rand straight to principal (0% interest, the most generous case) still bounds the drop by payment(+extra) × months elapsed — so a larger drop proves the pair does not describe one continuous debt, and is not a material discrepancy to flag. Gating on a real `.balance` leaves the bare date/month arithmetic exercised without one untouched.
**Pinned by:** —

## load.js

### fmNum: absent or unreadable is null, never 0  (`load.js` → `fmNum`)
**Decision:** An optional numeric frontmatter key reads as null when absent or blank, as the number when normalizeAmount can read it, and as null when it cannot.
**Why:** Deliberately not parseNum: its fallback resolves an unreadable cell to 0, which for a savings goal or a credit limit is a figure the file never claimed. "I could not read this" has to stay distinguishable from "the user wrote zero", because the writers skip null and keep the line.
**Pinned by:** —

### Heading slice before parseMdTable  (`load.js` → `section`)
**Decision:** `section(body, name)` returns the chunk under one `## Heading`, lower-cased and matched by prefix, and is the one definition both Plans and Tax use.
**Why:** Plans and Tax each hold several tables in one file (a plan, or a tax year, is read as one thing) and parseMdTable reads every table row it is handed, so it would run them together into one malformed list without this cut first. It was written out twice, character for character, and a heading typo fixed in one copy would silently not be fixed in the other.
**Pinned by:** —

### fmBool is tri-state  (`load.js` → `fmBool`)
**Decision:** An optional boolean frontmatter key reads as undefined when absent, true/false when written, and undefined when unreadable.
**Why:** Collapsing absent to false would turn every account in every existing vault into an explicit opt-out on upgrade, which is precisely the silent figure change a default is supposed to avoid. Unreadable is unset rather than false, so a typo cannot quietly exclude an account.
**Pinned by:** —

### Reads in parallel, parsing serial  (`load.js` → `read`)
**Decision:** `read(files)` issues every `cachedRead` at once with Promise.all and returns each file paired with its own text; parsing stays serial and ordering is unchanged.
**Why:** Every loop used to await one file at a time — ~163 sequential round trips on a real vault, and on mobile each crosses the Capacitor bridge (an iCloud-backed file may have to be materialised first). Parsing all 5,700 transactions measures ~7ms, so the wait was almost entirely I/O latency.
**Pinned by:** —

### read() is declared where loadNotes can reach it  (`load.js` → `read`)
**Decision:** `read` is a local of `registerLoad`, not of `loadVault`.
**Why:** It lived inside loadVault until 1.16.1. Being a local there made it unreachable from loadNotes — a sibling function added later in the same file — so that loader re-invented the sequential loop the helper exists to warn about, and the notes read grew to three quarters of the whole vault load. A helper that documents a trap has to be in scope for the next person who would fall into it.
**Pinned by:** —

### loadVault is single-flight  (`load.js` → `loadVault`)
**Decision:** A load already in flight is joined, not restarted: one latch (`loadInFlight`) covers every caller.
**Why:** Six sections use the `S.x = [] … await … push()` shape, so two overlapping loads do not merely repeat work — they duplicate: run B clears the array run A is still filling, then both push, and the vault ends up with 2× categories/accounts/debts/assets/owed/services while the keyed-object sections (budgets, txFiles, plans, tax) survive. That partial corruption reads as "the maths is wrong", not "it loaded twice". Two live paths overlap: the drawer's reload link stays tappable for the whole load, and unlockGate can race a pending scheduleReload timer.
**Pinned by:** —

### Pay cycle is a length in days with an anchor  (`load.js` → `doLoadVault`)
**Decision:** `period_days` and `period_anchor` are stored only together, and only when the anchor is a real date; otherwise both are dropped and the vault runs payday months.
**Why:** The pay cycle is its own length in days, not a named type — see the header of period.js (ADR-0002). Absent means the payday month, so a vault that has never heard of the setting behaves as it always did. A cycle without an anchor has no way to place a boundary, so both are dropped rather than deriving periods from a missing date; period.js clamps the length itself. The anchor gets the same real-date test period.js gates the cycle on: a shape check accepted 2026-13-45 and stored the pair while period.js refused it and ran payday months, so the settings screen showed a cycle the app was not running.
**Pinned by:** —

### Exchange rates are opt-in and normalised to a boolean  (`load.js` → `doLoadVault`)
**Decision:** `S.settings.exchange_rates` is true only when Settings.md says `exchange_rates: on`; absent means off.
**Why:** ISSUE 30. Every vault written before the key existed keeps making zero network requests, which is the promise the README makes. Normalised here rather than left as the raw cell: `exchange_rates: yes` reads as YAML true while `exchange_rates: maybe` reads as a string, and fx.js's canConvert() deliberately refuses a truthy string — a hand-edited value must not switch money conversion on by accident.
**Pinned by:** —

### rate_refresh defaults to daily and is normalised  (`load.js` → `doLoadVault`)
**Decision:** `rate_refresh` (daily, weekly or monthly) goes through `fx.normalizeCadence`; absent resolves to daily.
**Why:** Daily is what the setting and the wizard have always described, so a vault written before the key existed keeps the behaviour its own Settings.md documents. A hand-edited `rate_refresh: hourly` falls back rather than reaching the refresh gate as an unknown.
**Pinned by:** —

### Language is independent of country  (`load.js` → `doLoadVault`)
**Decision:** `language` is its own Settings.md axis; absent means "follow Obsidian's own display language" (`defaultLanguage()`), and an unknown value falls back to English.
**Why:** See the header of i18n.js. A vault that has never heard of the setting reads in whatever language the rest of Obsidian is already in. resolveLanguage's fallback for an unknown hand-edited value is the same contract localeFor gives country.
**Pinned by:** —

### input_mode defaults to csv and is assigned unconditionally  (`load.js` → `doLoadVault`)
**Decision:** `input_mode` ('csv' or 'manual') goes through `inputMode()` in constants.js and is assigned on every load.
**Why:** Absent means 'csv', so every vault written before the key existed keeps the import affordances it has always had. inputMode() is the one normaliser the loader, the settings tab and the wizard share. Assigned unconditionally, like emergency_target_months, so a hand-deleted line falls back to the default on the next load rather than leaving the old value alive in memory.
**Pinned by:** —

### overspend_lag is clamped to 1–12  (`load.js` → `doLoadVault`)
**Decision:** `overspend_lag` — how many periods back "pull last period's overspend" reads from — goes through `overspendLag()` and is clamped to 1–12, defaulting to 1.
**Why:** 1 is the obvious answer; it is a setting because a credit card settles a month in arrears, so the hole you are funding in August is often June's, not July's. A 0 would read the period you are standing in, whose deficit is still growing, so the figure would change every time you pressed the button; a negative one would read the future.
**Pinned by:** —

### emergency_target_months is assigned unconditionally  (`load.js` → `doLoadVault`)
**Decision:** `emergency_target_months` goes through `emergencyTarget()` in constants.js and is assigned on every load, unlike `month_start_day`.
**Why:** A hand-deleted line has to fall back to the default on the next load rather than keeping the old value alive in memory. The clamp lives in constants.js because the settings tab applies the same one on the way out; emergencyTarget() there records what the bounds protect.
**Pinned by:** —

### type_stated: an absent type is not an answer  (`load.js` → `doLoadVault`)
**Decision:** A category carries `type_stated`, true only when its note wrote a `type:` key, distinct from `type` (which defaults to `expense`).
**Why:** A category note carrying only a colour is indistinguishable from one deliberately typed `expense`, and ISSUE 32's pairing rule reads "expense" as the household saying "this was a purchase, not a transfer leg". It is not; it is the loader's default. A 4-day internal shuffle labelled with an untyped `Move` category was counted as R5 000 of fresh saving — the 1.23.0 overstatement that rule exists to prevent, arriving through the door the rule opened. Same shape as `in_budget_stated` on accounts, for the same reason.
**Pinned by:** —

### assume_spent: a category whose budget is its actual spend  (`load.js` → `doLoadVault`)
**Decision:** `assumeSpent` is true only when the note says `assume_spent: true` (via fmBool, so unreadable is unset, not false); the note's path travels with the category as `rel`.
**Why:** No transaction will ever arrive for such a category because the money left in a previous period. "Previous month overspending" is the case it was written for: the hole is real, it has to be funded out of this period's income, and the bank line that dug it sits in last period's statement under some other category. Budgeting it as an ordinary row left it reading "R1 900 left" all month — the opposite of the truth. The path lets the Budget page toggle the flag without re-deriving a filename from a display name (two names can sanitise to one file — see promptCreateCategory).
**Pinned by:** —

### fixed is its own flag, not derived from type  (`load.js` → `doLoadVault`)
**Decision:** A category's `fixed` is read from its own `fixed:` key, never guessed from `type`.
**Why:** The biggest fixed cost most households have is rent, and rent is an ordinary `expense`. Deriving the set from type reported 19.9% of income committed on the vault this was built against, where the real figure including rent is 44.4%. A ratio that silently omits the largest term is worse than no ratio.
**Pinned by:** —

### interest marks income a fund itself earned  (`load.js` → `doLoadVault`)
**Decision:** A category's `interest` flag (opt-in, default false) says an `income`-typed category is what a savings/investment account itself earned — interest, dividends — rather than money the household put in.
**Why:** ITEM 2 (2026-08-26). savings-math.js's classifyRow used to treat every income-typed inflow as growth, which caught a salary, a client payment or a UIF payment landing directly in a pool account exactly as hard as real interest — nothing in `type` alone tells them apart. Same additive-flag shape as `fixed`: an existing "Interest" category with the flag unset reads as an ordinary contribution until the household ticks it, a one-time visible move (it stops appearing under "growth from…" and appears as money put in), not a silent one. savings-math.js's header carries the full rule and why it lives on the category rather than being guessed from its name.
**Pinned by:** —

### Nested account files are named, not loaded  (`load.js` → `doLoadVault`)
**Decision:** Account files below `Accounts/` (e.g. `Accounts/Closed/…`) are listed in `S.accountsIgnored` and left alone.
**Why:** ISSUE 60. mdFilesIn reads one level, and io.js's own comment defends that for Accounts/ as "flat by construction, because the plugin names the files itself" — the argument that comment then narrates as having been wrong for Notes/. The vault is user-writable markdown and filing dormant accounts into `Accounts/Closed/` is an ordinary tidy-up. Measured: `Accounts/Closed/Old Savings.md` holding R88 000 with its own transactions folder loaded nowhere, so net worth read R12 000 instead of R100 000 — while its R250 of interest did reach the period income total, because transaction folders are read by label. Reading them in is the fuller fix and is not done: every write site addresses an account as `Accounts/<name>.md`, so loading a nested file without teaching those sites its real path would have the next save create a duplicate at the top level and strand the original — a worse bug of the same class.
**Pinned by:** —

### Two accounts claiming one transaction folder  (`load.js` → `doLoadVault`)
**Decision:** Accounts whose `tx_label || name` collide under `safeSeg(...).toLowerCase()` — the key accountForLabel uses — are recorded in `S.accountsDuplicated` and named on the Accounts page.
**Why:** ISSUE 72. accountForLabel returns the first match, so the second account gets no rows, reconciles as `no-tx` forever (which reads exactly like a new account with no history) and still adds its whole stated balance to net worth. views/accounts.js guards duplicate names in addAccount and never looks at tx_label; a hand-written vault has no guard on either axis, and copying an account file is the obvious way to open a second account at the same bank.
**Pinned by:** —

### currency_code is read at load  (`load.js` → `doLoadVault`)
**Decision:** An account's `currency_code` (the ISO code its symbol means) is read through `normalizeCode`; absent is a complete answer — the account is not convertible and is stated in its own symbol.
**Why:** "$" is USD, AUD, CAD and SGD, so the symbol cannot answer a rate lookup. It was written into Settings.md and the account dialog and read by nothing for a whole release — a field the user can fill in that has no effect is the precise failure ADR-0004 was opened about, and it very nearly shipped inside the fix for it.
**Pinned by:** —

### currency_conflict is decided at load  (`load.js` → `doLoadVault`)
**Decision:** When an account's symbol claims to be the household's (absent or equal) but its `currency_code` differs from the household's code, the account carries `currency_conflict: { symbol, code, homeCode }`.
**Why:** `currency` is a display symbol and `currency_code` an ISO code for rate lookup, and nothing had ever compared them. An account written `currency: R` with `currency_code: USD` in a rand/ZAR vault was home to currency.js (symbol matches, balance added at par) and foreign to fx.js (code differs, so convertAccounts converts it). Measured: R1 000 in the Accounts split headline against R17 985,61 on the converted line — the same account, the same page, eighteen times apart. Decided here rather than inside isForeign(): that function takes a household symbol and cannot see a code, and threading a second argument through every call site is exactly how the 1.36.0 fixes reached some consumers and not others. Settings are parsed above accounts, so both halves are in scope at this one point, and the answer travels on the account the way `in_budget_stated` and `type_stated` do. Only the contradictory case is flagged: an already-foreign symbol needs no help, and a code with no symbol is the ordinary way to record a foreign account.
**Pinned by:** —

### budget: false opts an account out; absent means in  (`load.js` → `doLoadVault`)
**Decision:** `in_budget` is false only when the account says `budget: false|no|off|0`; absent means in.
**Why:** An investment or tax-free wrapper's interest is not income and its debit orders are not spending. Absent means in, so no existing vault's Dashboard figures move on upgrade. The money still leaving the cheque account is budgeted as normal; only the arriving leg here is suppressed, which is what stops it being counted twice.
**Pinned by:** —

### in_budget_stated: an absent key is not consent  (`load.js` → `doLoadVault`)
**Decision:** An account carries `in_budget_stated`, true only when its note wrote a `budget:` key.
**Why:** ISSUE 41. `in_budget` cannot tell an explicit `budget: true` from a file that never mentions it — both are true — and the earmark rule in period.js needs exactly that difference: a savings account is held out of the budget's spend totals by default, and only a household that has written `budget: true` on it has said otherwise.
**Pinned by:** —

### Account numbers go through fmNum, never parseFloat  (`load.js` → `doLoadVault`)
**Decision:** `credit_limit`, `goal_amount`, `monthly_contribution`, `total_invested`, `starting_amount` and `settle_day` are read with `fmNum`.
**Why:** Every one is hand-editable and every one is written back by saveAccount's FM_WRITERS. parseFloat reads "15,000" as 15 and "1.234,56" as 1.234, and the next edit to any field on the account would serialise that back over the user's own figure — silent destruction of a number nobody was even editing. Same reasoning as `balance` (parseNum with balanceRaw).
**Pinned by:** —

### emergency_fund is tri-state  (`load.js` → `doLoadVault`)
**Decision:** `emergency_fund` reads as true (whole balance earmarked), a positive number (that slice), or null (never asked / unreadable / not positive).
**Why:** Three different answers, so all three survive the read. health-math.js owns what each is worth (the cap at the held balance, the over-claim report); the loader only carries the claim across. Unreadable is unset rather than zero for the reason fmNum refuses parseNum's fallback: "I could not read this" must stay distinguishable from "the user earmarked nothing".
**Pinned by:** —

### The undo receipt is cleared beside the state it depends on  (`load.js` → `doLoadVault`)
**Decision:** `S.lastImport = null` runs inside loadVault, immediately after `S.txFiles = {}`.
**Why:** The receipt holds references to the row objects about to be replaced, so after that line it could only ever remove nothing — and an undo button that quietly does nothing is worse than no button. reloadFromDisk (controller.js) is loadVault's only call site today, but the reset belongs to loadVault regardless: a second caller added later must not have to remember this line too.
**Pinned by:** —

### Every Transactions/ folder is recorded  (`load.js` → `doLoadVault`)
**Decision:** `S.txFolders` lists every folder under Transactions/, whether or not it holds a month file.
**Why:** S.txFiles is keyed per month file, so a folder someone created and has not imported into yet contributes no entry and reads exactly like a folder that was never linked. Those are different situations with different next steps (import a statement vs. link a folder), and telling the second story to someone in the first sends them to re-link a folder they already have.
**Pinned by:** —

### A debt's original falls back for arithmetic only  (`load.js` → `doLoadVault`)
**Decision:** When a debt row's `original` is null it is set to the balance and `originalStated` is false; otherwise `originalStated` is true, and the writer restores an empty cell when it is false.
**Why:** The fallback is the one post() fix-up a single cell cannot express (ADR-0003): Original is null for a file written before the column existed or a debt added without one, and the "paid off" bar divides by it. ISSUE 68: assigned to `original` alone, the serializer stamped the derived figure into the Debts row on the next save (`| Bond | ABSA | home | 480000.00 | | 9.50 |` became `| … | 480000.00 | 480000.00 | …`), so the household was permanently on record as having borrowed exactly what they still owe, with the bar reading 0% forever and no way to un-say it. The schema keeps null ("not stated") apart from 0 ("stated as nothing"); `originalStated` carries that distinction across the boundary.
**Pinned by:** —

### Plans: one file per plan, sliced by heading  (`load.js` → `doLoadVault`)
**Decision:** Plans are read one file per plan in Plans/, keyed by basename, with the "Money in", "Envelopes" and "Items" tables cut out by `section()` before parseMdTable sees them.
**Why:** Same multi-file shape as Tax. The three tables live in one file because a plan is read as one thing, and parseMdTable would run them together into a single malformed list if handed the whole body. The section names are load-bearing — plan.js's serializer writes exactly these headings. Every status falls back rather than throwing (as stepStatus does for Tax) because a typo in one hand-edited cell must not cost the reader the other forty rows.
**Pinned by:** —

### Plans and Tax cells keep <key>Raw when unreadable  (`load.js` → `doLoadVault`)
**Decision:** `cellMoney` and `cellVocab` set `<key>Raw` only when a cell was present and unreadable, so a blank stays blank and "not stated" never becomes "stated as nothing"; the serializers write the raw back verbatim.
**Why:** ISSUE 59/63. This is the contract table-schema.js's money() and vocab() give every other hand-editable table, applied by hand because Plans and Tax carry private loader/serializer pairs ADR-0003's migration has not reached. Without it `normalizeAmount(v) ?? 0` turned a cell nobody could read into a real, stated 0.00 on the next save — "| Cot and pram | 12 000 R |" became "| Cot and pram | 0.00 |", and a range like "8000 - 12000" became 0.00 — the defect table-schema's own header (lines 96-102) records having fixed for Assets, Debts, Owed and Services. The status columns had the same shape one column over: `pending` was coerced to `received` and written back, flipping a plan source from "expected" to "money in hand" — the Services `weekly` incident again.
**Pinned by:** —

### Plans are keyed by basename, not display name  (`load.js` → `doLoadVault`)
**Decision:** `S.plans` is keyed by the file's basename, `file` carries it back out, and writers derive the path from `file` and never re-sanitise the name.
**Why:** The two differ on purpose: a plan can be called "Baby & catch-up" while living in a filesystem-safe file, and frontmatter is hand-editable, so two files could name themselves the same thing. The file is the identity; the name is a label. Re-sanitising the name would fork the plan into a second file on a frontmatter rename.
**Pinned by:** —

### Tax figures go through normalizeAmount  (`load.js` → `doLoadVault`)
**Decision:** Tax figure cells are read with `normalizeAmount(s) ?? 0` (via `figAmount`), coercing rather than throwing.
**Why:** Figures are written as raw numbers, but a hand-edited file may carry a currency symbol or either separator convention; coercing mirrors how stepStatus falls back instead of failing. normalizeAmount is the same reader the statement importer and every other hand-editable amount goes through; this used to be a fourth private copy of that logic, with a test that asserted against its own mirror rather than the shipped function.
**Pinned by:** —

### Assessment figures: normalizeAmount, not a digit-scraper  (`load.js` → `doLoadVault`)
**Decision:** `assessment_result` and `assessment_income` are read by `signedNum`: blank is `{ value: null, raw: null }`, unreadable keeps its text in `<key>Raw`, readable is the normalised number.
**Why:** ISSUE 52. The reader was `Number(String(v).replace(/[^\d.-]/g, ''))`, which deletes separators instead of interpreting them, on the two figures a household copies straight off an ITA34: `-1 234,56` read as -123456 (should be -1234.56), `480 000,00` as 48000000 (should be 480000), `1.250,00` as 1.25 (should be 1250). A refund of R1 234,56 was read as R123 456 and written back, and since these were numbers in memory there was no raw text to fall back to — exactly what src/amount.js exists to prevent, in the one file that never called it. The serializer writes the household's own words back rather than a fabricated 0 (views/tax.js reads the pair); a blank cell is null with no raw because nothing was said.
**Pinned by:** —

### A note that cannot be read is skipped  (`load.js` → `loadNotes`)
**Decision:** loadNotes reads every note under Notes/ (recursively, via mdFilesUnder) with a per-file catch, skipping unreadable notes; it is exposed on ctx as well as called from loadVault.
**Why:** Unlike every other file the loader reads, a note's body is content rather than a serialized table, so the excerpt comes out of it — parseNote in src/notes.js owns that and is the module the writer serializes through. Notes are hand-created and hand-edited, so one unreadable note must not take the whole budget down; that is why this cannot call `read`, whose single rejection fails the whole Promise.all. views/notes.js re-reads after every write, so what the page lists always comes from the same parse and a serializer/parser disagreement shows up on the first note rather than after the next reload. A user who files notes into Notes/2026/ has tidied a folder, not deleted it.
**Pinned by:** —

### Notes read in parallel  (`load.js` → `loadNotes`)
**Decision:** Note reads go out in one Promise.all, for the reason `read()` gives.
**Why:** This loader is the case that proves it: measured against a Ruan-shaped vault the notes read was 172ms of a 233ms load at thirty notes — three quarters of the wait at a fraction of the files — because the cost is round trips, not work (parsing measures ~5.5µs a note). Sequential, it grew without bound in the one folder the user is invited to keep adding to.
**Pinned by:** —

### An existing transaction folder wins verbatim  (`load.js` → `txSegment`)
**Decision:** `txSegment(label)` returns the on-disk folder segment when one already matches the label, and only sanitises a label that has never been written.
**Why:** S.txFiles is keyed by the folder name as it exists on disk, so a writer that re-sanitises the label can miss the lookup while the write still lands on the existing file — rebuilding that month from scratch with only the new rows. Re-sanitising an existing folder would create a second, near-identical folder and split the account in half; the existing name is self-evidently legal because the filesystem is already holding it.
**Pinned by:** —

### txSegment is case-folded  (`load.js` → `txSegment`)
**Decision:** The folder lookup compares `safeSeg(label).toLowerCase()`.
**Why:** The filesystems this plugin ships on are case-insensitive: macOS, iOS and Windows all resolve `Transactions/cheque/` and `Transactions/Cheque/` to one directory, so a `tx_label` differing only in case — hand-editable frontmatter that syncs between devices — missed the in-memory lookup while the write still landed on the existing file. Folding keeps the two sides agreeing, which is the contract vault-path.js exists to hold.
**Pinned by:** —
