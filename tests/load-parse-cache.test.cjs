'use strict';
/* A reload re-parses only the month files that changed — and loads exactly
   what it always loaded (2026-11-11 audit, task 11 — Low, measured).

   Every external change reloads the whole vault, and nearly all of that time
   is parsing transaction tables: on a synthetic five-year household (240 month
   files, 17 760 rows) a reload took a median 80–94 ms on a desktop, linear in
   rows. A sync burst on a phone delivers a dozen of those back to back, each
   re-parsing 239 files nobody touched.

   load.js now keeps, per month file, the text it last parsed and the parse.
   A file whose text is byte-for-byte the same is not parsed again. This suite
   is the proof that doing so cannot change a loaded value, because a cache on
   the load path is only worth having if it is obviously safe:

     1. EQUIVALENCE. For four committed fixture vaults, a warm load (every file
        a cache hit) builds a state deep-equal — values, key ORDER, undefined
        cells and all — to the cold load's, and to a cold load on a fresh ctx
        that has never seen a cache. The parse is observed through the real
        parser (a spy on markdown.js, installed before load.js is required), so
        "warm" is measured, not assumed: zero month files parsed.
     2. NO LEAK. Rows are edited in memory every way a page edits them — a
        cell, an amount, a pushed row, a spliced row, a hand-added column's
        cell and header, the file's own lead text — and never saved. The next
        load gives back the disk's rows, untouched: the cache holds its own
        frozen copy and hands out a fresh one each time, so no two loads share
        an object and nothing a page mutates is the cache's.
     3. INVALIDATION. A file whose text changed is parsed again (exactly that
        one), an appended row appears, and a file put back to its earlier text
        loads as that text. A deleted file is gone; a new one is parsed.
     4. THE KEY IS THE FILE, NOT THE TEXT ALONE. Two accounts with identical
        month files each get their own label, rel and row objects; the same
        relative path in two BOOKS holds each book's own rows across a switch.
     5. the round trip still closes: a warm-loaded month through the real
        serializeTxFile is the very bytes a cold-loaded one writes.

     node tests/load-parse-cache.test.cjs */

const assert = require('assert');
const v8 = require('v8');
const H = require('./helpers/harness.cjs');
H.stubObsidian();

/* The spy goes on BEFORE load.js is first required: it destructures the
   parser at require time. Every call is recorded by the text it was handed,
   so "was THIS month file parsed during THAT load" is a lookup. */
const md = require('../src/markdown');
const realParse = md.parseMdTableWithSeparator;
let parsedTexts = [];
md.parseMdTableWithSeparator = (text, ...rest) => { parsedTexts.push(text); return realParse(text, ...rest); };

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* A structured copy keeps what JSON drops — a key whose value is undefined is
   how a short row reads, and it must still be there after a warm load. */
const copy = v => v8.deserialize(v8.serialize(v));
/* Key order, all the way down: deepStrictEqual does not look at it, several
   suites compare states as JSON, and a clone that reordered keys would move
   them all. */
const shape = v => (Array.isArray(v) ? v.map(shape)
  : v && typeof v === 'object' ? Object.keys(v).map(k => [k, shape(v[k])]) : typeof v);

const B = 'Budget';
const txPathsOf = files => Object.keys(files).filter(p => /\/Transactions\/.+\/\d{4}-\d{2}\.md$/.test(p));
/* How many of `files`' month files were parsed while `fn` ran. */
async function parsedDuring(ctx, fn) {
  const texts = new Set(txPathsOf(Object.fromEntries(ctx.vault._store)).map(p => ctx.vault._store.get(p)));
  parsedTexts = [];
  await fn();
  return parsedTexts.filter(t => texts.has(t)).length;
}
const TX_HEAD = '| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n';
const month = rows => `---\nkind: transactions\n---\n\n${TX_HEAD}${rows}`;

(async () => {
  /* ---- 1. equivalence, over the committed fixtures ---- */
  const FIXTURES = [
    ['household', require('./figures/household.cjs').SEED],
    ['household2', require('./figures/household2.cjs').SEED],
    ['views-vault', require('./helpers/views-vault.cjs')],
    ['lane-r household', require('./helpers/lane-r-household.cjs').FILES],
  ];
  for (const [name, files] of FIXTURES) {
    const n = txPathsOf(files).length;
    ok(n > 0, `${name}: the fixture holds month files (${n})`);
    const ctx = H.makeCtx({ ...files });
    let cold;
    const parsedCold = await parsedDuring(ctx, async () => { cold = copy((await H.loadInto(ctx)).txFiles); });
    eq(parsedCold, n, `${name}: a first load parses every month file`);
    const coldShape = shape(ctx.S.txFiles);

    const parsedWarm = await parsedDuring(ctx, () => ctx.loadVault());
    eq(parsedWarm, 0, `${name}: T11: a reload with nothing changed parses no month file`);
    eq(ctx.S.txFiles, cold, `${name}: T11: and builds exactly the rows the cold load built`);
    eq(shape(ctx.S.txFiles), coldShape, `${name}: T11: in the same key order, undefined cells included`);

    const fresh = await H.loadInto(H.makeCtx({ ...files }));
    eq(ctx.S.txFiles, fresh.txFiles, `${name}: T11: and what a ctx that never cached anything builds`);
    eq(shape(ctx.S.txFiles), shape(fresh.txFiles), `${name}: …key for key`);
  }

  /* ---- 2. an edit in memory never reaches the cache ---- */
  {
    const files = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\n---\n',
      [`${B}/Categories/G.md`]: '---\ntype: expense\n---\n',
      /* A hand-added Balance column and a short row, so extraCols, extraCells
         and an undefined cell are all in play. */
      [`${B}/Transactions/X/2026-07.md`]: '---\nkind: transactions\naliases: [July]\n---\n\nA line the household wrote above the table.\n\n'
        + '| Date | Description | Category | Amount | Excluded | Note | Balance |\n|---|---|---|---:|---|---|---:|\n'
        + '| 2026-07-01 | first | G | -10.00 |  |  | 990.00 |\n| 2026-07-02 | second | G | -20.00 | yes | n | 970.00 |\n| 2026-07-03 | short | G |\n\nA line below.\n',
      [`${B}/Transactions/X/2026-08.md`]: month('| 2026-08-01 | august | G | -5.00 |  |  |\n'),
    };
    const ctx = H.makeCtx(files);
    await H.loadInto(ctx);
    require('../src/views/transactions')(ctx);
    const pristine = copy(ctx.S.txFiles);
    const f1 = ctx.S.txFiles['X/2026-07'];
    ok(f1.rows[0].extraCells && f1.extraCols, 'the fixture reaches extraCells and extraCols');
    ok(!Object.isFrozen(f1) && !Object.isFrozen(f1.rows) && !Object.isFrozen(f1.rows[0]) && !Object.isFrozen(f1.rows[0].extraCells) && !Object.isFrozen(f1.extraCols),
      'T11: what a load hands out is ordinary, editable state — nothing frozen reaches a page');

    /* Everything a page does to a month it has not saved. */
    f1.rows[0].desc = 'EDITED';
    f1.rows[0].amount = 999;
    f1.rows[0].extraCells[0] = 'tampered';
    f1.rows[1].excluded = false;
    f1.rows.push({ date: '2026-07-09', desc: 'ADDED', cat: 'G', amount: -1, amountRaw: null, excluded: false, note: '' });
    f1.rows.splice(1, 1);
    f1.extraCols.headers[0] = 'Renamed';
    f1.lead = 'overwritten';
    f1.dirty = true;
    delete ctx.S.txFiles['X/2026-08'].rows[0].cat;

    const parsed = await parsedDuring(ctx, () => ctx.loadVault());
    eq(parsed, 0, 'the disk did not change, so nothing is parsed again');
    eq(ctx.S.txFiles, pristine, 'T11: and the reload is the disk\'s rows — not one edit leaked into what the cache hands back');
    const f2 = ctx.S.txFiles['X/2026-07'];
    ok(f2 !== f1 && f2.rows !== f1.rows && f2.rows[0] !== f1.rows[0] && f2.rows[0].extraCells !== f1.rows[0].extraCells && f2.extraCols !== f1.extraCols,
      'T11: no object is shared between two loads');
    eq(f1.rows[0].desc, 'EDITED', 'the page\'s old objects are still what the page made them (they are simply no longer the state)');

    /* …and again, edited a second time: a copy of a copy is still not the cache. */
    f2.rows[0].desc = 'EDITED AGAIN';
    f2.rows.length = 0;
    await ctx.loadVault();
    eq(ctx.S.txFiles, pristine, 'T11: a second round of edits and a third load: still the disk\'s rows');

    /* ---- 5. the round trip closes on a warm load ---- */
    /* Against a ctx that has only ever loaded cold. The serializer is not a
       byte-for-byte echo of a hand-written file (it states account and month,
       and pads a short row), so the oracle is what it writes from a cold
       load: the same bytes, or the cache changed what a Save puts on disk. */
    const coldCtx = H.makeCtx(files);
    await H.loadInto(coldCtx);
    require('../src/views/transactions')(coldCtx);
    for (const key of ['X/2026-07', 'X/2026-08']) {
      const out = ctx.serializeTxFile(ctx.S.txFiles[key]);
      eq(out, coldCtx.serializeTxFile(coldCtx.S.txFiles[key]),
        `T11: ${key} from a warm load serializes to the very bytes it does from a cold one`);
    }

    /* ---- 3. invalidation ---- */
    const p7 = `${B}/Transactions/X/2026-07.md`, p8 = `${B}/Transactions/X/2026-08.md`;
    const august = files[p8];
    ctx.vault._store.set(p8, august + '| 2026-08-02 | synced from the phone | G | -7.00 |  |  |\n');
    eq(await parsedDuring(ctx, () => ctx.loadVault()), 1, 'T11: one month changed on disk: exactly that file is parsed again');
    eq(ctx.S.txFiles['X/2026-08'].rows.map(r => r.desc), ['august', 'synced from the phone'], 'T11: and its new row is in memory');
    eq(ctx.S.txFiles['X/2026-07'], pristine['X/2026-07'], 'the untouched month is as it was');

    ctx.vault._store.set(p8, august);
    await ctx.loadVault();
    eq(ctx.S.txFiles['X/2026-08'], pristine['X/2026-08'], 'T11: a file put back to its earlier text loads as that text, not as the one in between');

    /* One character, same length, same row count: the key is the whole text. */
    ctx.vault._store.set(p8, august.replace('-5.00', '-6.00'));
    await ctx.loadVault();
    eq(ctx.S.txFiles['X/2026-08'].rows[0].amount, -6, 'T11: a one-character change in a cell is a different file');

    await ctx.vault.trash(ctx.vault.getFileByPath(p7));
    await ctx.loadVault();
    eq(Object.keys(ctx.S.txFiles), ['X/2026-08'], 'a deleted month is gone from the state');
    await ctx.vault.create(p7, month('| 2026-07-01 | a different July | G | -1.00 |  |  |\n'));
    eq(await parsedDuring(ctx, () => ctx.loadVault()), 1, 'and a new file at its old path is parsed, not remembered');
    eq(ctx.S.txFiles['X/2026-07'].rows.map(r => r.desc), ['a different July'], 'T11: it loads as what is on disk now');
  }

  /* ---- 4. the key is the file ---- */
  {
    const same = month('| 2026-07-01 | identical | G | -10.00 |  |  |\n');
    const ctx = H.makeCtx({
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\n---\n',
      [`${B}/Transactions/One/2026-07.md`]: same,
      [`${B}/Transactions/Two/2026-07.md`]: same,
    });
    await H.loadInto(ctx);
    await ctx.loadVault();
    const a = ctx.S.txFiles['One/2026-07'], b = ctx.S.txFiles['Two/2026-07'];
    eq([a.label, a.rel, b.label, b.rel], ['One', 'Transactions/One/2026-07.md', 'Two', 'Transactions/Two/2026-07.md'],
      'T11: two accounts with identical month files keep their own label and path');
    ok(a.rows !== b.rows && a.rows[0] !== b.rows[0], 'T11: and their own row objects');
    a.rows[0].desc = 'only One';
    eq(b.rows[0].desc, 'identical', 'an edit to one is not an edit to the other');
  }
  {
    const HOME = 'Budget', ACME = 'Clients/Acme';
    const ctx = H.makeCtx({
      [`${HOME}/Settings.md`]: '---\nmonth_start_day: 1\n---\n',
      [`${HOME}/Transactions/Cheque/2026-07.md`]: month('| 2026-07-01 | household row | G | -10.00 |  |  |\n'),
      [`${ACME}/Settings.md`]: '---\nmonth_start_day: 1\n---\n',
      [`${ACME}/Transactions/Cheque/2026-07.md`]: month('| 2026-07-01 | client row | G | -99.00 |  |  |\n'),
    }, { budgetFolder: HOME });
    const store = {};
    ctx.plugin.app = { vault: ctx.vault, loadLocalStorage: k => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { if (v === null) delete store[k]; else store[k] = v; } };
    ctx.plugin.settings.books = [{ folder: HOME, label: 'Home' }, { folder: ACME, label: 'Acme' }];
    await H.loadInto(ctx);
    const rows = () => ctx.S.txFiles['Cheque/2026-07'].rows.map(r => r.desc);
    eq(rows(), ['household row'], 'the household is open');
    for (const [folder, want] of [[ACME, 'client row'], [HOME, 'household row'], [ACME, 'client row']]) {
      ctx.plugin.setOpenBookLocal(folder === HOME ? null : folder);
      await ctx.loadVault();
      eq(rows(), [want], `T11: Transactions/Cheque/2026-07.md in ${folder} is that book's own month across a switch`);
    }
  }

  md.parseMdTableWithSeparator = realParse;
  console.log(`PASS load-parse-cache (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
