'use strict';
/* Serializer round-trip guard.

   The load → edit → serialize → reload cycle is the plugin's data-corruption
   surface: a transaction written to disk must parse back to the exact same
   record. This test drives the REAL serializer (transactions.js `serializeTxFile`,
   reached through its register(ctx) factory) and parses its output with the SAME
   util primitives the loader uses, then asserts field-for-field equality — with
   adversarial values (pipes, newlines, unicode, decimal-comma amounts, empties)
   that are exactly what breaks naive markdown-table writers.

   It also pins the shared escaping foundation (escMd/unescMd + parseMdTable) and
   the frontmatter-preservation invariant (patchFrontmatter keeps unmodeled keys),
   which EVERY serializer relies on — so a break there is caught once here.

   Runs in bare node via a tiny `obsidian` stub. Wired into ./build.sh.
     node tests/serializer-roundtrip.test.cjs        # non-zero exit on failure

   NOTE: `loadTxRows` below mirrors src/load.js's transaction column mapping
   (indices 0..5). If you change a serializer column OR the loader mapping,
   update BOTH the source and this helper — that's the parity this test guards. */

const assert = require('assert');
const Module = require('module');

// --- obsidian stub: classes must be extendable (modal.js does `extends Modal`). ---
const origLoad = Module._load;
const STUB = {
  setIcon() {}, normalizePath: (p) => p,
  Notice: class {}, Modal: class {}, Setting: class {}, PluginSettingTab: class {},
  ItemView: class {}, Plugin: class {}, TFile: class {}, TFolder: class {},
};
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return STUB;
  return origLoad.apply(this, arguments);
};

const { escMd, unescMd, parseMdTable, parseNum, parseFrontmatter, safeSeg, yamlStr, csvCell, parseCsv } = require('../src/util');
const registerTransactions = require('../src/views/transactions');

let checks = 0;
const eq = (actual, expected, msg) => { assert.deepStrictEqual(actual, expected, msg); checks++; };
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

/* ---- 1. Shared escaping foundation: escMd → cell → unescMd is identity ---- */
// (values without edge whitespace — escMd trims, which is intended and separate.)
for (const v of ['Woolworths', 'PnP | Sandton', 'multi\nline note', 'café ¥ 个人所得税 déjà',
                 'comma, and; semicolon', '50% off', 'R100 @ shop', '']) {
  // A leading marker cell so a lone empty/dash value can't be mistaken for a
  // table separator row (parseMdTable skips `|  |`) — real rows always have >1 col.
  const line = `| marker | ${escMd(v)} |`;
  const cell = parseMdTable(line)[0][1];
  eq(unescMd(cell), v, `escaping round-trip must preserve ${JSON.stringify(v)}`);
}

/* ---- 2. parseNum round-trips every amount the serializer emits (toFixed 2) ---- */
for (const n of [-123.45, 0, 1000, -0.01, 999999.99, 42]) {
  const p = parseNum(n.toFixed(2));
  ok(p.ok, `parseNum must strictly parse ${n.toFixed(2)}`);
  eq(p.value, n, `parseNum value must equal ${n}`);
}

/* ---- 3. REAL serializeTxFile → loader parse → field-for-field equality ---- */
// NOTE: this file guards the serializer against a MIRROR of the loader (below).
// tests/vault-roundtrip.test.cjs drives the real loadVault instead and is the
// stronger guarantee; this one stays for the focused escaping/amount cases.
const ctx = { S: {}, registerDirty() {}, provide(o) { Object.assign(ctx, o); } };
registerTransactions(ctx);                 // no calls at register time; only defines fns
const { serializeTxFile } = ctx;
ok(typeof serializeTxFile === 'function', 'serializeTxFile must be exposed on ctx');

// Mirror of src/load.js transaction row mapping (columns 0..5). Keep in sync.
function loadTxRows(text) {
  const rows = parseMdTable(text);
  return rows.slice(1).map((c) => {
    const amt = parseNum(c[3]);
    return {
      date: c[0], desc: unescMd(c[1]), cat: unescMd(c[2]),
      amount: amt.value, amountRaw: amt.ok ? null : amt.raw,
      excluded: (c[4] || '').toLowerCase() === 'yes', note: unescMd(c[5] || ''),
    };
  });
}

const rows = [
  { date: '2026-07-01', desc: 'Woolworths Gardens', cat: 'Groceries', amount: -249.99, amountRaw: null, excluded: false, note: '' },
  { date: '2026-07-02', desc: 'PnP | Sandton City', cat: 'Groceries', amount: -1000, amountRaw: null, excluded: false, note: 'split | over two cards' },
  { date: '2026-07-03', desc: 'Salary', cat: 'Income', amount: 42000.5, amountRaw: null, excluded: false, note: 'multi\nline note' },
  { date: '2026-07-04', desc: 'Transfer to savings', cat: 'Transfer between accounts', amount: -500, amountRaw: null, excluded: true, note: 'excluded' },
  { date: '2026-07-05', desc: 'café ¥ 个人所得税', cat: '', amount: 0, amountRaw: null, excluded: false, note: '' },
  // Non-strict amount cell (hand-edited "1 234,56") must survive byte-for-byte
  // via amountRaw. `amount` is the reader's interpretation of that cell and is
  // NOT written back — it was parseFloat's 1 until parseNum learned to defer to
  // normalizeAmount, which reads the decimal comma correctly.
  { date: '2026-07-06', desc: 'Legacy row', cat: 'Bank fees', amount: 1234.56, amountRaw: '1 234,56', excluded: false, note: '' },
];

// serializeTxFile sorts f.rows in place; feed a clone and compare order-independently.
const f = { label: 'FNB Cheque', month: '2026-07', fmRaw: 'tags: [finance, finance/budget, finance/budget/transactions]\naliases: [July]', rows: rows.map((r) => ({ ...r })) };
const text = serializeTxFile(f);
const back = loadTxRows(text);

eq(back.length, rows.length, 'row count must survive the round-trip');
const key = (r) => `${r.date}|${r.desc}|${r.amount}`;
const byKey = new Map(back.map((r) => [key(r), r]));
for (const orig of rows) {
  const got = byKey.get(key(orig));
  ok(got, `row must round-trip: ${orig.desc}`);
  if (got) eq(got, orig, `every field must match for: ${orig.desc}`);
}

/* ---- 3b. Non-strict amount cells are read, not guessed at ---- */
// parseFloat used to return a plausible-looking wrong number for every one of
// these, which then reached the totals and (for account balances) got written
// straight back over the real figure.
for (const [cell, want] of [['1 234,56', 1234.56], ['1,234.56', 1234.56], ['1.234,56', 1234.56],
                            ['R150.00', 150], ['(123.45)', -123.45], ['123.45-', -123.45]]) {
  const n = parseNum(cell);
  eq(n.ok, false, `${cell} is not a canonical cell`);
  eq(n.raw, cell, `${cell} must be preserved verbatim for write-back`);
  eq(n.value, want, `${cell} must be READ as ${want}, not guessed at`);
}

/* ---- 3c. safeSeg is the single canonicaliser for a path segment ---- */
// The in-memory txFiles key and the path written to disk are both derived from
// this. If it is not idempotent and not NFC, a lookup misses while the write
// still lands on the existing file — rebuilding that month with only new rows.
for (const v of ['FNB:Joint', 'FNB Cheque', 'a*b?c"d<e>f|g', '../../evil', 'Re\u0065\u0308nboog', 'FNB\u00A0Cheque']) {
  const once = safeSeg(v);
  eq(safeSeg(once), once, `safeSeg must be idempotent for: ${JSON.stringify(v)}`);
  ok(!once.includes('..'), `safeSeg must never emit '..' for: ${JSON.stringify(v)}`);
  ok(!/[\\/]/.test(once), `safeSeg must never emit a separator for: ${JSON.stringify(v)}`);
}
// 'Ree\u0308nboog' (decomposed, what macOS/iCloud hands you) and 'Re\u00EBnboog'
// (composed) are the same word; safeSeg must not let them key two different ways.
eq(safeSeg('Re\u0065\u0308nboog'), safeSeg('Re\u00EBnboog'),
  'decomposed and composed forms must canonicalise to one string');
eq(safeSeg('CON'), 'CON-', 'Windows device names must be suffixed');
eq(safeSeg('foo.'), 'foo', 'a trailing dot the OS would strip must be stripped here first');

/* ---- 3d. YAML + CSV escaping ---- */
eq(yamlStr('ITA34: 2026/0031'), '"ITA34: 2026/0031"', 'a colon in free text must be quoted');
eq(yamlStr('Kids "school" fees'), '"Kids \\"school\\" fees"', 'embedded quotes must be escaped');
eq(yamlStr('C:\\Users'), '"C:\\\\Users"', 'backslashes must be escaped');
// Assert on the value a spreadsheet actually sees, i.e. after CSV parsing —
// csvCell also quotes, so the raw string starts with '"'.
for (const v of ['=1+1', '@SUM(A1)', '+1', '-1+1']) {
  const seen = parseCsv(`${csvCell(v)}\n`)[0][0];
  ok(seen.startsWith("'"), `a formula-leading cell must be neutralised: ${v}`);
  eq(seen.slice(1), v, `...without altering the text itself: ${v}`);
}
eq(csvCell('Woolworths'), 'Woolworths', 'an ordinary cell must be left alone');
eq(parseCsv(`${csvCell('PnP, Sandton')}\n`)[0][0], 'PnP, Sandton', 'a comma must still round-trip');

/* ---- 4. Frontmatter preservation: unmodeled keys survive the write-back ---- */
const { raw } = parseFrontmatter(text);
ok(/aliases:\s*\[July\]/.test(raw), 'unmodeled frontmatter key (aliases) must survive serialize');
ok(/tags:/.test(raw), 'tags frontmatter must survive serialize');
ok(/account:\s*"FNB Cheque"/.test(raw), 'serializer must (re)write the account key');
ok(/month:\s*2026-07/.test(raw), 'serializer must (re)write the month key');

console.log(`PASS — serializer round-trip intact (${checks} assertions: escaping, amounts, real serializeTxFile, frontmatter preservation).`);
