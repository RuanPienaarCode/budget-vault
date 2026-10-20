'use strict';
/* The Report's headings are in sentence case, like the rest of the app
   (2026-10-20 audit, D2-20).

   The generated note's H1 and section headings were in Title Case — "Spend by
   Category", "Budget vs Actual", "Savings & Investment Growth" — while the
   budget export's PDF from the same Budget page heads its sections "Summary by
   category" and every page title in the app is sentence case. Two documents
   the app writes about one budget, styled as two different products.

   Read off the English table (the source of truth the other languages are
   translated from) AND off a generated report, so a heading that is
   re-spelled at the call site cannot slip past.

     node tests/report-sentence-case.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor, createReport } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const en = require('../src/lang/en');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* Sentence case: every word after the first starts lower-case. A
   {placeholder} is not a word of the heading, and an all-capitals word is an
   acronym, which keeps its capitals in sentence case too. */
const titleCased = s => String(s).replace(/\{\w+\}/g, '').split(/\s+/).filter(Boolean).slice(1)
  .filter(w => /^\p{Lu}/u.test(w) && !/^\p{Lu}+$/u.test(w));

(async () => {
  const keys = ['report.title', ...Object.keys(en).filter(k => k.startsWith('report.section.'))];
  ok(keys.length >= 8, `fixture: the title and the section headings are found (${keys.length})`);
  for (const k of keys) {
    const words = titleCased(en[k]);
    ok(!words.length, `${k} is sentence case — "${en[k]}" capitalises ${words.join(', ')}`);
  }

  const unpin = pinClock(TODAY);
  let md;
  try {
    const M = await mountFor(SEED, { period: PERIOD, budgetFolder: B });
    md = (await createReport(M, { detail: 'detail' })).md;
  } finally { unpin(); }
  const heads = md.split('\n').filter(l => /^#{1,2} /.test(l)).map(l => l.replace(/^#+ /, ''));
  ok(heads.length >= 8, `fixture: the generated report has its headings (${heads.length})`);
  for (const h of heads) ok(!titleCased(h.replace(/ — .*$/, '')).length, `the generated heading "${h}" is sentence case`);

  console.log(`PASS report-sentence-case (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
