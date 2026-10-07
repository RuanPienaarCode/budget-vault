'use strict';
/* Every amount typed on the Tax page is read by normalizeAmount — the same
   reader the loader uses for the same cells.

   The page had three amount entry points of its own — the Figures table's
   Amount cell, the "New figure" dialog and the assessment's Result / Taxable
   income fields — and all three read with a digit-scraper:

     Number(text.replace(/[^\d.-]/g, ''))

   which deletes the decimal comma South Africa writes, and the space it groups
   thousands with. So the page's OWN display format came back wrong by a factor
   of a hundred: "23 800,50" was stored as 2 380 050, "-6 315,28" as -631 528,
   "1.234,56" as 1.23456, and a stray "R" as 0 over whatever figure was there.
   The loader has read that format correctly since ISSUE 52 (load.js keeps the
   tax figures on normalizeAmount), so the page wrote by one rule and read back
   by another — and the wrong figure went straight into the interest-exemption
   check, which then told a reader with R 23 800,50 of interest that
   R 2 356 250 of it was taxable. Found by three audit lanes on 7 Oct 2026.

   Pinned here, through the REAL view over the REAL loader:
     1. each entry point reads the formats normalizeAmount reads;
     2. text that holds no number is REFUSED — a toast, the stored figure kept,
        and the field redrawn to show what is actually stored (views/debts.js
        editMoney's contract) — never a fabricated 0;
     3. a cleared field means what the page already displays for it: no figure
        (0 in the table, which the table shows as blank; null for an
        assessment field, which removes the key). These are text inputs, so an
        empty value is what the reader typed — not what a number input reports
        for a value its keypad could not parse;
     4. what reaches Tax/<year>.md reads back, through the real loader, as the
        same figure.

     node tests/tax-amount-entry.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const answers = [];
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async askFields() { return answers.length ? answers.shift() : null; },
    async confirmModal() { return true; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

/* A synthetic tax year: one interest figure, an assessment already in hand. */
const B = 'Budget';
const TAX = [
  '---', 'kind: tax', 'tax_year: 2026', 'taxpayer_type: standard', 'assessment: assessed',
  'assessment_result: -1250.00', 'assessment_income: 480000', '---', '',
  '# Tax Year 2026', '',
  '## Progress', '', '| Step | Status | Due | Notes |', '|------|--------|-----|-------|',
  '| File the return | todo |  |  |', '',
  '## Documents', '', '| Document | Source | Status | File | Notes |', '|----------|--------|--------|------|-------|', '',
  '## Figures', '', '| Source code | Description | Source | Amount |', '|------|-------------|--------|--------|',
  '| 4201 | Local interest | Bank A | 1200.00 |', '',
].join('\n');
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Tax/2026.md`]: TAX,
};

async function mount(files) {
  const ctx = makeCtx({ ...files }, { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/tax')(ctx);
  ctx.S.taxYear = '2026';
  ctx.renderTax();
  return { ctx, $ };
}

const t = ctx => ctx.S.tax['2026'];
const newToasts = (ctx, from) => ctx._toasts.slice(from);
/* Type into a field the way a browser delivers it: the value changes, then
   `change` fires on the same element. */
const type = (input, text) => { input.value = text; input._fire('change'); };
const amountCell = $ => $('#taxFiguresTable').querySelector('[aria-label="Amount for 4201"]');
const seasonInput = ($, placeholder) => descend($('#taxSeasonBody'))
  .find(n => n.tagName === 'INPUT' && n.attrs.placeholder === placeholder);

(async () => {
  /* ---------------- 1. the Figures table's Amount cell ---------------- */
  {
    const { ctx, $ } = await mount(FILES);
    for (const [typed, want] of [
      ['23 800,50', 23800.5],       // the page's own za format, as an SA keypad offers it
      ['1.234,56', 1234.56],        // dot-grouped, decimal comma
      ['1,234.56', 1234.56],        // comma-grouped, decimal point
      ['R 15 000', 15000],          // with the currency symbol in front
      ['-6 315,28', -6315.28],      // a negative, grouped
    ]) {
      type(amountCell($), typed);
      eq(t(ctx).figures[0].amount, want, `the Amount cell reads "${typed}" as ${want}`);
    }
    ok(ctx.S.taxDirty, 'an accepted edit marks the page dirty');

    /* Text with no number in it: refused, the stored figure kept, the field
       redrawn to what is stored rather than left holding text Save ignores. */
    type(amountCell($), '23800.5');
    const before = ctx._toasts.length;
    const cell = amountCell($);
    type(cell, 'R');
    eq(t(ctx).figures[0].amount, 23800.5, 'a bare "R" is refused — the stored figure is kept, not overwritten with 0');
    eq(newToasts(ctx, before).map(x => [x.msg, !!x.bad]), [['Amount must be a number', true]],
      'and the reader is told why, as an error');
    eq(cell.value, '23800.5', 'and the field is redrawn to show the figure that is actually stored');
    type(amountCell($), 'about a thousand');
    eq(t(ctx).figures[0].amount, 23800.5, 'prose is refused the same way');

    /* What the totals row and the file say. */
    const foot = $('#taxFiguresTable').querySelector('.tax-fig-total');
    ok(foot && /R 23800\.50/.test(foot.textContent), `the totals row prints the figure that was typed (got "${foot && foot.textContent}")`);
    const out = ctx.serializeTax('2026');
    ok(out.includes('| 4201 | Local interest | Bank A | 23800.50 |'), 'and Tax/2026.md gets 23800.50, not 2380050.00');

    /* A cleared cell is no figure — which is exactly what the cell already
       shows for one. */
    type(amountCell($), '');
    eq(t(ctx).figures[0].amount, 0, 'a cleared Amount cell stores no figure (0, which the table shows blank)');
  }

  /* ---------------- 2. the "New figure" dialog ---------------- */
  {
    const { ctx } = await mount(FILES);
    answers.push({ code: '4201', description: 'Interest', source: 'Bank B', amount: '23 800,50' });
    await ctx.addTaxFigure();
    eq(t(ctx).figures.length, 2, 'a figure is added');
    eq(t(ctx).figures[1].amount, 23800.5, 'with "23 800,50" read as 23 800,50 — not 2 380 050');

    const before = ctx._toasts.length;
    answers.push({ code: '4218', description: 'Foreign interest', source: 'Broker', amount: 'R' });
    await ctx.addTaxFigure();
    eq(t(ctx).figures.length, 2, 'an amount with no number in it adds nothing');
    eq(newToasts(ctx, before).map(x => [x.msg, !!x.bad]), [['Amount must be a number', true]],
      'and says why, rather than adding a figure of 0 the reader never typed');

    answers.push({ code: '4219', description: 'TFSA', source: 'Provider', amount: '' });
    await ctx.addTaxFigure();
    eq(t(ctx).figures.length, 3, 'a figure with its amount left blank is still added — to be filled in from the table');
    eq(t(ctx).figures[2].amount, 0, 'with no amount yet');
  }

  /* ---------------- 3. the assessment's Result and Taxable income ---------------- */
  {
    const { ctx, $ } = await mount(FILES);
    type(seasonInput($, '-1250.00'), '-6 315,28');
    eq(t(ctx).assessment_result, -6315.28, 'Result reads "-6 315,28" as a refund of 6 315,28 — not -631 528');
    type(seasonInput($, '0.00'), '412 345,67');
    eq(t(ctx).assessment_income, 412345.67, 'Taxable income reads "412 345,67" — not 41 234 567');

    const before = ctx._toasts.length;
    const res = seasonInput($, '-1250.00');
    type(res, 'R');
    eq(t(ctx).assessment_result, -6315.28, 'a Result with no number in it is refused and the stored one kept');
    eq(newToasts(ctx, before).map(x => !!x.bad), [true], 'with an error toast');
    ok(/must be a number/.test((newToasts(ctx, before)[0] || {}).msg || ''), 'saying the field needs a number');
    eq(res.value, '-6315.28', 'and the field redrawn to the stored figure');

    const out = ctx.serializeTax('2026');
    ok(/^assessment_result: -6315\.28$/m.test(out), `the file states the refund as typed (got ${(out.match(/^assessment_result:.*$/m) || [])[0]})`);
    ok(/^assessment_income: 412345\.67$/m.test(out), 'and the assessed income');

    /* Round trip through the REAL loader — the reader this page has to agree with. */
    const S2 = await loadInto(makeCtx({ ...FILES, [`${B}/Tax/2026.md`]: out }, { budgetFolder: B }));
    eq([S2.tax['2026'].assessment_result, S2.tax['2026'].assessment_income], [-6315.28, 412345.67],
      'and the loader reads back exactly what the page stored');

    /* A cleared field removes the figure, as it always has. */
    type(seasonInput($, '-1250.00'), '');
    eq(t(ctx).assessment_result, null, 'a cleared Result is no result');
    ok(!/^assessment_result:/m.test(ctx.serializeTax('2026')), 'and its key leaves the file');
  }

  /* ---------------- 4. figures: page -> file -> REAL loader ---------------- */
  {
    const { ctx, $ } = await mount(FILES);
    type(amountCell($), '23 800,50');
    answers.push({ code: '4250', description: 'Gain', source: 'Broker', amount: '1.234,56' });
    await ctx.addTaxFigure();
    const out = ctx.serializeTax('2026');
    const S2 = await loadInto(makeCtx({ ...FILES, [`${B}/Tax/2026.md`]: out }, { budgetFolder: B }));
    eq(S2.tax['2026'].figures.map(f => f.amount), [23800.5, 1234.56],
      'every typed figure reads back off disk as the figure the page showed');
  }

  console.log(`tax-amount-entry: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
