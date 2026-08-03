# Budget Vault

![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A51.8.0-7c3aed)
![Mobile ready](https://img.shields.io/badge/mobile-iOS%20%26%20Android-blue)

Most budgeting apps ask you to upload your bank statements and trust someone else's server with them. Budget Vault doesn't.

Every account, budget and transaction is a plain markdown file in your own vault, on your own devices. There is no company database, no account to create, and nothing to export when you leave — the files are already yours. The plugin makes zero network requests, so your financial history can't be uploaded, analysed or sold.

Put your vault in iCloud Drive, Obsidian Sync, Dropbox or Syncthing and your budget follows you to every device — synced by a service you chose, not one we picked.

## What it does

- **Dashboard** — spending trend, budget vs actual
- **Transactions** — search, filter and edit your full history
- **Budgets** — per category, per period, with live "left / over" feedback
- **CSV import** — drop a bank statement, review, commit
- **Auto-categorisation** — rules learned from your corrections
- **Savings, accounts, owed money, subscriptions, tax** — a screen each
- Payday-aligned periods, and full support on iOS and Android

## Install

1. Copy `manifest.json`, `main.js` and `styles.css` into `<your vault>/.obsidian/plugins/budget-app/`
2. Settings → Community plugins → turn off Restricted mode → enable Budget Vault
3. Open it from the wallet icon

A setup wizard runs on first launch. On mobile, repeat step 2 once — Restricted mode is per-device.

## Where your data lives

One folder you choose, default `Finances/Budget`:

```
Finances/Budget/
├── Settings.md
├── Categories/          one file per category
├── Accounts/            one file per account
├── Budgets/             one file per period (YYYY-MM.md)
├── Transactions/
│   └── <Account>/YYYY-MM.md
├── Data/Categorisation Rules.csv
├── Tax/
├── Debts.md
├── Owed Money.md
└── Services.md
```

Ordinary markdown tables and frontmatter. Open them in any editor, diff them in git, keep them forever.

### Debts.md

Columns are read by **position**, not by header name, so keep all twelve in this order — a table missing one silently shifts every later value into the wrong field:

| Column | Meaning |
|---|---|
| Name | What the debt is. Need not be unique. |
| Lender | Who it is owed to. |
| Type | `credit card`, `personal loan`, `vehicle`, `home loan`, `student`, `store account`, `overdraft`, `other`. Free text is kept as-is. |
| Balance | What is still owed today. |
| Original | What it started at — drives the "paid off" bar. Leave blank to reuse Balance. |
| Rate | Annual interest rate as a percentage, e.g. `22.25`. Compounded monthly. |
| Payment | The contracted monthly instalment. |
| Extra | Anything you pay on top of it every month. |
| Start date | When it opened, `YYYY-MM-DD`. |
| Category | Budget category whose transactions pay this debt. Blank means untracked. |
| Status | `active` or `paid`. |
| Notes | Anything else. |

The plugin rewrites the whole table on save, so a file created through **New debt** always has the right shape. This matters only if you write one by hand.

## CSV import

Any statement with Date / Description / Amount columns works. Discovery Bank, FNB, Capitec and Nedbank exports have been imported end to end, but nothing is hardcoded per bank — columns are matched by header, then by layout shape for headerless files, and you can map them by hand if neither resolves.

Sign conventions are verified, not guessed: where a statement carries a running balance, the amounts are checked against it, so a bank that lists money out as a positive number can't quietly import every expense as income. If it can't be verified, the review screen says so.

No supported bank? Build your own CSV with `Date`, `Title` and `Amount` columns — negative for money out.

## Development

`src/` holds small vanilla-JS modules — no framework, no dependencies. `main.js` is build output; never edit it by hand.

```bash
./build.sh
```

Then toggle the plugin off and on.

## Feedback

Settings → Budget Vault → Send feedback, or [open the form](https://forms.gle/EVJKCuZxNQ9vJhTz6). Nothing from your budget is attached — the button just opens the form in your browser.

## Support Budget Vault

Budget Vault is free and always will be. If it's useful to you and you'd like to say thanks, you can send something via [PayPal](https://paypal.me/ruanpienaar86) — entirely optional, and nothing in the plugin changes either way.

## License

MIT © Ruan Pienaar
