# Changelog

All notable changes to Budget Vault. Versions match the plugin version in
`manifest.json` and the release tag exactly (no `v` prefix).

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
