'use strict';
/* The shell.js ↔ src/ id contract.

   The whole app DOM is one HTML string in src/shell.js, and ~150 places query
   into it by hardcoded `$('#id')`. Nothing checks that an id still exists: a
   rename produces a button that silently does nothing, or — worse, and this
   actually happened — a dirty check that reads a missing element, returns
   "clean", and lets the file watcher reload over unsaved work.

   Three invariants, all currently true, pinned so a rename becomes a build
   failure instead of a bug report:

     1. every `$('#id')` in src/ resolves to an id in shell.js
     2. every drawer link's data-view has a matching <section id="view-*">
     3. every such section has an entry in controller.js's render dispatch map

   …plus one guarding HOW the shell is mounted (check 6): controller.js parses
   SHELL_HTML with DOMParser rather than assigning innerHTML. Those two parsers
   agree on flow content but NOT on table internals or head-only elements at the
   top level, which a full-document parse relocates or drops. Pinned so adding a
   bare <tr> to the top of the shell fails the build instead of silently losing
   a table at mount.

   Pure text analysis — no DOM, no bundler. Wired into ./build.sh.
     node tests/shell-contract.test.cjs
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const shell = fs.readFileSync(path.join(SRC, 'shell.js'), 'utf8');
const controller = fs.readFileSync(path.join(SRC, 'controller.js'), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

/* ---- 1. every queried id exists in the shell ---- */
const shellIds = new Set([...shell.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
ok(shellIds.size > 50, `shell.js should define plenty of ids (found ${shellIds.size})`);

const missing = [];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)) {
    if (!shellIds.has(m[1])) missing.push(`${path.relative(SRC, file)} queries #${m[1]}`);
  }
}
eq(missing, [], 'every $(\'#id\') must resolve to an id defined in shell.js');

/* ---- 2. drawer links ↔ view sections ---- */
const views = [...shell.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]);
ok(views.length >= 8, `expected the full drawer (found ${views.length} links)`);
const sections = new Set([...shell.matchAll(/id="view-([^"]+)"/g)].map(m => m[1]));
eq(views.filter(v => !sections.has(v)), [],
  'every drawer link must have a matching <section id="view-*">');

/* ---- 3. every view section is reachable from the render dispatch map ---- */
// The map lives in controller.js render(); grab the object literal after it.
const mapBlock = controller.match(/\(\{\s*dashboard:[\s\S]*?\}\)\[S\.view\]\(\)/);
ok(mapBlock, 'controller.js must still carry the render dispatch map');
const dispatched = new Set([...mapBlock[0].matchAll(/(\w+)\s*:/g)].map(m => m[1]));
const undispatched = [...sections].filter(v => !dispatched.has(v));
eq(undispatched, [],
  'every view section must have an entry in the render dispatch map — a missing ' +
  'one is a TypeError the moment the user opens that view');

/* ---- 4. every dispatched view still has a section ---- */
eq([...dispatched].filter(v => !sections.has(v)), [],
  'the dispatch map must not reference a view section that no longer exists');

/* ---- 5. no module publishes the same ctx key twice ---- */
// ctx.provide throws on a collision at mount, but only for the code path that
// actually runs; catch it statically across every module instead.
const provided = new Map();
const dupes = [];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/ctx\.provide\(\{([\s\S]*?)\}\)/g)) {
    for (const k of m[1].matchAll(/(?:^|[,{\s])([A-Za-z_]\w*)\s*(?:[,:}]|$)/g)) {
      const key = k[1];
      const rel = path.relative(SRC, file);
      if (provided.has(key) && provided.get(key) !== rel) {
        dupes.push(`${key}: ${provided.get(key)} and ${rel}`);
      }
      provided.set(key, rel);
    }
  }
}
eq(dupes, [], 'two modules must not publish the same name onto ctx');
ok(provided.size > 30, `ctx should carry the full published surface (found ${provided.size})`);

/* ---- 6. the shell is DOMParser-safe ---- */
// controller.js mounts via DOMParser (see the header note). A full-document
// parse relocates table internals and head-only content that appear at the
// FRAGMENT top level, where innerHTML would have kept them in place. Nested
// ones are fine — a complete <table> parses identically either way.
ok(/new DOMParser\(\)\.parseFromString\(SHELL_HTML/.test(controller),
  'controller.js must mount the shell via DOMParser, not innerHTML');
ok(!/\.innerHTML\s*=/.test(controller + shell),
  'shell.js/controller.js must not assign innerHTML — Obsidian review flags it');

const RELOCATED = new Set(['tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'caption', 'col',
  'colgroup', 'option', 'optgroup', 'head', 'body', 'html', 'title', 'meta', 'link', 'style',
  'base', 'frame', 'frameset']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'source', 'track', 'wbr']);
// Grab the SHELL_HTML template literal body, then walk tags tracking depth.
const shellLiteral = shell.match(/const SHELL_HTML = `([\s\S]*?)`;/);
ok(shellLiteral, 'shell.js must still define SHELL_HTML as a template literal');
let depth = 0;
const topLevelRelocated = [];
for (const m of shellLiteral[1].matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
  const [, close, tag, , self] = m;
  const t = tag.toLowerCase();
  if (close) { depth = Math.max(0, depth - 1); continue; }
  if (depth === 0 && RELOCATED.has(t)) topLevelRelocated.push(t);
  if (!VOID.has(t) && !self) depth++;
}
eq(topLevelRelocated, [],
  'no table-internal or head-only element may sit at the top level of SHELL_HTML — ' +
  'the DOMParser mount in controller.js would relocate or drop it');

/* ---- 7. every Save button is registered for the reload reset ----
   reloadFromDisk re-reads the vault and must put every Save button back to
   disabled, or the button sits lit over edits the reload already discarded.
   That list used to be written out by hand in controller.js and #txSave was
   missing from it, so Transactions offered to save nothing. It is now built by
   registration — ctx.dirtyFlag(key, sel) for the flag-backed views, bare
   ctx.registerSaveButton(sel) for Budgets and Transactions, which track their
   dirtiness some other way. Pinned so a new editable page cannot reintroduce
   the same gap by forgetting to register. */
const srcAll = walk(SRC).map(f => fs.readFileSync(f, 'utf8')).join('\n');
const registeredSave = new Set([
  ...[...srcAll.matchAll(/registerSaveButton\(\s*'#([\w-]+)'/g)].map(m => m[1]),
  ...[...srcAll.matchAll(/dirtyFlag\(\s*'[\w-]+'\s*,\s*'#([\w-]+)'/g)].map(m => m[1]),
]);
// The shell's Save buttons: every id ending "Save" that is a <button>.
const shellSaveIds = [...shell.matchAll(/<button[^>]*\bid="([\w-]*Save)"/g)].map(m => m[1]);
ok(shellSaveIds.length >= 5, `expected the shell's Save buttons (found ${shellSaveIds.length})`);
eq(shellSaveIds.filter(id => !registeredSave.has(id)), [],
  'every Save button in shell.js must be registered via ctx.dirtyFlag or ' +
  'ctx.registerSaveButton, or reloadFromDisk will leave it enabled over discarded edits');

console.log(`PASS — shell id contract + ctx namespace + DOMParser safety intact (${checks} checks, ${shellIds.size} ids, ${provided.size} ctx keys, ${shellSaveIds.length} save buttons).`);
