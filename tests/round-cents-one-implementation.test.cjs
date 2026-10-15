'use strict';
/* roundCents has ONE implementation (Wave B, lane B4; audit L8 "two helpers, two
   answers for one figure", whose Wave A fix aligned two copies by hand).

   It lives in src/amount.js, the pure money module. budget-export.js re-exports
   it, report.js takes it from amount.js instead of requiring the whole export
   module, and reslice.js wraps it only to keep the signed zero it has always
   returned for a negative amount that rounds away.

   The two reference functions below are the Wave A implementations VERBATIM
   (the export's and reslice's). The test sweeps the same inputs through the
   old and new code and demands Object.is-equal answers - so the dedupe is
   proven to change no figure, including the zero's sign.

     node tests/round-cents-one-implementation.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const amount = require('../src/amount');
const bx = require('../src/budget-export');
const reslice = require('../src/reslice');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- the Wave A references, as they stood ---- */
function oldExport(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return n;
  const a = Math.abs(n);
  if (a < 1e-6) return 0;
  if (a >= 1e15) return n;
  const r = Number(`${Math.round(Number(`${a.toPrecision(15)}e2`))}e-2`);
  return n < 0 && r !== 0 ? -r : r;
}
function oldReslice(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return v;
  const s = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  if (a >= 1e15) return v;
  return s * (a < 1e-6 ? 0 : Number(`${Math.round(Number(`${a.toPrecision(15)}e2`))}e-2`));
}

/* ---- one implementation ---- */
ok(typeof amount.roundCents === 'function', 'amount.js exports roundCents');
ok(bx.roundCents === amount.roundCents, 'budget-export.js re-exports the very same function');
const rep = fs.readFileSync(path.join(__dirname, '..', 'src', 'report.js'), 'utf8');
ok(/roundCents[^;]*\}\s*=\s*require\('\.\/amount'\)/.test(rep), 'report.js takes it from amount.js');
ok(!/require\('\.\/budget-export'\)/.test(rep), 'and no longer requires the export module to reach it');
const bxSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'budget-export.js'), 'utf8');
ok(!/function roundCents\b/.test(bxSrc), 'budget-export.js carries no copy');
const rsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'reslice.js'), 'utf8');
ok(!/toPrecision/.test(rsSrc), 'reslice.js carries no copy of the arithmetic');

/* ---- equivalence over the inputs money really takes ---- */
const inputs = [0, -0, NaN, Infinity, -Infinity, 1e15, -1e15, 1e21, 1e-7, -1e-7, -0.001, 0.004, -0.004, 0.005, -0.005,
  1.005, -1.005, 2.675, 0.015, 12.345, -12.345, '12.345', null, undefined, '', 'x'];
for (let c = -500; c <= 500; c++) {            // every cent from -R5 to R5, and the half-cents between
  inputs.push(c / 100, c / 100 + 0.005, c / 100 - 0.005, c / 1000);
}
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
for (let i = 0; i < 20000; i++) inputs.push((rnd() - 0.5) * 10 ** Math.floor(rnd() * 9));
let exportDiff = 0, resliceDiff = 0;
for (const v of inputs) {
  if (!Object.is(amount.roundCents(v), oldExport(v))) exportDiff++;
  if (!Object.is(reslice.roundCents(v), oldReslice(v))) resliceDiff++;
}
assert.strictEqual(exportDiff, 0, `${exportDiff} inputs round differently from the old export helper`); checks++;
assert.strictEqual(resliceDiff, 0, `${resliceDiff} inputs round differently (or lose the signed zero) from the old reslice helper`); checks++;
ok(Object.is(reslice.roundCents(-0.001), -0), 'reslice keeps the signed zero for a hair below zero');
ok(Object.is(reslice.roundCents(-0.004), -0), 'and for a negative that rounds away (the sign from the input)');
ok(Object.is(amount.roundCents(-0.004), 0), 'while the shared one never returns -0');

console.log(`PASS round-cents-one-implementation - one roundCents (amount.js), Object.is-identical to both Wave A copies over ${inputs.length} inputs (${checks} checks)`);
