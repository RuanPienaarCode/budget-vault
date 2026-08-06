# Changelog

All notable changes to Budget Vault. Versions match the plugin version in
`manifest.json` and the release tag exactly (no `v` prefix).

## 1.4.0 — 2026-08-06

### Added

- **Charts on the pages that already held the numbers.** A spend trend and a
  category-split donut on the dashboard, a net-worth stack on savings, and a
  payoff curve on debts with a range you pick once and it remembers. Drawn as
  plain inline SVG — no charting library, because one would outweigh the whole
  plugin to draw four static pictures on a phone. Colours are read from the
  theme at draw time, so they follow a light/dark switch instead of staying
  painted in the theme you left.

- **A "Tidy categorisation rules" command.** Every merchant you categorise
  writes a rule, so the rules file only ever grew — and most of what
  accumulated was a longer version of a rule that already gave the same
  answer. On a real 1,342-rule vault, 832 of them could never have changed an
  import's outcome. The command finds those and shows you the full list, with
  the rule that covers each one, before anything is deleted.

  It does not guess from the look of a pattern. Each candidate is removed and
  every transaction description in your vault is re-categorised; the removal
  is only offered if every single answer comes out identical. Rules that match
  nothing yet are kept and told to you separately — a rule with no
  transactions behind it may just be waiting for one.

### Changed

- **Statements that aren't comma-separated UTF-8 now import.** A semicolon- or
  tab-delimited export used to arrive as one unreadable column, and a
  windows-1252 or UTF-16 export imported merchant names full of replacement
  characters — which then became a permanent rule matching a name your bank
  will never send again. Both the separator and the encoding are now read from
  the file instead of assumed.

- **Categorising a merchant no longer writes a rule that changes nothing.** If
  your existing rules already put that description in that category, no rule
  is added. The rules file settles instead of growing with your history.

### Fixed

- Import matching no longer walks a rules list padded with entries that could
  not affect the result — the same work, over a list that stops growing.

## 1.3.6 — 2026-08-05

### Changed

- **The setup wizard no longer offers "Calendar month" and "Payday to payday"
  as if they were different things.** They were the same setting: a calendar
  month is simply a budget month that starts on the 1st, and both options ran
  the same code and wrote the same file. Worse, neither name appeared anywhere
  in **Settings → Budget Vault**, which has only ever had a *month start day*
  and a *period length* — so the wizard and the settings screen were teaching
  two different ideas of one setting. The wizard now asks the same two
  questions the settings screen does, in the same order: **how often are you
  paid**, then either **which day your budget month starts** (with "choose 1
  for an ordinary calendar month" said plainly) or **when you were last paid**.
  Nothing about how periods are stored or calculated has changed, so existing
  budgets are completely unaffected.
- **"Month start day" in settings now mentions that 1 gives you an ordinary
  calendar month.**

### Fixed

- **Re-running the setup wizard on a budget with an unusual pay cycle no longer
  shows you the wrong one.** If `period_days` in your `Settings.md` was set by
  hand to something outside the offered list — every 10 days, say — the
  wizard's dropdown had no such option and fell back to displaying "Every
  week". Your real setting was kept and written back correctly, but what you
  saw was wrong. Both the wizard and the settings screen now list the value you
  actually have.

## 1.3.5 — 2026-08-05

### Fixed

- **Closing the setup wizard on its very first screen no longer hides it
  forever.** Tapping outside the wizard, or pressing Escape before you had read
  it, counted as "no thanks" and the wizard never opened again — which on a
  fresh install left you with an empty plugin and no visible way to set it up.
  Closing it on the welcome screen now simply asks again next time. Closing it
  partway through is still taken as a real answer, and the message that appears
  now points at **Settings → Budget Vault → Run setup wizard**, not only at the
  command palette.
- **Choosing a country in the wizard now updates the currency you can see.**
  The country sets the currency, but the currency control was drawn before that
  happened, so picking, say, the United Kingdom left "R" on screen while "£"
  was what actually got saved. The two now always agree, and they share one
  step instead of asking the same question twice in a row.
- **The privacy splash no longer greets you with "Welcome back" the first time
  you ever open the plugin.**

### Changed

- **Every step of the setup wizard now has a name, not just a number.**
  "Step 3 of 7" told you how far along you were but not what you were being
  asked.
- **The wizard explains how budget periods are named.** If you are paid on the
  25th, the period running 25 August to 24 September is called *September* —
  the whole app works that way, and nothing said so. The payday step now works
  it out using the day you actually entered, and the pay-cycle step shows the
  date your current period started. The 1–28 limit on paydays is explained too,
  along with what to do if you are paid on the last day of the month.
- **The wizard checks your answers in the window, next to the fields.**
  Problems used to appear as a small message in the corner of the screen, away
  from the step it was about, easy to miss on a phone and sometimes behind the
  wizard itself.
- **The category step is grouped by kind, with colour previews and
  Select all / Select none.** Twenty ticked boxes in one flat list was a wall.
- **The "found an existing budget" message is now a note on the next step
  rather than a screen of its own,** and it is honest about what connecting
  does and doesn't change: your categories, accounts and transactions are left
  alone, but the settings in `Settings.md` are rewritten.
- **The last step says what to do next** — set your category amounts on the
  Budgets page, then import your bank's CSV — and warns you that the budget
  opens behind the tap-to-enter privacy screen, so that is no longer a
  surprise the moment setup ends.
- **Cancel moved away from Back and Next** in the wizard, where it was one
  mis-tap from leaving setup.

## 1.3.4 — 2026-08-05

### Fixed

- **The Import button in the header now shows a focus ring on older iPhones and
  iPads.** If you move through the app with a keyboard rather than taps, every
  button draws a ring when it takes focus so you can see where you are. That
  ring is drawn with a rule older Safari doesn't understand, and the app keeps
  a plain-focus copy of every one of them for those devices — but the header
  Import button was added without its copy, so on iOS 15.0 to 15.3 it was the
  one control you could tab to and not see. It has been missing since 1.0.27.
  A test now checks the two lists against each other, so a button can't be
  added to one and forgotten in the other again.

## 1.3.3 — 2026-08-05

### Fixed

- **Your debt-to-income figure no longer climbs just because the week is
  young.** If you are paid on a cycle rather than monthly, the Debt page works
  out a monthly income by averaging recent periods — and it was counting the
  period you are currently in, which has only had part of its days. Before your
  pay landed, that part-period pulled the average down, and because the figure
  is a ratio, a lower income showed as a *higher* percentage. The number crept
  up through the week and dropped again on payday, and on a weekly cycle it
  could sit around 8% too high — enough to put a healthy household in red
  against the 36% mark on nothing more than the day of the week. Only finished
  periods are averaged now, so the figure holds steady. If you have just set
  the vault up and have no finished periods yet, it still shows what it can and
  now says it is going on this period so far.

- **The income average now keeps to the window it was meant to use.** It aims
  to cover two to four months. On a two-week cycle it was reaching for about
  4.1 months — just past its own limit. Harmless in practice, because pay lands
  every period on that cycle, but it was luck rather than intent.

## 1.3.2 — 2026-08-05

### Fixed

- **A last-payday date that isn't a real date now falls back cleanly instead of
  quietly counting from somewhere else.** Only reachable by editing
  `Settings.md` by hand, but the two halves of the app disagreed about it: the
  file reader accepted anything shaped like a date, so `2026-13-45` was stored
  as a live two-week cycle, while the period maths refused to run it. The
  result was a settings screen showing a pay cycle the app wasn't using. One
  test now decides what counts as a date, and the file reader, the period
  maths, both settings screens and the setup wizard all use it.

- **A budget file named for a month that doesn't exist is no longer opened.**
  `Budgets/2026-13.md` was treated as a real period: it produced a normal
  31-day window you could page through, titled "undefined 2026". Month names
  must now be 01 to 12.

## 1.3.1 — 2026-08-05

### Fixed

- **Changing your pay cycle length no longer strands you between periods.**
  Going from weekly to every-two-weeks (or every-two-weeks to every-four) left
  the app sitting on a date that was no longer the start of a period. The dates
  it showed straddled two real periods, and the back and forward arrows walked
  that wrong track forever — only "jump to current period" brought you back.
  A budget saved while it was wrong went into a file no later period could
  open, and the Budgets page didn't count it among the ones waiting for you.
  Period names are now checked against your actual pay cycle rather than just
  their shape, so changing the length puts you on a real period straight away.
  Moving your last-payday date by a few days had the same effect, and is fixed
  by the same change.

- **The "your budgets are still here" message now appears when you switch
  between two pay cycle lengths.** It only spoke up when you moved to or from a
  payday month, so the one case that quietly puts half your budget files out of
  reach — weekly to every-two-weeks — said nothing at all.

- **A pay cycle whose last-payday date isn't a real date now falls back to the
  payday month** instead of producing a period with no name.

### Changed

- **Debt-to-income now reads the same in every week of the month.** On a weekly
  cycle a monthly salary lands in one week out of four, so three weeks showed
  no ratio at all and the fourth multiplied a single paycheque by 4.35. The
  income figure is now averaged over a window of a few months — thirteen weeks
  for a weekly cycle, chosen so it catches the same number of paydays every
  time — and the percentage stays put. A vault with only a week of history is
  still scaled up rather than averaged into nothing, and a payday month is
  untouched: the period is already a month.

## 1.3.0 — 2026-08-05

### Added

- **Changing the period length no longer looks like losing your budget.**
  Switching between a payday month and a pay cycle leaves your existing budget
  files untouched in the vault, but they can't be shown at the other length —
  so every category came back with an amount of zero and nothing said why. The
  Budgets page now explains it: how many files are waiting, which one is the
  most recent, and that they return the moment you change the length back. The
  settings screen says the same thing at the moment you switch, since that's
  where the surprise is made.

  There's also a one-tap way to bring the categories and notes across from your
  last budget. It deliberately does **not** bring the amounts: halving a monthly
  figure is right for groceries and wrong for rent, and nothing on screen would
  tell you which line had been guessed at. The tedious part is carried; the
  judgement is left to you.

## 1.2.1 — 2026-08-05

### Added

- **The setup wizard can now set up a pay cycle.** 1.2.0 added fortnightly and
  weekly periods but only offered them in Settings, so anyone going through the
  wizard was set up monthly with no sign the option existed. The budget-period
  step now offers a third choice — a pay cycle — and asks how often you're paid
  and when you were last paid. The first budget file it creates is named for
  the right period, so a new fortnightly vault opens on a real period instead
  of an empty page.

  Re-running the wizard against a vault that already uses a pay cycle now shows
  that cycle rather than presenting it as monthly and writing that back.

## 1.2.0 — 2026-08-05

Budget periods no longer have to be monthly. Requested in
[#1](https://github.com/RuanPienaarCode/budget-vault/issues/1).

### Added

- **A pay cycle that isn't a month.** Budget periods can now run on a fixed
  number of days instead of a payday month, so a fortnightly or weekly pay
  cycle gets budget windows that line up with it. Two settings: **Period
  length** — monthly, every week, every 2 weeks, every 4 weeks — and **Last
  payday**, one recent payday everything else is counted from. Any recent one
  will do; only where it falls within the cycle matters, so an earlier or later
  payday gives the same result.

  Monthly bills land in whichever period they fall in rather than being spread
  across several. That lumpiness is the point: the question a payday-aligned
  budget answers is whether this pay covers what's due before the next one.

  Nothing changes for anyone who leaves the period length on monthly, which is
  the default and what every existing vault already has. Switching between the
  two leaves both sets of budget files in place — the ones the other length
  can't address simply wait, and come back if you switch back.

- **Accounts that sit outside the budget.** `budget: false` in an account's
  frontmatter takes it out of the household income and spend totals — an
  investment or tax-free wrapper whose interest isn't income and whose debit
  orders aren't spending. Absent means in, so no existing vault's figures move.
  Only the arriving leg is suppressed; the money leaving your cheque account is
  still budgeted, which is what stops a transfer being counted twice.
  Transactions keeps listing every row, so nothing goes invisible.

- **An Accounts page that makes a balance trustworthy, not just displayed.** A
  KPI row, a reconciliation line comparing the last confirmed balance against
  what the transaction history implies, a staleness badge when nobody has
  confirmed a balance in too long, credit-card utilisation, and the account
  name as a drill-through to that account's transactions. The edit form
  validates every field before assigning any of them, so a rejected value can't
  leave a half-applied account on disk.

### Fixed

- **The privacy gate was reachable by keyboard on older iPhones.** The gate and
  the closed drawer both rely on `inert`, which is Safari 15.5+ while this
  plugin supports iOS 15.0. On 15.0–15.4 the attribute parsed and did nothing,
  so Tab walked into the balances behind a gate whose entire purpose is that it
  can't. The behaviour is now reproduced by hand where the attribute is absent.

- **Bar and meter fills had never animated.** Every call site built the element
  at its final width before appending it, so the first style resolution held
  the end value and the declared transition had no state to run from. They now
  animate from a keyframe that takes its target from the element's own computed
  width — nothing for a hidden pane to starve, and the width stays authoritative
  if the animation is skipped.

- **Checkboxes were 15×15 with no padding** — the most-tapped control in the
  app, one per row on a phone, under the 24px WCAG 2.5.8 minimum already
  applied to the row buttons.

- A household name containing a quote lost it rather than escaping it. An
  out-of-range month start day now says so instead of silently keeping the old
  one. Focus rings moved onto a per-theme token — the hardcoded literal was a
  green from a superseded palette — and the reduced-motion block gained the four
  selectors it was missing.

- **Debt-to-income no longer overstates itself on a non-monthly cycle.** The
  ratio divided monthly debt payments by a single period's income while showing
  a monthly threshold, so a fortnightly household paying 20% of its income to
  debt was shown 43.5% in red and told lenders treat that as stretched. Income
  is now scaled to a monthly equivalent, and the label says so, so the figure
  can be checked rather than merely believed. Monthly budgets are unaffected.

## 1.1.0 — 2026-08-03

Two new pages. The version moves to 1.1.0 rather than another 1.0.x because
this adds features rather than fixing them. 1.0.31 was prepared but never
released; the support link it carried ships here instead.

### Added

- **Debt.** Every debt the household owes, what the interest is costing this
  month before a cent of principal moves, and a payoff plan. Three runs sit
  side by side — minimum payments, snowball (smallest balance first), avalanche
  (highest rate first) — with a debt-free date for each and what the method
  saves against doing nothing. Set a budget category on a debt and the page
  reads its real payments out of your transactions, so what you meant to pay
  and what actually left the account sit next to each other. Saved to
  `Debts.md`, which is a plain markdown table you can edit by hand.

- **Loan Calculators.** A scratchpad for a purchase you have not made yet, so
  nothing here is saved. *Home loan*: price, deposit, rate and term, plus what
  buying actually costs on the day — SARS transfer duty, bond registration,
  transfer costs and the initiation fee — and the cash you need upfront.
  *Vehicle finance*: the same shape with a term in months, an optional balloon,
  and the service fees and rough insurance that turn an instalment into what
  the car costs a month. Both show a year-by-year amortisation.

  The deposit takes an amount or a percentage, whichever you know. Transfer
  duty is exact arithmetic on the SARS 2025/26 table; the conveyancing figures
  are interpolated from the guideline tariff and will differ from your
  attorney's quote. Outside South Africa the repayment maths still works and
  the local-cost cards drop away.

- **An optional support link in settings**, for anyone who wants to fund the
  work. Off unless you go looking for it; the plugin still never touches the
  network.

## 1.0.30 — 2026-08-02

### Fixed

- **A second table in a budget or transactions file was merged into the first.**
  The file reader collected every table row in a file without noticing where one
  table ended and the next began, and every reader then dropped just one header
  row. So if a `Budgets/YYYY-MM.md` or `Transactions/<account>/YYYY-MM.md` file
  had a second table under it — a note to yourself, something a script wrote —
  its rows were folded into the real one and its heading row turned into a
  budget line: a category literally called "Category", counted in your totals.
  Because the app rewrites these files from what it read, the next save made
  that line permanent. Files now stop at the end of the first table, which is
  also where the table visibly ends when you look at the note. Nothing the app
  writes itself could trigger this, and no existing file in a normal budget
  folder is affected — but a hand-edited one could be, and it changed your data
  silently rather than complaining.

- **The "which column is which?" screen opened on a setting it would reject.**
  Date and Description both started on the first column, so the first press of
  "Use these columns" always failed with "Date and Description are the same
  column". It now opens with the two pointed at different columns, picked by
  reading the file the same way automatic detection does.

- **A warning on that screen could outlive the problem it described.** Correct
  the mapping after a rejected attempt and the old red sentence stayed on
  screen. It now clears when you press the button.

- **Opening the plugin left keyboard focus outside the app.** After tapping
  "Enter budget" for the first time in a session, focus stayed on the page
  behind rather than moving to the view, so the first Tab started from the top
  of Obsidian instead of from your budget. Later unlocks already did this
  correctly; the first one now matches.

## 1.0.29 — 2026-08-02

### Fixed

- **A very short statement could import the running balance as the amount.**
  On a statement with no header row and only three transactions, the importer
  had too little to work with to tell which of the two number columns was the
  amount and which was the running balance — and it picked wrong, silently. A
  R250 expense imported as R4 750 of income, and nothing on the review screen
  said so. The importer now recognises when a file is too short to prove which
  column is which and asks you instead, using the same "which column is which?"
  screen an unrecognised bank already gets. Longer statements are unaffected —
  from four transactions up there is enough of a balance trail to settle it
  automatically, as before.

## 1.0.28 — 2026-08-02

### Added

- **Nedbank statements now import — both the cheque account and the credit
  card.** Nedbank exports with no header row at all — just a short account
  preamble and then the rows — so the importer rejected the file outright. It
  now reads the layout from the shape of the rows instead: the date leads, the
  amount sits at the right, and the description is between them. The two
  statements aren't the same shape, and both are handled: the cheque account's
  trailing running-balance column is recognised and left out, and the credit
  card's second date column is stepped past rather than mistaken for the
  description. Dates written without separators (`23Jul2026`) are understood
  too.

- **Any bank can now be imported, even one the app has never seen.** If a
  statement isn't recognised automatically, the import screen now shows you the
  file's first rows and asks which column is the date, the description and the
  amount (or money out / money in, plus an optional balance). Previously an
  unrecognised export was simply refused. A second text column can be mapped as
  "extra detail" for statements that split the payee from the reference.

- **"Columns wrong?" on the review screen.** Auto-detection still runs first and
  usually gets it right, but you can now correct it — the mapper opens
  prefilled with what was detected, against the file you already dropped.

- **Amounts are checked against the statement's own balance column.** Where a
  statement carries a running balance, the importer verifies that the amounts
  actually reproduce it. If a bank lists money out as a positive number, that
  check catches it and the signs are corrected — otherwise every expense would
  have imported as income. If the amounts can't be verified, they are imported
  unchanged and the review screen asks you to spot-check the signs. Nothing is
  ever silently corrected on a guess.

### Fixed

- **Capitec month-end rows landed in the wrong month.** Where a statement
  carries both a posting date and a transaction date, the posting date now wins
  — it is the one the balance column follows. Capitec timestamps February's
  interest just after midnight on 1 March, which previously filed it under
  March.

- **Dates with a time on them** (`2026-07-23 20:50`) were parsed by the
  JavaScript engine rather than by the plugin, which reads them differently on
  iPhone than on desktop. They are now parsed explicitly, like every other date
  format.

## 1.0.27 — 2026-08-02

### Added

- **Import a statement from anywhere in the app.** A new import button sits in
  the top bar, next to your initials. Tap it from any screen and it takes you
  to the Import page and opens the file picker straight away, so choosing a CSV
  is one tap instead of opening the menu first. If you already have an import
  waiting to be reviewed, it just takes you back to that review rather than
  discarding it.

- **Privacy splash screen.** The budget is now covered by a welcome screen
  until you tap "Enter budget" — when you open it, and again whenever Obsidian
  goes to the background. Nothing is read from your vault until you tap, so no
  balances appear in the app switcher or over your shoulder. It is on by
  default and can be turned off in **Settings → Budget Vault**.

- **Send feedback.** A button in **Settings → Budget Vault** opens a form in
  your browser for bug reports and feature requests. Nothing from your budget
  is attached or sent — the plugin itself still makes no network requests of
  its own.

## 1.0.26 — 2026-08-01

Compatibility pass for older iPhones and iPads. **Nothing changes on an
up-to-date device** — every fix here only takes effect on iOS 15, the oldest
version Obsidian Mobile still supports. Updating is worthwhile only if you use
the plugin on an older phone or tablet.

### Fixed

- **Cards, badges and tints no longer come out blank on older iPhones.** The
  colours throughout the app are blended at display time, and that blending was
  added to Safari after iOS 15. On an older phone the affected backgrounds were
  simply skipped, so parts of the app lost their shading: the top bar its
  frosted tint, inline code and table section headers their grey wash, the
  import review its emerald highlight, the card headers their hairline. Each of
  these now has a plain-colour stand-in that older phones use instead. Newer
  devices are untouched and still get the blended colours.

  The current-period marker in the import review never actually broke — the
  emerald bar down the left of those rows always drew correctly — but the soft
  tint behind it was missing. That tint is now back.

- **Keyboard focus outlines return on iPads running iOS 15.0–15.3.** The app
  marks which control has keyboard focus using a rule those specific versions
  do not recognise, and Safari discards the entire rule when that happens — so
  on those iPads no control ever showed a focus outline, making the app very
  hard to navigate with an external keyboard. Those versions now fall back to a
  simpler outline rule. The trade-off is that on those devices the outline also
  appears briefly on tap; every other device is unaffected.

### Changed

- **Dropped a CSS property that Obsidian's community plugin review flags.** The
  hidden-label helper used two properties that do the same job, one modern and
  one long-established. The modern one is reported as only partially supported
  regardless of how it is used, which counts against the plugin's review score.
  It has been removed; the other property was already doing the work, so screen
  readers and the visible layout both behave exactly as before.

## 1.0.25 — 2026-07-30

Small navigation and table-readability pass.

### Added

- **The Budget Vault logo in the top bar is now a link to the Dashboard.**
  Tapping the wallet icon or the title takes you home from any page, the way a
  logo does on a website. It is a real button, so it is reachable by keyboard
  and announced as "Go to Dashboard"; the old markup was inert text.

### Fixed

- **Amounts no longer wrap onto two lines in narrow panes.** In a phone-width
  pane the money columns got tight enough that a figure broke after the
  currency symbol, which doubled the height of every row it hit and left the
  Dashboard's Budget vs Actual table looking ragged. Amounts now stay on one
  line and the table scrolls sideways instead, which it was already set up to
  do. The category progress bar gives up a little width to help it fit.

- **Table rows sat flush against the screen edge on phones.** Full-bleed table
  cards now keep a 5px rim, so the first and last columns read as inside the
  card rather than touching the bezel.

## 1.0.24 — 2026-07-30

Housekeeping only — **no functional change**. The plugin behaves exactly as
1.0.23; `main.js` and `styles.css` are byte-identical. Updating is optional.

### Changed

- **Test fixtures and code comments no longer use real bank-statement data.**
  Several tests and comments illustrated the duplicate-detection rules with
  descriptions, amounts and dates copied from a real statement — including
  merchant names carrying suburbs, a masked card number and transaction
  reference codes. This repository is public, and that material does not
  belong in it.

  Everything is now synthetic, chosen to preserve the property each test
  actually pins: the common-prefix lengths that drive merchant matching, the
  masked-card pattern, and the digit-ratio thresholds in `learnPattern`. Every
  suite passes with the same number of checks as before.

  Retailer and bank names elsewhere are unchanged — naming the banks it imports
  from is what the importer is for, and those identify nobody.

  This release exists so the newest tag points at a source tree free of that
  data; the published `main.js` never contained it, since the bundler strips
  comments.

## 1.0.23 — 2026-07-30

Import no longer discards a transaction that legitimately repeats. No
file-format change.

### Fixed

- **A repeated transaction could be dropped and never recovered.** Duplicate
  detection held the existing transactions in a membership set — it could
  answer "has this date/description/amount been seen before?" but not "how many
  times?". Some transactions genuinely repeat identically: three `Returned
  debit order fee` -9.00 on one day, two shop visits of the same amount.

  When an early statement listed such a charge once and a later statement
  listed it twice, the second copy matched the same single entry, was flagged a
  duplicate, and never imported — on that statement or any statement after it.
  It was silent: the row appeared under "duplicates skipped", so nothing looked
  wrong, and the transaction was simply absent from every total from then on.

  The index now counts occurrences instead of testing membership, and the
  statement's copies are matched against the vault's copies one for one. The
  Nth identical row is a duplicate only while the vault still has an Nth
  identical row to pair it with; beyond that it is a real transaction and
  imports normally.

  The same fix applies to the near-duplicate pass added in 1.0.22, which
  identified candidates by their key — so two identical pending rows collapsed
  to one and only one of them could be matched. Candidates are now tracked
  individually.

  Replayed across a run of overlapping statements, imports are now lossless:
  every transaction on the final statement survives, where the previous
  behaviour dropped one.

## 1.0.22 — 2026-07-30

Import no longer duplicates a card transaction when the bank rewrites it
between statement exports. No file-format change.

### Fixed

- **Duplicate transactions after re-importing an overlapping statement.**
  Card charges arrive twice from the bank: first as `Pending`, carrying the raw
  terminal descriptor and a provisional timestamp, then again a few days later
  once they settle, with a normalised merchant string and a new time.

      8 Jun export   2026-06-08 12:07  "GROCER ONE TERM0099 ZA"  Pending
      22 Jun export  2026-06-08 20:13  "GROCER ONE CITYVILLE"   Apple Pay

  Duplicate detection keyed on `date|description|amount|account`, and **two of
  those four fields change when a charge settles** — so the settled row read as
  brand new and landed next to the pending one it was meant to replace. Both
  flavours occur: the description rewritten, and the date shifted by a day
  (which can duplicate a whole day of debit orders at once).

  Import now runs a second pass for this. A row is flagged when it matches an
  existing transaction on account and amount, falls within four days, and shares
  a merchant stem — **and** the incoming statement no longer contains the row it
  matched. That last condition is what makes it safe: a pending row *vanishes*
  from later exports once it settles, so a still-present row can never be
  absorbed by a different one. Without it, two same-amount international fees a
  day apart would collide on their shared prefix.

  Flagged rows are **unticked and labelled with the transaction they collided
  with — never silently skipped**, so a genuine second identical purchase is one
  click away. Replayed over four years of real statements, this removes every
  pending/settled duplicate while suppressing no real transaction that the
  previous behaviour kept.

### Added

- **Declarative settings on Obsidian 1.13+.** The settings tab is now also
  described through `getSettingDefinitions()`, which 1.13 renders itself. Older
  versions keep the existing imperative tab unchanged. Both describe the same
  settings, and a test asserts they stay in step.

## 1.0.20 — 2026-07-30

Split transactions, a Budget totals strip, and the end of a family of layout
bugs caused by Obsidian's own stylesheet reaching into the plugin.
No file-format change.

### Added

- **Split a transaction across categories.** One bank line often covers two
  things — half the supermarket shop is groceries, half is household. Each row
  in Transactions now has a split button that carves it into parts with their
  own category and note. The parts must sum to the original exactly; the modal
  will not let you submit while there is a remainder.

  The original line is **kept and marked Excluded** rather than deleted. Every
  total is computed from non-excluded rows, so the period figures are identical
  before and after a split — and because the CSV importer dedupes on
  `date|desc|amount|account`, keeping the original means re-importing the same
  statement can't re-add the line on top of its own parts. It is reversible by
  hand in the markdown: untick Excluded and delete the parts.
- **Budget page totals strip.** Three tiles — total income, total budgeted,
  total spent — repeated above and below the category table, so the totals stay
  in reach at either end of a long list. They read the live draft, so they move
  as you type rather than after you save.

### Fixed — Obsidian's stylesheet was reaching into the plugin

All three of these are the same root cause: `app.css` rules that match the
plugin's own markup and beat its rules on specificity. They are now answered by
name rather than by hoping source order wins.

- **Cards were never actually full-bleed on a phone, and rows were cramped.**
  Obsidian ships its own `.card` class. The plugin's `.card` declared colours
  and radius, so those were safe — but `margin: 0 10px`, `padding: 15px 30px`
  and `display: flex` fell straight through, and `.workspace-leaf-content
  .view-content` added another 12px of gutter each side. That is ~80px of a
  375px screen gone before the first table cell, which is why the earlier
  full-bleed passes looked like they had done nothing: they trimmed
  `.main-content` and `.body-pad` while the real gutters were elsewhere. The
  Transactions table now gets 373px of a 375px screen instead of 269px. Cards
  also square their sides at the screen edge instead of showing two clipped
  corners.
- **In light mode, note fields turned black under the cursor and the Excl.
  checkboxes were dark squares.** The plugin's theme is its own setting, so it
  can legitimately run light while Obsidian runs dark — and then
  `input[type=text]:hover` (more specific than the plugin's `.form-control`)
  repainted the field with Obsidian's dark form-field colour, while Obsidian's
  `color-scheme: dark` made the UA paint the native checkboxes dark. The plugin
  now pins `color-scheme` to its own theme and re-points the host variables
  those rules read at its own palette, which fixes the mismatch in both
  directions.
- **A stray ✓ at the top-left corner of every card.** Obsidian draws a
  checkbox's tick as an absolutely-positioned `::after` on the input, which
  only lands correctly because Obsidian also makes the input `position:
  relative`. The plugin restores the native checkbox and resets that to
  `static` — so the tick went looking for the nearest positioned ancestor,
  found `.card`, and painted itself at the card's corner, one per ticked box.
  The native control draws its own tick, so the overlay is now switched off.

### Added — tests

- `tests/split-transaction.test.cjs` — guards the split arithmetic (parts sum
  exactly, cent-rounding so `0.10 + 0.20` balances `0.30` while a one-cent
  shortfall still blocks), the sign coming from the parent, and the on-disk
  shape including that non-excluded rows total exactly what they totalled
  before the split. Runs in bare node, wired into `build.sh`,
  negative-control-proven.

## 1.0.19 — 2026-07-29

The structural half of the audit — the work deliberately held back from 1.0.18
so that data-integrity fixes and refactors did not ship in the same release.
No file-format change.

### Changed — structure

- **Unsaved-work detection can no longer be forgotten.** Each view registers its
  own dirty predicate instead of `hasDirty()` enumerating four different
  mechanisms. The old shape failed *open*: a view missing from that list looked
  clean to the file watcher, which then reloaded the vault over the user's
  edits. The Budget page's state, which lived only in a button's `disabled`
  attribute, is now backed by a real flag.
- **`ctx` collisions throw at mount.** Sixty-five keys shared one flat namespace
  with no detection; a silent overwrite would have surfaced later as "the wrong
  function ran".
- **`render` and `switchView` are available to every module.** They were
  attached after the register chain, creating an unwritten "destructure
  everything except these two" rule. The load-bearing register order is now
  documented where it is easy to break.
- The Tax page's per-field refresh lists collapsed into one `refreshDerived()`.
  Each handler used to name its own dependents in a comment — knowledge that
  grows with every field. The rule is now stated once: a handler may rebuild any
  subtree with no focusable controls in it, never the one holding the control
  that fired.

### Changed — performance

- **The transactions table renders 100 rows at a time** with a "show more"
  control, instead of building up to 800 at once and rebuilding all of them on
  every search pause and filter change.
- **Category cells are a button until first use.** A native `<select>` is the
  most expensive control in a mobile WebView; at a full page this is the
  difference between zero and a hundred of them.
- **The import review is paged too.** It previously rendered every parsed row —
  a 12-month export froze the screen right after "Preparing review… 95%", for
  longer than the progress bar had been measuring. It now says plainly how many
  rows are shown and that all of them will import.

### Fixed — accessibility

- Cycling a tax step or document status no longer throws keyboard and
  screen-reader users to the top of the page.
- Switching view moves focus to the new page's heading.
- Accessible names on the remaining table controls: budget amounts and notes,
  tax figures, step and document notes.

### Internal

- **The round-trip tests now drive the real `loadVault`.** They used to parse
  with a hand-written copy of the loader, so changing a column in `load.js`
  alone left every test green while every save corrupted data. A new in-memory
  vault harness closes that for transactions, budgets, owed, services and tax at
  once, and pins that the memory key and the written path agree.
- New tests for period maths (untested until now, and it decides which month
  every figure is attributed to), `normalizeAmount`, `parseStatementDate` and
  `learnPattern`.
- New contract test: every `$('#id')` resolves, every drawer link has a section,
  every section has a render-map entry, and no two modules publish the same
  `ctx` key. All were true; now a rename fails the build instead of shipping.
- Test assertions across the suite: 195 → 247. Dead CSS removed.

## 1.0.18 — 2026-07-29

A full audit pass across logic, mobile behaviour, data integrity, accessibility
and performance. Nothing in this release changes the file format.

### Fixed — data integrity

- **A transactions folder whose name contains `:`, `*`, `?`, `"`, `<`, `>` or `|`
  could lose a month of history.** The in-memory key and the path written to
  disk were derived by two different functions, so the lookup missed while the
  write still landed on the existing file — rebuilding that month with only the
  new rows. Both now resolve through one canonicaliser, which also folds Unicode
  to NFC so a decomposed accent (what macOS and iCloud hand you) can no longer
  key one way and write another.
- **Values written into frontmatter are now quoted and escaped.** A category
  named `Kids "school" fees`, or a tax reference typed as `ITA34: 2026/0031`,
  produced invalid YAML. Obsidian dropped the whole property block from its
  metadata cache — and the plugin's own parser read it back happily, so the
  breakage was invisible from inside the app.
- **Hand-edited amounts are read instead of guessed at.** `1 234,56` was read as
  `1` and `R150.00` as `0`. For account balances this was destructive: the wrong
  figure was written straight back on the next edit. Balances the loader cannot
  strictly parse are now preserved byte-for-byte, as transaction cells already
  were.
- **Switching tax year no longer discards other pages' unsaved work.** It
  bypassed the shared reload cleanup, leaving a stale budget draft armed and
  silently resetting unsaved Owed and Services edits behind still-enabled Save
  buttons. All reloads now go through one entry point.
- **Two tax-year switches skipped the unsaved-changes prompt entirely** — the
  "add this year" button and picking an existing year from the New Tax Year
  dialog. Either could strand a year's edits in memory, unreachable and
  unwarned.
- **Reloading mid-import no longer re-imports everything.** The duplicate-
  detection snapshot was taken before the reload and never rebuilt, so every row
  looked new.
- **Bank statement descriptions can no longer inject a spreadsheet formula** into
  the categorisation rules CSV.

### Fixed — behaviour

- The vault watcher no longer stops working after you touch a filter. It also
  retries instead of dropping a change that arrives while you are typing.
- Pending timers are cancelled when the view closes, instead of firing against a
  torn-down page.
- CSV headers like `Date Posted` or `Effective Date` now import. They passed
  header detection and then failed as "missing columns".
- Account and category filters refresh when a name changes on another device,
  rather than showing a stale name that matches nothing.
- Uploading a tax document attaches to the row you picked, even when two rows
  share a name. A failed upload no longer leaves an empty row behind.
- Uploaded tax documents appear immediately instead of on the next redraw.
- The import review's "Excl." ticks now reflect their own state after a retry.

### Fixed — mobile

- Owed and Services got the same treatment the Tax page received in 1.0.17:
  editing a field no longer rebuilds the table under your finger, and horizontal
  scroll position survives a redraw.
- Services' next-billing date no longer renders blank when the stored value
  isn't a plain `YYYY-MM-DD`.
- Date fields have an explicit width range — iOS clipped them, desktop stretched
  them out of line with their neighbours.
- Cards and badges keep their backgrounds on iOS below 16.2, which has no
  `color-mix()` support.

### Fixed — accessibility

- Status pills meet AA contrast in light mode. The category badges already did;
  the pills were missed.
- Cycling a status no longer throws keyboard and screen-reader users back to the
  top of the page.
- The import checkbox that decides whether a transaction is imported now has a
  name. So do the category, note, amount, date and exclude controls in every
  table.
- The Dashboard has a page heading.
- Row-action buttons meet the 24px touch-target floor.

### Changed — performance

- The vault is read in parallel rather than one file at a time. On a vault with
  ~160 budget files this was several hundred milliseconds of pure latency at
  every startup and reload, and more on a phone.
- CSV auto-categorisation no longer re-normalises the rule list once per row —
  roughly 2.7× faster at 2,000 rules, and it stops degrading as the rule set
  grows.

### Internal

- Release CI rebuilds `main.js` and fails if it differs from the committed
  bundle, and runs the guard tests. Previously the tests only ever ran on a
  developer's machine and a stale bundle could ship unnoticed.
- Round-trip test coverage grew from 38 to 90 assertions, now covering path
  canonicalisation, YAML and CSV escaping, and non-canonical amount cells.

## 1.0.17 and earlier

See the [release notes](https://github.com/RuanPienaarCode/budget-vault/releases).
