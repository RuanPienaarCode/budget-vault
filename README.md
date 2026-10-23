# Budget Vault

![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-green)
![Obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A51.8.0-7c3aed)
![Mobile ready](https://img.shields.io/badge/mobile-iOS%20%26%20Android-blue)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/onboarding/onboarding-dark.webp">
  <img src="docs/onboarding/onboarding-light.webp" width="960" alt="Budget Vault in five steps: the welcome screen, the setup wizard choosing a name, currency and payday, a bank CSV imported and sorted into categories, a budget with every rand given a job, and a plan placing a bonus and a tax refund into spending buckets.">
</picture>

Most budgeting apps ask you to upload your bank statements and trust someone else's server with them. Budget Vault doesn't.

Every account, budget and transaction is a plain markdown file in your own vault, on your own devices. There is no company database, no account to create, and nothing to export when you leave — the files are already yours.

Out of the box the plugin makes **zero network requests**, so your financial history can't be uploaded, analysed or sold. There is exactly one thing that can change that, and only if you switch it on: if you hold money in more than one currency, you can ask the plugin to fetch exchange rates so those accounts can be added into your totals. It is off by default, the setup wizard asks about it outright, and when it is on it sends a three-letter currency code and nothing else — no balances, no account names, nothing about your vault. The rates are saved as an ordinary note in your budget folder that you can read, edit or delete. The next section names who it asks.

### The one remote service

Only when **Exchange rates** is switched on (Settings → Budget Vault, or the setup wizard's rates step), the plugin asks **open.er-api.com** — the free rates endpoint run by [ExchangeRate-API](https://www.exchangerate-api.com) — for the day's rates, at the daily, weekly or monthly rhythm you pick. The request is `https://open.er-api.com/v6/latest/<CODE>`, where `<CODE>` is your home currency's three-letter code (for example `ZAR`).

- **What is sent:** that three-letter currency code, and nothing else of yours. As with any request over the internet, the service can also see the IP address the request came from.
- **Why:** so accounts you hold in other currencies can be added into your totals at a rate you can see, with the date it is for.
- **What comes back:** a table of rates, saved as `Exchange Rates.md` in your budget folder. Every converted figure is printed with the date of its rate.
- **If you leave it off:** no request is ever made, and accounts in other currencies are named beside your totals instead of being added into them.

The provider asks for this credit wherever its rates are used: [Rates By Exchange Rate API](https://www.exchangerate-api.com). The same link sits beside the setting and in the wizard.

Put your vault in iCloud Drive, Obsidian Sync, Dropbox or Syncthing and your budget follows you to every device — synced by a service you chose, not one we picked.

## What it does

- **Dashboard** — spending trend, budget vs actual
- **Score** — where the money went this period, and how healthy the month was
- **Transactions** — search, filter and edit your full history
- **Budget** — per category, per period, with live "left / over" feedback
- **Plan** — set money aside for what is coming, before it arrives
- **CSV import** — drop a bank statement, review, commit
- **Auto-categorisation** — rules learned from your corrections
- **Report** — a one-note financial report (Markdown and/or JSON), for a month, a year or any span
- **Budget export** — your budget as a PDF, an Excel workbook or CSV, for the last month, quarter, year, a tax year or any two dates
- **Accounts, assets, debt, owed money, services, tax, savings and loan calculators** — a screen each
- **Food** — paste a till slip's text (Live Text on iPhone or Mac) and see what the groceries actually were: meat, dairy, cheese, snacks, wine, by category and by product, with discounts, the healthy share and price changes. Checkers slips are read line by line; any other shop's, or a list typed by hand, too. The bank line stays one transaction — the receipt sits beside it.
- **Notes** — ordinary notes that can point at a category or an account
- **Several currencies** — accounts in other currencies are named beside your totals, and added into them if you switch on exchange rates (see above)
- **Twelve languages** — English, Afrikaans, Deutsch, Español, Français, हिन्दी, Bahasa Indonesia, 日本語, Português, isiXhosa, 中文 and isiZulu; set separately from the country
- Payday-aligned periods, and full support on iOS and Android — including a small phone

## Install

**From Obsidian's community plugins (the usual way):**

1. Settings → Community plugins → turn off Restricted mode → Browse
2. Search for **Budget Vault**, then Install and Enable
3. Open it from the wallet icon

**By hand** (to try a build that is not released yet):

1. Copy `manifest.json`, `main.js` and `styles.css` into `<your vault>/.obsidian/plugins/budget-app/`
2. Settings → Community plugins → turn off Restricted mode → enable Budget Vault
3. Open it from the wallet icon

A setup wizard runs on first launch. On mobile, repeat the enable step once — Restricted mode is per-device.

> **Open the vault, not the budget folder.** Obsidian loads plugins from
> `<vault root>/.obsidian/plugins/`, so Budget Vault only exists in the vault
> you installed it into. If you use *Open folder as vault* on `Finances/` —
> the folder holding your budget — the plugin is simply not there: no wallet
> icon, no command, no error. It looks like a failed install and is not one.
> Opening that inner folder also creates a second `.obsidian` inside it, so
> the mistake sticks until you delete that folder and reopen the outer vault.

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
├── Receipts/            one file per till slip (YYYY-MM/), plus Food Items.md
├── Tax/
├── Debts.md
├── Owed Money.md
└── Services.md
```

Ordinary markdown tables and frontmatter. Open them in any editor, diff them in git, keep them forever.

Note the two levels: `Finances/` is an ordinary folder *inside* your vault, and
`Finances/Budget/` is what the plugin reads. Neither of them is the vault —
that is the folder above them, the one holding `.obsidian/`. See the note under
[Install](#install) for what happens if you open one of them as a vault instead.

Two folders sit **outside** the budget folder, at the top of your vault, because what they hold isn't household data to load back in — it's something you asked the plugin to write out: `Exports/` (CSV/Markdown transaction exports, and the Budget page's **Export** — your budget for the last month, quarter, year, a tax year or any two dates, as a PDF, an Excel workbook or CSV) and `Reports/` (the one-note financial report, Markdown and/or JSON). Both default to those names but are yours to rename or relocate from the Transactions, Budget and Report pages, and both show you the exact path before anything is written.

### Debts.md

Columns are read by **position**, not by header name, so keep the first twelve in this order — a table missing one silently shifts every later value into the wrong field. A thirteenth, **Currency**, is optional and always last: a file without it loads exactly as before.

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
| Currency | *Optional, last.* The currency symbol this debt is stated in, e.g. `$`. Blank means the household's own currency. |

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

The animation at the top of this page is [docs/onboarding/onboarding-motion.html](docs/onboarding/onboarding-motion.html) —
open it in a browser to watch it with controls, or in 9:16 for phones. After changing a scene, re-record the
images with `scripts/record-onboarding.cjs` (its header lists what it needs).

### Design notes

The budget period is the one piece of the app whose behaviour isn't obvious from the code alone —
it has two naming shapes, a pay-cycle phase, and its own income arithmetic:

- [How a period is decided — shape, phase and income](docs/period-shape-phase-and-income.html) — diagrams
  of the whole flow, plus what is deliberately left unguarded
- [ADR 0001](docs/adr/0001-periods-are-derived-not-materialised.md) — periods are derived, not materialised
- [ADR 0002](docs/adr/0002-the-pay-cycle-is-a-number-not-a-name.md) — the pay cycle is a number, not a name

## Feedback

Settings → Budget Vault → Send feedback, or [open the form](https://forms.gle/EVJKCuZxNQ9vJhTz6). Nothing from your budget is attached — the button just opens the form in your browser.

## Support Budget Vault

Budget Vault is free and always will be. If it's useful to you and you'd like to say thanks, you can send something via [PayPal](https://paypal.me/ruanpienaar86) — entirely optional, and nothing in the plugin changes either way.

## License

[GNU Affero General Public License v3.0](LICENSE) © Ruan Pienaar

Use it, change it, share it — personally or commercially, free of charge. The
condition is reciprocity: if you distribute a modified version, or run one where
other people can use it over a network, those people get its source under this
same licence.

Releases up to and including 1.11.11 were published under the MIT licence and
stay MIT for anyone holding a copy of them. See [NOTICE](NOTICE) for the full
licence history.
