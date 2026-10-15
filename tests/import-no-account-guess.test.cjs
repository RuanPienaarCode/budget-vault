'use strict';
/* L6-06 (2026-10-14 audit) — an undetected account is a question, not a default.

   renderImportReview ended its account-select setup with
     if (!p.label && labels.length) p.label = accSel.value;
   When detection found nothing (a hand-saved or renamed export: "the ordinary
   case, not an edge one", per this file's own header), `accSel.value` is
   whichever option a browser selects when none is marked — the FIRST account,
   alphabetically. p.label took it, "Import rows" stayed enabled, and one tap
   posted a whole statement to an account the reader never chose. The sign
   verdict, the duplicate count and the self-transfer suggestion were all
   computed against that guess too. (The account-number check catches it only
   when both the statement and the account carry a number.)

   The rule now: with no detected label the select opens on a "Choose an
   account…" placeholder, p.label stays empty, Import rows is disabled and the
   stats line does not claim a duplicate count it has not made; picking an
   account re-renders with the label set, the duplicate count for THAT account,
   and Import enabled. Picking the placeholder again goes back to waiting.

   Drives the REAL registerImport over the dom-stub, with the account select
   made to answer `.value` the way a browser does (the marked option, else the
   first) — the stub's own select has no such behaviour, which is why the guess
   was invisible to every earlier suite.

     node tests/import-no-account-guess.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const registerImport = require('../src/views/import');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { FakeEl } = makeDom();
const txt = n => String((n && n.textContent) || '').replace(/\s+/g, ' ').trim();

/* Two accounts, alphabetical order Alpha < Beta. Beta already holds the first
   statement row, so the duplicate count is what tells the two apart. */
const CSV = 'Date,Description,Amount\n2026-08-05,WOOLWORTHS SANDTON,-245.50\n2026-08-06,NEW MERCHANT XYZ,-10.00\n';

function makeCtx() {
  const els = {};
  const sel = new FakeEl('select');
  let chosen = null;                    // what the reader picked, if anything
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
  const ctx = {
    S: {
      settings: { currency: 'R', country: 'za', month_start_day: 1 },
      accounts: [
        { name: 'Alpha', tx_label: 'Alpha', type: 'checking' },
        { name: 'Beta', tx_label: 'Beta', type: 'checking' },
      ],
      categories: [], rules: [], budgets: {}, period: '2026-08',
      txFiles: {
        'Beta/2026-08': { label: 'Beta', month: '2026-08', rows: [
          { date: '2026-08-05', desc: 'WOOLWORTHS SANDTON', amount: -245.50, cat: '', excluded: false, note: '' }] },
      },
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
    accountForLabel: label => ctx.S.accounts.find(a => a.tx_label === label) || null,
    provide(obj) { Object.assign(ctx, obj); },
    _els: els, _sel: sel, _wrote: wrote, _toasts: toasts,
    pick(v) { sel.value = v; sel.onchange(); },
  };
  return ctx;
}
const file = text => ({ name: 'statement.csv', async arrayBuffer() { return new TextEncoder().encode(text).buffer; } });

(async () => {
  const ctx = makeCtx();
  registerImport(ctx);
  await ctx.handleStatementFile(file(CSV));
  const p = ctx.S.pendingImport;
  const sel = ctx._sel;
  const commit = () => ctx.$('#impCommit');
  const stats = () => txt(ctx.$('#impStats'));
  ok(p, 'the statement parsed');

  /* ---- 1. nothing detected: nothing is chosen for the reader ---- */
  eq(p.label, '', 'with no detected account the label stays empty — it is not the first account alphabetically');
  const opts = sel.children.map(o => ({ v: o.attrs.value, t: txt(o), sel: 'selected' in o.attrs }));
  eq(opts[0], { v: '', t: 'Choose an account…', sel: true }, 'the select opens on a "Choose an account…" placeholder');
  eq(opts.slice(1).map(o => o.v), ['Alpha', 'Beta'], 'followed by the real accounts, none of them marked');
  eq(commit().disabled, true, 'Import rows is disabled until an account is picked');
  ok(!/duplicates skipped/.test(stats()), `the stats line does not print a duplicate count it has not made — "${stats()}"`);
  ok(/choose an account/i.test(stats()), `and says why — "${stats()}"`);
  await ctx.commitImport();
  ok(ctx._wrote.length === 0 && ctx._toasts.some(t => /Pick an account first/.test(t.m)),
    'and a commit that gets through anyway still writes nothing and says to pick one');

  /* ---- 2. the pick: duplicates follow it ---- */
  ctx.pick('Beta');
  eq(p.label, 'Beta', 'picking Beta sets the label');
  eq(commit().disabled, false, 'and enables Import rows');
  ok(/1 duplicates skipped/.test(stats()), `the duplicate count is Beta's — "${stats()}"`);
  ok(!sel.children.some(o => o.attrs.value === ''), 'the placeholder goes once an account is set');

  ctx.pick('Alpha');
  ok(/0 duplicates skipped/.test(stats()), `switching to Alpha gives Alpha's count — "${stats()}"`);
  eq(commit().disabled, false, 'Import stays enabled');

  console.log(`PASS import-no-account-guess (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
