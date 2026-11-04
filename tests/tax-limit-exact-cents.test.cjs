'use strict';
/* A total exactly AT a SARS limit is within it.

   locale.js sumCodes added cent amounts with no cent rounding, so twelve
   monthly TFSA debit orders that hit the R46 000 limit exactly
   (11 × 3 833,33 + 3 833,37) summed to 46000.000000000015 and the `>` test
   fired: a red card saying the household owed a 40% penalty on an excess of
   R 0,00. The interest exemption and the CGT exclusion had the same edge
   (2026-11-04 math review). The figures are typed in cents, so the sum is
   compared in cents.

     node tests/tax-limit-exact-cents.test.cjs */

const assert = require('assert');
const Module = require('module');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { setIcon() {}, normalizePath: p => p };
  return origLoad.call(this, req, ...rest);
};
const { localeFor } = require('../src/locale');

const za = localeFor('za');
let n = 0;
const rows = (code, amounts) => amounts.map(amount => ({ code, amount }));
const checks = figures => za.figureChecks(figures, 2027, {}, 'R');
const msg = (figures, re) => {
  const hit = checks(figures).filter(m => re.test(m.text));
  assert.strictEqual(hit.length, 1, `one message matching ${re}: ${checks(figures).map(m => m.text).join(' | ')}`);
  return hit[0];
};

/* TFSA: exactly the limit, in twelve debit orders. */
const tfsa = rows('4219', Array(11).fill(3833.33).concat([3833.37]));
{
  const m = msg(tfsa, /TFSA/);
  assert.strictEqual(m.ok, true, `exactly R46 000 is within the limit: ${m.text}`); n++;
  assert.ok(/R 0,00 of headroom/.test(m.text), `and says no headroom is left: ${m.text}`); n++;
}
/* A cent over is over — the fix must not round the limit away. */
{
  const m = msg(rows('4219', Array(11).fill(3833.33).concat([3833.38])), /TFSA/);
  assert.strictEqual(m.ok, false, `R46 000,01 exceeds the limit: ${m.text}`); n++;
  assert.ok(/R 0,01 excess/.test(m.text), `by one cent: ${m.text}`); n++;
}

/* Local interest: certificates totalling the under-65 exemption exactly. */
{
  const exempt = 23800;
  const amounts = Array(11).fill(1983.33).concat([exempt - 11 * 1983.33]);
  const m = msg(rows('4201', amounts), /Local interest/);
  assert.strictEqual(m.ok, true, `interest equal to the exemption is not taxable: ${m.text}`); n++;
}

/* CGT: gains totalling the annual exclusion exactly. */
{
  const cgt = 50000;
  const amounts = Array(9).fill(5555.55).concat([cgt - 9 * 5555.55]);
  const sum = amounts.reduce((a, b) => a + b, 0);
  assert.notStrictEqual(sum, cgt, `the fixture really carries float noise (${sum})`); n++;
  const bad = checks(rows('4250', amounts)).filter(m => m.ok === false && /gain/i.test(m.text));
  assert.deepStrictEqual(bad.map(m => m.text), [], 'gains equal to the exclusion raise no warning'); n++;
}

console.log(`PASS tests/tax-limit-exact-cents.test.cjs — a total at a SARS limit is within it, a cent over is over (${n} checks)`);
