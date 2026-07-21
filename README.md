# Budget Vault

> A personal budget dashboard that lives inside your Obsidian vault — every account, budget and transaction stored as plain markdown you own.

![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A51.4.0-7c3aed)
![Mobile ready](https://img.shields.io/badge/mobile-iOS%20%26%20Android-blue)

No accounts. No cloud service. No telemetry. Budget Vault reads and writes ordinary markdown files in a folder of your vault, so your financial data syncs however your vault syncs, stays readable without the plugin, and never leaves your devices.

## Why budget on your own data?

Most budgeting apps ask you to hand your bank statements to someone else's server and trust them with it. Budget Vault flips that:

- **You own your data.** Every account, budget and transaction is a plain markdown file sitting in *your* vault, on *your* devices. There is no company database, no account to create, and nothing to export when you leave — the files are already yours.
- **Nobody else sees it.** The plugin makes zero network requests. Your financial history is never uploaded, analysed, or monetised — it can't be, because it never leaves your vault.
- **Access it anywhere with your own cloud.** Put your vault in iCloud Drive (or use Obsidian Sync, Dropbox, Syncthing…) and your budget follows you to every device — synced by a cloud *you* control, encrypted with *your* account, invisible to us.
- **Use it through the Obsidian app.** The free [Obsidian](https://obsidian.md) app on desktop, iPhone and Android is the only thing you need. Open your vault, tap the wallet icon, and your budget is there.

> **📱 Phone tip:** if your vault lives in iCloud Drive, mark it as downloaded on your phone (Files app → long-press the vault folder → *Download Now*, or simply open the vault in Obsidian once and let it finish syncing). A locally-downloaded vault means the budget opens instantly instead of waiting on iCloud to fetch files.

## Features

- **Dashboard** — spending trend across recent periods, budget vs actual at a glance
- **Transactions** — browse, search, filter and edit your full history, stored one markdown file per account per month
- **Budgets** — set amounts per category per period, with live "left / over" feedback as you type; categories are grouped into sections (income, expense, debt, services, insurance, giving, savings, investment, luxuries, transfer) and can be added or deleted right from the table
- **Payday-aligned periods** — months can start on your payday (e.g. the 25th) instead of the 1st
- **CSV import** — drop a bank statement export, review with automatic categorisation and duplicate detection, commit
- **Auto-categorisation rules** — pattern → category rules learned from your corrections, stored in a plain CSV
- **Savings & investments, accounts, owed money, subscriptions** — dedicated screens for each
- **Tax season tracking** — a per-year SARS checklist with document uploads stored alongside it in the vault
- **Desktop and mobile** — no Node or Electron APIs; works on Obsidian for iOS and Android

## Installation

Budget Vault is not (yet) in the community plugin store, so installation is manual:

1. Download this repository and copy `manifest.json`, `main.js` and `styles.css` into `<your vault>/.obsidian/plugins/budget-app/` (create the folder)
2. In Obsidian: **Settings → Community plugins** → turn off Restricted mode → enable **Budget Vault**
3. A setup wizard opens on first run — pick a budget folder, currency and period style, and it scaffolds starter categories and your first account (with its current balance, if you know it) for you
4. Open the app from the wallet icon in the ribbon

Obsidian will warn that this is third-party code — that's expected for a manual install. On mobile, repeat step 2 once (Restricted mode is per-device); the plugin files arrive via your normal vault sync.

## How your data is stored

Everything lives in one vault folder you choose (default `Finances/Budget`):

```
Finances/Budget/
├── Settings.md              currency, month start day, household name
├── Categories/              one file per category (type, colour)
├── Accounts/                one file per account
├── Budgets/                 one file per period (YYYY-MM.md)
├── Transactions/
│   └── <Account>/
│       └── YYYY-MM.md       markdown table of that month's transactions
├── Data/
│   └── Categorisation Rules.csv
├── Tax/                     one file + document folder per tax year
├── Owed Money.md
└── Services.md
```

It's all ordinary markdown tables and frontmatter — readable and editable without the plugin, diffable in git, portable forever.

## CSV import

At this time the importer works with **basic CSV bank statements** — a plain CSV with Date / Description / Amount columns — and has been tested against real exports from these banks:

| Bank | Format |
|------|--------|
| Discovery Bank | single signed Amount column (filenames auto-select the account) |
| FNB | single signed Amount column (filenames auto-select the account) |

More banks will be added over time. Columns are matched by **header name**, not position, so exports from other banks may well work as-is — but they haven't been verified yet. If your bank isn't listed (or its export doesn't import cleanly), you can always build your own transactions CSV — see below.

Amount cells tolerate real-world quirks: `R 1 234.56`, decimal commas (`1 234,56`), parenthesised negatives, trailing minus, and `Cr`/`Dr` markers. Duplicate rows are detected against your existing history and skipped automatically, so re-importing an overlapping statement is safe.

### Importing your own data

If your bank isn't supported yet, export or retype your statement into a Google Sheets or Excel file with this header row:

| Date | Title | Amount |
|------|-------|--------|
| 2026-07-01 | Woolworths | -249.99 |
| 2026-07-02 | Salary | 25000 |

- **Date** — `YYYY-MM-DD` or `DD/MM/YYYY`
- **Title** — the transaction description
- **Amount** — negative for money out, positive for money in

Export as CSV (Sheets: *File → Download → .csv* · Excel: *File → Save As → CSV UTF-8*) and drop it on the Import screen. `Description` also works instead of `Title`, and separate `Debit`/`Credit` columns instead of `Amount`.

> **Note:** deleting an imported transaction doesn't leave a tombstone — if you re-import a statement containing it, it comes back and must be deleted again.

## Development

Source lives in `src/` as small vanilla-JS modules — no framework, no dependencies. `main.js` at the repo root is the build output; never edit it by hand.

```bash
./build.sh   # bundles src/ into main.js (bun, falls back to npx esbuild)
```

Then toggle the plugin off/on in Obsidian to pick up the new bundle. `styles.css` isn't bundled — Obsidian reads it directly, so styling changes only need the toggle.

| Area | Where |
|------|-------|
| Plugin entry, commands, settings | `src/main.js`, `src/settings-tab.js` |
| App shell, view switching | `src/shell.js`, `src/controller.js` |
| Vault I/O and parsing | `src/io.js`, `src/util.js`, `src/load.js` |
| Country profiles (currency format, tax checklists, banks) | `src/locale.js` |
| One module per screen | `src/views/*.js` |

Modules communicate through a shared `ctx` object assembled in `controller.js`; each module registers its functions onto it.

## Privacy

Budget Vault makes **no network requests** — no analytics, no update checks, no external fonts or scripts. Your data is only ever read from and written to your own vault.

## License

[MIT](LICENSE) © Ruan Pienaar
