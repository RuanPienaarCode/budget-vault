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

  [`${B}/Owed Money.md`]: '---\nkind: owed\naliases: [debts]\n---\n\n# Owed Money\n\n| Person | Amount | Description | Due date | Status |\n|---|---:|---|---|---|\n| Sam \\| Pete | 250.00 | lunch \\| coffee | 2026-08-01 | outstanding |\n| Léa | 40.00 | multi<br>line | | paid |\n',

  [`${B}/Debts.md`]: '---\nkind: debts\naliases: [liabilities]\n---\n\n# Debts\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n| Visa \\| Gold | Bank \\| A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | Groceries | active | revolving \\| card |\n| Car | WesBank | vehicle | 1 234,56 | 90000.00 | 11.25 | 1500.00 | 0.00 | 2023-01-15 |  | paid | multi<br>line |\n',

  /* A hand-written Assets.md: a space-grouped value that parseFloat would read
     as 15, an unescaped pipe in a name, a non-ISO valuation date, a kind that
     is not one of the presets, and a row with nothing but a name. */
  [`${B}/Assets.md`]: '---\nkind: assets\naliases: [possessions]\n---\n\n# Assets\n\n| Item | Kind | Value | Valued | Notes |\n|------|------|------:|--------|-------|\n| The house \\| Gardens | property | 15 000 000 | 2026-03-01 | bonded \\| see Debts |\n| Corolla | vehicle | 70000.00 | when we bought it | non-ISO date |\n| Rings | jewellery | 60000.00 | 2019-11-02 | multi<br>line |\n| Krugerrands | precious metals | 1.234,56 | | hand-edited cell |\n| Nameplate only | | | | |\n',

  [`${B}/Services.md`]: '---\nkind: services\n---\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|---|---|---:|---|---|---|---|---|\n| Netflix \\| HD | Netflix | 199.00 | monthly | 2026-08-05 | Groceries | yes | family \\| plan |\n| Domain | Xneelo | 250.00 | annual | end of month | | no | non-ISO date |\n',

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
  eq(S.owed.length, 2, 'both owed rows load');
  eq(S.services.length, 2, 'both services load');
  eq(S.debts.length, 2, 'both debts load');

  eq(S.assets.length, 5, 'every asset row loads, including the one with only a name');
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

  console.log(`PASS — full vault round-trip through the REAL loader + serializers (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
