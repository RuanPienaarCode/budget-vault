'use strict';
/* table-schema.js — the one declaration per table (docs/adr/0003).

   The expected strings below are LITERALS lifted from the shipped file format
   — the exact bytes 1.17.5's serializers write and its loader reads, which is
   what user vaults contain. They are deliberately not derived by calling the
   engine: if a declaration drifts from what is on disk in the wild, this file
   must go red.

   Runs in bare node — table-schema.js is pure (markdown.js/amount.js layer).
     node tests/table-schema.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { SCHEMAS, headerLines, rowLine, rowToObject, mdTableFile } = require('../src/table-schema');

/* ---------------- assets: the pilot entity ---------------- */

const A = SCHEMAS.assets;

eq(headerLines(A), [
  '| Item | Kind | Value | Valued | Notes |',
  '|------|------|------:|--------|-------|',
], 'assets header + separator must be byte-identical to what serializeAssets ships');

/* Cells arrive as parseMdTable yields them: still carrying their \| escapes.
   The read side unescapes; the write side re-escapes. */
eq(rowToObject(A, ['The house \\| Gardens', 'property', '15 000 000', '2026-03-01', 'bonded \\| see Debts']),
  { name: 'The house | Gardens', type: 'property', value: 15000000, valued: '2026-03-01', notes: 'bonded | see Debts' },
  'a space-grouped value must be READ, not truncated to 15 — same rule as the loader today');

eq(rowToObject(A, ['Nameplate only']),
  { name: 'Nameplate only', type: 'other', value: 0, valued: '', notes: '' },
  'a row with nothing but a name loads with every documented default');

eq(rowLine(A, { name: 'The house | Gardens', type: 'property', value: 15000000, valued: '2026-03-01', notes: 'bonded | see Debts' }),
  '| The house \\| Gardens | property | 15000000.00 | 2026-03-01 | bonded \\| see Debts |',
  'the write side re-escapes and writes value as toFixed(2), byte-identical to serializeAssets');

/* ---------------- owed ---------------- */

const O = SCHEMAS.owed;

eq(headerLines(O), [
  '| Person | Amount | Description | Due date | Status | Repaid | Lent |',
  '|--------|-------:|-------------|----------|--------|-------:|------|',
], 'owed header + separator, byte-identical to serializeOwed');

eq(rowToObject(O, ['Thabo', '1 500,00', 'space-grouped \\| comma decimal', '2026-09-01', 'outstanding']),
  { person: 'Thabo', amount: 1500, description: 'space-grouped | comma decimal', due: '2026-09-01', status: 'outstanding', repaid: 0, lent: '' },
  'a space-grouped amount is READ, and the additive columns 5-6 default when absent');

eq(rowToObject(O, ['Nadia', 'R4000', 'currency prefix', '', 'outstanding', '1 000,00']),
  { person: 'Nadia', amount: 4000, description: 'currency prefix', due: '', status: 'outstanding', repaid: 1000, lent: '' },
  'a currency prefix reads as the figure, repaid reads through the same strict parser');

eq(rowToObject(O, ['Léa', '40.00', 'multi<br>line', '', ' PAID ']).status, 'paid',
  'status folds case and trims, exactly as the loader does today');

eq(rowLine(O, { person: 'Sam | Pete', amount: 250, description: 'lunch | coffee', due: '2026-08-01', status: 'outstanding', repaid: 0, lent: '' }),
  '| Sam \\| Pete | 250.00 | lunch \\| coffee | 2026-08-01 | outstanding | 0.00 |  |',
  'the owed write side, byte-identical to serializeOwed');

eq(rowLine(O, { person: 'X', amount: 1, description: '', due: '', status: 'paid' }),
  '| X | 1.00 |  |  | paid | 0.00 |  |',
  'a row created before repaid/lent existed still writes — the || 0 guard survives the schema');

/* ---------------- services ---------------- */

const V = SCHEMAS.services;

eq(headerLines(V), [
  '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |',
  '|------|----------|-------:|-------|--------------|----------|--------|-------|',
], 'services header + separator, byte-identical to serializeServices');

eq(rowToObject(V, ['Netflix \\| HD', 'Netflix', '199.00', 'monthly', '2026-08-05', 'Groceries', 'yes', 'family \\| plan']),
  { name: 'Netflix | HD', provider: 'Netflix', amount: 199, cycle: 'monthly', next: '2026-08-05', category: 'Groceries', active: true, notes: 'family | plan' },
  'a full services row reads exactly as the loader reads it today');

eq(rowToObject(V, ['Domain']),
  { name: 'Domain', provider: '', amount: 0, cycle: 'monthly', next: '', category: '', active: true, notes: '' },
  'a name-only row gets every documented default: monthly, active, zero');

eq(rowToObject(V, ['X', '', '0', 'ANNUAL ', '', '', ' NO ']),
  { name: 'X', provider: '', amount: 0, cycle: 'annual', next: '', category: '', active: false, notes: '' },
  'cycle and active fold case and trim');

eq(rowLine(V, { name: 'Netflix | HD', provider: 'Netflix', amount: 199, cycle: 'monthly', next: '2026-08-05', category: 'Groceries', active: true, notes: 'family | plan' }),
  '| Netflix \\| HD | Netflix | 199.00 | monthly | 2026-08-05 | Groceries | yes | family \\| plan |',
  'the services write side, byte-identical to serializeServices');

/* ---------------- debts ---------------- */

const D = SCHEMAS.debts;

eq(headerLines(D), [
  '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |',
  '|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|',
], 'debts header + separator — the twelve-column cautionary tale, byte-identical');

eq(rowToObject(D, ['Visa \\| Gold', 'Bank \\| A', 'credit card', '8000.00', '12000.00', '22.50', '400.00', '150.00', '2024-03-01', 'Groceries', 'active', 'revolving \\| card']),
  { name: 'Visa | Gold', lender: 'Bank | A', type: 'credit card', balance: 8000, original: 12000, rate: 22.5, payment: 400, extra: 150, start: '2024-03-01', category: 'Groceries', status: 'active', notes: 'revolving | card' },
  'a full debts row reads exactly as the loader reads it today');

/* Absent-or-empty Original is null from the schema; load.js's post() step
   fills it from balance. The schema cannot see a sibling column — that is
   the ADR's post-hook boundary, kept visible in the loader. */
eq(rowToObject(D, ['Car', 'WesBank', 'vehicle', '1 234,56']),
  { name: 'Car', lender: 'WesBank', type: 'vehicle', balance: 1234.56, original: null, rate: 0, payment: 0, extra: 0, start: '', category: '', status: 'active', notes: '' },
  'a short row: strict-parsed balance, null original awaiting post(), every later default');

eq(rowToObject(D, ['X', '', '', '10', '', '0', '0', '0', '', '', ' PAID ']).status, 'paid',
  'an empty Original cell is also null-for-post, and status folds case');

eq(rowLine(D, { name: 'Visa | Gold', lender: 'Bank | A', type: 'credit card', balance: 8000, original: 12000, rate: 22.5, payment: 400, extra: 150, start: '2024-03-01', category: 'Groceries', status: 'active', notes: 'revolving | card' }),
  '| Visa \\| Gold | Bank \\| A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | Groceries | active | revolving \\| card |',
  'the debts write side, byte-identical to serializeDebts');

/* ---------------- transactions ---------------- */

const T = SCHEMAS.transactions;

eq(headerLines(T), [
  '| Date | Description | Category | Amount | Excluded | Note | Split |',
  '|------|-------------|----------|-------:|----------|------|-------|',
], 'the seven-column transactions header; serializeTxFile slices to six when no split');

eq(headerLines({ ...T, columns: T.columns.slice(0, 6) }), [
  '| Date | Description | Category | Amount | Excluded | Note |',
  '|------|-------------|----------|-------:|----------|------|',
], 'the six-column shape a never-split file keeps forever');

eq(rowToObject(T, ['2026-07-02', 'PnP \\| Sandton', 'Groceries', '-1000.00', 'yes', 'split \\| two cards']),
  { date: '2026-07-02', desc: 'PnP | Sandton', cat: 'Groceries', amount: -1000, amountRaw: null,
    excluded: true, note: 'split | two cards', split: '' },
  'a six-column row: a word in a note has never meant a role');

eq(rowToObject(T, ['2026-07-04', 'Legacy cell', 'Groceries', '1 234,56', '', '']),
  { date: '2026-07-04', desc: 'Legacy cell', cat: 'Groceries', amount: 1234.56, amountRaw: '1 234,56',
    excluded: false, note: '', split: '' },
  'a hand-grouped amount is READ for arithmetic but keeps its raw for verbatim write-back');

/* One cell, two fields: the partial-object read is the reason reads return
   partials at all. A cell parseNum rejects keeps its verbatim raw for
   write-back, exactly as the loader does today. */
const rejected = rowToObject(T, ['2026-07-05', 'x', '', 'not-a-number', '', '']);
eq([rejected.amount, rejected.amountRaw], [0, 'not-a-number'],
  'a rejected amount keeps its raw cell for verbatim write-back');

eq(rowToObject(T, ['2026-08-07', 'Checkers Hyper', 'Groceries', '-1000.00', 'yes', 'Split into 3', 'parent']).split, 'parent',
  'the seventh column reads through splitRole, the single door');

eq(rowLine(T, { date: '2026-08-07', desc: 'Checkers Hyper', cat: 'Groceries', amount: -1000, amountRaw: null, excluded: true, note: 'Split into 3', split: 'parent' }),
  '| 2026-08-07 | Checkers Hyper | Groceries | -1000.00 | yes | Split into 3 | parent |',
  'the transactions write side, byte-identical to serializeTxFile');

eq(rowLine({ ...T, columns: T.columns.slice(0, 6) },
  { date: '2026-07-04', desc: 'Legacy cell', cat: 'Groceries', amount: 1234.56, amountRaw: '1 234,56', excluded: false, note: '' }),
  '| 2026-07-04 | Legacy cell | Groceries | 1 234,56 |  |  |',
  'an unparseable amount writes back verbatim rather than corrupting the cell');

/* ---------------- mdTableFile: the whole document for the four flat files —

   frontmatter preserved verbatim, the kind: fallback in ONE place instead of
   four, prose owned by the view, table generated. The expected string is the
   byte shape serializeAssets ships today. */

eq(mdTableFile({
  fm: 'kind: assets\naliases: [possessions]',
  fallback: 'kind: assets',
  title: 'Assets',
  prose: ['First prose line.', 'Second prose line.'],
  schema: A,
  rows: [{ name: 'Corolla', type: 'vehicle', value: 70000, valued: 'when we bought it', notes: 'non-ISO date' }],
}), [
  '---',
  'kind: assets',
  'aliases: [possessions]',
  '---',
  '',
  '# Assets',
  '',
  'First prose line.',
  'Second prose line.',
  '',
  '| Item | Kind | Value | Valued | Notes |',
  '|------|------|------:|--------|-------|',
  '| Corolla | vehicle | 70000.00 | when we bought it | non-ISO date |',
  '',
].join('\n'), 'mdTableFile reproduces the shipped document shape byte for byte');

eq(mdTableFile({ fm: '', fallback: 'kind: assets', title: 'Assets', prose: ['P.'], schema: A, rows: [] }).split('\n')[1],
  'kind: assets',
  'an absent frontmatter falls back to the one kind: line — declared once, not four times');

console.log(`table-schema.test.cjs — ${checks} checks OK`);
