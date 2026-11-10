'use strict';
/* Which book is open — the one rule, pure, so it runs under a guard test.

   WHY THIS EXISTS AS ITS OWN MODULE (ADR 0009).

   Until 1.59 a vault held one budget, named by `settings.budgetFolder`, and
   every path the app built started from it. A vault may now hold several
   books — a bookkeeper's one-per-client, a personal and a business book — and
   exactly one is open at a time. Three facts decide which:

     settings.books        the list, synced in data.json: [{ folder, label }].
                           EMPTY is single-book mode, the state every existing
                           vault is in, and must behave byte-for-byte as before.
     settings.budgetFolder the HOME book. First in the list, the fallback, and
                           the only book an older build knows about. A switch
                           never rewrites it — rewriting it is exactly what made
                           the sibling plugin's open book follow the user to
                           every device and conflict in data.json when two
                           devices switched at once (discussion #154).
     the stored choice     per device, in vault-scoped local storage, never
                           synced — so a phone and a laptop may have different
                           clients open and cannot fight over it.

   The danger this module exists to contain is a SECOND reader. A view that
   consults `budgetFolder` directly reads the home book while the screen shows a
   client's, and its next Save writes one client's rows into another client's
   files — "two figures derived by different rules" under a new name. So the
   resolution lives here once, src/ reaches it only through main.js's
   activeFolder(), and tests/books-one-seam.test.cjs fails on any new direct
   read in src/.

   The fallback only ever lands on the HOME book, never on some other listed
   folder and never on an unlisted one. A stored choice that is missing,
   removed from the list, or names a folder that has since been deleted or
   renamed opens the home book: the reader sees a budget they recognise rather
   than an empty one the next Save would start populating, and nothing the
   user wrote is touched to make the stored choice "valid" again.

   Pure: no DOM, no `require('obsidian')`, no globals. The two storage helpers
   at the bottom take the host and the storage getter as arguments, so the
   bare-node tests drive them with fakes and main.js hands them the real ones. */

/* A folder in the one form every comparison here uses. Mirrors what Obsidian's
   normalizePath does to the parts that decide whether two spellings are the
   same folder — `\` and `/` both separate, runs of separators collapse, no
   leading or trailing slash, the two non-breaking spaces read as spaces, NFC —
   because this module cannot require('obsidian') and a stored "Clients/Acme/"
   must match a listed "Clients/Acme". Whitespace around the whole value is
   trimmed, as the settings tab trims what is typed.

   The vault root is '' here, where normalizePath answers '/'. main.js wraps the
   result in the real normalizePath, so basePath() still sees '/' for a budget
   at the root, exactly as it always has.

   NOT case-folded. Obsidian's own lookups (getFolderByPath) are exact-key, so a
   stored "clients/acme" against a listed "Clients/Acme" is treated as a book
   that is no longer listed — which falls back to the home book, the safe
   direction. Folding here could open a folder the list does not name. */
function normalizeFolder(folder) {
  if (typeof folder !== 'string') return '';
  return folder.trim()
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/ | /g, ' ')
    .normalize('NFC');
}

/* The listed books' folders, normalised, in list order, each once. Tolerates a
   hand-edited data.json: a `books` that is not an array, an entry that is not
   an object, or one with no string `folder`, contributes nothing rather than
   throwing at boot — the same "a typo cannot break the app" contract
   resolveLanguage() gives Settings.md. */
function bookFolders(books) {
  if (!Array.isArray(books)) return [];
  const out = [];
  for (const b of books) {
    if (!b || typeof b !== 'object' || typeof b.folder !== 'string') continue;
    const f = normalizeFolder(b.folder);
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

/* Every folder that is SOME book: the home book first, then each listed one.
   For the export guard (io.js destinationProblem), which must refuse the
   managed folders of every book and not only the open one — otherwise an
   export run while client A is open could be written into client B's
   Transactions/, and the next time B is opened it parses the export back in as
   data (ADR 0009 §4). In single-book mode this is just the home book. */
/** @param {{ books?: any, homeFolder?: string }} [args] */
function allBookFolders({ books, homeFolder } = {}) {
  const home = normalizeFolder(homeFolder);
  const out = [home];
  for (const f of bookFolders(books)) if (!out.includes(f)) out.push(f);
  return out;
}

/* resolveOpenBook({ books, homeFolder, stored, folderExists }) → folder

   The open book's folder, normalised (vault root = ''):

     - the stored choice, IF it is one of the listed books AND
       folderExists(stored) says the folder is still there;
     - otherwise the home book.

   `folderExists` is only consulted for a stored choice that is listed and is
   not the home book, so single-book mode never reaches the vault at all, and
   the home book is returned whether or not its folder exists — that is today's
   behaviour (a first run points at a folder the wizard has yet to create), and
   resolving "no home folder" to some other book would be guessing. A throwing
   or absent folderExists counts as "not there": falling back to the home book
   is always safe, opening a folder nobody confirmed is not. */
/** @param {{ books?: any, homeFolder?: string, stored?: string | null, folderExists?: (folder: string) => boolean }} [args] */
function resolveOpenBook({ books, homeFolder, stored, folderExists } = {}) {
  const home = normalizeFolder(homeFolder);
  if (typeof stored !== 'string') return home;
  const want = normalizeFolder(stored);
  if (want === home) return home;
  if (!bookFolders(books).includes(want)) return home;
  let exists = false;
  try { exists = typeof folderExists === 'function' && !!folderExists(want); } catch (e) { exists = false; }
  return exists ? want : home;
}

/* The settings object as it should reach data.json. An empty `books` is the
   default every vault loads with (constants.js DEFAULT_SETTINGS), and writing
   it would put a new key into data.json on the first unrelated save — a
   theme toggle — of every single-book vault, which ADR 0009 rules out: single-
   book mode writes nothing new, so a downgrade or a diff of the synced file
   sees exactly what 1.59 wrote. The in-memory settings keep their `books`; only
   the copy handed to the host loses it. Anything else is returned untouched,
   including a non-empty list and a hand-edited non-array (which is not ours to
   quietly correct). */
function persistableSettings(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.books) || data.books.length) return data;
  const out = Object.assign({}, data);
  delete out.books;
  return out;
}

/* ---- the per-device choice ----------------------------------------------

   Obsidian 1.8.7 added App.loadLocalStorage / saveLocalStorage, which scope a
   key to the vault themselves. minAppVersion is 1.8.0, so they are feature-
   detected and, where absent, window.localStorage is used under a key that
   carries the vault's own id. Without a vault id there is no key that cannot
   collide with another vault on the same device, so nothing is read or written
   and the home book opens — one vault's client must never open in another.

   Every access is in try/catch: localStorage throws in restricted contexts
   (src/i18n.js defaultLanguage has the same guard), and a throw here would
   otherwise take down every path the app builds, since all of them resolve
   through activeFolder(). A failed read is "no choice stored" → home book. */
const OPEN_BOOK_KEY = 'budget-app-open-book';

/* The window.localStorage key for this vault, or null when the host gives no
   way to tell vaults apart. `appId` is the per-vault id Obsidian keys its own
   local storage by; undocumented, so the documented vault name is the second
   choice. */
function fallbackStoreKey(app) {
  let id = '';
  try { id = (app && app.appId) || (app && app.vault && typeof app.vault.getName === 'function' && app.vault.getName()) || ''; } catch (e) { id = ''; }
  return id ? `${OPEN_BOOK_KEY}:${id}` : null;
}

/* The folder this device last opened, or null. `getStorage` is a thunk because
   merely reading `window.localStorage` can throw, and that read must sit inside
   the try too. */
function readStoredBook(app, getStorage) {
  try {
    if (app && typeof app.loadLocalStorage === 'function') {
      const v = app.loadLocalStorage(OPEN_BOOK_KEY);
      return typeof v === 'string' ? v : null;
    }
  } catch (e) { return null; }
  const key = fallbackStoreKey(app);
  if (!key) return null;
  try {
    const store = typeof getStorage === 'function' ? getStorage() : null;
    const v = store ? store.getItem(key) : null;
    return typeof v === 'string' ? v : null;
  } catch (e) { return null; }
}

/* Remember `folder` as this device's open book; a null, undefined or non-string
   folder forgets the choice (the home book opens). Returns whether the choice
   was stored, so a caller can say so instead of reporting a switch that will
   not survive a restart. Writes nothing to data.json and never touches
   settings.budgetFolder — that is the whole point of the per-device key. */
function writeStoredBook(app, getStorage, folder) {
  const value = typeof folder === 'string' ? normalizeFolder(folder) : null;
  try {
    if (app && typeof app.saveLocalStorage === 'function') {
      app.saveLocalStorage(OPEN_BOOK_KEY, value);
      return true;
    }
  } catch (e) { return false; }
  const key = fallbackStoreKey(app);
  if (!key) return false;
  try {
    const store = typeof getStorage === 'function' ? getStorage() : null;
    if (!store) return false;
    if (value === null) store.removeItem(key); else store.setItem(key, value);
    return true;
  } catch (e) { return false; }
}

/* ---- the seam, as the plugin calls it ----------------------------------

   main.js's activeFolder() / allBookFolders() are one-line delegates to these
   two, which take the plugin as an argument rather than living on its class.
   That is deliberate: the guard tests build plain-object plugins
   ({ settings, _lastWrite }) by the dozen, and giving them the real seam means
   calling the SAME function main.js calls — not a copy of the wiring pasted
   into tests/helpers/harness.cjs, which would stay green while main.js
   drifted. It also makes this file the one place in src/ that reads
   settings.budgetFolder to find a book, which is what
   tests/books-one-seam.test.cjs holds it to.

   `normalize` is Obsidian's normalizePath in the plugin (injected: this module
   cannot require('obsidian')), so the root book comes back as '/' exactly as
   basePath() always returned it. `getStorage` is the window.localStorage
   thunk readStoredBook() falls back to. */

/* activeFolderOf(plugin, { normalize, getStorage }) → the open book's folder.
   An empty list — single-book mode — returns before local storage or the
   vault is consulted, so a 1.59 vault pays nothing for books existing. */
/** @param {any} plugin @param {{ normalize?: (p: string) => string, getStorage?: (() => any) | null }} [opts] */
function activeFolderOf(plugin, { normalize, getStorage } = {}) {
  const norm = typeof normalize === 'function' ? normalize : normalizeFolder;
  const s = (plugin && plugin.settings) || {};
  const app = plugin && plugin.app;
  const stored = bookFolders(s.books).length ? readStoredBook(app, getStorage) : null;
  return norm(resolveOpenBook({
    books: s.books,
    homeFolder: s.budgetFolder,
    stored,
    folderExists: f => !!(app && app.vault && app.vault.getFolderByPath(norm(f))),
  }));
}

/* allBookFoldersOf(plugin, { normalize }) → every book's folder, home first,
   normalised the way activeFolderOf() returns one. */
/** @param {any} plugin @param {{ normalize?: (p: string) => string }} [opts] */
function allBookFoldersOf(plugin, { normalize } = {}) {
  const norm = typeof normalize === 'function' ? normalize : normalizeFolder;
  const s = (plugin && plugin.settings) || {};
  return allBookFolders({ books: s.books, homeFolder: s.budgetFolder }).map(f => norm(f));
}

module.exports = {
  normalizeFolder, bookFolders, allBookFolders, resolveOpenBook, persistableSettings,
  OPEN_BOOK_KEY, readStoredBook, writeStoredBook,
  activeFolderOf, allBookFoldersOf,
};
