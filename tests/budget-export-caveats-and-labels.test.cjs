'use strict';
/* What the budget export says beside its figures, and what it calls things
   (2026-10-14 audit, L4A-04, L4A-08, L4A-09, L4A-11).

   L4A-04. The Budget page and the Dashboard hero qualify "spent" in two ways
   that no rendering of the export carried:
     - an ASSUME-SPENT category counts its whole budget as spent with no
       transaction behind it ("includes R 500 already spent");
     - spending a FUND paid for is held out of every figure ("R 1 500 more went
       out of your funds (1 transaction), which this budget does not count").
   The export is the copy that leaves the app, read by someone with no second
   screen to check against, and the audit found neither sentence anywhere in the
   PDF, the workbook or the CSVs. They now ride in the model, in the hero's own
   words (the Dashboard's own i18n keys, not a third wording), and each
   rendering says them where a reader of THAT rendering looks:
     PDF       the headline, and a note under it
     workbook  the About sheet, and the Notes cell of an assume-spent row
     CSV       the Notes cell of an assume-spent row — the CSV rule stands:
               a pivot-table input gets no sentence in its data, only a mark
               on the row that IS partial

   L4A-08. The CSV marks the running period "(in progress)" in its Summary
   column header and its Period value. The workbook's Summary header and Budget
   Period cell did not.

   L4A-09. A fortnightly or weekly pay cycle names two periods for the same
   month; the Summary had two identical column headers and the Budget CSV two
   identical Period values.

   L4A-11. A refused folder in the export dialog was explained in the Report's
   words ("a report saved here…").

   Over the committed synthetic household, through the REAL loader and view:
   Carry is assume-spent (budget 500, no transaction) and a 1 500 pram came out
   of the earmarked emergency fund — both worked out by hand, not read from the
   seams under test.

     node tests/budget-export-caveats-and-labels.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock, mountFor } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const bx = require('../src/budget-export');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const val = c => (c && typeof c === 'object' ? c.v : c);

const ANSWER = { mode: 'months', range: '1', includeCurrent: true, content: 'full', categories: null, includeTx: false, formats: ['pdf', 'xlsx', 'csv'], folder: 'Exports' };

(async () => {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(SEED, { period: PERIOD, budgetFolder: B });
    require('../src/views/budget-export')(M.ctx);
    const { ctx } = M;
    const money = v => ctx.money(v);

    const assumed = i18n.t('dash.hero.assumedIncluded', { amount: money(500) });
    const funds = i18n.t('dash.fundedFromSavings', { amount: money(1500), count: 1 });

    const { model, written } = await ctx.runBudgetExport(ANSWER);
    const b = model.budgets[0];

    /* ---- L4A-04: the model carries both, in the hero's words ---------------- */
    eq(b.caveats.map(c => c.key), ['assumed', 'fundedFromSavings'], 'the period carries both qualifiers the hero prints');
    eq(b.caveats.map(c => c.text), [assumed, funds], 'in the Dashboard\'s own sentences, with the figures worked out by hand (500; 1 500 in 1 transaction)');

    /* ---- the PDF ----------------------------------------------------------- */
    const doc = bx.modelToDoc(model, { money });
    const notes = doc.blocks.filter(x => x.type === 'note').map(x => x.text);
    const headline = notes.find(t => /^Income /.test(t));
    ok(headline.includes(assumed), `the headline says what its Spent includes — got "${headline}"`);
    ok(notes.includes(funds), 'and a note under it says what went out of the funds');

    /* ---- the workbook ------------------------------------------------------- */
    const labels = { assumedRow: 'already spent', assumedNone: 'no transaction expected' };
    const sheets = bx.modelToSheets(model, { labels });
    const about = sheets.find(s => s.name === 'About').rows.map(r => r.map(val).join(' ')).join('\n');
    ok(about.includes(assumed) && about.includes(funds), 'the About sheet carries both sentences');
    const carry = sheets.find(s => s.name === 'Budget').rows.find(r => val(r[3]) === 'Carry');
    eq(val(carry[8]), 'already spent — no transaction expected', 'and the assume-spent row says so in its own Notes cell, in the Budget page\'s two phrases');
    const rent = sheets.find(s => s.name === 'Budget').rows.find(r => val(r[3]) === 'Rent');
    eq(val(rent[8]), '', 'a row that is not assume-spent is untouched');

    /* ---- the CSV ------------------------------------------------------------ */
    const csv = bx.modelToCsv(model, {}).find(f => f.kind === 'budget').text.split('\n');
    ok(csv.find(l => l.includes(',Carry,')).endsWith(',already spent — no transaction expected'), 'the Budget CSV marks the assume-spent row in its Notes column');
    ok(!csv.find(l => l.includes(',Rent,')).includes('already spent'), 'and nothing else');
    eq(csv[0], 'Period,From,To,Category,Type,Currency,Budget,Actual,Remaining,Notes', 'no column was added or moved');
    eq(written.length, 4, 'fixture: the PDF, the workbook and the two CSVs were written');

    /* ---- withheld under a category filter, as the headline is --------------- */
    const filtered = await ctx.runBudgetExport({ ...ANSWER, categories: ['Rent'], formats: ['csv'] });
    eq(filtered.model.budgets[0].caveats, [], 'a statement about the whole period is withheld from a table that no longer shows it');

    /* ---- a date range: the funds sentence, from the window's own tally ------- */
    const ranged = await ctx.runBudgetExport({ ...ANSWER, mode: 'dates', preset: 'custom', from: '2026-08-01', to: '2026-09-30', formats: ['csv'] });
    eq(ranged.model.exact.caveats.map(c => c.key), ['fundedFromSavings'], 'an exact-dates window says what the funds paid for in it (and has no budget to hold an assume-spent row)');

    /* ---- L4A-08: the workbook marks the running period too ------------------- */
    const L = { inProgress: '(in progress)' };
    const sheetsL = bx.modelToSheets(model, { labels: L });
    ok(sheetsL.find(s => s.name === 'Summary').rows[0].map(val).includes('September 2026 (in progress)'),
      'the Summary header names the running period as the CSV does');
    ok(sheetsL.find(s => s.name === 'Budget').rows[1].map(val)[0] === 'September 2026 (in progress)', 'and so does the Budget sheet\'s Period cell');
    const sum = bx.modelToCsv(model, {}).find(f => f.kind === 'summary').text.split('\n')[0];
    ok(sum.includes('September 2026 (in progress)'), 'fixture: the CSV already did');

    /* ---- L4A-11: the refusal is the export\'s own ---------------------------- */
    const refused = ctx.describeBudgetExport({ ...ANSWER, folder: `${B}/Categories` });
    ok(refused.problem, 'a managed folder is refused');
    eq(refused.problem, i18n.t('bx.problem.managedFolder', { folder: 'Categories' }), 'in the export\'s own words');
    ok(!/report/i.test(refused.problem), `which do not call the export a report — got "${refused.problem}"`);
  } finally { unpin(); }

  /* ---- L4A-09: repeated period names (pure) ---------------------------------- */
  {
    const p = (key, name, start, end) => ({ key, name, title: 't', start, end, rows: [], txs: [], summary: { income: 0, spend: 0, foreign: { count: 0, labels: [], symbols: [] } } });
    const META = { generated: 'g', currency: 'R', inProgress: null };
    const fort = [p('a', 'August 2026', '2026-08-01', '2026-08-14'), p('b', 'August 2026', '2026-08-15', '2026-08-28'), p('c', 'Aug – Sep 2026', '2026-08-29', '2026-09-11')];
    const m = bx.buildModel({ periods: fort, content: 'full', categories: null, includeTx: false, ...META });
    eq(m.periods.map(x => x.name), ['August 2026 (2026-08-01 to 2026-08-14)', 'August 2026 (2026-08-15 to 2026-08-28)', 'Aug – Sep 2026'],
      'a repeated name carries its dates; a name that is already unique is left alone');
    eq(new Set(m.periods.map(x => x.name)).size, 3, 'so no two columns share a header');
    eq(m.periods.map(x => x.key), ['a', 'b', 'c'], 'the key — what every lookup goes by — is never touched');
    const head = bx.modelToCsv(m, {}).find(f => f.kind === 'summary').text.split('\n')[0].split(',');
    eq(new Set(head).size, head.length, 'the Summary CSV has no duplicate header');
    const monthly = [p('x', 'June 2026', '2026-05-23', '2026-06-22'), p('y', 'July 2026', '2026-06-23', '2026-07-22')];
    eq(bx.buildModel({ periods: monthly, content: 'full', categories: null, includeTx: false, ...META }).periods.map(x => x.name), ['June 2026', 'July 2026'],
      'a monthly household\'s names — and so its file names — do not move');
  }

  console.log(`PASS budget-export-caveats-and-labels (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
