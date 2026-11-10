'use strict';
/* A book switch that lands while a load is still reading (ADR 0009, the
   review of #166–#169, finding 1).

   loadVault() was single-flight: a second call while a load was in flight was
   handed THAT load's promise. Harmless while the vault had one budget folder —
   both callers wanted the same files. With books it is the worst possible
   answer: a load of book A is in flight (startup, a sync-triggered reload, a
   double pick in the switcher), the reader picks book B, switchBook() writes
   the per-device key and asks every view to reload, and the reload JOINS the
   load of A. Worse, that load resolved its paths through activeFolder() afresh
   at every step, so the half it read after the switch came from B: on the
   reviewer's repro the categories were the household's and the transaction
   rows were the client's, or the other way round, depending on where in the
   read the switch landed. activeFolder() said B, so the next Save addressed
   B's files with A's rows — `Clients/Acme/Transactions/Cheque/2026-01.md`
   ended up holding HOME-ROW.

   The headless API had the same hole one floor up: its reload joined its own
   ctx's in-flight load, and switchBook's `_syncLock()` bumped the freshness
   generation BEFORE `_reload()` captured it, so A's read was marked fresh and
   served for a second with `book: { Acme }` on it.

   Pinned here, over the REAL loader with every vault read delayed (an iCloud
   vault on a phone), at switch points spread across the whole read:

     1. view leg — whichever caller you are, the state you are handed is B's,
        whole: B's categories, settings and rows, and nothing of A's, never a
        mix. A Save made from it writes B's rows into B's file;
     2. the write guard — a state read from A can never be written into B: with
        the switch made and the reload not yet landed, writeFile, writeBinary,
        patchFile and trashFile all refuse (code BOOK_CHANGED), say so in
        words, and both books' files are byte-identical. NEGATIVE CONTROL: the
        same write after the reload goes through;
     3. API leg — the reload a switch runs is B's, the figure served as fresh
        straight after it is B's (equal to a fresh mount on B), and a
        currentPeriod() that was already reading when the switch landed hands
        back a figure whose `book` names the folder it was computed from.

     node tests/books-load-race.test.cjs */

const assert = require('assert');
const H = require('./helpers/harness.cjs');
H.stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const HOME = 'Budget';
const ACME = 'Clients/Acme';
const LIST = [{ folder: HOME, label: 'Home' }, { folder: ACME, label: 'Acme' }];
const tx = rows => `---\ntags: [x]\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n${rows}\n`;
const FILES = {
  [`${HOME}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: R\nhousehold: Home\n---\n',
  [`${HOME}/Categories/HomeFood.md`]: '---\ntype: needs\n---\n',
  [`${HOME}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 0\n---\n',
  [`${HOME}/Transactions/Cheque/2026-01.md`]: tx('| 2026-01-05 | HOME-ROW | HomeFood | -10.00 |  |  |'),
  [`${HOME}/Notes/home-note.md`]: '---\nkind: note\n---\nHOME NOTE\n',
  [`${ACME}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: $\nhousehold: Acme\n---\n',
  [`${ACME}/Categories/AcmeRent.md`]: '---\ntype: needs\n---\n',
  [`${ACME}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 0\n---\n',
  [`${ACME}/Transactions/Cheque/2026-01.md`]: tx('| 2026-01-07 | ACME-ROW | AcmeRent | -99.00 |  |  |'),
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const READ_MS = 20;

/* A device: an in-memory vault whose every read takes READ_MS, a plugin with
   the real book seam and a per-device store, and (unless bare) a view ctx with
   io + period + load registered the way controller.js orders them. */
function device() {
  const ctx = H.makeCtx(FILES, { budgetFolder: HOME });
  const store = {};
  ctx.plugin.app = { vault: ctx.vault, loadLocalStorage: k => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { store[k] = v; } };
  ctx.plugin.settings.books = LIST.map(b => ({ ...b }));
  const realRead = ctx.vault.cachedRead.bind(ctx.vault);
  ctx.vault.cachedRead = async f => { await sleep(READ_MS); return realRead(f); };
  return ctx;
}
function register(ctx) {
  require('../src/io')(ctx); require('../src/period')(ctx); require('../src/trend-math')(ctx);
  require('../src/figures')(ctx); require('../src/health-data')(ctx); require('../src/load')(ctx);
  require('../src/views/notes')(ctx);
  return ctx;
}
const snapshot = ctx => new Map([...ctx.vault._store].filter(([k]) => !k.endsWith('/.folder')));
const everyDesc = S => Object.values(S.txFiles).flatMap(f => f.rows.map(r => r.desc));

(async () => {
  /* ---- 1. view leg: the state handed back is B's, whole ------------------- */
  for (const at of [0, 5, 15, 25, 45, 65, 85, 105, 125]) {
    const ctx = register(device());
    /* What each caller sees at the moment ITS promise resolves — the first
       caller (connectVault, which then renders) as much as the second. */
    const seen = {};
    const look = name => () => { seen[name] = { cats: ctx.S.categories.map(c => c.name), rows: everyDesc(ctx.S), cur: ctx.S.settings.currency }; };
    const first = ctx.loadVault().then(look('first'));   // book A's load in flight (connectVault on unlock)
    if (at) await sleep(at);
    const finishedFirst = !!seen.first;             // A's load had already landed: nothing to race
    ctx.plugin.setOpenBookLocal(ACME);              // what switchBook writes …
    const second = ctx.loadVault().then(look('second')); // … then ctl.reload → reloadFromDisk calls
    await Promise.all([first, second]);
    const S = ctx.S;
    const where = `switch ${at}ms into A's load`;
    const HOME_STATE = { cats: ['HomeFood'], rows: ['HOME-ROW'], cur: 'R' };
    const ACME_STATE = { cats: ['AcmeRent'], rows: ['ACME-ROW'], cur: '$' };
    eq(seen.first, finishedFirst ? HOME_STATE : ACME_STATE, finishedFirst
      ? `${where}: A's load had finished before the switch — its caller had the household, whole`
      : `${where}: the first caller, when its promise resolves, is handed Acme's state whole — never the household's, never a mix`);
    eq(seen.second, ACME_STATE, `${where}: the switch's own reload is handed Acme's state whole`);
    eq(ctx.plugin.activeFolder(), ACME, `${where}: fixture — Acme is the open book`);
    eq(S.categories.map(c => c.name), ['AcmeRent'], `${where}: the categories are Acme's, and only Acme's`);
    eq(S.settings.currency, '$', `${where}: Settings.md is Acme's (currency "$", not the household's "R")`);
    eq(S.settings.household, 'Acme', `${where}: … and its household`);
    eq(everyDesc(S), ['ACME-ROW'], `${where}: the transaction rows are Acme's, and only Acme's`);
    ok(!S.notes.some(n => /home-note/.test(n.rel)), `${where}: no note of the household's survives into Acme`);

    /* The Save the reviewer's repro made: the month in memory, written back
       where txFileRel addresses it. Before the fix this put HOME-ROW into
       Acme's file. */
    const f = Object.values(S.txFiles)[0];
    const homeBefore = ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-01.md`);
    await ctx.writeFile(ctx.txFileRel(f.label, f.month), `ROWS: ${f.rows.map(r => r.desc).join(',')}`);
    const acmeAfter = ctx.vault._store.get(`${ACME}/Transactions/Cheque/2026-01.md`);
    ok(acmeAfter.includes('ACME-ROW') && !acmeAfter.includes('HOME-ROW'), `${where}: a Save writes Acme's rows into Acme's file — never the household's`);
    eq(ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-01.md`), homeBefore, `${where}: and the household's file is untouched`);
  }

  /* Two switches inside one load (A → B → A): the caller is handed A, whole —
     and not B's half-read state either. */
  {
    const ctx = register(device());
    const p1 = ctx.loadVault();
    await sleep(25);
    ctx.plugin.setOpenBookLocal(ACME);
    const p2 = ctx.loadVault();
    await sleep(25);
    ctx.plugin.setOpenBookLocal(null);
    const p3 = ctx.loadVault();
    await Promise.all([p1, p2, p3]);
    eq(ctx.S.categories.map(c => c.name), ['HomeFood'], 'A → B → A inside one read: the household, whole');
    eq(everyDesc(ctx.S), ['HOME-ROW'], '… with its own rows and none of Acme\'s');
    eq(ctx.S.settings.currency, 'R', '… and its own Settings.md');
  }

  /* A same-book reload while a load is in flight still JOINS it — the
     single-flight latch ADR-0007 relies on, kept for the case it was for. */
  {
    const ctx = register(device());
    const a = ctx.loadVault();
    await sleep(5);
    const b = ctx.loadVault();
    ok(a === b, 'two loads of the SAME book still share one read (ADR-0007 single-flight)');
    await a;
    eq(everyDesc(ctx.S), ['HOME-ROW'], '… and hand back that book');
  }

  /* ---- 2. the write guard ----------------------------------------------- */
  {
    const ctx = register(device());
    await ctx.loadVault();
    eq(everyDesc(ctx.S), ['HOME-ROW'], 'fixture: the household is loaded');
    const before = snapshot(ctx);
    ctx.plugin.setOpenBookLocal(ACME);              // switched; the reload has not landed
    const f = Object.values(ctx.S.txFiles)[0];
    const attempts = {
      writeFile: () => ctx.writeFile(ctx.txFileRel(f.label, f.month), `ROWS: ${f.rows.map(r => r.desc).join(',')}`),
      writeBinary: () => ctx.writeBinary('Tax/2026/cert.pdf', new Uint8Array([1, 2, 3]).buffer),
      patchFile: () => ctx.patchFile('Accounts/Cheque.md', 'type: checking\nbalance: 0', '\n', { balance: '5' }),
      trashFile: () => ctx.trashFile(ctx.vault.getFileByPath(`${HOME}/Notes/home-note.md`)),
    };
    for (const [name, run] of Object.entries(attempts)) {
      let err = null;
      try { await run(); } catch (e) { err = e; }
      ok(err && err.code === 'BOOK_CHANGED', `${name} with A's state while B is open is REFUSED (code BOOK_CHANGED)`);
      ok(err && typeof err.message === 'string' && err.message.length > 20 && !/\{file\}|io\.bookChanged/.test(err.message),
        `${name}: the refusal is a sentence a person reads, with nothing left unfilled`);
    }
    eq(snapshot(ctx), before, 'and nothing was written anywhere: both books\' files are byte-identical');

    /* NEGATIVE CONTROL: once the reload lands, the state is B's and the same
       kind of write goes through — the refusal was the mismatch, nothing else. */
    await ctx.loadVault();
    const g = Object.values(ctx.S.txFiles)[0];
    await ctx.writeFile(ctx.txFileRel(g.label, g.month), `ROWS: ${g.rows.map(r => r.desc).join(',')}`);
    eq(ctx.vault._store.get(`${ACME}/Transactions/Cheque/2026-01.md`), 'ROWS: ACME-ROW',
      'NEGATIVE CONTROL: after the reload the write lands, in Acme, with Acme\'s rows');
  }

  /* A load of B that FAILS leaves A's state in memory — and A's state is still
     refused a write into B, rather than the half-emptied sections the old
     in-place loader left behind. */
  {
    const ctx = register(device());
    await ctx.loadVault();
    const before = snapshot(ctx);
    ctx.plugin.setOpenBookLocal(ACME);
    const realRead = ctx.vault.cachedRead;
    ctx.vault.cachedRead = async f => { if (f.path.startsWith(ACME + '/Accounts')) throw new Error('iCloud said no'); return realRead(f); };
    let threw = null;
    try { await ctx.loadVault(); } catch (e) { threw = e; }
    ok(threw, 'fixture: the load of Acme failed partway');
    eq(ctx.S.categories.map(c => c.name), ['HomeFood'], 'a failed load commits nothing: the household\'s state is whole, not half-replaced');
    eq(everyDesc(ctx.S), ['HOME-ROW'], '… rows included');
    let err = null;
    const f = Object.values(ctx.S.txFiles)[0];
    try { await ctx.writeFile(ctx.txFileRel(f.label, f.month), 'x'); } catch (e) { err = e; }
    ok(err && err.code === 'BOOK_CHANGED', 'and that state cannot be saved into Acme');
    eq(snapshot(ctx), before, '… nothing written');
  }

  /* ---- 3. API leg ------------------------------------------------------- */
  const unpin = pinClock('2026-01-20');
  try {
    const { buildApi } = require('../src/api');
    function apiDevice({ open = null, slow = true } = {}) {
      const vault = H.makeVault(FILES);
      if (slow) {
        const realRead = vault.cachedRead.bind(vault);
        vault.cachedRead = async f => { await sleep(READ_MS); return realRead(f); };
      }
      const store = {};
      const plugin = H.bookSeam({
        settings: { budgetFolder: HOME, books: LIST.map(b => ({ ...b })) },
        app: { vault, loadLocalStorage: k => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { store[k] = v; } },
      });
      if (open) plugin.setOpenBookLocal(open);
      const api = buildApi(plugin);
      return { plugin, api };
    }
    const figureOf = v => ({ currency: v.currency, spent: v.spent, budgeted: v.budgeted, book: v.book });
    const oracle = {
      [HOME]: figureOf(await apiDevice({ slow: false }).api.currentPeriod()),
      [ACME]: figureOf(await apiDevice({ open: ACME, slow: false }).api.currentPeriod()),
    };
    ok(oracle[HOME].currency.symbol === 'R' && oracle[ACME].currency.symbol === '$', 'fixture: the two books\' figures differ (R vs $)');
    ok(oracle[HOME].spent !== oracle[ACME].spent, 'fixture: … and so does what they spent');

    for (const at of [5, 25, 45, 65, 85]) {
      const { plugin, api } = apiDevice();
      let told = 0;
      api.onChange(() => { told++; });
      const reading = api.currentPeriod();          // a sibling's read of book A, in flight
      await sleep(at);
      plugin.setOpenBookLocal(ACME);                // switchBook: the key …
      api._syncLock();                              // … then retire anything fresh …
      await api._reload();                          // … then re-read and notify
      const during = await reading;
      const where = `API, switch ${at}ms into a read`;
      eq(told, 1, `${where}: subscribers told once`);
      const after = await api.currentPeriod();      // within FRESH_MS: served from _reload's state
      eq(figureOf(after), oracle[ACME], `${where}: the figure served straight after the switch is Acme's — equal to a fresh mount on Acme`);
      ok(during && during.book && oracle[during.book.folder], `${where}: the read in flight names a book`);
      eq(figureOf(during), oracle[during.book.folder],
        `${where}: and the figure it hands back is the one for the book it names (never A's numbers under B's label)`);
    }
  } finally { unpin(); }

  console.log(`PASS books-load-race — a switch mid-load hands back B's state whole, A's state is never written into B, and the API serves B's figure under B's name (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
