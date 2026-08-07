'use strict';
/* Net worth across BOTH ledgers.

   The bug this pins: net worth used to sum accounts only, so a reader with a
   home loan on the Debt page saw a net worth overstated by the whole
   outstanding bond — on a page whose chart is captioned "what you own against
   what you owe". The omission was disclosed as a subtitle phrase, which is not
   a disclosure when the omitted item is the largest thing the reader owes.

   src/worth.js is pure, so this runs in bare node with no stub.

     node tests/worth.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { worth, activeDebts, cardOverlap, debtsByType } = require('../src/worth');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const acct = (type, balance) => ({ type, balance });
const debt = (type, balance, status) => ({ type, balance, status: status || 'active' });

/* ---- 1. the regression itself: a bond must not vanish ---- */
{
  const accounts = [acct('checking', 40000), acct('savings', 60000)];
  const before = worth(accounts, []);
  eq(before.net, 100000, 'with no debts, net worth is just the accounts');

  const after = worth(accounts, [debt('home loan', 850000)]);
  eq(after.net, -750000, 'a bond drags net worth negative — it does not disappear');
  eq(after.liabilities, 850000, 'and it is counted in full');
  eq(after.fromDebts, 850000, 'attributed to the debt page');
  eq(after.fromAccounts, 0, 'not to the accounts');
}

/* ---- 2. both ledgers at once, split by SIGN not by type ---- */
{
  const w = worth([
    acct('checking', 5000),
    acct('checking', -1200),      // overdrawn — a liability however it is labelled
    acct('credit_card', -3000),
    acct('credit_card', 250),     // a card in credit is an asset
    acct('investment', 90000),
  ], [debt('vehicle', 120000), debt('personal loan', 30000)]);

  eq(w.assets, 95250, 'positive balances only');
  eq(w.fromAccounts, 4200, 'the overdraft and the card, as positive magnitudes');
  eq(w.fromDebts, 150000, 'both debt rows');
  eq(w.liabilities, 154200, 'liabilities are the sum of the two ledgers');
  eq(w.net, -58950, 'net is assets less everything owed');
}

/* ---- 3. a paid debt is history ---- */
{
  const w = worth([acct('savings', 10000)], [
    debt('vehicle', 50000, 'paid'),
    debt('student', 20000, 'active'),
  ]);
  eq(w.fromDebts, 20000, 'only the active debt counts');
  eq(w.net, -10000, 'a settled car loan does not follow you around');
  eq(activeDebts([debt('a', 1, 'paid'), debt('b', 1)]).length, 1, 'activeDebts filters on status');
  eq(activeDebts(undefined).length, 0, 'missing debts behaves as none');
}

/* ---- 4. a negative debt balance is not a credit ----
   It would mean the lender owes YOU, which is an Owed Money row. Ignored
   rather than netted off, where it would quietly shrink a real liability. */
{
  const w = worth([acct('savings', 1000)], [debt('other', -500), debt('other', 2000)]);
  eq(w.fromDebts, 2000, 'the negative row is ignored, not credited');
  eq(w.net, -1000, 'so it cannot reduce what is owed');
}

/* ---- 5. the double-count warning reports, and never guesses ---- */
{
  const both = cardOverlap([acct('credit_card', -3000)], [debt('credit card', 3000)]);
  ok(both, 'a card on both ledgers is flagged');
  eq(both.cardAccounts, 1, 'and counted on the account side');
  eq(both.cardDebts, 1, 'and on the debt side');

  ok(!cardOverlap([acct('credit_card', -3000)], []), 'a card in only one place is not flagged');
  ok(!cardOverlap([], [debt('credit card', 3000)]), 'nor the other way round');
  ok(!cardOverlap([acct('credit_card', 250)], [debt('credit card', 3000)]),
    'a card in credit is an asset, not a second copy of a debt');
  ok(!cardOverlap([acct('credit_card', -3000)], [debt('home loan', 850000)]),
    'a bond is not a credit card');
  ok(cardOverlap([acct('credit_card', -1)], [debt('Credit Card', 1)]),
    'the type match is case-insensitive');
  ok(cardOverlap([acct('credit_card', -1)], [debt('creditcard', 1)]),
    'and tolerates the missing space');

  // Crucially: flagged, but NOT deduped. Both are still in the total.
  const w = worth([acct('credit_card', -3000)], [debt('credit card', 3000)]);
  eq(w.liabilities, 6000, 'the overlap is reported to the reader, never silently resolved');
}

/* ---- 6. chart grouping ---- */
{
  const g = debtsByType([
    debt('vehicle', 50000), debt('home loan', 800000),
    debt('vehicle', 30000), debt('store account', 0),
    debt('personal loan', 10000, 'paid'),
    debt('', 5000),
  ]);
  eq(g.length, 3, 'zero-balance, paid and duplicate types collapse or drop');
  eq(g[0], { type: 'home loan', amount: 800000 }, 'largest first');
  eq(g[1], { type: 'vehicle', amount: 80000 }, 'same type sums');
  eq(g[2], { type: 'other', amount: 5000 }, 'a blank type is named rather than left empty');
}

/* ---- 7. empty and malformed vaults ---- */
{
  const w = worth([], []);
  eq(w.net, 0, 'an empty vault is worth nothing, not NaN');
  eq(worth(undefined, undefined).net, 0, 'missing inputs behave as empty');
  eq(worth([{ type: 'other' }], [{ type: 'other', status: 'active' }]).net, 0,
    'a row with no balance contributes zero rather than NaN');
}

console.log(`worth.test.cjs — ${checks} checks OK`);
