# Changelog

All notable changes to Budget Vault. Versions match the plugin version in
`manifest.json` and the release tag exactly (no `v` prefix).

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
