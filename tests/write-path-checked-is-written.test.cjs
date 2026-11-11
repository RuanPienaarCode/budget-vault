'use strict';
/* The path a write is CHECKED at is the path it is WRITTEN at
   (found by the pre-merge review of the root-book change, wave 2 of the
   2026-11-11 audit).

   io.js guardedPath is the containment on every budget-rooted write. It
   collapsed the path (`Notes/../Accounts/Cheque.md` → `Accounts/Cheque.md`),
   asked whether THAT was the book's — and then handed back the path as it was
   given, dots and all. Everything after it worked on the uncollapsed
   spelling:

     - the stale check asked about `Notes/../Accounts/Cheque.md`, a key no
       vault event ever carries, so a Save over a file a phone had just
       changed was not refused. The reviewer ran it: "direct: STALE; via
       Journal/../: landed", in a folder book and in a root book alike;
     - the vault was asked for a file at that key, found none, and so CREATED
       instead of modifying — first making every folder the detour named. In a
       book at the vault root `Journal/../Accounts/Cheque.md` made a Journal/
       folder at the top of the reader's vault: a root book writing something
       it does not own, through the one function meant to stop it;
     - the write was remembered as the plugin's own under that key too, so its
       echo, arriving under the real path, read as somebody else's edit.

   No caller in src/ builds such a rel today — they come from the loader, or
   through safeSeg — and that is what the guard is FOR: it is the defence in
   depth for a label that arrives by sync and could be anything. A defence
   that checks one path and writes another is checking the wrong thing.

   guardedPath now returns the collapsed path it checked. For every rel
   without a `.` or `..` segment that is the same string as before, byte for
   byte (section 3 holds that over the household's own rels).

   What this suite pins, in a book at the vault root and in a book in a
   folder, under the harness's normalizePath and Obsidian 1.15.0's:

     1. a Save through a detour, over a file somebody else changed, is
        refused STALE — writeFile, patchFile and writeBinary — and the
        external bytes survive;
     2. with nothing stale, the same Save lands ON the file it names: the
        existing file is modified, no second copy and no stray folder appear,
        and its echo is recognised as the plugin's own;
     3. a rel with no dot segment is handed to the vault exactly as it always
        was.

     node tests/write-path-checked-is-written.test.cjs */

const assert = require('assert');
const Module = require('module');
const H = require('./helpers/harness.cjs');
H.stubObsidian();

const obsidianNormalize = p => {
  let o = String(p).replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '');
  if (o === '') o = '/';
  return o.replace(/ | /g, ' ').normalize('NFC');
};
const stubNormalize = require('obsidian').normalizePath;
const flavour = { fn: stubNormalize };
const prevLoad = Module._load;
Module._load = function (req, ...rest) {
  const m = prevLoad.call(this, req, ...rest);
  return req === 'obsidian' ? { ...m, normalizePath: p => flavour.fn(p) } : m;
};

const { makeIo } = require('../src/io');
const { fsChangeInBudget } = require('../src/controller');
const { SEED, B } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const outcome = async fn => {
  try { await fn(); return 'landed'; } catch (e) { return (e && e.code) || `threw: ${e && e.message}`; }
};

const ACCT = 'Accounts/Cheque.md';
const LOADED = '---\ntype: checking\nbalance: 100.00\n---\n\nAs the page loaded it.\n';
const PHONE = '---\ntype: checking\nbalance: 250.00\n---\n\nTyped on the phone.\n';
/* Out through a folder that does not exist, out through one that does, out
   through one of the book's own, a no-op segment, and two together. */
const DETOURS = ['Scratch/../Accounts/Cheque.md', 'Journal/../Accounts/Cheque.md', 'Notes/../Accounts/Cheque.md',
  './Accounts/Cheque.md', 'Accounts/./Cheque.md', 'Accounts/Closed/../../Accounts/./Cheque.md'];

/* An io on a book at `folder`, over a vault that announces every change
   through the watcher's gate as controller.js wires it. */
function rig(folder) {
  const P = folder === '/' ? '' : `${folder}/`;
  const vault = H.makeVault({ [`${P}Settings.md`]: 'x', [`${P}${ACCT}`]: LOADED, 'Journal/2026-11-12.md': 'a day\n' });
  const plugin = H.bookSeam({ settings: { budgetFolder: folder }, _lastWrite: 0 });
  const io = makeIo({ vault, plugin }, { view: true });
  const external = [], inflight = [];
  const onFsChange = file => {
    if (!file || !fsChangeInBudget(io.basePath(), file)) return null;
    const p = io.observeChange(file).then(r => { if (!r.own) external.push(file.path); return r; });
    inflight.push(p);
    return p;
  };
  const raw = { modify: vault.modify, create: vault.create, createFolder: vault.createFolder, modifyBinary: vault.modifyBinary, createBinary: vault.createBinary };
  const calls = [];
  vault.modify = async (f, x) => { calls.push(['modify', f.path]); await raw.modify(f, x); onFsChange(f); };
  vault.create = async (p, x) => { calls.push(['create', p]); const f = await raw.create(p, x); onFsChange(f); return f; };
  vault.modifyBinary = async (f, x) => { calls.push(['modifyBinary', f.path]); await raw.modifyBinary(f, x); onFsChange(f); };
  vault.createBinary = async (p, x) => { calls.push(['createBinary', p]); await raw.createBinary(p, x); onFsChange(vault.getFileByPath(p)); };
  vault.createFolder = async p => { calls.push(['createFolder', p]); await raw.createFolder(p); };
  const settle = async () => { while (inflight.length) await Promise.all(inflight.splice(0)); };
  const phone = async () => { const f = vault.getFileByPath(P + ACCT); await raw.modify(f, PHONE); await onFsChange(f); };
  return { vault, io, P, calls, external, settle, phone, keys: () => [...vault._store.keys()].sort() };
}

(async () => {
  for (const [name, fn] of [['harness stub', stubNormalize], ['Obsidian 1.15.0', obsidianNormalize]]) {
    flavour.fn = fn;
    for (const folder of ['/', B]) {
      const say = m => `${name}, book at ${JSON.stringify(folder)}: ${m}`;

      /* ---- 1. stale is stale, however the path is spelled ---- */
      for (const rel of DETOURS) {
        const r = rig(folder);
        const before = r.keys();
        await r.io.readFile(ACCT);
        await r.phone();
        eq(await outcome(() => r.io.writeFile(ACCT, LOADED)), 'STALE', say('fixture: the direct Save over the phone\'s edit is refused'));
        eq(await outcome(() => r.io.writeFile(rel, LOADED)), 'STALE', say(`a Save via ${rel} is refused as stale too`));
        eq(await outcome(() => r.io.patchFile(rel, 'type: checking\nbalance: 100.00', '\n\nAs the page loaded it.\n', { balance: '1.00' })), 'STALE', say(`…and a patch via ${rel}`));
        eq(await outcome(() => r.io.writeBinary(rel, new Uint8Array([1]).buffer)), 'STALE', say(`…and a binary via ${rel}`));
        eq(r.vault._store.get(r.P + ACCT), PHONE, say(`the phone's bytes survive ${rel}`));
        eq(r.calls, [], say(`and the vault was asked to change nothing — no file, no folder (${rel})`));
        eq(r.keys(), before, say(`the vault holds exactly what it held (${rel})`));
      }

      /* ---- 2. and with nothing stale, it lands on the file it names ---- */
      for (const rel of DETOURS) {
        const r = rig(folder);
        const before = r.keys();
        await r.io.readFile(ACCT);
        eq(await outcome(() => r.io.writeFile(rel, PHONE)), 'landed', say(`a Save via ${rel} lands`));
        await r.settle();
        eq(r.calls, [['modify', r.P + ACCT]], say(`as ONE modify of the file it names — not a create beside it, and no folder made on the way (${rel})`));
        eq(r.vault._store.get(r.P + ACCT), PHONE, say(`the file holds what was written (${rel})`));
        eq(r.keys(), before, say(`no second copy and no stray folder (${rel})`));
        eq(r.external, [], say(`and its echo is the plugin's own, not somebody else's edit (${rel})`));
        ok(!r.io.isStaleFile(ACCT), say(`so the next Save is not held (${rel})`));
        eq(await outcome(() => r.io.writeFile(ACCT, LOADED)), 'landed', say(`…and lands (${rel})`));
      }
      {
        /* A NEW file through a detour is created where it resolves, with only
           the folders that path itself needs. */
        const r = rig(folder);
        eq(await outcome(() => r.io.writeFile('Scratch/../Transactions/Cheque/2026-10.md', 'new month')), 'landed', say('a new month via a detour lands'));
        eq(r.vault._store.get(`${r.P}Transactions/Cheque/2026-10.md`), 'new month', say('…at the path it resolves to'));
        eq(r.calls.filter(c => c[0] === 'createFolder').map(c => c[1]), [`${r.P}Transactions`, `${r.P}Transactions/Cheque`],
          say('…making the two folders that path needs and not the one the detour named'));
        ok(!r.vault.getFolderByPath(`${r.P}Scratch`) && !r.vault.getFolderByPath('Scratch'), say('no Scratch/ folder anywhere'));
      }

      /* ---- 3. an ordinary rel reaches the vault as it always did ---- */
      {
        const P = folder === '/' ? '' : `${folder}/`;
        const rels = Object.keys(SEED).map(k => k.slice(B.length + 1)).concat(['Transactions/Cheque/2026-10.md', 'Notes/2026/New note.md', 'Tax/2026/irp5.pdf']);
        const files = Object.fromEntries(Object.entries(SEED).map(([k, v]) => [P + k.slice(B.length + 1), v]));
        const vault = H.makeVault(files);
        const io = makeIo({ vault, plugin: H.bookSeam({ settings: { budgetFolder: folder }, _lastWrite: 0 }) });
        const asked = [];
        const m = vault.modify, c = vault.create;
        vault.modify = async (f, x) => { asked.push(f.path); return m(f, x); };
        vault.create = async (p, x) => { asked.push(p); return c(p, x); };
        for (const rel of rels) await io.writeFile(rel, 'x');
        eq(asked, rels.map(rel => P + rel), say(`every one of ${rels.length} ordinary rels is written at the folder plus the rel, as before`));
      }
    }
  }

  console.log(`PASS write-path-checked-is-written (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
