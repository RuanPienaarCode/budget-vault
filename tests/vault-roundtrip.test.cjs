'use strict';
/* Full vault round-trip: REAL loadVault → REAL serializers → REAL loadVault.

   This is the test that closes the gap the older round-trip test could not.
   That one drives the real serializeTxFile but parses with a hand-written
   MIRROR of the loader pasted into the test file — so changing a column in
   load.js alone leaves every test green while every subsequent save corrupts
   data. Here both halves are the shipped code, for every file type that has a
   serializer: transactions, budgets, owed, services and tax.

   Runs in bare node against an in-memory vault (tests/helpers/harness.cjs).
   Wired into ./build.sh.
     node tests/vault-roundtrip.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]\naliases: [July]';

/* Deliberately awkward values in every free-text column: unescaped pipes, a
   newline, a decimal-comma amount the strict parser rejects, non-ASCII, and a
   folder name containing a character safeSeg rewrites. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\nhousehold: "Jane & John"\n---\n',

  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n\n# Groceries\n',
  [`${B}/Categories/Kids-School.md`]: '---\nname: "Kids/School"\ntype: expense\ncolor: "#123456"\n---\n',

  [`${B}/Accounts/FNB Cheque.md`]: '---\ntype: checking\ninstitution: "FNB"\naccount_number: "12345678901"\ntx_label: "FNB Cheque"\nbalance: 1234.56\nbalance_updated: 2026-07-01\ntags: [finance]\n---\n\n# FNB Cheque\n\nNotes body.\n',
  [`${B}/Accounts/Odd Balance.md`]: '---\ntype: savings\nbalance: 1 234,56\n---\n',
  /* An account denominated in something other than the household currency, and
     a cash wallet that states the household's own symbol explicitly. The pair
     is here because the second is the one that goes wrong quietly: read it as
     "a currency was set" rather than as "the same currency was restated" and
     every total in a single-currency vault picks up a mixed-currency mark. */
  [`${B}/Accounts/Euro Wallet.md`]: '---\ntype: cash\ncurrency: "€"\nbalance: 250.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Rand Wallet.md`]: '---\ntype: cash\ncurrency: "R"\nbalance: 80.00\nbalance_updated: 2026-07-01\nignore_warnings: [no-transactions]\n---\n',
  /* Every OPTIONAL numeric key, written the way a person writes them by hand.
     These used to go through parseFloat, which reads "15,000" as 15 and
     "1.234,56" as 1.234 — and because saveAccount writes them back, the next
     edit to ANY field on this account serialised the truncated figure over the
     user's own. The values below are chosen so a regression is unmistakable
     rather than merely off. */
  [`${B}/Accounts/Grouped Numbers.md`]: '---\ntype: credit_card\ncredit_limit: 15,000\ngoal_amount: 1.234,56\nmonthly_contribution: 2 500\ntotal_invested: 250,000.75\nstarting_amount: 0\n---\n',

  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\naliases: [July budget]\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 | weekly shop \\| incl. household |\n| Kids/School | expense | 1 234,56 | hand-edited cell |\n',

  [`${B}/Transactions/FNB Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n| 2026-07-01 | Woolworths Gardens | Groceries | -249.99 |  |  |\n| 2026-07-02 | PnP \\| Sandton | Groceries | -1000.00 | yes | split \\| two cards |\n| 2026-07-03 | café ¥ 个人所得税 |  | 42000.50 |  | multi<br>line |\n| 2026-07-04 | Legacy cell | Groceries | 1 234,56 |  |  |\n`,

  /* A month that HAS been split, so the seventh column goes through the real
     loader rather than a mirror of it pasted into a test. July above is the
     control: it must come back out with six columns and no Split cell.

     Note the row above whose NOTE says "split | two cards" and whose Split
     cell is empty — a word in a note has never meant a role, and this is what
     stops a future reader deciding it does. */
  [`${B}/Transactions/FNB Cheque/2026-08.md`]: `---\naccount: "FNB Cheque"\nmonth: 2026-08\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n| 2026-08-04 | Virgin Active | Gym | -600.00 |  |  |  |\n| 2026-08-07 | Checkers Hyper | Groceries | -1000.00 | yes | Split into 3 | parent |\n| 2026-08-07 | Checkers Hyper | Groceries | -600.00 |  |  | part |\n| 2026-08-07 | Checkers Hyper | Household | -280.00 |  |  | part |\n| 2026-08-07 | Checkers Hyper | Pharmacy | -120.00 |  |  | part |\n`,

  /* Rows 3 and 4 are hand-typed the way Assets.md and Debts.md already are: a
     space-grouped amount, a comma-grouped one, and a currency prefix. The
     Amount and Repaid columns are arithmetic input like a debt balance, so
     they must be READ, not truncated — and this file is the one place that can
     prove it, because owed-math's own suite builds its rows from numeric
     literals and never goes through the loader. */
  [`${B}/Owed Money.md`]: '---\nkind: owed\naliases: [debts]\n---\n\n# Owed Money\n\n| Person | Amount | Description | Due date | Status | Repaid |\n|---|---:|---|---|---|---:|\n| Sam \\| Pete | 250.00 | lunch \\| coffee | 2026-08-01 | outstanding | |\n| Léa | 40.00 | multi<br>line | | paid | |\n| Thabo | 1 500,00 | space-grouped \\| comma decimal | 2026-09-01 | outstanding | |\n| Nadia | R4000 | currency prefix, part repaid | | outstanding | 1 000,00 |\n| Yusuf | 12,500.00 | comma-grouped thousands | | outstanding | |\n| Pieter | ask him | never wrote it down | | disputed | |\n',

  [`${B}/Debts.md`]: '---\nkind: debts\naliases: [liabilities]\n---\n\n# Debts\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n| Visa \\| Gold | Bank \\| A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | Groceries | active | revolving \\| card |\n| Car | WesBank | vehicle | 1 234,56 | 90000.00 | 11.25 | 1500.00 | 0.00 | 2023-01-15 |  | paid | multi<br>line |\n| Store card | Edgars | credit card | 2 400 R | prime + 2 | prime + 2 | 300.00 | 0.00 | 2025-05-01 |  | written off | four cells nobody can read |\n',

  /* A hand-written Assets.md: a space-grouped value that parseFloat would read
     as 15, an unescaped pipe in a name, a non-ISO valuation date, a kind that
     is not one of the presets, and a row with nothing but a name. */
  [`${B}/Assets.md`]: '---\nkind: assets\naliases: [possessions]\n---\n\n# Assets\n\n| Item | Kind | Value | Valued | Notes |\n|------|------|------:|--------|-------|\n| The house \\| Gardens | property | 15 000 000 | 2026-03-01 | bonded \\| see Debts |\n| Corolla | vehicle | 70000.00 | when we bought it | non-ISO date |\n| Rings | jewellery | 60000.00 | 2019-11-02 | multi<br>line |\n| Krugerrands | precious metals | 1.234,56 | | hand-edited cell |\n| Nameplate only | | | | |\n| Ring | jewellery | 12 000 R | 2026-01-01 | value nobody can read |\n',

  /* Same hazard in the Services amount column, which feeds the committed total
     the Dashboard subtracts from "actually free to spend". */
  [`${B}/Services.md`]: '---\nkind: services\n---\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|---|---|---:|---|---|---|---|---|\n| Netflix \\| HD | Netflix | 199.00 | monthly | 2026-08-05 | Groceries | yes | family \\| plan |\n| Domain | Xneelo | 250.00 | annual | end of month | | no | non-ISO date |\n| School fees | Academy | 5,430.00 | monthly | 2026-08-01 | | yes | comma-grouped |\n| Insurance | Broker | 1 299,00 | monthly | 2026-08-15 | | yes | space-grouped |\n| Gym | Virgin Active | about R400 | quarterly | 2026-08-20 | | yes | amount AND cycle nobody can model |\n| Padel | Club | 250.00 | weekly | 2026-08-20 | | yes | ISSUE 33: a cycle this app models now |\n',

  [`${B}/Tax/2026.md`]: '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: assessed\ndeadline_standard: "2026-10-20"\nassessment_ref: "ITA34: 2026/0031"\nassessment_result: -1250.00\nassessment_income: 480000\n---\n\n# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n| Gather documents | busy | 2026-09-01 | banks \\| investments |\n| File ITR12 | todo |  |  |\n\n## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | uploaded | irp5.pdf | |\n| IT3(b) | Bank \\| A | needed | | multi<br>line |\n\n## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n| 4201 | Local interest | Bank A | 15000.00 |\n| 4201 | Local interest | Bank B | 12000.00 |\n',
};

(async () => {
  /* ---------------- pass 1: load the fixture vault ---------------- */
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);

  eq(S.settings.currency, 'R', 'quoted currency must lose its quotes on load');
  eq(S.settings.household, 'Jane & John', 'household must load');
  eq(S.settings.period_days, 0, 'a Settings.md with no period keys means the payday month');
  eq(S.settings.period_anchor, '', 'and carries no anchor');

  /* The stored setting and the running one must never disagree. The loader
     bands the value on the way in, so a settings control can read
     S.settings.period_days and describe the cycle the app is ACTUALLY running
     — rather than reporting a 400-day cycle at a vault quietly on months. */
  for (const [fm, days, anchor, why] of [
    ['period_days: 14\nperiod_anchor: 2026-08-07', 14, '2026-08-07', 'a valid pair loads as given'],
    ['period_days: 400\nperiod_anchor: 2026-08-07', 0, '2026-08-07', 'an out-of-band length is stored as 0, not coerced to 31'],
    ['period_days: 3\nperiod_anchor: 2026-08-07', 0, '2026-08-07', 'a length below the floor is stored as 0'],
    ['period_days: banana\nperiod_anchor: 2026-08-07', 0, '2026-08-07', 'a non-numeric length is stored as 0'],
    ['period_days: 14', 0, '', 'a length with no anchor drops BOTH — nothing to count from'],
    ['period_days: 14\nperiod_anchor: 7 Aug 2026', 0, '', 'a non-ISO anchor drops both'],
    /* Date-SHAPED is not the same as a date. Date.UTC rolls 2026-13-45 forward
       to 2027-02-14 without complaint, so a shape check stored the pair and the
       app ran a cycle counted from a day Settings.md never named — and once
       period.js started refusing it, the settings screen went on offering a
       cycle that was not running. Both halves reject it now. */
    ['period_days: 14\nperiod_anchor: 2026-13-45', 0, '', 'a date-shaped non-date drops both'],
    ['period_days: 14\nperiod_anchor: 2026-02-30', 0, '', 'as does a day that month never had'],
  ]) {
    const s = await loadInto(makeCtx({ ...FILES,
      [`${B}/Settings.md`]: `---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\n${fm}\n---\n` }));
    eq([s.settings.period_days, s.settings.period_anchor], [days, anchor], why);
  }
  eq(S.categories.length, 2, 'both categories must load');
  ok(S.categories.some(c => c.name === 'Kids/School'), 'frontmatter name beats the sanitised filename');

  const odd = S.accounts.find(a => a.name === 'Odd Balance');
  eq(odd.balance, 1234.56, 'a decimal-comma balance must be READ, not guessed at');
  eq(odd.balanceRaw, '1 234,56', 'and preserved verbatim for write-back');
  const fnb = S.accounts.find(a => a.name === 'FNB Cheque');
  eq(fnb.balanceRaw, null, 'a canonical balance carries no raw');

  /* The optional numeric keys get the same reading as `balance`, because they
     are written back the same way. A grouped thousands separator is the normal
     way to type a credit limit; truncating it is silent data loss. */
  const grp = S.accounts.find(a => a.name === 'Grouped Numbers');
  eq(grp.credit_limit, 15000, 'credit_limit "15,000" must read as 15000, not 15');
  eq(grp.goal_amount, 1234.56, 'goal_amount "1.234,56" must read as 1234.56, not 1.234');
  eq(grp.monthly_contribution, 2500, 'a space-grouped monthly_contribution must read whole');
  eq(grp.total_invested, 250000.75, 'a comma-grouped total_invested must keep its cents');
  // Zero is a figure the file states; it must not collapse into "not set".
  eq(grp.starting_amount, 0, 'an explicit 0 stays 0');
  const noneSet = S.accounts.find(a => a.name === 'FNB Cheque');
  eq(noneSet.credit_limit, null, 'an absent optional number is null, not NaN');

  /* Per-account currency, through the REAL loader. It is a display symbol —
     the balance beside it is untouched, because nothing converts. */
  const { symbolOf, isForeign, currenciesIn } = require('../src/currency');
  const euro = S.accounts.find(a => a.name === 'Euro Wallet');
  eq(euro.currency, '€', 'a currency key must load');
  eq(euro.balance, 250, 'and the balance beside it is NOT converted');
  eq(symbolOf(euro, S.settings.currency), '€', 'so this account prints in its own symbol');
  eq(isForeign(euro, S.settings.currency), true, 'and reads as foreign');
  eq(noneSet.currency, '', 'an account with no currency key loads as empty, not undefined');
  eq(symbolOf(noneSet, S.settings.currency), 'R', 'and falls back to the household symbol');
  eq(isForeign(S.accounts.find(a => a.name === 'Rand Wallet'), S.settings.currency), false,
    'restating the household symbol is not a second currency');
  eq(currenciesIn(S.accounts, S.settings.currency), ['R', '€'],
    'this vault spans two symbols, so its totals must disclose it');

  /* The muted-warning key, read by the REAL loader off the shape a hand-edited
     wallet actually carries — a YAML flow list of readable words. This is the
     join that a unit test on the parser alone cannot check: frontmatter values
     arrive here as flat strings, so a list the loader mangled would still
     parse "successfully" into a mute of nothing. */
  const { mutedWarnings } = require('../src/acct-status');
  const rand = S.accounts.find(a => a.name === 'Rand Wallet');
  eq(rand.ignore_warnings, '[no-transactions]', 'the raw key survives the loader verbatim');
  eq([...mutedWarnings(rand)], ['notx'], 'and resolves to the state the page checks');
  eq([...mutedWarnings(euro)], [], 'an account without the key mutes nothing');

  eq(Object.keys(S.txFiles).length, 2, 'two transactions files');
  const txKey = 'FNB Cheque/2026-07';
  const splitKey = 'FNB Cheque/2026-08';
  ok(S.txFiles[txKey], 'txFiles must be keyed by folder name + month');
  eq(S.txFiles[txKey].rows.length, 4, 'all four rows load');

  /* The Split column, read by the REAL loader. */
  eq(S.txFiles[txKey].rows.map(r => r.split), ['', '', '', ''],
    'a six-column file gives every row an empty role, including one whose note says "split"');
  eq(S.txFiles[splitKey].rows.map(r => r.split), ['', 'parent', 'part', 'part', 'part'],
    'the roles load off disk in row order');
  const splitRows = S.txFiles[splitKey].rows;
  eq(splitRows.filter(r => r.split === 'part').reduce((s, r) => s + r.amount, 0), -1000,
    'the parts loaded off disk sum to the parent loaded off disk');
  eq(S.owed.length, 6, 'every owed row loads');
  eq(S.services.length, 6, 'every service loads');
  eq(S.debts.length, 3, 'every debt loads');

  /* The Owed and Services money columns were the last three in this file still
     read with parseFloat, which stops at the first character it cannot use:
     "1 500,00" became 1, "12,500.00" became 12, "R4000" became NaN → 0. Every
     other money column here was moved to parseNum with a comment saying why,
     so this is an unfinished sweep rather than a decision.

     It has to be caught HERE, on the absolute value, and not by the round-trip
     equality further down: serializeOwed writes o.amount.toFixed(2), so a
     truncated 1 is written back as "1.00" and reloads as 1. Both passes agree
     perfectly on the wrong number — the round-trip is self-consistent while
     being silently destructive, which is exactly how one Save turns a R1 500
     loan into a R1 loan on disk. */
  const owedOf = p => S.owed.find(o => o.person === p);
  eq(owedOf('Thabo').amount, 1500, 'a space-grouped owed amount must be READ, not truncated to 1');
  eq(owedOf('Yusuf').amount, 12500, 'a comma-grouped owed amount must not be truncated to 12');
  eq(owedOf('Nadia').amount, 4000, 'a currency-prefixed owed amount must not fall through to 0');
  eq(owedOf('Nadia').repaid, 1000, 'and the Repaid column is read the same way');
  eq(owedOf('Sam | Pete').amount, 250, 'a plain amount is unaffected');

  /* The consequence the loader alone cannot show: with amount 0 and repaid 1,
     outstandingOf floors at 0 and isSettled calls a live loan Paid — it leaves
     the Outstanding total and renders a green pill. */
  const { outstandingOf, isSettled } = require('../src/owed-math');
  eq(outstandingOf(owedOf('Nadia')), 3000, 'outstanding is the amount net of what came back');
  eq(isSettled(owedOf('Nadia')), false, 'a live loan must not read as settled because its cell failed to parse');

  const svcOf = n => S.services.find(s => s.name === n);
  eq(svcOf('School fees').amount, 5430, 'a comma-grouped service amount must not be truncated to 5');
  eq(svcOf('Insurance').amount, 1299, 'a space-grouped service amount must not be truncated to 1');
  eq(svcOf('Netflix | HD').amount, 199, 'a plain service amount is unaffected');

  eq(S.assets.length, 6, 'every asset row loads, including the one with only a name');
  const house = S.assets.find(a => a.name === 'The house | Gardens');
  eq(house.value, 15000000, 'a space-grouped value must be READ, not truncated to 15');
  eq(house.type, 'property', 'the kind loads');
  eq(S.assets.find(a => a.name === 'Krugerrands').value, 1234.56,
    'a decimal-comma value must be read the same way a debt balance is');
  eq(S.assets.find(a => a.name === 'Corolla').valued, 'when we bought it',
    'a hand-typed valuation date is kept verbatim rather than blanked');
  const bare = S.assets.find(a => a.name === 'Nameplate only');
  eq([bare.value, bare.valued, bare.notes], [0, '', ''],
    'a row with nothing but a name loads with empty optionals, not NaN');
  eq(bare.type, 'other', 'and an absent kind is named rather than left blank');
  eq(S.debts[1].balance, 1234.56, 'a decimal-comma debt balance must be READ, not truncated to 1');
  eq(S.debts[0].original, 12000, 'the original amount loads for the paid-off bar');
  eq(S.debts[1].status, 'paid', 'a settled debt keeps its status');
  eq(S.tax['2026'].steps.length, 2, 'both tax steps load');
  eq(S.tax['2026'].docs.length, 2, 'both tax docs load');
  eq(S.tax['2026'].figures.length, 2, 'both tax figures load');
  eq(S.tax['2026'].assessment_ref, 'ITA34: 2026/0031', 'a quoted ref with a colon must survive');

  /* ---------------- pass 2: serialize everything back ---------------- */
  // Register the view modules that own serializers, in controller.js order.
  require('../src/categories')(ctx);
  require('../src/views/dashboard')(ctx);
  require('../src/views/transactions')(ctx);
  require('../src/views/budgets')(ctx);
  require('../src/views/accounts')(ctx);
  require('../src/views/savings')(ctx);
  require('../src/views/assets')(ctx);
  require('../src/views/debts')(ctx);
  require('../src/views/owed')(ctx);
  require('../src/views/services')(ctx);
  require('../src/views/tax')(ctx);

  for (const name of ['serializeTxFile', 'serializeDebts', 'serializeOwed', 'serializeServices',
                      'serializeTax', 'serializeAssets']) {
    ok(typeof ctx[name] === 'function', `${name} must be published on ctx`);
  }

  const rewritten = { ...FILES };
  rewritten[`${B}/Transactions/FNB Cheque/2026-07.md`] = ctx.serializeTxFile(S.txFiles[txKey]);
  rewritten[`${B}/Transactions/FNB Cheque/2026-08.md`] = ctx.serializeTxFile(S.txFiles[splitKey]);
  rewritten[`${B}/Debts.md`] = ctx.serializeDebts();
  rewritten[`${B}/Owed Money.md`] = ctx.serializeOwed();
  rewritten[`${B}/Services.md`] = ctx.serializeServices();
  rewritten[`${B}/Assets.md`] = ctx.serializeAssets();
  ctx.S.taxYear = '2026';
  rewritten[`${B}/Tax/2026.md`] = ctx.serializeTax('2026');

  /* ---------------- pass 3: load the rewritten vault ---------------- */
  const ctx2 = makeCtx(rewritten);
  const S2 = await loadInto(ctx2);

  const strip = rows => rows.map(r => ({ ...r }));
  eq(strip(S2.txFiles[txKey].rows), strip(S.txFiles[txKey].rows),
    'every transaction field must survive serialize → load unchanged');
  eq(strip(S2.txFiles[splitKey].rows), strip(S.txFiles[splitKey].rows),
    'a split file survives serialize → load with both roles intact');

  /* The column is written where it means something and nowhere else. Asserted
     on the REWRITTEN text, because the cost this avoids is a diff in every
     month of every account in a folder the reader syncs and reads. */
  ok(!/\| Split \|/.test(rewritten[`${B}/Transactions/FNB Cheque/2026-07.md`]),
    'a month with no split is written back with its original six columns');
  ok(/\| Split \|/.test(rewritten[`${B}/Transactions/FNB Cheque/2026-08.md`]),
    'a month with a split keeps the seventh column');
  eq(S2.owed, S.owed, 'owed rows must survive the round-trip');
  eq(S2.services, S.services, 'services rows must survive the round-trip');
  eq(S2.debts, S.debts, 'debt rows must survive the round-trip');
  eq(S2.assets, S.assets, 'asset rows must survive the round-trip');

  const t1 = S.tax['2026'], t2 = S2.tax['2026'];
  for (const k of ['taxpayer_type', 'assessment', 'deadline_standard', 'deadline_provisional',
                   'assessment_date', 'assessment_ref', 'assessment_result', 'assessment_income']) {
    eq(t2[k], t1[k], `tax frontmatter '${k}' must survive the round-trip`);
  }
  eq(t2.steps, t1.steps, 'tax steps must survive the round-trip');
  eq(t2.docs, t1.docs, 'tax docs must survive the round-trip');
  eq(t2.figures, t1.figures, 'tax figures must survive the round-trip');

  /* ---------------- unmodeled frontmatter must not be dropped ------------- */
  ok(/aliases:\s*\[July\]/.test(rewritten[`${B}/Transactions/FNB Cheque/2026-07.md`]),
    'a key the model does not carry (aliases) must survive the write-back');
  ok(/aliases:\s*\[debts\]/.test(rewritten[`${B}/Owed Money.md`]),
    'owed frontmatter must be preserved verbatim');
  ok(/aliases:\s*\[liabilities\]/.test(rewritten[`${B}/Debts.md`]),
    'debts frontmatter must be preserved verbatim');
  ok(/aliases:\s*\[possessions\]/.test(rewritten[`${B}/Assets.md`]),
    'assets frontmatter must be preserved verbatim');

  /* ---------------- the non-canonical cell is written back verbatim ------- */
  ok(rewritten[`${B}/Transactions/FNB Cheque/2026-07.md`].includes('1 234,56'),
    'a cell the strict parser rejected must be written back byte-for-byte');

  /* ---------------- the UNREADABLE cell survives a save ------------------ */
  /* The four flat tables were the unfinished half of the amountRaw contract
     above. A cell normalizeAmount cannot read — "12 000 R", "prime + 2",
     "ask him", "about R400" — parses to a FABRICATED 0, and the write side
     used to render that 0 as "0.00" and put it on disk, so a save triggered by
     an edit to some other row on the page overwrote the reader's own text with
     a figure the file never stated.

     This has to be asserted on the REWRITTEN BYTES, not by the deep-equality
     round-trip below: a destroyed cell reloads as 0 and both passes agree
     perfectly on the wrong number — self-consistent and silently destructive,
     exactly the trap the Thabo/Yusuf comment further up names. */
  for (const [file, cell, why] of [
    [`${B}/Assets.md`, '12 000 R', 'an asset value'],
    [`${B}/Debts.md`, '2 400 R', 'a debt balance'],
    [`${B}/Debts.md`, 'prime + 2', 'a rate written as the thing it tracks (twice: Original and Rate)'],
    [`${B}/Owed Money.md`, 'ask him', 'an amount the lender never worked out'],
    [`${B}/Services.md`, 'about R400', 'a service amount typed as prose'],
  ]) {
    ok(rewritten[file].includes(cell),
      `${why} nobody can read must come back byte-for-byte, never "0.00" over it`);
  }
  ok(!/\| Ring \| jewellery \| 0\.00 \|/.test(rewritten[`${B}/Assets.md`]),
    'and specifically NOT as the fabricated zero the reader never typed');

  /* Both of the debt's unreadable cells, not just the first — Original is a
     hand-spelled column rather than one money() built, and had to learn the
     same rule separately. */
  eq((rewritten[`${B}/Debts.md`].match(/prime \+ 2/g) || []).length, 2,
    'Original and Rate each keep their own text — the bespoke column follows money()\'s contract');

  /* The value the app COMPUTES with is still the honest fallback. Preserving
     the text is not the same as trusting it: every total this row reaches
     still sees 0, which is what the reader is shown and can act on. */
  eq(S.assets.find(a => a.name === 'Ring').value, 0,
    'an unreadable value is still 0 for arithmetic — the text is kept, not believed');
  eq(S.assets.find(a => a.name === 'Ring').valueRaw, '12 000 R',
    'and the raw rides alongside it, the way balanceRaw does on an account');

  /* ---------------- the UNRECOGNISED VOCABULARY cell survives too --------- */
  /* The same defect one column to the right, and the half the money sweep left
     behind. table-schema.js's vocab() coerced anything that was not `match` to
     `other` and kept nothing of what the cell said, so the write put `other`
     back: a hand-written `weekly` in Services.md became `monthly` on disk, and
     `written off` / `disputed` became `active` / `outstanding`. Words a
     lender's own paperwork really uses, destroyed by a save the reader
     triggered from a different row.

     Asserted on the REWRITTEN BYTES for the same reason the money block above
     is: a destroyed cell reloads as the coerced default and both passes agree
     perfectly on the wrong word — self-consistent and silently destructive. */
  for (const [file, cell, why] of [
    [`${B}/Services.md`, 'quarterly', 'a billing cycle this app does not model'],
    [`${B}/Debts.md`, 'written off', 'a debt status the lender uses and the column has no room for'],
    [`${B}/Owed Money.md`, 'disputed', 'a loan the two parties do not agree about'],
  ]) {
    ok(rewritten[file].includes(cell),
      `${why} must come back byte-for-byte, never the coerced default over it`);
  }
  ok(!/\| Gym \| Virgin Active \| about R400 \| monthly \|/.test(rewritten[`${B}/Services.md`]),
    'and specifically NOT as the monthly the reader never typed');

  /* What the app COMPUTES with is still the coerced value — preserving the word
     is not believing it. Every consumer downstream (recurring.js's
     nextExpected/chargeStatus, committed.js, monthlyEquiv) branches on the two
     known values and must not have changed behaviour by one row. */
  eq(svcOf('Gym').cycle, 'monthly',
    'an unrecognised cycle still reads as monthly for every consumer — only the file changed');
  eq(svcOf('Gym').cycleRaw, 'quarterly', 'with the reader\'s own word riding alongside it');

  /* ISSUE 33. `weekly` used to be the example on this very line — a word the
     household could type and the app would quietly store as `monthly`. It is a
     cycle now, so it reads as itself and carries no raw: the preservation
     machinery above is for words the app genuinely cannot model, and widening
     the vocabulary is what stops a real cadence needing it. */
  eq(svcOf('Padel').cycle, 'weekly', 'a weekly service reads as weekly, for every consumer');
  eq(svcOf('Padel').cycleRaw, undefined,
    'and carries no preserved raw, because nothing was coerced');
  ok(/\| Padel \| Club \| 250.00 \| weekly \|/.test(rewritten[`${B}/Services.md`]),
    'and round-trips byte-for-byte as the word the reader typed');
  eq(S.debts.find(d => d.name === 'Store card').status, 'active',
    'and an unrecognised debt status still reads as active, exactly as it always did');

  /* ---------------- txSegment: memory key and write path agree ------------ */
  // The bug this guards: load keyed by the raw folder name while writers keyed
  // by safeSeg(label), so a folder containing ':' (legal on macOS) missed the
  // lookup while the write still hit the file — rebuilding it with one row.
  eq(ctx2.txSegment('FNB Cheque'), 'FNB Cheque', 'an existing folder keeps its on-disk name');
  const ctx3 = makeCtx({ ...FILES,
    [`${B}/Transactions/FNB:Joint/2026-07.md`]: `---\naccount: "FNB:Joint"\nmonth: 2026-07\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n| 2026-07-01 | Existing row | | -10.00 | | |\n` });
  const S3 = await loadInto(ctx3);
  const oddKey = Object.keys(S3.txFiles).find(k => k.startsWith('FNB:Joint'));
  ok(oddKey, 'a folder name containing ":" must still load');
  eq(ctx3.txSegment('FNB:Joint'), 'FNB:Joint',
    'txSegment must return the EXISTING folder name, not a re-sanitised one — ' +
    'otherwise the write lands on the loaded file while the lookup misses');
  eq(`${ctx3.txSegment('FNB:Joint')}/2026-07`, oddKey,
    'the resolved segment must reproduce the key loadVault used');
  eq(ctx3.txSegment('Brand New Account'), 'Brand New Account',
    'a label never written before is sanitised into a new segment');

  /* The same bug through the door the ':' case does not cover: CASE.

     `tx_label` is hand-editable frontmatter and syncs between devices, so
     `tx_label: cheque` against a folder named `Cheque` is an ordinary typo, not
     a contrivance. Neither comparison here folded case, so the lookup missed —
     while macOS, iOS and Windows all resolve the two paths to the SAME file.
     The write then rebuilt that month holding only the newly imported rows.

     (Measured 10 Aug 2026: Obsidian stops the destruction by accident rather
     than design — vault.getFileByPath is case-SENSITIVE so the plugin takes the
     create branch, and vault.create guards with adapter.exists, which is
     case-INSENSITIVE on APFS, so it throws "File already exists." History
     survives; that account's month simply can never import, with an error the
     reader cannot act on. Resolving the label correctly is still the fix.) */
  const ctxCase = makeCtx({ ...FILES });
  await loadInto(ctxCase);
  eq(ctxCase.txSegment('fnb cheque'), 'FNB Cheque',
    'a label differing only in case must resolve to the folder already on disk');
  eq(ctxCase.txSegment('FNB CHEQUE'), 'FNB Cheque',
    'in either direction');
  eq(ctxCase.txSegment('FNB Cheque'), 'FNB Cheque',
    'and an exact match is unaffected');

  console.log(`PASS — full vault round-trip through the REAL loader + serializers (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
