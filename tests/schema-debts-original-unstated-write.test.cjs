'use strict';
/* A debts row whose `original` is null must SERIALIZE, not take the file down.

   src/table-schema.js's debts `original` column is the one column in this repo
   that distinguishes "not stated" from "stated as nothing": its read returns
   `{ original: null }` for an absent-or-empty cell, and the comment beside it
   calls that a legitimate state — load.js's post() is what turns it into a
   number so the payoff maths has a divisor. The WRITE side did not reverse it.
   It ended `r.original.toFixed(2)`, so a row still holding null (or missing the
   key entirely) threw

     TypeError: Cannot read properties of null (reading 'toFixed')
       at Object.write (src/table-schema.js)
       at rowLine (src/table-schema.js)

   and because rowLine() maps over EVERY column, the throw escaped rowLine and
   then mdTableFile. That is the half that matters: the failure was not one
   wrong cell in an otherwise-written table, it was NO DOCUMENT — no
   frontmatter, no header, and every healthy row in the file lost with it, so
   Debts.md was never written at all. usedColumns() calls the identical write
   inside `catch (e) { return true; }` and survived the same row; rowLine had no
   such guard, which is how a partial write turned into a total data-write
   failure.

   Nothing in the shipped app produces that row today — S.debts is filled in
   exactly two places, load.js's post() (which replaces null with the balance)
   and views/debts.js's addDebt() (which seeds it from the balance when the
   field is left blank) — so this is a latent partiality, not a live crash.
   That is precisely why it needs a test rather than a comment: the reach is
   one new writer wide, the read side already mints the state, and the symptom
   when it does arrive is a silent refusal to save the whole file.

   The other half of the contract is that a row which was ALREADY fine writes
   the same bytes it always did. tests/golden-tables.test.cjs byte-compares
   five entities against 1.17.5 and these files live in user vaults under iCloud
   sync, so a format change here rewrites every Debts.md on the planet on
   upgrade. Every branch of the write that existed before is pinned below, the
   1.17.5-era row literal included.

   Pure node — table-schema.js is the markdown.js/amount.js layer.
     node tests/schema-debts-original-unstated-write.test.cjs */

const assert = require('assert');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { SCHEMAS, rowLine, rowToObject, mdTableFile, usedColumns } = require('../src/table-schema');

const D = SCHEMAS.debts;
const cellsOf = line => line.slice(1, -1).split('|').map(c => c.trim());
const ORIGINAL = D.columns.findIndex(c => c.key === 'original');

/* A full, stated row — every column set, nothing derived. The shape the
   loader hands the serializer after post() has run. */
const STATED = {
  name: 'Car loan', lender: 'WesBank', type: 'vehicle', balance: 100000, original: 150000,
  rate: 11.5, payment: 3200, extra: 0, start: '2024-01-01', category: 'Vehicle',
  status: 'active', notes: '', currency: '',
};

/* ---------------- 1. the defect: null and absent must not throw ------------ */

/* Not "does not throw" in the abstract — these are the exact two shapes the
   read produces. A cell of '' and a cell past the end of a short row both
   yield null, and a row built by hand simply never sets the key. */
eq(rowToObject(D, ['Car', 'WesBank', 'vehicle', '100000.00', '']).original, null,
  'an EMPTY Original cell still reads as null — the state this write must reverse');
eq(rowToObject(D, ['Car', 'WesBank', 'vehicle', '100000.00']).original, null,
  'an ABSENT Original cell reads as null too (ADR-0003 truncation contract)');

const nulled = { ...STATED, original: null };
const absent = { ...STATED }; delete absent.original;

for (const [label, row] of [['null', nulled], ['absent', absent]]) {
  /* Caught rather than left to escape, so backing the guard out names the
     defect on stderr instead of printing a bare stack. */
  let line;
  try { line = rowLine(D, row); } catch (e) {
    assert.fail(`a debts row with original ${label} must serialize, but rowLine threw ${e.message}`);
  }
  eq(typeof line, 'string', `a debts row with original ${label} serializes instead of throwing`);
  eq(cellsOf(line)[ORIGINAL], '',
    `original ${label} writes an EMPTY cell — the inverse of the read that mints null`);
  /* Round-trip: what was written must read back as the same state, or the
     column has traded a throw for a silent value change. */
  eq(rowToObject(D, cellsOf(line)).original, null,
    `original ${label} round-trips back to null rather than becoming 0`);
}

/* ---------------- 2. the half that matters: the FILE survives -------------- */

/* One bad row among healthy ones used to cost the whole document. Assert the
   document exists AND that every row is in it — a fix that swallowed the row
   would pass a bare "did not throw". */
const rows = [STATED, nulled, { ...STATED, name: 'Bond', original: 900000 }];
let doc;
try { doc = mdTableFile({ fm: 'kind: debts', title: 'Debts', prose: ['P.'], schema: D, rows }); } catch (e) {
  assert.fail(`one null original aborted the WHOLE Debts.md write: ${e.message}`);
}
const bodyRows = doc.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Name '));
eq(bodyRows.length, 3, 'all three rows reach the file — the null row does not take the other two with it');
eq(bodyRows.map(l => cellsOf(l)[0]), ['Car loan', 'Car loan', 'Bond'],
  'and in order: the null row is written in place, not dropped');
eq(doc.split('\n')[1], 'kind: debts', 'frontmatter is still there — the document was actually built');

/* usedColumns() swallows the same call in a try/catch, so it never showed the
   defect. Pinned so a later "tidy up that catch" cannot quietly re-expose it. */
eq(usedColumns(D, rows).length, D.columns.length - (D.optionalTail || 0),
  'usedColumns still narrows the optional tail with a null-original row present');

/* ---------------- 3. no valid row changed a single byte ------------------- */

/* The 1.17.5 literal from tests/table-schema.test.cjs, kept verbatim. If this
   line moves, golden-tables.test.cjs is about to go red and every Debts.md in
   every vault is about to be rewritten. */
const GOLD = { name: 'Visa | Gold', lender: 'Bank | A', type: 'credit card', balance: 8000, original: 12000, rate: 22.5, payment: 400, extra: 150, start: '2024-03-01', category: 'Groceries', status: 'active', notes: 'revolving | card' };
eq(rowLine({ ...D, columns: usedColumns(D, [GOLD]) }, GOLD),
  '| Visa \\| Gold | Bank \\| A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | Groceries | active | revolving \\| card |',
  'a stated row is byte-identical to 1.17.5 — the guard changed nothing on the happy path');

eq(cellsOf(rowLine(D, STATED))[ORIGINAL], '150000.00', 'a stated original is still written canonically');
eq(cellsOf(rowLine(D, { ...STATED, original: 0 }))[ORIGINAL], '0.00',
  'a stated ZERO is still 0.00 — the guard tests for null, not for falsiness');

/* The two pre-existing branches, each still preferred over the new arm. */
eq(cellsOf(rowLine(D, { ...STATED, originalStated: false }))[ORIGINAL], '',
  'ISSUE 68: a derived original still goes back empty even though it holds a number');
eq(cellsOf(rowLine(D, { ...STATED, original: 0, originalRaw: '12 000 R' }))[ORIGINAL], '12 000 R',
  "an unreadable cell's verbatim text still wins while the row holds the 0 it produced");
eq(cellsOf(rowLine(D, { ...STATED, original: 12000, originalRaw: '12 000 R' }))[ORIGINAL], '12000.00',
  'and stops winning the moment the row holds a real figure — an edit must not vanish');
/* The raw branch already handled null on its own (`!(null || 0)` is true) and
   must keep doing so: preserving the reader's text beats writing ''. */
eq(cellsOf(rowLine(D, { ...nulled, originalRaw: '12 000 R' }))[ORIGINAL], '12 000 R',
  'a null original with a raw beside it still prefers the raw over the empty cell');

/* ---- and the OTHER writer sets the flag ---------------------------------
   The schema above is only half the contract. `load.js`'s post() step stamps
   originalStated on every debt read from disk, so a debt that has been through
   a load behaves. `addDebt` in views/debts.js is the second writer and set
   neither: a blank Original — the expected case, per that field's own `desc` —
   seeded `original` from the balance and then took the `.toFixed(2)` branch
   above, writing the derived figure into Debts.md as a claim the household
   never made. One load later it read back as stated and the distinction was
   gone for good, which is this app correcting rather than arguing.

   A source grep, because the constructor is inside a view with no bare-node
   seam: the assertion the schema can make is that the writer says something
   about the flag at all. */
const fs = require('fs');
const path = require('path');
const debtsView = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'debts.js'), 'utf8');
/* The closing marker is searched FROM the push, not from the top of the file:
   the delete button on line ~716 carries the same `mark(); renderDebts();` and
   a bare indexOf finds that one, yielding an empty slice that quietly asserts
   nothing. The locator check below is what caught it. */
const pushAt = debtsView.indexOf('S.debts.push({');
const addDebtPush = debtsView.slice(pushAt, debtsView.indexOf('mark(); renderDebts();', pushAt));
eq(addDebtPush.length > 0 && addDebtPush.includes('balance:'), true,
  'the addDebt row literal was located, so the assertion below is looking at something');
eq(/originalStated:\s*originalTyped !== null/.test(addDebtPush), true,
  'addDebt states whether the original was TYPED — a seeded one must not go to disk as a claim');

console.log(`PASS schema-debts-original-unstated-write (${checks} checks)`);
