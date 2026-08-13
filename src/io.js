'use strict';
/* Vault file access, rooted at the configured budget folder. All paths given
   to these helpers are relative to that folder. Tracks the time of our own
   writes so the change-watcher can tell them apart from external edits.

   A FACTORY plus a thin registrar, not a closure over a view ctx. The guards
   here only protect writers who can reach them, and two writers cannot go
   through a mounted view: the onboarding wizard and main.js's Settings.md
   updater both run before any view exists. As a ctx closure they each
   reimplemented ensureFolder and the `_lastWrite` stamping by hand (three
   copies of one, five hand-spelled stamps of the other — miss one and the
   watcher reloads over the wizard mid-run), and the wizard's writes were the
   only ones in the app with no containment check at all, on a folder that
   comes from a text field. makeIo needs only { vault, plugin }, which both
   boot-time writers already hold. */

const { normalizePath, TFile, TFolder } = require('obsidian');
const { collapsePath } = require('./vault-path');
const { patchFrontmatter } = require('./markdown');

function makeIo({ vault, plugin }) {
  // Write-guard timestamp lives on the plugin (not this closure) so writes made
  // outside the view — the Settings.md updater in main.js — can stamp it too and
  // be recognised as our own, suppressing a redundant watcher reload.
  const stampWrite = () => { plugin._lastWrite = Date.now(); };

  const basePath = () => normalizePath(plugin.settings.budgetFolder);
  const relPath = p => normalizePath(basePath() + '/' + p);

  async function ensureFolder(path) {
    if (!path || path === '/') return;
    if (vault.getAbstractFileByPath(path)) return;
    await ensureFolder(path.split('/').slice(0, -1).join('/'));
    try { await vault.createFolder(path); } catch (e) { /* raced into existence */ }
  }
  async function readFile(rel) {
    const f = vault.getFileByPath(relPath(rel));
    return f ? await vault.cachedRead(f) : null;
  }
  // Defence in depth: refuse any write that resolves outside the budget
  // folder. normalizePath does NOT strip "../", so a label like
  // "../../evil" pulled from a synced Accounts file could otherwise escape;
  // collapse the segments and verify containment before touching disk.
  function guardedPath(rel) {
    const path = relPath(rel);
    const resolved = collapsePath(path);
    const base = collapsePath(basePath());
    if (resolved === null || (resolved !== base && !resolved.startsWith(base + '/'))) {
      throw new Error(`Refused write outside the budget folder: ${rel}`);
    }
    return path;
  }
  /* Write somewhere the user NAMED, anywhere in the vault.

     Separate from writeFile on purpose. writeFile is rooted at the budget
     folder and refuses to leave it, because the paths it is handed are built
     from data — an account label, a category name — that arrives by sync and
     could be anything; "../../evil" in a synced Accounts file must not become a
     write. Export is the opposite case: the destination is typed into a dialog
     by the person sitting there, and confining it to the budget folder would
     mean you cannot put an export next to the tax return it is for.

     So the containment moves out one ring rather than disappearing: still no
     escaping the VAULT, still collapsed before it is trusted, still refused
     rather than silently rebased. */
  function guardedVaultPath(rel) {
    const collapsed = collapsePath(normalizePath(String(rel || '')));
    if (!collapsed) throw new Error(`Refused write outside the vault: ${rel}`);
    return collapsed;
  }
  async function writeVaultFile(rel, content) {
    const path = guardedVaultPath(rel);
    stampWrite();
    const f = vault.getFileByPath(path);
    if (f) { await vault.modify(f, content); }
    else {
      await ensureFolder(path.split('/').slice(0, -1).join('/'));
      await vault.create(path, content);
    }
    stampWrite();
    return path;
  }
  /* The wizard's sibling of writeVaultFile: same vault-ring containment, same
     write-guard stamping, but SKIPS a file that already exists — re-running
     the wizard (or racing device sync) must never overwrite real data. Same
     ring as writeVaultFile because the wizard's folder is typed by the person
     sitting there, not built from synced data. Returns whether it wrote. */
  async function createVaultFileIfAbsent(rel, content) {
    const path = guardedVaultPath(rel);
    if (vault.getAbstractFileByPath(path)) return false;
    stampWrite();
    await ensureFolder(path.split('/').slice(0, -1).join('/'));
    try { await vault.create(path, content); } catch (e) { /* raced into existence */ }
    stampWrite();
    return true;
  }
  /* Guarded folder creation for user-named destinations (the wizard's
     scaffold). ensureFolder itself stays unguarded because every existing
     caller hands it a path that already passed a guard. */
  async function ensureVaultFolder(rel) {
    await ensureFolder(guardedVaultPath(rel));
  }
  async function writeFile(rel, content) {
    const path = guardedPath(rel);
    stampWrite();
    const f = vault.getFileByPath(path);
    if (f) { await vault.modify(f, content); }
    else {
      await ensureFolder(path.split('/').slice(0, -1).join('/'));
      await vault.create(path, content);
    }
    stampWrite();
  }
  /* Binary sibling of writeFile — same containment guard. Used for uploaded
     tax documents (PDFs, images). */
  async function writeBinary(rel, data) {
    const path = guardedPath(rel);
    stampWrite();
    const f = vault.getFileByPath(path);
    if (f) { await vault.modifyBinary(f, data); }
    else {
      await ensureFolder(path.split('/').slice(0, -1).join('/'));
      await vault.createBinary(path, data);
    }
    stampWrite();
  }
  /* THE body-preserving write, as a named operation. note-file.js calls this
     invariant "THE ONE INVARIANT THAT MATTERS" — patch the frontmatter, never
     touch the body — but it used to live at four call sites as a bare string
     idiom, `writeFile(rel, \`---\n${patchFrontmatter(raw, u)}\n---${body}\`)`,
     syntactically identical to the seven REBUILD writes that deliberately
     stamp over the body. Two opposite contracts wearing the same syntax: a
     new view copying the nearest example had a coin-flip chance of eating
     user prose. The name is the whole value — "I am preserving the body" is
     now greppable and reviewable. No newline before `body`: parseFrontmatter's
     body starts immediately after the closing fence and keeps its own leading
     break, so adding one would grow the file on every save. Returns the
     patched block, because accounts.js must re-capture it (each patch is
     computed against the PREVIOUS block, or saves undo each other). */
  async function patchFile(rel, raw, body, updates) {
    const fm = patchFrontmatter(raw, updates);
    await writeFile(rel, `---\n${fm}\n---${body}`);
    return fm;
  }
  function fileAt(rel) {
    return vault.getFileByPath(relPath(rel));
  }
  function mdFilesIn(rel) {
    const f = vault.getFolderByPath(relPath(rel));
    if (!f) return [];
    return f.children.filter(c => c instanceof TFile && c.extension === 'md');
  }
  /* Every .md at or below `rel`, depth-first.

     mdFilesIn reads one level, which is right for Categories/ and Accounts/ —
     those are flat by construction, because the plugin names the files itself
     and a nested one would not be found by the writer either. Notes/ is the
     opposite: the files are the USER'S, and filing a year of them into
     Notes/2026/ is an ordinary thing to do with a folder full of markdown. Read
     one level deep, that tidy-up silently emptied the page while every note was
     still on disk.

     Walks the Notes tree rather than filtering vault.getMarkdownFiles(), so the
     cost stays proportional to the folder rather than to the vault. */
  function mdFilesUnder(rel) {
    const root = vault.getFolderByPath(relPath(rel));
    if (!root) return [];
    const out = [];
    const walk = folder => {
      for (const c of folder.children) {
        if (c instanceof TFile) { if (c.extension === 'md') out.push(c); }
        else if (c instanceof TFolder) walk(c);
      }
    };
    walk(root);
    return out;
  }
  function subfoldersIn(rel) {
    const f = vault.getFolderByPath(relPath(rel));
    if (!f) return [];
    return f.children.filter(c => c instanceof TFolder);
  }

  return {
    basePath, relPath, readFile, writeFile, writeVaultFile, writeBinary, patchFile, fileAt, mdFilesIn, mdFilesUnder, subfoldersIn, ensureFolder,
    createVaultFileIfAbsent, ensureVaultFolder,
    lastWriteAt: () => plugin._lastWrite || 0,
  };
}

function registerIo(ctx) {
  ctx.provide(makeIo(ctx));
}

module.exports = registerIo;
module.exports.makeIo = makeIo;
