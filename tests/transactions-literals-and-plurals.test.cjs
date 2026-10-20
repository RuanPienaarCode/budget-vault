'use strict';
/* English that sat inside the translated Transactions view, and two plural
   sentences that picked the wrong form (2026-10-14 audit, L8-09 and L8-08).

   L8-09  The rule-correction dialog, the "Set category" button and dialogs,
          the filter phrases inside the bulk-delete confirmation, the "N of the
          new parts still need a category" toast and the "Added …" toast were
          typed as English literals in a view that is otherwise translated, so
          an Afrikaans reader got English in the middle of Afrikaans. They were
          left as literals only because lang files could not take a new key
          from this file; they are keyed (tx.ruleFix.*, tx.bulkCat.*,
          tx.filter.*, tx.split.uncategorised, tx.add.done) in all 12 tables.
          The filter phrases written INTO a file (the export's "Filtered by"
          line and file name) stay literal English: a file is not the page.

   L8-08  t() picks a plural on `count` alone, and fr / pt / hi give 0 their
          singular. tx.bulk.failed was passed the number of files written
          before the failure — 0 when the first write throws — so those three
          printed "Stopped after 1 file" for nothing written. The zero case has
          its own sentence (tx.bulk.failedNone, as tx.err.saveNone does). And
          tx.bulk.done printed "from 1 files" for many rows in one month file:
          that case has its own sentence too (tx.bulk.doneOneFile).

   Driven through the real loader and the real Transactions page; only the
   dialogs are answered.
     node tests/transactions-literals-and-plurals.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const seen = { fields: [], confirms: [] };
const answer = { fields: null, confirm: true, split: null };
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async (_app, title, fields) => { seen.fields.push({ title, fields }); return answer.fields; },
      confirmModal: async (_app, opts) => { seen.confirms.push(opts); return answer.confirm; },
      askSplit: async () => answer.split,
      askRulesCleanup: async () => false, askBudgetReslice: async () => false,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
/* mountFor re-requires src/ fresh, so ask the cache again after every mount. */
const I = () => require('../src/i18n');

const B = 'Budget';
const TXH = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  ...Object.fromEntries(['Groceries', 'Dining', 'Fuel'].map(c => [`${B}/Categories/${c}.md`, '---\ntype: expense\ncolor: "#888888"\n---\n'])),
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Data/Categorisation Rules.csv`]: 'pattern,category\nfreshmart,Groceries\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: TXH
    + '| 2026-08-03 | FRESHMART CLAREMONT | Groceries | -100.00 |  |  |  |\n'
    + '| 2026-08-20 | SHELL RONDEBOSCH | Fuel | -500.00 |  |  |  |\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: TXH
    + '| 2026-09-05 | FRESHMART CLAREMONT | Groceries | -90.00 |  |  |  |\n'
    + '| 2026-09-08 | SHELL RONDEBOSCH | Fuel | -450.00 |  |  |  |\n'
    + '| 2026-09-09 | SHELL MAIN ROAD | Fuel | -250.00 |  |  |  |\n',
};
const tick = () => new Promise(r => setTimeout(r, 20));
async function mount(lang) {
  const m = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
  m.ctx.render = () => {};
  if (lang) I().setLanguage(lang);         // after mount: loading the vault resets the language to its setting
  return m;
}
const filter = (ctx, { acc = '', cat = '', q = '' } = {}) => {
  ctx.$('#txAccount').value = acc; ctx.$('#txCategory').value = cat; ctx.$('#txSearch').value = q;
};
const lastToast = ctx => (ctx._toasts[ctx._toasts.length - 1] || {}).msg;
const clear = () => { seen.fields.length = 0; seen.confirms.length = 0; };

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- L8-09: the rule-correction dialog, in Afrikaans -------------------- */
    {
      const { ctx } = await mount();
      I().setLanguage('af');
      ctx.renderTransactions();
      const btn = ctx.$('#txTable').querySelectorAll('.cat-cell-btn')
        .find(b => /2026-09-05/.test(b.getAttribute('aria-label') || '') && /FRESHMART/.test(b.getAttribute('aria-label') || ''));
      assert.ok(btn, 'the row renders its category control');
      clear(); answer.confirm = true;
      btn._fire('click');
      const sel = btn._parent.querySelectorAll('.category-select')[0];
      sel.value = 'Dining'; sel._fire('change');
      await tick();
      const i = I();
      eq(seen.confirms.length, 1, 'the correction asks about the rule');
      const q = seen.confirms[0];
      eq(q.title, i.t('tx.ruleFix.title'), 'the title is the Afrikaans key');
      ok(q.title !== 'Update the matching rule too?', 'and not the English literal');
      eq(q.cancelText, i.t('tx.ruleFix.keep'), '"Just this row" is translated');
      eq(q.confirmText, i.t('tx.ruleFix.confirm'), '"Update the rule" is translated');
      eq(q.message, i.t('tx.ruleFix.msg', { pattern: 'freshmart', old: 'Groceries', cat: 'Dining', reach: i.t('tx.ruleFix.reach', { count: 2 }) }),
        'the message is the Afrikaans key, with the plural reach sentence');
      ok(!/Rows matching|It decides|Update it to/.test(q.message), 'no English survives in it');
      ok(q.message.includes(q.cancelText), 'and it names the safe button by the label that button carries');
      eq(lastToast(ctx), i.t('tx.ruleFix.done', { pattern: 'freshmart', cat: 'Dining', old: 'Groceries' }), 'the success toast is translated');
    }

    /* ---- L8-09: "Set category", button and dialogs, in German ---------------- */
    {
      const { ctx } = await mount();
      I().setLanguage('de');
      const i = I();
      /* The stub gives every id an element but no parent; the real shell puts the
         delete button in a toolbar, which is where the Set category button is
         inserted beside it. Give the stub one. */
      const bar = ctx.$('#txToolbarForTest');
      const del = ctx.$('#txDeleteFiltered');
      bar.append(del); del.parentNode = bar;
      ctx.renderTransactions();
      const label = bar.children.map(c => c.textContent).join('|');
      ok(bar.children.length === 2 && label.includes(i.t('tx.bulkCat.button')) && !/Set category/.test(label), `the toolbar button is translated: ${label}`);
      filter(ctx, { cat: 'Fuel' });
      clear(); answer.fields = { cat: 'Dining' }; answer.confirm = true;
      await ctx.categoriseFilteredTransactions();
      eq(seen.fields[0].title, i.t('tx.bulkCat.title'), 'the picker dialog title is translated');
      eq(seen.confirms[0].title, i.t('tx.bulkCat.title'), 'the confirmation title too');
      eq(seen.confirms[0].message, i.t('tx.bulkCat.msg', { count: 2, cat: 'Dining' }), 'the confirmation counts the rows in German');
      eq(seen.confirms[0].confirmText, i.t('tx.bulkCat.confirm', { count: 2 }), 'and so does the confirm button');
      eq(lastToast(ctx), i.t('tx.bulkCat.done', { count: 2 }), 'the done toast too');
      ok(!/row|Set category|recategorised/.test(seen.confirms[0].message + seen.confirms[0].confirmText + lastToast(ctx)), 'no English words left');
    }

    /* ---- L8-09: filter phrases inside the bulk-delete confirmation ---------- */
    {
      const { ctx } = await mount();
      I().setLanguage('af');
      const i = I();
      filter(ctx, { acc: 'Cheque', cat: '__none__', q: 'shell' });
      const un = ctx.filteredRows();
      ok(un.filters.includes('category: Uncategorised'), 'the filters written into a file stay literal English');
      eq(un.labels[1], i.t('tx.filter.category', { name: i.t('tx.uncategorised') }), 'the label says "Uncategorised" in the reader\'s language');
      filter(ctx, { acc: 'Cheque', cat: 'Fuel', q: 'shell' });
      ctx.setTxInBudgetOnly('Fuel');
      const f = ctx.filteredRows();
      eq(f.labels.length, f.filters.length, 'one reader-facing label per filter');
      ok(f.filters.includes('account: Cheque') && f.filters.includes('category: Fuel'), 'the filters written into a file stay literal English');
      ok(f.names.includes('account Cheque') && f.names.includes('Dashboard rows'), 'and so do the file-name phrases');
      eq(f.labels.slice(0, 3), [i.t('tx.filter.account', { name: 'Cheque' }), i.t('tx.filter.category', { name: 'Fuel' }), i.t('tx.filter.search', { text: 'shell' })],
        'the labels are the reader\'s language');
      ok(f.labels.includes(i.t('tx.filter.dashboard')) && f.labels.includes(i.t('tx.filter.today')), 'and the Dashboard scope and date sentences');
      filter(ctx, { acc: 'Cheque' });
      ctx.setTxInBudgetOnly(null);
      clear(); answer.confirm = false;
      await ctx.deleteFilteredTransactions();
      const msg = seen.confirms[0].message;
      ok(msg.includes(i.t('tx.filter.account', { name: 'Cheque' })), `the delete confirmation names the filter in Afrikaans: ${msg.slice(0, 80)}`);
      ok(!/account:/.test(msg), 'and not in English');
    }

    /* ---- L8-09: the "Added …" toast and the split toast ---------------------- */
    {
      const { ctx } = await mount();
      I().setLanguage('de');
      const i = I();
      answer.fields = { date: '2026-09-20', desc: 'Corner Cafe', label: 'Cheque', dir: 'out', amount: '35', cat: 'Dining', note: '' };
      await ctx.addTransaction();
      /* The amount is named as the flow it is, "−R 35,00" — the sign before the
         symbol (2026-10-20 audit, D2-04) — not money()'s balance form "R -35,00". */
      eq(lastToast(ctx), i.t('tx.add.done', { amount: '−' + ctx.money(35), account: 'Cheque', month: '2026-09' }), 'the add toast is translated');
      ok(!/^Added/.test(lastToast(ctx)), 'and does not start with English');

      filter(ctx, { cat: 'Fuel' });
      const item = ctx.filteredRows().rows.find(r => r._row.desc === 'SHELL MAIN ROAD');
      answer.split = [{ cat: 'Fuel', amount: -150, note: '' }, { cat: '', amount: -100, note: '' }];
      await ctx.splitTransaction(item);
      eq(lastToast(ctx), i.t('tx.split.done', { n: 2 }) + ' ' + i.t('tx.split.uncategorised', { count: 1 }), 'the split toast names the part still needing a category, in German');
      ok(!/still need/.test(lastToast(ctx)), 'no English clause');
    }

    /* ---- L8-08: first write fails -> 0 files written ------------------------- */
    for (const lang of ['en', 'fr', 'pt', 'hi', 'af']) {
      const { ctx } = await mount();
      I().setLanguage(lang);
      const i = I();
      filter(ctx, { cat: 'Fuel' });
      const realModify = ctx.vault.modify.bind(ctx.vault);
      ctx.vault.modify = async (f, data) => {
        if (/Transactions\/Cheque\/2026-0[89]\.md$/.test(f.path)) throw new Error('EBUSY');
        return realModify(f, data);
      };
      clear(); answer.confirm = true;
      await ctx.deleteFilteredTransactions();
      const msg = lastToast(ctx);
      eq(msg, i.t('tx.bulk.failedNone', { error: 'EBUSY' }), `${lang}: nothing written has its own sentence`);
      ok(/EBUSY/.test(msg), `${lang}: it still carries the error`);
      ok(msg !== i.t('tx.bulk.failed', { count: 0, error: 'EBUSY' }) || lang === 'en' || lang === 'af', `${lang}: and is not the plural entry that 0 maps onto`);
      ok(!/\b1\b/.test(msg), `${lang}: no hard-coded "1" in a sentence about zero files: ${msg}`);
    }
    {
      // A write that fails AFTER the first still says how far it got.
      const { ctx } = await mount();
      I().setLanguage('en');
      filter(ctx, { cat: 'Fuel' });
      ctx.$('#txWholeHistory').checked = true;      // Fuel in both months: two files
      const realModify = ctx.vault.modify.bind(ctx.vault);
      let n = 0;
      ctx.vault.modify = async (f, data) => {
        if (/Transactions\/Cheque\/2026-0[89]\.md$/.test(f.path) && ++n === 2) throw new Error('EBUSY');
        return realModify(f, data);
      };
      clear(); answer.confirm = true;
      await ctx.deleteFilteredTransactions();
      eq(lastToast(ctx), I().t('tx.bulk.failed', { count: 1, error: 'EBUSY' }), 'control: one file written before the failure keeps the counted sentence');
    }

    /* ---- L8-08: many rows, ONE file -> "from 1 file" ------------------------- */
    {
      const { ctx } = await mount();
      I().setLanguage('en');
      const i = I();
      filter(ctx, { q: 'shell' });
      // narrow to the September file only: two SHELL rows live there
      ctx.$('#txWholeHistory').checked = false;
      const f = ctx.filteredRows();
      eq(f.rows.length, 2, 'fixture: two rows, both in the September file');
      clear(); answer.confirm = true;
      await ctx.deleteFilteredTransactions();
      const msg = lastToast(ctx);
      eq(msg, i.t('tx.bulk.doneOneFile', { count: 2, path: 'Data/Deleted transactions.csv' }), 'two rows from one file say so');
      ok(/from 1 file\b/.test(msg) && !/1 files/.test(msg), `and the noun agrees: ${msg}`);
    }
    {
      // Two files keep the original sentence, and one row is still "Deleted 1 row".
      const { ctx } = await mount();
      I().setLanguage('en');
      filter(ctx, { cat: 'Fuel' });
      ctx.$('#txWholeHistory').checked = true;
      clear(); answer.confirm = true;
      await ctx.deleteFilteredTransactions();
      ok(/Deleted 3 rows from 2 files/.test(lastToast(ctx)), `control: ${lastToast(ctx)}`);
      const { ctx: c2 } = await mount();
      I().setLanguage('en');
      filter(c2, { q: 'claremont' });
      c2.$('#txWholeHistory').checked = false;
      await c2.deleteFilteredTransactions();
      ok(/^Deleted 1 row · a copy is in /.test(lastToast(c2)), `control: a single row keeps the singular sentence: ${lastToast(c2)}`);
    }
  } finally { unpin(); }
  console.log(`PASS transactions-literals-and-plurals — the view's English is keyed, and 0 files / 1 file get their own sentences (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
