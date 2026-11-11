'use strict';
/* What the reader TYPED survives a same-book reload; it still never lands in
   another book (the 2026-11 final review of ADR 0009's books).

   f7c1bb2 bound every dialog-then-write flow to the exact LOAD it began from.
   Right for a flow that edits objects it read (an undo, a bulk delete, a Save
   loop): after a reload those objects are nobody's. Wrong for a flow that only
   CREATES from what was typed — a note, a receipt slip, a category, an
   account, a transaction — and reads whatever state it needs after its dialog
   closes. On a single-book vault, which is every vault today, the only way that
   stamp could fire was a SAME-book reload: a phone's sync of an unrelated month
   while the dialog was open, which the watcher reloaded for because a dialog
   mounts outside the view and isEditing() never saw it. The write refused as
   RELOADED and the reader's typing was gone. The reviewer's repro lost a note,
   a receipt and a balance that way.

   Pinned here over the REAL views and the REAL loader:

     1. single-book, same-book reload during the dialog → the note, the
        receipt, the category, the account, the transaction and the balance
        are all written, with their normal success toast; the balance lands on
        the account's CURRENT frontmatter (a line the phone added is kept), not
        the snapshot the dialog was opened over;
     2. multi-book, a switch during the same dialogs → every one refused, the
        book switched to byte-identical, a red toast;
     3. an exact-load flow (undo-import) still refuses a same-book reload —
        its objects are gone with it (NEGATIVE CONTROL for 1);
     4. a commit import whose state was replaced offers no Undo it does not
        have; learnRules answers null, not 0, when it learned nothing because
        the state was replaced, and the Save toast says so;
     5. isEditing() counts an open modal (controller.js modalOpenIn), so the
        scheduler waits for the dialog to close.

     node tests/books-create-under-reload.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const hooks = { dialog: null };
const answers = [];
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)(modal|receipt-modal)(\.js)?$/.test(request)) {
    const open = async v => { const h = hooks.dialog; hooks.dialog = null; if (h) await h(); return v; };
    return {
      askFields: async () => open(answers.shift() || null),
      askSplit: async () => open(null),
      confirmModal: async () => open(true),
      askRulesCleanup: async () => open(true),
      askBudgetReslice: async () => open(null),
      askReceipt: async () => open(answers.shift() || null),
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const H = require('./helpers/harness.cjs');
H.stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { buildIndex } = require('../src/dedupe');
const i18n = require('../src/i18n');
i18n.setLanguage('en');

const HOME = 'Budget', ACME = 'Clients/Acme';
const month = (m, rows) => `---\naccount: "Cheque"\nmonth: ${m}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n`
  + rows.map(r => `| ${r[0]} | ${r[1]} | Food | ${r[2]} |  |  |\n`).join('');
const book = (b, tag) => ({
  [`${b}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${b}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${b}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [`${b}/Transactions/Cheque/2026-08.md`]: month('2026-08', [['2026-08-02', `${tag} Deli`, '-15.00']]),
  [`${b}/Transactions/Cheque/2026-09.md`]: month('2026-09', [['2026-09-02', `${tag} Cafe`, '-35.00']]),
});
const SINGLE = book(HOME, 'HOME');
const MULTI = { ...book(HOME, 'HOME'), ...book(ACME, 'ACME') };

async function mount(files, { books = false } = {}) {
  const { ctx } = await mountFor(files, { period: '2026-09', budgetFolder: HOME });
  ctx.render = () => {}; ctx.switchView = () => {};
  const store = {};
  ctx.plugin.app = { vault: ctx.vault, loadLocalStorage: k => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { store[k] = v; } };
  if (books) ctx.plugin.settings.books = [{ folder: HOME, label: 'Home' }, { folder: ACME, label: 'Acme' }];
  /* A phone edits a file and sync delivers it; the watcher's reload commits. */
  const syncReload = (rel = `${HOME}/Transactions/Cheque/2026-08.md`, edit = t => t.replace('Deli', 'Deli (edited on phone)')) => async () => {
    ctx.vault._store.set(rel, edit(ctx.vault._store.get(rel)));
    await ctx.loadVault();
  };
  const switchAndCommit = async () => { ctx.plugin.setOpenBookLocal(ACME); await ctx.loadVault(); };
  return { ctx, syncReload, switchAndCommit };
}
const created = (ctx, files) => [...ctx.vault._store.keys()].filter(k => !(k in files) && !k.endsWith('/.folder')).sort();
const under = (m, folder) => [...m].filter(([k]) => k.startsWith(folder + '/') && !k.endsWith('/.folder'));

/* One create flow: how to start it, what it answers, what it should create. */
const FLOWS = [
  { name: 'note', answer: { title: 'Why the car loan', about: 'general\u001F', body: 'Three paragraphs the reader typed.' },
    run: ctx => ctx.addNote(), expect: [/Notes\/2026-10-07 Why the car loan\.md$/] },
  { name: 'receipt', answer: { store: 'Woolies', date: '2026-10-06', time: '17:05', total: 123.45,
      items: [{ name: 'Milk', barcode: '', qty: 1, amount: 23.45, category: 'Food', healthy: true },
        { name: 'Bread', barcode: '', qty: 1, amount: 100, category: 'Food', healthy: false }] },
    run: ctx => ctx.addFoodReceipt(), expect: [/Receipts\/2026-10\/2026-10-06 Woolies 1705\.md$/, /Receipts\/Food Items\.md$/] },
  { name: 'category', answer: { name: 'Coffee', type: 'expense', fixed: [] },
    run: ctx => ctx.promptCreateCategory(), expect: [/Categories\/Coffee\.md$/] },
  { name: 'account', answer: { name: 'Savings Pot', type: 'savings', institution: '', balance: '100', currency_code: '' },
    run: ctx => ctx.addAccount(), expect: [/Accounts\/Savings Pot\.md$/] },
];

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. single book, same-book reload during the dialog ---------------- */
    for (const f of FLOWS) {
      const m = await mount(SINGLE);
      answers.push(f.answer);
      hooks.dialog = m.syncReload();
      const t0 = m.ctx._toasts.length;
      await f.run(m.ctx);
      const made = created(m.ctx, SINGLE);
      for (const re of f.expect) ok(made.some(p => re.test(p) && p.startsWith(HOME + '/')), `single book, reload during the dialog: the ${f.name} is written (${made.join(', ') || 'nothing'})`);
      ok(m.ctx._toasts.slice(t0).every(t => !t.bad), `… with no refusal (${JSON.stringify(m.ctx._toasts.slice(t0).map(t => t.msg))})`);
    }
    {
      const m = await mount(SINGLE);
      answers.push({ date: '2026-09-21', desc: 'TYPED ROW', label: 'Cheque', dir: 'out', amount: '12', cat: 'Food', note: '' });
      hooks.dialog = m.syncReload();
      await m.ctx.addTransaction();
      ok(/TYPED ROW/.test(m.ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-09.md`)), 'single book, reload during the dialog: the typed transaction is written');
      ok(/Deli \(edited on phone\)/.test(m.ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-08.md`)), '… and the phone\'s edit to the other month is untouched');
    }
    {
      /* The balance, with the phone's edit landing ON THE ACCOUNT FILE itself:
         the typed figure must land on the frontmatter as it is now. */
      const m = await mount(SINGLE);
      const a = m.ctx.S.accounts.find(x => x.name === 'Cheque');
      answers.push({ balance: '999.00', as_at: '2026-10-01' });
      hooks.dialog = m.syncReload(`${HOME}/Accounts/Cheque.md`, t => t.replace('type: checking\n', 'type: checking\ninstitution: Phone Bank\n'));
      const t0 = m.ctx._toasts.length;
      await m.ctx.editBalance(a);
      const file = m.ctx.vault._store.get(`${HOME}/Accounts/Cheque.md`);
      ok(/balance: 999(\.00)?/.test(file), 'single book, reload during the dialog: the typed balance is written');
      ok(/institution: Phone Bank/.test(file), '… onto the account\'s CURRENT frontmatter — the line the phone added is kept, not the snapshot\'s');
      ok(m.ctx._toasts.slice(t0).every(t => !t.bad), '… with no refusal');
    }

    /* ---- 2. multi book, a switch during the dialog ------------------------- */
    for (const f of FLOWS) {
      const m = await mount(MULTI, { books: true });
      const acmeBefore = under(m.ctx.vault._store, ACME);
      answers.push(f.answer);
      hooks.dialog = m.switchAndCommit;
      const t0 = m.ctx._toasts.length;
      await f.run(m.ctx);
      eq(under(m.ctx.vault._store, ACME), acmeBefore, `two books, switch during the ${f.name} dialog: the book switched to is byte-identical`);
      eq(created(m.ctx, MULTI), [], `… and nothing was created anywhere`);
      ok(m.ctx._toasts.slice(t0).some(t => t.bad), '… and the reader is told, in red');
    }
    {
      const m = await mount(MULTI, { books: true });
      const acmeBefore = under(m.ctx.vault._store, ACME);
      const a = m.ctx.S.accounts.find(x => x.name === 'Cheque');
      answers.push({ balance: '999.00', as_at: '2026-10-01' });
      hooks.dialog = m.switchAndCommit;
      await m.ctx.editBalance(a);
      eq(under(m.ctx.vault._store, ACME), acmeBefore, 'two books, switch during the balance dialog: Acme\'s account is byte-identical');
    }
    {
      const m = await mount(MULTI, { books: true });
      const acmeBefore = under(m.ctx.vault._store, ACME);
      answers.push({ date: '2026-09-21', desc: 'TYPED ROW', label: 'Cheque', dir: 'out', amount: '12', cat: 'Food', note: '' });
      hooks.dialog = m.switchAndCommit;
      await m.ctx.addTransaction();
      eq(under(m.ctx.vault._store, ACME), acmeBefore, 'two books, switch during Add transaction: Acme byte-identical');
      ok(!/TYPED ROW/.test(m.ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-09.md`)), '… and not written into the household behind the reader\'s back either');
    }

    /* ---- 3. an exact-load flow still refuses a same-book reload ------------ */
    {
      const m = await mount(SINGLE);
      const S = m.ctx.S;
      S.pendingImport = { label: 'Cheque', filename: 'c.csv', index: buildIndex(S.txFiles),
        items: [{ date: '2026-09-20', desc: 'IMPORTED Toll', cat: 'Food', amount: -40, excluded: false, include: true, dup: false }] };
      await m.ctx.commitImport();
      const before = m.ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-09.md`);
      hooks.dialog = m.syncReload();
      const t0 = m.ctx._toasts.length;
      await m.ctx.undoImport();
      eq(m.ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-09.md`), before, 'NEGATIVE CONTROL: undo-import (edits objects it read) still refuses after a same-book reload');
      ok(m.ctx._toasts.slice(t0).some(t => t.bad), '… and says so');
    }

    /* ---- 4. honest messages after a replaced state ------------------------ */
    {
      const m = await mount(MULTI, { books: true });
      const S = m.ctx.S;
      S.pendingImport = { label: 'Cheque', filename: 'c.csv', index: buildIndex(S.txFiles),
        items: [['2026-08-20', 'IMPORTED Fuel', -300], ['2026-09-20', 'IMPORTED Toll', -40]]
          .map(([date, desc, amount]) => ({ date, desc, cat: 'Food', amount, excluded: false, include: true, dup: false })) };
      const real = m.ctx.vault.modify.bind(m.ctx.vault);
      let fired = false;
      m.ctx.vault.modify = async (f, c) => { const r = await real(f, c); if (!fired && /^Budget\/Transactions\/Cheque\//.test(f.path)) { fired = true; await m.switchAndCommit(); } return r; };
      const t0 = m.ctx._toasts.length;
      await m.ctx.commitImport();
      const msg = (m.ctx._toasts.slice(t0).pop() || {}).msg || '';
      ok(/Import stopped after 1 row/.test(msg), `a commit import whose state was replaced mid-way says how far it got: "${msg}"`);
      ok(!/Undo it on the Transactions page/.test(msg) && /cannot be undone from here/.test(msg), '… and offers no Undo it does not have');
      eq(S.lastImport, null, '… because there is none');
    }
    {
      const m = await mount(SINGLE);
      const op = m.ctx.opWriter();
      await m.ctx.loadVault();
      const rulesBefore = m.ctx.vault._store.get(`${HOME}/Data/Categorisation Rules.csv`);
      eq(await m.ctx.learnRules([{ desc: 'NEW SHOP 123', cat: 'Food' }], op), null, 'learnRules answers null (not 0) when the state was replaced: nothing was learned, and the caller can say so');
      eq(m.ctx.vault._store.get(`${HOME}/Data/Categorisation Rules.csv`), rulesBefore, '… and wrote nothing');
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'transactions.js'), 'utf8');
      ok(/learned === null \? '\. ' \+ i18n\.t\('tx\.savedNotLearned'\)/.test(src), 'the Save toast says the rules were not learned when learnRules answers null');
      ok(i18n.t('tx.savedNotLearned') !== 'tx.savedNotLearned', '… in a real sentence');
    }

    /* ---- 5. isEditing() counts an open modal ------------------------------- */
    {
      const { modalOpenIn } = require('../src/controller');
      const doc = sel => ({ querySelector: q => (q === sel ? {} : null) });
      eq(modalOpenIn([doc('.modal-container')]), true, 'an Obsidian modal open in the document → editing (the scheduler waits)');
      eq(modalOpenIn([doc('.nothing'), undefined, null]), false, 'NEGATIVE CONTROL: no modal → not editing on that account');
      eq(modalOpenIn([doc('.nothing'), doc('.modal-container')]), true, 'a modal in a popout window\'s document counts too');
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
      ok(/function isEditing\(\) \{[\s\S]{0,1200}if \(modalOpenIn\(\[document, root\.ownerDocument\]\)\) return true;/.test(src), 'isEditing() asks it');
    }
  } finally { unpin(); Module._load = origLoad; }

  console.log(`PASS books-create-under-reload — what the reader typed survives a same-book reload and never lands in another book (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
