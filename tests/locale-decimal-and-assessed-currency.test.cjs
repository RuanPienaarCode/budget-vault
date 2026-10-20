'use strict';
/* Two small pieces of src/locale.js, both from the audit of 20 Oct 2026.

   1. decimalText(v, dp, loc) — a bare decimal in the household's own decimal
      mark, for figures that are not money: an interest rate ("22,25%"), a
      ratio ("2,1 / 3"). Pages built those with v.toFixed(dp), which prints a
      full stop in every locale, so a South African page read "R 1 234,56 at
      22.25%" — two decimal marks in one sentence. It deliberately does no
      grouping: a rate or a ratio never reaches a thousand, and a grouped
      "1 234,5" would be wrong for the ratios that sit beside a count.

   2. M2-10 — the "assessed" callout on the Tax page used the HOUSEHOLD's
      symbol while every callout beside it used the tax pack's own. On a
      `country: za` vault budgeting in rupiah the interest callout read
      "R 23 800,00" and the assessment check two lines down read
      "Rp 400 000,00" for a figure off the same ITA34 — a South African
      document, in rand. reconcileAssessed now takes the profile's currency,
      as figureChecks' own header says every figure on that page must.

   Figures below are made up.
     node tests/locale-decimal-and-assessed-currency.test.cjs
*/

const assert = require('assert');
const path = require('path');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const locale = require(path.join(__dirname, '..', 'src', 'locale.js'));
const { decimalText, localeFor } = locale;
const za = localeFor('za');
const us = localeFor('us');
const eu = localeFor('eu');

/* ---- 1. decimalText ---- */
ok(typeof decimalText === 'function', 'locale.decimalText is exported');
eq(decimalText(22.25, 2, za), '22,25', 'a rate in the za decimal mark');
eq(decimalText(2.1, 1, za), '2,1', 'a ratio to one place');
eq(decimalText(22.25, 2, us), '22.25', 'the us profile keeps its full stop');
eq(decimalText(7.5, 1, eu), '7,5', 'the eu profile uses a comma');
eq(decimalText(1234.5, 2, za), '1234,50', 'no grouping — only the decimal mark changes');
eq(decimalText(5, 0, za), '5', 'zero places prints no decimal mark at all');
eq(decimalText(2.345, 2, za), (2.345).toFixed(2).replace('.', ','), 'rounding is toFixed\'s, nothing re-derived');
eq(decimalText(-3.456, 2, za), '-3,46', 'a negative keeps its hyphen-minus');
eq(decimalText(-0.001, 2, za), '0,00', 'but a minus does not outlive the rounding that erased its number');
eq(decimalText(NaN, 2, za), '0,00', 'NaN reads as zero, padded to the places asked for');
eq(decimalText(Infinity, 1, za), '0,0', 'so does Infinity');
eq(decimalText(undefined, 0, za), '0', 'and a missing value at zero places');
eq(decimalText('12.5', 1, za), '12,5', 'a numeric string is read as its number');
eq(decimalText(3.14159, 2, { decimal: ',' }), '3,14', 'any {decimal} object will do, not only a profile');
eq(decimalText(3.14159, 2), '3.14', 'no locale at all falls back to a full stop');

/* ---- 2. M2-10: the assessed callout is in the tax pack's currency ---- */
const assessedYear = { taxpayer_type: 'standard', assessment: 'assessed', assessment_income: 400000 };
const figures = [
  { code: '3601', description: 'Salary', source: 'Employer', amount: 400000 },
  { code: '4201', description: 'Interest', source: 'Bank', amount: 5000 },
];
const msgs = za.figureChecks(figures, 2027, assessedYear, 'Rp');
const assessed = msgs.filter(m => /^Assessed taxable income/.test(m.text));
eq(assessed.length, 1, 'fixture: an assessed year with salary and one other figure prints the assessment callout');
ok(/R 400 000,00/.test(assessed[0].text), `the assessed callout prints rand: ${assessed[0].text}`);
ok(!/Rp/.test(assessed[0].text), `and never the household's rupiah symbol: ${assessed[0].text}`);
const interest = msgs.find(m => /^Local interest/.test(m.text));
ok(interest && /R 5 000,00/.test(interest.text), 'its neighbour, the interest callout, prints rand too');
ok(msgs.every(m => !/Rp/.test(m.text)), 'no callout on a za tax page carries the household symbol');

/* A household already in rand reads exactly what it always did. */
const same = za.figureChecks(figures, 2027, assessedYear, 'R').filter(m => /^Assessed taxable income/.test(m.text));
eq(same[0].text, assessed[0].text, 'a rand household sees the identical sentence');

console.log(`PASS — decimalText and the assessed callout currency (${checks} checks).`);
