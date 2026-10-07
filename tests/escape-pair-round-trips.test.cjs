'use strict';
/* Every escaped cell is read back through the escape's inverse.

   table-schema.js's own contract says the escape pair (escMd/unescMd) lives in
   one declaration "so the escape pair and the number pair live side by side in
   one declaration and cannot drift apart". `verbatim()` carried only half of it
   until 2026-09-09: it wrote through escMd and read with a bare `.trim()`, so
   every save re-escaped a cell that was already escaped.

   The cost is not theoretical and not self-limiting. A date cell holds text a
   date parser rejected — that is what it is FOR, and reconcile-unreadable-dates
   exists because those cells are real — so "June | maybe" is exactly the kind of
   value that lands there. It gained one backslash per save:

     June \| maybe  ->  June \\| maybe  ->  June \\\| maybe  ->  …

   forever, turning a merely unparseable cell into an unreadable one. Five
   columns carried it (assets `valued`, owed `due`/`lent`, services `next`, debts
   `start`), and Plan's hand-rolled copy of the same shape carried it on two more
   (`sources[].date`, `envelopes[].tint`).

   Three claims:

     1. every column of every schema round-trips a pipe unchanged — asserted by
        WALKING the schemas, so a column added later is covered without anyone
        remembering this file exists,
     2. it is STABLE across repeated saves, which is the actual defect: one pass
        looked fine, and the drift only showed from the second save on,
     3. the two hand-rolled Plan columns round-trip too.

     node tests/escape-pair-round-trips.test.cjs
*/

const assert = require('assert');
const { SCHEMAS, rowLine, rowToObject, headerLines } = require('../src/table-schema');
const { parseMdTable } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* A value that exercises both halves of escMd: a pipe (which would shear the
   row unescaped) and nothing else clever. Newlines are deliberately NOT tested
   here — escMd turns them into `<br>` and unescMd turns them back, but a real
   date cell cannot hold one and asserting it would pin a shape no writer makes. */
const PIPED = 'June | maybe';

/* One representative row per schema, minimal but complete enough that every
   column's write is total. Money keys get numbers, vocab keys their default. */
const SEEDS = {
  assets: { name: 'Ring', type: 'other', value: 1200, valued: PIPED, owner: '', notes: '', currency: PIPED },
  debts: { name: 'Bond', lender: 'Bank', type: 'other', balance: 1000, original: 1000,
    rate: 9, payment: 100, extra: 0, start: PIPED, category: '', status: 'active', notes: '', currency: PIPED },
  owed: { person: 'Sam', amount: 500, note: '', due: PIPED, lent: PIPED, repaid: 0, currency: PIPED },
  services: { name: 'Netflix', amount: 199, cycle: 'monthly', next: PIPED, account: '', category: '', notes: '', currency: PIPED },
};

/* ---- 1 + 2: every schema column, over TWO saves --------------------------- */

const cellsOf = line => {
  const rows = parseMdTable(line);
  return rows[rows.length - 1];
};

for (const [name, seeded] of Object.entries(SEEDS)) {
  const schema = SCHEMAS[name];
  eq(!!schema, true, `${name} is a real schema in SCHEMAS`);
  /* Which columns actually carry the seeded value — found by reading the row
     back, not by a hardcoded list, so this survives a column being renamed. */
  const first = rowLine(schema, seeded);
  const back1 = rowToObject(schema, cellsOf(first));
  /* Intersected with the schema's real columns, so a seed key that no longer
     exists is dropped rather than asserted into a false failure — and a seeded
     key the schema DOES carry can never be silently skipped. `currency` was
     added to every seed after ISSUE 76 pointed out that currency() carries the
     same pair as verbatim() and had been missed. */
  const declared = new Set(schema.columns.map(c => c.key));
  const carriers = Object.keys(seeded).filter(k => seeded[k] === PIPED && declared.has(k));
  eq(carriers.length > 0, true, `${name}: the seed actually exercises a verbatim column`);

  for (const key of carriers) {
    eq(back1[key], PIPED, `${name}.${key}: a pipe survives one save unchanged`);
  }

  // The defect only showed from the SECOND save: pass one looked correct.
  const second = rowLine(schema, back1);
  const back2 = rowToObject(schema, cellsOf(second));
  for (const key of carriers) {
    eq(back2[key], PIPED, `${name}.${key}: and is STILL unchanged after a second save`);
  }

  /* Byte equality is asserted from the SECOND save on, not the first. These
     seeds are hand-built rows, so the first write legitimately normalises a
     default the seed omitted (an absent owed `status` reads back as
     `outstanding` and is then written) — that is a one-off, not drift. From
     here the file must be a fixed point, which is exactly what the escape bug
     broke: it added a backslash on every pass, forever. */
  const third = rowLine(schema, back2);
  eq(third, second, `${name}: the bytes are a fixed point — a second save changes nothing`);

  const fourth = rowLine(schema, rowToObject(schema, cellsOf(third)));
  eq(fourth, second, `${name}: and still nothing on the third`);
  for (const key of carriers) {
    eq(rowToObject(schema, cellsOf(fourth))[key], PIPED, `${name}.${key}: unchanged after three saves`);
  }
}

/* ---- 3: the hand-rolled Plan columns -------------------------------------- */

/* Plan does not go through table-schema — views/plan.js builds its rows and
   load.js maps them by index. That second spelling is exactly why this test
   walks BOTH: fixing one and not the other is this repo's recurring shape. */
const { escMd, unescMd } = require('../src/markdown');
for (const label of ['sources[].date', 'envelopes[].tint']) {
  // The pair as load.js now applies it: written escaped, read unescaped.
  eq(unescMd(escMd(PIPED)), PIPED, `plan ${label}: escMd's inverse restores the cell`);
  eq(escMd(unescMd(escMd(PIPED))), escMd(PIPED), `plan ${label}: and a second save writes the same bytes`);
}

/* A guard on the loader itself, since the assertion above only proves the pair
   is sound, not that load.js uses it. */
const fs = require('fs');
const path = require('path');
const loadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'load.js'), 'utf8');
eq(/date: unescMd\(c\[3\] \|\| ''\)/.test(loadSrc), true,
  "plan sources[].date is read through unescMd, not a bare trim");
eq(/tint: unescMd\(c\[3\] \|\| ''\)/.test(loadSrc), true,
  "plan envelopes[].tint is read through unescMd, not a bare trim");

/* ---- 4: the two inputs that broke a row (2026-10-07 audit, L4A-06) ------ */

/* escMd escaped `|` and CRLF/LF and nothing else, which left two inputs that
   end a markdown table row early while this module's own reader saw nothing
   wrong:

     - a lone CR (`\r` with no `\n` after it). CommonMark ends a line on it,
       so `old mac\rline ending` cut its row in two and the table stopped
       there; parseMdTable splits on `\r?\n` and read it as one line.
     - a backslash right before a pipe. `a\|b` became `a\\|b` — and `\\` is
       an ESCAPED BACKSLASH, so the pipe after it is a bare cell boundary: one
       cell too many for every reader that counts backslashes the CommonMark
       way. splitBarePipes treats any backslash-before-pipe as an escape, so
       the app read one cell and never noticed. The vault's own month files,
       the Transactions export and the Report's detail table all went through
       it.

   So a lone CR becomes `<br>` like any other line ending, and every
   backslash in a run that ends at a pipe is doubled before the pipe is
   escaped: `a\|b` is written `a\\\|b`, an escaped backslash and an escaped
   pipe, which is ONE cell under either way of reading a table. unescMd
   decodes an odd run back exactly. An even run is what the old escMd wrote
   (`a\\|b` for a typed `a\|b`) and keeps its old reading, so a month file
   already on disk loads exactly as it did and heals on its next save.

   Two splitters, because the claim is "one cell under BOTH": this module's
   own (any backslash before a pipe escapes it) and the CommonMark one (only
   an odd run of backslashes does), written out here as the oracle. */
const commonMarkCells = row => {
  let t = row.trim();
  if (t.startsWith('|')) t = t.slice(1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\') {
      let j = i;
      while (t[j] === '\\') j++;
      cur += t.slice(i, j);
      if (t[j] === '|' && (j - i) % 2 === 1) { cur += '|'; i = j; } else i = j - 1;
      continue;
    }
    if (t[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += t[i];
  }
  if (cur.trim() !== '') cells.push(cur.trim());
  return cells;
};

eq(escMd('old mac\rline ending'), 'old mac<br>line ending', 'a lone CR becomes <br>, like CRLF and LF');
eq(unescMd(escMd('old mac\rline ending')), 'old mac\nline ending', 'and reads back as a line break');
eq(escMd('path a\\|b'), 'path a\\\\\\|b', 'a backslash before a pipe is itself escaped: a\\|b is written a\\\\\\|b');
eq(unescMd(escMd('path a\\|b')), 'path a\\|b', 'and reads back as typed');
eq(escMd('a\\\\|b'), 'a\\\\\\\\\\|b', 'every backslash in the run is doubled (two typed, four written, then the escaped pipe)');
eq(unescMd(escMd('a\\\\|b')), 'a\\\\|b', 'and the run reads back at its own length');
eq(unescMd('path a\\\\|b'), 'path a\\|b', 'a cell the OLD escMd wrote for a\\|b (an even run) still reads as a\\|b');
eq(escMd(unescMd('path a\\\\|b')), 'path a\\\\\\|b', 'and its next save writes the form both readers agree on');
eq(cellsOf(`| x | ${escMd('path a\\|b')} | y |`).length, 3, 'this module\'s reader: one cell');
eq(commonMarkCells(`| x | ${escMd('path a\\|b')} | y |`).length, 3, 'the CommonMark reader: one cell too');
eq(commonMarkCells('| x | path a\\\\|b | y |').length, 4, 'and the old output really did split under the CommonMark reader');

/* Exhaustive over every string of up to five symbols drawn from the ones
   that matter here — a letter, a space, a pipe, a backslash, CR, LF, and a
   literal <br> — so a run, a CRLF, a lone CR, a pipe at either end and
   every adjacency between them are all covered.

   SHIPPED_* are escMd/unescMd exactly as 1.49.1 released them, frozen here as
   the reference for the byte-identity half of this claim. Never update them:
   their whole value is that they are the old bytes. */
const SHIPPED_ESC = s => (s ?? '').toString().replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
const SHIPPED_UNESC = s => (s ?? '').replace(/<br>/g, '\n').replace(/\\\|/g, '|').trim();
const ALPHABET = ['a', ' ', '|', '\\', '\r', '\n', '<br>'];
const norm = s => s.replace(/\r\n|\r/g, '\n').replace(/<br>/g, '\n').trim();
const touchedShape = s => /\r(?!\n)/.test(s) || /\\\|/.test(s);   // a lone CR, or a backslash right before a pipe
const runOfTwoBeforePipe = s => /\\\\\|/.test(s);
let corpus = [''];
let all = [''];
for (let len = 1; len <= 5; len++) {
  corpus = corpus.flatMap(p => ALPHABET.map(c => p + c));
  all = all.concat(corpus);
}
let rowsChecked = 0, unchanged = 0;
for (const s of all) {
  const e = escMd(s);
  assert.ok(!/[\r\n]/.test(e), `escMd output stays on one line — ${JSON.stringify(s)}`);
  const row = `| x | ${e} | y |`;
  assert.strictEqual(cellsOf(row).length, 3, `one cell for this module's reader — ${JSON.stringify(s)}`);
  assert.strictEqual(commonMarkCells(row).length, 3, `one cell for a CommonMark reader — ${JSON.stringify(s)}`);
  assert.strictEqual(unescMd(cellsOf(row)[1]), norm(s), `read back as typed (line endings normalised, trimmed) — ${JSON.stringify(s)}`);
  const e2 = escMd(unescMd(e));
  assert.strictEqual(escMd(unescMd(e2)), e2, `a fixed point from the second save — ${JSON.stringify(s)}`);
  if (!touchedShape(s)) {
    assert.strictEqual(e, SHIPPED_ESC(s), `byte-identical to the shipped escMd when neither shape is present — ${JSON.stringify(s)}`);
    unchanged++;
  }
  if (!runOfTwoBeforePipe(s)) {
    const disk = SHIPPED_ESC(s);
    assert.strictEqual(unescMd(disk), SHIPPED_UNESC(disk), `a cell the shipped escMd wrote loads exactly as before — ${JSON.stringify(s)}`);
  }
  rowsChecked++;
}
eq(rowsChecked, all.length, `every one of ${all.length} strings checked`);
eq(unchanged > 0 && unchanged === all.filter(s => !touchedShape(s)).length, true,
  `and every one holding neither shape (${unchanged}) was held to the shipped bytes, not skipped`);

console.log(`PASS — every escaped cell reads back through the escape's inverse, and stays put across saves (${checks} checks, ${rowsChecked} strings swept).`);
