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
const recordKeys = (body, rel) => {
  for (const k of body.matchAll(/(?:^|[,{\s])([A-Za-z_]\w*)\s*(?:[,:}]|$)/g)) {
    const key = k[1];
    if (provided.has(key) && provided.get(key) !== rel) {
      dupes.push(`${key}: ${provided.get(key)} and ${rel}`);
    }
    provided.set(key, rel);
  }
};
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(SRC, file);
  for (const m of text.matchAll(/ctx\.provide\(\{([\s\S]*?)\}\)/g)) recordKeys(m[1], rel);
  /* io.js publishes through a factory — `ctx.provide(makeIo(ctx))` — so its
     keys live in makeIo's return literal, not in the provide() call. Without
     this, the whole io surface (writeFile, readFile, …) went invisible to
     the collision check and a second module could shadow it unseen. */
  if (/ctx\.provide\(makeIo\(/.test(text)) {
    const ret = text.match(/function makeIo\([\s\S]*?\n  return \{([\s\S]*?)\n  \};/);
    ok(ret, `${rel} provides via makeIo, so makeIo's return literal must be parseable here`);
    if (ret) recordKeys(ret[1], rel);
  }
}
eq(dupes, [], 'two modules must not publish the same name onto ctx');
ok(provided.size > 30, `ctx should carry the full published surface (found ${provided.size})`);
ok(provided.get('writeFile') === 'io.js',
  'the io surface is visible to this check — the factory indirection must not hide it');

/* ---- 5b. no module eagerly destructures a key registered after it ---- */
/* savings.js once destructured saveAccount — provided by views/accounts.js —
   at register time. That made it the ONE module whose correctness depended on
   the order of the register calls in controller.js, against the late-bound
   `ctx.x()` idiom every other cross-view call uses: reorder the calls and the
   key is silently undefined at mount, throwing a screen and a session away
   from the cause. The rule, enforced: an identifier pulled out of ctx at the
   TOP of a register function must already exist at that point — a controller
   base key, or a key provided by a module registered earlier. */
{
  const reqFile = new Map([...controller.matchAll(/const (register\w+) = require\('\.\/(.+?)'\)/g)]
    .map(m => [m[1], m[2] + '.js']));
  const order = [...controller.matchAll(/^\s{2}(register\w+)\(ctx\);/gm)].map(m => m[1]);
  ok(order.length >= 15, `controller registers the modules in one block (found ${order.length})`);

  /* Base keys are only what exists BEFORE the register block runs — the ctx
     literal plus ctx.<k> assignments above it. reloadFromDisk, assigned
     below the block, is deliberately NOT base: destructuring it at register
     time would be exactly the bug this check exists to catch. */
  const preamble = controller.slice(0, controller.indexOf(`${order[0]}(ctx);`));
  const avail = new Set();
  const lit = preamble.match(/const ctx = \{([^}]*)\}/);
  ok(lit, 'controller still builds ctx as one literal');
  for (const k of lit[1].matchAll(/([A-Za-z_$]\w*)/g)) avail.add(k[1]);
  for (const k of preamble.matchAll(/ctx\.([A-Za-z_$]\w*)\s*=/g)) avail.add(k[1]);

  const providesByFile = new Map();
  for (const [key, rel] of provided) {
    if (!providesByFile.has(rel)) providesByFile.set(rel, new Set());
    providesByFile.get(rel).add(key);
  }

  const violations = [];
  for (const reg of order) {
    const rel = reqFile.get(reg);
    ok(rel, `the registrar ${reg} resolves to a required file`);
    const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
    /* Only the destructure at the TOP of the register function runs at
       register time; ones inside handlers are late-bound and order-immune.
       Anchored to the function opening (comments allowed between) so a
       nested destructure deeper in the file is not misread as eager. */
    const dm = text.match(
      /module\.exports = function \w*\(ctx\) \{\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*const \{([^}]*)\} = ctx;/);
    if (dm) {
      for (const item of dm[1].split(',')) {
        const key = (item.split(':')[0] || '').trim();
        if (key && !avail.has(key)) {
          violations.push(`${rel} destructures ${key} at register time, but nothing has provided it yet`);
        }
      }
    }
    for (const k of providesByFile.get(rel) || []) avail.add(k);
  }
  eq(violations, [],
    'a register-time destructure must only reach keys that already exist — late-bind through ctx.x() instead');
}

/* ---- 5c. the S declaration is the schema, not a sample ---- */
/* controller.js's S literal reads as authoritative — per-key shape comments,
   a reset-vs-survives fence — so a key it omits is a key nobody can audit:
   it once listed 22 keys while eleven more (six of them canonical vault
   state written by load.js) lived only in the code that touched them.
   Enforced: every `S.<key>` in src/ appears in the declaration. Comments are
   stripped first — load.js documents the `S.x = []` shape in prose. */
{
  const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const sLit = controller.match(/const S = \{([\s\S]*?)\n  \};/);
  ok(sLit, 'controller.js still declares S as one literal');
  const declared = new Set();
  for (const l of stripComments(sLit[1]).split('\n')) {
    const m = l.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (m) declared.add(m[1]);
  }
  ok(declared.size >= 30, `the schema block carries the full state (found ${declared.size})`);
  const undeclared = new Set();
  for (const file of walk(SRC)) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/\bS\.([A-Za-z_$][\w$]*)/g)) {
      if (!declared.has(m[1])) undeclared.add(`${m[1]} (${path.relative(SRC, file)})`);
    }
  }
  eq([...undeclared].sort(), [],
    'every S.<key> used anywhere in src/ must be declared in the schema block');
}

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

/* ---- 8. manual mode's selectors still address something ----
   applyInputMode() in controller.js hides the CSV affordances for a household
   that types its transactions in by hand. It reaches for them by SELECTOR, not
   by id, so shell-contract's check 1 above (which only follows `$('#id')`)
   cannot see it: rename the drawer link's data-view and the hide becomes a
   no-op that leaves an Import link in front of exactly the reader manual mode
   exists to keep it away from, with every suite green.

   Parsed out of controller.js rather than typed here, so the two lists cannot
   drift — adding a third affordance to the loop is enough. */
{
  const fn = controller.match(/function applyInputMode\(root, mode\) \{([\s\S]*?)\n\}/);
  ok(fn, 'controller.js must still export applyInputMode as a standalone function');
  /* Only the strings inside the selector ARRAY — a loose scan over the whole
     body also picks up 'manual' and 'hidden', which are not selectors and
     which no shell markup will ever satisfy. */
  const list = fn[1].match(/for \(const sel of \[([\s\S]*?)\]\)/);
  ok(list, 'applyInputMode still loops over one array of selectors');
  const selectors = [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  ok(selectors.length >= 2, `applyInputMode hides at least the drawer link and the top-bar button (found ${selectors.length})`);
  for (const sel of selectors) {
    const attr = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
    const idSel = sel.match(/^#([\w-]+)$/);
    if (attr) {
      ok(shell.includes(`${attr[1]}="${attr[2]}"`),
        `applyInputMode hides '${sel}' but nothing in shell.js carries that attribute`);
    } else if (idSel) {
      ok(shellIds.has(idSel[1]), `applyInputMode hides '${sel}' but shell.js defines no such id`);
    } else {
      ok(false, `applyInputMode uses a selector shape this check cannot verify: ${sel}`);
    }
  }
  /* HIDES, never removes: the node has to come back when the household flips
     the setting to CSV again. */
  ok(/classList\.toggle\('hidden'/.test(fn[1]),
    'applyInputMode must toggle the hidden class — a removed node cannot come back when the setting is flipped');

  /* ...and there must still BE a way in. The Accounts page's own "Import
     transactions" button is not one: it only appears on an account with no
     transactions yet, so a manual household that later receives a CSV for an
     account that already has rows would have no route to the screen at all.
     The command palette is that route, and the setting is the other — both
     are claimed in the setting's description, so both are pinned here. A
     hidden affordance whose documented way back does not exist is worse than
     no affordance. */
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  ok(/id: 'import-transactions'/.test(main),
    'main.js must register a command that reaches the import screen when the drawer link is hidden');
  ok(/ctl\.showImport\(\)/.test(main),
    'and it must go through the controller rather than poking at the DOM');
  ok(/showImport:/.test(controller),
    'controller.js must expose showImport for it — the view dispatcher is not public');
  /* Parks the route when the vault has not loaded rather than refusing: the
     command opens the view and arrives microseconds later, long before
     connectVault() has finished, and connectVault ends by switching to
     S.view. Refusing there would make the command fail from a cold start,
     which is the state most readers run it in. */
  ok(/showImport:[\s\S]{0,400}?S\.view = 'import'/.test(controller),
    'showImport must park the route for connectVault when the vault has not loaded yet');

  const settingsTabSrc = fs.readFileSync(path.join(SRC, 'settings-tab.js'), 'utf8');
  const desc = (settingsTabSrc.match(/const INPUT_MODE_DESC = '([^']*(?:\\.[^']*)*)'/) || [''])[1];
  ok(desc.length > 60, 'the input-mode setting still carries a description');
  ok(/command palette/i.test(desc),
    'and it must name the command palette as the way back to the import screen');
  ok(!/reachable from the Accounts page/i.test(desc),
    'the old claim is gone — the Accounts page button only exists on an account with no transactions');
}

console.log(`PASS — shell id contract + ctx namespace + DOMParser safety intact (${checks} checks, ${shellIds.size} ids, ${provided.size} ctx keys, ${shellSaveIds.length} save buttons).`);
