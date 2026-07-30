'use strict';
/* Split-transaction guard.

   Splitting is the one editing action that can silently change the period
   totals, because it turns one row into several. Two things keep it honest and
   both are asserted here:

     1. The parts sum to the original EXACTLY. SplitModal refuses to submit
        while the remainder is non-zero, so "close enough" can never reach disk.
     2. The original row is kept and marked excluded rather than deleted, so
        (a) periodSummary — which filters excluded rows out — sees exactly the
        same money as before, and (b) the CSV importer's `date|desc|amount|label`
        dedup key still exists in the file, so re-importing the same statement
        cannot re-add the line on top of its own parts.

   Layer 1 (SplitModal maths, signs, rounding) is driven directly. Layer 2 is
   asserted against the REAL serializer plus a mirror of the loader's column
   mapping, i.e. the shape a split actually leaves on disk.

   Runs in bare node via a tiny `obsidian` stub. Wired into ./build.sh.
     node tests/split-transaction.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const Module = require('module');

const origLoad = Module._load;
const STUB = {
  setIcon() {}, normalizePath: (p) => p,
  Notice: class {}, Modal: class {}, Setting: class {}, PluginSettingTab: class {},
  ItemView: class {}, Plugin: class {}, TFile: class {}, TFolder: class {},
};
Module._load = function (request) {
  if (request === 'obsidian') return STUB;
  return origLoad.apply(this, arguments);
};

const { parseMdTable, unescMd, parseNum } = require('../src/util');
const { SplitModal } = require('../src/modal');
const registerTransactions = require('../src/views/transactions');

let checks = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const ok = (c, msg) => { assert.ok(c, msg); checks++; };

const money = (v) => `R ${v.toFixed(2)}`;
/* onOpen()/refresh() need a DOM; the maths does not. Build the modal, drive the
   parts array the way the inputs would, and stub only close(). */
function modal(amount, cat = 'Groceries') {
  const m = new SplitModal({}, {
    tx: { date: '2026-07-30', desc: 'CHECKERS', label: 'Credit Card', amount, cat },
    categories: ['Groceries', 'Household'], money,
  }, () => {});
  m.close = () => {};
  m.refresh = () => {};        // no footEl / okBtn outside onOpen
  return m;
}

/* ---- 1. Seeded state: whole amount on part 1, sign captured from the parent ---- */
{
  const m = modal(-297.22);
  eq(m.sign, -1, 'a money-out parent must give the parts a negative sign');
  eq(m.total, 297.22, 'the modal works in magnitudes');
  eq(m.parts.length, 2, 'a split seeds two parts');
  eq(m.parts[0].mag, 297.22, 'part 1 is seeded with the whole amount');
  eq(m.parts[0].cat, 'Groceries', "part 1 inherits the original's category");
  eq(m.remainder(), 0, 'the seeded state is balanced…');
  ok(!m.parts.every((p) => p.mag > 0), '…but part 2 is empty, so it must not be submittable');
}
{
  const m = modal(1200);
  eq(m.sign, 1, 'a money-in parent must give the parts a positive sign');
}

/* ---- 2. submit() refuses anything that does not sum to the original ---- */
for (const [a, b, why] of [
  [200, 90, 'under-allocated'],
  [200, 120, 'over-allocated'],
  [297.22, 0, 'a zero part'],
  [0, 297.22, 'a zero part in any position'],
]) {
  const m = modal(-297.22);
  m.parts[0].mag = a; m.parts[1].mag = b;
  m.submit();
  eq(m.result, null, `submit must refuse: ${why}`);
}

/* ---- 3. A balanced split applies the parent's sign to positive magnitudes ---- */
{
  const m = modal(-297.22);
  m.parts[0].mag = 200; m.parts[0].note = ' medicine ';
  m.parts[1].mag = 97.22; m.parts[1].cat = 'Household';
  m.submit();
  eq(m.result, [
    { amount: -200, cat: 'Groceries', note: 'medicine' },
    { amount: -97.22, cat: 'Household', note: '' },
  ], 'parts come out signed like the parent, with notes trimmed');
  eq(m.result.reduce((s, p) => s + p.amount, 0), -297.22, 'parts must sum to the original');
}

/* ---- 4. Cents, not floats: a three-way split of an odd amount ---- */
// 0.1 + 0.2 !== 0.3 in binary floating point. Every step is rounded to cents so
// a legitimate split is never rejected by a 1e-15 remainder, and an illegitimate
// one is never accepted by the same slack.
{
  const m = modal(-0.30);
  m.parts[0].mag = 0.1; m.parts[1].mag = 0.2;
  eq(m.remainder(), 0, 'cent-rounding must let 0.10 + 0.20 balance 0.30');
  m.submit();
  ok(m.result, 'a cent-exact split must be accepted');
}
{
  const m = modal(-1240.85);
  m.parts[0].mag = 400.28; m.parts[1].mag = 400.28;
  m.parts.push({ mag: 440.29, cat: '', note: '' });
  eq(m.remainder(), 0, 'a three-way split must balance to the cent');
  m.submit();
  eq(m.result.length, 3, 'three parts must survive');
  eq(m.result.reduce((s, p) => s + p.amount, 0), -1240.85, 'three parts must sum to the original');
}
{
  const m = modal(-100);
  m.parts[0].mag = 33.33; m.parts[1].mag = 33.33;
  m.parts.push({ mag: 33.33, cat: '', note: '' });
  eq(m.remainder(), 0.01, 'a one-cent shortfall must be visible, not absorbed');
  m.submit();
  eq(m.result, null, 'a one-cent shortfall must block the split');
}

/* ---- 5. The shape a split leaves on disk ---- */
// Drives the REAL serializer with the row set splitTransaction produces: the
// parent kept + marked excluded, and the parts appended.
const ctx = { S: {}, registerDirty() {}, provide(o) { Object.assign(ctx, o); } };
registerTransactions(ctx);
const { serializeTxFile } = ctx;
ok(typeof ctx.splitTransaction === 'function', 'splitTransaction must be exposed on ctx');

const parent = {
  date: '2026-08-10', desc: 'GROCER ONE', cat: 'Groceries',
  amount: -1240.85, amountRaw: null, excluded: true, note: 'Split into 2',
};
const file = {
  label: 'FNB Cheque', month: '2026-08', fmRaw: 'kind: transactions',
  rows: [
    parent,
    { date: '2026-08-10', desc: 'GROCER ONE', cat: 'Groceries', amount: -800, amountRaw: null, excluded: false, note: '' },
    { date: '2026-08-10', desc: 'GROCER ONE', cat: 'Eating Out', amount: -440.85, amountRaw: null, excluded: false, note: 'snacks' },
    { date: '2026-08-12', desc: 'STREAM CO', cat: 'Subscriptions', amount: -199, amountRaw: null, excluded: false, note: '' },
  ],
};
const back = parseMdTable(serializeTxFile({ ...file, rows: file.rows.map((r) => ({ ...r })) }))
  .slice(1)
  .map((c) => ({
    date: c[0], desc: unescMd(c[1]), cat: unescMd(c[2]), amount: parseNum(c[3]).value,
    excluded: (c[4] || '').toLowerCase() === 'yes', note: unescMd(c[5] || ''),
  }));

const parts = back.filter((r) => r.desc === 'GROCER ONE' && !r.excluded);
const kept = back.filter((r) => r.desc === 'GROCER ONE' && r.excluded);
eq(kept.length, 1, 'exactly one parent row is kept');
eq(kept[0].amount, -1240.85, "the parent keeps its amount — that IS the importer's dedup key");
ok(/Split into 2/.test(kept[0].note), 'the parent says why it is excluded');
eq(parts.length, 2, 'both parts are written');
eq(Math.round(parts.reduce((s, r) => s + r.amount, 0) * 100) / 100, kept[0].amount,
  'the parts on disk sum to the parent on disk');

// The invariant that pays for the whole design: what periodSummary counts is
// unchanged by the split. -1240.85 (as the parent, pre-split) + -199 = -1439.85.
const counted = back.filter((r) => !r.excluded).reduce((s, r) => s + r.amount, 0);
eq(Math.round(counted * 100) / 100, -1439.85,
  'non-excluded rows must total exactly what they totalled before the split');

console.log(`PASS — split arithmetic, signs, cent-rounding and on-disk shape intact (${checks} assertions).`);
