'use strict';
/* A book's reload that commits BETWEEN two writes of one operation (the
   2026-11 re-review of ADR 0009's books, the blocker it found in f9fcc92).

   f9fcc92 checked a confirmation dialog once, after it closed, and otherwise
   relied on io.js's folder guard: "the folder the state was loaded from must be
   the open folder". That guard is blind from the moment the new book's reload
   commits — the two folders agree again — so an operation that gathered book
   A's month objects before the switch wrote the next of them into book B. The
   re-reviewer's repro: the Transactions bulk delete writes its delete log, a
   sibling plugin switches books while that write is landing, Acme's reload
   commits, and the loop's month write puts the household's `HOME Bakery` into
   `Clients/Acme/Transactions/Cheque/2026-09.md` — then a success toast.

   The fix binds an operation's writes to the LOAD it began from (io.js
   opWriter: identity of load.js's loadedBook(), checked when each write is
   called and again after the stale wait), and keeps a folder-level write
   window as the backstop for a writer that carries no stamp. This file drives
   the REAL views over the REAL loader, firing the switch and committing the
   new book's reload from INSIDE a vault write or dialog of the operation —
   the exact interleaving — and pins, for each:

     - every file of the book that was switched TO is byte-identical;
     - the book the operation was for holds exactly what the toast says landed;
     - the reader is told the truth: a red toast naming how far it got, never
       a success toast.

   Sites: the bulk delete (switch during the log write, and between two month
   writes), undo-import (between two months), the Transactions Save loop, Add
   transaction and the account balance (switch while their form is open), the
   account delete's trash loop, the rules tidy (switch while its preview is
   open — its removals are indices into ONE load's rule list), a burst of
   unstamped writes (the window), a same-book reload under a stamped operation
   (RELOADED), a superseded load's failure, and controller.js's decision to
   show the connect screen when a failed load leaves another book's state.

     node tests/books-midloop-switch.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* The modal stub: each dialog runs `hooks.dialog` (if set) while it is "open",
   then answers from the queue. */
const hooks = { dialog: null };
const answers = [];
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    const open = async v => { const h = hooks.dialog; hooks.dialog = null; if (h) await h(); return v; };
    return {
      askFields: async () => open(answers.shift() || null),
      askSplit: async () => open(null),
      confirmModal: async () => open(true),
      askRulesCleanup: async () => open(true),
      askBudgetReslice: async () => open(null),
      askReceipt: async () => open(null),
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
const LIST = [{ folder: HOME, label: 'Home' }, { folder: ACME, label: 'Acme' }];
const month = (m, rows) => `---\naccount: "Cheque"\nmonth: ${m}\n---\n\n`
  + '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | Food | ${r[2]} |  |  |\n`).join('');
const book = (b, tag) => ({
  [`${b}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${b}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${b}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [`${b}/Transactions/Cheque/2026-08.md`]: month('2026-08', [['2026-08-02', `${tag} Corner Deli`, '-15.00'], ['2026-08-03', `${tag} Butcher`, '-60.00']]),
  [`${b}/Transactions/Cheque/2026-09.md`]: month('2026-09', [['2026-09-02', `${tag} Corner Cafe`, '-35.00'], ['2026-09-03', `${tag} Bakery`, '-20.00']]),
  [`${b}/Data/Categorisation Rules.csv`]: `Pattern,Category\n${tag} CORNER,Food\n${tag} CORNER CAFE,Food\n`,
  // A second account, so the bulk delete's selection in one period spans two files.
  [`${b}/Accounts/Card.md`]: '---\ntype: credit_card\nbalance: 0.00\nbalance_updated: 2026-09-30\n---\n',
  [`${b}/Transactions/Card/2026-09.md`]: month('2026-09', [['2026-09-04', `${tag} Corner Shop`, '-9.00']]).replace('account: "Cheque"', 'account: "Card"'),
});
const FILES = { ...book(HOME, 'HOME'), ...book(ACME, 'ACME') };
const files = ctx => new Map([...ctx.vault._store].filter(([k]) => !k.endsWith('/.folder')));
const under = (m, folder) => new Map([...m].filter(([k]) => k.startsWith(folder + '/')));

async function mount() {
  const { ctx } = await mountFor(FILES, { period: '2026-09', budgetFolder: HOME });
  ctx.render = () => {};
  ctx.switchView = () => {};
  // controller.js's reload seam, which the account delete's failure path calls.
  if (typeof ctx.reloadFromDisk !== 'function') ctx.reloadFromDisk = () => ctx.loadVault();
  const store = {};
  ctx.plugin.app = { vault: ctx.vault, loadLocalStorage: k => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { store[k] = v; } };
  ctx.plugin.settings.books = LIST.map(b => ({ ...b }));
  const acmeBefore = under(files(ctx), ACME);
  /* The switch a sibling plugin / second view / synced data.json makes, with
     the new book's reload COMMITTED before control returns. */
  const switchAndCommit = async () => { ctx.plugin.setOpenBookLocal(ACME); await ctx.loadVault(); };
  /* Run switchAndCommit from INSIDE the first vault call of `kind` whose path
     matches — the write is landing when the switch happens. */
  const onWrite = (kind, re) => {
    const real = ctx.vault[kind].bind(ctx.vault);
    let fired = false;
    ctx.vault[kind] = async (a, b) => {
      const r = await real(a, b);
      const p = typeof a === 'string' ? a : a && a.path;
      if (!fired && re.test(p)) { fired = true; await switchAndCommit(); }
      return r;
    };
  };
  const acmeUntouched = what => eq(under(files(ctx), ACME), acmeBefore, `${what}: every file of the book switched TO is byte-identical`);
  const toastsFrom = n => ctx._toasts.slice(n);
  return { ctx, onWrite, switchAndCommit, acmeUntouched, toastsFrom };
}
const noSuccess = (ts, what) => ok(ts.length && ts.every(t => t.bad === true), `${what}: the reader is told in red, and never given a success toast (${JSON.stringify(ts.map(t => t.msg))})`);

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. bulk delete: the switch lands while the delete log is written ---- */
    {
      const m = await mount();
      m.ctx.$('#txSearch').value = 'corner';
      m.onWrite('create', /Deleted transactions\.csv$/);
      const t0 = m.ctx._toasts.length;
      const homeMonths = [`${HOME}/Transactions/Cheque/2026-08.md`, `${HOME}/Transactions/Cheque/2026-09.md`].map(p => m.ctx.vault._store.get(p));
      await m.ctx.deleteFilteredTransactions();
      m.acmeUntouched('bulk delete, switch during the log write');
      ok(!m.ctx.vault._store.get(`${ACME}/Transactions/Cheque/2026-09.md`).includes('HOME'), '… the household\'s rows are NOT in Acme\'s month (the repro\'s `HOME Bakery`)');
      eq([`${HOME}/Transactions/Cheque/2026-08.md`, `${HOME}/Transactions/Cheque/2026-09.md`].map(p => m.ctx.vault._store.get(p)), homeMonths,
        '… no month of the household was rewritten either — the loop stopped at its first write');
      const ts = m.toastsFrom(t0);
      noSuccess(ts, 'bulk delete, switch during the log write');
      ok(/Stopped before any file was changed/.test(ts[ts.length - 1].msg) && /already lists these rows/.test(ts[ts.length - 1].msg),
        '… and it says nothing was deleted AND that the delete log now lists them anyway');
    }

    /* ---- 2. bulk delete: the switch lands between two month writes ---------- */
    {
      const m = await mount();
      m.ctx.$('#txSearch').value = 'corner';
      m.onWrite('modify', new RegExp(`^${HOME}/Transactions/(Cheque|Card)/2026-09\\.md$`));
      const t0 = m.ctx._toasts.length;
      await m.ctx.deleteFilteredTransactions();
      m.acmeUntouched('bulk delete, switch between two month writes');
      const changedHome = ['Cheque', 'Card'].filter(a => m.ctx.vault._store.get(`${HOME}/Transactions/${a}/2026-09.md`) !== FILES[`${HOME}/Transactions/${a}/2026-09.md`]);
      eq(changedHome.length, 1, '… exactly one household month was rewritten — the one whose write was already landing');
      const ts = m.toastsFrom(t0);
      noSuccess(ts, 'bulk delete, between two month writes');
      ok(/Stopped after 1 file/.test(ts[ts.length - 1].msg), `… and the toast says so: "${ts[ts.length - 1].msg}"`);
    }

    /* ---- 3. undo-import: the switch lands between two months ---------------- */
    {
      const m = await mount();
      const S = m.ctx.S;
      S.pendingImport = { label: 'Cheque', filename: 'cheque.csv', index: buildIndex(S.txFiles),
        items: [['2026-08-20', 'IMPORTED Fuel', -300], ['2026-09-20', 'IMPORTED Toll', -40]]
          .map(([date, desc, amount]) => ({ date, desc, cat: 'Food', amount, excluded: false, include: true, dup: false })) };
      await m.ctx.commitImport();
      ok(S.lastImport && S.lastImport.files.length === 2, 'fixture: the import landed in two household months, and an undo is on offer');
      const homeAfterImport = under(files(m.ctx), HOME);
      m.onWrite('modify', new RegExp(`^${HOME}/Transactions/Cheque/2026-0[89]\\.md$`));
      const t0 = m.ctx._toasts.length;
      await m.ctx.undoImport();
      m.acmeUntouched('undo-import, switch between two months');
      const reverted = [...homeAfterImport.keys()].filter(k => m.ctx.vault._store.get(k) !== homeAfterImport.get(k));
      eq(reverted.length, 1, '… exactly one household month was taken back');
      const ts = m.toastsFrom(t0);
      noSuccess(ts, 'undo-import, between two months');
      ok(/Undo stopped after 1 file/.test(ts[ts.length - 1].msg), `… and says how far it got: "${ts[ts.length - 1].msg}"`);
    }

    /* ---- 4. the Transactions Save loop -------------------------------------- */
    {
      const m = await mount();
      for (const k of ['Cheque/2026-08', 'Cheque/2026-09']) { m.ctx.S.txFiles[k].rows[0].note = 'edited'; m.ctx.S.txFiles[k].dirty = true; }
      m.onWrite('modify', new RegExp(`^${HOME}/Transactions/Cheque/2026-0[89]\\.md$`));
      const t0 = m.ctx._toasts.length;
      await m.ctx.saveTransactions();
      m.acmeUntouched('Save, switch between two months');
      const ts = m.toastsFrom(t0);
      noSuccess(ts, 'Save, between two months');
      ok(/1/.test(ts[ts.length - 1].msg), `… naming the one file that did save: "${ts[ts.length - 1].msg}"`);
    }

    /* ---- 5. Add transaction: switch while the form is open ------------------ */
    {
      const m = await mount();
      answers.push({ date: '2026-09-21', desc: 'TYPED IN HOME', label: 'Cheque', dir: 'out', amount: '12', cat: 'Food', note: '' });
      hooks.dialog = m.switchAndCommit;
      const t0 = m.ctx._toasts.length;
      await m.ctx.addTransaction();
      m.acmeUntouched('Add transaction, switch while the form is open');
      eq(under(files(m.ctx), HOME), under(new Map(Object.entries(FILES)), HOME), '… and nothing written to the household either');
      noSuccess(m.toastsFrom(t0), 'Add transaction');
    }
    /* ---- 5b. account balance: switch while the form is open ----------------- */
    {
      const m = await mount();
      const a = m.ctx.S.accounts.find(x => x.name === 'Cheque');
      answers.push({ balance: '999.00', as_at: '2026-10-01' });
      hooks.dialog = m.switchAndCommit;
      const t0 = m.ctx._toasts.length;
      await m.ctx.editBalance(a);
      m.acmeUntouched('account balance, switch while the form is open');
      ok(!/999/.test(m.ctx.vault._store.get(`${ACME}/Accounts/Cheque.md`)), '… the household\'s balance is not patched into Acme\'s account of the same name');
      noSuccess(m.toastsFrom(t0), 'account balance');
    }

    /* ---- 6. account delete: file, then its folder — switch between them ------ */
    {
      const m = await mount();
      const a = m.ctx.S.accounts.find(x => x.name === 'Cheque');
      answers.push({ folder: 'drop' });
      m.onWrite('trash', new RegExp(`^${HOME}/Accounts/Cheque\\.md$`));
      const t0 = m.ctx._toasts.length;
      await m.ctx.deleteAccount(a);
      m.acmeUntouched('account delete, switch between the file and its folder');
      /* The cleanup after the trash loop drops every month of the deleted
         account's label from memory — run against the state that won, it took
         Acme's Cheque months out of the screen. */
      ok(m.ctx.S.txFiles['Cheque/2026-09'] && m.ctx.S.txFiles['Cheque/2026-09'].rows.some(r => /ACME/.test(r.desc)),
        '… and Acme\'s Cheque months are still in memory: the household\'s delete cleanup did not run against Acme\'s state');
      noSuccess(m.toastsFrom(t0), 'account delete');
    }

    /* ---- 7. the rules tidy: its removals are indices into one load's list ---- */
    {
      const m = await mount();
      hooks.dialog = m.switchAndCommit;
      const t0 = m.ctx._toasts.length;
      await m.ctx.cleanupRules();
      m.acmeUntouched('rules tidy, switch while the preview is open');
      noSuccess(m.toastsFrom(t0), 'rules tidy');
    }

    /* ---- 8. the backstop: unstamped writes in one burst --------------------- */
    {
      const m = await mount();
      const S = m.ctx.S;
      const targets = ['Cheque/2026-08', 'Cheque/2026-09'].map(k => S.txFiles[k]);
      m.onWrite('modify', new RegExp(`^${HOME}/Transactions/Cheque/2026-08\\.md$`));
      const codes = [];
      for (const f of targets) {
        try { await m.ctx.writeFile(m.ctx.txFileRel(f.label, f.month), `FROM: ${f.rows.map(r => r.desc).join(',')}`); codes.push('ok'); } catch (e) { codes.push(e.code); break; }
      }
      eq(codes, ['ok', 'BOOK_CHANGED'], 'a loop with NO stamp: the write already landing finishes (in the household), the next is refused by the write window');
      m.acmeUntouched('unstamped burst');
    }

    /* ---- 9. a same-book reload under a stamped operation -------------------- */
    {
      const m = await mount();
      const op = m.ctx.opWriter();
      await m.ctx.loadVault();
      let code = null;
      try { await op.writeFile('Transactions/Cheque/2026-09.md', 'x'); } catch (e) { code = e.code; }
      eq(code, 'RELOADED', 'a stamped write after a same-book reload is refused as RELOADED — its objects are not the ones in memory');
      eq(m.ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-09.md`), FILES[`${HOME}/Transactions/Cheque/2026-09.md`], '… and nothing was written');
      ok(m.ctx.opWriter().replaced() === null, 'NEGATIVE CONTROL: a writer taken now is not replaced');
    }

    /* ---- 10. a superseded load's failure is followed, not handed on --------- */
    {
      const ctx = H.makeCtx(FILES, { budgetFolder: HOME });
      const store = {};
      ctx.plugin.app = { vault: ctx.vault, loadLocalStorage: k => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { store[k] = v; } };
      ctx.plugin.settings.books = LIST.map(b => ({ ...b }));
      for (const f of ['io', 'period', 'trend-math', 'figures', 'health-data', 'load']) require(`../src/${f}`)(ctx);
      require('../src/views/notes')(ctx);
      const realRead = ctx.vault.cachedRead.bind(ctx.vault);
      ctx.vault.cachedRead = async f => {
        await new Promise(r => setTimeout(r, 15));
        if (f.path.startsWith(`${HOME}/Accounts/`)) throw new Error('the household\'s iCloud copy is not downloaded');
        return realRead(f);
      };
      const first = ctx.loadVault();
      await new Promise(r => setTimeout(r, 5));
      ctx.plugin.setOpenBookLocal(ACME);
      const second = ctx.loadVault();
      let firstErr = null;
      await first.catch(e => { firstErr = e; });
      await second;
      eq(firstErr, null, 'the household\'s load failed AFTER the switch, and its caller is not handed that failure (it would mark Acme\'s screen failed)');
      ok(ctx.loadedBook() && ctx.loadedBook().folder === ACME, '… it follows the switch: the state is Acme\'s');
      eq(ctx.S.categories.map(c => c.name), ['Food'], '… whole');
      /* NEGATIVE CONTROL: a failure of the book that IS open still reaches its caller. */
      ctx.vault.cachedRead = async () => { throw new Error('offline'); };
      let err = null;
      try { await ctx.loadVault(); } catch (e) { err = e; }
      ok(err && /offline/.test(err.message), 'NEGATIVE CONTROL: a failed load of the open book still rejects');
    }

    /* ---- 11. a failed load after a switch shows the connect screen ---------- */
    {
      const { failedLoadShowsConnect } = require('../src/controller');
      eq(failedLoadShowsConnect({ folder: HOME }, ACME), true, 'the state on screen is another book\'s → the connect screen, with the error');
      eq(failedLoadShowsConnect(null, ACME), true, 'nothing loaded yet → the connect screen');
      eq(failedLoadShowsConnect({ folder: ACME }, ACME), false, 'NEGATIVE CONTROL: a same-book reload that failed keeps its intact state on screen');
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
      ok(/\$\('#connectErr'\)\.textContent = e\.message \|\| String\(e\);[\s\S]{0,400}if \(failedLoadShowsConnect\(typeof ctx\.loadedBook === 'function' \? ctx\.loadedBook\(\) : null, ctx\.basePath\(\)\)\) \{\s*showConnectScreen\(\);/.test(src),
        'connectVault\'s catch asks it, and shows the connect screen (where #connectErr is visible) when it says so');
    }
  } finally { unpin(); Module._load = origLoad; }

  console.log(`PASS books-midloop-switch — a reload committing between two writes of one operation writes nothing into the new book, at every multi-write site, and the toast says how far it got (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
