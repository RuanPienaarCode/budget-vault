'use strict';
/* An account created in this session knows the transactions folder it was
   created with.

   addAccount makes `Transactions/<name>/` beside the account file, as the setup
   wizard does, and never told the rest of the page. deleteAccount builds its
   folder list from S.txFolders — the loader's record of every folder — so for
   an account made a minute ago it found none, said "It has no transactions
   folder, so nothing else changes.", trashed the file and left the folder
   behind (audit of 7 Oct 2026). The same stale record made the brand-new
   account read "nothing imports into this account" until the next reload,
   though its folder was sitting right there.

   The fix registers the folder exactly as load.js would on the next read —
   the leaf name in S.txFolders, the budget-relative path in S.txFolderPaths —
   and this file holds it to that: the record after addAccount must equal the
   record a fresh load of the same vault produces.

     node tests/accounts-new-account-folder.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');

const modalPath = require.resolve('../src/modal.js');
const answers = [];
const seen = [];
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal(_app, opts) { seen.push({ kind: 'confirm', message: opts.message }); return true; },
    async askFields(_app, title, fields) { seen.push({ kind: 'fields', title, fields }); return answers.shift() || null; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-10-01\n---\n',
};

async function mount(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-10';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.switchView = () => {};
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  ctx.render = () => ctx.renderAccounts();
  return { ctx, S };
}

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    const { ctx, S } = await mount({ ...FILES });
    answers.push({ name: 'Holiday Fund', type: 'savings', institution: '', balance: '0', currency: '',
      goal_amount: '', budget: 'yes' });
    const made = await ctx.addAccount();
    ok(made && made.name === 'Holiday Fund', 'fixture: the account is created');
    ok(ctx.vault._store.has(`${B}/Transactions/Holiday Fund/.folder`), 'fixture: and so is its folder');

    /* The record matches what the loader reads back from the same vault. */
    const fresh = makeCtx(Object.fromEntries(ctx.vault._store));
    const S2 = await loadInto(fresh);
    eq(S.txFolders.includes('Holiday Fund'), S2.txFolders.includes('Holiday Fund'),
      'S.txFolders names the new folder, as a fresh load does');
    eq(S.txFolderPaths['Holiday Fund'], S2.txFolderPaths['Holiday Fund'],
      'and S.txFolderPaths gives the same path a fresh load gives');
    eq(S.txFolderPaths['Holiday Fund'], 'Transactions/Holiday Fund', 'budget-relative, the loader\'s own shape');

    /* The page reads the new account the way it will after the next reload. */
    ctx.renderAccounts();
    const { statusOf } = require('../src/acct-status');
    const st = statusOf(made, [], null, ctx.accountsWithFolder().has(made));
    eq(st.state, 'notx', 'a just-created account is "linked, nothing imported yet", not "no folder"');

    /* Delete it: the folder question is asked, and answering "drop" takes it. */
    seen.length = 0;
    answers.push({ folder: 'drop' });
    await ctx.deleteAccount(made);
    const asked = seen.find(d => d.kind === 'fields');
    ok(asked && asked.fields.some(f => f.key === 'folder'), 'the folder question is asked for the new account');
    const confirm = seen.find(d => d.kind === 'confirm');
    ok(confirm && !/no transactions folder/i.test(confirm.message),
      `and the confirmation no longer says it has none (got "${confirm && confirm.message}")`);
    ok(!ctx.vault._store.has(`${B}/Accounts/Holiday Fund.md`), 'the account file is gone');
    ok(![...ctx.vault._store.keys()].some(k => k.startsWith(`${B}/Transactions/Holiday Fund/`)),
      'and so is the folder it was created with');
    ok(!S.txFolders.includes('Holiday Fund'), 'and the folder record with it');

    /* An existing orphan folder of the same name is not registered twice. */
    {
      const { ctx: c2, S: s2 } = await mount({ ...FILES, [`${B}/Transactions/Old Pot/.folder`]: '' });
      ok(s2.txFolders.includes('Old Pot'), 'fixture: the loader recorded the empty orphan folder');
      answers.push({ name: 'Old Pot', type: 'savings', institution: '', balance: '0', currency: '',
        goal_amount: '', budget: 'yes' });
      await c2.addAccount();
      eq(s2.txFolders.filter(n => n === 'Old Pot').length, 1, 'adopting an existing folder records it once');
    }
  } finally { unpin(); }
  console.log(`PASS — a new account's folder is known to the page from the moment it exists (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
