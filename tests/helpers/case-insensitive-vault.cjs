'use strict';
/* The harness vault (helpers/harness.cjs makeVault) behaving the way Obsidian
   1.13.7 does on macOS and iOS — case-insensitive filesystems — in the three
   places an export's "is it there / write it" path touches.

     getRoot()                          Obsidian hands back its root folder;
                                        io.js's vaultPathTaken walks from it
                                        when not even the first segment of a
                                        path matches exactly (a top-level
                                        "exports/" vs a typed "Exports/").
     getAbstractFileByPathInsensitive   Obsidian's own lookup: the exact key if
                                        there is one, else the first key equal
                                        to it lower-cased. Read off app.js
                                        1.13.7 (Vault.prototype), not guessed.
     create / createBinary              Obsidian's Vault.create asks
                                        adapter.exists(path) — fs.access on the
                                        desktop adapter, case-INSENSITIVE on
                                        APFS — and throws "File already
                                        exists." when it is. So a write that
                                        misses the index's exact key for a
                                        file that differs only by case does
                                        not overwrite it: it throws.
     createFolder                       the same question, "Folder already
                                        exists." — so asking for "Reports"
                                        beside an existing "reports" adds no
                                        second folder to the index (io.js's
                                        ensureFolder catches the throw).

   Built from the vault's own store, so nothing is invented. Folds the way
   io.js's foldSeg does (NFC, lower case) for the existence check, and the way
   Obsidian does (lower case) for the insensitive lookup. */

const { TFolder } = require('./harness.cjs');

const fold = s => String(s).normalize('NFC').toLowerCase();

function caseInsensitive(vault) {
  const filePaths = () => [...vault._store.keys()].filter(k => !k.endsWith('/.folder'));
  const allPaths = () => {
    const out = new Set();
    for (const k of vault._store.keys()) {
      const segs = k.split('/');
      const last = k.endsWith('/.folder') ? segs.length - 1 : segs.length;
      for (let i = 1; i <= last; i++) out.add(segs.slice(0, i).join('/'));
    }
    return [...out];
  };
  vault.getRoot = () => {
    const root = new TFolder('');
    const tops = new Set(allPaths().map(k => k.split('/')[0]));
    root.children = [...tops].map(t => vault.getAbstractFileByPath(t)).filter(Boolean);
    return root;
  };
  vault.getAbstractFileByPathInsensitive = p => {
    const exact = vault.getAbstractFileByPath(p);
    if (exact) return exact;
    const want = String(p).toLowerCase();
    const hit = allPaths().find(k => k.length === want.length && k.toLowerCase() === want);
    return hit ? vault.getAbstractFileByPath(hit) : null;
  };
  for (const m of ['create', 'createBinary']) {
    const real = vault[m].bind(vault);
    vault[m] = async (p, data) => {
      if (allPaths().some(k => fold(k) === fold(p))) throw new Error('File already exists.');
      return real(p, data);
    };
  }
  const realFolder = vault.createFolder.bind(vault);
  vault.createFolder = async p => {
    if (allPaths().some(k => fold(k) === fold(p))) throw new Error('Folder already exists.');
    return realFolder(p);
  };
  return vault;
}

module.exports = { caseInsensitive, fold };
