'use strict';
/* learnPattern trims a trailing "<amount> <currency code>" pair (2026-11-25
   audit, RUL-4), and nothing about how an existing rule MATCHES moved.

   A foreign-currency card row ends in the price it was charged at:
   "SpotifyZA 79.99 ZAR", "CLOUDWAYS 35.98 USD". The amount alone is already a
   reference token (digit-heavy), but the code after it is not, so the trimming
   loop stopped at the code and the learned rule was the whole description. It
   matched only that exact price: next month's 79.99 became 84.99 and the
   merchant was learned again, one dead rule per price change.

   The pair is trimmed only when BOTH halves look like what they are: an amount
   WITH decimals (a bare number is a model number — "BMW 320 GTI") and a code
   from an explicit ISO 4217 list (a three-letter word is a merchant — "PICK N
   PAY", "CAPE GAS"). Same shape the learned pattern has always had everywhere
   else: untrimmed fallback under four characters, internal spacing untouched.

   Block 1 pins the matcher on a small table BEFORE the fix, so the change to
   learnPattern provably left matchRule alone: a household's existing rules
   must file the same descriptions the same way.

     node tests/rules-learn-currency-tail.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

const { learnPattern, prepareRules, matchRule, autoCategorise } = require('../src/rules');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- 1. the matcher, as it was before this change ---------------------- */
{
  const rules = prepareRules([
    ['SHELL', 'Fuel'],
    ['spar', 'Food'],
    ['Checkers', 'Food'],
    ['Checkers Liquor', 'Liquor'],
    ['woolworths', 'Food'],
    ['woolworths food', 'Groceries'],
    ['alpha beta', 'Clothing'],
    ['beta gamma', 'Sport'],
    ['PNP ROSEBANK ZA', 'Food'],
    ['fees', 'Bank charges'],
    ['CASH WITHDRAWAL', 'Cash'],
    ['CASH WITHDRAWAL', 'Other'],
  ].map(([pattern, category]) => ({ pattern, category })));
  const table = [
    ['SHELL ULTRA CITY RONDEBOSCH', 'Fuel', 'a substring wins when nothing is longer'],
    ['shell', 'Fuel', 'case is ignored'],
    ['SHELLY BEACH', '', 'a short stem is a word, not a substring'],
    ['SPAR-NEWLANDS', 'Food', 'punctuation is a word boundary'],
    ['SPARKLE CLEANERS', '', 'a short stem inside a longer word does not match'],
    ['Checkers Liquor Newlands', 'Liquor', 'the longest matching pattern wins'],
    ['CHECKERS RONDEBOSCH', 'Food', 'the shorter rule answers when the longer does not hit'],
    ['WOOLWORTHS FOOD V&A', 'Groceries', 'a long pattern is a substring and the longer one wins'],
    ['alpha beta gamma', 'Clothing', 'equal-length overlap goes to the earlier line'],
    ['PNP ROSEBANK', 'Food', 'a rule typed with the country suffix matches the importer-stripped row'],
    ['COFFEES BY THE SEA', '', 'ISSUE 71: "fees" does not eat COFFEES'],
    ['FEES 000123', 'Bank charges', 'a short stem still matches on a digit boundary'],
    ['cash withdrawal', 'Cash', 'an exact match returns the earlier of two identical patterns'],
  ];
  for (const [desc, want, why] of table) eq(autoCategorise(desc, rules), want, `matchRule unchanged — ${why}`);
  eq(matchRule('PNP ROSEBANK ZA', rules).p, 'pnp rosebank za', 'the exact pattern is the winner, not its stripped alias');
}

/* ---- 2. the existing learnPattern table is unchanged -------------------- */
for (const [desc, want, why] of [
  ['MEGAMART CENTRAL 000000******0000', 'MEGAMART CENTRAL', 'masked card number'],
  ['VALUE MART 123456789', 'VALUE MART', 'long digit run'],
  ['CORNER MART 12.50', 'CORNER MART', 'a bare trailing amount was already trimmed'],
  ['CORNER MART', 'CORNER MART', 'a clean description'],
  ['ABC 123456789', 'ABC 123456789', 'under four characters falls back to the original'],
  ['Woolworths  Food  V&A', 'Woolworths  Food  V&A', 'internal spacing is preserved'],
  ['SHOP 12.50USD', 'SHOP', 'a glued amount-and-code token was already a digit-heavy reference'],
  ['SHOP USD 12.50', 'SHOP USD', 'a code BEFORE the amount is not a price tail'],
]) eq(learnPattern(desc), want, `learnPattern unchanged — ${why}`);

/* ---- 3. RUL-4: the foreign-price tail ----------------------------------- */
for (const [desc, want, why] of [
  ['SpotifyZA 79.99 ZAR', 'SpotifyZA', 'the audit case: price and code both go'],
  ['CLOUDWAYS 35.98 USD', 'CLOUDWAYS', 'a USD price'],
  ['VITALITY TRAVEL Johannesburg 9710.00 ZAR', 'VITALITY TRAVEL Johannesburg', 'a four-figure amount'],
  ['Shop North 1,234.56 USD', 'Shop North', 'thousands separator, dot decimal'],
  ['Shop North 1.234,56 EUR', 'Shop North', 'thousands separator, comma decimal'],
  ['Shop North 12,50 EUR', 'Shop North', 'comma decimal'],
  ['CORNER MART 12.50 ZAR 000123', 'CORNER MART', 'a reference after the pair, then the pair'],
  ['CORNER MART 000123 12.50 ZAR', 'CORNER MART', 'a reference before the pair'],
]) eq(learnPattern(desc), want, `RUL-4 — ${why}`);

for (const [desc, why] of [
  ['PICK N PAY', 'a merchant ending in a three-letter word'],
  ['CAPE GAS', 'a merchant ending in a three-letter word'],
  ['BMW 320 GTI', 'a model number is not an amount'],
  ['SHOP 12.50 ZZZ', 'a code that is not ISO 4217'],
  ['SHOP 12.50 GAS', 'a three-letter word that is not a currency'],
  ['SHOP 12 USD', 'no decimals, not an amount'],
  ['SHOP 1,234 USD', 'a thousands group is not a decimal'],
  ['SHOP 12.50 zar', 'a statement prints the code in capitals'],
  ['79.99 ZAR', 'nothing would be left of the name'],
  ['ABC 79.99 ZAR', 'under four characters falls back to the original'],
]) eq(learnPattern(desc), desc, `RUL-4 stays whole — ${why}`);

/* The learned rule now covers next month's price. */
{
  const rules = prepareRules([{ pattern: learnPattern('SpotifyZA 79.99 ZAR'), category: 'Subscriptions' }]);
  eq(autoCategorise('SpotifyZA 84.99 ZAR', rules), 'Subscriptions', 'a price change no longer needs a new rule');
}

console.log(`PASS rules-learn-currency-tail (${checks} checks)`);
