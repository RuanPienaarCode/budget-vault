'use strict';
/* The Tax page's Deadline tile counts days in words, singular and plural.

   2026-10-20 audit, D2-26. Three days past the deadline read "3 d overdue" —
   the only abbreviated unit in the app, on the tile a household reads when it
   is already late — while the same tile three days early read "3 days". The
   count of one was wrong both ways: "1 days" and "1 d overdue".

   Through the REAL loader and the REAL Tax view, with the clock pinned. The
   tax year and its deadlines are made up.

     node tests/tax-deadline-days.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const B = 'Budget';
const tax = deadline => `---\nkind: tax\ntax_year: 2026\ntaxpayer_type: standard\nassessment: unknown\ndeadline_standard: ${deadline}\n---\n\n`
  + '# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n\n'
  + '## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n\n'
  + '## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n';

async function deadlineTile(deadline) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Tax/2026.md`]: tax(deadline) }, { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  require('../src/views/tax')(ctx);
  ctx.S.taxYear = '2026';
  ctx.renderTax();
  const tile = descend($('#taxKpis')).filter(n => n._cls.has('mini'))
    .find(t => descend(t).some(n => n._cls.has('l') && n.textContent === 'Deadline'));
  return descend(tile).find(n => n._cls.has('v')).textContent;
}

(async () => {
  const unpin = pinClock('2026-10-20');
  try {
    eq(await deadlineTile('2026-10-17'), '3 days overdue', 'three days late reads "3 days overdue", not "3 d overdue"');
    eq(await deadlineTile('2026-10-19'), '1 day overdue', 'one day late is singular');
    eq(await deadlineTile('2026-10-21'), '1 day', 'one day to go is singular too, not "1 days"');
    eq(await deadlineTile('2026-10-30'), '10 days', 'and an ordinary count still reads "10 days"');
  } finally {
    unpin();
  }
  console.log(`PASS tax-deadline-days — the Deadline tile counts days in words, singular and plural (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
