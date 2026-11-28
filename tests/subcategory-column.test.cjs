'use strict';
/* The Subcategory column in a month's transaction file (ADR-0010 §4, issue #184).

   Every file here goes through the REAL loader and the REAL serializer
   (serializeTxFile), the way tests/vault-roundtrip.test.cjs does, because a
   column mapping spelled in a test stays green while load.js changes and every
   later save corrupts a file. The expected output of every write is a LITERAL
   string, never a recomputation of what the writer does.

   What it pins:

     1. a file with no subcategory is byte-for-byte what it was, in each of the
        four shapes a month file has (six columns, seven, and each with a
        household column of its own);
     2. the column is read by its HEADER wherever it sits after the known
        columns: directly after Note, after Split, after an unknown extra;
     3. it stays where it is found, and making the first split in a file moves
        it one place right with header and values intact;
     4. a file that first needs one gets it appended after every column it
        already has, and a file that stops needing one in the same session
        comes back unchanged;
     5. what the reader typed is not rewritten: an unchanged cell goes back as it
        was, even one the escape pair would not reproduce;
     6. the list on the category note is read in load.js beside the other
        category frontmatter.

   A negative control at the bottom breaks the invariant and proves the suite
   notices.

     node tests/subcategory-column.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { applySplit } = require('../src/tx-role');
const { escMd, unescMd } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const FM = '---\naccount: "Cheque"\nmonth: 2026-07\n---\n\n';
const PATH = `${B}/Transactions/Cheque/2026-07.md`;

/* Four shapes a month file has, each written the way a household or this app
   writes it: the short separator the loader keeps verbatim. */
const SHAPES = {
  six: {
    head: '| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n',
    row: (d, desc, cat, amt) => `| ${d} | ${desc} | ${cat} | ${amt} |  |  |\n`,
  },
  seven: {
    head: '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n',
    row: (d, desc, cat, amt) => `| ${d} | ${desc} | ${cat} | ${amt} |  |  |  |\n`,
  },
  sixExtra: {
    head: '| Date | Description | Category | Amount | Excluded | Note | Balance |\n|---|---|---|---:|---|---|---|\n',
    row: (d, desc, cat, amt, x) => `| ${d} | ${desc} | ${cat} | ${amt} |  |  | ${x} |\n`,
  },
  sevenExtra: {
    head: '| Date | Description | Category | Amount | Excluded | Note | Split | Balance |\n|---|---|---|---:|---|---|---|---|\n',
    row: (d, desc, cat, amt, x) => `| ${d} | ${desc} | ${cat} | ${amt} |  |  |  | ${x} |\n`,
  },
};
const ROWS = [
  ['2026-07-01', 'Engen', 'Car', '-500.00', '100.00'],
  ['2026-07-02', 'Checkers', 'Groceries', '-250.00', '350.00'],
  ['2026-07-03', 'N1 toll', 'Car', '-65.00', '285.00'],
];
const fileOf = shape => FM + SHAPES[shape].head + ROWS.map(r => SHAPES[shape].row(...r)).join('');

async function open(text, extra = {}) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS, [PATH]: text, ...extra });
  const S = await loadInto(ctx);
  require('../src/views/transactions')(ctx);
  return { ctx, S, file: S.txFiles['Cheque/2026-07'] };
}
const written = (ctx, file) => ctx.serializeTxFile(file);

(async () => {
  /* ---- 1. no subcategory: not a byte moves ---------------------------- */
  for (const shape of Object.keys(SHAPES)) {
    const text = fileOf(shape);
    const { ctx, file } = await open(text);
    eq(written(ctx, file), text, `${shape}: a file with no subcategory is written back byte for byte`);
    ok(file.rows.every(r => !('subcategory' in r)), `${shape}: no row grows a subcategory field`);
  }

  /* ---- 2. found by its header, wherever it sits after the known columns */
  const WITH = {
    afterNote: {
      text: FM + '| Date | Description | Category | Amount | Excluded | Note | Subcategory |\n|---|---|---|---:|---|---|---|\n'
        + '| 2026-07-01 | Engen | Car | -500.00 |  |  | Fuel |\n'
        + '| 2026-07-02 | Checkers | Groceries | -250.00 |  |  |  |\n'
        + '| 2026-07-03 | N1 toll | Car | -65.00 |  |  | Tolls \\| N1 |\n',
      subs: ['Fuel', undefined, 'Tolls | N1'],
    },
    afterSplit: {
      text: FM + '| Date | Description | Category | Amount | Excluded | Note | Split | Subcategory |\n|---|---|---|---:|---|---|---|---|\n'
        + '| 2026-07-01 | Engen | Car | -500.00 |  |  |  | Fuel |\n'
        + '| 2026-07-02 | Checkers | Groceries | -250.00 |  |  |  |  |\n'
        + '| 2026-07-03 | N1 toll | Car | -65.00 |  |  |  | Tolls \\| N1 |\n',
      subs: ['Fuel', undefined, 'Tolls | N1'],
    },
    afterExtra: {
      text: FM + '| Date | Description | Category | Amount | Excluded | Note | Balance | Subcategory |\n|---|---|---|---:|---|---|---|---|\n'
        + '| 2026-07-01 | Engen | Car | -500.00 |  |  | 100.00 | Fuel |\n'
        + '| 2026-07-02 | Checkers | Groceries | -250.00 |  |  | 350.00 |  |\n'
        + '| 2026-07-03 | N1 toll | Car | -65.00 |  |  | 285.00 | Tolls \\| N1 |\n',
      subs: ['Fuel', undefined, 'Tolls | N1'],
    },
    afterSplitAndExtra: {
      text: FM + '| Date | Description | Category | Amount | Excluded | Note | Split | Balance | Subcategory |\n|---|---|---|---:|---|---|---|---|---|\n'
        + '| 2026-07-01 | Engen | Car | -500.00 |  |  |  | 100.00 | Fuel |\n'
        + '| 2026-07-02 | Checkers | Groceries | -250.00 |  |  |  | 350.00 |  |\n'
        + '| 2026-07-03 | N1 toll | Car | -65.00 |  |  |  | 285.00 | Tolls \\| N1 |\n',
      subs: ['Fuel', undefined, 'Tolls | N1'],
    },
    /* A header in another case, the way it is typed by hand. */
    lowerCase: {
      text: FM + '| Date | Description | Category | Amount | Excluded | Note | subcategory |\n|---|---|---|---:|---|---|---|\n'
        + '| 2026-07-01 | Engen | Car | -500.00 |  |  | Fuel |\n',
      subs: ['Fuel'],
    },
  };
  for (const [name, { text, subs }] of Object.entries(WITH)) {
    const { ctx, file } = await open(text);
    eq(file.rows.map(r => r.subcategory), subs, `${name}: the subcategory is read from the column the header names`);
    eq(file.rows.map(r => r.cat), ['Car', 'Groceries', 'Car'].slice(0, subs.length), `${name}: the categories beside it are still the categories`);
    eq(file.rows.map(r => r.amount), [-500, -250, -65].slice(0, subs.length), `${name}: and the amounts`);
    eq(file.rows.map(r => r.split), ['', '', ''].slice(0, subs.length), `${name}: and no row reads its subcategory as a split role`);
    eq(written(ctx, file), text, `${name}: written back byte for byte, the column where it was found`);
  }
  {
    /* The household's own column is still carried: its cells are not lost to the
       subcategory read, and are not misread as it. */
    const { file } = await open(WITH.afterExtra.text);
    eq(file.rows.map(r => r.extraCells), [['100.00', 'Fuel'], ['350.00', ''], ['285.00', 'Tolls \\| N1']],
      'a hand-added column beside it is carried verbatim, as in 1.61');
    eq(file.rows.map(r => r.note), ['', '', ''], 'and nothing slid into Note');
  }

  /* ---- 3. the first split moves it one place right --------------------- */
  {
    const { ctx, file } = await open(WITH.afterNote.text);
    const parent = file.rows[0];
    const parts = applySplit(parent, [
      { cat: 'Car', amount: -300, note: '' }, { cat: 'Groceries', amount: -200, note: '' }], '');
    file.rows.splice(1, 0, ...parts);
    const out = written(ctx, file);
    eq(out, FM
      + '| Date | Description | Category | Amount | Excluded | Note | Split | Subcategory |\n'
      + '|------|-------------|----------|-------:|----------|------|-------|---|\n'
      + '| 2026-07-01 | Engen | Car | -500.00 | yes |  | parent | Fuel |\n'
      + '| 2026-07-01 | Engen | Car | -300.00 |  |  | part |  |\n'
      + '| 2026-07-01 | Engen | Groceries | -200.00 |  |  | part |  |\n'
      + '| 2026-07-02 | Checkers | Groceries | -250.00 |  |  |  |  |\n'
      + '| 2026-07-03 | N1 toll | Car | -65.00 |  |  |  | Tolls \\| N1 |\n',
    'the first split puts Split before Subcategory: header and every value moved one place right, none lost');
    const again = await open(out);
    eq(again.file.rows.map(r => r.subcategory), ['Fuel', undefined, undefined, undefined, 'Tolls | N1'],
      'and the moved file reads back into the same subcategories');
    eq(again.file.rows.map(r => r.split), ['parent', 'part', 'part', '', ''], 'with the split roles in their own column');
    /* A part is a transaction and carries its own, set like any other row. */
    again.file.rows[1].subcategory = 'Services';
    ok(written(again.ctx, again.file).includes('| 2026-07-01 | Engen | Car | -300.00 |  |  | part | Services |\n'),
      'a part given its own subcategory writes it in the part\'s row');
  }
  {
    const { ctx, file } = await open(WITH.afterExtra.text);
    file.rows.splice(1, 0, ...applySplit(file.rows[0], [
      { cat: 'Car', amount: -300, note: '' }, { cat: 'Car', amount: -200, note: '' }], ''));
    const out = written(ctx, file);
    ok(out.includes('| Date | Description | Category | Amount | Excluded | Note | Split | Balance | Subcategory |\n'),
      'with a household column too, Split goes in at its own place and both columns keep their order');
    ok(out.includes('| 2026-07-01 | Engen | Car | -500.00 | yes |  | parent | 100.00 | Fuel |\n'), 'every value of the parent moved with its header');
  }

  /* ---- 4. a file that first needs one: appended after every column ----- */
  const NEEDS = {
    six: [fileOf('six'),
      '| Date | Description | Category | Amount | Excluded | Note | Subcategory |\n'
      + '|------|-------------|----------|-------:|----------|------|-------------|\n'
      + '| 2026-07-01 | Engen | Car | -500.00 |  |  | Fuel |\n'
      + '| 2026-07-02 | Checkers | Groceries | -250.00 |  |  |  |\n'
      + '| 2026-07-03 | N1 toll | Car | -65.00 |  |  |  |\n'],
    seven: [fileOf('seven'),
      '| Date | Description | Category | Amount | Excluded | Note | Split | Subcategory |\n'
      + '|------|-------------|----------|-------:|----------|------|-------|-------------|\n'
      + '| 2026-07-01 | Engen | Car | -500.00 |  |  |  | Fuel |\n'
      + '| 2026-07-02 | Checkers | Groceries | -250.00 |  |  |  |  |\n'
      + '| 2026-07-03 | N1 toll | Car | -65.00 |  |  |  |  |\n'],
    sixExtra: [fileOf('sixExtra'),
      '| Date | Description | Category | Amount | Excluded | Note | Balance | Subcategory |\n'
      + '|------|-------------|----------|-------:|----------|------|---|-------------|\n'
      + '| 2026-07-01 | Engen | Car | -500.00 |  |  | 100.00 | Fuel |\n'
      + '| 2026-07-02 | Checkers | Groceries | -250.00 |  |  | 350.00 |  |\n'
      + '| 2026-07-03 | N1 toll | Car | -65.00 |  |  | 285.00 |  |\n'],
    sevenExtra: [fileOf('sevenExtra'),
      '| Date | Description | Category | Amount | Excluded | Note | Split | Balance | Subcategory |\n'
      + '|------|-------------|----------|-------:|----------|------|-------|---|-------------|\n'
      + '| 2026-07-01 | Engen | Car | -500.00 |  |  |  | 100.00 | Fuel |\n'
      + '| 2026-07-02 | Checkers | Groceries | -250.00 |  |  |  | 350.00 |  |\n'
      + '| 2026-07-03 | N1 toll | Car | -65.00 |  |  |  | 285.00 |  |\n'],
  };
  for (const [shape, [text, tail]] of Object.entries(NEEDS)) {
    const { ctx, file } = await open(text);
    file.rows[0].subcategory = 'Fuel';
    const out = written(ctx, file);
    eq(out, FM + tail, `${shape}: the first subcategory appends the column after every column the file already has`);
    const again = await open(out);
    eq(again.file.rows.map(r => r.subcategory), ['Fuel', undefined, undefined], `${shape}: and it reads back`);
    eq(written(again.ctx, again.file), out, `${shape}: and a second save changes nothing`);

    /* The same session takes it back before saving: the file is as it began. */
    const back = await open(text);
    back.file.rows[0].subcategory = 'Fuel';
    delete back.file.rows[0].subcategory;
    eq(written(back.ctx, back.file), text, `${shape}: a subcategory added and removed before a save leaves the file untouched`);
  }
  {
    /* A month that does not exist yet: Add transaction builds the model itself. */
    const { ctx } = await open(fileOf('six'));
    const out = ctx.serializeTxFile({ label: 'Cheque', month: '2026-08', dirty: false,
      fmRaw: 'tags: [finance, finance/budget, finance/budget/transactions]',
      rows: [{ date: '2026-08-01', desc: 'Engen', cat: 'Car', amount: -500, excluded: false, note: '', subcategory: 'Fuel' }] });
    ok(out.includes('| Date | Description | Category | Amount | Excluded | Note | Subcategory |\n'), 'a brand-new month with one carries the column');
    ok(out.includes('| 2026-08-01 | Engen | Car | -500.00 |  |  | Fuel |\n'), 'and the value');
    const plain = ctx.serializeTxFile({ label: 'Cheque', month: '2026-08', dirty: false,
      fmRaw: 'tags: [finance]',
      rows: [{ date: '2026-08-01', desc: 'Engen', cat: 'Car', amount: -500, excluded: false, note: '' }] });
    ok(!plain.includes('Subcategory'), 'a brand-new month with none does not');
  }

  /* ---- clearing: a column that was found stays where it was ------------ */
  {
    const { ctx, file } = await open(WITH.afterSplit.text);
    for (const r of file.rows) delete r.subcategory;
    eq(written(ctx, file), FM + '| Date | Description | Category | Amount | Excluded | Note | Split | Subcategory |\n|---|---|---|---:|---|---|---|---|\n'
      + '| 2026-07-01 | Engen | Car | -500.00 |  |  |  |  |\n'
      + '| 2026-07-02 | Checkers | Groceries | -250.00 |  |  |  |  |\n'
      + '| 2026-07-03 | N1 toll | Car | -65.00 |  |  |  |  |\n',
    'clearing every value empties the cells and keeps the column: it stays where it was found');
  }
  {
    /* A rewritten value is escaped like every free-text cell. */
    const { ctx, file } = await open(WITH.afterNote.text);
    file.rows[1].subcategory = 'A | B';
    ok(written(ctx, file).includes('| 2026-07-02 | Checkers | Groceries | -250.00 |  |  | A \\| B |\n'), 'a pipe in a typed name is escaped');
  }

  /* ---- 5. what the reader typed is not rewritten ----------------------- */
  {
    /* Premise, asserted rather than assumed: this cell is one the escape pair
       does NOT reproduce — unescMd trims a trailing line break away. */
    const typed = 'Fuel<br>';
    ok(escMd(unescMd(typed)) !== typed, 'premise: the escape pair would rewrite this cell');
    const text = WITH.afterNote.text.replace('| Fuel |', `| ${typed} |`);
    const { ctx, file } = await open(text);
    eq(file.rows[0].subcategory, 'Fuel', 'it reads as the name');
    eq(written(ctx, file), text, 'and an unchanged cell goes back exactly as typed');
    file.rows[0].subcategory = 'Services';
    ok(written(ctx, file).includes('| 2026-07-01 | Engen | Car | -500.00 |  |  | Services |\n'), 'a changed one is written fresh');
  }

  /* ---- 6. the list on the category note -------------------------------- */
  {
    const cats = {
      [`${B}/Categories/Car.md`]: '---\ntype: expense\ncolor: "#888888"\nsubcategories: "Fuel, Services, Tolls"\n---\n',
      [`${B}/Categories/Home.md`]: '---\ntype: expense\nsubcategories: Rates, Repairs\n---\n',
      [`${B}/Categories/Pets.md`]: '---\ntype: expense\nsubcategories:\n  - Food\n  - "Vet"\n---\n',
      [`${B}/Categories/Gym.md`]: '---\ntype: expense\n---\n',
      [`${B}/Categories/Blank.md`]: '---\ntype: expense\nsubcategories: ""\n---\n',
    };
    const { S } = await open(fileOf('six'), cats);
    const by = n => S.categories.find(c => c.name === n);
    eq(by('Car').subcategories, ['Fuel', 'Services', 'Tolls'], 'the quoted comma list, in the order written');
    eq(by('Home').subcategories, ['Rates', 'Repairs'], 'an unquoted comma list');
    eq(by('Pets').subcategories, ['Food', 'Vet'], 'a YAML block list, the shape Obsidian\'s Properties panel writes');
    eq(by('Gym').subcategories, [], 'a note with no key has none');
    eq(by('Blank').subcategories, [], 'an empty key has none');
    eq(by('Car').type, 'expense', 'and the other category frontmatter is read as before');
  }

  /* ---- negative control ------------------------------------------------ */
  {
    /* Break the invariant — write the cell from nothing — and the suite must
       notice. If this passes with the break in place, the checks above prove
       nothing. */
    const table = require('../src/table-schema');
    const col = table.SCHEMAS.transactions.byHeader && table.SCHEMAS.transactions.byHeader[0];
    ok(col && col.header === 'Subcategory', 'the column is declared once, in table-schema.js');
    const realWrite = col.write;
    col.write = () => '';
    const { ctx, file } = await open(WITH.afterNote.text.replace('| Fuel |', '| Fuel<br> |'));
    file.rows[0].subcategory = 'Services';
    const broken = written(ctx, file);
    col.write = realWrite;
    ok(!broken.includes('Services'), 'control: with the writer broken, a changed subcategory is lost — and the checks above would have said so');
  }

  console.log(`subcategory-column.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
