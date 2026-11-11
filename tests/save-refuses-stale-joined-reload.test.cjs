'use strict';
/* A reload that JOINS a load already in flight lifts only what that load could
   have read (2026-11-11 audit, task 1 — High, reproduced).

   tests/save-refuses-stale-files.test.cjs pins the write-side ledger over io.js
   alone: an external edit marks its path stale, a Save over a stale path
   refuses, and a completed full reload lifts the marks made before it began.
   "Before it began" was measured from the wrong place. reloadFromDisk() took
   io.staleMark() itself and then awaited loadVault() — and loadVault is
   single-flight (ADR-0007): a same-folder caller is handed the load already
   running. That load may have read a month file BEFORE the edit the reload was
   scheduled for, so the mark the reload took was newer than anything the state
   in memory contained, and clearing up to it un-marked a change nobody read:

     1. a load is reading Transactions/X/2026-07.md (it has the old bytes)
     2. the phone's row syncs into that file; io marks it stale; the watcher
        schedules its 800 ms reload
     3. that reload fires, joins the running load, and clears the mark
     4. nothing schedules another reload; the next Save is accepted and the
        phone's row is gone from disk

   On the audit's repro: `rows in memory: [ 'old row' ]`, `stale after reload:
   false`, `SAVE ACCEPTED; disk now has PHONE ROW? false`.

   What this suite pins, through the REAL loader, the real io and controller.js's
   own module-level reloadFromDisk() (the function connectVault() calls):

     1. the audit's sequence: after the joined reload the Save a page would make
        from its in-memory rows does not delete the phone's row — and the reload
        did what it was asked: it read again, so the row is in memory;
     2. when that second read FAILS, the reload lifts nothing: the path is still
        stale and the Save refuses (the mark outlives a load that never read
        past it, whatever else happens);
     3. controls — an edit that landed BEFORE the joined load began is lifted by
        it, with no second read; a plain (un-joined) reload still lifts what it
        read; an edit landing while an un-joined reload is reading survives it;
     4. the load in memory says when it began (loadedBook().staleMark), which is
        the bound the reload clears to.

     node tests/save-refuses-stale-joined-reload.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { reloadFromDisk } = require('../src/controller');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const REL = 'Transactions/X/2026-07.md';
const FULL = `${B}/${REL}`;
const TX = rows => `---\naccount: X\nmonth: 2026-07\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n${rows}`;
const OLD_ROW = '| 2026-07-01 | old row | G | -10.00 |  |  |\n';
const PHONE_ROW = '| 2026-07-02 | PHONE ROW | G | -99.00 |  |  |\n';
const OLD = TX(OLD_ROW);
const NEW = TX(OLD_ROW + PHONE_ROW);

const FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 23\n---\n',
  [`${B}/Categories/G.md`]: '---\ntype: expense\n---\n',
  [FULL]: OLD,
});

/* A mounted page, as far as the write path is concerned: the real io, period,
   loader and notes registered in controller.js's order and loaded once
   (harness loadInto), plus the one hook reloadFromDisk calls that only a
   mounted Budget page publishes. `hold()` parks the NEXT read of the month
   file after it has taken the bytes — a load mid-flight, holding what was on
   disk when it read — until the returned release() is called. `loads()` counts
   full loads by their first read (Settings.md, once per load). */
async function page() {
  const ctx = makeCtx(FILES());
  await loadInto(ctx);
  ctx.provide({ invalidateBudgetDraft: () => {} });
  const { vault } = ctx;
  const realRead = vault.cachedRead.bind(vault);
  let parked = null, settingsReads = 0, failNextLoad = false;
  vault.cachedRead = async f => {
    if (f.path === `${B}/Settings.md`) {
      settingsReads++;
      if (failNextLoad) { failNextLoad = false; throw new Error('iCloud file not materialised'); }
    }
    const text = await realRead(f);
    if (f.path === FULL && parked && !parked.taken) {
      parked.taken = true;
      parked.reached();
      await parked.gate;
    }
    return text;
  };
  const hold = () => {
    let release, reached;
    const gate = new Promise(r => { release = r; });
    const at = new Promise(r => { reached = r; });
    parked = { gate, taken: false, reached };
    return { release, reading: at };
  };
  /* Somebody else's edit, announced the way the vault watcher hears it. */
  const phone = async text => {
    vault._store.set(FULL, text);
    return ctx.observeChange(vault.getFileByPath(FULL));
  };
  const reload = () => reloadFromDisk(ctx, ctx.S, ctx.$, () => {});
  const descs = () => ctx.S.txFiles['X/2026-07'].rows.map(r => r.desc);
  /* The Save a page makes: the whole month, serialised from the rows in
     memory, handed to io.writeFile. Spelled as text here because only "does
     the phone's row survive it" is under test, not the serializer. */
  const save = async () => {
    const rows = ctx.S.txFiles['X/2026-07'].rows
      .map(r => `| ${r.date} | ${r.desc}${r.desc === 'old row' ? ' (recategorised)' : ''} | G | ${Number(r.amount).toFixed(2)} |  |  |\n`).join('');
    try { await ctx.writeFile(REL, TX(rows)); return 'written'; } catch (e) { return e.code || 'threw'; }
  };
  return { ctx, vault, hold, phone, reload, descs, save,
    loads: () => settingsReads, failNext: () => { failNextLoad = true; },
    disk: () => vault._store.get(FULL) };
}

(async () => {
  /* ---- 1. the audit's sequence ---- */
  {
    const p = await page();
    const before = p.loads();
    const h = p.hold();
    const first = p.ctx.loadVault();               // the load an earlier change started
    await h.reading;                               // …it holds the month's OLD bytes
    const seen = await p.phone(NEW);               // the phone's row syncs in mid-load
    eq(seen.own, false, 'the edit is somebody else\'s');
    ok(p.ctx.isStaleFile(REL), 'and marks the month stale');
    const joined = p.reload();                     // the debounced reload: joins the running load
    h.release();
    await Promise.all([first, joined]);

    ok(p.descs().includes('PHONE ROW') || p.ctx.isStaleFile(REL),
      'T1: after a joined reload the month is either in memory WITH the phone\'s row, or still stale — never neither');
    eq(await p.save(), 'written', 'T1: the reload read again, so the page\'s Save is one it can make');
    ok(p.disk().includes('PHONE ROW'), 'T1: the phone\'s row is still on disk after the page\'s next Save');
    ok(p.disk().includes('recategorised'), 'T1: …beside the page\'s own edit');
    eq(p.descs(), ['old row', 'PHONE ROW'], 'T1: the state the reload leaves holds what it was asked to read');
    eq(p.loads() - before, 2, 'T1: the joined load, then one more — a reload that joined a load older than the change it was scheduled for reads again, once');
    ok(!p.ctx.isStaleFile(REL), 'T1: and that second read is what lifts the mark');
  }

  /* ---- 2. the second read fails: nothing is lifted ---- */
  {
    const p = await page();
    const h = p.hold();
    const first = p.ctx.loadVault();
    await h.reading;
    await p.phone(NEW);
    const joined = p.reload();
    p.failNext();                                  // the read the reload goes on to make
    h.release();
    await first;
    let threw = null;
    try { await joined; } catch (e) { threw = e; }
    ok(threw, 'T1: a reload whose own read failed still rejects');
    eq(p.descs(), ['old row'], 'T1: memory is the joined load\'s — it never saw the phone\'s row');
    ok(p.ctx.isStaleFile(REL), 'T1: so the mark the joined load never read past is still there');
    eq(await p.save(), 'STALE', 'T1: and the Save from that state is refused');
    ok(p.disk().includes('PHONE ROW') && !p.disk().includes('recategorised'), 'T1: the phone\'s row is on disk, untouched');
  }

  /* ---- 3. controls ---- */
  {
    /* The edit landed BEFORE the load the reload joins began: that load read
       it, so it is lifted — and there is nothing to read again. */
    const p = await page();
    await p.phone(NEW);
    const before = p.loads();
    const h = p.hold();
    const first = p.ctx.loadVault();
    await h.reading;
    const joined = p.reload();
    h.release();
    await Promise.all([first, joined]);
    eq(p.loads() - before, 1, 'a reload that joins a load begun AFTER the change it wants does not read twice');
    eq(p.descs(), ['old row', 'PHONE ROW'], '…the joined load already holds the row');
    ok(!p.ctx.isStaleFile(REL), '…and its completion lifts the mark');
    eq(await p.save(), 'written', '…so the Save goes through');
    ok(p.disk().includes('PHONE ROW'), '…with the phone\'s row in it');
  }
  {
    /* No join at all: the reload is its own load, as before. */
    const p = await page();
    await p.phone(NEW);
    const before = p.loads();
    await p.reload();
    eq(p.loads() - before, 1, 'an un-joined reload is one load');
    ok(!p.ctx.isStaleFile(REL) && p.descs().includes('PHONE ROW'), 'and lifts the marks made before it began');
  }
  {
    /* An edit that lands while an un-joined reload is reading (after it took
       the month's bytes) is newer than what it read: the mark survives. */
    const p = await page();
    const h = p.hold();
    const reloading = p.reload();
    await h.reading;
    await p.phone(NEW);
    h.release();
    await reloading;
    eq(p.descs(), ['old row'], 'the reload had already read the month');
    ok(p.ctx.isStaleFile(REL), 'an edit landing DURING a reload is not lifted by it');
    eq(await p.save(), 'STALE', 'and the Save over it refuses');
    ok(p.disk().includes('PHONE ROW'), 'the phone\'s row intact');
  }

  /* ---- 4. the load says when it began ---- */
  {
    const p = await page();
    const lb0 = p.ctx.loadedBook();
    eq(typeof lb0.staleMark, 'number', 'loadedBook() carries the stale sequence its load began at');
    await p.phone(NEW);
    const mark = p.ctx.staleMark();
    ok(mark > lb0.staleMark, 'an external edit moves the sequence past the load in memory');
    await p.ctx.loadVault();
    eq(p.ctx.loadedBook().staleMark, mark, 'the next load records the sequence as it stood when IT began');
    ok(Object.isFrozen(p.ctx.loadedBook()), 'the stamp is still one frozen object per committed load');
  }

  console.log(`PASS save-refuses-stale-joined-reload (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
