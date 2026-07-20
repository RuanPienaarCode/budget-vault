# Smart Budget — Obsidian plugin

Port of the standalone HTML budget app (now archived at
`Pienaar Family/Finances/Budget/Archive/Budget App.html`) into a vault-local
Obsidian plugin. Reads and writes the markdown files in the budget folder
through the Vault API — works on desktop **and Obsidian iOS/Android**
(no Node/Electron APIs anywhere in `src/`; keep it that way).

**Status (17 Jul 2026):** in use on desktop + iPhone. We're testing and tweaking
it on our own vault first — sharing with friends comes *after* that settles.
See [Sharing it with friends](#sharing-it-with-friends--later) for the checklist
to work through when that day comes.

## Layout

```
manifest.json        plugin identity (isDesktopOnly: false)
styles.css           all styling, scoped under .budget-app-root
main.js              BUILD OUTPUT — do not edit by hand
build.sh             bundles src/ into main.js (bun, fallback npx esbuild)
src/
  main.js            plugin class, ribbon, command, Settings.md read/update
  constants.js       VIEW_TYPE, defaults, category type order, month names
  util.js            el() DOM builder, lucide icons, md/frontmatter/CSV parsing
  modal.js           FieldModal + askFields (window.prompt replacement)
  shell.js           static view markup (SHELL_HTML)
  io.js              vault file access rooted at the budget folder
  period.js          payday-month math + per-period summaries
  load.js            loadVault — reads all budget files into state
  categories.js      category <select> builders + create-category flow
  controller.js      mounts the shell, assembles ctx, view switching, wiring
  view.js            BudgetView (ItemView)
  settings-tab.js    plugin settings tab
  views/             one module per screen
    dashboard.js  transactions.js  budgets.js  accounts.js
    savings.js    owed.js          services.js tax.js
    import.js
```

Modules communicate through a shared `ctx` object assembled in
`controller.js`; each module's `register(ctx)` adds its functions onto it.
Registration order matters for destructuring (io → period → load →
categories → views); anything defined later (e.g. `switchView`) must be
called as `ctx.switchView(...)` at call time.

## Editing workflow

1. Edit files under `src/`
2. `./build.sh`
3. Reload Obsidian (or toggle the plugin off/on) to pick up the new bundle

`styles.css` is **not** bundled — Obsidian reads it directly, so a styling-only
change just needs step 3.

**Prefer the plugin toggle over "Reload app".** We've observed Obsidian serve a
stale cached `styles.css` even across a Cmd+R app reload (symptom: one missing
declaration, e.g. drawer rows centring because `justify-content: flex-start`
wasn't in the loaded sheet). Disabling and re-enabling the plugin (Settings →
Community plugins, or from the console:
`app.plugins.disablePlugin('budget-app').then(() => app.plugins.enablePlugin('budget-app'))`)
always re-reads both `main.js` and `styles.css` from disk.

### Styling gotcha

Obsidian's `app.css` styles bare `button` / `select` / `input` elements, which
the standalone HTML never had to fight. Most notably `button { justify-content:
center }` and `select, input[type=checkbox] { appearance: none }`. The reset at
the top of `styles.css` neutralises them; if a control ever renders subtly wrong
(centred when it should be flush left, a missing dropdown chevron, an odd
height), that reset is the first place to look. To diagnose, extract Obsidian's
real stylesheet and grep it rather than guessing:

```
# app.css lives inside /Applications/Obsidian.app/Contents/Resources/obsidian.asar
# (asar header: 4 uint32 length prefixes, JSON at offset 16, files at 8+pickleSize)
```

The phone needs no build step — iCloud syncs the built `main.js`. Enable the
plugin on iOS once: Settings → Community plugins → turn off Restricted mode →
enable Smart Budget.

## Data settings

`month_start_day` and `currency` live in `Settings.md` inside the budget
folder (synced with the vault). The plugin's settings tab edits that file
in place; folder path / theme / open-on-startup are per-device plugin data.

## Budget page — parity notes with the Laravel app

Like the app's Budget page, every category is always listed (grouped by type),
whether or not it has a budget this period. Unbudgeted categories are
display-only zero rows — they are **not** written to `Budgets/<period>.md`
unless given an amount or a note, so period files stay small. Rows already in
the file persist even at amount 0 (deliberate zero budgets survive); ✕ clears
a row from the file. Each amount input shows a live remaining line beneath it
(`R 629,45 left` / red `R 73,99 over`).

## Tax page

SARS return tracking, one file per tax year: `Tax/<year>.md` holds the season
frontmatter (`taxpayer_type`, `assessment`, editable deadlines) plus two tables —
`## Progress` (steps, status `todo`/`busy`/`done`/`n/a`) and `## Documents`
(status `needed`/`uploaded`/`n/a`). Uploaded certificates (PDFs, images) are
written via the Vault binary API into `Tax/<year>/` next to the file, so they
sync to iOS and open in Obsidian's own viewers. New years are seeded with a
starter SARS checklist (IRP5, bank IT3(b)s, investment IT3(b)/(c), TFSA
certificate, medical, freelance income + expenses, IRP6 provisional
deadlines) — edit the sources to match your own banks and providers.
Removing a document row never deletes the uploaded file; deadlines
shift each filing season, so the seeded dates are defaults to verify on
sars.gov.za.

## CSV import — supported formats

Columns are matched by **header name**, not position, so most bank CSV exports
work out of the box: **Discovery Bank, FNB, Capitec, Nedbank, Standard Bank and
Absa** statement exports are all recognised. The importer needs a header row
with a date column, a description column, and either a single signed amount
column or a **Debit + Credit** pair (Capitec's "Money In"/"Money Out" style
included — debits import as negative amounts). Amount cells tolerate the local
quirks: `R 1 234.56`, decimal commas (`1 234,56`), parenthesised negatives,
trailing minus, and `Cr`/`Dr` markers.

### Importing your own data (Google Sheets / Excel)

Anything not covered by a bank export can be imported from a hand-built sheet.
Create three columns with this exact header row:

| Date | Title | Amount |
|------|-------|--------|
| 2026-07-01 | Woolworths | -249.99 |
| 2026-07-02 | Salary | 25000 |

- **Date** — `YYYY-MM-DD` or `DD/MM/YYYY`
- **Title** — the transaction description (used for auto-categorisation rules)
- **Amount** — negative for money out, positive for money in

Then export as CSV — Google Sheets: *File → Download → Comma-separated values
(.csv)*; Excel: *File → Save As → CSV UTF-8* — and drop the file on the Import
screen. `Description` works as a header instead of `Title`, and separate
`Debit`/`Credit` columns instead of `Amount`, if that's easier.

## CSV import — parity notes with the Laravel app

- **`" ZA"` suffix**: Discovery card rows carry a trailing country code
  (`"VOVO TELO CAPETOWN ZA"`). The Laravel app strips it on import
  (`CsvImportService`), so the vault's descriptions are stored without it.
  The plugin does the same — this keeps dedup keys and categorisation rules
  aligned. (Verified 2026-07-17: with the strip in place a full-history
  re-import reports 0 new for a synced account.)
- **Zero-amount rows** are skipped, matching the app.
- **Tombstones**: the Laravel app soft-deletes transactions, so a row the
  user deleted there stays deleted across re-imports. The vault has no
  tombstones — a transaction deleted from a monthly file (or deleted in the
  app before it was seeded here) **comes back on the next CSV re-import** and
  must be re-deleted by hand. Known, accepted limitation.

## Sharing it with friends — later

**Not yet.** The plan is: use it, test it, tweak it here first. Only once it has
settled do we package it for anyone else. This section is the checklist for that
day, written up while it was fresh — it is *not* a to-do list for now.

### The hard rule: never send the data folder

The plugin is only the app. The budget folder next to it holds real money data —
live account balances, net worth, ~5 700 transactions back to 2022, who owes the
household what, every subscription. **A friend must never receive a copy of it.**
They need an empty scaffold of the same shape, nothing more.

Likewise **never copy `data.json`** — it pins `budgetFolder` to our vault path
and will simply be wrong in theirs. Let it regenerate from defaults.

### What a friend actually needs

| Send | Notes |
|------|-------|
| `manifest.json`, `main.js`, `styles.css` | the whole app; drop into `<their vault>/.obsidian/plugins/budget-app/` |
| `src/`, `build.sh`, `README.md` | optional — only if they'll edit it; not loaded at runtime |
| A starter budget folder | `Settings.md`, a few generic `Categories/*.md`, an `Accounts/*.md` or two, empty `Budgets/`, `Transactions/`, `Data/`, plus `Owed Money.md` and `Services.md` |

The scaffold is not optional: `loadVault` shows the "Budget folder not found"
screen unless at least one category or transaction file exists.

### Genericise before shipping

Mostly done — the brand subtitle and avatar initials now come from the
`household` setting in `Settings.md` (generic defaults when unset). What's
still opinionated:

- `main.js` / `controller.js` — `currency: 'R'` and `month_start_day: 23` (payday)
- `shell.js` / `views/import.js` — CSV import targets SA bank exports
  (Discovery, FNB, Capitec, Nedbank, Standard Bank, Absa), with a generic
  Date/Title/Amount format as the escape hatch

### Their install steps

1. Copy the `budget-app` folder into `.obsidian/plugins/` (create it if missing)
2. Copy the starter budget folder anywhere in their vault
3. Settings → Community plugins → **turn off Restricted mode** → Reload → enable
   Smart Budget (Restricted mode is per-device, so repeat on their phone)
4. Settings → Smart Budget → set **Budget folder**, **currency**, **month start day**
5. Wallet icon in the ribbon

Obsidian will warn that it's third-party code — expected for a manual install.
