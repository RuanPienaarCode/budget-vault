'use strict';
/* A Plan or a Tax year keeps what a household typed into it by hand, through a
   Save that edited something else (2026-10-14 audit, L3-05 and L3-07).

   Both files were read through a loader that knew only the plugin's own shape,
   and rebuilt whole from that on every Save. Four things a person plausibly
   types were deleted by it:

     (a) a row whose FIRST cell is blank — "R750 deposit, name it later",
         "medical out-of-pocket, code to look up" — dropped on load, so gone
         from the page, from the Tax Figures total, and from the file,
     (b) a column of their own added after the plugin's (a `Ref`, a `Who`),
     (c) a paragraph between a `##` heading and its table,
     (d) the tail of a wikilink with an alias, `[[Trip|the trip note]]`, whose
         bare pipe the table treats as a cell boundary.

   The four flat tables and the budgets already meet this contract (ISSUE
   67/69, L3-12/L3-21/L3-25); Plans and Tax now read through the same
   attachExtraCells/extraColsOf pair and keep the prose before the table.

   L3-07: savePlan built `Plans/${p.file}.md` and ignored where the plan was
   READ from, so a plan filed in a subfolder was forked to a second copy.

   Also here, small and the same file's concern: the Plan hero's "all in" line
   no longer claims the money is in the account (L2a-N14) — `status: received`
   says it arrived, not where.
   Synthetic content only.
     node tests/plan-tax-hand-typed-content.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { PROFILES } = require('../src/locale');
const { TAX_FIGURE_FIRST_HEADERS } = require('../src/table-schema');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const PLAN = [
  '---', 'kind: plan', 'plan: "Holiday"', 'status: active', '---', '',
  '# Holiday', '',
  'Money that arrives once, divided on purpose.',
  'Source `status` is `received` or `expected`; item `status` is `planned`, `part` or `done`.',
  'An envelope\'s amount is what you placed in it — it need not equal the items inside.', '',
  '## Money in', '',
  'HAND: Bonus lands on the 25th, after tax.',
  '',
  '| Source | Kind | Amount | Date | Status | Notes | Ref |',
  '|--------|------|-------:|------|--------|-------|-----|',
  '| Bonus | Bonus | 10000.00 | 2026-09-01 | received |  | HAND-REF-001 |',
  '', '## Envelopes', '',
  '| Envelope | Amount | Note | Tint |', '|----------|-------:|------|------|',
  '| Travel | 6000.00 |  |  |',
  '', '## Items', '',
  '| Item | Envelope | Amount | Spent | Status | Category | Notes |',
  '|------|----------|-------:|------:|--------|----------|-------|',
  '| Flights | Travel | 4000.00 | 0.00 | planned |  | see [[Trip|the trip note]] |',
  '|  | Travel | 750.00 | 0.00 | planned |  | HAND: deposit, name it later |',
  '| Hotel | Travel | 2000.00 | 0.00 | planned |  |  |',
  '',
].join('\n');
const TAX = [
  '---', 'kind: tax', 'tax_year: 2026', 'taxpayer_type: provisional', 'assessment: assessed', '---', '',
  '# Tax Year 2026', '',
  'SARS return tracking for the 2026 tax year (1 Mar 2025 – end Feb 2026).',
  'Step `status` is `todo`, `busy`, `done` or `n/a`; document `status` is `needed`, `uploaded` or `n/a`.',
  'Uploaded files live in `Tax/2026/`.', '',
  '## Progress', '',
  'HAND: eFiling login is in the family password manager.',
  '',
  '| Step | Status | Due | Notes | Who |',
  '|------|--------|-----|-------|-----|',
  '| Gather documents | busy | 2026-09-01 |  | HAND-Partner |',
  '', '## Documents', '',
  '| Document | Source | Status | File | Notes |', '|----------|--------|--------|------|-------|',
  '| IRP5 | Employer | uploaded | irp5.pdf | see [[Payslips|payslip folder]] |',
  '', '## Figures', '',
  '| Source code | Description | Source | Amount |', '|------|-------------|--------|--------|',
  '| 4201 | Local interest | Bank A | 15000.00 |',
  '|  | HAND: medical out-of-pocket, code to look up | Discovery | 8200.00 |',
  '| 4201 | Local interest | Bank B | 12000.00 |',
  '',
].join('\n');
const HAND = ['HAND: Bonus lands on the 25th, after tax.', 'HAND-REF-001', '| Ref |', 'the trip note]]', 'HAND: deposit, name it later', '750.00',
  'HAND: eFiling login is in the family password manager.', 'HAND-Partner', '| Who |', 'payslip folder]]', 'HAND: medical out-of-pocket', '8200.00'];

(async () => {
  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Plans/Holiday.md`]: PLAN, [`${B}/Tax/2026.md`]: TAX });
  const S = await loadInto(ctx);
  require('../src/views/plan')(ctx);
  require('../src/views/tax')(ctx);
  S.planName = 'Holiday'; S.taxYear = '2026';

  /* (a) the rows are READ */
  eq(S.plans.Holiday.items.map(i => i.name), ['Flights', '', 'Hotel'], 'the plan\'s nameless item is a row');
  eq(S.plans.Holiday.items.reduce((t, i) => t + i.amount, 0), 6750, 'and counts in the plan\'s items');
  const figs = S.tax['2026'].figures;
  eq(figs.length, 3, 'the tax year\'s code-less figure is a row');
  eq(figs.reduce((t, f) => t + f.amount, 0), 35200, 'and is in the Figures total');

  /* (a-d) nothing is lost by a Save of a different row */
  S.plans.Holiday.items.find(i => i.name === 'Hotel').notes = 'booked';
  const planOut = ctx.serializePlan('Holiday');
  figs.find(f => f.source === 'Bank B').description = 'Local interest (savings)';
  const taxOut = ctx.serializeTax('2026');
  for (const s of HAND) {
    const inPlan = PLAN.includes(s);
    ok((inPlan ? planOut : taxOut).includes(s), `${inPlan ? 'Plan' : 'Tax'}: ${JSON.stringify(s)} survives the Save`);
  }
  ok(planOut.includes('| Hotel | Travel | 2000.00 | 0.00 | planned |  | booked |'), 'and the edit itself landed');
  ok(taxOut.includes('Local interest (savings)'), 'in the tax year too');
  /* position: the paragraph is above the table, the column is in it */
  ok(planOut.indexOf('HAND: Bonus lands') < planOut.indexOf('| Source | Kind |') && planOut.indexOf('HAND: Bonus lands') > planOut.indexOf('## Money in'),
    'Plan: the paragraph sits between its heading and its table');
  ok(/\| Source \| Kind \| Amount \| Date \| Status \| Notes \| Ref \|/.test(planOut), 'Plan: the Ref column keeps its header');
  ok(/\| Bonus \| Bonus \| 10000\.00 \| 2026-09-01 \| received \|  \| HAND-REF-001 \|/.test(planOut), 'and its cell');

  /* a second pass is stable: load what was written, write it again */
  const again = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Plans/Holiday.md`]: planOut, [`${B}/Tax/2026.md`]: taxOut });
  const S2 = await loadInto(again);
  require('../src/views/plan')(again);
  require('../src/views/tax')(again);
  S2.planName = 'Holiday'; S2.taxYear = '2026';
  eq(again.serializePlan('Holiday'), planOut, 'Plan: loading what the Save wrote and saving again changes no byte');
  eq(again.serializeTax('2026'), taxOut, 'Tax: the same');

  /* a plan or tax file with none of this still writes the exact shipped bytes */
  {
    const plain = '---\nkind: plan\nplan: "P"\nstatus: active\n---\n\n# P\n\nMoney that arrives once, divided on purpose.\n'
      + 'Source `status` is `received` or `expected`; item `status` is `planned`, `part` or `done`.\n'
      + 'An envelope\'s amount is what you placed in it — it need not equal the items inside.\n\n'
      + '## Money in\n\n| Source | Kind | Amount | Date | Status | Notes |\n|--------|------|-------:|------|--------|-------|\n| A | Gift | 1.00 |  | received |  |\n\n'
      + '## Envelopes\n\n| Envelope | Amount | Note | Tint |\n|----------|-------:|------|------|\n| E | 1.00 |  |  |\n\n'
      + '## Items\n\n| Item | Envelope | Amount | Spent | Status | Category | Notes |\n|------|----------|-------:|------:|--------|----------|-------|\n| I | E | 1.00 | 0.00 | planned |  |  |\n';
    const c = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Plans/P.md`]: plain });
    const s = await loadInto(c);
    require('../src/views/plan')(c);
    s.planName = 'P';
    eq(c.serializePlan('P'), plain, 'an ordinary plan saves byte for byte as before');
  }

  /* the Figures header word follows the country: every country's word finds the table */
  for (const [code, p] of Object.entries(PROFILES)) {
    ok(TAX_FIGURE_FIRST_HEADERS.includes(p.figureCodeLabel), `table-schema knows ${code}'s Figures header (${p.figureCodeLabel})`);
  }

  /* L3-07: a nested plan is written where it was read from */
  {
    const nested = PLAN.replace('HAND-REF-001', 'R1').replace(/\n\|  \| Travel.*\n/, '\n');
    const c = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Plans/2025/Bonus.md`]: nested.replace('plan: "Holiday"', 'plan: "Bonus"') });
    const s = await loadInto(c);
    require('../src/views/plan')(c);
    s.planName = 'Bonus';
    eq(s.plans.Bonus.rel, 'Plans/2025/Bonus.md', 'precondition: the plan remembers where it came from');
    s.plans.Bonus.sources[0].notes = 'EDITED IN APP';
    await c.savePlan();
    const files = [...c.vault._store.keys()].filter(k => k.includes('/Plans/'));
    eq(files, [`${B}/Plans/2025/Bonus.md`], 'the save went to the nested file and made no second copy');
    ok(c.vault._store.get(`${B}/Plans/2025/Bonus.md`).includes('EDITED IN APP'), 'with the edit in it');
    // a plan created this session has no record and still goes to the flat default
    s.plans.New = { file: 'New', name: 'New', fmRaw: '', started: '', status: 'active', sources: [], envelopes: [], items: [] };
    s.planName = 'New';
    await c.savePlan();
    ok(c.vault._store.has(`${B}/Plans/New.md`), 'a brand-new plan is created at Plans/<name>.md');
  }

  /* L2a-N14: the hero's all-in line says what status:received knows */
  {
    const en = require('../src/lang/en');
    const line = en['plan.hero.allIn'] || (en.default && en.default['plan.hero.allIn']);
    ok(line && !/account/i.test(line) && /received/i.test(line), `plan.hero.allIn says "received", not where it is (${line})`);
  }

  console.log(`PASS — Plans and Tax keep hand-typed rows, columns, paragraphs and wikilink tails; a nested plan saves in place (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
