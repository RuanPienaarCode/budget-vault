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
const { worth, activeDebts, assetTotal, cardOverlap, debtsByType, assetsByType } = require('../src/worth');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const acct = (type, balance) => ({ type, balance });
const debt = (type, balance, status) => ({ type, balance, status: status || 'active' });
const asset = (type, value) => ({ type, value });

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

  eq(w.assets, 95250, 'positive balances, and no asset page to add to them');
  eq(w.ownedAccounts, 95250, 'attributed to the accounts');
  eq(w.ownedAssets, 0, 'nothing from the asset page');
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
  ok(cardOverlap([acct('Credit_Card', -1)], [debt('credit card', 1)]),
    'the ACCOUNT side folds case too — isCreditCard is the same rule the committed chain reads, so a hand-typed Credit_Card cannot be a card to one page and not the other');

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
  eq(worth([], [], [{ type: 'property' }]).net, 0, 'an asset with no value contributes zero, not NaN');
}

/* ---- 8. the mirror regression: a house must not vanish either ----
   Net worth counted the bond in full and the house it bought not at all,
   which is not a conservative estimate — it is the wrong sign. */
{
  const accounts = [acct('checking', 40000)];
  const debts = [debt('home loan', 850000)];

  const without = worth(accounts, debts);
  eq(without.net, -810000, 'the bond alone drags net worth deep negative');

  const with_ = worth(accounts, debts, [asset('property', 15000000)]);
  eq(with_.ownedAssets, 15000000, 'the house is counted');
  eq(with_.ownedAccounts, 40000, 'separately from the bank money');
  eq(with_.assets, 15040000, 'and both make up what is owned');
  eq(with_.liabilities, 850000, 'the bond is untouched — an asset never nets off a debt');
  eq(with_.net, 14190000, 'so the household reads as solvent, which it is');
}

/* ---- 9. the three example assets, added one at a time ---- */
{
  const house = asset('property', 15000000);
  const car = asset('vehicle', 70000);
  const rings = asset('jewellery', 60000);
  eq(assetTotal([house, car, rings]), 15130000, 'the asset page totals its own rows');
  eq(assetTotal([]), 0, 'an empty asset page is worth nothing');
  eq(assetTotal(undefined), 0, 'a vault with no Assets.md behaves as empty');
  eq(worth([], [], [house, car, rings]).net, 15130000,
    'with no accounts and no debts, net worth is exactly what is owned');
}

/* ---- 10. a negative value is a typo, not a liability ----
   Same treatment as a negative debt-page balance: ignored rather than netted
   off, where it would quietly shrink a real total without saying so. */
{
  const w = worth([], [], [asset('vehicle', -5000), asset('property', 2000000)]);
  eq(w.ownedAssets, 2000000, 'the negative row is ignored, not subtracted');
  eq(w.net, 2000000, 'so it cannot reduce what is owned');
}

/* ---- 11. chart grouping on the owned side ---- */
{
  const g = assetsByType([
    asset('vehicle', 70000), asset('property', 15000000),
    asset('vehicle', 180000), asset('collectibles', 0),
    asset('electronics', -100),
    { value: 5000 },
  ]);
  eq(g.length, 3, 'zero, negative and duplicate kinds collapse or drop');
  eq(g[0], { type: 'property', amount: 15000000 }, 'largest first');
  eq(g[1], { type: 'vehicle', amount: 250000 }, 'same kind sums');
  eq(g[2], { type: 'other', amount: 5000 }, 'a missing kind is named rather than left empty');
  eq(assetsByType(undefined), [], 'no asset page groups to nothing');
}

/* ---- 12. DEFECT 3: net worth reads cents, not a raw float difference ----
   Assets and debts that are exactly break-even on paper leave a sub-cent
   float remainder behind (50.30 - 10.10 - 40.20 = -7.1e-15 in IEEE 754).
   `fromAccounts` above already collapses this class of artefact with
   `|| 0` for a literal -0; `net` never got the same treatment, so a
   household at exactly zero net worth was told it is in the red and shown
   "-R0.00". */
{
  const w = worth([], [debt('other', 10.10), debt('other', 40.20)], [asset('cash', 50.30)]);
  ok(Math.abs(w.liabilities - 50.30) < 1e-6, 'the float remainder is sub-cent, as measured');
  eq(w.net, 0, 'break-even to the cent must not read as negative off a -7.1e-15 float artefact');
  ok(!Object.is(w.net, -0), 'and must never be the literal -0 that renders as "-R0.00" either');
}

/* ---- 13. worth() names the currencies it summed over ---------------------
   Net worth adds account balances regardless of what currency an account
   states (currency.js converts nothing) — currenciesIn() already discloses
   this on the Accounts page (views/accounts.js:589), and worth() is the other
   place that sums across it, on the two surfaces that headline the total
   (Dashboard, Savings). This pins that worth() hands a caller the same
   disclosure rather than silently adding "$" into an "R" total with nothing
   to say so. Walks ACCOUNTS only — assets carry no currency field. */
{
  const single = worth([acct('savings', 1000)], [], []);
  eq(single.currencies, ['R'], 'one currency, default household symbol, nothing to disclose');

  const named = worth([acct('savings', 1000)], [], [], '$');
  eq(named.currencies, ['$'], 'the household symbol is threaded through when supplied');

  const mixed = worth([acct('cheque', 50000), { type: 'savings', balance: 20000, currency: '€' }], [], [], 'R');
  eq(mixed.currencies, ['R', '€'], 'a foreign-currency account is named, household first');
  eq(mixed.net, 70000, 'and the arithmetic is unchanged — still added, just now disclosed');

  eq(worth([], [], []).currencies, [], 'no accounts, nothing to disclose');
}

console.log(`worth.test.cjs — ${checks} checks OK`);
