'use strict';
/* Per-account currency — a display symbol that converts nothing.

   What this pins is mostly what the feature REFUSES to do. A currency key that
   silently excluded an account from the household totals would be a second
   exclusion rule sitting beside `budget: false`, which committed.js rejects by
   name: "two overlapping ways to exclude the same account is how a reader ends
   up unable to explain their own total." And a currency key that converted
   would need a rate this vault does not hold.

   So: the symbol moves, the arithmetic does not, and a total spanning more
   than one symbol is DISCLOSED rather than quietly fixed. currenciesIn() is
   what the page asks to know whether to say so.

   src/currency.js is pure, so this runs in bare node with no stub.

     node tests/currency.test.cjs     # non-zero exit on failure
*/

const assert = require('assert');
const { symbolOf, isForeign, currenciesIn } = require('../src/currency');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const acct = (name, currency) => ({ name, currency });

/* ---- 1. the common case: nobody has a currency key, nothing changes ---- */
{
  const a = { name: 'Transaction Account' };
  eq(symbolOf(a, 'R'), 'R', 'no key means the household symbol');
  eq(isForeign(a, 'R'), false, 'and it is not foreign');
  eq(currenciesIn([a, acct('Cash')], 'R'), ['R'],
    'a single-currency vault reports one symbol, so the page says nothing');
}

/* ---- 2. an account in another currency prints in its own symbol ---- */
{
  const euro = acct('Euro Account', '€');
  eq(symbolOf(euro, 'R'), '€', 'its own symbol wins');
  eq(isForeign(euro, 'R'), true, 'and it is flagged as foreign');
}

/* ---- 3. stating the household symbol explicitly is NOT a second currency.
   A vault that writes `currency: "R"` on every account by hand must not light
   up the mixed-currency disclosure on every total it has. ---- */
{
  const explicit = acct('Savings', 'R');
  eq(isForeign(explicit, 'R'), false, 'the household symbol restated is still the household symbol');
  eq(currenciesIn([explicit, acct('Cash')], 'R'), ['R'], 'so the total is not marked as mixed');
}

/* ---- 4. whitespace is not a currency ---- */
{
  eq(symbolOf(acct('Odd', '   '), 'R'), 'R', 'a blank key falls back');
  eq(isForeign(acct('Odd', '   '), 'R'), false, 'and does not read as foreign');
  eq(symbolOf(acct('Padded', ' € '), 'R'), '€', 'a padded symbol is trimmed, not rejected');
  eq(isForeign(acct('Padded', ' € '), 'R'), true, 'and compares on the trimmed form');
}

/* ---- 5. the disclosure list: household first, then first-met order ---- */
{
  const list = currenciesIn(
    [acct('Dollar Account', '$'), acct('Transaction Account'), acct('Euro Account', '€'), acct('Petty Cash', '$')],
    'R');
  eq(list, ['R', '$', '€'],
    'household symbol leads, the rest keep the order they were met in, no duplicates');
  ok(list.length > 1, 'more than one symbol is exactly the condition the page discloses on');
}

/* ---- 6. a vault with NO account in the household currency still reports
   honestly rather than inventing a leading "R" that nothing holds ---- */
{
  eq(currenciesIn([acct('Euro Account', '€'), acct('Dollar Account', '$')], 'R'), ['€', '$'],
    'the household symbol is not prepended when no account uses it');
}

/* ---- 7. it does not convert, and it does not exclude.

   There is no arithmetic in this module at all — no rate, no filter, no
   "household only" list. That absence is the design, so it is asserted
   directly: anything added here later has to justify itself against this. ---- */
{
  const api = Object.keys(require('../src/currency')).sort();
  eq(api, ['currenciesIn', 'isForeign', 'symbolOf'],
    'three read-only helpers — no convert(), no exclude(), no rate table');
}

/* ---- 8. degenerate input, because the loader hands this real files ---- */
{
  eq(currenciesIn(null, 'R'), [], 'no accounts, no symbols');
  eq(currenciesIn([], ''), [], 'and an empty household symbol does not crash');
  eq(symbolOf(null, ''), 'R', 'the last-resort fallback matches the loader default');
}

console.log(`PASS tests/currency.test.cjs (${checks} checks)`);
