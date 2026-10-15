'use strict';
/* The CGT annual exclusion for the 2027 tax year is R50 000, with its source.

   L2b-04 (Medium). facts.js carried R40 000 for the 2027 tax year (1 March
   2026 - 28 February 2027) behind `cgtVerified: false`, a flag nothing read: a
   saver with R45 000 of gains was told on the Tax page that they exceeded the
   exclusion and about R2 000 fed into taxable income, when the year's exclusion
   is R50 000 and the gain is wholly exempt.

   The 25 February 2026 Budget changed the exclusion. SARS's own page
   (https://www.sars.gov.za/tax-rates/income-tax/capital-gains-tax-cgt/, "Last
   Updated: 26/02/2026", read 15 October 2026) heads its table "25 February
   2026 - No changes in percentages but changes to exclusions" and lists
   "Annual exclusion of R50 000 capital gain or capital loss is granted to
   individuals and special trusts". The earlier years stay at R40 000
   (unchanged since 2016/17), so the table is year-keyed and 2026 still reads
   R40 000.

     node tests/facts-cgt-annual-exclusion-2027.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const F = require('../src/facts');
const { PROFILES } = require('../src/locale');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

eq(F.limitsFor(2027).cgt, 50000, 'the 2027 tax year reads R50 000');
eq(F.limitsFor(2026).cgt, 40000, 'the 2026 tax year still reads R40 000');
eq(F.limitsFor(2017).cgt, 40000, 'and so does every year back to 2017');
eq(F.limitsFor(2099).cgt, 50000, 'a year past the table holds the newest known figure');

const za = PROFILES.za;
const text = (gains, year) => za.figureChecks([{ code: '4250', description: 'Unit trust switch', source: 'IT3(c)', amount: gains }], year, null, 'R')
  .filter(m => /[Cc]apital gains/.test(m.text)).map(m => ({ ok: m.ok, text: m.text.replace(/\s/g, ' ') }))[0];

{
  const m = text(45000, 2027);
  ok(m && m.ok && /under the R 50 000,00 annual exclusion/.test(m.text), `R45 000 of 2027 gains is inside the exclusion: ${m && m.text}`);
  const over = text(70000, 2027);
  ok(over && !over.ok && /exceed the R 50 000,00 annual exclusion by R 20 000,00/.test(over.text), `and R70 000 exceeds it by R20 000: ${over && over.text}`);
  ok(/R 8 000,00 feeds into taxable income/.test(over.text), 'at the 40% inclusion rate the taxable part is R8 000');
  const y26 = text(45000, 2026);
  ok(y26 && !y26.ok && /R 40 000,00 annual exclusion/.test(y26.text), 'the same gain in the 2026 year still exceeds that year\'s R40 000');
}

/* The figure is recorded with where it came from, and the flag that nothing read is gone. */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'facts.js'), 'utf8');
  ok(/sars\.gov\.za\/tax-rates\/income-tax\/capital-gains-tax-cgt/.test(src), 'facts.js names the SARS page the figure was read from');
  ok(/15 October 2026/.test(src), 'and the date it was read');
  ok(!/cgtVerified:\s*false/.test(src), 'and no row is left marked unverified for a figure nothing consults');
}

console.log(`PASS facts-cgt-annual-exclusion-2027 (${checks} checks)`);
