'use strict';
/* ISSUE 95. A column heading names a ROLE, and two roles cannot share a column.

   #77 fixed the balance half of this rule. These are the two that outrank it,
   because they use headings real banks actually ship — and because the reader
   is told the import went well.

   1. `Debit Amount` / `Credit Amount`. DEBIT_COLS matches "debit amount"
      exactly; AMOUNT_COLS does not, so iAmount falls to its substring match and
      lands on the SAME column. views/import.js reads iAmount first and
      UNNEGATED, so the debit cell is taken as a signed amount:

        Date,Narrative,Debit Amount,Credit Amount,Balance
        imported: 9750, 900, 45        truth: +9750, -900, -45

      Every expense booked as INCOME — the spending gone from the budget and the
      income inflated by the same rand. And `reconcileAmounts` then CONFIRMS the
      reading, because the file genuinely reconciles under flip:true, so the
      reader gets "Amounts check out against this statement's own balance
      column" over the top of it. Wrong sign, maximum reassurance.

   2. `Withdrawal Amount` / `Deposit Amount`. DEBIT_COLS carries "withdrawal"
      but not "withdrawal amount", and the old fallback tested the single word
      `includes('debit')`, which is false for it. No pair resolved at all;
      iAmount grabbed the withdrawal column and the deposit column was never
      read — the salary VANISHED and the expenses booked as income.

   3. No balance column at all: the verdict banner HID rather than saying the
      check could not be made. The one file the importer cannot verify was the
      one file that said nothing about it.

   The remedies, and why each is that one:

     - the debit/credit fallback searches the whole vocabulary as substrings,
       not one word, so every alias already listed works the way "amount (eur)"
       already did.
     - where the generic amount collides with the pair, the PAIR wins. It is
       the stronger claim: two columns whose headings name their directions,
       against one substring match on a word appearing in both. Dropping
       iAmount is safe because the pair is complete — the credit branch honours
       the cell's own sign, the debit branch negates, which is how a bare
       Debit/Credit file has always been read.
     - a verdict that cannot be reached is stated, not hidden.

     node tests/import-column-roles.test.cjs
*/

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { detectStatementColumns } = require('../src/statement');
const { normalizeAmount } = require('../src/amount');
const { parseCsv } = require('../src/csv');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* views/import.js:236-249 in shape: iAmount first and UNNEGATED, then credit
   honouring its own sign, then debit negated. Mirrored rather than driven
   because the defect IS the map, and the map is what this file is about — the
   end-to-end path is covered by tests/import-column-overlap-guard.test.cjs. */
const num = v => normalizeAmount(v);
const amountOf = (r, m) => {
  let a = m.iAmount !== -1 ? num(r[m.iAmount]) : null;
  if (a == null && m.iCredit !== -1) { const c = num(r[m.iCredit]); if (c != null && c !== 0) a = c; }
  if (a == null && m.iDebit !== -1) { const d = num(r[m.iDebit]); if (d != null && d !== 0) a = -Math.abs(d); }
  return a;
};
const readCsv = csv => {
  const rows = parseCsv(csv);
  const map = detectStatementColumns(rows);
  if (!map) return { map: null, amounts: [] };
  const head = rows.findIndex(r => r.some(c => /date/i.test(c)));
  const body = rows.slice(head + 1).filter(r => r.length > 1);
  return { map, amounts: body.map(r => amountOf(r, map)) };
};

const BODY = [
  '2026-01-01,Salary,,9750.00,9750.00',
  '2026-01-02,Groceries,900.00,,8850.00',
  '2026-01-03,Coffee,45.00,,8805.00',
].join('\n');
const TRUTH = [9750, -900, -45];

/* ---- 1: Debit Amount / Credit Amount ---------------------------------- */
{
  const { map, amounts } = readCsv(`Date,Narrative,Debit Amount,Credit Amount,Balance\n${BODY}`);
  ok(map, 'the file still auto-detects — the fix must not send an ordinary statement to the mapper');
  eq(map.iAmount, -1, 'the generic amount steps aside for the pair that named its own directions');
  eq([map.iDebit, map.iCredit], [2, 3], 'and the pair holds the columns its headings name');
  eq(amounts, TRUTH, 'so an expense is an expense — not income wearing the amount column');
}

/* ---- 2: Withdrawal Amount / Deposit Amount ---------------------------- */
{
  const { map, amounts } = readCsv(`Date,Narrative,Withdrawal Amount,Deposit Amount,Balance\n${BODY}`);
  ok(map, 'this one auto-detects too');
  eq([map.iDebit, map.iCredit], [2, 3],
    'the pair resolves through the vocabulary as substrings — "withdrawal" inside "withdrawal amount"');
  eq(amounts, TRUTH, 'the salary is no longer dropped, and the expenses are no longer income');
}

/* ---- 3: the aliases already listed keep working as substrings --------- */
for (const [d, c] of [['Money Out Amount', 'Money In Amount'], ['Paid Out (ZAR)', 'Paid In (ZAR)'],
  ['Debits', 'Credits'], ['Debit (IDR)', 'Credit (IDR)']]) {
  const { map, amounts } = readCsv(`Date,Narrative,${d},${c},Balance\n${BODY}`);
  ok(map, `${d}/${c} auto-detects`);
  eq(amounts, TRUTH, `${d}/${c} reads the right signs`);
}

/* ---- 4: NEGATIVE CONTROLS — a lone amount column is still an amount --- */
{
  const { map, amounts } = readCsv([
    'Date,Description,Amount,Balance',
    '2026-01-01,Salary,9750.00,9750.00',
    '2026-01-02,Groceries,-900.00,8850.00',
  ].join('\n'));
  eq(map.iAmount, 2, 'a signed amount column with no pair beside it keeps the amount role');
  eq([map.iDebit, map.iCredit], [-1, -1], 'and no pair is invented for it');
  eq(amounts, [9750, -900], 'its own signs are honoured, untouched by this fix');
}
{
  /* The case the collision rule must NOT swallow: an amount column that is a
     genuinely different column from the pair. Nothing collides, so nothing
     steps aside. */
  const { map } = readCsv([
    'Date,Description,Amount,Debit,Credit,Balance',
    '2026-01-01,Salary,9750.00,,9750.00,9750.00',
  ].join('\n'));
  eq(map.iAmount, 2, 'a distinct amount column keeps its role when the pair sits elsewhere');
  eq([map.iDebit, map.iCredit], [3, 4], 'and the pair keeps its own columns');
}
{
  const { map } = readCsv([
    'Date,Description,Fee Amount,Amount,Balance',
    '2026-01-01,Bank charge,0.35,-0.35,9749.65',
  ].join('\n'));
  eq(map.iAmount, 3, 'a real Amount column beside a Fee Amount is still the amount');
  ok(map.iFee === 2 || map.iFee === -1, 'and the fee is either its own column or dropped, never the amount');
}

/* ---- 5: the balance rule from #77 is unchanged ------------------------ */
eq(detectStatementColumns(parseCsv('Transaction Date,Narrative,Debits,Credit Balance\n2026-01-01,x,1,2')), null,
  'a balance column that is also the credit column still asks the reader (#77)');

console.log(`PASS — a column heading names one role, and the pair beats a substring (${checks} checks).`);
