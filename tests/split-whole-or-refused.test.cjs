'use strict';
/* A split is acted on whole, or not at all (2026-11-25 audit, TXN-2, TXN-3,
   TXN-5 / RUL-8).

   A part carries no id back to its parent — only the parent's date and
   description — so three actions on the Transactions page could each leave a
   split half-done, with money counted twice or not at all:

     TXN-2  A parent whose description or date was edited by hand finds none
            of its parts. The chip read "split into 0 · R 100.00 unaccounted"
            and Un-split offered "This removes the 0 parts", removed nothing,
            and un-excluded the parent while its parts stayed in the file: the
            charge counted twice. Now the chip says the parts were not found
            and Un-split refuses, saying what to check in the file.

     TXN-3  Bulk delete removed exactly the filtered rows. A category filter
            selects a parent and only the parts in that category, so the other
            parts were left with no parent (still counted, and the dedup key
            gone so a re-import re-adds the line). Now the selection widens to
            whole splits (tx-role.js wholeSplits), the dialog says by how many,
            and every row removed goes to the delete log. Twins whose parts
            cannot be told apart are LEFT and counted in the dialog, unless
            every row of the group is selected.

     TXN-5  Bulk "Set category" overwrote the categories of every split part
            and parent the search matched — the categories the split dialog
            had just set. Now split rows are skipped and the confirmation says
            how many.

     1. wholeSplits, on plain rows
     2. TXN-2 through the real view: chip wording, Un-split refuses
     3. TXN-3 through the real deleteFilteredTransactions over the real loader
     4. TXN-5 through the real categoriseFilteredTransactions

     node tests/split-whole-or-refused.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const seen = { confirms: [], confirmAnswer: true, fields: null };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal(app, opts) { seen.confirms.push(opts); return seen.confirmAnswer; },
    async askFields() { return seen.fields; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

const T = require('../src/tx-role');
const { parseCsv } = require('../src/csv');

/* ---- 1. wholeSplits ---- */
{
  const row = (amount, split, o = {}) => ({ date: '2026-07-05', desc: 'UBER TRIP', cat: 'Transport', amount,
    excluded: split === 'parent', note: '', split, ...o });
  const P = row(-100, 'parent'), a = row(-60, 'part'), b = row(-40, 'part', { cat: 'Fun' });
  const X = row(-9, '', { desc: 'COFFEE' });
  const rows = [X, P, a, b];
  eq(T.wholeSplits(rows, [b, X]), { take: [X, P, a, b], left: [] }, 'a selected part brings its parent and its sibling');
  eq(T.wholeSplits(rows, [P]), { take: [P, a, b], left: [] }, 'a selected parent brings every part');
  eq(T.wholeSplits(rows, [X]), { take: [X], left: [] }, 'a row outside any split is just itself');
  eq(T.wholeSplits(rows, []), { take: [], left: [] }, 'nothing selected, nothing taken');
  const orphan = row(-5, 'part', { desc: 'GONE' });
  eq(T.wholeSplits([orphan, X], [orphan]), { take: [orphan], left: [] }, 'a part whose parent is gone is just itself');

  // Twins told apart by position: each part brings only its own split.
  const P1 = row(-100, 'parent'), p1a = row(-60, 'part'), p1b = row(-40, 'part', { cat: 'Fun' });
  const P2 = row(-50, 'parent'), p2a = row(-30, 'part'), p2b = row(-20, 'part', { cat: 'Fun' });
  eq(T.wholeSplits([P1, p1a, p1b, P2, p2a, p2b], [p2b]).take, [P2, p2a, p2b], 'a tidy twin: the part brings ITS split, not the other');
  // Twins that cannot be told apart: left, unless all of the group is selected.
  const scrambled = [P1, P2, p1a, p1b, p2a, p2b];
  eq(T.wholeSplits(scrambled, [p1b, p2b, X]), { take: [], left: [p1b, p2b] }, 'ambiguous twins, partly selected: left, not guessed at');
  eq(T.wholeSplits(scrambled, scrambled).take, scrambled, 'ambiguous twins, all selected: deleting all of it splits nothing');
}

/* ---- the real Transactions view ---- */
const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const FM = '---\naccount: "Cheque"\nmonth: 2026-07\n---\n\n';
const TX = `${B}/Transactions/Cheque/2026-07.md`;
const LOG = `${B}/Data/Deleted transactions.csv`;
const FILES = (table) => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Transport.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Fun.md`]: '---\ntype: expense\ncolor: "#777777"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#666666"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
  [TX]: FM + HEAD + table,
});
/* One table line. Synthetic merchants only. */
const line = (amount, split, { desc = 'UBER TRIP', cat = 'Transport', date = '2026-07-05' } = {}) =>
  `| ${date} | ${desc} | ${cat} | ${amount.toFixed(2)} | ${split === 'parent' ? 'yes' : ''} | | ${split} |\n`;

async function mount(table) {
  const ctx = makeCtx(FILES(table));
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require('../src/views/transactions')(ctx);
  ctx.render = () => {}; ctx.switchView = () => {}; ctx.reloadFromDisk = async () => {};
  ctx.renderTransactions();
  return { ctx, S, $ };
}
const file = S => S.txFiles['Cheque/2026-07'];
const shape = S => file(S).rows.map(r => `${r.split || '-'}:${r.cat}:${r.amount}`);
const chipButtons = $ => descend($('#txTable')).filter(n => n.tagName === 'BUTTON' && /caveat-chip-btn/.test(n.className));
const tick = () => new Promise(r => setImmediate(r));
const flush = async () => { await tick(); await tick(); };
/* Set the three filters the way the toolbar would, straight before the act —
   a render rebuilds the selects' options. */
const filter = ($, { account = '', category = '', search = '' }) => {
  $('#txAccount').value = account; $('#txCategory').value = category; $('#txSearch').value = search;
};
/* The rows a month file holds ON DISK, read back through the real loader. */
async function onDisk(ctx) {
  await ctx.loadVault();
  const f = ctx.S.txFiles['Cheque/2026-07'];
  return f ? f.rows.map(r => `${r.split || '-'}:${r.cat}:${r.amount}`) : [];
}
const logRows = ctx => {
  const text = ctx.vault._store.get(LOG);
  if (!text) return [];
  const [head, ...rows] = parseCsv(text);
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
};

(async () => {
  /* ---- 2. TXN-2: a parent whose parts can no longer be found ---- */
  for (const [what, parentLine] of [
    ['description', line(-100, 'parent', { desc: 'UBER TRIP (work)' })],
    ['date', line(-100, 'parent', { date: '2026-07-06' })],
  ]) {
    const { ctx, S, $ } = await mount(parentLine + line(-60, 'part') + line(-40, 'part', { cat: 'Fun' }));
    const chips = chipButtons($);
    eq(chips.length, 1, `${what} edited: the parent still gets its chip`);
    const text = String(chips[0].textContent).trim();
    eq(text, 'split · parts not found', `${what} edited: the chip says the parts were not found`);
    ok(!/split into 0/.test(text) && !/unaccounted/.test(text), `${what} edited: and no longer reads as money missing: ${JSON.stringify(text)}`);

    seen.confirms = []; seen.confirmAnswer = true;
    const before = shape(S);
    const n = ctx._toasts.length;
    chips[0].click();
    await flush();
    eq(seen.confirms.length, 0, `${what} edited: Un-split does not offer to remove 0 parts`);
    eq(shape(S), before, `${what} edited: nothing removed, nothing changed`);
    const parent = file(S).rows.find(r => r.split === 'parent');
    ok(parent && parent.excluded === true, `${what} edited: the parent stays excluded, so the parts are not counted on top of it`);
    eq(file(S).dirty, false, `${what} edited: and nothing is marked unsaved`);
    const said = ctx._toasts[n] || {};
    ok(said.bad && /No split parts with this line's date and description were found in Transactions\/Cheque\/2026-07\.md/.test(said.msg)
      && /change it back to match its parts/.test(said.msg), `${what} edited: the refusal says what to check in which file: ${JSON.stringify(said.msg)}`);
  }
  // A healthy split is unchanged by any of that.
  {
    const { $ } = await mount(line(-100, 'parent') + line(-60, 'part') + line(-40, 'part', { cat: 'Fun' }));
    eq(String(chipButtons($)[0].textContent).trim(), 'split into 2', 'a healthy split still reads "split into 2"');
  }

  /* ---- 3. TXN-3: bulk delete takes whole splits ---- */
  const SPLIT = line(-100, 'parent') + line(-60, 'part') + line(-40, 'part', { cat: 'Fun' });
  const COFFEE = line(-9, '', { desc: 'COFFEE', cat: 'Fun' });
  // a) A category filter selecting one part: its parent and sibling go too.
  {
    const { ctx, S, $ } = await mount(COFFEE + SPLIT);
    filter($, { category: 'Fun' });
    seen.confirms = []; seen.confirmAnswer = true;
    await ctx.deleteFilteredTransactions();
    eq(seen.confirms.length, 1, 'a) one confirmation');
    const c = seen.confirms[0];
    ok(/Delete all 2 rows matching/.test(c.message), `a) the dialog still counts what the filters matched: ${JSON.stringify(c.message)}`);
    ok(/2 more rows go with them, 4 in all: a split is deleted whole/.test(c.message),
      `a) and says how many the splits add, and the total: ${JSON.stringify(c.message)}`);
    ok(!/may not have selected/.test(c.message), 'a) the old "may not have selected" sentence is gone — it is no longer true');
    eq(c.confirmText, 'Delete 4 rows', 'a) the button names the expanded count');
    eq(shape(S), [], 'a) in memory: the whole split and the coffee are gone, no parentless part');
    eq(await onDisk(ctx), [], 'a) on disk too');
    eq(logRows(ctx).map(r => `${r.Split || '-'}:${r.Category}:${r.Amount}`).sort(),
      ['-:Fun:-9.00', 'parent:Transport:-100.00', 'part:Fun:-40.00', 'part:Transport:-60.00'],
      'a) every removed row is in the delete log, the expanded ones included');
  }
  // b) A filter selecting the parent and one part: the other part comes along.
  {
    const { ctx, S, $ } = await mount(COFFEE + SPLIT);
    filter($, { category: 'Transport' });
    seen.confirms = []; seen.confirmAnswer = true;
    await ctx.deleteFilteredTransactions();
    ok(/1 more row goes with them, 3 in all/.test(seen.confirms[0].message), `b) one more row: ${JSON.stringify(seen.confirms[0].message)}`);
    eq(shape(S), ['-:Fun:-9'], 'b) the split goes whole, the coffee stays');
    eq(await onDisk(ctx), ['-:Fun:-9'], 'b) on disk too');
  }
  // c) Selecting the whole split already adds nothing and says nothing more.
  {
    const { ctx, S, $ } = await mount(COFFEE + SPLIT);
    filter($, { search: 'uber' });
    seen.confirms = []; seen.confirmAnswer = true;
    await ctx.deleteFilteredTransactions();
    ok(!/more rows? goes? with them/.test(seen.confirms[0].message), 'c) nothing added, no splits sentence');
    eq(seen.confirms[0].confirmText, 'Delete 3 rows', 'c) the count is the selection');
    eq(shape(S), ['-:Fun:-9'], 'c) the split is gone');
  }
  // d) Twins told apart by position: a part brings ITS split only.
  const TWINS = line(-100, 'parent') + line(-60, 'part') + line(-40, 'part', { cat: 'Fun' })
    + line(-50, 'parent') + line(-30, 'part') + line(-20, 'part', { cat: 'Groceries' });
  {
    const { ctx, S, $ } = await mount(TWINS);
    filter($, { category: 'Groceries' });
    seen.confirms = []; seen.confirmAnswer = true;
    await ctx.deleteFilteredTransactions();
    eq(seen.confirms[0].confirmText, 'Delete 3 rows', 'd) the R50 split, whole');
    eq(shape(S), ['parent:Transport:-100', 'part:Transport:-60', 'part:Fun:-40'], 'd) the R100 split is untouched');
    const P = file(S).rows[0];
    eq(T.splitShortfall(P, T.splitPartsOf(file(S).rows, P)), 0, 'd) and still adds up');
  }
  // e) Twins that cannot be told apart, partly selected: left, counted, the rest deleted.
  const SCRAMBLED = line(-100, 'parent') + line(-50, 'parent') + line(-60, 'part') + line(-40, 'part', { cat: 'Fun' })
    + line(-30, 'part') + line(-20, 'part', { cat: 'Fun' });
  {
    const { ctx, S, $ } = await mount(COFFEE + SCRAMBLED);
    filter($, { category: 'Fun' });
    seen.confirms = []; seen.confirmAnswer = true;
    await ctx.deleteFilteredTransactions();
    const c = seen.confirms[0];
    ok(/2 matching rows are left alone: they belong to identical splits on the same day whose parts cannot be told apart/.test(c.message),
      `e) the dialog says how many are left, and why, before the reader agrees: ${JSON.stringify(c.message)}`);
    eq(c.confirmText, 'Delete 1 row', 'e) only the coffee is deleted');
    eq(shape(S), ['parent:Transport:-100', 'parent:Transport:-50', 'part:Transport:-60', 'part:Fun:-40', 'part:Transport:-30', 'part:Fun:-20'],
      'e) the ambiguous group is left exactly as it was');
    eq(logRows(ctx).length, 1, 'e) and the log holds only the row that went');
  }
  // f) ... and with nothing else selected, refused with that sentence, nothing written.
  {
    const { ctx, S, $ } = await mount(SCRAMBLED);
    filter($, { category: 'Fun' });
    seen.confirms = []; seen.confirmAnswer = true;
    const n = ctx._toasts.length;
    await ctx.deleteFilteredTransactions();
    eq(seen.confirms.length, 0, 'f) no dialog when every selected row is left');
    ok(ctx._toasts[n] && ctx._toasts[n].bad && /2 matching rows are left alone/.test(ctx._toasts[n].msg), 'f) the toast says why');
    eq(shape(S).length, 6, 'f) nothing removed');
    eq(ctx.vault._store.has(LOG), false, 'f) and no log written');
  }
  // g) The whole ambiguous group selected: deleting all of it splits nothing.
  {
    const { ctx, S, $ } = await mount(COFFEE + SCRAMBLED);
    filter($, { search: 'uber' });
    seen.confirms = []; seen.confirmAnswer = true;
    await ctx.deleteFilteredTransactions();
    ok(!/left alone/.test(seen.confirms[0].message), 'g) nothing is left');
    eq(shape(S), ['-:Fun:-9'], 'g) the whole group goes');
  }
  // h) Declining changes nothing.
  {
    const { ctx, S, $ } = await mount(COFFEE + SPLIT);
    filter($, { category: 'Fun' });
    seen.confirms = []; seen.confirmAnswer = false;
    await ctx.deleteFilteredTransactions();
    eq(shape(S).length, 4, 'h) declined: every row stays');
    eq(ctx.vault._store.has(LOG), false, 'h) and no log written');
  }

  /* ---- 4. TXN-5: bulk Set category leaves split rows alone ---- */
  const SHOP = line(-100, 'parent', { desc: 'WOOLWORTHS', cat: 'Groceries' })
    + line(-60, 'part', { desc: 'WOOLWORTHS', cat: 'Groceries' })
    + line(-40, 'part', { desc: 'WOOLWORTHS', cat: 'Fun' })
    + line(-25, '', { desc: 'WOOLWORTHS', cat: '' });
  {
    const { ctx, S, $ } = await mount(SHOP);
    filter($, { search: 'woolworths' });
    seen.confirms = []; seen.confirmAnswer = true; seen.fields = { cat: 'Transport' };
    await ctx.categoriseFilteredTransactions();
    const c = seen.confirms[0];
    ok(/^1 row will be set to Transport\./.test(c.message), `the confirmation counts only the row it will change: ${JSON.stringify(c.message)}`);
    ok(/3 matching rows belong to splits and keep their categories/.test(c.message), `and says how many split rows it leaves: ${JSON.stringify(c.message)}`);
    eq(c.confirmText, 'Set category (1)', 'the button counts the same');
    eq(shape(S), ['parent:Groceries:-100', 'part:Groceries:-60', 'part:Fun:-40', '-:Transport:-25'],
      'the split\'s categories are kept; the ordinary row is set');
  }
  {
    const { ctx, S, $ } = await mount(SHOP.split('\n').slice(0, 3).join('\n') + '\n');
    filter($, { search: 'woolworths' });
    seen.confirms = []; seen.confirmAnswer = true; seen.fields = { cat: 'Transport' };
    const n = ctx._toasts.length;
    await ctx.categoriseFilteredTransactions();
    eq(seen.confirms.length, 0, 'only split rows selected: no confirmation for zero rows');
    ok(ctx._toasts[n] && ctx._toasts[n].bad && /3 matching rows belong to splits/.test(ctx._toasts[n].msg), 'the toast says why');
    eq(shape(S), ['parent:Groceries:-100', 'part:Groceries:-60', 'part:Fun:-40'], 'nothing changed');
    eq(file(S).dirty, false, 'nothing marked unsaved');
  }

  console.log(`PASS split-whole-or-refused — a split is deleted, categorised or un-split whole, or refused with a reason (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
