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

  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\naliases: [July budget]\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 | weekly shop \\| incl. household |\n| Kids/School | expense | 1 234,56 | hand-edited cell |\n',

  [`${B}/Transactions/FNB Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n| 2026-07-01 | Woolworths Gardens | Groceries | -249.99 |  |  |\n| 2026-07-02 | PnP \\| Sandton | Groceries | -1000.00 | yes | split \\| two cards |\n| 2026-07-03 | café ¥ 个人所得税 |  | 42000.50 |  | multi<br>line |\n| 2026-07-04 | Legacy cell | Groceries | 1 234,56 |  |  |\n`,

  [`${B}/Owed Money.md`]: '---\nkind: owed\naliases: [debts]\n---\n\n# Owed Money\n\n| Person | Amount | Description | Due date | Status |\n|---|---:|---|---|---|\n| Sam \\| Pete | 250.00 | lunch \\| coffee | 2026-08-01 | outstanding |\n| Léa | 40.00 | multi<br>line | | paid |\n',

  [`${B}/Services.md`]: '---\nkind: services\n---\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|---|---|---:|---|---|---|---|---|\n| Netflix \\| HD | Netflix | 199.00 | monthly | 2026-08-05 | Groceries | yes | family \\| plan |\n| Domain | Xneelo | 250.00 | annual | end of month | | no | non-ISO date |\n',

  [`${B}/Tax/2026.md`]: '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: assessed\ndeadline_standard: "2026-10-20"\nassessment_ref: "ITA34: 2026/0031"\nassessment_result: -1250.00\nassessment_income: 480000\n---\n\n# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n| Gather documents | busy | 2026-09-01 | banks \\| investments |\n| File ITR12 | todo |  |  |\n\n## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | uploaded | irp5.pdf | |\n| IT3(b) | Bank \\| A | needed | | multi<br>line |\n\n## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n| 4201 | Local interest | Bank A | 15000.00 |\n| 4201 | Local interest | Bank B | 12000.00 |\n',
};

(async () => {
  /* ---------------- pass 1: load the fixture vault ---------------- */
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);

  eq(S.settings.currency, 'R', 'quoted currency must lose its quotes on load');
  eq(S.settings.household, 'Jane & John', 'household must load');
  eq(S.categories.length, 2, 'both categories must load');
  ok(S.categories.some(c => c.name === 'Kids/School'), 'frontmatter name beats the sanitised filename');

  const odd = S.accounts.find(a => a.name === 'Odd Balance');
  eq(odd.balance, 1234.56, 'a decimal-comma balance must be READ, not guessed at');
  eq(odd.balanceRaw, '1 234,56', 'and preserved verbatim for write-back');
  const fnb = S.accounts.find(a => a.name === 'FNB Cheque');
  eq(fnb.balanceRaw, null, 'a canonical balance carries no raw');

  eq(Object.keys(S.txFiles).length, 1, 'one transactions file');
  const txKey = 'FNB Cheque/2026-07';
  ok(S.txFiles[txKey], 'txFiles must be keyed by folder name + month');
  eq(S.txFiles[txKey].rows.length, 4, 'all four rows load');
  eq(S.owed.length, 2, 'both owed rows load');
  eq(S.services.length, 2, 'both services load');
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
  require('../src/views/owed')(ctx);
  require('../src/views/services')(ctx);
  require('../src/views/tax')(ctx);

  for (const name of ['serializeTxFile', 'serializeOwed', 'serializeServices', 'serializeTax']) {
    ok(typeof ctx[name] === 'function', `${name} must be published on ctx`);
  }

  const rewritten = { ...FILES };
  rewritten[`${B}/Transactions/FNB Cheque/2026-07.md`] = ctx.serializeTxFile(S.txFiles[txKey]);
  rewritten[`${B}/Owed Money.md`] = ctx.serializeOwed();
  rewritten[`${B}/Services.md`] = ctx.serializeServices();
  ctx.S.taxYear = '2026';
  rewritten[`${B}/Tax/2026.md`] = ctx.serializeTax('2026');

  /* ---------------- pass 3: load the rewritten vault ---------------- */
  const ctx2 = makeCtx(rewritten);
  const S2 = await loadInto(ctx2);

  const strip = rows => rows.map(r => ({ ...r }));
  eq(strip(S2.txFiles[txKey].rows), strip(S.txFiles[txKey].rows),
    'every transaction field must survive serialize → load unchanged');
  eq(S2.owed, S.owed, 'owed rows must survive the round-trip');
  eq(S2.services, S.services, 'services rows must survive the round-trip');

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
