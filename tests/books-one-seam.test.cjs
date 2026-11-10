'use strict';
/* One seam for "which folder is the budget": nothing in src/ reads
   settings.budgetFolder to build a path except the seam itself (ADR 0009 §2,
   issue #166).

   Until 1.59 the budget folder WAS settings.budgetFolder, and twenty-odd
   places read it directly. A vault may now hold several books, and that key
   names only the HOME book; the book on screen is whichever this device has
   open, resolved by src/books.js activeFolderOf() behind main.js
   activeFolder(). A reader that still consults budgetFolder directly reads the
   home book while the screen shows a client's — and if it writes, it writes
   one client's rows into another client's files. No behavioural fixture sees
   that until two books exist on a real device, so this gate reads the source.

   The check is deliberately blunt: EVERY occurrence of the identifier
   `budgetFolder` in src/ code (comments stripped, so prose may name it) must
   be one of the lines listed below, each with the reason it is allowed and the
   exact number of times it may appear. That catches the shapes a narrower
   pattern would miss — `const { budgetFolder } = plugin.settings`, an alias
   like `ps.budgetFolder`, `settings['budgetFolder']` — and makes every new
   exemption a visible edit to this file, not a quiet regex widening. A listed
   line that no longer appears fails too, so the list cannot rot into a set of
   permissions nobody is using.

   The NEGATIVE CONTROL at the bottom runs the same scanner over synthetic
   source and proves each forbidden shape is caught and a comment is not.

     node tests/books-one-seam.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');

/* Comments blanked rather than removed, so line numbers in a failure point at
   the real line. A line comment is only recognised after whitespace or at the
   start of a line, so the `//` inside a 'https://…' string is left alone. */
const code = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|\s)\/\/.*$/gm, '$1');

const TOKEN = /\bbudgetFolder\b/;

/* file (relative to src/), the trimmed code line, how many times, and why. */
const ALLOWED = [
  /* The seam itself: the only place a book's folder is derived from settings. */
  { file: 'books.js', line: 'homeFolder: s.budgetFolder,', count: 1,
    why: 'activeFolderOf() — THE seam: the home book is the fallback of the open-book rule' },
  { file: 'books.js', line: 'return allBookFolders({ books: s.books, homeFolder: s.budgetFolder }).map(f => norm(f));', count: 1,
    why: 'allBookFoldersOf() — every book, for the export guard' },

  /* The default value of the key. */
  { file: 'constants.js', line: "budgetFolder: 'Finances/Budget',", count: 1,
    why: 'DEFAULT_SETTINGS — the default home book' },

  /* The settings control that edits the HOME book — its job is that key. */
  { file: 'settings-tab.js', line: '.setPlaceholder(DEFAULT_SETTINGS.budgetFolder)', count: 1,
    why: 'the home-book text field (pre-1.13 tab): its placeholder' },
  { file: 'settings-tab.js', line: '.setValue(this.plugin.settings.budgetFolder)', count: 1,
    why: 'the home-book text field shows the home book, not the open one' },
  { file: 'settings-tab.js', line: 'this.plugin.settings.budgetFolder = normalizePath(v.trim() || DEFAULT_SETTINGS.budgetFolder);', count: 1,
    why: 'the home-book text field writes the home book' },
  { file: 'settings-tab.js', line: "if (key === 'budgetFolder') value = normalizePath(String(value).trim() || DEFAULT_SETTINGS.budgetFolder);", count: 1,
    why: 'the 1.13 declarative tab normalising the home-book control on its way to disk' },
  { file: 'settings-tab.js', line: "else if (key === 'budgetFolder') this.plugin.reloadViews();", count: 1,
    why: 'the 1.13 declarative tab reloading after the home-book control changed' },
  { file: 'settings-tab.js', line: "control: { type: 'folder', key: 'budgetFolder', placeholder: DEFAULT_SETTINGS.budgetFolder },", count: 1,
    why: 'the 1.13 declarative definition of the home-book control' },

  /* The setup wizard sets up the HOME book; #168 gives it an add-a-book mode
     that appends to settings.books instead. Until then both lines are its own. */
  { file: 'onboarding.js', line: "folder: plugin.settings.budgetFolder || 'Finances/Budget',", count: 1,
    why: 'the wizard prefills the folder it is about to (re)write — the home book' },
  { file: 'onboarding.js', line: 'p.settings.budgetFolder = folder;', count: 1,
    why: 'the wizard apply() assigning the home book (changed by #168, not here)' },

  /* A PARAMETER called budgetFolder, not a read of settings: the pure
     destination check takes the folder(s) to protect as arguments, and the
     ctx-bound copy feeds it activeFolder() and allBookFolders(). */
  { file: 'io.js', line: 'function destinationProblem(folder, { configDir, budgetFolder, budgetFolders } = {}) {', count: 1,
    why: 'destinationProblem option name' },
  { file: 'io.js', line: "if (budgetFolder != null || !Array.isArray(budgetFolders)) roots.push(budgetFolder || '');", count: 1,
    why: 'destinationProblem reading its own option' },
  { file: 'io.js', line: 'configDir: vault.configDir, budgetFolder: plugin.activeFolder(), budgetFolders: plugin.allBookFolders(), ...(opts || {}),', count: 1,
    why: 'the bound guard passes the OPEN book (activeFolder) under that option name' },
  { file: 'report.js', line: 'function managedFolderMatch(dir, budgetFolder) {', count: 1,
    why: 'managedFolderMatch parameter' },
  { file: 'report.js', line: 'const baseSegs = pathSegs(budgetFolder);', count: 1,
    why: 'managedFolderMatch reading its own parameter' },
];

/* Every occurrence in a { relPath: source } map, as { file, n, line }. */
function scan(sources) {
  const hits = [];
  for (const [file, src] of Object.entries(sources)) {
    code(src).split('\n').forEach((l, i) => { if (TOKEN.test(l)) hits.push({ file, n: i + 1, line: l.trim() }); });
  }
  return hits;
}
/* The hits no allowance covers, plus allowances used a different number of
   times than they claim. */
function violations(hits, allowed) {
  const used = new Map(allowed.map(a => [a, 0]));
  const stray = [];
  for (const h of hits) {
    const a = allowed.find(x => x.file === h.file && x.line === h.line);
    if (a) used.set(a, used.get(a) + 1); else stray.push(h);
  }
  const miscounted = allowed.filter(a => used.get(a) !== a.count).map(a => ({ ...a, seen: used.get(a) }));
  return { stray, miscounted };
}

const sources = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (e.name.endsWith('.js')) sources[path.relative(SRC, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
  }
})(SRC);
ok(Object.keys(sources).length > 40, 'fixture: the walk found src/ (a vacuous scan would pass anything)');

/* ---- 1. the real tree ------------------------------------------------------ */
{
  const { stray, miscounted } = violations(scan(sources), ALLOWED);
  if (stray.length) {
    console.error('A direct read of settings.budgetFolder outside the seam — route it through plugin.activeFolder()'
      + ' (or, for every book, allBookFolders()). Reading budgetFolder reads the HOME book, which is the wrong'
      + ' book whenever this device has a client\'s open (ADR 0009):\n'
      + stray.map(h => `  src/${h.file}:${h.n}  ${h.line}`).join('\n'));
  }
  eq(stray, [], 'no occurrence of budgetFolder in src/ outside the allowed sites');
  if (miscounted.length) {
    console.error('An allowed site no longer appears as listed (moved, reworded, duplicated or removed) —'
      + ' update ALLOWED in this file deliberately:\n'
      + miscounted.map(a => `  src/${a.file}: expected ${a.count}, saw ${a.seen}  ${a.line}`).join('\n'));
  }
  eq(miscounted, [], 'every allowed site appears exactly as often as it claims');

  /* The two readers the issue names, by name: they go through the seam. */
  ok(/const basePath = \(\) => normalizePath\(plugin\.activeFolder\(\)\);/.test(sources['io.js']),
    'io.js basePath() resolves through plugin.activeFolder()');
  ok(/settingsMdPath\(\) \{\s*return normalizePath\(this\.activeFolder\(\) \+ '\/Settings\.md'\);/.test(sources['main.js']),
    'main.js settingsMdPath() resolves through activeFolder()');
  ok(!TOKEN.test(code(sources['main.js'])), 'main.js itself reads budgetFolder nowhere — it delegates to src/books.js');
}

/* ---- 2. NEGATIVE CONTROL: the scanner catches each forbidden shape --------- */
{
  const flagged = src => violations(scan({ 'views/x.js': src }), ALLOWED).stray.length;
  eq(flagged('const base = this.plugin.settings.budgetFolder;\n'), 1, 'a dotted read is caught');
  eq(flagged('const { budgetFolder } = plugin.settings;\n'), 1, 'a destructured read is caught');
  eq(flagged('const ps = plugin.settings;\nconst f = ps.budgetFolder;\n'), 1, 'a read through an alias is caught');
  eq(flagged("const f = plugin.settings['budgetFolder'];\n"), 1, 'a bracketed read is caught');
  eq(flagged('/* settings.budgetFolder names the home book */\n// so does budgetFolder here\nconst x = 1;\n'), 0,
    'a comment that names it is not a read');
  eq(flagged("const url = 'https://example.com'; const f = s.budgetFolder;\n"), 1,
    'a `//` inside a string does not hide the rest of the line');
  eq(flagged('const many = plugin.settings.budgetFolders;\n'), 0, 'a different identifier that merely starts the same is not it');
  eq(violations(scan({ 'views/x.js': 'homeFolder: s.budgetFolder,\n' }), ALLOWED).stray.length, 1,
    'an allowed line copied into ANOTHER file is not allowed there');
  const doubled = { 'books.js': 'homeFolder: s.budgetFolder,\nhomeFolder: s.budgetFolder,\n' };
  const v = violations(scan(doubled), ALLOWED.filter(a => a.file === 'books.js' && a.count === 1).slice(0, 1));
  eq(v.miscounted.map(a => a.seen), [2], 'an allowed line duplicated in its own file is caught by its count');
}

console.log(`PASS books-one-seam — no direct settings.budgetFolder read in src/ outside the seam and the home-book controls (${checks} checks)`);
