# Changelog

All notable changes to Budget Vault. Versions match the plugin version in
`manifest.json` and the release tag exactly (no `v` prefix).

## 1.19.1 — 2026-08-13

Money that arrived was being counted by nothing. Three different ways in,
one cause, and the figure it corrupted is the one the Budget page offers
to carry forward as already spent.

### Fixed

- **A period's overspend now credits every rand that came in.** The figure
  behind "pull last month's overspend" was computed as total spent minus
  total income — which is not the same thing as what went out less what came
  in, because "total spent" counts an uncategorised payment in full while
  "total income" counts only rows in an income category. So the deposit
  beside it was credited to nothing. Any period holding uncategorised money
  in, a refund inside a spending category, or money under a category that
  had since been deleted was reported deeper in the hole than it was — on
  the vault this was found against, **two periods' stated overspend was
  materially overstated, and a third reported an overspend in a month that
  had comfortably finished ahead.** That number is written into an
  assume-spent budget row, so the app was not merely mis-stating those
  holes, it was funding them. If you have ever pulled an overspend forward,
  the figure is worth re-checking against this release.

- **Total Income says what it is leaving out.** Money that arrives with no
  category is still not counted as income — it may be a transfer in from
  your own savings, and guessing would inflate every ratio built on income —
  but the tile now names the amount underneath itself, the way the spending
  donut has always declared its own gap. Refunds are deliberately not in
  that note: they are money back inside a category, already netted off that
  category's own actual.

- **A category that no longer exists is now visible.** Deleting a category
  leaves its name on existing transactions on purpose, and renaming one
  means editing the file, which orphans every row that used it. Nothing said
  so. Those rows were treated as "not income", so an orphaned PAYMENT still
  counted as spending while an orphaned DEPOSIT was counted by nothing at
  all — and the "Uncategorised" tile never mentioned them, because it only
  ever counted a blank category. A **Missing categories** tile now shows how
  many categories have gone missing and how many transactions they touch.
  Worth knowing if you use a transfer category: its rows stop being excluded
  from your totals the moment its file is renamed.

### Internal

- The per-period summary now takes a single signed ledger total before it
  classifies anything, and the overspend figure is derived from that and
  nothing else — so a mistake in classification can now make a label wrong,
  where it used to make a rand disappear. `tests/summary-conservation.test.cjs`
  pins the buckets back to that total over 60 randomised rounds, checked
  against an independent oracle rather than against the code under test.

## 1.19.0 — 2026-08-13

Nothing in this app is one-way any more — and what made that urgent is a bug
that had been quietly leaving money out of the record for two years.

### Fixed

- **Capitec's `Fee` column is read.** That export has THREE mutually exclusive
  amount columns — Money In, Money Out and Fee — and the importer read two, so
  every bank charge landed in the third and vanished. On the statement this was
  found against that is **553 rows and R1,542.50 over 25 months**, all of it
  spending, none of it visible anywhere to be missed: no error, no warning, no
  skipped-row count, and a "bank fees" budget line built from data that was
  short R62 a month. Fee is now read after the other two, honouring the cell's
  own sign — 8 of those rows are reversals (`Correction: Cash Withdrawal Fee`,
  +30.00), and negating by magnitude would invent money leaving, which is worse
  than failing to see it leave. Rows with all three columns empty are still
  skipped; they are notices, not transactions. **Vaults imported before this
  are still short those rows — re-import the same statements and only the fee
  rows land, because everything already on disk is skipped as an exact
  duplicate.**

- **Those fee rows also fixed the reconciliation.** A balance column that steps
  across rows nothing has read cannot line up, so these files could never prove
  their own sign convention. They do now.

- **A statement can no longer land in the wrong account.** The file's own
  account number — Capitec's `Account` column, Nedbank's preamble — is checked
  against the account picked, and a disagreement BLOCKS the import rather than
  warning about it. One wrong pick in that dropdown wrote 933 rows of one
  account's history into another; it survived a year of daily use because the
  result looks entirely normal, and was found only by hashing the monthly files
  and noticing 25 byte-identical pairs across two folders. An account with no
  number recorded is offered the one the file carries. A masked tail (`…0098`)
  matches the full number; anything ambiguous stays silent rather than blocking.

- **Rows the bank still marks `(Pending)` arrive unticked.** The marker is
  stripped before the merchant comparison, so a settled row can absorb its
  pending twin — but the pair's amounts can differ (a tip, a fuel pre-auth, a
  currency conversion), and no rewriting rule matches across a changed amount.
  The honest answer is to let the purchase arrive settled on the next statement.

### Added

- **Delete, everywhere this app can create.** A trash button on every
  transaction row — deleting a split parent takes its parts with it, and
  deleting a part says plainly that the remainder no longer sums to the
  original. Accounts, plans and tax years get their own.

- **Deleting an account asks about its transactions folder** rather than
  assuming, with the row and file counts in the question. Kept, those rows
  still count toward every period total under a folder no account claims — the
  orphan folder `CONTEXT.md` names. It is a choice, not a default.

- **Delete these rows** removes what the Transactions filters select, for the
  wrong statement noticed a week later. It refuses without a filter, refuses
  over unsaved edits, and writes the rows to `Data/Deleted transactions.csv`
  first: the vault trash cannot undo a row delete, because the monthly file is
  edited rather than removed.

- **Undo import.** A commit now leaves a receipt holding the rows it added, so
  an undo removes exactly those — even where every row has a twin. It appears
  on the Transactions page, because that is where a mis-picked account is
  actually noticed, and it does not survive a vault re-read (which rebuilds
  every row) rather than becoming an undo that silently removes nothing.

- **Deleting a tax year leaves `Tax/<year>/` alone.** The plugin wrote the
  page; your bank wrote the certificates. The folder lands in the orphan-year
  state this page already offers to build a fresh year around.

- **Touch targets meet Apple's 44pt floor.** On coarse pointers every button
  grows an invisible centred hit area, and toolbars, chip rows and list rows
  free to thicken get a real `min-height`. Desktop density is untouched.

### Changed

- Two new guard suites. `delete-and-undo` drives the real views with the modals
  stubbed, because the dialogs are where the decisions are taken.
  `import-fee-column` reconciles a three-column statement row for row from
  bytes to disk — the multiset of (date, amount) in both directions plus the
  sums, which fails as loudly on a double-count or a flipped sign as on a
  dropped row.

## 1.18.0 — 2026-08-13

Columns are now declared once. Nothing you can see changed — and this release
exists to make that sentence provable.

### Changed

- **One declaration per flat table drives the loader, the serializers and
  the tests** (`src/table-schema.js`, ADR-0003). Before this, the column
  order of transactions, debts, owed, assets and services lived three times
  — a positional mapping in the loader, a hand-built header and row template
  in each view, and (for transactions) a hand-written mirror inside a test
  whose comment politely asked future editors to keep both copies in sync.
  Adding a column to the serializer but not the loader would have shifted
  every later value into the wrong field of every file on disk, silently.
  That edit is now impossible to make in one place.

- **Append-only is enforced, not written down.** A tripwire test holds each
  table's shipped column history and goes red on any reorder, rename or
  mid-table insertion; a truncation sweep proves every column — current and
  future — reads an absent cell as its documented default, which is what a
  file written by an older version looks like.

- **The on-disk format is pinned byte for byte.** A golden-gate test captures
  1.17.5's exact serializer output and every entity must keep producing it:
  no whitespace churn, no sync noise, no rewrite of your files on first save
  after upgrading.

## 1.17.5 — 2026-08-13

An architect's pass over the whole plugin answered "should we simplify?"
with "mostly no" — but surfaced four more instances of the recurring bug
shape, one figure derived by two different rules. Each derivation now has
exactly one owner.

### Fixed

- **The Accounts hero reads net worth from the module that owns it.** The
  hero re-derived the by-sign asset/liability split with its own raw loop
  and read the difference unrounded — so the float-remainder failure
  worth.js was written to end (a break-even household rendering "-R0.00")
  was still reachable on that one page while Dashboard and Savings agreed.
  The hero now calls `worth()` with no debts or assets passed, which
  collapses to the accounts-only figure it always meant.

- **Days are counted between dates by one rule.** dates.js wrote the rule
  down — format local, count in UTC — and then three other files kept
  their own counters, two of them counting local. committed.js and
  reconcile.js now call the one shared `daysBetween`, each keeping its own
  bad-input policy at its own boundary; reconcile still refuses an
  impossible date and still falls back to the wall clock deliberately.
  savings-math.js deliberately keeps its local counter for now: it rejects
  a hand-typed impossible `inception_date` the shared one would roll
  forward, and that difference deserves its own decision, not a drive-by.

### Changed

- **Two verbatim duplicates folded into their single owners.** load.js
  carried the same `section()` heading-slicer twice, character for
  character; it is one function now. worth.js's `debtsByType` and
  `assetsByType` were the same grouping over a different value key; both
  now call one `groupedByType`, so the drop rule and the sort cannot
  drift between the chart's two sides.

## 1.17.4 — 2026-08-13

A plumbing pass in the audit's wake: two more instances of this codebase's
recurring bug shape — one rule spelled differently in two places — found by
hunting for the shape itself rather than waiting for the figures to disagree.

### Fixed

- **A hand-typed `Credit_Card` is a card everywhere, or nowhere.** The type
  test lived in four places and only committed.js trimmed and case-folded it —
  so an account whose frontmatter said `Credit_Card` joined the committed
  chain's card arithmetic while net worth's double-count warning, the
  importer's liability reading and the utilisation bar all looked straight
  past it. `isCreditCard` is now one exported rule in committed.js, read by
  all four.

- **A folder differing from its account only in case resolves again.** The
  write side (`txSegment`) learned to match folders case-blind because the
  filesystems this plugin ships on are; the read side (`accountForLabel`)
  never did. A `tx_label: cheque` against an on-disk `Cheque` folder imported
  happily while every page reading the other way saw an orphan — rows counted
  in the budget, the account told to link a folder it was already importing
  from. Both sides of the contract now fold the same way, and `tx_label`
  passes through safeSeg like the account name always has.

## 1.17.3 — 2026-08-13

Phase three closes the four-lane audit of 1.17.0: polish, latent traps, and
housekeeping. Nothing here changes a figure you have already seen.

### Fixed

- **Bigger touch targets on a phone.** Row-action buttons ("Open", "Change
  subject", "Delete" on a note card, and their siblings across the app) now
  meet Apple's 44-point minimum on touch screens, with more space between
  them — so a near-miss lands on nothing instead of on Delete. Desktop
  spacing is unchanged.

- **The fact-review reminder respects your timezone.** The banner asking you
  to re-check a tax bracket or levy read the date in UTC, so it could appear
  up to two hours before the review date actually arrived locally.

- **Two latent traps closed before they could bite.** A savings account with
  a deliberate starting amount of 0 now reads as a real baseline on every
  code path (previously one path would have called it unmeasurable), and the
  trend/comparison arithmetic moved into its own tested module — the maths
  behind "how does this month compare" now has 20 assertions of its own.

### Changed

- **Neutral example names.** Placeholders and examples throughout the app
  and its source now say "Alex, Sam" instead of the author's household.

## 1.17.2 — 2026-08-13

Phase two of the four-lane audit: the credit-card rules on the "What's left"
card now agree with each other, and every write goes through one guarded door.

### Fixed

- **A second card is no longer silently ignored.** If one card was settled
  monthly and counted in the committed chain, the "owed on cards" sentence
  went quiet entirely — so a second, revolving card's balance appeared in no
  figure and no sentence anywhere on the dashboard. The sentence now
  discloses exactly the cards the chain did NOT claim, per card, including a
  settle-monthly card whose settlement day falls after the period ends.

- **"Settle monthly" only means something on a credit card.** Three parts of
  the committed maths each read the setting slightly differently, and a
  `settle_monthly` flag on a non-card account dropped money out of the
  arithmetic through the gap: it was subtracted as a card settlement while
  nothing measured its spending against settling income. One shared
  definition now; on anything that is not a credit card the flag does
  nothing, and the account keeps its ordinary treatment.

- **A card whose name carries a filesystem-illegal character cycles
  correctly.** Transactions are stored under a cleaned-up folder name
  ("Visa: Gold" lives in "Visa- Gold"), and the settlement-cycle band
  matched folders against the raw name — so such a card's spending read as
  zero, no cycle formed, and "actually free" subtracted the full card
  balance instead. Folders now resolve through the same rule every other
  page uses.

- **The setup wizard's files are written through the same guarded machinery
  as everything else.** Its writes were the only ones in the app without the
  path-containment check, on a folder typed into a text field, with its own
  hand-rolled copies of the folder-creation and write-stamping logic. One
  write path now — the wizard gains the guard, and the copies are gone.

### Internal

- The savings view no longer depends on the order modules register in; a new
  build check enforces that rule for every view, mutation-proven. The ctx
  collision check regained sight of the io surface through the new factory.

## 1.17.1 — 2026-08-13

Phase one of a four-lane audit (logic, design, security, iOS) of 1.17.0.
Nothing here changes what the app is for; everything here closes a way it
could have been silently wrong or silently stuck.

### Fixed

- **Reloading twice no longer doubles your figures.** Tapping the drawer's
  reload link again while a slow load was still running (an iCloud vault
  materialising files takes a moment) ran two loads at once, and every
  category, account, debt, asset and owed entry landed twice — the totals
  doubled until the next clean reload. A load already in progress is now
  joined instead of restarted.

- **Writing a setting can no longer blank the settings tab.** If `owners:` in
  Settings.md was hand-written as a YAML list, the plugin's own settings
  writer broke the file's frontmatter in a way Obsidian responds to by
  dropping *every* property on the file — the plugin kept working, the
  settings tab went blank, and the broken file synced to every device.
  Settings.md is now patched by the same frontmatter writer every other file
  uses, which folds a list value into a scalar instead of orphaning it.

- **The setup wizard quotes what you type.** A quote, backslash or colon in a
  household name, currency symbol, or bank name was written into frontmatter
  either half-escaped or not quoted at all — the same silent property-drop as
  above, on the very first files a new user creates. The wizard now uses the
  one escaping rule the rest of the app already follows.

- **A category colour must be a colour.** The dashboard legend renders each
  category's `color:` value straight into its swatch, and anything trailing a
  valid-looking `rgb(…)` prefix rode along with it — a crafted value in a
  synced vault could restyle the whole pane. Anything that is not entirely a
  colour now falls back to the palette.

- **A malformed bank statement can no longer freeze the import.** Rule
  learning re-scanned the whole description once per trimmed token, so one
  absurdly long description cell (hundreds of kilobytes) cost seconds of
  frozen screen — and a file can contain fifty of them. Descriptions are
  capped at 512 characters before learning; no real bank prints one longer,
  and learned rules match exactly as before.

### Internal

- The savings-growth guard test read the real clock and went red on
  2026-08-13 by itself, blocking every build. It now pins its date the way
  the dashboard tests always have. New guard tests pin all five fixes above.

## 1.17.0 — 2026-08-12

### Added

- **Notes filed into subfolders are found.** `Notes/` was read one level deep,
  so tidying a year of notes into `Notes/2025/` emptied the page while every
  one of them sat safely on disk. The whole folder is read now, however deeply
  you nest it, and renaming an account still reaches the notes you filed away.
  New notes are still created at the top of `Notes/` — nothing moves your files
  around.

## 1.16.1 — 2026-08-12

Everything a six-lane audit of 1.16.0 turned up. Nothing here changes what the
app is for; several things change what it *told you*, and those are worth
reading if you use the Savings page.

### Fixed — figures that were wrong on screen

- **The growth chart could disagree with the total above it.** An account with
  a starting amount but no opening date and no transactions had its balance
  counted into the total while its opening capital went nowhere — a fund
  printed R95 000 over bands that came to R35 000, and described the missing
  R60 000 as "growth carrying no date". Exactly the market-linked holding the
  feature exists for. Such an account is now left out of the chart and counted
  as unmeasurable, like every other one that cannot be placed.

- **Transactions the chart could not date were dropped from it.** A date typed
  in a format the plugin does not read, or a row dated in a future month, was
  counted in the total and then left out of every band. Both now land in the
  chart — the undatable at the first point, the future-dated at the last.

- **Contributions made before an account's opening date were counted twice.**
  The starting amount IS the balance on that date, so those rows were already
  inside it. The error made capital too high and growth too low, and nothing
  disclosed it — the existing warning only fires when records start *after* the
  opening date. It now says so in the other direction too.

- **A starting amount of zero could not be saved.** An account opened empty and
  funded entirely by transfer is a real case the growth maths handles, but
  typing 0 dropped the value on save, so the growth block vanished and the card
  asked for a starting amount again.

### Fixed — notes

- **A note about something whose name contains a line break corrupted its own
  properties.** Wrapping a long debt or service name in its table left the note
  with frontmatter Obsidian could not read, so it silently fell out of its tag,
  out of Dataview and out of Bases — while the plugin went on displaying it
  fine. Names with quotes, tabs and backslashes are handled properly now too.

- **Two notes titled the same thing on one day could overwrite each other** if
  the titles differed only in capitalisation, because macOS and iOS treat those
  as one filename. And if a note could not be written at all, the dialog closed
  and said nothing; it now tells you and keeps what you typed on screen.

- **Renaming a category file no longer detaches notes from a category that did
  not actually change name.** A category whose name is set in its properties
  keeps that name wherever the file lives.

- **A note about something Obsidian cannot link to no longer adds a dead node
  to your graph** — a category called `Kids/School`, or a name with brackets.
  The note still knows what it is about; it just does not draw a link that
  goes nowhere.

- Deleting a note that had been renamed elsewhere in the meantime could report
  a deletion that did not happen. It now checks first.

### Fixed — reading and accessibility

- **Small print in dark mode was below the accessible contrast minimum** on
  every card — subtitles, the labels above each figure, account sub-lines, the
  ages under Owed and Assets. About fifty places, and it predates the Notes
  page. The faint text colour in the default palette is slightly lighter as a
  result; the other three palettes already cleared it.
- The notes chip on the Accounts, Debt, Assets, Services and Owed pages was
  too small to tap reliably on a phone, and sat next to controls that do
  something else.
- Notes are a real list, so a screen reader can move between them.
- A household with someone named "Joint" no longer sees the word twice in
  every owner dropdown.

### Changed

- The Notes folder is read in parallel rather than one file at a time. At
  thirty notes that was three quarters of the time the plugin took to open,
  and it grew with every note you wrote.

## 1.16.0 — 2026-08-11

### Added

- **Notes — the things the figures can't tell you.** Every page in this plugin
  holds numbers the vault can derive. None of them held what the bank actually
  said on the phone, why last month looked wrong, or which quote you are still
  waiting on. There is now a Notes page, and a Notes entry in the menu.

  A note is a **real markdown file** under `Notes/`, not a row in a table like
  `Services.md`. That difference is the whole point: a note is prose you write,
  so it has to be editable in Obsidian, searchable by Obsidian, and joined to
  the graph — a table cell is none of those. The page creates, lists, filters
  and opens; it deliberately does not edit. **Open** hands the file to a real
  Obsidian tab, which already has a markdown editor, wikilink completion,
  attachments and sync.

  That split is load-bearing rather than a shortcut. Every other serializer
  here rebuilds its file from state on save; doing that to a note would eat the
  paragraph you typed in the other tab ten seconds earlier. So the only write
  this makes to an existing note is a frontmatter patch, and the body coming
  back byte-identical is pinned by a test carrying a negative control.

  A note can be about an account, a category, a period, a debt, an asset, a
  service, an owed entry — or nothing in particular. It points at its subject
  through `note_kind` + `note_subject`, plus a `note_for` wikilink for the two
  kinds that have a note of their own (accounts and categories). Debts, assets,
  services and owed entries are table rows with no file, so a wikilink for them
  would be a permanent unresolved node in your graph, once per note — hence it
  is written only where it actually resolves.

  Renaming an account note in Obsidian's own file explorer repairs the
  wikilink, but not `note_subject`, which is the key the plugin reads — so a
  rename would have left its notes looking correctly linked and attached to
  nothing. Both keys now move together. A rename the plugin cannot see — a debt
  renamed by editing a cell in `Debts.md` — is reported on the note as
  **unmatched**, with the fix one tap away, rather than hidden.

  A notes chip sits beside every account, debt, asset, service and owed name:
  it shows how many notes there are, and opens them filtered to that subject —
  or starts the first one.

- **Growth the fund never posted, and an account you can edit where you read
  it.** Growth was only ever counted where an account POSTED it as a
  transaction — interest, a dividend. A market-linked fund posts none: the
  value moves, the balance is retyped, and no row is ever written. So the
  holding with the most growth on the page reported the least, under the words
  "no growth recorded".

  Total return now works backwards from the balance instead — anything in the
  balance the household did not put there is, by definition, what the account
  earned. That buys a dependency the derived figure does not have: where the
  transaction history starts after the account did, contributions are
  undercounted and growth is overstated, silently and in the flattering
  direction. So the gap is measured and the card says so rather than letting
  the figure pass as measured; an account with no baseline gets no figure and
  the action that fixes it.

  The chart deliberately does not draw a growth curve — undated growth has no
  date by definition, and spreading it across the months would draw a line
  through measurements nobody took. It is a labelled block at the right edge,
  and capital plus posted growth plus undated growth equals the balances on the
  cards below, so the chart cannot disagree with the tiles above it. The
  annualised rate is marked approximate wherever it appears, and withheld
  entirely under a year rather than annualising a few months of noise.

  Accounts can now be edited from the Savings page, reusing the Accounts page's
  own editors rather than a second copy — so the fields a type offers and the
  frontmatter keys written keep exactly one owner.

### Changed

- The input modal grows a multi-line field type, used for a note's first
  paragraph. Enter no longer submits from inside one, which would have made
  every multi-line field silently single-line.

## 1.15.0 — 2026-08-11

### Added

- **A budget line can be its own actual, and carry last period's hole.**
  "Previous month overspending" is not waiting for a transaction to arrive. The
  money already left, in an earlier period; this period's row is the provision
  that funds the hole. Budgeted as an ordinary row it read "R1 900 left" all
  month — the exact opposite of the truth — the Dashboard drew it as a full
  green bar, and Total spent was short by the same amount, because there was
  nothing for the period summary to find.

  A category can now carry `assume_spent: true`, and its budgeted amount **is**
  its actual, on the Budget page and in the Dashboard's category table alike.
  The flag lives on the category rather than on the period row, because the
  answer holds in every period the row appears in — including periods whose file
  was written before the flag existed. It is toggled from the row itself.

  **Pull overspend** fills such a row from an earlier period's deficit — what
  actually went out, less what actually came in — behind a confirmation that
  names the period, the figure, and what the row currently says. How far back to
  look is `overspend_lag` in `Settings.md` (default 1, clamped 1–12), because a
  credit card settles in arrears: the hole funded in August is often June's.

  The deficit counts real transactions only, and deliberately excludes
  assume-spent rows — counting those would carry one overspend forward again the
  next period, and again the one after, compounding off no bank line at all. The
  flag defaults off, so every existing vault behaves exactly as it always did.

### Fixed

- **The "What's left" bar disagreed with the figure above it.** The bar split
  the cash on one set of commitments while the "actually free" number directly
  above it used another; under a settlement cycle those differ by the whole card
  balance, so the green segment was visibly smaller than the figure it sat
  beneath. The screen-reader label announced a cash, a committed and a free that
  did not sum — a sentence there is no way to correct by looking. The bar is now
  derived from the free figure itself rather than from a second guess at what
  went into it, and once commitments exceed the cash the label stops offering
  "{free} is free" for money that is not there.

### Changed

- **Figures about the outside world now carry their provenance.** Every SARS
  bracket, National Credit Act cap and lending rate has moved into a single
  ledger where each records what it claims in words, the primary source it was
  read from, the date it was last read, and a date after which the build fails
  until someone checks it again. No figure changed; the calculators return
  exactly what they returned before.

  The reason is the class of failure this app has already had. It shipped a SARS
  transfer-duty table whose top brackets appear in no published table from any
  year, National Credit Act caps described to the reader as statutory maximums
  that nobody had read from the regulation, and a tax threshold that would have
  told compliant savers they owed a penalty they did not. Each was a bare
  number, and a bare number cannot say whether it was checked last week or
  invented.

  Four figures now state plainly that nobody has ever verified them against a
  primary source — the prime-rate default, the conveyancing cost anchors, the
  vehicle insurance estimate, and the 36% debt-to-income reference. That is a
  deliberate value, not a gap: "nobody has checked this" and "checked against
  SARS last week" used to be the same thing on screen.

- **Every view now has a test that runs it.** The Debt page threw on every
  render for the whole of 1.13.0, and forty-nine green suites did not notice,
  because no test ever called the page — the arithmetic beneath a view is easy
  to cover and reads, at a glance, like coverage of the view. All thirteen views
  are now mounted and rendered in four states: populated, empty as a new install
  is, twice over as the app repaints on every period change, and on a period the
  vault has no data for. Nothing else was found broken.

## 1.14.0 — 2026-08-11

### Fixed

- **The Debt page did not open in 1.13.0.** The Debt-free tile's new caption
  reached for a value declared inside a different function, which is a
  ReferenceError the instant the page draws its tiles — and unlike the
  Dashboard, this view has no per-card guard, so the throw escaped into the
  view dispatcher and the page never rendered at all. If you are on 1.13.0 and
  the Debt page appeared blank or frozen, this is why, and updating fixes it.
  Nothing was written to your vault and nothing needs repairing; only the
  drawing of that one page was broken.

  It shipped because `views/debts.js` had no test that ever *called* it. The
  arithmetic underneath it is covered thoroughly, and coverage of the maths
  reads like coverage of the page — so all forty-nine checks were green while
  the page was dead. There is now a render test that mounts the real view and
  fails on a throw; `node --check` cannot catch this class, because an
  out-of-scope name is perfectly valid syntax.

- **Stated monthly income moved by up to 50% from one period to the next.** The
  figure the Debt page divides by to work out what share of your income goes to
  debt was averaged over a window measured in *periods* — thirteen weeks, say —
  chosen because thirteen weeks is 2.99 months and was believed to catch three
  paydays every time. It does not. A monthly payday recurs every 28 to 31 days,
  so whether a fixed span of days contains two of them or three depends on where
  in the month the span happens to start, and no length fixes that: swept over
  every start date, every candidate from 63 to 366 days holds a varying count —
  even a full year holds eleven paydays or twelve.

  A household earning R40 000 a month could see that figure read anywhere from
  R26 758 to R40 137 depending only on which week they opened the app. The
  window is now three calendar months, which is exact rather than approximate:
  step back three months and you have stepped over exactly three monthly
  paydays, whatever days they fall on. Measured across the same sweep, it holds
  three every time. The same household now reads R40 000, every week.

- **A long-running debt could be told its balance was hundreds of thousands
  out.** The "schedule says" chip projects from a debt's original amount and its
  start date — but neither is editable in the Debt table, and adding a debt
  seeds them from today. Correct the original amount by hand in `Debts.md`, as
  the app itself suggests, and the start date silently stays at the day you
  added the row: a twenty-year bond then projects one month of amortisation and
  announces a six-figure discrepancy in the alarming direction. The chip now
  stays silent when the pair cannot describe one continuous debt — a balance can
  only fall by cash actually paid, and that is a bound, not a guess — and when
  it does appear it names the date it is projecting from, in the text rather
  than in a tooltip no phone can show.

- **Two different charges of the same amount could be treated as the same one.**
  Near-duplicate detection compared the first eight characters of a description,
  which was calibrated on merchant names — but every bank prefixes its
  descriptors, and "Card Purchase" alone is twelve. So a R450 charge at one shop
  quietly un-ticked a R450 charge at another two days later, and the import
  dropped a real transaction unless you read every row. The comparison now
  strips the bank's own verb before looking at the merchant. Duplicate detection
  was also blind at the very edge of a statement's date range, which is exactly
  where a re-dated pending charge lands.

- **The "What's left" card contradicted itself.** With a settle-monthly card in
  the picture, the headline showed one figure while the per-day rate, the "this
  leaves you short / covered" sentence and the bar's screen-reader label were all
  derived from a different one — so the card could read "R28 800 free" above
  "R1 486/day" for a fortnight, and say *short* directly beneath *free*. There is
  now one figure, and everything on the card comes from it.

- **A household exactly break-even was told it was short.** Whether you are
  short was decided by the sign of a floating-point subtraction, so cash of
  R4 001.60 against debits of R1 000.70 and R3 000.90 came out at minus
  0.000000000000455 and rendered as "R -0,00". Net worth had the same edge.
  Both now compare in cents.

- **Copy-pasted amounts could silently import as zero.** A minus sign copied
  from a PDF statement or a bank's web page is often the Unicode minus, not the
  ASCII one, and the amount reader did not recognise it — so a R100 debit
  contributed nothing to every total while the original text sat correctly in
  the file. A leading `DR`/`CR` marker had the same problem, though the trailing
  form worked. Both are read now.

- **A refund reversal in a Credit column imported as income.** Money-in cells
  were forced positive regardless of what they said, so a `-30.00` posted in the
  Credit column — money out — became `+30.00`.

- **A category named `constructor` or `__proto__` blanked the spending donut.**
  The per-category accumulator was a plain object, so those names collided with
  JavaScript's own, and the chart rendered "nothing to show" while real spending
  sat in the period.

- **The CSV export double-counted split transactions**, with no way for the
  reader to correct it: parent and parts both appeared, and the parent's only
  marker was identical to an ordinary transfer, so filtering it out also deleted
  every transfer. Both exports now carry a Split column. Amounts also export as
  the parsed number rather than the raw cell, so a grouped-thousands figure is no
  longer silently read as text by a spreadsheet and left out of the total.

- **Donut percentages did not add up to 100** — each slice was rounded on its
  own, three separate times per chart, so the legend, the tooltips and the
  screen-reader label could disagree with each other as well as with arithmetic.
  Largest-remainder allocation now shares one set of figures across all three.

- **The home-loan calculator did not charge the monthly service fee its own
  costs note advertises** — R16 560 over a twenty-year bond, absent from the
  monthly figure a buyer checks affordability against.

- **Changing the month start day silently moved every historical budget.**
  Budget files are named by month and keep their names while the window they are
  measured against moves, so budget-vs-actual for past periods could change by
  more than double with nothing on screen. It now warns, as the two settings
  either side of it already did.

- Smaller: an annual recurring charge could be given a date that does not exist
  (29 February in a non-leap year); a non-finite amount rendered as
  "R NaN,undefined"; and `contributionRate` — a savings comparison no screen
  ever called, carrying twelve passing assertions — has been removed rather than
  left looking like a feature.

### Changed

- The Debt page's income note now says "the last 3 complete months" rather than
  naming a number of periods, because that is what is now measured.

## 1.13.0 — 2026-08-10

### Added

- **Plan — a new page for money that arrives once.** A budget is a rate: R4 000
  a month on groceries, every period, forever. A windfall is not. When a UIF
  payout, a tax refund, a bonus or the proceeds of something you sold lands in
  the account, the question is not *what is our monthly allowance* but *where
  does every rand of this particular sum go* — and the Budget page has no way to
  ask it. Plan does, and lives under Budget in the menu because it is a thing
  you keep rather than a calculator you visit.

  A plan is funded by **sources you name yourself**. Anything at all: a payout,
  a refund, next month's salary surplus, a gift, a sale. Each carries an amount,
  a date and a free-text kind — *UIF*, *Tax*, *Salary*, *Bonus*, *Gift*,
  *Once-off*, or your own word — where the kind is only a label and the date is
  what does the real work. A source dated in the future counts toward what you
  can plan with but not toward what you can spend this afternoon, so the page
  states both figures and never lets the second be mistaken for the first.

  The money is divided into **envelopes**, each with a slider that visibly takes
  from what is not yet spoken for. An envelope's amount is deliberately *not*
  the sum of the items listed inside it: you decide that R12 300 goes to the
  baby before you know the four things you will buy, and the card reports the
  difference as *unassigned* rather than quietly forcing the two to agree. Items
  cycle planned → part-bought → done, and a part-bought item shows both what has
  gone and what was planned, because neither figure alone is the answer.

  One bar across the top says what has happened to the whole sum — already
  spent, spoken for, not spoken for — and the card underneath it goes loud while
  anything is unplaced and disappears entirely once the split balances. Leaving
  money unallocated is a decision too; it should just be one you made rather
  than one you forgot.

  Saved as `Plans/<name>.md` — three markdown tables in one file, hand-editable
  like every other page, with any frontmatter the plugin does not model left
  untouched.

- **An account can now state its own currency.** Put `currency: "€"` in an
  account's frontmatter and that account's own figures print in it — the
  balance cell, the drawer, the dialog that edits it. A euro account reads
  `€ 1 200,00` instead of claiming to hold twelve hundred rand. The separators
  do not move: a South African reading a euro balance still reads `1 234,56`,
  because that convention belongs to the person reading the figure rather than
  to the currency it is denominated in. Accounts without the key print in the
  household currency exactly as before, so a single-currency vault — nearly all
  of them — needs no frontmatter and changes in no way.

  What it deliberately does **not** do is convert, or exclude. No conversion,
  because an exchange rate is a fact about a *day*, and this vault does not hold
  one; storing a rate would mean every figure derived from it silently ages, and
  a household total that was right last month is the worst kind of wrong,
  because it looks exactly like one that still is. No exclusion, because
  `budget: false` is already the single mechanism for keeping an account out of
  the household totals, and a currency rule layered on top would be a second,
  invisible one — which is how a reader ends up unable to explain their own
  total.

  So a total that spans more than one currency is still added up, and now says
  so. The Accounts hero names the symbols it folded together, and a group total
  that mixes them carries an asterisk explaining the same thing. A disclosure
  you can act on — opt the account out with `budget: false`, which you already
  know how to do — beats a silent rule you cannot see.

- **Warnings you have already answered can be switched off, per account.** Some
  accounts are permanently odd in a way that is not a problem: a cash float
  nothing imports into, a pension whose statement arrives once a year. Both sat
  in the Accounts queue forever, and a queue that always has something in it is
  a queue nobody reads. `ignore_warnings:` in an account's frontmatter — or the
  switches in the account dialog — quietens any of the five: the balance
  drifted from the transactions, it has not been confirmed recently, it was
  never confirmed, nothing has imported yet, or no folder is linked at all.
  Write `true` for all of them or list the ones you mean; spellings normalise,
  so `no_transactions`, `no transactions` and `no-transactions` are one
  instruction. A word it does not recognise is dropped rather than read as
  "mute everything" — guessing wide on a typo would hide the very state you
  were trying to name.

  A muted account **keeps its state**. The row still shows the pill saying what
  the balance actually is; only the queue, the attention count and the "Needs a
  look" filter let it go, and the hero counts how many warnings are being
  ignored so the quiet is never invisible. Reporting it as fine instead would
  have been fewer lines and a lie: a figure nothing has ever confirmed does not
  agree with your transactions, it is merely one you have said you do not want
  asked about. That distinction is the whole reason this is a mute and not a
  fix.

### Fixed

- **Six ways a statement import could write wrong figures into your vault, and
  one that could quietly delete real income.** A six-agent audit went through
  the money paths and ranked what it found by a single question — *does it
  write?* — because a wrong number on a calculator screen is one page refresh
  from correct, while a wrong number in a markdown file is there until someone
  notices. These are the ones that wrote.

  **A filtered bank export could import the running-balance column as every
  transaction amount.** Column detection knew three states — reconciled,
  provably-not-a-balance, and not-enough-file-to-tell — and guarded only two of
  them. A "debits only" export whose balance column has gaps cannot reconcile,
  and that was read as proof the column was not a balance at all. On a realistic
  file that turned R4 756 of spending into R148 108 of income, and because the
  fall-through also cleared the balance-column index, the review screen's
  reconciliation banner was hidden entirely — including the warning written for
  precisely this case. Anything that cannot prove itself now opens the manual
  column mapper. More files will land there, which is the right trade: a file
  you map by hand is a file you looked at.

  **A credit-card statement imported every purchase as income.** A card's
  balance column is the amount owing, so it rises when you spend, while every
  asset ledger falls — and both reconcile perfectly under some sign. Read as an
  asset, a card statement verified cleanly and reported that its signs were
  already right, under the most reassuring sentence the review screen has. The
  account settles what the arithmetic cannot, so a card account now inverts the
  expected relation.

  **European dates filed into the wrong month.** `DD.MM.YYYY` is the ordinary
  format across the whole EU profile, and the date rules accepted only `/` and
  `-`, so every such cell fell through to JavaScript's `Date` constructor — the
  one path this app's own date parser exists to avoid. Measured against both
  engines: `03.04.2026` became 4 March on the desktop and was dropped on the
  phone; `JUN 12` produced a different *year* on each. Since the same test also
  decides which column is which, a file's whole layout could resolve differently
  on an iPhone than on a laptop. Dotted separators are handled properly and the
  fallback is gone, so an unrecognised cell is now reported as skipped rather
  than guessed at.

  **A hand-typed amount in Owed Money or Services was destroyed on save.**
  Three columns still used a lenient number reader that stops at the first
  character it cannot use, so `1 500,00` loaded as R1 and `R4000` as nothing —
  and because saving writes the parsed number straight back, one click made the
  truncation permanent. A R4 000 loan with a part-payment recorded read as
  *Paid* and left the totals entirely.

  **An import whose account could not be identified arrived pre-excluded.**
  Statements routinely quote their own account number, and the guard that stops
  those rows being tagged as transfers needs to know which account the file
  belongs to. When the filename gave nothing away the guard was inert, so every
  such row was ticked *Exclude* — written to disk, and vetoed from income and
  spending for good. The suggestion now follows whichever account the review
  screen has actually settled on, while leaving alone any row you have ticked
  yourself.

  **Splitting a row that was already part of a split counted the money twice.**
  The intermediate row stopped being a part and became a parent, so every reader
  that skips parts counted it as a line the bank had printed: one R1 000 charge
  totalled R1 600. Splitting a row that already carries a split role is refused.

  **A split could be approved for one set of amounts and write another.** The
  balance check rounded the total while the save rounded each part, so three
  thirds of R100 typed as `33.333` reported *balanced* and then wrote R99.99 —
  and since the original row is excluded on the way out, the missing cent left
  the budget. The gate now weighs the values it is about to write.

  Also: two different sanitisers could turn one account name into two different
  folder paths, so a `tx_label` differing only in case could stop a month's
  transactions importing; and impossible dates like 30 February were accepted,
  filed, and used as duplicate-detection keys.

- **Figures the app stated as fact about South African tax and credit law,
  which were wrong.**

  **The SARS transfer-duty table above R2 329 300 was not SARS's.** The bracket
  boundaries and base amounts appear in no published table from any year, under
  a note calling the result *exact arithmetic on the published table*. The tell
  was arithmetic: a real table's published base equals the duty compounded from
  the band below it, exactly, and this one was two rand out — a gap that had
  been explained away as a rounding quirk, hidden behind a clamp, and defended
  by a test. On a R5 000 000 house the duty was understated by R4 626. The
  published figures are in, the clamp and its test are out, and the invariant is
  asserted directly, so a base that was never published now fails the build.

  **From 1 March 2026 the tax page told compliant savers they owed a penalty.**
  SARS raised the tax-free-investment annual limit from R36 000 to R46 000 for
  the 2027 tax year. The threshold was fixed in place, and the function checking
  it had always received the tax year and never read it — so a 2027 page told
  someone who had contributed R40 000, entirely within the limit, that they
  faced a 40% penalty on R4 000, while the header two cards above read *Tax
  year 2027*. Thresholds are now keyed by tax year and each message names the
  year whose figure it used.

  **The National Credit Act fee caps were quoted as statutory maximums without
  ever having been read from the regulation.** Against Government Gazette 39379
  of 6 November 2015: the mortgage initiation fee is R1 100 plus 10% above
  R10 000 capped at R5 250, not R1 207 capped at R5 707; the monthly service fee
  is R60 excluding VAT, not R74.50. Vehicle finance was charged against the
  *mortgage* cap when it is an "other credit agreement" capped at R1 050 — on a
  R315 000 car, R3 622 against a statutory maximum of R1 207.50. All four
  figures are corrected and the wording now says the fees are *modelled on* the
  caps, and names the gazette.

### Changed

- **The Debt page stops grading your finances.** It projected payoff dates fifty
  years out, quoted total interest in the hundreds of thousands, ranked your
  debts and rendered the answer in the page's celebratory style — with no
  disclaimer anywhere and its assumptions stated nowhere you could see them.
  The debt-to-income ratio was coloured red, amber or green against a 36%
  threshold introduced as *"lenders treat above 36% as stretched"* — a United
  States mortgage-underwriting convention, unattributed, shown identically in
  all eight country profiles, and one that does not describe South African
  affordability testing at all. The percentage stays because it is arithmetic on
  your own numbers; the grade and the claim are gone, and so is the red on
  simply having any debt. *"Put every spare rand at these in order"* now reads
  *"The plan below aims spare money in this order."* The page states what it
  assumes, and says plainly that it is not financial advice.

- **"Debt-free: never" now says what is actually known.** Projections stop at
  fifty years, and anything that had not closed by then was reported as a
  payment too small to cover its own interest. That is a different statement,
  and often false: R500 000 at 11% paying R4 600 covers its R4 583 of monthly
  interest and closes in 616 months. Those dates now read *not at this payment*
  and *does not clear within 50 years*. The debt-free headline also names the
  assumptions it had been folding in silently — the what-if extra typed into the
  planner below it, and each cleared payment rolling into the next.

- **An account with no transactions folder is told apart from one with an empty
  folder.** Both used to read the same, so an account nothing imports into
  looked merely quiet rather than unconnected. The Accounts queue now names it,
  and offers the action that fixes it.

## 1.12.0 — 2026-08-10

### Changed

- **The Accounts page now names what needs deciding, and then gets out of the
  way.** It was a grid of tiles, and every tile said the same eight things about
  an account whether or not any of them mattered — at roughly 180px of height
  each, a vault with fifteen accounts was four screens of mostly-quiet cards
  with the two that actually needed a decision buried somewhere inside. The page
  already *knew* which those were: it counted them into a tile reading "Needs
  attention: 3" and then left you to go and find them.

  Three bands now, in the order you need them:

  **One figure.** What these accounts are worth between them, with a ring
  saying what it is made of — the same opening move the Dashboard makes, so the
  two pages finally read as siblings.

  **The queue.** The accounts whose stated balance cannot currently be trusted,
  most urgent first, each with the one action that settles it. An account that
  has drifted is offered its arithmetic; one that is merely old is offered a
  confirmation. It is capped at four, and the remainder is *named* rather than
  quietly dropped — a queue that scrolls is not a queue, and a silent cap reads
  as "that is all of them". When nothing wants a decision the whole band
  collapses to a single green line.

  **The ledger.** Every account as one table row — sortable, filterable,
  searchable — with everything the tile used to carry below its balance folded
  into a drawer that opens under the row. On a phone it keeps the name, the
  balance and the state, and the drawer holds the rest.

  Nothing about the arithmetic changed: the same reconciliation, the same
  utilisation thresholds, the same refusal to silently overwrite either figure.

### Fixed

- **A never-confirmed balance sorted as `Infinity`,** so two of them subtracted
  to `NaN`. A `NaN` comparator does not merely mis-sort — it is *unstable*, so
  the order could change between renders and the row you were about to tap moved
  out from under you.

- **The page's sort, filter and open row no longer reset while you are reading.**
  They lived in the view's own closure, and the file watcher re-renders the whole
  app whenever anything in the vault changes — so an import saving a file in
  another window threw away whatever you had set up.

## 1.11.17 — 2026-08-10

### Changed

- **A credit card you settle every month is no longer treated as a claim on your
  cash.** It never was one. If you run the month through the card and clear it on
  payday, the balance is this cycle's spending waiting for a salary that has been
  earned but not yet paid — and the cash sitting in your cheque account is the
  tail of *last* month's salary, which was never going to pay it. Subtracting one
  from the other produced "R16 958 short" at the same point in every single
  cycle, and a warning that fires every month is one nobody reads.

  The card now gets its own line, measured against the thing that actually
  clears it: **what went on the card this cycle, against the income due to
  settle it.** Under 100% the pattern is working and the line stays quiet. Over
  100% it turns red — because a cycle whose card spending exceeded the income
  coming to settle it is the one case that genuinely means something.

  This also fixes a feature that could never fire. The income line was gated to
  money landing *before* the period ends, but under a payday month anchored on
  payday the settling salary always lands on day one of the *next* period — so
  the only income that was ever going to clear the balance was the one income
  the card refused to look at.

  A card you carry a balance on is deliberately untouched: it stays a real claim
  and keeps its old treatment, and it is re-checked inside the calculation rather
  than trusted from the caller — telling someone with revolving debt they have
  "headroom before the 23rd" is the most dangerous sentence this card could
  print.

## 1.11.16 — 2026-08-10

### Fixed

- **"What's left" was naming the wrong end date for the period.** It read
  "Before this period ends on Aug 26" while the header at the top of the same
  screen read "Jul 23 – Aug 22, 2026". The 26 was the *year* — the subtitle was
  built with the trend chart's axis label, where "Aug 26" correctly means August
  2026, and handed it a date instead of a period. It now names the day, and the
  two agree.

## 1.11.15 — 2026-08-10

### Added

- **"What's left" now shows the card settlement as its own figure, and says what
  is coming in.** A card you settle every month was being folded into "still
  committed" alongside your debit orders — where seventeen thousand rand of card
  hid a ninety-five rand Spotify order and neither could be checked. It now gets
  its own column, so the card reads as one line of arithmetic you can add up:
  what you hold, less the debit orders, less the card, leaves what is actually
  free. Set `settle_monthly: true` on a credit-card account to turn it on. A card
  you carry a balance on is deliberately left alone and still just disclosed
  beside the figures — it is not due this period, and claiming it would be wrong.

- **The card can now tell you that payday is coming.** When your transactions
  prove a repeating credit — the same payer, a monthly rhythm and a steady
  amount — it says what lands and when, and whether that covers what you owe. So
  a figure that reads "short" says *short until the 23rd*, which is the question
  actually being asked.

  It refuses far more often than it answers, deliberately: three occurrences at
  minimum, a monthly gap, the last three amounts within 15% of each other, and
  nothing you have excluded. Irregular income gets silence rather than a guess.
  This matters more than it sounds — a plain average of everything landing in one
  real account came to R61 000 against a true salary of R40 240, because it had
  quietly folded in a second earner who had stopped months earlier, a payment
  that arrived one day and left the next, and two insurance claims.

### Fixed

- **A service that bills under more than one name is no longer dropped from
  "What's left".** Providers rename their debit orders — one real vault has eight
  different descriptions for the same phone contract — and the card was reading
  only the most common one. So a live service whose last charge under that name
  was months ago projected a due date in the past and vanished from the committed
  figure entirely, while a charge that had already gone off under a new name was
  still being counted as coming. On the vault this was found in, two services
  worth R1 185 a period were invisible. The price still comes from the merchant's
  main description; only the timing now follows every name it bills under.

## 1.11.14 — 2026-08-09

### Added

- **"What's left" now says what you owe on your credit cards.** The card
  answers how much money is free before the period ends, and it was building
  that answer out of your cheque account alone. Spend on a card and settle it
  later — for the points, or the interest-free weeks — and the cheque balance
  it reads is money already claimed by a card sitting in another account the
  card never looked at. On the vault this was found in, it reported R 53
  actually free beside R 17,011 outstanding on a credit card, and said nothing.

  A line beneath the figures now states the outstanding total and names the
  card. Deliberately a sentence rather than arithmetic: **cash, committed and
  free are all unchanged by it.** Folding a card balance into cash would report
  money the household does not have; folding it into *committed* would claim it
  leaves the cheque account before the period ends, which for a card topped up
  several times a month cannot be placed — and asserting what cannot be placed
  is the one thing this module's rules forbid. So the figures stay honest and
  the missing fact goes on screen next to them.

  It uses the implied balance, so a settlement made since you last confirmed
  the balance is already taken off, and it stays quiet for a card in credit, an
  undated balance, or an account you have excluded from the budget.

- **A credit card you clear in full each month can now count as committed.**
  Opt in per account with `settle_monthly: true` in the account note, and the
  outstanding balance is treated as a charge still to come rather than as a
  card you revolve — it appears in "What's counted" with the rest. Off by
  default, because a card genuinely carried at interest belongs on the Debt
  page and must keep behaving like one.

### Fixed

- **"N accounts" under the cash figure no longer counts accounts that put
  nothing into it.** The count incremented before the balance was tested, so a
  credit card at −R 8,874 — which contributes nothing to spendable cash, by
  design — still padded the line printed directly beneath the total it formed
  no part of. It now describes what the figure is actually made of.

## 1.11.13 — 2026-08-09

### Fixed

A pass over every figure the plugin asserts — the arithmetic modules and the
screens that render them. Nothing here changes how anything looks; it changes
what several numbers actually say.

- **The Dashboard's spending figures now reconcile with each other.** "Total
  Spent" counts every outgoing row; the donut below it leaves uncategorised rows
  out and nets a refund off inside its category. Both are right for what they
  are, and both make the donut smaller than the figure above it — with nothing
  on screen to say why. The donut now declares the whole difference: what was
  uncategorised and not shown, and how much was refunds netted off. The two
  figures tie to the cent on every period.

- **An account whose balance you have never dated is no longer counted as
  spendable cash.** "What's left" is built on what your accounts *should* read
  now, and an undated balance cannot be placed at all — the card says so for
  accounts that have transactions. An account with a stated balance and no
  imported transactions slipped past that check and had its full figure counted
  as cash. It is now named as unconfirmed, like any other undated balance.

- **A minus sign inside a currency symbol is no longer read as zero.** A cell
  written `R-100` (rather than `-R100`) failed to parse, and an unparseable
  amount falls back to **0** — a wrong number that looks like an empty cell.
  Both spellings now read correctly, in every currency, and a bare `.50` parses
  too. A damaged cell like `--100` is still refused rather than guessed at.

- **A statement whose money-in and money-out columns are the wrong way round is
  now flagged.** Every import is checked against the statement's own running
  balance. When that check *disproves* the columns, the amounts are deliberately
  not auto-corrected — the signs came from the column names, so the mapping is
  what is wrong. But the review screen was showing "amounts check out" on
  exactly those files. It now says the columns look swapped and points at
  "Columns wrong?".

- **The debt payoff curve no longer loses a plan that never clears.** The chart
  was scaled to the opening balance, on the assumption that a plan starts at its
  highest point. A payment at or below the monthly interest makes the balance
  *rise*, so that line was drawn off the top of the chart and vanished — which
  reads as a broken chart rather than a debt going the wrong way. It now scales
  to the tallest point on screen.

- **The Debt page's projected balance no longer counts a part-month as a whole
  one.** A debt starting on the 31st and read on the 1st was credited a full
  instalment for one day elapsed, reporting the debt smaller than it is. Only
  completed months count now, with a short month billing on its last day.

- **The Savings page's monthly-contribution rate divides by the months the
  account has actually existed**, not by the months asked for. A fund opened
  part-way through the window was reporting a fraction of its real rate, and
  that figure is there to be checked against what you said you contribute. A gap
  in the middle of the window still counts — that silence is real.

- **A subscription's billing day is a whole day.** An even number of recorded
  charges could report "billed around day 15.5".

- **Loan calculator: the vehicle initiation fee now includes VAT**, like the
  mortgage one and like what a lender actually debits — it was capped against a
  VAT-inclusive maximum but returned without VAT. **Transfer duty** no longer
  dips by two rand at the top bracket boundary, where paying more for a house
  briefly cost less in duty.

- **The tax page's capital-gains check no longer overstates what is taxable.**
  Gains above the annual exclusion are subject to a 40% inclusion rate for
  individuals; the message was presenting the whole excess as taxable income,
  overstating it two and a half times.

- **Smaller Dashboard corrections.** The Debt tile no longer reads "0 active"
  while showing a balance. Categories you spent in but never budgeted for now
  show what they cost in the Remaining column instead of a blank cell. The trend
  chart's budget line breaks across months you never budgeted rather than
  claiming you budgeted nothing. The "% allocated" figure is measured against
  budgeted income rather than income that happens to have landed so far. The
  staleness note now says how far behind your balances are.

## 1.11.12 — 2026-08-09

### Added

- **The Dashboard's range pills now follow the size of your vault.** "Spending
  Trend" and "Where it went" each offered 3M, 6M and 1Y and stopped there — the
  same menu whether the vault held eight months or eight years. Past a year of
  imported history both gain **All**; past five years both gain **5Y** as well.

  Each is earned rather than fixed, because a pill that draws the same picture
  as the one beside it is a control that appears to be broken. On three years of
  statements a five-year range, an all-time range and a 1Y range clamped to the
  data are the same chart three times over — so 5Y stays hidden until there is
  more than five years to tell it apart from All, and All stays hidden until
  there is more than a year to tell it apart from 1Y. Under a year, neither
  appears and nothing changes.

  Picking All draws every period the vault holds and drops the "all the history
  imported so far" note, which existed to explain a shortfall All does not have.
  A range you had selected that the vault no longer earns — 5Y after the oldest
  statements are removed — falls back rather than leaving a chart on a span with
  no pill lit to say so.

### Changed

- **"Where it went" compares like-for-like while a period is still running.**
  Nine days of August were being measured against three whole Julys: every
  category that bills late in the month showed a large green fall, every
  category that bills on the 1st showed a rise, and both figures were reporting
  nothing but today's date. The card said spending was down 39% on food in a
  month that had barely started. Each earlier period is now counted only as far
  into itself as this one has run, and the card says so underneath.

- **The change column speaks in rands, not percentages.** It used to print a
  percentage above a size threshold and rands below it, which put two units in
  one column with an invisible rule choosing between them — a category could
  switch unit between months without changing its own behaviour, and a reader
  who wanted to know what "−39%" cost them had to work it out themselves. The
  proportion is not lost: the baseline sits in the column immediately to its
  left. The baseline column also now carries the same wording as the pill above
  it, rather than deriving "12M" over a pill that reads "1Y".

- **Relicensed to the GNU Affero General Public License v3.** Budget Vault stays
  free to use, change and share, personally or commercially. What changes is
  reciprocity: a modified version that is distributed — or that other people are
  given access to over a network — must reach those people under this same
  licence, with its source. Releases up to and including 1.11.11 were published
  under MIT and remain MIT for anyone holding a copy of them; a licence already
  granted cannot be withdrawn. `NOTICE` carries the full history.

## 1.11.11 — 2026-08-09

### Added

- **"What's left" — a new card on the Dashboard, directly below the hero.** The
  hero tells you how much *budget* is left. On day 3 of a period that reads like
  a fortune, while the medical aid, the bond and four debit orders have not gone
  off yet. This card tells you how much *money* is left: what your accounts
  hold, less the charges already scheduled against them before the period ends,
  and what that leaves you per day for the days remaining.

  It counts only charges it can stand behind. A charge that has already gone off
  this period is spending, not a commitment, so it is not counted again — and the
  card names what it left out. Amounts are what was really charged last time, not
  the figure typed on the Services page. Your budget targets are deliberately not
  included: a budget is an intention, not a debit order. And a charge it cannot
  place a date on is not claimed at all, so a weekly budget period never asserts
  a monthly instalment it has no way to date.

  Cash is what your accounts *should* read right now given everything recorded
  since you last confirmed a balance — and an account whose balance carries no
  date is named rather than quietly counted as empty. Open **What's counted as
  committed** to see every charge behind the figure, when it is expected, and
  where its amount came from.

- **"Where it went" now says how this period compares.** Pick a range — last
  month, 3, 6 or 12 months — and each category gains two columns: what it
  averaged over that range, and how far this period has moved from it. Up is
  red, down is green.

  The average covers *completed* periods only. Including the period you are
  standing in would compare a part-month against full ones and paint everything
  green for the first three weeks of every month. A category with too small a
  base shows the rands that moved rather than a percentage that would be
  arithmetically true and practically meaningless, anything within 3% carries no
  colour at all, and a category with no history reads "new" rather than "+100%".

## 1.11.10 — 2026-08-09

### Added

- **The Spending Trend chart can now be inspected.** Pointing at it names the
  period and its three figures, and marks the point being described: a dashed
  crosshair, an enlarged spent dot haloed in that period's own colour — red
  where it broke its budget — small markers on the income and budget lines, and
  the two line legs either side thickened.

  Hover, touch-and-drag and the arrow keys all drive the same readout, which
  carries Spent, Budget and Income against the chart legend's own labels and
  closes on how far under or over budget the period landed. A period with no
  budget set simply drops that row rather than claiming a budget of zero.

  The whole chart is now one hit area resolving to the nearest point, replacing
  the tooltip hung off each dot. A dot is five units across in a thousand-unit
  drawing — about four pixels on a phone — and reaching one with a finger was
  never realistic. The readout is placed as a fraction of the chart rather than
  in pixels, so it lands on the point at any card width, anchors inward at the
  first and last periods instead of hanging off the edge, and flips below the
  point when the point sits too near the top of the card to have room above it.

  Because the chart takes a tab stop now, it also answers the keyboard: arrows
  walk period by period, Home and End jump to either end, Escape dismisses.

### Fixed

- The pointer tooltip on the trend chart was written in English regardless of
  the interface language. It now uses the same translated labels as the legend
  above the chart.

## 1.11.9 — 2026-08-09

### Fixed

- **A split transaction is no longer counted twice against your account
  balance.** Splitting a charge keeps the row the bank actually printed, marks
  it excluded, and adds the parts beneath it. But "excluded" only ever meant
  *out of your income and spending totals* — anything measuring the **account**
  rather than the budget reads excluded rows on purpose, because an internal
  transfer is out of the budget and the money still left the bank.

  So everything that correctly refused to skip excluded rows was, by that same
  refusal, adding split parents to its totals. A R1,000 grocery charge split
  into R600 and R400 moved the implied balance by R2,000. The Accounts page then
  reported drift that did not exist and offered **Use this** on a figure short
  by the whole charge — and accepting it stamps today's date, which is exactly
  what stops those rows counting again, so the wrong balance became permanent
  and silent.

  Four figures were affected, none of them in your budget totals: the implied
  balance on Accounts and on Savings & Investments, the "in / out / N
  transactions" line on an account card, and derived contributions, growth and
  withdrawals on a savings account.

  A split parent now carries a role of its own alongside the Excluded tick, so
  the two meanings stop sharing one cell. It takes both, deliberately: a split
  stays reversible by hand, and unticking Excluded in the markdown has to bring
  the row back everywhere at once rather than in half the app.

  Two smaller faults went with it: a split subscription charge counted as two
  charges by the Services page, dragging the price it reports and the next
  billing date it derives, and the importer indexed the parts as though a
  statement had carried them, so a genuine later transaction matching a part
  could be flagged a duplicate and dropped.

  **If you have split a transaction and accepted an implied balance since,**
  that account's balance may be understated by the split amount. The stamp
  removes the evidence, so nothing can correct it after the fact — confirm the
  balance against your bank once and it is right from there on.

### Changed

- **Transaction files gain a `Split` column — but only the ones with a split in
  them.** Appended at the end, so a file written before it existed loads
  unchanged. A month with no split keeps the exact six-column shape it has
  always had rather than gaining an empty column that records nothing.

## 1.11.8 — 2026-08-08

### Changed

- **The build is now declared where it can be verified.** Obsidian's community
  scorecard checks a release by cloning the source and rebuilding it, then
  comparing the result to the published `main.js`. This repository had no
  `package.json` and no lockfile — the build was a shell script calling `bun` —
  so there was no build the check could run, and it reported the release as
  unverifiable.

  The bundle is now built by `esbuild`, pinned in `package-lock.json` and
  declared in `package.json`, with `build.sh` reduced to a wrapper so the local
  build and the verified build cannot drift. A clean clone rebuilds `main.js`
  byte-identically.

  `main.js` is about 7% larger than before (514KB to 549KB) because esbuild
  minifies less aggressively than bun. Nothing about what the plugin does has
  changed, and the syntax floor is unchanged — the bundle still targets the
  Safari 15 engine that older iPhones run.

## 1.11.7 — 2026-08-08

### Fixed

- **Publishes a current version for the community listing to pick up.** The
  manifest had moved to 1.11.7 with no matching release, which Obsidian reports
  as "no release matches your manifest version" and which blocks scanning and
  distribution entirely.

  No functional change. The code is identical to 1.11.4.

### Changed

- **Relicensed back to the MIT licence.** Budget Vault is free to use, modify
  and redistribute, including commercially. This reverses the PolyForm
  Noncommercial change made in 1.11.2; releases 1.11.2 through 1.11.6 remain
  under PolyForm Noncommercial, and this applies from 1.11.7 onward.

  MIT is a licence GitHub recognises, so this also clears the directory
  review's "the repository does not have a recognized license" finding.

## 1.11.6 — 2026-08-08

### Fixed

- **Re-fires the community scorecard's build verification.** The HIGH finding
  ("release build could not be verified against the private source repository")
  is pinned to the scan that produced it and only clears on a new release event.
  Two earlier attempts were spent before the underlying state was actually
  sound: 1.11.4 landed while the repository was private again, and 1.11.5 was
  cut while seven release tags still pointed at commits a history rewrite had
  orphaned, so a clone could not reach the source those releases were built
  from.

  Both are fixed now — the repository answers 200 to an anonymous request, every
  tag from 1.7.1 onward matches the commit its release was built and attested
  from, and 1.11.5 was confirmed to rebuild byte-identical to its published
  `main.js` from a clean anonymous clone.

  No functional change. The code is identical to 1.11.4.

## 1.11.5 — 2026-08-08

### Fixed

- **The community scorecard could not verify the build.** It reported "release
  build could not be verified against the private source repository" — the scan
  clones the source to rebuild it, and the repository was briefly private while
  the licence was being settled. Attestations kept passing throughout, which is
  what made the finding confusing: the provenance was never in doubt, only the
  clone. The repository is public again, and this release exists to trigger a
  fresh scan, because the finding does not clear on its own when visibility
  changes back — it is pinned to the scan that failed.

  No functional change. The code is identical to 1.11.4.

## 1.11.4 — 2026-08-08

### Added

- **An account can be made from wherever one is asked for.** Creating an account
  used to live only on Accounts and Savings & Investments, so an empty vault
  dead-ended on "add an account first" with no account page in sight. The
  Transactions toolbar and the import review now offer it too, and the import
  review selects the new account as the destination for the rows on screen.

### Fixed

- **The Transactions filters follow the language.** Switching language left
  "All accounts", "All categories" and "Uncategorised" in the previous one.
  The filter selects are deliberately not rebuilt when their contents already
  match — a blind rebuild drops the reader's current selection — but the check
  compared only the account and category names, which a language switch does
  not touch. It therefore held on exactly the render that had to run.

## 1.11.3 — 2026-08-08

### Fixed

- **A period name could name a century nobody meant**, and the tab described a
  cycle it was not running.

### Changed

- The store description now promises the screens that are actually translated
  rather than all of them, and says what the app does instead of only what it
  does not do.

## 1.11.2 — 2026-08-07

### Changed

- **Relicensed to PolyForm Noncommercial 1.0.0** — free for any personal use,
  commercial use not permitted. A NOTICE file records the change.

  Releases up to and including 1.11.1 were published under the MIT licence and
  remain available under it; a licence already granted cannot be withdrawn from
  copies already distributed. The change applies going forward.

  PolyForm Noncommercial is not an OSI-approved licence — by definition, since
  a noncommercial restriction is not open source — so GitHub reports NOASSERTION
  and the directory review warns "no recognized license". That is the standing
  cost of the choice, not a defect.

## 1.11.1 — 2026-08-07

### Fixed

- **Two German strings told you to do the opposite of what they meant.** The
  category step of the setup wizard and the split-transaction warning both said
  *abhaken* — to tick — where the instruction is to **un**tick. Anyone following
  them literally selected every category they had just been told to remove.

- **Grammar across the seven language tables.** Afrikaans had a clause with no
  verb ("waarheen die geld is"), a promise that never finished ("gratis en sal
  altyd wees"), and a plural sentence that referred back to its subject in the
  singular. German had "davon aus gezählt" twice, which is not German. Spanish
  paired a perfect tense with *hace tiempo* in a way that does not parse.

- **Words that were the wrong word.** Afrikaans used *hardloop* — to jog — for
  running the setup wizard. Spanish used *debido* ("due to") for money owed,
  against the *adeudado* used everywhere else. French listed loan tools as
  *calculateurs* rather than *simulateurs de prêt*.

- **Two labels read as nouns instead of verbs.** On the account form, Spanish
  "Cuenta para el presupuesto" and French "Compte dans le budget" both read as
  *account*, not *counts*. They now read as the setting they are.

- **Counts no longer disagree with their nouns.** Seven strings interpolated a
  number without a singular form, so a single item read "1 dae", "1 jours",
  "1 Tagen", "1 días" — and in English, "over the last 1 periods". Each is now
  a plural entry with its own singular, and the views pass the count that
  selects between them.

### Changed

- **Two sentences carried two independent counts each**, which no plural rule
  can agree with at once. Both were reworded so each number follows a label
  rather than preceding a noun that has to match it.

- The debt breakdown on the dashboard read "{amount} accounts" because it
  interpolates money into a slot the wording treated as a count. It now reads
  "{amount} on accounts".

- Spanish and French page names dropped English Title Case — "Dinero adeudado",
  "Sommes dues", "Épargne et placements" — with every in-sentence reference to
  those names updated to match.

- Typographic consistency per language: straight quotes in English and
  Afrikaans, full-width colons and parentheses in Chinese, question marks rather
  than full stops on Japanese questions.

## 1.11.0 — 2026-08-07

### Added

- **The Accounts page is translated.** Group headings, account types, the four
  summary tiles, every card — balance, badges, activity line, the
  reconciliation prompt and its "Use this" button — plus the edit and new-account
  forms with all their field descriptions and validation messages.

  Account types now come from one shared set of labels rather than a second copy
  kept beside the setup wizard's, so the same account cannot read as one thing
  when you create it and another when you edit it.

### Changed

- **The Afrikaans reads like Afrikaans now.** A batch of phrases had been
  translated word by word, which is accurate on each word and wrong as a
  sentence — "Where it went" had become "Waarheen dit is", which is not
  something anyone would say. It now reads "Waar dit gegaan het", and fifteen
  others were rewritten the same way: "dated ahead" no longer comes out as
  "vorentoe gedateer", stale balances are "bereken uit" rather than "gebou uit",
  and "oudste {n} dae uit" became "oudste al {n} dae uitstaande".

- **The plugin is a quarter smaller and starts faster**, on the phone most of
  all. The shipped bundle is built minified from now on: 679KB down to 504KB.
  Nothing about what the plugin does has changed — the missing 175KB was source
  comments and indentation, written for people reading the code and parsed by
  the browser engine on every single load anyway.

### Internal

- A bundle-level smoke test now guards that build. Every other test reads the
  source files directly, so all of them would pass just as happily against a
  bundle that was mangled into uselessness — the new one loads the built
  `main.js` itself and checks it still exports a working plugin.

### Notes

- Eight pages are still English: Tax, Debt, Loan Calculators, Import, Savings,
  Assets, Services and Owed Money.

## 1.10.0 — 2026-08-07

### Added

- **The Dashboard is translated.** The greeting, the big remaining figure and
  its label, the income/budgeted/spent column, the percentages, the budget
  table, the "where you stand" tiles, the trend and split cards and every
  screen-reader description behind them.

- **Card headings across the whole app now translate too.** "Spending Trend",
  "Where it went", "Budget vs Actual", "Where you stand", the chart legend, the
  Transactions filters and buttons, and the Budget page's own header row were
  written into the app's fixed markup and had been missed — so they stayed
  English on every page regardless of the language. They no longer do.

### Notes

- Nine pages are still English: Tax, Accounts, Debt, Loan Calculators, Import,
  Savings, Assets, Services and Owed Money. Their card headings are translated;
  their contents are not yet.

## 1.9.0 — 2026-08-07

### Added

- **The Budget and Transactions pages are translated.** Both now read in
  whichever of the seven languages you have chosen — the totals tiles, the
  table headers, the live "left / over" line under each amount, the filters and
  row counts, the add-transaction dialog, the split flow, the export flow, and
  every screen-reader label along the way.

  Date hints are localised properly rather than shared: German asks for
  JJJJ-MM-TT, French for AAAA-MM-JJ. Counts agree with their own language too —
  Spanish gives "Copiada 1 categoría" against "Copiadas 7 categorías".

### Fixed

- **Changing the language now updates the page you are looking at, not just the
  menu around it.** 1.8.1 re-translated the app's frame; the pages themselves
  were still redrawn from their old text until you switched away and back.

### Notes

- Ten pages are still English — Tax, Accounts, Debt, the Dashboard, Loan
  Calculators, Import, Savings, Assets, Services and Owed Money — along with
  most settings descriptions and the Tax view's country checklists.

## 1.8.1 — 2026-08-07

### Fixed

- **Changing the language now changes the language.** In 1.8.0, picking a new
  one in settings wrote the setting and did nothing you could see: the budget
  view is translated once when it opens, so a view that was already open kept
  the language it opened in until you closed and reopened it. It now
  re-translates in place, immediately, as often as you change it.

  What this covers is the app's frame — the menu, the page titles, the top bar
  and the welcome screen. The pages themselves, most of the settings
  descriptions and the Tax view's country checklists are still English; they are
  the next piece of work, not part of this fix.

## 1.8.0 — 2026-08-07

### Added

- **Budget Vault speaks seven languages.** English, Afrikaans, German, Spanish,
  French, Japanese and Chinese. Pick yours under Settings → Budget Vault →
  Language, or on the first screen of the setup wizard, which is translated too.

  Language is its own setting, deliberately separate from Country. Where you
  live decides how your money is formatted, which date order your bank statements
  use and which tax authority's checklist the Tax view shows. It does not decide
  what language you want to read. Someone in Germany can run the app in English,
  and someone in South Africa can run it in German with South African tax
  handling intact — neither choice drags the other with it.

  If you have never set it, the app follows Obsidian's own display language and
  falls back to English. Afrikaans is the one exception: Obsidian does not offer
  it, so it has to be chosen here.

  Your own words are never touched. Category names, account names, notes and
  every file in your budget folder stay exactly as you wrote them — this
  translates the app, not your budget.

### Notes

- Japanese and Chinese are a first pass. The structure is right, but if a
  financial term reads oddly to a native speaker, the feedback form is the place
  to say so.
- The views, the settings descriptions and the Tax view's country checklists are
  still English for now.

## 1.7.1 — 2026-08-07

### Changed

- **"What net worth is made of" is worth looking at now.** The two bars draw
  themselves in from the left when the page opens, owned first and owed a beat
  behind, and each block carries a soft sheen and a faint glow in its own colour
  instead of sitting flat.

  On a computer, resting the pointer on any block names it and gives you the
  figure and its share — "Investments · R302,000.00 · 9% of what you own" —
  while every other block dims, so you can see how much of the bar one thing
  actually is. On a phone nothing changes: touch and hold still gives you the
  same figure, and no affordance that needs a mouse was invented for a finger.

  The motion is decoration and knows it. It respects your system's reduce-motion
  setting, and on older iPhones it simply doesn't run — the bars draw complete
  rather than half-drawn.

### Fixed

- **A screen reader now hears what the net-worth bars are made of.** The chart
  announces itself as a single image, which meant the per-block descriptions
  underneath it were never read out — you got two totals and no breakdown. The
  description now lists every block on both sides with its amount.

## 1.7.0 — 2026-08-07

### Added

- **An Assets page — what you own that isn't a bank account.** Your house, your
  car, the contents of it, gold, a ring. Net worth was built out of your bank
  balances and your debts, so if you had a bond you read as several hundred
  thousand rand in the hole while living in a house worth several million. The
  loan was counted in full and the thing it bought was not counted at all.

  Anything you list here now counts toward net worth, and shows up as its own
  block in "What net worth is made of" on the Savings page, so the house, the
  car and the ring are told apart rather than lumped together.

  A value is a claim with an age, and the page says so. Each row shows when it
  was last worked out — "valued 6 months ago", "never valued" — and anything
  over a year old is called out above the table and again on the Savings page.
  A year rather than the thirty days a bank balance gets: nobody has a house
  valued monthly, and a warning that fired on every row forever would be one
  you learned to skip.

  Saved to `Assets.md` as an ordinary table you can edit by hand.

- **"Where you stand" on the Dashboard.** Net worth, what you owe, what you have
  lent out and what you have saved were four taps away on four different pages.
  They now sit in a band below the period cards. Nothing in that band moves when
  you change period, and it says so — a figure that holds still while the
  control above it moves looks broken otherwise.

### Changed

- **The Accounts page calls its top figures "In credit" and "Overdrawn".** They
  were "Assets" and "Liabilities", which now means something else one line down
  in the menu. Its "Net worth" also says *across these accounts only* whenever
  there is something on the Assets or Debt page that would make it differ from
  the whole-household figure on Savings — both numbers are true, and now you can
  tell which is which.

### Fixed

- **An out-of-date valuation is now legible in light mode.** The warning amber is
  a fill colour, and as small text on white it measured 2.2:1 — the line telling
  you a figure is stale was the least readable thing in the row. It now has its
  own darker ink and measures 5.4:1. Dark mode is unchanged.

- **Date fields stop borrowing Obsidian's colours.** The "/" separators and the
  empty `yyyy/mm/dd` placeholder were painted from the app's theme rather than
  the plugin's, so with the plugin set to light inside a dark Obsidian (or the
  reverse) they came out the wrong grey on the wrong background. Every date
  field in the app, not just the new one.

- **Hand-typed amounts with spaces or commas are read, not truncated.** A credit
  limit written `15,000` was read as `15` and then written back over your own
  figure the next time anything on that account was edited.

- **"Reload from disk" no longer leaves the Transactions Save button lit** over
  edits it had already discarded.

## 1.6.2 — 2026-08-07

### Changed

- **Each palette now has its own gold.** All four shared the same amber, so the
  big "remaining this period" figure faded to the same warm tail and one of the
  background washes stayed amber whichever palette you were on. Ocean now takes
  an orange, Plum a warm yellow-gold, and Slate a muted bronze — a bright amber
  on a grey palette reads as a mistake rather than an accent. Vault Green is
  unchanged.

## 1.6.1 — 2026-08-07

### Fixed

- **The background follows the palette you picked.** The soft washes of colour
  behind the app and behind the lock screen were painted green whichever
  palette you were on, so Ocean and Plum sat on a faintly emerald background.
  They now take their colour from the palette. Vault Green is unchanged, down
  to the exact shade it always used.

### Changed

- **Export asks where to save.** Choosing Export now opens a dialog with the
  folder to write to, filled in with wherever you sent the last one, and tells
  you what it is about to write before it writes it. The folder is somewhere in
  your vault — Obsidian gives a plugin no way to open your system's own save
  dialog, and a button that worked on the desktop and did nothing on your phone
  would be worse than asking. Once the file is in the vault, sharing it out
  works the way any other note does.

  A folder that fails is never remembered as your default, and cancelling does
  nothing at all.

## 1.6.0 — 2026-08-07

### Added

- **Colour palettes.** A second setting beside Theme, offering Vault Green
  (unchanged, and still what you get), Ocean, Plum and Slate. The two settings
  are independent: every palette has its own light *and* dark version, so
  choosing one never costs you the ability to follow Obsidian's light/dark
  switch.

  Nothing is calculated while the plugin runs. Each palette's colours are
  worked out when the plugin is built and shipped as plain CSS, so switching
  palette costs a phone nothing. Status colours are deliberately left alone —
  red still means over budget under every palette, because a colour that means
  something cannot also be decoration.

- **Export.** A button on the Transactions page writes what you are looking at
  to `Exports/` — transactions and categories, each as a CSV a spreadsheet
  opens and a markdown file you can read (and, on desktop, hand to Obsidian's
  own Export to PDF).

  It exports exactly what is on screen. The account, category, search and
  "whole history" controls you already use decide what goes in the file, the
  file is named after the range, and any filters you applied are written inside
  the document — so a partial export can never be mistaken for the whole set.
  Excluded rows are included and marked, because they are vetoed from your
  totals, not hidden from you; the totals count only the rest, and say so when
  the two differ.

### Fixed

- **A savings balance no longer reports contributions as growth.** The Savings
  page showed `balance − total invested` and called the difference growth.
  Those agree only while the invested figure keeps pace with every
  contribution, and nothing made it: a monthly debit order moved the balance,
  left the baseline behind, and the gap was then presented as performance.
  Measured against four real accounts it was wrong on all four — most starkly
  on a tax-free account where contributions outweighed real growth by roughly
  twenty to one. The page now reports the shape every provider statement uses:
  opening, plus contributions, plus growth, less withdrawals.

- **Listed services are now measured against what actually left the account.**
  The Services page is a list of what you believe you pay, and nothing had ever
  compared it to your statements. On the vault this was built against, four of
  six listed services disagreed — a fibre line listed R80 under its real price,
  a subscription that had quietly risen 19%, and one still marked active whose
  last charge under that name was five months earlier. Matching is by merchant
  rather than by budget category, because a phone contract and a cloud
  subscription commonly share a category, and when nothing matches you are told
  so rather than shown another company's debit order.

- **One broken dashboard card no longer takes the rest of the page with it.**
  Each card now fails on its own and says so in place, instead of stopping
  every card below it from rendering.

### Changed

- Debt rows show where the payment schedule says the balance should be, Owed
  Money shows how long the money has been out, and Services offers the next
  billing date it works out from your history beside the one you typed.

## 1.5.0 — 2026-08-07

### Fixed

- **Net worth counts everything you owe.** The liabilities figure on the
  Savings page was built from account balances alone, so a card in overdraft
  counted and a home loan on the Debt page did not. The tile and the chart
  beneath it both read from the same short definition now — assets are the
  positive balances, liabilities are the negative ones *plus* every active
  debt row — so the headline number and the picture under it can no longer
  disagree.

  A credit card can honestly be tracked as an account or as a debt row, and
  nothing stops you doing both, which would count it twice. That case is
  reported rather than guessed at: names are free text, and any rule for
  matching "Discovery" against "Discovery Bank" would be wrong on real data
  in both directions. You are told the overlap is possible and get to look.

### Added

- **Every stated balance now says how old it is.** A balance is something you
  typed, not something the vault knows, and one confirmed in March should not
  prop up a net-worth figure read in August. Balances unconfirmed for more
  than 30 days are counted and disclosed where the total is stated. An
  account that has never been confirmed says so, rather than reporting zero
  days.

- **Moving your own money between your own accounts stops counting as income
  and spend.** An import that names another of your accounts by its number is
  recognised as a transfer and arrives excluded. It is excluded *by name* —
  the row says what made it so, so a figure that looks missing later has a
  trail rather than a mystery.

### Changed

- **Two categories can no longer wear the same colour on the donut.** Category
  colours are yours, one per file, and nothing ever stopped two files carrying
  the same one — the vault this was measured on had 15 categories on one red
  and 10 on one blue, which drew a chart that could not be read. Duplicates are
  now separated at draw time, the biggest wedge keeping the colour its file
  asks for, and nothing is written back to your files.

  Two colours also no longer have to be *identical* to be a problem: near
  matches are separated too, because a wedge of `#3b82f6` beside one of
  `#0d6efd` is the same blue to the eye whatever the files say. The stand-in
  colours are never red — red already means "over budget" on the trend chart
  and in the budget table, and a category wearing it would have the dashboard
  signalling something it does not mean.

- **"Where it went" links through to the spending behind it.** A wedge or a
  legend row opens Transactions filtered to that category, for the period on
  screen rather than all of history; a second button on each row opens the
  category's own note. The "Other" row stays inert — it is a bucket of several
  categories, so neither action has a single thing to point at.

## 1.4.1 — 2026-08-06

### Fixed

- **"Tidy categorisation rules" now leaves a way back.** The command can
  delete most of your rules file in one click — 832 of 1,342 on the vault it
  was built against — and until now the only thing in front of that was the
  preview. The preview still lists every removal, but nobody reads eight
  hundred lines in a dialog, so the rules as they were are now saved to
  `Data/Categorisation Rules.pre-tidy-<date>.csv` before anything is deleted.
  If that file cannot be written, nothing is deleted at all.

  Tidying twice in one day keeps the *first* backup rather than replacing it:
  the earlier file is the one that predates both deletes, and it is the copy
  worth having.

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
