'use strict';
/* The byte-identical golden gate for the ADR-0003 migration.

   The GOLDEN strings below are the EXACT bytes 1.17.5's serializers emit for
   this fixture, captured BEFORE any entity was migrated onto table-schema.js.
   Through the migration (and after it) every serializer must keep producing
   them byte for byte: these files live in user vaults under iCloud sync, and
   a whitespace-only rewrite of every table on first save after upgrade is
   user-visible churn and a sync hazard.

   If this file goes red, the migration changed the on-disk format. That is
   never a test to update casually — it is the gate doing its job. (After the
   migration completes, an intentional format change bumps these literals
   together with a changelog entry saying files will rewrite.)

   TWO INTENTIONAL CHANGES HAVE BEEN MADE SINCE, each recorded here rather
   than left for a future reader to find by archaeology.

   ISSUE 68 — the `Car` row's `Original` cell. The fixture leaves it BLANK, and
   the serializer was writing `1234.56` into it: load.js's post() fills
   `original` from the balance so the payoff maths has a divisor, and that
   derived figure reached the file. The household ended up permanently on
   record as having borrowed exactly what they still owe, the "paid off" bar
   read 0% forever, and there was no way to un-say it — the app correcting
   rather than arguing, on the one column whose schema comment goes to real
   trouble to keep "not stated" apart from "stated as nothing". A cell left
   empty now goes back empty. The diff is exactly one cell in one row, on rows
   that never stated an Original; a row that DOES state one (the Visa above it)
   round-trips byte for byte, which is what proves this is the narrow fix and
   not a format change.

   ISSUE 33 widened
   Services.md's Cycle vocabulary from two values to four, so the header PROSE
   this file pins — the one line telling a reader what may go in that column —
   now names all four. Nothing about the table changed: no column moved, no
   cell is written differently, and a `monthly` or `annual` row round-trips
   byte for byte as it always did. The rewrite is one comment line in
   Services.md on that file's next save, and CHANGELOG.md says so.

   That is the whole permitted shape of an update to this file: a stated
   reason, a bounded diff, and a changelog entry. A literal edited to make a
   red test green is the failure this gate exists to catch. */

/*

   Runs in bare node via tests/helpers/harness.cjs. Wired into ./build.sh.
     node tests/golden-tables.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const B = 'Budget';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Transactions/FNB Cheque/2026-07.md`]: '---\naccount: "FNB Cheque"\nmonth: 2026-07\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n| 2026-07-01 | Woolworths Gardens | Groceries | -249.99 |  |  |\n| 2026-07-02 | PnP \\| Sandton | Groceries | -1000.00 | yes | split \\| two cards |\n| 2026-07-04 | Legacy cell | Groceries | 1 234,56 |  |  |\n',
  [`${B}/Transactions/FNB Cheque/2026-08.md`]: '---\naccount: "FNB Cheque"\nmonth: 2026-08\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n| 2026-08-04 | Virgin Active | Gym | -600.00 |  |  |  |\n| 2026-08-07 | Checkers Hyper | Groceries | -1000.00 | yes | Split into 3 | parent |\n| 2026-08-07 | Checkers Hyper | Groceries | -600.00 |  |  | part |\n',
  [`${B}/Owed Money.md`]: '---\nkind: owed\naliases: [debts]\n---\n\n# Owed Money\n\n| Person | Amount | Description | Due date | Status | Repaid |\n|---|---:|---|---|---|---:|\n| Sam \\| Pete | 250.00 | lunch \\| coffee | 2026-08-01 | outstanding | |\n| Thabo | 1 500,00 | space-grouped | 2026-09-01 | outstanding | |\n| Nadia | R4000 | part repaid | | outstanding | 1 000,00 |\n',
  [`${B}/Debts.md`]: '---\nkind: debts\naliases: [liabilities]\n---\n\n# Debts\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n| Visa \\| Gold | Bank \\| A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | Groceries | active | revolving \\| card |\n| Car | WesBank | vehicle | 1 234,56 | | 11.25 | 1500.00 | 0.00 | 2023-01-15 |  | paid | multi<br>line |\n',
  [`${B}/Assets.md`]: '---\nkind: assets\naliases: [possessions]\n---\n\n# Assets\n\n| Item | Kind | Value | Valued | Notes |\n|------|------|------:|--------|-------|\n| The house \\| Gardens | property | 15 000 000 | 2026-03-01 | bonded \\| see Debts |\n| Corolla | vehicle | 70000.00 | when we bought it | non-ISO date |\n| Nameplate only | | | | |\n',
  [`${B}/Services.md`]: '---\nkind: services\n---\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|---|---|---:|---|---|---|---|---|\n| Netflix \\| HD | Netflix | 199.00 | monthly | 2026-08-05 | Groceries | yes | family \\| plan |\n| Insurance | Broker | 1 299,00 | monthly | 2026-08-15 | | yes | space-grouped |\n',
};

const GOLDEN = {
  assets: "---\nkind: assets\naliases: [possessions]\n---\n\n# Assets\n\nWhat the household owns that is not an account — property, vehicles, contents,\njewellery, metals. `Value` is what it would sell for today and `Valued` is when\nthat was last worked out. Money owed against any of these lives on the Debt page.\n\n| Item | Kind | Value | Valued | Notes |\n|------|------|------:|--------|-------|\n| The house \\| Gardens | property | 15000000.00 | 2026-03-01 | bonded \\| see Debts |\n| Corolla | vehicle | 70000.00 | when we bought it | non-ISO date |\n| Nameplate only | other | 0.00 |  |  |\n",
  owed: "---\nkind: owed\naliases: [debts]\n---\n\n# Owed Money\n\nMoney owed to the household. `status` is `outstanding` or `paid`.\n`Repaid` is how much has come back; `Lent` is when it went out.\n\n| Person | Amount | Description | Due date | Status | Repaid | Lent |\n|--------|-------:|-------------|----------|--------|-------:|------|\n| Sam \\| Pete | 250.00 | lunch \\| coffee | 2026-08-01 | outstanding | 0.00 |  |\n| Thabo | 1500.00 | space-grouped | 2026-09-01 | outstanding | 0.00 |  |\n| Nadia | 4000.00 | part repaid |  | outstanding | 1000.00 |  |\n",
  services: "---\nkind: services\n---\n\n# Services & Subscriptions\n\nRecurring services and subscriptions. `cycle` is one of: weekly, fortnightly, monthly, annual.\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|------|----------|-------:|-------|--------------|----------|--------|-------|\n| Netflix \\| HD | Netflix | 199.00 | monthly | 2026-08-05 | Groceries | yes | family \\| plan |\n| Insurance | Broker | 1299.00 | monthly | 2026-08-15 |  | yes | space-grouped |\n",
  debts: "---\nkind: debts\naliases: [liabilities]\n---\n\n# Debts\n\nMoney the household owes. `rate` is the annual interest rate as a percentage,\n`payment` the contracted monthly amount and `extra` anything paid on top of it.\n`status` is `active` or `paid`.\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|\n| Visa \\| Gold | Bank \\| A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | Groceries | active | revolving \\| card |\n| Car | WesBank | vehicle | 1234.56 |  | 11.25 | 1500.00 | 0.00 | 2023-01-15 |  | paid | multi<br>line |\n",
  tx6: "---\naccount: \"FNB Cheque\"\nmonth: 2026-07\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n| 2026-07-01 | Woolworths Gardens | Groceries | -249.99 |  |  |\n| 2026-07-02 | PnP \\| Sandton | Groceries | -1000.00 | yes | split \\| two cards |\n| 2026-07-04 | Legacy cell | Groceries | 1 234,56 |  |  |\n",
  tx7: "---\naccount: \"FNB Cheque\"\nmonth: 2026-08\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|------|-------------|----------|-------:|----------|------|-------|\n| 2026-08-04 | Virgin Active | Gym | -600.00 |  |  |  |\n| 2026-08-07 | Checkers Hyper | Groceries | -1000.00 | yes | Split into 3 | parent |\n| 2026-08-07 | Checkers Hyper | Groceries | -600.00 |  |  | part |\n",
};

(async () => {
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);
  require('../src/views/transactions')(ctx);
  require('../src/views/assets')(ctx);
  require('../src/views/debts')(ctx);
  require('../src/views/owed')(ctx);
  require('../src/views/services')(ctx);

  eq(ctx.serializeAssets(), GOLDEN.assets, 'Assets.md must serialize byte-identically to 1.17.5');
  eq(ctx.serializeOwed(), GOLDEN.owed, 'Owed Money.md must serialize byte-identically to 1.17.5');
  eq(ctx.serializeServices(), GOLDEN.services, 'Services.md must serialize byte-identically to 1.17.5');
  eq(ctx.serializeDebts(), GOLDEN.debts, 'Debts.md must serialize byte-identically to 1.17.5');
  eq(ctx.serializeTxFile(S.txFiles['FNB Cheque/2026-07']), GOLDEN.tx6,
    'a never-split month keeps its six-column shape, byte-identical to 1.17.5');
  eq(ctx.serializeTxFile(S.txFiles['FNB Cheque/2026-08']), GOLDEN.tx7,
    'a split month keeps its seven-column shape, byte-identical to 1.17.5');

  console.log(`PASS — golden gate: all five entities serialize byte-identically to 1.17.5 (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
