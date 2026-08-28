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
  /* Delete, as the only deletion this plugin performs.

     `vault.trash(f, false)` — the SYSTEM-trash flag is deliberately false, so
     whatever goes lands in the vault's own `.trash` and is recoverable from
     inside Obsidian. Every file this app deletes is one the user could have
     written by hand, so a one-way door is never the right shape; categories.js
     and notes.js each reasoned their way to that call separately, and a third
     and fourth copy is how one of them eventually gets the flag backwards.

     Takes a TAbstractFile, not a path, and takes it from the caller: a path
     re-resolved after a confirmation dialog either no longer exists — and the
     old note code cheerfully announced a delete having deleted nothing — or now
     points at a DIFFERENT file, which it would then trash. A TFile survives a
     rename; a path does not. Folders go through here too (an account's
     Transactions/ folder), which is why this reaches for the abstract type.

     Stamped both sides like every write, so the vault watcher recognises the
     change as ours and does not schedule a reload on top of the caller's own
     in-memory cleanup. Returns false for nothing-to-delete so a caller can say
     so rather than claim a success. */
  async function trashFile(file) {
    if (!file) return false;
    stampWrite();
    await vault.trash(file, false);
    stampWrite();
    return true;
  }
  function fileAt(rel) {
    return vault.getFileByPath(relPath(rel));
  }
  /* The folder at `rel`, or null. The sibling of fileAt, and it exists for the
     same reason: a caller that needs to hand a folder to trashFile should not
     have to know that Obsidian keeps files and folders behind two lookups. */
  function folderAt(rel) {
    return vault.getFolderByPath(relPath(rel));
  }
  /* fileAt's VAULT-ROOT sibling — the read half of the split writeFile /
     writeVaultFile already draws for writes. `rel` here is a path from the
     VAULT root, exactly what writeVaultFile()/exportPaths()/reportPaths()
     hand back (Exports/, Reports/ — folders that are deliberately siblings
     of the budget folder, not inside it). fileAt() cannot be reused for
     these: it resolves through relPath(), which PREFIXES the budget folder
     unconditionally, so `fileAt('Reports/x.md')` actually looks up
     `<budget folder>/Reports/x.md` — a path nothing ever writes to. That
     exact mismatch shipped in 1.28.0: writeVaultFile() wrote the report to
     the real `Reports/x.md`, refreshResult() immediately looked it up
     through fileAt() at the wrong root, found nothing, and cleared the
     result the write had just set — the report existed on disk from the
     first click, and the button looked dead forever after. Guarded the same
     way the write side is (guardedVaultPath, not a bare vault.getFileByPath)
     so a hostile path is refused here too, not just on the way in. */
  function fileAtVaultPath(rel) {
    let path;
    try { path = guardedVaultPath(rel); } catch (e) { return null; }
    return vault.getFileByPath(path);
  }
  /* readFile's vault-root sibling, for the same reason fileAtVaultPath is
     fileAt's — a report/export note living outside the budget folder needs
     its content read back (the Copy affordance, for a report found on disk
     rather than freshly generated) through the SAME root convention it was
     written under. */
  async function readVaultFile(rel) {
    const f = fileAtVaultPath(rel);
    return f ? await vault.cachedRead(f) : null;
  }
  /* folderAt's vault-root sibling — same reasoning as fileAtVaultPath, for a
     caller that wants the Reports/ folder itself (revealing it in the file
     explorer when no individual report file is on hand yet to reveal). */
  function folderAtVaultPath(rel) {
    let path;
    try { path = guardedVaultPath(rel); } catch (e) { return null; }
    return vault.getFolderByPath(path);
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
    basePath, relPath, readFile, writeFile, writeVaultFile, writeBinary, patchFile, trashFile, fileAt, folderAt, mdFilesIn, mdFilesUnder, subfoldersIn, ensureFolder,
    createVaultFileIfAbsent, ensureVaultFolder, fileAtVaultPath, readVaultFile, folderAtVaultPath,
    lastWriteAt: () => plugin._lastWrite || 0,
  };
}

function registerIo(ctx) {
  ctx.provide(makeIo(ctx));
}

module.exports = registerIo;
module.exports.makeIo = makeIo;
