'use strict';
/* Saving a transactions month re-sorted the reader's file.

   serializeTxFile ended with `f.rows.sort((a, b) => a.date.localeCompare(b.date))`
   — in place, on every write. Its purpose (there since the first release) is
   the rows the APP adds: an import, Add transaction and a split all append to
   the end of the month's rows, and the sort put them in date order. But it
   reordered every row already in the file as well. A card statement lists a
   fee straight after the charge it belongs to, dated a day or two later, so on
   the vault this was audited against a Save moved each fee away from its
   charge in three card months — diff noise in a synced folder, and a file
   that no longer reads the way the bank printed it (2026-10-07 audit, L3-22).

   Now the rows already in the file keep their order, and a row the app adds
   goes in at its date: after the last row dated on or before it. On a file
   that was in date order to begin with that is exactly where the sort put it,
   so nothing changes for the common case (tests/golden-tables.test.cjs). A
   split's parts go directly under their parent — the parent-then-parts
   reading order this page already keeps (filteredRows) — and a brand-new file
   is still written in date order, whatever order the statement came in.

   Driven through the REAL loader and the real Transactions page (one-cell
   edit, Add transaction, a split), plus the serializer called exactly the way
   the import commit calls it (views/import.js: `{ ...existing, rows:
   existing.rows.concat(rows) }`, then the rows pushed onto the live file).
     node tests/transactions-file-order.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const answers = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => answers.shift() || null,
      askSplit: async () => answers.shift() || null,
      confirmModal: async () => true, askRulesCleanup: async () => false, askBudgetReslice: async () => false,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');

const B = 'Budget';
const FILE = `${B}/Transactions/Card/2026-09.md`;
const HEAD = '---\naccount: "Card"\nmonth: 2026-09\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note |\n'
  + '|------|-------------|----------|-------:|----------|------|\n';
/* Statement order: each fee straight after its charge, dated later than the
   next charge. NOT date order — that is the point. */
const LINES = [
  '| 2026-09-03 | SHOP ALPHA | Groceries | -100.00 |  |  |',
  '| 2026-09-05 | FOREIGN FEE SHOP ALPHA | Bank fees | -2.00 |  |  |',
  '| 2026-09-04 | SHOP BRAVO | Groceries | -50.00 |  |  |',
  '| 2026-09-06 | FOREIGN FEE SHOP BRAVO | Bank fees | -1.00 |  |  |',
  '| 2026-09-10 | SHOP CHARLIE | Groceries | -70.00 |  |  |',
];
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Bank fees.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit card\ntx_label: "Card"\nbalance: -223.00\nbalance_updated: 2026-09-30\n---\n',
  [FILE]: HEAD + LINES.join('\n') + '\n',
};

const tableLines = text => text.split('\n').filter(l => /^\| \d{4}-/.test(l));
const descs = text => tableLines(text).map(l => l.split('|')[2].trim());
const live = S => S.txFiles['Card/2026-09'];
const tick = () => new Promise(r => setTimeout(r, 20));
async function mount() {
  const m = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
  m.ctx.renderTransactions();
  return m;
}
/* The note field of one row, edited the way a reader edits it. Found by its
   whole accessible name ("Note for <date> <desc>"): "SHOP BRAVO" alone would
   also match the fee row named after it. */
function editNote(ctx, date, desc, value) {
  const input = ctx.$('#txTable').querySelectorAll('input')
    .find(i => i.getAttribute('aria-label') === `Note for ${date} ${desc}`);
  ok(input, `the ${desc} row has a note field`);
  input._fire('change', { target: { value } });
}

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. a one-cell edit changes one line, and moves none -------------- */
    {
      const { ctx } = await mount();
      editNote(ctx, '2026-09-04', 'SHOP BRAVO', 'receipt kept');
      await ctx.saveTransactions();
      const after = ctx.vault._store.get(FILE);
      const before = FILES[FILE];
      eq(descs(after), descs(before), 'every row is still where the statement put it');
      const changed = after.split('\n').filter((l, i) => l !== before.split('\n')[i]);
      eq(changed, ['| 2026-09-04 | SHOP BRAVO | Groceries | -50.00 |  | receipt kept |'],
        'and the only line that differs is the one edited');
    }

    /* ---- 2. Add transaction: in at its date, nothing else moves --------- */
    {
      const { ctx, S } = await mount();
      answers.push({ date: '2026-09-08', desc: 'SHOP DELTA', label: 'Card', dir: 'out', amount: '30', cat: 'Groceries', note: '' });
      await ctx.addTransaction();
      const written = ctx.vault._store.get(FILE);
      eq(descs(written), ['SHOP ALPHA', 'FOREIGN FEE SHOP ALPHA', 'SHOP BRAVO', 'FOREIGN FEE SHOP BRAVO', 'SHOP DELTA', 'SHOP CHARLIE'],
        'the new row lands after the last row dated on or before it; the existing rows keep their order');

      /* The next save of the same month — the reader edits a note — must not
         move the new row again. In memory it was pushed onto the END of the
         month (the add path writes, then mirrors), so this is the save that
         would churn it if the serializer treated memory order as file order. */
      ctx.renderTransactions();
      editNote(ctx, '2026-09-03', 'SHOP ALPHA', 'x');
      await ctx.saveTransactions();
      const again = ctx.vault._store.get(FILE);
      eq(descs(again), descs(written), 'a later save leaves the added row where the add put it');
      eq(live(S).rows.map(r => r.desc), descs(again), 'and memory now holds the rows in the order the file does');
    }

    /* ---- 3. a split: the parts go directly under their parent ----------- */
    {
      const { ctx, S } = await mount();
      const parentRow = live(S).rows.find(r => r.desc === 'FOREIGN FEE SHOP ALPHA');
      answers.push([{ amount: -1.5, cat: 'Bank fees', note: '' }, { amount: -0.5, cat: 'Groceries', note: '' }]);
      await ctx.splitTransaction({ _row: parentRow, _file: live(S), label: 'Card' });
      await ctx.saveTransactions();
      eq(descs(ctx.vault._store.get(FILE)),
        ['SHOP ALPHA', 'FOREIGN FEE SHOP ALPHA', 'FOREIGN FEE SHOP ALPHA', 'FOREIGN FEE SHOP ALPHA', 'SHOP BRAVO', 'FOREIGN FEE SHOP BRAVO', 'SHOP CHARLIE'],
        'parent, then its two parts, then the rest of the statement in its own order');
    }

    /* ---- 4. the import commit's call: append, write, then mirror --------- */
    {
      const { ctx, S } = await mount();
      const existing = live(S);
      const imported = [
        { date: '2026-09-12', desc: 'SHOP ECHO', cat: 'Groceries', amount: -40, excluded: false, note: '' },
        { date: '2026-09-01', desc: 'SHOP ZERO', cat: 'Groceries', amount: -10, excluded: false, note: '' },
      ];
      const text = ctx.serializeTxFile({ ...existing, rows: existing.rows.concat(imported) });
      eq(descs(text), ['SHOP ZERO', 'SHOP ALPHA', 'FOREIGN FEE SHOP ALPHA', 'SHOP BRAVO', 'FOREIGN FEE SHOP BRAVO', 'SHOP CHARLIE', 'SHOP ECHO'],
        'imported rows go in at their dates; the statement order of what was there is kept');
      ctx.vault._store.set(FILE, text);
      existing.rows.push(...imported);          // what commitImport does once the write lands
      existing.dirty = true;                     // a later edit anywhere in the month
      await ctx.saveTransactions();
      eq(ctx.vault._store.get(FILE), text, 'the next save of that month writes the import\'s own bytes back — no churn');
    }

    /* ---- 5. a brand-new month is still written in date order ------------ */
    {
      const { ctx } = await mount();
      const text = ctx.serializeTxFile({ label: 'Card', month: '2026-11', fmRaw: 'kind: transactions', rows: [
        { date: '2026-11-20', desc: 'NEWEST FIRST', cat: '', amount: -1, excluded: false, note: '' },
        { date: '2026-11-02', desc: 'OLDEST', cat: '', amount: -1, excluded: false, note: '' },
        { date: '2026-11-09', desc: 'MIDDLE', cat: '', amount: -1, excluded: false, note: '' },
      ] });
      eq(descs(text), ['OLDEST', 'MIDDLE', 'NEWEST FIRST'],
        'a file with no order of its own yet gets date order, as a newest-first statement always did');
    }

    /* ---- 6. negative control: the fixture is NOT in date order ----------
       So sections 1-4 would fail against a serializer that still sorted. */
    {
      const sorted = [...LINES].sort((a, b) => a.slice(2, 12).localeCompare(b.slice(2, 12)));
      ok(sorted.join('\n') !== LINES.join('\n'), 'negative control: a date sort would reorder this file');
    }
  } finally { unpin(); }
  await tick();
  console.log(`PASS — transactions: a save keeps the file's own row order and puts new rows in at their date (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
