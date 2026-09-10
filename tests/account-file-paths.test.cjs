'use strict';
/* ISSUE 60, closed — an account is addressed by the file it came from, not by
   a path assembled from its name.

   The first half shipped in 1.37.0: a file under `Accounts/Closed/` was counted
   and named (tests/nested-account-files.test.cjs) but still not READ, so the
   vault contradicted itself — R12 000 of net worth against R100 000 on disk,
   while the vanished account's interest counted, because rows are read by
   FOLDER and balances by account file.

   WHY THE ONE-LINE FIX WAS WRONG, MEASURED. Pointing the loader at
   mdFilesUnder('Accounts') alone loads the account and every figure comes
   right — and then the first balance edit forks the file, because saveAccount
   patched `Accounts/<a.name>.md`, a path that does not exist for a nested
   account, so io.js CREATED it: R88 000 nested, R90 000 flat, one account
   counted twice on the next load. A worse bug than the one being fixed.

   So this file pins an ORDER, and both halves are now in place: the writers
   learned the path (views/accounts.js's acctPath reads `a.rel`) BEFORE the
   loader recursed. Section 3 drives the real saveAccount over the real loader
   and proves the fork is absent — it used to prove the fork was present.

   Categories/, Budgets/, Plans/ and Tax/ are still read one level, because
   their writers still assemble `<Folder>/<name>.md` and would fork the same
   way. The order is the rule, not the folder.

   WHAT IS PINNED
     1. the vault in the issue still reads the way the issue describes;
     2. every account carries `rel`, the path it was READ from, and that path
        resolves to that very file (the seam the writers need);
     3. `rel` equals the path the write sites assemble today, so adopting it in
        views/accounts.js moves no figure and forks nothing — and section 3
        shows what happens if the loader recurses before they do;
     4. no account is loaded twice.

     node tests/account-file-paths.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { el } = require('../src/dom');
const { worth } = require('../src/worth');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TX = '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n'
  + '|---|---|---|---|---|---|---|\n';

/* The household in the issue: one everyday account, one dormant account filed
   into Accounts/Closed/, each with its own transactions folder. */
const VAULT = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Interest.md`]: '---\nname: Interest\ntype: income\n---\n',
  [`${B}/Categories/Food.md`]: '---\nname: Food\ntype: expense\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nbalance: 12000\nbalance_updated: 2026-01-01\n---\n\n# Cheque\n',
  [`${B}/Accounts/Closed/Old Savings.md`]:
    '---\ntype: savings\ntx_label: "Old Savings"\nbalance: 88000\nbalance_updated: 2026-01-01\n'
    + 'keep_this: "a key the app does not model"\n---\n\n# Old Savings\n\nProse the reader typed.\n',
  [`${B}/Transactions/Cheque/2026-01.md`]: TX + '| 2026-01-05 | Groceries | Food | -300.00 |  |  |  |\n',
  [`${B}/Transactions/Old Savings/2026-01.md`]: TX + '| 2026-01-31 | Interest | Interest | 250.00 |  |  |  |\n',
};

/* loadInto's wiring, with one seam open: the loader's folder reader. Section 3
   swaps it for the recursing one to measure what that costs. */
async function load(files, { recurseAccounts = false } = {}) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  require('../src/io')(ctx);
  if (recurseAccounts) {
    const flat = ctx.mdFilesIn;
    ctx.mdFilesIn = rel => (rel === 'Accounts' ? ctx.mdFilesUnder(rel) : flat(rel));
  }
  require('../src/period')(ctx);
  require('../src/trend-math')(ctx);
  require('../src/health-data')(ctx);
  require('../src/figures')(ctx);
  require('../src/load')(ctx);
  require('../src/views/notes')(ctx);
  await ctx.loadVault();
  ctx.S.period = '2026-01';
  return ctx;
}

(async () => {
  /* ---- 1. the vault in the issue, as it reads today ---------------------- */
  {
    const ctx = await load(VAULT);
    const S = ctx.S;
    eq(S.accounts.map(a => a.name).sort(), ['Cheque', 'Old Savings'],
      'the nested account file is READ — the vault no longer contradicts itself');
    eq(worth(S.accounts, S.debts, S.assets, S.settings.currency, S.owed).net, 100000,
      'so net worth is the truth, not R12 000 of it');
    eq(ctx.periodSummary('2026-01', '2026-02-15').income, 250,
      'and its interest still counts, as it always did — the rows were never the problem');
    eq(S.accountsIgnored, [],
      'nothing is disclosed as skipped, because nothing is skipped — the 1.37.0 caveat retires itself');
    ok(ctx.accountForLabel('Old Savings'),
      'and "Old Savings" resolves to its account, so its rows are no longer orphans');
  }

  /* ---- 2. every account carries the path it was read from ---------------- */
  {
    const ctx = await load(VAULT);
    const missing = ctx.S.accounts.filter(a => !a.rel);
    eq(missing.map(a => a.name), [], 'every loaded account carries `rel`');

    for (const a of ctx.S.accounts) {
      const f = ctx.fileAt(a.rel);
      ok(f, `fileAt(${a.rel}) resolves — the seam is a path the writers can use`);
      eq(f.basename, a.name, `${a.rel} is the file this account was read from`);
      /* The invariant that makes adopting `rel` in views/accounts.js a no-op
         TODAY: for everything the loader currently reads, the path it carries
         and the path the write sites assemble are the same string. */
      if (a.name === 'Old Savings') {
        eq(a.rel, 'Accounts/Closed/Old Savings.md',
          'the nested account carries its REAL path — the whole point of the seam');
      } else {
        eq(a.rel, `Accounts/${a.name}.md`,
          `${a.name}: \`rel\` equals the path saveAccount assembles, so a top-level vault moved nothing`);
      }
    }
  }

  /* ---- 3. the edit lands in the file the reader created --------------------
     This section used to prove the FORK: with a recursing loader and writers
     that still assembled `Accounts/<name>.md`, one balance edit left R88 000
     nested and R90 000 flat, R178 000 on the next load. That order is now
     satisfied — views/accounts.js addresses `a.rel` — so the same drive proves
     its absence. Driven through the REAL saveAccount, not a mirror. */
  {
    const ctx = await load(VAULT);
    const S = ctx.S;
    const { $ } = makeDom();
    ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    ctx.typeBadge = t => el('span', {}, t);
    ctx.switchView = () => {};
    require('../src/categories')(ctx);
    require('../src/views/accounts')(ctx);

    const nested = S.accounts.find(a => a.name === 'Old Savings');
    nested.balance = 90000;
    ok(await ctx.saveAccount(nested), 'the save reports success');

    const store = ctx.vault._store;
    ok(!store.has('Budget/Accounts/Old Savings.md'),
      'NO second file appears at the top level — the fork this order exists to prevent');
    ok(/balance: 90000/.test(store.get('Budget/Accounts/Closed/Old Savings.md')),
      'the edit landed in the file the reader actually created, at its own depth');

    const after = await load({ ...VAULT,
      'Budget/Accounts/Closed/Old Savings.md': store.get('Budget/Accounts/Closed/Old Savings.md') });
    eq(after.S.accounts.map(a => a.name).sort(), ['Cheque', 'Old Savings'],
      'and the next load still counts one account once');
    eq(worth(after.S.accounts, after.S.debts, after.S.assets,
      after.S.settings.currency, after.S.owed).net, 102000,
      'at the edited figure — R12 000 + R90 000, never R178 000');
  }

  /* ---- 4. a flat vault loads each account exactly once ------------------- */
  {
    const flat = { ...VAULT };
    delete flat[`${B}/Accounts/Closed/Old Savings.md`];
    flat[`${B}/Accounts/Old Savings.md`] = VAULT[`${B}/Accounts/Closed/Old Savings.md`];

    for (const recurseAccounts of [false, true]) {
      const ctx = await load(flat, { recurseAccounts });
      const names = ctx.S.accounts.map(a => a.name);
      eq(names, ['Cheque', 'Old Savings'],
        `every account is loaded once (recursing: ${recurseAccounts}) — reading deeper adds no duplicates`);
      eq(ctx.S.accounts.map(a => a.rel).sort(),
        ['Accounts/Cheque.md', 'Accounts/Old Savings.md'],
        `and each carries its own path exactly once (recursing: ${recurseAccounts})`);
      eq(ctx.S.accountsIgnored, [], 'nothing is disclosed as skipped when nothing is');
    }
  }

  console.log(`PASS account-file-paths (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
