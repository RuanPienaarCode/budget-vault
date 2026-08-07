'use strict';
/* Counterparty detection — "is this row me paying myself?"

   Without it, every transfer from a savings account to the cheque account next
   door imports as income, and the Dashboard reports a month in which the
   household earned its own savings.

   The reason this is a guard test rather than a spot-check: the failure mode of
   a LOOSE match is silent and expensive. A row wrongly tagged as a transfer
   arrives pre-excluded, which removes it from income and spend totals — so an
   over-eager rule quietly deletes real income, and the reader finds out weeks
   later from a budget that doesn't add up. Every case below is a way the match
   could be made loose.

   counterpartyAccount is pure, but util.js imports `obsidian` for setIcon, so
   this uses the shared stub.

     node tests/import-transfers.test.cjs
*/

const assert = require('assert');
require('./helpers/harness.cjs').stubObsidian();
const { counterpartyAccount } = require('../src/util');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const ACCOUNTS = [
  { name: 'Transaction Account', account_number: '1122334455', tx_label: '' },
  { name: 'Emergency Fund', account_number: '9876543210', tx_label: 'Emergency Fund' },
  { name: 'Credit Card', account_number: '', tx_label: '' },          // no number on file
  { name: 'Baby Fund', account_number: '4501', tx_label: '' },
];
const hit = (desc, self) => counterpartyAccount(desc, ACCOUNTS, self);

/* ---- 1. the case it exists for ---- */
{
  const a = hit('IB TRANSFER TO 9876543210', 'Transaction Account');
  ok(a, 'a description naming another account matches');
  eq(a.name, 'Emergency Fund', 'and resolves to that account');

  ok(hit('TRF FROM 1122334455', 'Emergency Fund'), 'and in the other direction');
  ok(hit('Payment 4501 baby', 'Transaction Account'), 'a shorter number still matches exactly');
}

/* ---- 2. the statement's OWN account is not a counterparty ----
   Statements routinely quote their own number in their rows. Matching those
   would pre-exclude an entire import. */
{
  ok(!hit('IB TRANSFER FROM 1122334455', 'Transaction Account'),
    'the account being imported into is skipped');
  ok(!hit('9876543210 interest', 'Emergency Fund'), 'matched on tx_label too');
  ok(hit('IB TRANSFER FROM 1122334455', ''),
    'with no detected account, nothing is self — the reader still sees the badge');
}

/* ---- 3. exact on the digits — the whole point ---- */
{
  ok(!hit('REF 11223344550 payment', 'x'), 'a longer run is a DIFFERENT account, not a match');
  ok(!hit('REF 112233445 payment', 'x'), 'and so is a shorter one');
  ok(!hit('POS 4455 GROCER', 'x'), 'a tail fragment of an account number does not match');
  ok(!hit('Card 1234 purchase', 'x'), 'an unrelated four-digit run does not match');
}

/* ---- 4. rows with nothing to match are untouched ---- */
{
  eq(hit('WOOLWORTHS CAPE TOWN', 'x'), null, 'no digits, no match');
  eq(hit('Interest Earned at 4.25%', 'x'), null, 'a rate is not an account number');
  eq(hit('', 'x'), null, 'blank description');
  eq(hit(undefined, 'x'), null, 'missing description');
  eq(counterpartyAccount('TRF 9876543210', [], 'x'), null, 'no accounts, no match');
  eq(counterpartyAccount('TRF 9876543210', undefined, 'x'), null, 'missing accounts');
}

/* ---- 5. an account with no number on file can never match ----
   Blank must not behave as a wildcard — that would tag every row. */
{
  eq(hit('POS 0000 SOMETHING', 'x'), null, 'a blank account_number matches nothing');
  const withBlank = counterpartyAccount('anything at all', [{ name: 'X', account_number: '' }], 'y');
  eq(withBlank, null, 'not even a description with no digits');
}

/* ---- 6. short runs are ignored entirely ----
   Three digits collide with cent amounts, dates and card fragments. */
{
  const shortAcct = [{ name: 'Tiny', account_number: '123' }];
  eq(counterpartyAccount('PAYMENT 123', shortAcct, 'x'), null,
    'a 3-digit account number is below the floor and never matches');
}

console.log(`import-transfers.test.cjs — ${checks} checks OK`);
