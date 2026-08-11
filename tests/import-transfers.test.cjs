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

   counterpartyAccount is pure, and since the util.js split it lives in a pure
   statement.js — the stub below is kept only for the other modules pulled in, so
   this uses the shared stub.

     node tests/import-transfers.test.cjs
*/

const assert = require('assert');
require('./helpers/harness.cjs').stubObsidian();
const { counterpartyAccount, applyCounterparties } = require('../src/statement');

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

/* ---- 7. the suggestion has to follow the account the statement is believed
   to belong to ----

   counterpartyAccount can only skip the statement's OWN account if it is told
   which one that is, and the import view learns that in two steps: it guesses
   from the filename and preamble first, and only later does the review screen
   settle on a label — from the user's pick, from a newly created account, or
   from the plain default of the first one in the list when the guess came back
   empty.

   So the guess being empty is not an edge case, it is every hand-saved or
   renamed export. With selfLabel '' the self-skip is falsy and never fires,
   and every row quoting the statement's own account number matches ITSELF and
   arrives pre-excluded — which is the one outcome statement.js's own comment
   says the skip exists to prevent, because `excluded` is written to disk and
   periodSummary vetoes those rows from income and spend for good.

   The suggestion therefore cannot be computed once. It has to be recomputed
   whenever the believed account changes — while never overwriting a row the
   reader has already decided on, the way nearAuto and `manual` already protect
   the import tick and the category. */
{
  const rows = () => ([
    { desc: 'IB TRANSFER FROM 1122334455', excluded: false, transferTo: '' },
    { desc: 'IB TRANSFER TO 9876543210', excluded: false, transferTo: '' },
    { desc: 'SALARY ACME PAYROLL', excluded: false, transferTo: '' },
  ]);

  // Detection failed: selfLabel is ''. This is the state runImport builds in.
  const guessed = applyCounterparties(rows(), ACCOUNTS, '');
  eq(guessed[0].excluded, true,
    'with no known self, a row naming the statement’s own account matches itself');

  // The review screen settles on the real account — by pick, by new account, or
  // by the default at import.js:337. The suggestion must follow it.
  const settled = applyCounterparties(guessed, ACCOUNTS, 'Transaction Account');
  eq(settled[0].excluded, false,
    'once the account is known, a row naming it is the statement’s own and not a transfer');
  eq(settled[0].transferTo, '', 'and its "transfer" badge goes with it');
  eq(settled[1].excluded, true, 'a row naming a DIFFERENT account is still a transfer');
  eq(settled[1].transferTo, 'Emergency Fund', 'and still says which one');
  eq(settled[2].excluded, false, 'ordinary income is untouched throughout');

  // Idempotent: renderImportReview runs on every account switch and every
  // "show more", so a second pass at the same label must change nothing.
  const again = applyCounterparties(settled, ACCOUNTS, 'Transaction Account');
  eq(again.map(r => r.excluded), [false, true, false],
    're-rendering at the same account changes nothing');

  // A decision the reader has made outranks the suggestion, in both directions.
  const held = applyCounterparties(
    [{ desc: 'IB TRANSFER TO 9876543210', excluded: false, transferTo: '', manualExclude: true },
     { desc: 'SALARY ACME PAYROLL', excluded: true, transferTo: '', manualExclude: true }],
    ACCOUNTS, 'Transaction Account');
  eq(held[0].excluded, false, 'a transfer the reader un-excluded stays un-excluded');
  eq(held[1].excluded, true, 'and a row the reader excluded by hand stays excluded');
}

console.log(`import-transfers.test.cjs — ${checks} checks OK`);
