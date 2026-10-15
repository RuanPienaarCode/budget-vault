'use strict';
/* A Save never overwrites what somebody else wrote since the page loaded
   (2026-10-14 audit, lane S1: L3-01, L3-02, L3-06, L3-13, and the L8 note on
   stampWrite).

   Every whole-file writer serialises from state captured at LOAD and hands
   io.writeFile a complete new file; nothing compared the file first. A row typed
   on the phone (iCloud) or in the markdown view between load and Save was
   deleted by the Save. The page cannot simply reload — a page with unsaved edits
   defers its reload, and the edits exist nowhere else — so the decision is: the
   vault watcher REPORTS what it saw (io.observeChange), and a write to a file
   the page has not read since REFUSES, in plain words, with code 'STALE'.

   What this suite pins, over the real io.js and an evented in-memory vault (the
   vault emits for the plugin's own writes too, which is what Obsidian does and
   what the old 2-second echo guard existed for):

     1. L3-01 an external edit, then Save: refused, the external bytes survive,
        the error carries code 'STALE' and says which file in plain words; the
        listener the controller subscribes through is told once per refusal.
     2. a completed full reload (staleClear) and a fresh readFile both lift it —
        and an edit that lands DURING a reload is not cleared by that reload.
     3. L3-02 the plugin's own echo is not an external edit, however many writes
        are in flight (the echo of write A arrives after write B was recorded);
        a phone edit landing one second after a Save IS seen (the old global
        window dropped it); a failed write is not recorded as ours.
     4. L3-06 a file renamed or deleted while the page held it: Save refuses
        and creates nothing at the old path; a genuinely new file still creates.
     5. Settings.md and Exchange Rates.md are never refused (their writers do not
        serialise from load-time state), and the names match their owners.
     6. L3-13 trashFile re-checks the file after the dialog: a file replaced in
        the meantime is not trashed, a file already gone returns false.
     7. L8 stampWrite runs AFTER a successful write, not before.
     8. the controller wiring: the watcher asks io (not a time window), and
        reschedules rather than drops.

     node tests/save-refuses-stale-files.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeVault } = require('./helpers/harness.cjs');
stubObsidian();
const { makeIo } = require('../src/io');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const rejects = async (fn, m) => {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, m); checks++;
  return err;
};

const B = 'Budget';
const TX = 'Transactions/Cheque/2026-09.md';
const TXT = '---\naccount: "Cheque"\n---\n\n| Date | Description | Amount |\n|---|---|---:|\n| 2026-09-01 | Coffee | -35.00 |\n';
const PHONE_ROW = '| 2026-09-02 | typed on the phone | -120.00 |\n';

/* An evented vault + io, the way the app has them: every write the vault
   performs is announced to io.observeChange afterwards (modify / create /
   delete), the plugin's own included. `inflight` holds those announcements so a
   test can let them settle, or race them. */
function rig(files, { announceOwn = true } = {}) {
  const vault = makeVault(files);
  const plugin = { settings: { budgetFolder: B }, _lastWrite: 0 };
  const io = makeIo({ vault, plugin });
  const inflight = [];
  const tell = (kind, file, old) => {
    const p = typeof io.observeChange === 'function' ? io.observeChange(file, old, kind) : Promise.resolve({ own: false });
    inflight.push(p);
    return p;
  };
  if (announceOwn) {
    const m = vault.modify, c = vault.create, t = vault.trash;
    vault.modify = async (f, x) => { await m(f, x); tell('modify', f); };
    vault.create = async (p, x) => { const f = await c(p, x); tell('create', f); return f; };
    vault.trash = async (f, sys) => { await t(f, sys); tell('delete', f); };
  }
  const raw = { modify: vault.modify, create: vault.create, trash: vault.trash };
  /* Somebody else: the phone, the markdown view, the file explorer. Applied to
     the store and announced exactly as the plugin's own writes are. */
  const other = {
    async edit(rel, fn) {
      const f = vault.getFileByPath(`${B}/${rel}`);
      await raw.modify(f, fn(vault._store.get(f.path)));
      return tell('modify', f);
    },
    async rename(from, to) {
      const text = vault._store.get(`${B}/${from}`);
      vault._store.delete(`${B}/${from}`);
      const f = await raw.create(`${B}/${to}`, text);
      return tell('rename', f, `${B}/${from}`);
    },
    async remove(rel) {
      const f = vault.getFileByPath(`${B}/${rel}`);
      await raw.trash(f);
      return tell('delete', f);
    },
  };
  const settle = async () => { await Promise.all(inflight.splice(0)); };
  return { vault, plugin, io, other, settle, text: rel => vault._store.get(`${B}/${rel}`) };
}

const BASE = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\n---\n',
  [`${B}/${TX}`]: TXT,
  [`${B}/Assets.md`]: '---\nkind: assets\n---\n',
  [`${B}/Data/Categorisation Rules.csv`]: 'pattern,category\nWOOLWORTHS,Food\n',
});

(async () => {
  /* ---- 1. L3-01: edit under the page, then Save ---- */
  {
    const r = rig(BASE());
    const told = [];
    if (typeof r.io.onStaleWrite === 'function') r.io.onStaleWrite(e => told.push(e));
    await r.io.readFile(TX);                                    // the page loads
    await r.other.edit(TX, t => t + PHONE_ROW);                 // the phone adds a row
    await r.settle();
    const err = await rejects(() => r.io.writeFile(TX, TXT.replace('Coffee', 'Coffee (recategorised)')),
      'L3-01: a Save over a file that changed since the page read it is refused');
    eq(err.code, 'STALE', 'L3-01: the refusal carries code STALE');
    ok(/Cheque\/2026-09\.md|2026-09/.test(err.message), 'L3-01: the message names the file');
    ok(!/[{}]/.test(err.message) && /nothing was written|not written|not saved/i.test(err.message),
      'L3-01: the message says, in words, that nothing was written');
    ok(r.text(TX).includes('typed on the phone'), 'L3-01: the phone row is still on disk');
    ok(!r.text(TX).includes('recategorised'), 'L3-01: and the refused content never landed');
    eq(told.length, 1, 'L3-01: the controller\'s listener is told once per refusal');
    eq(told[0] && told[0].rel, TX, 'L3-01: …with the budget-relative path');

    /* patchFile and the binary writer go through the same door. */
    await rejects(() => r.io.patchFile(TX, 'account: "Cheque"', '\n\nbody\n', { account: 'X' }), 'L3-01: patchFile is refused too');
    await rejects(() => r.io.writeBinary(TX, new Uint8Array([1, 2, 3]).buffer), 'L3-01: and writeBinary');
    ok(r.text(TX).includes('typed on the phone'), 'L3-01: still intact after three refusals');

    /* ---- 2. what lifts it ---- */
    await r.io.readFile(TX);
    await r.io.writeFile(TX, r.text(TX) + '| 2026-09-03 | after a fresh read | -1.00 |\n');
    ok(r.text(TX).includes('after a fresh read'), 'a fresh readFile lifts the refusal for that path (the caller holds current bytes)');

    await r.other.edit(TX, t => t + '| 2026-09-04 | second phone edit | -2.00 |\n');
    await r.settle();
    const mark = r.io.staleMark();
    await r.io.staleClear(mark);
    await r.io.writeFile(TX, r.text(TX) + '| 2026-09-05 | after a reload | -3.00 |\n');
    ok(r.text(TX).includes('after a reload'), 'a completed full reload lifts every refusal marked before it began');

    await r.other.edit(TX, t => t + '| 2026-09-06 | landed DURING the reload | -4.00 |\n');
    await r.settle();
    r.io.staleClear(mark);                                      // the reload that started BEFORE that edit finishes
    await rejects(() => r.io.writeFile(TX, 'x'), 'an edit that landed during a reload is not cleared by it');
  }

  /* ---- 3. L3-02: our own echo is not an external edit ---- */
  {
    const r = rig(BASE());
    await r.io.writeFile(TX, TXT + '| 2026-09-02 | ours A | -1.00 |\n');
    await r.settle();
    await r.io.writeFile(TX, TXT + '| 2026-09-02 | ours B | -2.00 |\n');   // a second save straight after
    await r.settle();
    await r.io.writeFile(TX, TXT + '| 2026-09-02 | ours C | -3.00 |\n');
    ok(r.text(TX).includes('ours C'), 'L3-02: consecutive saves of one file are not mistaken for external edits');
  }
  {
    /* The echo of write A arrives AFTER write B has been recorded: the event
       handler reads the file (now B) and must still recognise it as ours. */
    const r = rig(BASE(), { announceOwn: false });
    await r.io.writeFile(TX, TXT + 'A\n');
    const fileA = r.vault.getFileByPath(`${B}/${TX}`);
    await r.io.writeFile(TX, TXT + 'B\n');
    const late = typeof r.io.observeChange === 'function' ? await r.io.observeChange(fileA, undefined, 'modify') : { own: false };
    ok(late.own === true, 'L3-02: a late echo of an earlier own write is recognised as ours');
    await r.io.writeFile(TX, TXT + 'C\n');
    ok(r.text(TX).endsWith('C\n'), 'L3-02: and does not block the next save');
  }
  {
    /* The old guard: ANY budget change within 2 s of ANY write was dropped. A
       phone edit one second after a Save to a DIFFERENT file was never loaded. */
    const r = rig(BASE());
    await r.io.writeFile('Assets.md', '---\nkind: assets\n---\n\nsaved\n');
    await r.settle();
    const seen = await r.other.edit(TX, t => t + PHONE_ROW);     // immediately after
    eq(seen && seen.own, false, 'L3-02: an external edit right after our own save is seen as external');
    await rejects(() => r.io.writeFile(TX, TXT), 'L3-02: so the next Save of that file refuses instead of deleting it');
    /* Same file: we save, then the phone edits the same file a moment later. */
    const r2 = rig(BASE());
    await r2.io.writeFile(TX, TXT + '| 2026-09-02 | ours | -1.00 |\n');
    await r2.settle();
    const seen2 = await r2.other.edit(TX, t => t + PHONE_ROW);
    eq(seen2 && seen2.own, false, 'L3-02: and on the SAME file the plugin just wrote');
    await rejects(() => r2.io.writeFile(TX, TXT), 'L3-02: …which then refuses');
  }
  {
    /* A write that fails is not ours and must not mute anything. */
    const r = rig(BASE(), { announceOwn: false });
    const real = r.vault.modify;
    r.vault.modify = async () => { throw new Error('disk full'); };
    r.plugin._lastWrite = 0;
    await rejects(() => r.io.writeFile(TX, TXT + 'X\n'), 'a rejected write still rejects');
    eq(r.plugin._lastWrite, 0, 'L8: a failed write does not stamp the write-guard');
    r.vault.modify = real;
    /* The same bytes turn up on disk anyway (a sync delivers them): they are not
       our echo, because our write never happened. */
    r.vault._store.set(`${B}/${TX}`, TXT + 'X\n');
    const res = typeof r.io.observeChange === 'function'
      ? await r.io.observeChange(r.vault.getFileByPath(`${B}/${TX}`), undefined, 'modify') : { own: true };
    eq(res.own, false, 'L8: …and the content of a write that failed is not remembered as ours');
    await r.io.readFile(TX);
    await r.io.writeFile(TX, TXT + 'Y\n');
    ok(r.plugin._lastWrite > 0, 'L8: a successful write stamps it');
  }

  /* A Save clicked in the instant between an external edit arriving and the
     watcher finishing judging it (the judging reads the file) must still see it. */
  {
    const r = rig(BASE(), { announceOwn: false });
    await r.io.readFile(TX);
    const f = r.vault.getFileByPath(`${B}/${TX}`);
    r.vault._store.set(`${B}/${TX}`, TXT + PHONE_ROW);
    const realRead = r.vault.cachedRead;
    r.vault.cachedRead = async x => { await new Promise(res => setTimeout(res, 30)); return realRead(x); };
    const judging = r.io.observeChange(f, undefined, 'modify');          // not awaited: the Save races it
    await rejects(() => r.io.writeFile(TX, TXT), 'a Save during the watcher\'s judging waits for it, then refuses');
    eq((await judging).own, false, '…and the judging itself still says external');
    ok(r.text(TX).includes('typed on the phone'), '…with the phone row intact');
  }

  /* ---- 4. L3-06: moved or deleted while the page held it ---- */
  {
    const r = rig({ ...BASE(), [`${B}/Budgets/2026-09.md`]: '---\nperiod: 2026-09\n---\n\n| Category | Amount |\n|---|---:|\n| Food | 100.00 |\n' });
    await r.io.readFile('Budgets/2026-09.md');
    await r.other.rename('Budgets/2026-09.md', 'Budgets/2026/2026-09.md');
    await r.settle();
    const err = await rejects(() => r.io.writeFile('Budgets/2026-09.md', 'rebuilt from load state'),
      'L3-06: a Save to a path whose file was moved is refused');
    eq(err.code, 'STALE', 'L3-06: with code STALE');
    eq(r.vault.getFileByPath(`${B}/Budgets/2026-09.md`), null, 'L3-06: nothing was re-created at the old path');
    ok(r.vault.getFileByPath(`${B}/Budgets/2026/2026-09.md`), 'L3-06: the moved file is where the household put it');

    await r.other.remove('Assets.md');
    await r.settle();
    await rejects(() => r.io.writeFile('Assets.md', 'rebuilt'), 'L3-06: and a Save to a path whose file was deleted');
    eq(r.vault.getFileByPath(`${B}/Assets.md`), null, 'L3-06: does not bring the deleted file back');

    await r.io.writeFile('Notes/brand-new.md', 'hello');
    eq(r.text('Notes/brand-new.md'), 'hello', 'L3-06: a genuinely new file (no event ever named it) is still created');
  }
  {
    /* A folder moved: every path beneath it is stale. */
    const r = rig(BASE());
    const folder = { path: `${B}/Transactions/Cheque`, children: [] };
    if (typeof r.io.observeChange === 'function') await r.io.observeChange(folder, `${B}/Transactions/Old`, 'rename');
    await rejects(() => r.io.writeFile('Transactions/Cheque/2026-10.md', 'x'), 'a folder rename makes the paths under it stale');
  }

  /* ---- 5. writers that do not serialise from load-time state ---- */
  {
    const r = rig(BASE());
    await r.other.edit('Settings.md', t => t + 'language: af\n');
    await r.settle();
    await r.io.writeFile('Settings.md', '---\nmonth_start_day: 1\nlanguage: af\ncurrency: R\n---\n');
    ok(r.text('Settings.md').includes('currency: R'), 'Settings.md is never refused (its updater re-reads the file)');
    const rates = fs.readFileSync(path.join(__dirname, '..', 'src', 'fx-fetch.js'), 'utf8').match(/const RATES_FILE = '([^']+)'/);
    eq(rates && rates[1], 'Exchange Rates.md', 'the exempt rates file is the one fx-fetch writes');
  }

  /* ---- 6. L3-13: the delete re-checks the file after the dialog ---- */
  {
    const r = rig(BASE(), { announceOwn: false });
    const f = r.vault.getFileByPath(`${B}/Assets.md`);
    eq(await r.io.trashFile(f), true, 'L3-13: a file still where the page left it is trashed');
    eq(r.vault.getFileByPath(`${B}/Assets.md`), null, 'L3-13: and gone');

    /* Deleted and replaced while the dialog was open: Obsidian hands back a NEW
       file object with its own creation time. */
    const g = r.vault.getFileByPath(`${B}/${TX}`);
    g.stat = { ctime: 1 };
    r.vault._store.delete(`${B}/${TX}`);
    await r.vault.create(`${B}/${TX}`, 'a different file, written by a sync while the dialog was open');
    r.vault.getFileByPath(`${B}/${TX}`).stat = { ctime: 2 };
    const err = await rejects(() => r.io.trashFile(g), 'L3-13: a file deleted and REPLACED while the dialog was open is not trashed');
    eq(err.code, 'STALE', 'L3-13: refusal carries STALE');
    ok(r.text(TX).startsWith('a different file'), 'L3-13: the replacement survives');

    /* An index rebuild hands back a fresh object for an UNCHANGED file: still the same file. */
    const u = r.vault.getFileByPath(`${B}/${TX}`);
    await r.vault.create(`${B}/Unrelated.md`, 'x');              // the harness rebuilds every node
    r.vault.getFileByPath(`${B}/${TX}`).stat = { ctime: 2 };
    eq(await r.io.trashFile(u), true, 'L3-13: the same file under a rebuilt index is still trashed');

    const h = r.vault.getFileByPath(`${B}/Data/Categorisation Rules.csv`);
    r.vault._store.delete(`${B}/Data/Categorisation Rules.csv`);
    await r.vault.create(`${B}/Other.md`, 'x');                  // rebuild: h is no longer in the index
    eq(await r.io.trashFile(h), false, 'L3-13: a file already gone reports nothing-to-delete, not a success');
  }

  /* ---- 7/8. wiring ---- */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
    ok(/observeChange\(/.test(src), 'the watcher asks io whether a change is the plugin\'s own echo');
    ok(!/Date\.now\(\) - ctx\.lastWriteAt\(\) < 2000/.test(src), 'L3-02: no global 2-second window remains in the watcher');
    ok(/staleMark\(\)/.test(src) && /staleClear\(/.test(src), 'a completed full reload clears the stale marks it began after');
    ok(/onStaleWrite\(/.test(src), 'the controller subscribes to refusals (Notice + reload)');
  }

  console.log(`PASS save-refuses-stale-files (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
