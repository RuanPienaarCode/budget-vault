'use strict';
/* The Transactions table must order same-date rows the SAME way regardless of
   the "whole history" checkbox.

   The bug: the whole-history branch of filteredRows() sorted with
   `b.date.localeCompare(a.date)` (date only — Array.sort is stable in V8, so a
   same-date tie kept the order rows were pushed in, i.e. file order). The
   period-mode branch instead called `txInPeriod(...).reverse()`, and
   txInRange (src/period.js) sorts that list `date || desc` ASCENDING before
   handing it back — so reversing it flipped the date order AND every
   same-date tie. Ticking the "whole history" checkbox therefore inverted
   every same-day block: three same-day rows written Alpha/Bravo/Charlie read
   Alpha,Bravo,Charlie in one mode and Charlie,Bravo,Alpha in the other. This
   mattered most for a split, where a parent and its parts share a date (and,
   until edited, a description) — the parent-then-parts reading order survived
   txInRange's stable sort intact and was undone by the lone `.reverse()`.

   Drives the REAL registerTransactions(ctx) — filteredRows is published on
   ctx (like syncOptions) for exactly this reason: so a test drives the
   shipped function, not a hand-written mirror of its sort.

   Pure enough to run in bare node: no real DOM beyond a per-selector `$`
   stub, and no real period.js — txInPeriod is stubbed to hand back rows in
   the SAME shape txInRange actually returns them (ascending by date, then by
   description), which is the one behaviour this test needs to pin.

     node tests/transactions-sort-order.test.cjs
*/

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ------------------------------ obsidian --------------------------------- */
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') {
    return {
      setIcon() {}, Notice: class {}, Modal: class {}, Setting: class {},
      PluginSettingTab: class {}, ItemView: class {}, Plugin: class {},
      TFile: class {}, TFolder: class {},
      normalizePath: p => String(p),
    };
  }
  return origLoad.call(this, req, ...rest);
};

const registerTransactions = require('../src/views/transactions');

/* Three rows sharing one date, written in this order — Alpha first, the way
   a split parent would be written before its parts. */
const SAME_DAY = [
  { date: '2026-07-10', desc: 'Alpha', label: 'Cheque', cat: '', amount: -10, excluded: false, note: '', split: '' },
  { date: '2026-07-10', desc: 'Bravo', label: 'Cheque', cat: '', amount: -20, excluded: false, note: '', split: '' },
  { date: '2026-07-10', desc: 'Charlie', label: 'Cheque', cat: '', amount: -30, excluded: false, note: '', split: '' },
];

function makeCtx({ whole }) {
  // A tiny per-selector $ — the shared tests/helpers/harness.cjs stub hands
  // back ONE inert element for every selector, which cannot tell #txAccount
  // apart from #txWholeHistory. filteredRows needs to, so this test carries
  // its own.
  const els = {
    '#txWholeHistory': { checked: whole },
    '#txAccount': { value: '' },
    '#txCategory': { value: '' },
    '#txSearch': { value: '' },
  };
  const S = { txFiles: {
    Cheque: { label: 'Cheque', month: '2026-07', rows: SAME_DAY },
  }, period: '2026-07', categories: [] };
  const ctx = {
    S,
    $: sel => els[sel] || { value: '', checked: false },
    app: {}, plugin: {},
    money: v => String(v),
    toast: () => {},
    readFile: async () => '', writeFile: async () => {}, writeVaultFile: async () => {},
    periodTitle: () => '2026-07-01 – 2026-07-31, 2026',
    periodMonthName: () => 'July',
    // Mirrors what txInRange (src/period.js) actually hands back: ascending
    // by date, then by description — NOT file order. Reversing that list
    // (the bug) is what flipped same-date ties; sorting it (the fix) must
    // not.
    txInPeriod: () => [...SAME_DAY].sort((a, b) => a.date.localeCompare(b.date) || a.desc.localeCompare(b.desc)),
    deferredCatSelect: () => ({}),
    learnRules: () => {},
    txSegment: s => s,
    registerSaveButton: () => () => {},
    registerDirty: () => {},
    provide(obj) { Object.assign(ctx, obj); },
  };
  return ctx;
}

function namesFrom(ctx) {
  return ctx.filteredRows().rows.map(r => r.desc);
}

const wholeCtx = makeCtx({ whole: true });
registerTransactions(wholeCtx);
const periodCtx = makeCtx({ whole: false });
registerTransactions(periodCtx);

const wholeOrder = namesFrom(wholeCtx);
const periodOrder = namesFrom(periodCtx);

eq(wholeOrder, ['Alpha', 'Bravo', 'Charlie'], 'whole-history keeps same-date rows in the order they were written');
eq(periodOrder, wholeOrder, 'period mode must order the SAME same-date rows the SAME way — toggling the checkbox must not invert them');

console.log(`transactions-sort-order.test.cjs — ${checks} checks OK`);
