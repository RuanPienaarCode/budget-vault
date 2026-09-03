'use strict';
/* The four ledgers that could not record a currency at all.

   Until now only ACCOUNTS carried `currency:`. Debts, Assets, Owed Money and
   Services did not, so a euro mortgage, a flat in Lisbon, a loan to a
   relative abroad and a dollar-billed subscription all had to be typed as
   though they were in the household's currency — and then every total, ratio
   and payoff schedule built on them was quietly wrong, with no way for the
   reader to say otherwise. Frontmatter hand-written into those files survived
   every round-trip and was read by nothing, which looks like it took.

   `currency` is APPENDED to all four (ADR-0003 permits append and nothing
   else). Two properties matter and both are pinned here:

     1. NO CHURN. Blank means the household's currency, which is what every
        file already on disk says by saying nothing — and the column is not
        even written until some row uses it, so a single-currency vault's
        files are byte-for-byte what they were.
     2. NO SILENT ARITHMETIC. A stated foreign figure is never added into a
        household total and never dropped: it comes back to be named.

     node tests/ledger-currencies.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { SCHEMAS, mdTableFile, usedColumns, rowToObject } = require('../src/table-schema');
const { worth, assetTotal, foreignTotals } = require('../src/worth');
const { owedSummary } = require('../src/owed-math');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const LEDGERS = ['assets', 'owed', 'services', 'debts'];

/* ---- 1. every one of the four can now state a currency ---- */
{
  for (const name of LEDGERS) {
    const keys = SCHEMAS[name].columns.map(c => c.key);
    ok(keys.includes('currency'), `${name} can record a currency`);
    eq(keys[keys.length - 1], 'currency',
      `${name}: and it is the LAST column — ADR-0003 allows appending and nothing else, because every file on disk is parsed positionally`);
  }

  /* Transactions deliberately did NOT get one: a transaction's currency is a
     property of the account whose folder it lives in, so a column here would
     be a second place to state one fact and the two could disagree row by
     row. */
  ok(!SCHEMAS.transactions.columns.some(c => c.key === 'currency'),
    'transactions did NOT get a currency column — its account already answers that, and two sources for one fact is the bug this repo keeps re-finding');
}

/* ---- 2. a file written before the column existed still reads ---- */
{
  // Exactly what an old Assets.md row looks like: short by one cell.
  eq(rowToObject(SCHEMAS.assets, ['House', 'property', '1000.00', '2026-01-01', '']).currency, '',
    'a row with no Currency cell reads as blank — i.e. the household currency, which is what it always meant');
  eq(rowToObject(SCHEMAS.debts, ['Bond', 'Bank', 'home loan', '900000.00']).currency, '',
    'and so does a badly truncated one');
}

/* ---- 3. NO CHURN: the column is not written until it is used ---- */
{
  const file = rows => mdTableFile({
    fm: 'kind: assets', fallback: '', title: 'Assets', prose: [], schema: SCHEMAS.assets, rows,
  });
  const plain = { name: 'House', type: 'property', value: 1000, valued: '2026-01-01', notes: '', currency: '' };
  const foreign = { name: 'Lisbon flat', type: 'property', value: 250000, valued: '2026-01-01', notes: '', currency: '€' };

  ok(!file([plain]).includes('Currency'),
    'a vault where nothing states a currency gets the exact file it has always had — no column, no rewrite, no iCloud churn on upgrade');
  ok(file([plain, foreign]).includes('| Item | Kind | Value | Valued | Notes | Currency |'),
    'and one that does state a currency gets the column');
  ok(file([plain, foreign]).includes('| Lisbon flat | property | 250000.00 | 2026-01-01 |  | € |'),
    'with the symbol in its own cell, verbatim');

  /* Only TRAILING unused columns are dropped — an empty cell in the middle is
     a real value (a blank Category means "no category") and the parser is
     positional, so its position must survive. */
  const noNotes = [{ ...plain, notes: '', currency: '€' }];
  ok(file(noNotes).includes('| Notes | Currency |'),
    'an empty column BEFORE a used one keeps its place — dropping it would shear every later value into the wrong field');
}

/* ---- 4. NO SILENT ARITHMETIC ---- */
{
  const assets = [{ name: 'House', value: 1500000 }, { name: 'Lisbon flat', value: 250000, currency: '€' }];
  const debts = [{ name: 'Bond', balance: 900000, status: 'active' },
    { name: 'EU loan', balance: 100000, status: 'active', currency: '€' }];
  const accounts = [{ balance: 20000 }];

  eq(assetTotal(assets, 'R'), 1500000, 'the asset total is the rand assets alone');
  eq(assetTotal(assets), 1750000,
    'and with NO household symbol it adds everything — exactly as it always did, so every caller not yet taught about currencies is unchanged');
  eq(foreignTotals(assets, 'R', 'value'), [['€', 250000]], 'what it held out is named, in its own symbol');

  /* ISSUE 39 added a THIRD owned ledger, and it takes the same rule: a euro
     loan out to a relative is held out of the rand total and named beside it,
     never converted. Passed here so the case is exercised rather than assumed
     — an `owed` argument left off would have tested the empty list. */
  const owed = [{ person: 'Thabo', amount: 2000, status: 'outstanding' },
    { person: 'Elena', amount: 500, status: 'outstanding', currency: '€' }];
  const w = worth(accounts, debts, assets, 'R', owed);
  eq(w.assets, 1522000, 'net worth counts R20 000 cash + the R1.5m house + the R2 000 lent, and NOT the €250k flat or the €500 loan');
  eq(w.ownedOwed, 2000, 'the receivable half is the rand loan alone');
  eq(w.liabilities, 900000, 'liabilities count the bond and NOT the euro loan');
  eq(w.otherCurrencies, { assets: [['€', 250000]], debts: [['€', 100000]], owed: [['€', 500]] },
    'and ALL THREE are handed back per ledger, so no page can drop them quietly');

  /* The three-argument contract is untouched: no `owed` means "this surface is
     not about receivables", which is what views/accounts.js's hero says. */
  eq(worth(accounts, debts, assets, 'R').assets, 1520000,
    'and a caller that passes no owed list gets exactly the total it always got');

  const blind = worth(accounts, debts, assets);
  eq([blind.assets, blind.liabilities], [1770000, 1000000],
    'without a household symbol nothing is held out — the old behaviour, byte for byte');
}

/* ---- 5. money owed, same rule ---- */
{
  const ledger = [
    { person: 'Sam', amount: 500, repaid: 0, status: 'outstanding' },
    { person: 'Pierre', amount: 300, repaid: 0, status: 'outstanding', currency: '€' },
  ];
  const s = owedSummary(ledger, '2026-07-01', 'R');
  eq(s.outstanding, 500, 'a euro loan is not added into a rand outstanding figure');
  eq(s.otherCurrencies, [['€', 300]], 'it is stated separately instead');
  eq(s.entries, 2, 'and it is still one of the entries — held out of a total is not removed from the ledger');
}

console.log(`PASS — four ledgers can state a currency: appended, unwritten until used, never silently summed (${checks} checks).`);
