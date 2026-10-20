'use strict';
/* THE ACCOUNT SELECT SHOWS THE ACCOUNT THE ROWS WILL GO TO
   (left over from the 14 Oct 2026 audit fix wave, beside L6-06).

   renderImportReview rebuilds the account <select> on every render from the
   accounts and folders the vault holds NOW, and marks the option equal to
   p.label. L6-06 made an EMPTY label a question (a "Choose an account…"
   placeholder, Import rows off). A label that is set but matches no option
   fell through both branches: no placeholder (the label is not empty) and no
   option marked (none is equal), so the browser showed the FIRST account while
   p.label — what commitImport writes under — still named another. The reader
   sees "Alpha", taps Import rows, and the statement lands in a folder called
   "Beta" that no account claims any more: an orphan folder (CONTEXT.md), whose
   rows count toward period totals and toward no balance.

   How a set label stops being an option: the review stays open while the
   account it was detected for is deleted, or re-pointed at another folder, on
   the Accounts page; the next render (a pick, "show more", a category change)
   rebuilds the options without it. And a label that names an option in a
   different case or spelling (the folders are matched case-folded everywhere
   else, ADR-0007) marks nothing either, though it means that account.

   The rule now: a label is settled to the option it means (accountForLabel
   folds case and safeSegs, as the writer does), and a label that means no
   option is not settled at all — it goes back to the L6-06 question. Either
   way, what the select shows is what p.label holds.

   Drives the REAL registerImport over the dom-stub, with the account select
   answering `.value` the way a browser does (the marked option, else the
   first) — the same harness as import-no-account-guess.test.cjs.

     node tests/import-label-not-an-option.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const registerImport = require('../src/views/import');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { FakeEl } = makeDom();

const CSV = 'Date,Description,Amount\n2026-08-05,WOOLWORTHS SANDTON,-245.50\n2026-08-06,NEW MERCHANT XYZ,-10.00\n';

function makeCtx() {
  const els = {};
  const sel = new FakeEl('select');
  let chosen = null;
  Object.defineProperty(sel, 'value', {
    get() {
      const marked = sel.children.find(o => o.attrs && 'selected' in o.attrs);
      const o = chosen !== null ? sel.children.find(c => c.attrs.value === chosen) : (marked || sel.children[0]);
      return o ? (o.attrs.value ?? '') : '';
    },
    set(v) { chosen = v; },
  });
  const wrote = [];
  const toasts = [];
  const fold = s => String(s || '').trim().toLowerCase();
  const ctx = {
    S: {
      settings: { currency: 'R', country: 'za', month_start_day: 1 },
      accounts: [
        { name: 'Alpha', tx_label: 'Alpha', type: 'checking', account_number: '111111' },
        { name: 'Beta', tx_label: 'Beta', type: 'checking', account_number: '123456' },
      ],
      categories: [], rules: [], budgets: {}, period: '2026-08',
      txFiles: {},
    },
    $: s => (s === '#impAccount' ? sel : (els[s] ||= new FakeEl('div'))),
    $$: () => [],
    app: {},
    money: v => `R ${Number(v).toFixed(2)}`,
    moneyIn: (s, v) => `${s} ${Number(v).toFixed(2)}`,
    toast: (m, bad) => toasts.push({ m, bad }),
    async writeFile(...a) { wrote.push(a); },
    currentPeriod: () => '2026-08',
    periodRange: () => ({ start: '2026-08-01', end: '2026-08-31' }),
    periodTitle: () => 'Aug 2026',
    deferredCatSelect: () => new FakeEl('select'),
    serializeTxFile: () => '',
    locale: () => ({ dayFirst: false, thousands: ',', decimal: '.', banks: null, importHint: '' }),
    learnRules() {},
    txSegment: s => s,
    /* Case-folded, as period.js's is (ADR-0007). */
    accountForLabel: label => ctx.S.accounts.find(a =>
      fold(a.tx_label) === fold(label) || fold(a.name) === fold(label)) || null,
    provide(obj) { Object.assign(ctx, obj); },
    _sel: sel, _wrote: wrote, _toasts: toasts,
    reset() { chosen = null; },
  };
  return ctx;
}
const file = (name, text) => ({ name, async arrayBuffer() { return new TextEncoder().encode(text).buffer; } });
const shown = sel => sel.value;

(async () => {
  /* ---- 0. the control: detection lands on an option ---- */
  const ctx = makeCtx();
  registerImport(ctx);
  await ctx.handleStatementFile(file('Beta_123456_statement.csv', CSV));
  const p = ctx.S.pendingImport;
  const sel = ctx._sel;
  const commit = () => ctx.$('#impCommit');
  eq(p.label, 'Beta', 'precondition: the account number in the filename detects Beta');
  eq(shown(sel), 'Beta', 'and the select shows Beta');

  /* ---- 1. the account is deleted while the review is open ---- */
  ctx.S.accounts = ctx.S.accounts.filter(a => a.name !== 'Beta');
  ctx.reset();
  ctx.renderImportReview();
  eq(shown(sel), p.label,
    `the select shows what p.label holds — it showed "${shown(sel)}" while the rows were bound for "${p.label}"`);
  eq(p.label, '', 'a label no option carries is not settled: the review asks again');
  eq(sel.children[0] && sel.children[0].attrs.value, '', 'with the "Choose an account…" placeholder first');
  eq(commit().disabled, true, 'and Import rows off until the reader picks');
  await ctx.commitImport();
  eq(ctx._wrote.length, 0, 'a commit that gets through anyway writes nothing — no orphan "Beta" folder');

  /* ---- 2. a label that means an option in another case ---- */
  p.label = 'alpha';
  ctx.reset();
  ctx.renderImportReview();
  eq(p.label, 'Alpha', 'a label that names an account in another case is settled to that account\'s option');
  eq(shown(sel), 'Alpha', 'and the select shows it, marked');
  ok(sel.children.filter(o => 'selected' in o.attrs).length === 1, 'exactly one option is marked');
  eq(commit().disabled, false, 'Import rows is on: the account is settled');

  console.log(`PASS import-label-not-an-option (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
