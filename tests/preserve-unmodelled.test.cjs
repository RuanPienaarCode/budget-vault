'use strict';
/* Issues #67/#69 — a save must keep both the plugin's own model AND whatever
   it does not model: prose above/below/between a table (#67) and a column
   past the schema's own (#69). Runs the REAL loader and the REAL serializers
   (tests/vault-roundtrip.test.cjs's own rule — a hand-written mirror of the
   loader would stay green while load.js drifted from it), over the four flat
   tables (table-schema.js's mdTableFile), the two multi-table files (tax,
   plan) and transactions, plus budget-file.js's single table.

     node tests/preserve-unmodelled.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\n---\n';

/* ---------------------------------------------------------------------- */
/* #67 — a paragraph above a Debts.md table, and a `## My own notes`       */
/* section below it. Both single-file, so the byte-identical proof this   */
/* module already promises (golden-tables.test.cjs) is the bar: the file  */
/* must come back byte for byte, extras and all.                          */
/* ---------------------------------------------------------------------- */
(async () => {
  const debtsFile =
    '---\nkind: debts\n---\n\n# Debts\n\nMoney the household owes. `rate` is the annual interest rate as a percentage,\n' +
    '`payment` the contracted monthly amount and `extra` anything paid on top of it.\n`status` is `active` or `paid`.\n\n' +
    'A paragraph the household typed themselves, above the table.\n\n' +
    '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n' +
    '|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|\n' +
    '| Visa | Bank A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | Groceries | active |  |\n\n' +
    '## My own notes\n\nCall the bank about the rate increase in March.\n';

  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Debts.md`]: debtsFile });
  await loadInto(ctx);
  require('../src/views/debts.js')(ctx);
  const out = ctx.serializeDebts();
  eq(out, debtsFile, '#67: a paragraph above the table AND a heading below it both survive byte for byte');

  // Three saves in a row must be a fixed point, not merely one lucky pass.
  let prev = out;
  for (let i = 0; i < 3; i++) {
    const c2 = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Debts.md`]: prev });
    await loadInto(c2);
    require('../src/views/debts.js')(c2);
    const next = c2.serializeDebts();
    eq(next, prev, `#67: save ${i + 2} is byte-identical to save ${i + 1} (stable fixed point)`);
    prev = next;
  }

  // Editing a modelled field must not disturb the unmodelled content beside it.
  const c3 = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Debts.md`]: debtsFile });
  const S3 = await loadInto(c3);
  require('../src/views/debts.js')(c3);
  S3.debts[0].payment = 450;
  const edited = c3.serializeDebts();
  ok(edited.includes('A paragraph the household typed themselves, above the table.'),
    '#67: the lead paragraph survives an edit to a modelled cell');
  ok(edited.includes('## My own notes\n\nCall the bank about the rate increase in March.'),
    '#67: the trailing section survives an edit to a modelled cell');
  ok(edited.includes('| Visa | Bank A | credit card | 8000.00 | 12000.00 | 22.50 | 450.00 |'),
    '#67: the edit itself actually took');

  /* -------- edge case: trailing content with NO trailing newline -------- */
  const noNL = debtsFile.slice(0, -1); // drop the file's own final \n
  const c4 = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Debts.md`]: noNL });
  await loadInto(c4);
  require('../src/views/debts.js')(c4);
  eq(c4.serializeDebts(), noNL, '#67: a file with no trailing newline round-trips exactly, newline included');

  console.log('PASS — #67 part 1/2 (single-table lead+trail): ' + checks + ' checks so far');
})()

/* ---------------------------------------------------------------------- */
/* #67 — tax.js and plan.js: a lead paragraph, an unrecognised `##`        */
/* section, and a plain paragraph left after one of the plugin's own      */
/* tables (the "between/around" case the multi-table files need).         */
/* ---------------------------------------------------------------------- */
.then(async () => {
  /* The extra lead paragraph sits AFTER the plugin's own fixed intro block
     (title + the three intro lines), never before or inside it: those three
     lines are regenerated fresh every save (loc.authority/yearSpan must keep
     tracking a country change), so withLeadExtra can only tell "the reader's
     own text" from "the plugin's own text" by its POSITION past that fixed,
     known-length block — see markdown.js's withLeadExtra. */
  const taxFile =
    '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: assessed\n---\n\n' +
    '# Tax Year 2026\n\n' +
    'SARS return tracking for the 2026 tax year (1 Mar 2025 – 28 Feb 2026).\n' +
    'Step `status` is `todo`, `busy`, `done` or `n/a`; document `status` is `needed`, `uploaded` or `n/a`.\n' +
    'Uploaded files live in `Tax/2026/`.\n\n' +
    'A note about this year I want kept.\n\n' +
    '## Progress\n\n| Step | Status | Due | Notes |\n|------|--------|-----|-------|\n' +
    '| Gather documents | busy | 2026-09-01 |  |\n\n' +
    'A note the household left right under Progress, no heading of its own.\n\n' +
    '## Documents\n\n| Document | Source | Status | File | Notes |\n|----------|--------|--------|------|-------|\n' +
    '| IRP5 | Employer | uploaded | irp5.pdf |  |\n\n' +
    '## Figures\n\n| Source code | Description | Source | Amount |\n|------|-------------|--------|--------|\n' +
    '| 4201 | Local interest | Bank A | 15000.00 |\n\n' +
    '## My own working\n\nNotes for next year: ask the accountant about provisional dates.\n';

  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Tax/2026.md`]: taxFile });
  const S = await loadInto(ctx);
  require('../src/views/tax.js')(ctx);
  ctx.S.taxYear = '2026';
  const out = ctx.serializeTax('2026');

  ok(out.includes('A note about this year I want kept.'), '#67 tax: the lead paragraph above the intro survives');
  ok(out.includes('A note the household left right under Progress, no heading of its own.'),
    '#67 tax: a plain paragraph left under a known table (no heading) survives, positioned after that table');
  ok(out.includes('## My own working\n\nNotes for next year: ask the accountant about provisional dates.'),
    '#67 tax: a genuinely unrecognised `## heading` anywhere in the file survives');
  ok(out.indexOf('A note the household left') < out.indexOf('## Documents'),
    "#67 tax: the paragraph left under Progress lands before Documents, not after it");
  ok(out.indexOf('## Figures') < out.indexOf('## My own working'),
    '#67 tax: the trailing unknown heading stays after Figures, not hoisted to the top');

  // Reload the rewritten file and confirm every modelled field still parses —
  // extras riding alongside must never corrupt the table state itself.
  const S2 = await loadInto(makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Tax/2026.md`]: out }));
  eq(S2.tax['2026'].steps.length, 1, '#67 tax: steps still parse after extras are re-emitted');
  eq(S2.tax['2026'].docs.length, 1, '#67 tax: docs still parse after extras are re-emitted');
  eq(S2.tax['2026'].figures.length, 1, '#67 tax: figures still parse after extras are re-emitted');

  // Stability over repeated saves.
  const out2 = (() => {
    const c2 = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Tax/2026.md`]: out });
    return loadInto(c2).then(() => { require('../src/views/tax.js')(c2); c2.S.taxYear = '2026'; return c2.serializeTax('2026'); });
  })();
  return out2.then(async o2 => {
    eq(o2, out, '#67 tax: a second save is byte-identical to the first (stable fixed point)');

    /* Negative control for withLeadExtra's safety fallback (markdown.js): if
       a reader inserts text INSIDE the fixed intro rather than after it, the
       position-based split can no longer trust where "extra" starts. Proven
       unsafe first — a naive position-only split (no alignment check) would
       duplicate "Uploaded files live in..." and lose the reader's own line,
       which is exactly what an earlier version of this fix did here. */
    const misalignedTax =
      '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: assessed\n---\n\n' +
      '# Tax Year 2026\n\nA note inserted BEFORE the intro, not after it.\n\n' +
      'SARS return tracking for the 2026 tax year (1 Mar 2025 – 28 Feb 2026).\n' +
      'Step `status` is `todo`, `busy`, `done` or `n/a`; document `status` is `needed`, `uploaded` or `n/a`.\n' +
      'Uploaded files live in `Tax/2026/`.\n\n' +
      '## Progress\n\n| Step | Status | Due | Notes |\n|------|--------|-----|-------|\n\n' +
      '## Documents\n\n| Document | Source | Status | File | Notes |\n|----------|--------|--------|------|-------|\n\n' +
      '## Figures\n\n| Source code | Description | Source | Amount |\n|------|-------------|--------|--------|\n';
    const cM = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Tax/2026.md`]: misalignedTax });
    await loadInto(cM);
    require('../src/views/tax.js')(cM);
    cM.S.taxYear = '2026';
    const outM = cM.serializeTax('2026');
    eq((outM.match(/Uploaded files live in/g) || []).length, 1,
      '#67 tax: a misaligned insertion must not duplicate the plugin\'s own line');
    ok(outM.includes('A note inserted BEFORE the intro, not after it.'),
      '#67 tax: the reader\'s own line is never lost, even when its position cannot be trusted');

    console.log('PASS — #67 part 2/2 (tax.js multi-table extras): ' + checks + ' checks so far');
  });
})

/* Plan.js — same rule, its own three sections. */
.then(async () => {
  // Same positional rule as tax.js above: the household's own line sits AFTER
  // the plugin's fixed three-line intro, not before it.
  const planFile =
    '---\nkind: plan\nplan: "UIF payout"\nstatus: active\n---\n\n# UIF payout\n\n' +
    'Money that arrives once, divided on purpose.\n' +
    'Source `status` is `received` or `expected`; item `status` is `planned`, `part` or `done`.\n' +
    'An envelope\'s amount is what you placed in it — it need not equal the items inside.\n\n' +
    'A line the household added below the intro.\n\n' +
    '## Money in\n\n| Source | Kind | Amount | Date | Status | Notes |\n|--------|------|-------:|------|--------|-------|\n' +
    '| UIF | Government | 12000.00 |  | received |  |\n\n' +
    '## Envelopes\n\n| Envelope | Amount | Note | Tint |\n|----------|-------:|------|------|\n' +
    '| Baby | 8000.00 |  |  |\n\n' +
    '## Items\n\n| Item | Envelope | Amount | Spent | Status | Category | Notes |\n|------|----------|-------:|------:|--------|----------|-------|\n' +
    '| Cot | Baby | 3000.00 | 0.00 | planned |  |  |\n\n' +
    '## Reminders\n\nDon\'t forget to register with SARS for the exemption.\n';

  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Plans/UIF payout.md`]: planFile });
  const S = await loadInto(ctx);
  require('../src/views/plan.js')(ctx);
  ctx.S.planName = 'UIF payout';
  const out = ctx.serializePlan('UIF payout');

  ok(out.includes('A line the household added below the intro.'), '#67 plan: the lead paragraph survives');
  ok(out.includes('## Reminders\n\nDon\'t forget to register with SARS for the exemption.'),
    '#67 plan: an unrecognised trailing `## heading` survives, after Items');

  const S2 = await loadInto(makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Plans/UIF payout.md`]: out }));
  eq(S2.plans['UIF payout'].sources.length, 1, '#67 plan: sources still parse after extras are re-emitted');
  eq(S2.plans['UIF payout'].envelopes.length, 1, '#67 plan: envelopes still parse after extras are re-emitted');
  eq(S2.plans['UIF payout'].items.length, 1, '#67 plan: items still parse after extras are re-emitted');

  console.log('PASS — #67 part 3/3 (plan.js multi-table extras): ' + checks + ' checks so far');
})

/* ---------------------------------------------------------------------- */
/* #69 — a hand-added transaction column, both directions of arity, and a */
/* row-fewer/row-more edge case, all through the real loader + writer.    */
/* ---------------------------------------------------------------------- */
.then(async () => {
  const txFile =
    '---\naccount: "FNB Cheque"\nmonth: 2026-07\n---\n\n' +
    '| Date | Description | Category | Amount | Excluded | Note | Split | Balance |\n' +
    '|------|-------------|----------|-------:|----------|------|-------|--------:|\n' +
    '| 2026-07-01 | Woolworths | Groceries | -249.99 |  |  |  | 1000.00 |\n';

  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Transactions/FNB Cheque/2026-07.md`]: txFile });
  const S = await loadInto(ctx);
  require('../src/views/transactions.js')(ctx);
  const key = 'FNB Cheque/2026-07';
  const row = S.txFiles[key].rows[0];
  eq(row.extraCells, ['1000.00'], "#69: a hand-added Balance cell loads as the row's extraCells, verbatim");
  eq(S.txFiles[key].extraCols.headers, ['Balance'], '#69: the extra header name loads once per file');

  const out = ctx.serializeTxFile(S.txFiles[key]);
  eq(out, txFile, '#69: a file with a hand-added column round-trips byte for byte');

  // Editing a modelled cell must not disturb the extra column beside it.
  row.note = 'checked';
  const edited = ctx.serializeTxFile(S.txFiles[key]);
  ok(edited.includes('| 1000.00 |'), '#69: the Balance figure survives an edit to a different cell');
  ok(edited.includes('checked'), '#69: the edit itself actually took');

  /* -------- edge case: a row with FEWER cells than the header -------- */
  const shortRowFile =
    '---\naccount: "FNB Cheque"\nmonth: 2026-08\n---\n\n' +
    '| Date | Description | Category | Amount | Excluded | Note | Split | Balance |\n' +
    '|------|-------------|----------|-------:|----------|------|-------|--------:|\n' +
    '| 2026-08-01 | Full row | Groceries | -10.00 |  |  |  | 900.00 |\n' +
    '| 2026-08-02 | Short row | Groceries | -20.00 |  |  |  |\n';
  const c2 = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Transactions/FNB Cheque/2026-08.md`]: shortRowFile });
  const S2 = await loadInto(c2);
  require('../src/views/transactions.js')(c2);
  const rows2 = S2.txFiles['FNB Cheque/2026-08'].rows;
  eq(rows2[0].extraCells, ['900.00'], '#69: the full row keeps its Balance');
  eq(rows2[1].extraCells, undefined, '#69: a row with no cell there at all carries no extraCells — never throws');
  const out2 = c2.serializeTxFile(S2.txFiles['FNB Cheque/2026-08']);
  ok(out2.includes('| 2026-08-02 | Short row | Groceries | -20.00 |  |  |  |  |'),
    '#69: the short row is padded with a blank Balance cell, not dropped or shifted');

  /* -------- edge case: a row with MORE cells than the header -------- */
  const wideRowFile =
    '---\naccount: "FNB Cheque"\nmonth: 2026-09\n---\n\n' +
    '| Date | Description | Category | Amount | Excluded | Note | Split | Balance |\n' +
    '|------|-------------|----------|-------:|----------|------|-------|--------:|\n' +
    '| 2026-09-01 | Wide row | Groceries | -30.00 |  |  |  | 800.00 | tag-extra |\n';
  const c3 = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Transactions/FNB Cheque/2026-09.md`]: wideRowFile });
  const S3 = await loadInto(c3);
  require('../src/views/transactions.js')(c3);
  const rows3 = S3.txFiles['FNB Cheque/2026-09'].rows;
  eq(rows3[0].extraCells, ['800.00', 'tag-extra'], '#69: a row longer than the header keeps ALL of its own cells');
  const out3 = c3.serializeTxFile(S3.txFiles['FNB Cheque/2026-09']);
  ok(out3.includes('tag-extra'), '#69: the surplus cell nobody named is still written back, not truncated');

  /* -------- a never-split file with an extra column keeps Split's slot -- */
  // All three rows have an empty Split cell, so serializeTxFile's own
  // "drop Split when nothing uses it" rule would, on its own, shift Balance
  // into Split's old position. extraCols pins the file's actual shape.
  const c4 = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Transactions/FNB Cheque/2026-07.md`]: txFile });
  const S4 = await loadInto(c4);
  require('../src/views/transactions.js')(c4);
  const out4 = c4.serializeTxFile(S4.txFiles[key]);
  eq(out4, txFile, '#69: an unused Split column is not dropped out from under a real extra column');

  /* -------- the four flat tables: the same rule via table-schema.js ----- */
  // Nine known columns (currency is the ninth, appended by #30) plus a truly
  // extra tenth — Tag — so this exercises the SAME position table-schema.js's
  // own `currency` column occupies, proving the two are not confused.
  const svcFile =
    '---\nkind: services\n---\n\n# Services & Subscriptions\n\n' +
    'Recurring services and subscriptions. `cycle` is one of: weekly, fortnightly, monthly, annual.\n\n' +
    '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Currency | Tag |\n' +
    '|------|----------|-------:|-------|--------------|----------|--------|-------|----------|-----|\n' +
    '| Netflix | Netflix | 199.00 | monthly | 2026-08-05 | Groceries | yes |  |  | streaming |\n';
  const c5 = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Services.md`]: svcFile });
  const S5 = await loadInto(c5);
  require('../src/views/services.js')(c5);
  eq(S5.services[0].extraCells, ['streaming'], '#69: a hand-added column on Services.md loads through the shared schema helper');
  const outSvc = c5.serializeServices();
  eq(outSvc, svcFile, '#69: Services.md with a hand-added column round-trips byte for byte through mdTableFile');

  console.log('PASS — #69 (extra transaction/schema columns): ' + checks + ' checks total');
  console.log(`PASS — preserve-unmodelled.test.cjs: all #67/#69 checks green (${checks} assertions)`);
})
.catch(e => { console.error(e); process.exit(1); });
