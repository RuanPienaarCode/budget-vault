'use strict';
/* A THIRD golden household: the first one, with exchange rates switched ON.
   2026-11-11 audit, task 8.

   Neither committed household enabled `exchange_rates`, and until task 23 the
   gate's mount did not even register fx-live. So the one place a converted
   figure reaches a screen — the Accounts hero's "Converted total" line, the
   only caller of fxConvert — was outside the reconciliation gate, the only
   test that can catch two figures derived by different rules. Nothing was
   found wrong there. It had simply never been looked at by the instrument
   built to look.

   This is household.cjs plus the least that makes conversion run, so every
   difference between the two ledgers is conversion's doing:

     - Settings: `currency_code: ZAR`, `exchange_rates: on`, and
       `rate_refresh: monthly` (see the rate table below for why monthly).
     - "Dollar savings" gains `currency_code: USD` — "$" alone is four
       currencies, and an account with no code is not converted.
     - "Euro travel", a second convertible currency, with one row dated AFTER
       its balance line: stated € 500, implied € 400. The hero converts LIVE
       balances (discussion #124), so a conversion taken off the typed balance
       instead would be out by exactly € 100 × 25 = R 2 500 and could not hide.
     - "Yen wallet", a foreign account with NO currency code. It cannot be
       converted and must be NAMED beside the total, never counted at par and
       never dropped — fx.js calls that array "the promise that no money went
       missing quietly".

   THE RATE TABLE IS FIXED, AND NOTHING HERE REACHES THE NETWORK. The table is
   the vault's own cache file, `Exchange Rates.md`, exactly as fx-fetch.js
   writes it; fx-live reads it on the first refresh and asks the provider only
   when the table is due at the vault's cadence. It is dated ten days before
   the pinned TODAY and the cadence is monthly, so it is not due (10 < 30) —
   and it IS stale (10 >= 7, fx.js STALE_AFTER_DAYS), which puts the "N days
   old" sentence on screen: the age is a figure too, and the fresh sentence
   prints none. tests/reconcile-gate-fx.test.cjs fails if requestUrl is called
   at all.

   Round numbers, as in household.cjs, and for the same reason: one ZAR buys
   0.05 USD and 0.04 EUR, so a dollar is R 20 and a euro R 25, and every
   converted figure can be checked in the head:

       home (Cheque 14 400 + Emergency fund 14 500, live)   R 28 900
       $ 1 000 × 20                                          R 20 000
       € 400 × 25                                            R 10 000
       converted total                                       R 58 900
       ¥ 10 000                                              named, not converted

   Synthetic, like every fixture in this repo: no real balance, rate or
   household is behind any figure here. */

const { SEED: BASE, B, TODAY, PERIOD } = require('./household.cjs');

const TX_HEAD = '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n'
  + '|---|---|---|---:|---|---|---|\n';
const tx = rows => TX_HEAD + rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  | ${r[5] || ''} |\n`).join('');

/* Ten days before TODAY (2026-09-02). */
const RATES_DATE = '2026-08-23';

const SEED = {
  ...BASE,

  [`${B}/Settings.md`]:
    '---\nmonth_start_day: 1\ncurrency: "R"\ncurrency_code: ZAR\ncountry: za\nemergency_target_months: 6\n'
    + 'owners: Alex, Sam\nexchange_rates: on\nrate_refresh: monthly\n---\n',

  [`${B}/Accounts/Dollar savings.md`]:
    '---\ntype: savings\ntx_label: "Dollar savings"\ncurrency: "$"\ncurrency_code: USD\nbalance: 1000.00\n'
    + 'balance_updated: 2026-09-01\n---\n',

  [`${B}/Accounts/Euro travel.md`]:
    '---\ntype: checking\ntx_label: "Euro travel"\ncurrency: "€"\ncurrency_code: EUR\nbalance: 500.00\n'
    + 'balance_updated: 2026-09-01\n---\n',
  /* Dated the day after the balance line, so the live balance is € 400. Filed
     under Groceries on purpose: a foreign account's rows are held out of the
     budget totals whatever they are filed under (ledger.js), so the Dashboard's
     Groceries wedge and the Transactions list it opens must both leave this
     row out — with rates ON as much as off. */
  [`${B}/Transactions/Euro travel/2026-09.md`]: tx([
    ['2026-09-02', 'Train tickets', 'Groceries', -100],
  ]),

  [`${B}/Accounts/Yen wallet.md`]:
    '---\ntype: checking\ntx_label: "Yen wallet"\ncurrency: "¥"\nbalance: 10000.00\n'
    + 'balance_updated: 2026-09-01\n---\n',

  /* The cache file, in the shape fx-fetch.js serializeRates writes (the
     frontmatter and the table are what parseRatesFile reads; the prose between
     is the file's own note to a reader and is left out here). */
  [`${B}/Exchange Rates.md`]:
    `---\nbase: "ZAR"\ndate: "${RATES_DATE}"\nsource: "synthetic fixture"\nfetched: "${RATES_DATE}T08:00:00.000Z"\n---\n\n`
    + '# Exchange rates\n\nOne ZAR buys:\n\n| Currency | Rate |\n|---|---:|\n'
    + '| EUR | 0.04 |\n| USD | 0.05 |\n| ZAR | 1 |\n',
};

module.exports = { SEED, B, TODAY, PERIOD, RATES_DATE };
