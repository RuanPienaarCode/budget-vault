'use strict';
/* The headless API's watcher, two follow-ups from the 2026-10-07 audit's fix:
   a file renamed OUT of the budget folder is a change, and one change costs
   one read of the folder, not two.

   RENAME. Obsidian's 'rename' event hands over the file at its NEW path and
   the path it had before. api.js looked at the new path only, so a file moved
   out of the budget folder — an account file dragged to an archive folder, a
   month file moved away by hand — left the folder without anything hearing
   it: Vista's card kept the figure that file used to be part of.

   ONE READ. A subscriber is told "re-read with currentPeriod()" right after
   the API's own reload, and currentPeriod() then read the whole folder again
   — two full reads per change, on a vault the audit measured at hundreds of
   files. currentPeriod() now reuses the reload that has just finished, for a
   short while, and never when anything could have made it out of date: a
   budget-folder change since that read began, a change of lock (or any write
   of data.json, which is how a setting change reaches the API), the plugin
   unloading, or simply time. Still nothing is read while locked.

   Obsidian's Plugin base is stood in for by its Component lifecycle, as in
   tests/api-watcher.test.cjs. The vault is the harness's in-memory one with a
   read counter and an event bus that, like Obsidian's, passes (file, oldPath)
   to a 'rename' handler.

     node tests/api-watcher-rename-and-reuse.test.cjs */

const assert = require('assert');
const { stubObsidian, makeVault } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const { buildApi } = require('../src/api');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const settle = ms => new Promise(r => setTimeout(r, ms));

function makeHost({ privacyLock = false, unlocked = false } = {}) {
  const vault = makeVault({ ...SEED });
  const counts = { reads: 0 };
  const rawCached = vault.cachedRead.bind(vault);
  vault.cachedRead = async f => { counts.reads++; return rawCached(f); };
  const handlers = {};
  vault.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return { e: vault, name, fn }; };
  vault.offref = ref => { handlers[ref.name] = (handlers[ref.name] || []).filter(f => f !== ref.fn); };
  const emit = (name, p, oldPath) => (handlers[name] || []).slice().forEach(fn => fn({ path: p }, oldPath));
  const events = [];
  const plugin = {
    settings: { budgetFolder: B, privacyLock }, budgetUnlocked: unlocked,
    app: { vault, workspace: { onLayoutReady: cb => cb() } }, _lastWrite: 0,
    register(cb) { events.push(cb); },
    registerEvent(ref) { this.register(() => ref.e.offref(ref)); },
  };
  const api = buildApi(plugin);
  const unload = () => { while (events.length) events.pop()(); };
  return { plugin, api, vault, counts, emit, unload };
}

/* A subscriber that does what Vista's card does: re-read the moment it is
   told. Records how many vault reads each of its own re-reads cost, and what
   it was handed. */
function reReader(h) {
  const log = { reads: [], got: [] };
  h.api.onChange(async () => {
    const before = h.counts.reads;
    const got = await h.api.currentPeriod();
    log.reads.push(h.counts.reads - before);
    log.got.push(got);
  });
  return log;
}

(async () => {
  const unpin = pinClock(TODAY);
  try {
    /* What one full read of this budget folder costs. */
    const R = await (async () => { const h = makeHost(); await h.api.currentPeriod(); return h.counts.reads; })();
    ok(R > 5, `sanity: one read of the household's budget folder is ${R} file reads`);

    /* ---- 1. renamed OUT of the budget folder is a change ---- */
    {
      const h = makeHost();
      let heard = 0;
      h.api.onChange(() => { heard++; });
      h.emit('rename', 'Archive/Old cheque.md', `${B}/Accounts/Old cheque.md`);
      await settle(1000);
      eq(heard, 1, 'a file moved out of the budget folder is heard: the folder lost something');
      ok(h.counts.reads >= R, 'and the folder is re-read');

      h.emit('rename', `${B}/Accounts/New cheque.md`, 'Inbox/New cheque.md');
      await settle(1000);
      eq(heard, 2, 'a file moved INTO the budget folder is heard, as before');

      h.emit('rename', `${B}/Accounts/Renamed.md`, `${B}/Accounts/Old name.md`);
      await settle(1000);
      eq(heard, 3, 'a rename inside the folder is one change');

      const reads = h.counts.reads;
      h.emit('rename', 'Journal/2026-09-02.md', 'Inbox/2026-09-02.md');
      await settle(1000);
      eq(heard, 3, 'a rename entirely outside the budget folder is not a change to the budget');
      eq(h.counts.reads, reads, 'and reads nothing');
    }

    /* ---- 2. one change, one read ---- */
    {
      const h = makeHost();
      const log = reReader(h);
      const fresh = await makeHost().api.currentPeriod();   // an independent reading of the same files
      h.counts.reads = 0;
      h.emit('modify', `${B}/Transactions/Cheque/2026-09.md`);
      await settle(1000);
      eq(log.reads, [0], "the subscriber's re-read reuses the reload that told it — no second read");
      eq(h.counts.reads, R, 'so one change cost exactly one read of the folder');
      eq(log.got[0], fresh, 'and the figure it was handed is the one a fresh read gives');
    }

    /* ---- 3. a change after the reload is never served stale ---- */
    {
      const h = makeHost();
      let heard = 0;
      h.api.onChange(() => { heard++; });
      h.emit('modify', `${B}/Settings.md`);
      await settle(1000);
      eq(heard, 1, 'sanity: the reload ran and notified');
      const was = await h.api.currentPeriod();
      // The budget changes on disk and the event arrives — the reload it
      // schedules is 800ms away, but a reader asking NOW must see the change.
      const file = h.vault.getFileByPath(`${B}/Budgets/${PERIOD}.md`);
      const text = await h.vault.cachedRead(file);
      ok(text.includes('| Groceries | expense | 5000.00 |'), 'sanity: the envelope this scenario edits');
      await h.vault.modify(file, text.replace('| Groceries | expense | 5000.00 |', '| Groceries | expense | 6000.00 |'));
      h.emit('modify', file.path);
      const reads = h.counts.reads;
      const now = await h.api.currentPeriod();
      eq(h.counts.reads - reads, R, 'a change since the reload: the next read reads the folder again');
      eq(now.budgeted, was.budgeted + 1000, 'and hands back what is on disk now, not the reload from before it');
      await settle(1000);
    }

    /* ---- 4. a change DURING the reload's read: that read is not reused ---- */
    {
      const h = makeHost();
      const log = reReader(h);
      let release;
      const held = new Promise(r => { release = r; });
      const realCached = h.vault.cachedRead;
      h.vault.cachedRead = async f => { await held; return realCached(f); };
      const pending = h.api._reload();
      await settle(0);
      h.emit('modify', `${B}/Transactions/Cheque/2026-09.md`);   // lands while the folder is being read
      h.vault.cachedRead = realCached;
      release();
      await pending;
      await settle(50);
      eq(log.reads, [R], 'the reload that overlapped a change is not reused — the subscriber reads for itself');
      await settle(1000);
      eq(log.reads, [R, 0], 'and the reload that change scheduled is, once it has finished');
    }

    /* ---- 5. never across a change of lock ---- */
    {
      const h = makeHost({ privacyLock: true, unlocked: true });
      const log = reReader(h);
      h.emit('modify', `${B}/Settings.md`);
      await settle(1000);
      eq(log.reads, [0], 'sanity: open, a change reads once');
      h.api._setUnlocked(false);
      await settle(50);
      eq(log.got[1], { locked: true }, 'the lock closes: the subscriber is told and handed the lock');
      eq(log.reads[1], 0, 'reading nothing');
      h.api._setUnlocked(true);
      await settle(50);
      eq(log.reads[2], R, 'the lock opens again: the folder is read again, not served from before the lock');
      ok(log.got[2] && log.got[2].locked === undefined, 'and the figure comes back');
    }

    /* ---- 6. a write of data.json (a setting changed) is never served stale ---- */
    {
      const h = makeHost();
      let heard = 0;
      h.api.onChange(() => { heard++; });
      h.emit('modify', `${B}/Settings.md`);
      await settle(1000);
      eq(heard, 1, 'sanity: reloaded');
      h.api._syncLock();          // what main.js saveData() calls after every settings write
      const reads = h.counts.reads;
      await h.api.currentPeriod();
      eq(h.counts.reads - reads, R, 'after a settings write the next read reads the folder');
    }

    /* ---- 7. short-lived: a reader who comes back later reads again ---- */
    {
      const h = makeHost();
      let heard = 0;
      h.api.onChange(() => { heard++; });
      h.emit('modify', `${B}/Settings.md`);
      await settle(1000);
      eq(heard, 1, 'sanity: reloaded');
      await settle(1100);         // elapsed time, not the pinned date: the clock above is frozen
      const reads = h.counts.reads;
      await h.api.currentPeriod();
      eq(h.counts.reads - reads, R, 'a second after the reload, currentPeriod() reads the folder again');
    }

    /* ---- 8. locked: still nothing read ---- */
    {
      const h = makeHost({ privacyLock: true, unlocked: false });
      const log = reReader(h);
      h.emit('modify', `${B}/Settings.md`);
      h.emit('rename', 'Archive/Old cheque.md', `${B}/Accounts/Old cheque.md`);
      await settle(1000);
      eq(h.counts.reads, 0, 'locked: a change and a rename out of the folder read nothing');
      eq(log.reads, [], 'and tell nobody');
      eq(await h.api.currentPeriod(), { locked: true }, 'currentPeriod() is the lock');
      eq(h.counts.reads, 0, 'still with no read');
    }

    console.log(`PASS — api-watcher-rename-and-reuse: a rename out of the folder is heard, and one change costs one read (${checks} checks).`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
