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

/* ---- switching (ADR 0009 §3) ---------------------------------------------

   switchDecision() is the WHOLE rule for "may this device change its open book
   now, and to what" — pure, so every refusal is driven in bare node. main.js's
   switchBook() gathers the three facts it cannot know here (are any pages
   dirty, is the privacy splash up, does the folder exist) and acts on the
   answer; nothing else may decide.

     { ok: false, reason }  'locked' | 'unknown' | 'dirty'
     { ok: true, noop, folder, stored }
                            `folder` is the target in normalised form; `noop`
                            is true when it is already the open book (no write,
                            no reload); `stored` is what to write as this
                            device's choice — null for the home book.

   THE ORDER IS THE POLICY.

     1. locked first. ADR 0009 §6: while the splash is up a caller must not be
        able to learn which books exist by switching through them, and 'unknown'
        before 'locked' would answer exactly that — "unknown" for a folder that
        is not a book, "locked" for one that is. Locked says nothing about the
        list.
     2. unknown before dirty, so a typo is reported as a typo rather than as
        "save your work" for a switch that could never have happened.
     3. already-open before dirty: asking for the book that is on screen
        changes nothing, so it cannot put a row typed into one client into
        another's files, and refusing it would only nag.
     4. dirty last: REFUSE, never defer. A switch queued behind an unsaved row
        is how a row typed into client A lands in client B.

   The home book is stored as null ("no choice") rather than as its own
   folder. Either resolves to the home book — resolveOpenBook returns home for
   both — but null leaves nothing behind on a device that only ever uses the
   home book, and a home folder that is later renamed in Settings cannot leave
   a stale stored choice pointing at the old name.

   `folderExists`, when given, is asked about a non-home target: a book that is
   LISTED but whose folder has been deleted or renamed would resolve straight
   back to the home book in activeFolder(), so reporting ok for it would claim
   a switch that never happened. It is refused as 'unknown' — the folder is not
   a book anyone can open. The home book is never asked, for the reason
   resolveOpenBook gives. Absent, nothing is asked, so the pure cases need no
   vault. */
/** @param {{ books?: any, homeFolder?: string, open?: string, target?: any, dirty?: boolean, locked?: boolean, folderExists?: (folder: string) => boolean }} [args] */
function switchDecision({ books, homeFolder, open, target, dirty, locked, folderExists } = {}) {
  if (locked) return { ok: false, reason: 'locked' };
  if (typeof target !== 'string') return { ok: false, reason: 'unknown' };
  const want = normalizeFolder(target);
  const home = normalizeFolder(homeFolder);
  const isHome = want === home;
  if (!isHome && !bookFolders(books).includes(want)) return { ok: false, reason: 'unknown' };
  if (!isHome && typeof folderExists === 'function') {
    let there = false;
    try { there = !!folderExists(want); } catch (e) { there = false; }
    if (!there) return { ok: false, reason: 'unknown' };
  }
  const stored = isHome ? null : want;
  if (want === normalizeFolder(open)) return { ok: true, noop: true, folder: want, stored };
  if (dirty) return { ok: false, reason: 'dirty' };
  return { ok: true, noop: false, folder: want, stored };
}

/* ---- what the switcher shows --------------------------------------------

   bookChoices({ books, homeFolder, homeName, openFolder, homeFallback }) →
     { visible, items: [{ folder, label, home, active }], active }

   The list the top-bar control renders, as data, so the rules for it run in
   bare node: which books, in what order, under what name, and whether there is
   anything to choose at all.

   `visible` is "more than one book". Single-book mode (an empty list) is one
   choice — the home book — and shows nothing: no control for a decision that
   is not there, and no change at all for the vault every reader already has.
   A list whose only entry IS the home folder is likewise one choice.

   The home book is always the first item. If it is listed, its listed label
   wins (the reader named it); if it is not, it is called by the household name
   its own Settings.md carries (`homeName`, read by the caller — this module
   reads no files), else by its folder's last segment, else `homeFallback` for
   a book at the vault root, which has no segment to name it by.

   Two books may carry the same label — nothing stops a bookkeeper typing
   "Acme" twice — and in a native picker the two rows would then be
   indistinguishable, so a repeated label is suffixed with its folder.

   `active` is the item that is open, or null when `openFolder` is not any
   book's (which cannot happen through activeFolder(), but the caller should
   not crash on a hand-edited list). */
function lastSegment(folder) {
  const parts = normalizeFolder(folder).split('/');
  return parts[parts.length - 1] || '';
}
function labelOf(entry) {
  const l = entry && typeof entry.label === 'string' ? entry.label.trim() : '';
  return l || lastSegment(entry && entry.folder);
}
/** @param {{ books?: any, homeFolder?: string, homeName?: string, openFolder?: string, homeFallback?: string }} [args] */
function bookChoices({ books, homeFolder, homeName, openFolder, homeFallback } = {}) {
  const home = normalizeFolder(homeFolder);
  const listed = [];
  if (Array.isArray(books)) {
    for (const b of books) {
      if (!b || typeof b !== 'object' || typeof b.folder !== 'string') continue;
      const f = normalizeFolder(b.folder);
      if (!listed.some(x => x.folder === f)) listed.push({ folder: f, label: labelOf(b) });
    }
  }
  const homeListed = listed.find(x => x.folder === home);
  const homeLabel = (homeListed && homeListed.label)
    || (typeof homeName === 'string' && homeName.trim())
    || lastSegment(home)
    || homeFallback
    || '';
  const items = [{ folder: home, label: homeLabel, home: true }];
  for (const x of listed) if (x.folder !== home) items.push({ folder: x.folder, label: x.label, home: false });
  const seen = {};
  for (const it of items) seen[it.label] = (seen[it.label] || 0) + 1;
  for (const it of items) {
    if (seen[it.label] > 1) it.label = `${it.label} (${it.folder || '/'})`;
  }
  const open = normalizeFolder(openFolder);
  for (const it of items) it.active = it.folder === open;
  return { visible: items.length > 1, items, active: items.find(it => it.active) || null };
}

/* ---- changing the list (ADR 0009 §5, issue #168) -------------------------

   Settings → Books adds, relabels and removes entries; the setup wizard adds
   one at the end of its add-a-book mode. All three rules are here, pure, and
   return a NEW list rather than editing the one they were handed — main.js
   assigns the result and saves, and puts the old list back if the save throws,
   which a list edited in place could not do.

   validateNewBook({ books, homeFolder, folder, configDir }) → null | problem

   May `folder` become a book? null when it may, else { reason, folder? }:

     'empty'      nothing typed.
     'root'       the vault root. A book there would CONTAIN every other book,
                  and the wizard's create path would scaffold Categories/ and
                  Transactions/ beside the reader's own notes.
     'traversal'  a segment made only of dots ("..", "..."). Refused, never
                  rebased, for the reason io.js destinationProblem gives: a
                  folder quietly moved somewhere other than where it was typed
                  is the silent correction this app does not make.
     'hidden'     a dot-segment, or Obsidian's config folder. Obsidian indexes
                  nothing under a dot-folder (vault-path.js hiddenSegment), so
                  a book there is a folder the wizard can write and the app can
                  never read back. `folder` names the offending segment.
     'duplicate'  already a book — the home book or a listed one.
     'nested'     inside another book's folder.
     'contains'   another book's folder is inside this one.

   The last three are the one rule the issue states: TWO BOOKS MUST NEVER SHARE
   FILES. A client book at "Budget/Acme" inside a home book at "Budget" would
   not, today, collide file-for-file — the loader reads Categories/ and
   Transactions/ by name — but every recursive reader that will ever be written
   (a search, an export of "everything under the book", a vault-wide rename)
   would then see two books at once, and a remove followed by a delete of "the
   old folder" would take the other book's files with it. So overlap is refused
   outright, the home book included, and `folder` names the book it collides
   with so the sentence can say which.

   A home book AT THE VAULT ROOT therefore refuses every addition as 'nested'.
   That is the rule working, not a corner case: such a vault already keeps its
   budget among everything else, and there is no folder another book could
   have that the home book does not contain.

   Overlap is compared CASE-FOLDED, where resolveOpenBook deliberately is not.
   The two errors run in opposite directions. Opening a book, folding could
   open a folder the list never named, so exact is the safe side. Refusing an
   overlap, "clients/acme" beside a listed "Clients/Acme" is ONE folder on
   APFS, iOS and Windows — the filesystems most readers have — so folding is
   the safe side: it refuses a pair that would have shared every file. */
const { hiddenSegment } = require('./vault-path');
const foldFolder = f => normalizeFolder(f).toLowerCase();
/** @param {{ books?: any, homeFolder?: string, folder?: any, configDir?: string }} [args] */
function validateNewBook({ books, homeFolder, folder, configDir } = {}) {
  if (typeof folder !== 'string' || !folder.trim()) return { reason: 'empty' };
  const want = normalizeFolder(folder);
  if (!want) return { reason: 'root' };
  if (want.split('/').some(s => /^\.+$/.test(s.trim()))) return { reason: 'traversal' };
  const hidden = hiddenSegment(want);
  if (hidden) return { reason: 'hidden', folder: hidden.trim() };
  const w = foldFolder(want);
  const cfg = foldFolder(configDir || '');
  if (cfg && (w === cfg || w.startsWith(cfg + '/'))) return { reason: 'hidden', folder: normalizeFolder(configDir) };
  const existing = allBookFolders({ books, homeFolder });
  /* Three passes rather than one, so the reason is the most specific one true
     of the folder — the same folder listed twice is a duplicate, not
     "inside" anything, whichever order the list happens to hold it in. */
  for (const f of existing) if (foldFolder(f) === w) return { reason: 'duplicate', folder: f };
  for (const f of existing) {
    const g = foldFolder(f);
    if (g === '' || w.startsWith(g + '/')) return { reason: 'nested', folder: f };
  }
  for (const f of existing) if (foldFolder(f).startsWith(w + '/')) return { reason: 'contains', folder: f };
  return null;
}

/* A label as stored: trimmed, and the folder's last segment when blank. A
   label is what the switcher prints; a blank one would print nothing. */
function cleanLabel(label, folder) {
  const l = typeof label === 'string' ? label.trim() : '';
  return l || lastSegment(folder);
}
const isEntry = b => !!b && typeof b === 'object' && typeof b.folder === 'string';

/* bookListAdd({ books, homeFolder, homeLabel, folder, label, configDir })
     → { ok: true, books, folder, label } | { ok: false, reason, folder? }

   Validates (validateNewBook — the caller cannot skip it by calling this),
   then appends `{ folder, label }` with the folder in the one normalised form.

   The FIRST add on a single-book vault seeds the list with the home book
   ahead of the new one, labelled `homeLabel` (the household name its own
   Settings.md carries — read by the caller, this module reads no files) or its
   folder's last segment. Seeded because ADR 0009 has the home book be the
   first entry of the list, and because the label the reader sees for it in
   the switcher should then be one they can change in Settings → Books like
   any other book's. A list that already has entries is appended to as it
   stands — even one a hand-edit left without its home entry, which
   bookChoices() already puts first; re-ordering somebody's list on an add is
   not this function's to do. */
/** @param {{ books?: any, homeFolder?: string, homeLabel?: string, folder?: any, label?: string, configDir?: string }} [args] */
function bookListAdd({ books, homeFolder, homeLabel, folder, label, configDir } = {}) {
  const problem = validateNewBook({ books, homeFolder, folder, configDir });
  if (problem) return Object.assign({ ok: false }, problem);
  const list = Array.isArray(books) ? books.slice() : [];
  if (!bookFolders(list).length) {
    const home = normalizeFolder(homeFolder);
    list.unshift({ folder: home, label: cleanLabel(homeLabel, home) });
  }
  const f = normalizeFolder(folder);
  const entry = { folder: f, label: cleanLabel(label, f) };
  list.push(entry);
  return { ok: true, books: list, folder: entry.folder, label: entry.label };
}

/* bookListRelabel({ books, homeFolder, folder, label })
     → { ok: true, books } | { ok: false, reason: 'unknown' }

   Label only — the folder is the book's identity, and the per-device open
   book is stored BY folder, so changing it here would quietly close the book
   on every device that had it open. The home book may be relabelled; if a
   hand-edited list does not carry it, it is put back at the front, which is
   where ADR 0009 says it lives. Relabelling needs a list: in single-book mode
   there is no switcher for a label to appear in, and Settings → Books does not
   offer it there. */
/** @param {{ books?: any, homeFolder?: string, folder?: any, label?: string }} [args] */
function bookListRelabel({ books, homeFolder, folder, label } = {}) {
  if (typeof folder !== 'string' || !bookFolders(books).length) return { ok: false, reason: 'unknown' };
  const want = normalizeFolder(folder);
  let hit = false;
  const list = books.map(b => {
    if (!isEntry(b) || normalizeFolder(b.folder) !== want) return b;
    hit = true;
    return Object.assign({}, b, { label: cleanLabel(label, b.folder) });
  });
  if (!hit) {
    if (want !== normalizeFolder(homeFolder)) return { ok: false, reason: 'unknown' };
    list.unshift({ folder: want, label: cleanLabel(label, want) });
  }
  return { ok: true, books: list };
}

/* bookListRemove({ books, homeFolder, folder })
     → { ok: true, books } | { ok: false, reason: 'home' | 'unknown' }

   Forgets the entry. Never anything more: this is a list edit, and the folder
   and every file in it stay exactly where they are (ADR 0009, "No moving or
   merging books") — main.js's removeBook() calls no vault API at all, and
   tests/books-settings.test.cjs greps that it does not.

   The home book cannot be removed: it is settings.budgetFolder, the fallback
   every device lands on, and it is changed with the folder setting instead.

   REMOVING DOWN TO THE HOME BOOK COLLAPSES THE LIST TO []. With only the home
   book left there is one choice, so the switcher is already hidden
   (bookChoices: visible is "more than one book") — what a one-entry list would
   add over an empty one is a `books` key in data.json and a label shown
   nowhere. Empty is single-book mode, which ADR 0009 defines as byte-for-byte
   1.59's behaviour, and persistableSettings() then drops the key, so a vault
   that tried books and stopped goes back to writing exactly what it wrote
   before. The cost is the home book's label, which the next first add seeds
   again from the household name. */
/** @param {{ books?: any, homeFolder?: string, folder?: any }} [args] */
function bookListRemove({ books, homeFolder, folder } = {}) {
  if (typeof folder !== 'string') return { ok: false, reason: 'unknown' };
  const want = normalizeFolder(folder);
  const home = normalizeFolder(homeFolder);
  if (want === home) return { ok: false, reason: 'home' };
  if (!bookFolders(books).includes(want)) return { ok: false, reason: 'unknown' };
  const list = books.filter(b => !(isEntry(b) && normalizeFolder(b.folder) === want));
  return { ok: true, books: bookFolders(list).some(f => f !== home) ? list : [] };
}

module.exports = {
  normalizeFolder, bookFolders, allBookFolders, resolveOpenBook, persistableSettings,
  OPEN_BOOK_KEY, readStoredBook, writeStoredBook,
  activeFolderOf, allBookFoldersOf,
  switchDecision, bookChoices,
  validateNewBook, bookListAdd, bookListRelabel, bookListRemove,
};
