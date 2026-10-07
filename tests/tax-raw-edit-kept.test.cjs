'use strict';
/* An edit to a Tax cell that loaded unreadable is the edit that gets saved.

   Since ISSUE 59/63 the loader keeps a reader's own text beside any Tax cell it
   could not read — an amount like "see IT3b", a status word like "waiting" —
   in `<key>Raw`, so a save writes that text back instead of a fabricated 0.00
   or a coerced status. That is half of table-schema.js's money()/vocab()
   contract. The other half is the condition on the write: the raw goes back
   only while the row still HOLDS the value the raw produced. views/plan.js has
   both halves, and views/tax.js said in a comment that it mirrored plan.js —
   but its serializer preferred the raw UNCONDITIONALLY. So once a cell had
   loaded unreadable, every edit to it was shown on screen and then thrown away
   by Save: the amount typed into the Figures table, the status pill cycled on
   a step or a document, the "uploaded" an upload stamps on its row. The
   2026-10-07 round-trip audit reproduced all three.

   Driven through the rendered page, written by the REAL serializer and read
   back by the REAL loader. Untouched unreadable cells must still come back
   exactly as typed — that half must not be lost in the fix.

     node tests/tax-raw-edit-kept.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const answers = [];
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async askFields() { return answers.length ? answers.shift() : null; },
    async confirmModal() { return false; },     // never reuse a "duplicate" — none exist here
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

const B = 'Budget';
const TAX = [
  '---', 'kind: tax', 'tax_year: 2026', 'taxpayer_type: standard', 'assessment: unknown', '---', '',
  '# Tax Year 2026', '',
  '## Progress', '', '| Step | Status | Due | Notes |', '|------|--------|-----|-------|',
  '| File the return | waiting | 2026-10-20 |  |',
  '| Ask the accountant | later maybe |  |  |', '',
  '## Documents', '', '| Document | Source | Status | File | Notes |', '|----------|--------|--------|------|-------|',
  '| Interest certificate | Bank A | requested |  |  |',
  '| Medical certificate | Scheme | asked twice |  |  |', '',
  '## Figures', '', '| Source code | Description | Source | Amount |', '|------|-------------|--------|--------|',
  '| 4201 | Interest | Bank A | see IT3b |',
  '| 4005 | Medical | Scheme | tbc |', '',
].join('\n');
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Tax/2026.md`]: TAX,
};
const P = `${B}/Tax/2026.md`;

(async () => {
  const ctx = makeCtx({ ...FILES }, { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  require('../src/views/tax')(ctx);
  ctx.S.taxYear = '2026';
  ctx.renderTax();
  const t = ctx.S.tax['2026'];

  /* Preconditions: what the loader made of the unreadable cells. */
  eq([t.figures[0].amount, t.figures[0].amountRaw], [0, 'see IT3b'], 'precondition: an unreadable amount keeps its text');
  eq([t.steps[0].status, t.steps[0].statusRaw], ['todo', 'waiting'], 'precondition: an unknown step word keeps its text');
  eq([t.docs[0].status, t.docs[0].statusRaw], ['needed', 'requested'], 'precondition: so does a document status');

  /* ---- the three edits the audit saw discarded ---- */
  const amount = $('#taxFiguresTable').querySelector('[aria-label="Amount for 4201"]');
  amount.value = '1500'; amount._fire('change');
  $('#taxStepsTable').querySelectorAll('.status-pill')[0].click();          // To do -> Busy
  // The upload path: Upload on the first document row, then the file arrives.
  const uploadBtn = $('#taxDocsTable').querySelectorAll('BUTTON')
    .find(b => /^Upload file for Interest certificate$/.test(b.attrs['aria-label'] || ''));
  uploadBtn.click();
  const bytes = new TextEncoder().encode('%PDF-1.4 synthetic certificate').buffer;
  await ctx.handleTaxFile({ name: 'it3b.pdf', arrayBuffer: async () => bytes });
  eq([t.figures[0].amount, t.steps[0].status, t.docs[0].status], [1500, 'busy', 'uploaded'],
    'precondition: the page shows all three edits');

  await ctx.saveTax();
  const out = ctx.vault._store.get(P);

  /* ---- what the REAL loader reads off the saved file ---- */
  const S2 = await loadInto(makeCtx(Object.fromEntries(ctx.vault._store), { budgetFolder: B }));
  const t2 = S2.tax['2026'];
  eq(t2.figures[0].amount, 1500, 'the typed amount is what was saved — not "see IT3b" back again');
  ok(!('amountRaw' in t2.figures[0]), 'and it reads back as a readable figure, with no raw beside it');
  eq(t2.steps[0].status, 'busy', 'the cycled step status is what was saved — not "waiting"');
  ok(!('statusRaw' in t2.steps[0]), 'and it reads back as a known status');
  eq([t2.docs[0].status, t2.docs[0].file], ['uploaded', 'it3b.pdf'], 'the upload\'s "uploaded" is what was saved — not "requested"');

  /* ---- and the cells nobody touched come back exactly as typed ---- */
  ok(out.includes('| 4005 | Medical | Scheme | tbc |'), 'an untouched unreadable amount is written back verbatim, never 0.00');
  ok(out.includes('| Ask the accountant | later maybe |'), 'an untouched unknown step word is written back verbatim');
  ok(out.includes('| Medical certificate | Scheme | asked twice |'), 'and an untouched unknown document status');
  eq([t2.figures[1].amountRaw, t2.steps[1].statusRaw, t2.docs[1].statusRaw], ['tbc', 'later maybe', 'asked twice'],
    'so the loader finds the same raw text on the next read');

  /* The serializer's own half, held apart from the editors. The Figures cell
     clears amountRaw itself when it accepts a figure, so the edit above would
     survive even a serializer that preferred the raw unconditionally — which
     is exactly the condition this file exists to pin. So: a figure assigned in
     place with its raw still beside it, as plan.test.cjs does for Plans, and as
     any writer that has never heard of amountRaw would leave it. */
  {
    const c4 = makeCtx({ ...FILES }, { budgetFolder: B });
    await loadInto(c4);
    const d4 = makeDom();
    c4.$ = d4.$; c4.$$ = () => []; c4.root = d4.$('#root');
    c4.money = v => `R ${Number(v).toFixed(2)}`;
    require('../src/views/tax')(c4);
    c4.S.taxYear = '2026';
    const f = c4.S.tax['2026'].figures[0];
    f.amount = 2750;                                  // amountRaw 'see IT3b' left in place
    ok(f.amountRaw === 'see IT3b', 'precondition: the raw is still beside the new figure');
    ok(c4.serializeTax('2026').includes('| 4201 | Interest | Bank A | 2750.00 |'),
      'the serializer writes the figure the row now holds, not the raw it replaced');
  }

  /* A status cycled all the way round lands back on the value its raw produced
     — and then the reader's own word is the honest thing to write, exactly as
     plan.js and table-schema.js's vocab() decide it. */
  {
    const c3 = makeCtx({ ...FILES }, { budgetFolder: B });
    await loadInto(c3);
    const d3 = makeDom();
    c3.$ = d3.$; c3.$$ = () => []; c3.root = d3.$('#root');
    c3.money = v => `R ${Number(v).toFixed(2)}`;
    require('../src/views/tax')(c3);
    c3.S.taxYear = '2026';
    c3.renderTax();
    for (let k = 0; k < 4; k++) d3.$('#taxStepsTable').querySelectorAll('.status-pill')[0].click();
    eq(c3.S.tax['2026'].steps[0].status, 'todo', 'precondition: four clicks go round to To do');
    ok(c3.serializeTax('2026').includes('| File the return | waiting |'),
      'back on the value the raw produced, the reader\'s own word is written, not a coerced "todo"');
  }

  console.log(`tax-raw-edit-kept: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
