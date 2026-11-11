'use strict';
/* A book at the vault root saves — and can no more lose a phone's edit, or
   touch a note that is not its own, than a book in a folder can
   (2026-11-11 audit, task 2, the enabling half).

   A root book could read and never save: every write was refused as "outside
   the budget folder", first by accident (a prefix test against an empty
   base) and then on purpose, because the vault watcher could not see such a
   book and nothing would have refused a Save over a file somebody else had
   changed. The watcher sees it now (tests/root-book-watcher.test.cjs), and
   the refusal is lifted onto the same predicate the watcher asks.

   This suite is the proof that lifting it is safe, END TO END: the real io,
   the real loader (harness loadInto), the controller's own reloadFromDisk,
   and a vault that announces every change it makes — the plugin's own writes
   included, as Obsidian does — through the watcher's gate exactly as
   controller.js wires it (fsChangeInBudget, then io.observeChange, then a
   reload for anything that was not our echo).

   The household sits at the vault root beside what a real vault also holds:
   a journal, a README, a project folder with a Transactions/ of its own, and
   Obsidian's config folder. Then the SAME script runs over the same
   household in a folder, Budget/, beside the same strangers — and every
   outcome is compared with the root's. Both under the harness's
   normalizePath and under Obsidian 1.15.0's, where the root is '/'.

     (a) a Save lands: a month rewritten, a new month created beside it, an
         account's frontmatter patched over an untouched body, a binary, a
         delete — each at the path the loader read it from, each recognised
         as the plugin's own echo, and a reload reads them back;
     (b) a Save after an external edit the page has not read is REFUSED
         (code STALE), the external bytes survive, and the reader is told
         once — for an edit, a rename out of the book, a delete, and a Save
         clicked while the watcher is still judging the change; a completed
         reload lifts it, and no other file is held;
     (c) `../` is refused, in every position, and creates nothing;
     (d) a file that is not the book's is neither written, patched nor
         deleted; an edit to one reloads nothing and marks nothing; and after
         everything above every stranger is byte-for-byte as it was;
     (e) a book in a folder behaves exactly as before: the same script, the
         same outcomes — and, over a corpus of paths, its writes and deletes
         are refused exactly where the prefix test this replaced refused them.

     node tests/root-book-saves.test.cjs */

const assert = require('assert');
const Module = require('module');
const H = require('./helpers/harness.cjs');
H.stubObsidian();

/* Obsidian 1.15.0's normalizePath and the per-call flavour switch, as in
   tests/root-book.test.cjs (whose header says where the function was read). */
const obsidianNormalize = p => {
  let o = String(p).replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '');
  if (o === '') o = '/';
  /* U+00A0 and U+202F, spelled as escapes: typed raw they are invisible, and
     were once saved here as two ordinary spaces — a fold that folded nothing. */
  return o.replace(/\u00A0|\u202F/g, ' ').normalize('NFC');
};
const stubNormalize = require('obsidian').normalizePath;
const flavour = { fn: stubNormalize };
const prevLoad = Module._load;
Module._load = function (req, ...rest) {
  const m = prevLoad.call(this, req, ...rest);
  return req === 'obsidian' ? { ...m, normalizePath: p => flavour.fn(p) } : m;
};

const { collapsePath } = require('../src/vault-path');
const { fsChangeInBudget, reloadFromDisk } = require('../src/controller');
const { SEED, B } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const outcome = async fn => {
  try { await fn(); return 'landed'; } catch (e) {
    if (e && e.code) return e.code;
    return /Refused (write|delete) outside the budget folder/.test(String(e && e.message)) ? 'OUTSIDE' : `threw: ${e && e.message}`;
  }
};

const FLAVOURS = [
  ['harness stub (root is "")', stubNormalize],
  ['Obsidian 1.15.0 (root is "/")', obsidianNormalize],
];

/* What the vault holds that is not the budget's, wherever the budget is. */
const STRANGERS = {
  'Journal/2026-11-12.md': '# Thursday\n\nA day.\n',
  'README.md': '# This vault\n',
  'Projects/Transactions/2026-09.md': '| Date | Description |\n|---|---|\n| 2026-09-01 | not a month of this budget |\n',
  'Daily/Settings.md': '---\nmonth_start_day: 99\n---\n',
  '.obsidian/plugins/budget-app/data.json': '{"budgetFolder":"/"}',
};
const NOTE = 'Notes/2026/Car service.md';
const EXTRA = {
  [`${B}/${NOTE}`]: '---\nnote_kind: general\n---\n\nBooked for October.\n',
  [`${B}/Accounts/Closed/Old card.md`]: '---\ntype: credit_card\nbalance: 0\n---\n\nClosed in August. Keep the statements.\n',
};
const MONTH = 'Transactions/Cheque/2026-09.md';
const AUGUST = 'Transactions/Cheque/2026-08.md';
const OUR_ROW = '| 2026-09-02 | typed in the budget | Groceries | -15.00 |  |  |  |\n';
const PHONE_ROW = '| 2026-09-02 | typed on the phone | Groceries | -120.00 |  |  |  |\n';

/* A mounted page, as far as the write path goes: the real io, period, loader
   and notes over the household at `folder`, and a vault that announces what
   changes in it through the controller's gate. `P` is the folder as a path
   prefix ('' at the root). */
async function page(folder) {
  const P = folder === '/' ? '' : `${folder}/`;
  const files = { ...STRANGERS };
  for (const [k, v] of Object.entries({ ...SEED, ...EXTRA })) files[P + k.slice(B.length + 1)] = v;
  const ctx = H.makeCtx(files, { budgetFolder: folder });
  await H.loadInto(ctx);
  ctx.provide({ invalidateBudgetDraft: () => {} });
  const { vault } = ctx;

  /* controller.js onFsChange (pinned on the source by root-book-watcher). */
  const handed = [], reloads = [], inflight = [];
  const onFsChange = (file, oldPath) => {
    if (!file || !fsChangeInBudget(ctx.basePath(), file, oldPath)) return null;
    handed.push(file.path);
    const p = ctx.observeChange(file, oldPath).then(r => { if (!r.own) reloads.push(file.path); return r; });
    inflight.push(p);
    return p;
  };
  const raw = { modify: vault.modify, create: vault.create, trash: vault.trash, modifyBinary: vault.modifyBinary, createBinary: vault.createBinary };
  vault.modify = async (f, x) => { await raw.modify(f, x); onFsChange(f); };
  vault.create = async (p, x) => { const f = await raw.create(p, x); onFsChange(f); return f; };
  vault.modifyBinary = async (f, x) => { await raw.modifyBinary(f, x); onFsChange(f); };
  vault.createBinary = async (p, x) => { await raw.createBinary(p, x); onFsChange(vault.getFileByPath(p)); };
  vault.trash = async (f, sys) => { await raw.trash(f, sys); onFsChange(f); };
  const settle = async () => { while (inflight.length) await Promise.all(inflight.splice(0)); };

  /* Somebody else — the phone, the markdown view, the file explorer — by
     VAULT path, announced like everything else. */
  const other = {
    async edit(p, fn) { const f = vault.getFileByPath(p); await raw.modify(f, fn(vault._store.get(p))); await onFsChange(f); },
    async rename(from, to) {
      const text = vault._store.get(from);
      vault._store.delete(from);
      const f = await raw.create(to, text);
      await onFsChange(f, from);
    },
    async remove(p) { const f = vault.getFileByPath(p); await raw.trash(f); await onFsChange(f); },
  };
  const told = [];
  ctx.onStaleWrite(e => told.push(e.rel));
  return {
    ctx, vault, P, other, settle, handed, reloads, told, announce: onFsChange,
    text: rel => vault._store.get(P + rel),
    has: rel => vault._store.has(P + rel),
    reload: () => reloadFromDisk(ctx, ctx.S, ctx.$, () => {}),
    /* Defensive on purpose: with a guard removed, a Save this suite expects
       refused lands and takes the month with it — the outcome table should
       say so, not a TypeError here. */
    descs: key => ((ctx.S.txFiles[key] || {}).rows || []).map(r => r.desc),
    paths: () => [...vault._store.keys()].filter(k => !k.endsWith('/.folder')).sort(),
  };
}

/* The script. Every observable outcome goes into `out`, keyed by what it
   is, so the folder run can be compared with the root run entry for entry —
   paths in it are book-relative, which is the form the two share. */
async function script(folder, say) {
  const pg = await page(folder);
  const { ctx, vault, P, other } = pg;
  const S = ctx.S;
  const out = {};
  const before = pg.paths();

  /* ---- (a) a Save lands ---- */
  const month = S.txFiles['Cheque/2026-09'];
  eq(month.rel, MONTH, say('the loader names the month by the path it read it from'));
  out.save = await outcome(() => ctx.writeFile(month.rel, pg.text(MONTH) + OUR_ROW));
  await pg.settle();
  out.saveOnDisk = pg.text(MONTH).endsWith(OUR_ROW);
  out.saveIsOwnEcho = pg.reloads.length === 0 && !ctx.isStaleFile(MONTH);
  out.saveAgain = await outcome(() => ctx.writeFile(month.rel, pg.text(MONTH)));
  out.newMonthRel = ctx.txFileRel('Cheque', '2026-10');
  out.newMonth = await outcome(() => ctx.writeFile(out.newMonthRel, pg.text(MONTH).replace(/2026-09-/g, '2026-10-')));
  const acct = S.accounts.find(a => a.rel === 'Accounts/Closed/Old card.md');
  ok(acct, say('the loader read the nested account'));
  const acctText = pg.text(acct.rel);
  const fence = acctText.indexOf('\n---', 4);
  out.patch = await outcome(() => ctx.patchFile(acct.rel, acctText.slice(4, fence), acctText.slice(fence + 4), { balance: '12.50' }));
  out.patchKeptBody = /balance: 12\.50/.test(pg.text(acct.rel)) && pg.text(acct.rel).endsWith('\n\nClosed in August. Keep the statements.\n');
  out.binary = await outcome(() => ctx.writeBinary('Tax/2026/irp5.pdf', new Uint8Array([37, 80, 68, 70]).buffer));
  const note = S.notes.find(n => n.rel === NOTE);
  ok(note && ctx.fileAt(note.rel), say('the loader read the nested note, and io resolves its rel'));
  out.trash = await outcome(async () => { if (!(await ctx.trashFile(ctx.fileAt(note.rel)))) throw new Error('nothing to delete'); });
  await pg.settle();
  out.ownWritesAreEchoes = pg.reloads.slice();
  out.created = pg.paths().filter(k => !before.includes(k)).map(k => k.slice(P.length));
  out.removed = before.filter(k => !pg.paths().includes(k)).map(k => k.slice(P.length));
  await pg.reload();
  out.afterReload = {
    ourRow: pg.descs('Cheque/2026-09').includes('typed in the budget'),
    newMonth: !!S.txFiles['Cheque/2026-10'] && S.txFiles['Cheque/2026-10'].rel === out.newMonthRel,
    balance: (S.accounts.find(a => a.rel === acct.rel) || {}).balance,
    noteGone: !S.notes.some(n => n.rel === NOTE),
  };

  /* ---- (b) a Save after an external edit the page has not read ---- */
  const loaded = pg.text(MONTH);
  pg.handed.length = 0; pg.reloads.length = 0;
  await other.edit(P + MONTH, t => t + PHONE_ROW);
  out.externalSeen = { handed: pg.handed.map(k => k.slice(P.length)), reloads: pg.reloads.map(k => k.slice(P.length)), stale: ctx.isStaleFile(MONTH) };
  out.staleSave = await outcome(() => ctx.writeFile(MONTH, loaded + OUR_ROW));
  out.stalePatch = await outcome(() => ctx.patchFile(MONTH, 'kind: transactions', '\n\nrebuilt\n', { kind: 'x' }));
  out.staleBinary = await outcome(() => ctx.writeBinary(MONTH, new Uint8Array([1]).buffer));
  out.staleTrash = await outcome(() => ctx.trashFile(ctx.fileAt(MONTH)));
  out.phoneRowSurvives = pg.text(MONTH) === loaded + PHONE_ROW;
  out.toldOncePerRefusal = pg.told.slice();
  out.otherFileStillSaves = await outcome(() => ctx.writeFile(AUGUST, pg.text(AUGUST)));
  out.phoneRowInMemoryBeforeReload = pg.descs('Cheque/2026-09').includes('typed on the phone');
  await pg.reload();
  out.phoneRowInMemoryAfterReload = pg.descs('Cheque/2026-09').includes('typed on the phone');
  out.saveAfterReload = await outcome(() => ctx.writeFile(MONTH, pg.text(MONTH) + '| 2026-09-03 | after the reload | Groceries | -1.00 |  |  |  |\n'));
  out.bothRowsOnDisk = /typed on the phone/.test(pg.text(MONTH)) && /after the reload/.test(pg.text(MONTH));

  /* Renamed out of the book, and deleted, while the page held them. */
  await other.rename(P + AUGUST, 'Archive/2026-08.md');
  out.movedSave = await outcome(() => ctx.writeFile(AUGUST, 'rebuilt from load state'));
  out.movedNotRecreated = !pg.has(AUGUST) && vault._store.has('Archive/2026-08.md');
  await other.remove(P + 'Assets.md');
  out.deletedSave = await outcome(() => ctx.writeFile('Assets.md', 'rebuilt'));
  out.deletedNotRecreated = !pg.has('Assets.md');

  /* A Save clicked while the watcher is still reading the changed file. */
  await pg.reload();
  const held = pg.text(MONTH);
  const realRead = vault.cachedRead;
  vault.cachedRead = async x => { await new Promise(r => setTimeout(r, 25)); return realRead.call(vault, x); };
  /* The bytes are on disk and the event is in the watcher's hands, not yet
     judged: the judging reads the file, and the Save races that read. */
  vault._store.set(P + MONTH, held + '| 2026-09-04 | landed mid-click | Groceries | -2.00 |  |  |  |\n');
  const judging = pg.announce(vault.getFileByPath(P + MONTH));
  out.racedSave = await outcome(() => ctx.writeFile(MONTH, held));
  await judging;
  vault.cachedRead = realRead;
  out.racedRowSurvives = /landed mid-click/.test(pg.text(MONTH));
  await pg.reload();

  /* ---- (c) `../` ---- */
  const shape = pg.paths();
  out.traversal = {};
  for (const rel of ['../evil.md', '../../evil.md', 'Notes/../../evil.md', 'Accounts/../../../evil.md', '..', './../evil.md', 'Transactions/../../Journal/2026-11-12.md']) {
    out.traversal[rel] = [await outcome(() => ctx.writeFile(rel, 'pwned')), await outcome(() => ctx.writeBinary(rel, new Uint8Array([1]).buffer)),
      await outcome(() => ctx.patchFile(rel, 'a: 1', '\n', { a: 2 }))];
  }
  out.traversalCreatedNothing = JSON.stringify(pg.paths()) === JSON.stringify(shape);

  /* ---- (d) what is not the book's ---- */
  pg.handed.length = 0; pg.reloads.length = 0;
  for (const p of ['Journal/2026-11-12.md', 'Projects/Transactions/2026-09.md', 'Daily/Settings.md']) await other.edit(p, t => t + 'more\n');
  await other.rename('README.md', 'Readme first.md');
  await other.rename('Readme first.md', 'README.md');
  out.strangerEdits = { handed: pg.handed.slice(), reloads: pg.reloads.slice(), marks: ctx.staleClear(ctx.staleMark()) };
  out.bookStillSaves = await outcome(() => ctx.writeFile(MONTH, pg.text(MONTH)));
  const strangers = Object.keys(STRANGERS);
  const expect = Object.fromEntries(strangers.map(p => [p, vault._store.get(p)]));
  out.strangerDelete = {};
  for (const p of strangers) out.strangerDelete[p] = await outcome(() => ctx.trashFile(vault.getFileByPath(p)));
  out.strangerFolderDelete = await outcome(() => ctx.trashFile(vault.getFolderByPath('Journal')));
  out.strangersIntact = strangers.every(p => vault._store.get(p) === expect[p]);
  return { out, pg, expect };
}

(async () => {
  for (const [name, fn] of FLAVOURS) {
    flavour.fn = fn;
    const say = m => `${name}: ${m}`;

    const root = await script('/', m => say(`root book: ${m}`));
    const o = root.out;

    /* (a) */
    eq([o.save, o.saveOnDisk, o.saveIsOwnEcho, o.saveAgain], ['landed', true, true, 'landed'],
      say('T2 (a): a Save in a root book lands, is recognised as the plugin\'s own echo, and a second Save straight after lands too'));
    eq([o.newMonthRel, o.newMonth], ['Transactions/Cheque/2026-10.md', 'landed'], say('T2 (a): a new month is created beside the ones read'));
    eq([o.patch, o.patchKeptBody], ['landed', true], say('T2 (a): a frontmatter patch lands over an untouched body'));
    eq([o.binary, o.trash], ['landed', 'landed'], say('T2 (a): a binary lands, and a note of the budget\'s is deleted'));
    eq(o.ownWritesAreEchoes, [], say('T2 (a): none of the plugin\'s own writes is taken for somebody else\'s'));
    eq(o.created.sort(), ['Tax/2026/irp5.pdf', 'Transactions/Cheque/2026-10.md'], say('T2 (a): exactly the two new files appeared — nothing forked'));
    eq(o.removed, [NOTE], say('T2 (a): and exactly the deleted note went'));
    eq(o.afterReload, { ourRow: true, newMonth: true, balance: 12.5, noteGone: true }, say('T2 (a): the real loader reads all of it back'));

    /* (b) */
    eq(o.externalSeen, { handed: [MONTH], reloads: [MONTH], stale: true },
      say('T2 (b): an external edit in a root book reaches io, schedules a reload and marks the file stale'));
    eq([o.staleSave, o.stalePatch, o.staleBinary, o.staleTrash], ['STALE', 'STALE', 'STALE', 'STALE'],
      say('T2 (b): a Save, a patch, a binary write and a delete over it are each REFUSED as stale'));
    ok(o.phoneRowSurvives, say('T2 (b): the phone\'s row is on disk, byte for byte'));
    eq(o.toldOncePerRefusal, [MONTH, MONTH, MONTH, MONTH], say('T2 (b): the page is told, by the book-relative path, once per refusal'));
    eq(o.otherFileStillSaves, 'landed', say('T2 (b): only that file is held'));
    eq([o.phoneRowInMemoryBeforeReload, o.phoneRowInMemoryAfterReload, o.saveAfterReload, o.bothRowsOnDisk], [false, true, 'landed', true],
      say('T2 (b): a completed reload reads the phone\'s row and lifts the refusal — the next Save keeps both rows'));
    eq([o.movedSave, o.movedNotRecreated], ['STALE', true], say('T2 (b): a Save to a month moved out of the book is refused and re-creates nothing'));
    eq([o.deletedSave, o.deletedNotRecreated], ['STALE', true], say('T2 (b): a Save to a file deleted under the page does not bring it back'));
    eq([o.racedSave, o.racedRowSurvives], ['STALE', true], say('T2 (b): a Save clicked while the watcher is still judging the change waits, then refuses'));

    /* (c) */
    for (const [rel, got] of Object.entries(o.traversal))
      eq(got, ['OUTSIDE', 'OUTSIDE', 'OUTSIDE'], say(`T2 (c): ${rel} is refused in a root book, as a write, a binary and a patch`));
    ok(o.traversalCreatedNothing, say('T2 (c): and none of them created anything'));

    /* (d) */
    eq(o.strangerEdits, { handed: [], reloads: [], marks: 0 },
      say('T2 (d): edits and renames of the reader\'s own notes are never handed to io, reload nothing and mark nothing'));
    eq(o.bookStillSaves, 'landed', say('T2 (d): …and hold up no Save'));
    for (const [p, got] of Object.entries(o.strangerDelete)) eq(got, 'OUTSIDE', say(`T2 (d): a root book refuses to delete ${p}`));
    eq(o.strangerFolderDelete, 'OUTSIDE', say('T2 (d): …or the Journal folder'));
    ok(o.strangersIntact, say('T2 (d): every file that is not the book\'s is byte-for-byte what its owner left'));
    {
      /* And cannot be written through a budget rel, whatever built it. */
      const { ctx, vault } = root.pg;
      for (const rel of ['Journal/2026-11-12.md', 'Journal/new.md', 'README.md', 'Projects/Transactions/2026-09.md', 'Daily/Settings.md',
        '.obsidian/plugins/budget-app/data.json', 'Notes/../Journal/2026-11-12.md', 'Exports/2026-09.csv']) {
        eq([await outcome(() => ctx.writeFile(rel, 'budget rows')), await outcome(() => ctx.writeBinary(rel, new Uint8Array([1]).buffer)),
          await outcome(() => ctx.patchFile(rel, 'a: 1', '\n', { a: 2 }))], ['OUTSIDE', 'OUTSIDE', 'OUTSIDE'],
        say(`T2 (d): a root book refuses to write ${rel}`));
      }
      for (const p of Object.keys(STRANGERS)) eq(vault._store.get(p), root.expect[p], say(`T2 (d): ${p} is untouched`));
      ok(!vault._store.has('Journal/new.md') && !vault._store.has('Exports/2026-09.csv'), say('T2 (d): and nothing was created beside them'));
    }

    /* (e) the same script, in a folder */
    const folder = await script(B, m => say(`folder book: ${m}`));
    eq(folder.out, o, say('T2 (e): a book in a folder gives the same outcome at every step of the same script'));
    {
      /* …and its containment is the prefix test it always was. `old` is that
         test, spelled as io.js withinBudget spelled it before this change. */
      const { ctx, vault } = folder.pg;
      const base = collapsePath(ctx.basePath());
      const old = resolved => resolved !== null && (resolved === base || resolved.startsWith(base + '/'));
      const rels = ['Settings.md', 'Journal/2026-11-12.md', 'New note.md', '.obsidian/app.json', 'Deep/er/and/deeper.md', 'Notes/../x.md',
        '../evil.md', '../Budget2/Settings.md', `../${B}/Settings.md`, 'Notes/../../evil.md', '..', '../README.md', './x.md', `../${B}x/y.md`];
      let agreed = 0;
      for (const rel of rels) {
        const want = old(collapsePath(ctx.relPath(rel))) ? 'landed' : 'OUTSIDE';
        eq(await outcome(() => ctx.writeFile(rel, 'x')), want, say(`T2 (e): a folder book ${want === 'landed' ? 'writes' : 'refuses'} ${rel}, as before`));
        agreed++;
      }
      for (const p of [...Object.keys(STRANGERS), `${B}/Settings.md`, `${B}/Journal/2026-11-12.md`, `${B}/.obsidian/app.json`]) {
        const want = old(collapsePath(p)) ? 'landed' : 'OUTSIDE';
        eq(await outcome(async () => { await ctx.trashFile(vault.getFileByPath(p)); }), want, say(`T2 (e): a folder book ${want === 'landed' ? 'deletes' : 'refuses to delete'} ${p}, as before`));
        agreed++;
      }
      ok(agreed === 22, say('the corpus ran'));
      for (const p of Object.keys(STRANGERS)) eq(vault._store.get(p), folder.expect[p], say(`${p} is untouched by a folder book too`));
    }
  }

  console.log(`PASS root-book-saves (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
