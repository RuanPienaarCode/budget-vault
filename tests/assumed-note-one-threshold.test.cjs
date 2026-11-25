'use strict';
/* "includes R x already spent" has ONE threshold and ONE rounding on all
   three surfaces that print it (2026-11-25 audit, NUM-7).

   The same assume-spent provision was shown three ways: the Dashboard hero
   hid it below R 1 and printed whole rands, the Budget strip printed it from
   a cent ("includes R 1 already spent" for R 0,52, rounded UP past a
   threshold the Dashboard keeps), and the Report printed it from a cent, to
   the cent ("includes R 0,52 already spent"). A sentence about rounding noise
   should not exist on one page and not another, and a household reading the
   Dashboard and then the Report must see the same words.

   The rule is the Dashboard's — show it only when it is at least R 1, in
   whole rands — and it lives in figures.js assumedNoteAmount, which the three
   read. Driven end to end: the real Dashboard qualifiers over periodFigures,
   the real Budget strip over the draft, and the real Report document, on one
   household whose Carry category is assume-spent and has no transactions, so
   the provision is exactly what the budget row says.
   Synthetic household.
     node tests/assumed-note-one-threshold.test.cjs */

const assert = require('assert');
const { B, base, account, find, textOf, mountFor, pinClock } = require('./helpers/dash-audit.cjs');
const { createReport } = require('./helpers/report-page.cjs');
const { heroQualifiers } = require('../src/views/dashboard');
const { assumedNoteAmount } = require('../src/figures');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const HEAD = '| Category | Type | Amount | Notes |\n|---|---|---:|---|\n';
const files = carry => ({
  ...base(),
  [`${B}/Categories/Carry.md`]: '---\ntype: expense\ncolor: "#c0392b"\nassume_spent: true\n---\n',
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-09.md`]: `---\nkind: budget\n---\n\n${HEAD}| Carry | expense | ${carry} |  |\n| Groceries | expense | 1000.00 |  |\n`,
});

/* What each surface prints about the provision, '' when it says nothing. */
async function surfaces(carry) {
  const unpin = pinClock('2026-09-10');
  try {
    const M = await mountFor(files(carry), { period: '2026-09' });
    const { ctx } = M;
    const fmt = (v, dp = 2) => ctx.money(v, dp);
    const F = ctx.periodFigures('2026-09');
    const q = heroQualifiers(F, fmt).find(x => x.key === 'assumed');
    ctx.renderBudgets();
    const strip = textOf(find(ctx.$('#budTotalsTop'), n => n.attrs && n.attrs['data-fig'] === 'bud-note-spent')[0]);
    const md = (await createReport(M, { json: false })).md || '';
    const grab = s => { const m = /includes ([^|\n]*?) already spent/.exec(s); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
    return { assumed: F.used.assumed, dashboard: q ? q.text.replace(/\s+/g, ' ').trim() : '', budget: grab(strip), report: grab(md) };
  } finally { unpin(); }
}

(async () => {
  /* ---- the shared rule itself ---- */
  const fmt = (v, dp = 2) => `R${v.toFixed(dp)}`;
  eq(assumedNoteAmount(0.52, fmt), '', 'under R 1 says nothing');
  eq(assumedNoteAmount(0.999, fmt), '', 'the line is R 1, not "rounds to R 1"');
  eq(assumedNoteAmount(1, fmt), 'R1', 'R 1 is shown');
  eq(assumedNoteAmount(1.4, fmt), 'R1', 'in whole rands');
  eq(assumedNoteAmount(1900.25, fmt), 'R1900', 'never to the cent');
  eq(assumedNoteAmount(0, fmt) + assumedNoteAmount(null, fmt) + assumedNoteAmount(undefined, fmt) + assumedNoteAmount('x', fmt), '', 'no provision, nothing to say');

  /* ---- R 0,52: noise, said by none of the three ---- */
  {
    const r = await surfaces('0.52');
    eq(Number(r.assumed.toFixed(2)), 0.52, 'fixture: the provision is R 0,52');
    eq(r.dashboard, '', 'the Dashboard says nothing about it');
    eq(r.budget, '', 'the Budget strip says nothing about it');
    eq(r.report, '', 'the Report says nothing about it');
  }

  /* ---- R 1,40: said by all three, as the same whole-rand figure ---- */
  {
    const r = await surfaces('1.40');
    ok(/^includes .*R.*1.* already spent$/.test(r.dashboard), `Dashboard says it (${r.dashboard})`);
    const amount = s => s.replace(/[^\d,.]/g, '');
    eq(amount(r.budget), '1', `the Budget strip prints the whole rand (${r.budget})`);
    eq(amount(r.report), '1', `the Report prints the whole rand (${r.report})`);
    ok(r.dashboard.includes(r.budget) && r.dashboard.includes(r.report), 'the figure is spelled identically on all three');
  }

  /* ---- a real figure: the Report no longer carries cents the others drop ---- */
  {
    const r = await surfaces('2500.50');
    ok(r.budget !== '' && r.report !== '', 'both print it');
    eq(r.report, r.budget, 'and spell it the same, to the rand');
    ok(!/[,.]\d\d\b/.test(r.report), `no cents in the Report's figure (${r.report})`);
  }

  console.log(`PASS assumed-note-one-threshold (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
