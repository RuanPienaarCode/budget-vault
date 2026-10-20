'use strict';
/* The setup wizard prints money the way the country the reader just chose
   prints it (2026-10-20 audit, D2-08).

   OnboardingWizard.moneyText is the wizard's one money formatter — the live
   hint on the first-budget screen ("Income … − planned … = … left over"), the
   opening balance and the first-budget line on the finish screen all go
   through it. It was `${symbol} ${n.toFixed(2)}`: "R 30000.00", no grouping
   and a decimal POINT, on the very screen where a South African reader has
   just picked South Africa — and the app they land in a moment later prints
   the same figure "R 30 000,00". The first figures a new reader sees were the
   only ones in the app in the wrong shape.

   It now formats through currency.js formatAmount, the app's own formatter,
   with the separators of the wizard's chosen country (locale.js localeFor) —
   resolved on every call, so changing the country on an earlier screen
   changes the figures on a later one. The symbol is still the wizard's own
   currency answer, custom ones included. A negative keeps formatAmount's
   balance form ("R -1 500,50"): the opening balance is a balance.

   The comment that used to sit on moneyText said the app's formatter could
   not be used "because the locale profile belongs to a vault that does not
   exist yet". The profile belongs to the COUNTRY, which the wizard asks for
   on its own screen; nothing about it needs a vault.

     node tests/onboarding-money-text.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { OnboardingWizard } = require('../src/onboarding');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

function wiz(data) {
  const w = new OnboardingWizard({}, { settings: { budgetFolder: 'Finances/Budget' } });
  Object.assign(w.data, data);
  return w;
}

/* Made-up figures. */
{
  const w = wiz({ country: 'za', currency: 'R' });
  eq(w.moneyText(30000), 'R 30 000,00', 'South Africa: grouped with a space, decimal comma');
  eq(w.moneyText(1234567.5), 'R 1 234 567,50', 'every group of three, not just the first');
  eq(w.moneyText(-1500.5), 'R -1 500,50', 'a negative opening balance keeps the balance form the app prints for a balance');
  eq(w.moneyText(0), 'R 0,00', 'zero');
  eq(w.moneyText('not a number'), 'R 0,00', 'and anything unreadable as zero, as before');

  /* The country is read on every call, not captured once. */
  w.data.country = 'us';
  w.data.currency = '$';
  eq(w.moneyText(30000), '$ 30,000.00', 'United States: grouped with a comma, decimal point');
  w.data.country = 'eu';
  w.data.currency = '€';
  eq(w.moneyText(30000), '€ 30.000,00', 'Europe: grouped with a point, decimal comma');
}
{
  const w = wiz({ country: 'za', currency: '__custom__', customCurrency: ' CHF ' });
  eq(w.moneyText(2500), 'CHF 2 500,00', 'a custom symbol is the reader\'s own answer, under the country\'s separators');
}

/* The three places that print money go through moneyText — one formatter for
   the wizard, so the hint and the summary cannot disagree. */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'onboarding.js'), 'utf8');
  ok(!/toFixed\(2\)\}`/.test(src.slice(src.indexOf('moneyText(n)'), src.indexOf('moneyText(n)') + 400)),
    'moneyText no longer prints a bare toFixed(2)');
  ok((src.match(/this\.moneyText\(/g) || []).length >= 5, 'the hint, the opening balance and the first-budget line call it');
}

console.log(`PASS onboarding-money-text — the wizard prints money in the chosen country's separators (${checks} checks)`);
