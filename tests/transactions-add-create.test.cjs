'use strict';
/* Create a missing account, category or subcategory from inside the Add
   transaction dialog (issue #189), on the Transactions page.

   The REAL view, the real creation dialogs (ctx.addAccount, promptCreateCategory,
   promptNewSubcategory) and the real loader over an in-memory vault, the way
   tests/transactions-copy.test.cjs drives it. Only the dialogs are scripted:
   askFields opens an Obsidian modal, so it is replaced at the module loader and
   every dialog the flow opens goes through one queue, in the order they open.
   The dialog's own behaviour (the entry, the leave-on-pick) is pinned in
   tests/field-create-entry.test.cjs and the pure draft rules in
   tests/add-create.test.cjs; this file pins the FLOW.

   DECISIONS under test (settled with the issue, 2026-11-28):
     1. Close and reopen, never stacked dialogs. A pick closes Add, runs the
        existing creation dialog alone, then reopens Add pre-filled with the new
        item selected. At most one dialog is ever open.
     2. A failed or cancelled create returns to Add with everything intact and the
        dropdown unchanged.
     3. Add cannot be confirmed while a create is still saving: it reopens only
        after the save has finished, and a second Add started in the gap is
        ignored rather than opened beside it.
     4. With no account yet, Add leads with creating one: it goes straight into
        the New account dialog and opens once an account exists.
     5. Account, Category and Subcategory behave alike, each ending in a create
        entry worded after the table's own ("＋ Add new category…",
        "＋ New subcategory…"), from keys held in all twelve languages.
     6. A create finished after the book changed does not reopen Add in the new
        book, and nothing is written into it.

     node tests/transactions-add-create.test.cjs */

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- the dialogs, scripted: one queue, in the order they open ---------- */
const script = { queue: [] };
const asked = [];
let open = 0, maxOpen = 0;
const fakeModal = {
  askFields: async (app, title, fields, opts) => {
    const entry = { title, fields, opts, at: asked.length };
    asked.push(entry);
    open++; maxOpen = Math.max(maxOpen, open);
    try {
      if (!script.queue.length) throw new Error(`unscripted askFields: ${title}`);
      const next = script.queue.shift();
      entry.during = null;
      return typeof next === 'function' ? await next(entry) : next;
    } finally { open--; }
  },
  confirmModal: async () => true,
  askSubcategories: async () => undefined,
  askSplit: async () => null,
  askRulesCleanup: async () => null,
  askBudgetReslice: async () => null,
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '../modal' || req === './modal') return fakeModal;
  return origLoad.call(this, req, ...rest);
};
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const i18n = require('../src/i18n');
const { CREATE_KEY } = require('../src/add-create');

const B = 'Budget';
const TODAY = '2026-11-28';
const NOV = account => `${B}/Transactions/${account}/2026-11.md`;
const settle = () => new Promise(r => setTimeout(r, 25));
const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let go; const promise = new Promise(r => { go = r; }); return { promise, go }; };

const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Car.md`]: '---\ntype: expense\ncolor: "#123456"\nsubcategories: "Fuel, Services"\n---\n',
  [`${B}/Categories/Home.md`]: '---\ntype: expense\ncolor: "#aa3366"\n---\n',
  [`${B}/Categories/Income.md`]: '---\ntype: income\ncolor: "#22aa44"\n---\n',
};
const WITH_ACCOUNT = { ...BASE, [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000.00\nbalance_updated: 2026-07-31\n---\n' };

async function open1(files = WITH_ACCOUNT) {
  const unpin = pinClock(TODAY);
  const M = await mountFor(files, { period: '2026-11' });
  M.unpin = unpin;
  M.ctx.render = () => {};   // controller's whole-app render: not under test (as tests/books-create-under-reload.test.cjs)
  return M;
}
const store = M => M.ctx.vault._store;
const fieldOf = (ask, key) => ask.fields.find(f => f.key === key);
const valueOf = (ask, key) => fieldOf(ask, key).value;
const reset = () => { asked.length = 0; script.queue.length = 0; open = 0; maxOpen = 0; };
const lastToast = M => M.ctx._toasts[M.ctx._toasts.length - 1] || {};
const toastsSince = (M, n) => M.ctx._toasts.slice(n);

/* What the reader has typed into Add before reaching for a create entry. */
const TYPED = { date: '2026-11-27', desc: 'Coffee', label: 'Cheque', dir: 'in', amount: '12.5', cat: 'Car', subcategory: 'Fuel', note: 'with Sam' };
const pick = (values, key) => ({ ...values, [CREATE_KEY]: key });
const FIELD_KEYS = ['date', 'desc', 'label', 'dir', 'amount', 'cat', 'subcategory', 'note'];
const draftOf = ask => Object.fromEntries(FIELD_KEYS.map(k => [k, valueOf(ask, k)]));

const WALLET = { name: 'Wallet', type: 'checking', institution: '', balance: '0', currency: '', currency_code: '', budget: 'yes' };
const COFFEE = { name: 'Coffee', type: 'expense', fixed: [] };

/* How each of the three creates is begun, answered, refused and failed. */
const KINDS = [
  { key: 'label', name: 'account', title: i18n.t('acct.new.title'),
    typed: TYPED, ok: WALLET, made: 'Wallet', field: 'label',
    dup: { ...WALLET, name: 'Cheque' }, slowPath: `${B}/Accounts/Wallet.md`, made_file: `${B}/Accounts/Wallet.md` },
  { key: 'cat', name: 'category', title: 'New category',
    typed: TYPED, ok: COFFEE, made: 'Coffee', field: 'cat',
    dup: { ...COFFEE, name: 'Home' }, slowPath: `${B}/Categories/Coffee.md`, made_file: `${B}/Categories/Coffee.md` },
  { key: 'subcategory', name: 'subcategory', title: i18n.t('tx.subcategory.newTitle', { category: 'Car' }),
    typed: TYPED, ok: { name: 'Tolls' }, made: 'Tolls', field: 'subcategory',
    dup: { name: 'Fuel' }, slowPath: `${B}/Categories/Car.md`, made_file: `${B}/Categories/Car.md` },
];

(async () => {
  /* ---- 5. the three dropdowns, each ending in a create entry -------------- */
  {
    reset();
    const M = await open1();
    script.queue.push(null);
    await M.ctx.addTransaction();
    const ask = asked[0];
    eq(ask.title, i18n.t('tx.add.title'), 'Add opens as it always did');
    eq(ask.fields.map(f => f.key), FIELD_KEYS, 'with the same eight fields in the same order');
    eq(fieldOf(ask, 'label').create, { label: i18n.t('tx.add.newAccount') }, 'Account ends in a create entry');
    eq(fieldOf(ask, 'cat').create, { label: i18n.t('tx.add.newCategory') }, 'Category too');
    eq(fieldOf(ask, 'subcategory').create, { label: i18n.t('tx.subcategory.new') }, 'and Subcategory, with the very key the table\'s own entry uses (slice 1 left it out)');
    eq(i18n.t('tx.add.newCategory'), '＋ Add new category…', 'the category entry reads exactly as the table\'s');
    eq(i18n.t('tx.subcategory.new'), '＋ New subcategory…', 'the subcategory entry as the table\'s');
    ok(/^＋ /.test(i18n.t('tx.add.newAccount')) && /…$/.test(i18n.t('tx.add.newAccount')), 'the account entry follows the same pattern: ＋, a verb phrase, an ellipsis');
    eq(fieldOf(ask, 'label').options, ['Cheque'], 'the account list itself is still just the accounts: the entry is not an option a row could be filed under');
    eq(fieldOf(ask, 'cat').options.map(o => o.value), ['', ...M.S.categories.map(c => c.name)], 'and the category list is still none then the categories, in the page\'s own order');
    eq(M.S.categories.map(c => c.name).sort(), ['Car', 'Home', 'Income'], 'fixture: the three categories');
    ok(typeof ask.opts.validate === 'function', 'validated as before');
    for (const k of ['date', 'desc', 'dir', 'amount', 'note']) ok(!fieldOf(ask, k).create, `${k} has no create entry`);
    M.unpin();
  }
  {
    // A book with no subcategories at all still has no Subcategory field (that is how it was).
    reset();
    const plain = { ...WITH_ACCOUNT, [`${B}/Categories/Car.md`]: '---\ntype: expense\ncolor: "#123456"\n---\n' };
    const M = await open1(plain);
    script.queue.push(null);
    await M.ctx.addTransaction();
    eq(asked[0].fields.map(f => f.key), ['date', 'desc', 'label', 'dir', 'amount', 'cat', 'note'], 'a book that uses no subcategories shows none');
    M.unpin();
  }

  /* ---- 1. close and reopen: the happy path of each create ------------------- */
  for (const k of KINDS) {
    reset();
    const M = await open1();
    const before = new Map(store(M));
    // Add (pick) -> the creation dialog -> Add again (cancelled).
    script.queue.push(pick(TYPED, k.key), k.ok, null);
    await M.ctx.addTransaction();
    eq(asked.map(a => a.title), [i18n.t('tx.add.title'), k.title, i18n.t('tx.add.title')],
      `${k.name}: Add, then the existing creation dialog, then Add again -- in that order`);
    eq(maxOpen, 1, `${k.name}: never more than one dialog open: nothing is stacked`);
    const back = asked[2];
    const expected = { ...TYPED };
    if (k.key === 'label') expected.label = 'Wallet';
    if (k.key === 'cat') { expected.cat = 'Coffee'; expected.subcategory = ''; }
    if (k.key === 'subcategory') expected.subcategory = 'Tolls';
    eq(draftOf(back), expected, `${k.name}: Add reopens with everything as typed and the new item selected`);
    ok(typeof back.opts.validate === 'function', `${k.name}: the reopened Add is validated like any other`);
    ok(![...store(M).keys()].some(p => /Transactions\/.*\.md$/.test(p) && !before.has(p)), `${k.name}: nothing was filed as a transaction by the detour`);
    ok(store(M).get(k.made_file) !== before.get(k.made_file), `${k.name}: the item really was written to its file`);
    // Offered by the reopened form.
    if (k.key === 'label') eq(fieldOf(back, 'label').options, ['Cheque', 'Wallet'], 'account: the new account is in the list');
    if (k.key === 'cat') ok(fieldOf(back, 'cat').options.some(o => o.value === 'Coffee'), 'category: the new category is in the list');
    if (k.key === 'subcategory') ok(fieldOf(back, 'subcategory').optionsFor('Car').some(o => o.value === 'Tolls'), 'subcategory: the new name is offered under its category');
    M.unpin();
  }

  /* ---- the creation dialogs are the existing ones, asked for as they are ---- */
  {
    reset();
    const M = await open1();
    script.queue.push(pick(TYPED, 'label'), null, null);
    await M.ctx.addTransaction();
    eq(valueOf(asked[1], 'type'), 'checking', 'the account dialog opens on a bank account, as the Transactions toolbar\'s own New account does');
    M.unpin();
  }
  {
    reset();
    const M = await open1();
    script.queue.push(pick(TYPED, 'subcategory'), null, null);
    await M.ctx.addTransaction();
    eq(asked[1].title, i18n.t('tx.subcategory.newTitle', { category: 'Car' }), 'the subcategory dialog is promptNewSubcategory, under the category typed in Add');
    M.unpin();
  }

  /* ---- 1+. confirming the reopened Add files the row under the new item ---- */
  {
    reset();
    const M = await open1();
    script.queue.push(pick(TYPED, 'label'), WALLET,
      entry => ({ ...draftOf(entry), desc: 'Coffee' }));   // confirm exactly what the reopened form holds
    await M.ctx.addTransaction();
    const file = store(M).get(NOV('Wallet'));
    ok(file && file.includes('| 2026-11-27 | Coffee | Car | 12.50 |') && file.includes('Fuel'), `end to end: the row is filed in the NEW account's month, with the typed category and subcategory -- ${file}`);
    ok(!store(M).has(NOV('Cheque')), 'and nothing went to the account that was selected before');
    M.unpin();
  }
  {
    reset();
    const M = await open1();
    script.queue.push(pick(TYPED, 'cat'), COFFEE, entry => draftOf(entry));
    await M.ctx.addTransaction();
    const file = store(M).get(NOV('Cheque'));
    ok(file && file.includes('| Coffee | 12.50 |'), 'end to end: the row is filed under the new category');
    ok(!/Fuel/.test(file), 'and carries no subcategory, because the one typed under Car does not belong to the new category');
    M.unpin();
  }
  {
    // Chained: a second create from the reopened Add works the same way.
    reset();
    const M = await open1();
    script.queue.push(pick(TYPED, 'label'), WALLET, entry => pick(draftOf(entry), 'cat'), COFFEE, null);
    await M.ctx.addTransaction();
    eq(maxOpen, 1, 'chained creates: still never stacked');
    eq(asked.length, 5, 'Add, account, Add, category, Add');
    eq([valueOf(asked[4], 'label'), valueOf(asked[4], 'cat'), valueOf(asked[4], 'desc')], ['Wallet', 'Coffee', 'Coffee'], 'and the last Add holds both new items and the typing');
    M.unpin();
  }

  /* ---- 2. cancelled: back to Add, everything intact, nothing written -------- */
  for (const k of KINDS) {
    reset();
    const M = await open1();
    const before = new Map(store(M));
    const toasts0 = M.ctx._toasts.length;
    script.queue.push(pick(TYPED, k.key), null, null);
    await M.ctx.addTransaction();
    eq(asked.map(a => a.title), [i18n.t('tx.add.title'), k.title, i18n.t('tx.add.title')], `${k.name} cancelled: Add comes back`);
    eq(draftOf(asked[2]), TYPED, `${k.name} cancelled: every field as typed, the dropdown it was picked in unchanged`);
    eq([...store(M)], [...before], `${k.name} cancelled: not a byte changed in the vault`);
    eq(toastsSince(M, toasts0), [], `${k.name} cancelled: nothing said`);
    M.unpin();
  }

  /* ---- 2. refused by the creation dialog's own rules: same ----------------- */
  for (const k of KINDS) {
    reset();
    const M = await open1();
    const before = new Map(store(M));
    const toasts0 = M.ctx._toasts.length;
    script.queue.push(pick(TYPED, k.key), k.dup, null);
    await M.ctx.addTransaction();
    eq(asked.length, 3, `${k.name} refused: Add comes back`);
    eq(draftOf(asked[2]), TYPED, `${k.name} refused (a name that exists): everything as typed`);
    eq([...store(M)], [...before], `${k.name} refused: nothing written`);
    ok(toastsSince(M, toasts0).some(t => t.bad), `${k.name} refused: the creation dialog said why, as it does anywhere`);
    M.unpin();
  }

  /* ---- 2. failed: the write is rejected ------------------------------------ */
  for (const k of KINDS) {
    reset();
    const M = await open1();
    const before = new Map(store(M));
    const realCreate = M.ctx.vault.create, realModify = M.ctx.vault.modify;
    const boom = async (p, c) => { throw new Error('disk full'); };
    M.ctx.vault.create = async (p, c) => (p === k.slowPath ? boom() : realCreate.call(M.ctx.vault, p, c));
    M.ctx.vault.modify = async (f, c) => (f.path === k.slowPath ? boom() : realModify.call(M.ctx.vault, f, c));
    const toasts0 = M.ctx._toasts.length;
    const accounts0 = M.S.accounts.length, cats0 = M.S.categories.length;
    script.queue.push(pick(TYPED, k.key), k.ok, null);
    await M.ctx.addTransaction();
    eq(asked.length, 3, `${k.name} failed: Add comes back and nothing threw out of the page`);
    eq(draftOf(asked[2]), TYPED, `${k.name} failed: everything as typed, the dropdown unchanged`);
    eq([...store(M)].filter(([p]) => p === k.slowPath), [...before].filter(([p]) => p === k.slowPath), `${k.name} failed: the file is as it was`);
    eq([M.S.accounts.length, M.S.categories.length], [accounts0, cats0], `${k.name} failed: memory models no item the disk does not have`);
    ok(toastsSince(M, toasts0).some(t => t.bad && /disk full/.test(t.msg)), `${k.name} failed: the reader is told, with the reason -- ${JSON.stringify(toastsSince(M, toasts0).map(t => t.msg))}`);
    eq(maxOpen, 1, `${k.name} failed: one dialog at a time`);
    M.unpin();
  }

  /* ---- 3. Add cannot be confirmed while a create is still saving ------------ */
  for (const k of KINDS.slice(0, 2)) {
    reset();
    const M = await open1();
    const gate = deferred();
    const realCreate = M.ctx.vault.create;
    let writing = false;
    M.ctx.vault.create = async (p, c) => {
      if (p !== k.slowPath) return realCreate.call(M.ctx.vault, p, c);
      writing = true; await gate.promise; writing = false;
      return realCreate.call(M.ctx.vault, p, c);
    };
    const filed = () => [...store(M).keys()].filter(p => /Transactions\/.*\.md$/.test(p));
    script.queue.push(pick(TYPED, k.key), k.ok, entry => {
      entry.during = { savedBeforeAdd: store(M).has(k.slowPath), writing, hasItem: k.key === 'label' ? M.S.accounts.some(a => a.name === 'Wallet') : M.S.categories.some(c => c.name === 'Coffee') };
      return draftOf(entry);
    });
    const flow = M.ctx.addTransaction();
    for (let i = 0; i < 20 && !writing; i++) await tick();
    ok(writing, `${k.name}: the save is in flight`);
    eq(asked.map(a => a.title), [i18n.t('tx.add.title'), k.title], `${k.name} saving: Add has NOT reopened: there is no Add on screen to confirm`);
    eq(open, 0, `${k.name} saving: no dialog is open at all`);

    // The reader taps Add transaction again in the gap.
    const second = await M.ctx.addTransaction();
    eq(second, undefined, `${k.name} saving: a second Add returns at once`);
    eq(asked.length, 2, `${k.name} saving: and opened nothing beside the pending one`);
    eq(script.queue.length, 1, `${k.name} saving: and took none of the flow's dialogs`);
    eq(filed(), [], `${k.name} saving: no row was written`);

    gate.go();
    await flow;
    eq(asked.length, 3, `${k.name}: once the save landed, Add reopened`);
    eq(asked[2].during, { savedBeforeAdd: true, writing: false, hasItem: true }, `${k.name}: and only AFTER the file was written and the item was in memory`);
    eq(draftOf(asked[2]).desc, 'Coffee', `${k.name}: with the draft the gap's second Add did not consume`);
    ok(filed().length === 1, `${k.name}: the reopened Add, once confirmed, files exactly one row`);
    // The guard is released: an ordinary Add works again.
    script.queue.push(null);
    await M.ctx.addTransaction();
    eq(asked.length, 4, `${k.name}: afterwards Add opens normally`);
    eq([valueOf(asked[3], 'desc'), valueOf(asked[3], 'cat')], [undefined, ''], `${k.name}: blank, because the draft was spent`);
    M.unpin();
  }
  {
    // The guard is released when the create THROWS too.
    reset();
    const M = await open1();
    const realCreate = M.ctx.vault.create;
    M.ctx.vault.create = async (p, c) => { if (p === `${B}/Categories/Coffee.md`) throw new Error('nope'); return realCreate.call(M.ctx.vault, p, c); };
    script.queue.push(pick(TYPED, 'cat'), COFFEE, null);
    await M.ctx.addTransaction();
    script.queue.push(null);
    await M.ctx.addTransaction();
    eq(asked.length, 4, 'after a failed create the guard is released and Add opens');
    M.unpin();
  }

  /* ---- 4. no account yet: Add leads with creating one ------------------------ */
  {
    reset();
    const M = await open1(BASE);
    eq(M.S.accounts.length, 0, 'fixture: no accounts, no transaction folders');
    const toasts0 = M.ctx._toasts.length;
    script.queue.push(WALLET, null);
    await M.ctx.addTransaction();
    eq(asked.map(a => a.title), [i18n.t('acct.new.title'), i18n.t('tx.add.title')], 'with no account the first dialog is New account, and Add opens after it');
    eq(valueOf(asked[0], 'type'), 'checking', 'the account dialog opens on a bank account');
    eq(valueOf(asked[1], 'label'), 'Wallet', 'Add opens with the new account selected');
    eq(fieldOf(asked[1], 'label').options, ['Wallet'], 'and it is the one account on offer');
    eq(maxOpen, 1, 'never stacked');
    ok(!toastsSince(M, toasts0).some(t => t.msg === i18n.t('tx.add.noAccount')), 'the old refusal ("Add an account first") is not shown');
    ok(store(M).has(`${B}/Accounts/Wallet.md`), 'the account was created by the existing dialog');
    M.unpin();
  }
  {
    // Cancelled: nothing was typed, so nothing is lost -- Add simply does not open.
    reset();
    const M = await open1(BASE);
    const before = new Map(store(M));
    script.queue.push(null);
    await M.ctx.addTransaction();
    eq(asked.map(a => a.title), [i18n.t('acct.new.title')], 'cancelling the account dialog ends it: Add is not opened over no account');
    eq([...store(M)], [...before], 'nothing written');
    script.queue.push(WALLET, null);
    await M.ctx.addTransaction();
    eq(asked.length, 3, 'and the next Add starts the same way');
    M.unpin();
  }
  {
    // Refused (a blank name): same as cancelled, and the account dialog says why.
    reset();
    const M = await open1(BASE);
    const toasts0 = M.ctx._toasts.length;
    script.queue.push({ ...WALLET, name: '' });
    await M.ctx.addTransaction();
    eq(asked.length, 1, 'a refused account: Add does not open over no account');
    ok(toastsSince(M, toasts0).some(t => t.bad), 'and the account dialog said why');
    M.unpin();
  }
  {
    // No creation dialog to lead with (the Accounts view is not mounted): the old message, as before.
    reset();
    const M = await open1(BASE);
    M.ctx.addAccount = undefined;
    const toasts0 = M.ctx._toasts.length;
    await M.ctx.addTransaction();
    eq(asked.length, 0, 'without an account dialog nothing opens');
    eq(toastsSince(M, toasts0).map(t => [t.msg, !!t.bad]), [[i18n.t('tx.add.noAccount'), true]], 'and the reader gets the message the page always gave');
    M.unpin();
  }
  {
    // An account that exists only as a transaction folder counts: Add opens straight away, as before.
    reset();
    const folderOnly = { ...BASE, [`${B}/Transactions/Cash/2026-11.md`]: '---\naccount: "Cash"\nmonth: 2026-11\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---:|---:|---|---|\n' };
    const M = await open1(folderOnly);
    script.queue.push(null);
    await M.ctx.addTransaction();
    eq(asked.map(a => a.title), [i18n.t('tx.add.title')], 'a folder of transactions is an account to file under: Add opens, not the account dialog');
    M.unpin();
  }

  /* ---- a copy goes through the same flow ------------------------------------- */
  {
    reset();
    const rows = { ...WITH_ACCOUNT, [NOV('Cheque')]: '---\naccount: "Cheque"\nmonth: 2026-11\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split | Subcategory |\n|---|---|---|---:|---|---|---|---|\n| 2026-11-02 | Engen | Car | -512.40 |  | fill |  | Fuel |\n' };
    const M = await open1(rows);
    const file = M.S.txFiles['Cheque/2026-11'];
    script.queue.push(entry => pick(draftOf(entry), 'cat'), COFFEE, null);
    await M.ctx.copyTransaction({ _row: file.rows[0], _file: file });
    eq(draftOf(asked[0]).desc, 'Engen', 'the copy opens Add filled from the row');
    eq(draftOf(asked[2]), { ...draftOf(asked[0]), cat: 'Coffee', subcategory: '' }, 'and a create from it reopens the copy, with the new category');
    script.queue.push(null);
    await M.ctx.addTransaction();
    eq([valueOf(asked[3], 'desc'), valueOf(asked[3], 'cat')], [undefined, ''], 'the copy\'s draft is spent: the next ordinary Add is blank');
    M.unpin();
  }

  /* ---- 6. the book changes while the creation dialog is open ----------------- */
  {
    reset();
    const HOME = 'Budget', ACME = 'Clients/Acme';
    const bookFiles = b => ({
      [`${b}/Settings.md`]: BASE[`${B}/Settings.md`],
      [`${b}/Categories/Car.md`]: BASE[`${B}/Categories/Car.md`],
      [`${b}/Accounts/Cheque.md`]: WITH_ACCOUNT[`${B}/Accounts/Cheque.md`],
    });
    const unpin = pinClock(TODAY);
    const M = await mountFor({ ...bookFiles(HOME), ...bookFiles(ACME) }, { period: '2026-11', budgetFolder: HOME });
    M.unpin = unpin;
    M.ctx.render = () => {}; M.ctx.switchView = () => {};
    const kv = {};
    M.ctx.plugin.app = { vault: M.ctx.vault, loadLocalStorage: k => (k in kv ? kv[k] : null), saveLocalStorage: (k, v) => { kv[k] = v; } };
    M.ctx.plugin.settings.books = [{ folder: HOME, label: 'Home' }, { folder: ACME, label: 'Acme' }];
    const acme = () => [...store(M)].filter(([k]) => k.startsWith(ACME + '/'));
    const acmeBefore = acme();
    const homeBefore = new Map(store(M));
    const toasts0 = M.ctx._toasts.length;
    const switchThen = answer => async () => { M.ctx.plugin.setOpenBookLocal(ACME); await M.ctx.loadVault(); return answer; };
    script.queue.push(pick(TYPED, 'cat'), switchThen(COFFEE));
    await M.ctx.addTransaction();
    eq(asked.length, 2, 'the book changed during the create: Add does NOT reopen, typed for a book that is no longer on screen');
    eq(acme(), acmeBefore, 'the book switched to is byte-identical');
    eq([...store(M)], [...homeBefore], 'and so is the book that was left');
    ok(toastsSince(M, toasts0).some(t => t.bad), 'the refusal is said');
    script.queue.push(null);
    await M.ctx.addTransaction();
    eq([valueOf(asked[2], 'desc'), valueOf(asked[2], 'cat')], [undefined, ''], 'and nothing typed for the old book is carried into an Add in the new one');
    M.unpin();
  }

  /* ---- 5. all twelve languages ------------------------------------------------ */
  {
    const { TABLES } = i18n;
    const langs = Object.keys(TABLES);
    eq(langs.length, 12, 'twelve languages');
    for (const key of ['tx.add.newAccount', 'tx.add.newCategory']) {
      for (const lang of langs) {
        const s = TABLES[lang][key];
        ok(typeof s === 'string' && /^＋ /.test(s) && /(…|\.\.\.)$/.test(s), `${lang} ${key}: present, "＋ …" shaped -- ${s}`);
        if (lang !== 'en') ok(s !== TABLES.en[key], `${lang} ${key}: translated, not English`);
      }
    }
    for (const lang of langs) ok(/^＋ /.test(TABLES[lang]['tx.subcategory.new']), `${lang}: the subcategory entry the Add dialog now reuses`);
  }

  console.log(`PASS transactions-add-create (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
