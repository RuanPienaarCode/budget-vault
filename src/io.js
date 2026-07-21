'use strict';
/* Vault file access, rooted at the configured budget folder. All paths given
   to these helpers are relative to that folder. Tracks the time of our own
   writes so the change-watcher can tell them apart from external edits. */

const { normalizePath, TFile, TFolder } = require('obsidian');
const { collapsePath } = require('./util');

module.exports = function registerIo(ctx) {
  const { vault, plugin } = ctx;
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
    const f = vault.getAbstractFileByPath(relPath(rel));
    return f instanceof TFile ? await vault.cachedRead(f) : null;
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
  async function writeFile(rel, content) {
    const path = guardedPath(rel);
    stampWrite();
    const f = vault.getAbstractFileByPath(path);
    if (f instanceof TFile) { await vault.modify(f, content); }
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
    const f = vault.getAbstractFileByPath(path);
    if (f instanceof TFile) { await vault.modifyBinary(f, data); }
    else {
      await ensureFolder(path.split('/').slice(0, -1).join('/'));
      await vault.createBinary(path, data);
    }
    stampWrite();
  }
  function fileAt(rel) {
    const f = vault.getAbstractFileByPath(relPath(rel));
    return f instanceof TFile ? f : null;
  }
  function mdFilesIn(rel) {
    const f = vault.getAbstractFileByPath(relPath(rel));
    if (!(f instanceof TFolder)) return [];
    return f.children.filter(c => c instanceof TFile && c.extension === 'md');
  }
  function subfoldersIn(rel) {
    const f = vault.getAbstractFileByPath(relPath(rel));
    if (!(f instanceof TFolder)) return [];
    return f.children.filter(c => c instanceof TFolder);
  }

  Object.assign(ctx, {
    basePath, relPath, readFile, writeFile, writeBinary, fileAt, mdFilesIn, subfoldersIn, ensureFolder,
    lastWriteAt: () => plugin._lastWrite || 0,
  });
};
