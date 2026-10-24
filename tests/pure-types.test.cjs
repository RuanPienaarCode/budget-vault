'use strict';
/* The pure modules, type-checked as the JavaScript they are.

   No TypeScript in src/ and no change to the build: this runs the compiler
   over the existing .js with `checkJs`, emits nothing, and fails on any
   diagnostic. main.js is byte-for-byte what it was, so the community
   scorecard's rebuild is untouched.

   WHAT IT CHECKS, and why each part is there:

     • Every top-level src/*.js is checked UNLESS it is named in HOST_SIDE
       below. Pure is the default and leaving it is the declaration, which is
       the repo's own rule ("if it can be pure, it is") made mechanical: a new
       module that reaches for the DOM fails here until someone writes down
       why it has to.

     • The library is ES2021 and NOTHING else — no DOM, no @types/node, no
       obsidian. So a pure module that touches `document`, `window`, `Buffer`
       or `require('obsidian')` is a type error, not a convention. The only
       host globals allowed are the ones present on BOTH hosts, declared one by
       one in tests/helpers/host-globals.d.ts.

     • ES2021 is also an engine floor for APIs. Array.prototype.at,
       Object.hasOwn and structuredClone are ES2022-era and arrived in Safari
       15.4 — after the iOS 15.0 this plugin has to run on. They are absent
       from the ES2021 lib, so a pure module that calls one fails here. (Syntax
       is a different floor and stays with esbuild's `target: 'safari15'`.)

     • The compiler follows require(). A pure module that requires a host-side
       one drags it into the program and its DOM use fails the run, which is
       the right answer: purity is transitive or it is nothing.

   WHAT IT DOES NOT CHECK: views, lang files, the HOST_SIDE modules, and the
   NOT_YET ones; and it runs non-strict. When this landed (2026-10-24) every
   diagnostic in the pure set was an inference drawn too narrow — `= {}`
   defaults in money-flow.js, a page object assigned inside a closure in
   pdf.js, a [name, regex] table read as (string|RegExp)[] in receipt-file.js
   — and not one was a defect. Strict mode would mostly demand more of that,
   a tax on the house style for no catch. The control at the bottom proves
   the run is not vacuously green.

     node tests/pure-types.test.cjs   # non-zero exit on failure
*/

const fs = require('fs');
const path = require('path');

let ts;
try {
  ts = require('typescript');
} catch {
  console.error('FAIL tests/pure-types.test.cjs — typescript is not installed. Run `npm ci`.');
  process.exit(1);
}

const SRC = path.join(__dirname, '..', 'src');
const HOST_GLOBALS = path.join(__dirname, 'helpers', 'host-globals.d.ts');

/* Modules that own the DOM or the Obsidian API, each with the reason. The
   reason is the point: an entry that cannot name one is a module that should
   be split until its logic half can come off this list. */
const HOST_SIDE = new Map([
  ['main.js',                'plugin entry — Obsidian Plugin subclass'],
  ['view.js',                'Obsidian ItemView'],
  ['controller.js',          'wires the views to the vault through Obsidian'],
  ['api.js',                 'the sibling-plugin API — reaches io, load and the dashboard view'],
  ['settings-tab.js',        'Obsidian PluginSettingTab'],
  ['onboarding.js',          'renders the first-run flow; writes through Obsidian'],
  ['modal.js',               'builds modals in the DOM'],
  ['budget-export-modal.js', "an Obsidian modal — require('obsidian')"],
  ['receipt-modal.js',       "an Obsidian modal — require('obsidian')"],
  ['dom.js',                 'DOM helpers'],
  ['chart.js',               'draws SVG into the DOM'],
  ['dash-motion.js',         "the Dashboard's arrival motion — document and window"],
  ['welcome-motion.js',      'builds the welcome animation with createDiv'],
  ['pdf-raster.js',          "paints pdf.js's pages onto a canvas from document"],
  ['categories.js',          'opens modal.js editors from its rule helpers'],
  ['io.js',                  "require('obsidian') — vault reads and writes"],
  ['load.js',                "require('obsidian') — the loader reads TFiles"],
  ['fx-fetch.js',            "require('obsidian') — requestUrl"],
  ['fx-live.js',             'requires fx-fetch.js'],
  ['i18n.js',                'reads window/navigator for the locale'],
  ['owners.js',              'requires i18n.js for its labels'],
  ['report.js',              'requires i18n.js for its labels'],
  ['figures.js',             'requires owners.js, so i18n.js'],
  ['budget-export.js',       'requires report.js, so i18n.js'],
]);

/* Pure — no DOM, no Obsidian — but not yet checkable: their inferred shapes
   need JSDoc before the checker reads them correctly. Unlike HOST_SIDE this
   list is meant to shrink, so an entry that starts passing FAILS the run
   until it is removed; otherwise a module would sit exempt long after it
   stopped needing to be. */
const NOT_YET = new Map([
  ['receipt-parse.js', 'a receipt line comes in several kinds with different fields; 14 diagnostics, all '
    + 'property-on-union, wanting a @typedef per kind'],
]);

let checks = 0;
const fail = msg => { console.error(`FAIL tests/pure-types.test.cjs — ${msg}`); process.exit(1); };

const all = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
for (const name of [...HOST_SIDE.keys(), ...NOT_YET.keys()]) {
  if (!all.includes(name)) fail(`src/${name} is listed as exempt but no longer exists — drop the entry.`);
  checks++;
}
const pure = all.filter(f => !HOST_SIDE.has(f) && !NOT_YET.has(f));

/* Guard against a vacuous pass: a broken glob or an over-eager exemption
   would check nothing and print PASS. These are the modules CLAUDE.md names
   as the pure core, plus the ones this test's first JSDoc fixes made
   checkable. */
for (const core of ['dates.js', 'amount.js', 'markdown.js', 'csv.js', 'debt-math.js', 'loan-math.js',
  'savings-math.js', 'owed-math.js', 'reconcile.js', 'recurring.js', 'worth.js', 'dedupe.js',
  'tx-role.js', 'money-flow.js', 'period.js', 'statement.js', 'pdf.js', 'receipt-file.js']) {
  if (!pure.includes(core)) fail(`src/${core} is not in the checked set — it is pure core and must stay checked.`);
  checks++;
}

const OPTIONS = {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2021,
  module: ts.ModuleKind.CommonJS,
  lib: ['lib.es2021.d.ts'],
  types: [],
};

function diagnose(roots, host) {
  const program = ts.createProgram(roots, OPTIONS, host);
  return ts.getPreEmitDiagnostics(program);
}

const format = d => {
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n    ');
  if (!d.file) return `  TS${d.code}  ${msg}`;
  const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
  const rel = path.relative(path.join(__dirname, '..'), d.file.fileName);
  const hostSide = HOST_SIDE.has(path.basename(d.file.fileName)) && path.dirname(d.file.fileName) === SRC;
  const hint = hostSide ? '\n    (a host-side module, reached by require() from the pure set)' : '';
  return `  ${rel}:${line + 1}:${character + 1}  TS${d.code}  ${msg}${hint}`;
};

/* ---- the control: prove the options catch what this test claims ---------
   An in-memory module that breaks each rule once. If any of these stops being
   flagged — a TypeScript upgrade that changes a lib, an option typo that turns
   checkJs off — every real module would pass for the wrong reason. */
{
  const CONTROL = path.join(SRC, '__pure_types_control__.js');
  const cases = {
    'document': 'module.exports = () => document.title;',
    'Array.at (Safari 15.4)': 'module.exports = xs => [1, 2].at(-1);',
    "require('obsidian')": "const { Notice } = require('obsidian'); module.exports = Notice;",
    /* On a known type, not an object literal: in a .js file the checker treats
       `const o = { … }` as an open container that may grow, so a typo read off
       one is NOT flagged — which is also why the JSDoc in money-flow.js is
       what makes its destructured arguments checkable at all. */
    'misspelt property': "module.exports = 'R 1 200'.lenght;",
  };
  for (const [rule, text] of Object.entries(cases)) {
    const host = ts.createCompilerHost(OPTIONS);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (file, lang, ...rest) => file === CONTROL
      ? ts.createSourceFile(file, text, lang)
      : getSourceFile(file, lang, ...rest);
    const fileExists = host.fileExists.bind(host);
    host.fileExists = f => f === CONTROL || fileExists(f);
    const flagged = diagnose([CONTROL, HOST_GLOBALS], host).some(d => d.file && d.file.fileName === CONTROL);
    if (!flagged) fail(`the control for "${rule}" was not flagged — the checker options no longer enforce it.`);
    checks++;
  }
}

/* ---- the real run ------------------------------------------------------- */
const diags = diagnose([...pure.map(f => path.join(SRC, f)), HOST_GLOBALS]);
if (diags.length) {
  console.error(`FAIL tests/pure-types.test.cjs — ${diags.length} type error(s) in the pure set:\n`);
  for (const d of diags) console.error(format(d));
  console.error('\nFix the module, add JSDoc where an inference is too narrow, or — if it genuinely owns the DOM —'
    + ' add it to HOST_SIDE with the reason.');
  process.exit(1);
}
checks++;

/* ---- the ratchet: a NOT_YET module that now passes comes off the list --- */
for (const name of NOT_YET.keys()) {
  const own = diagnose([path.join(SRC, name), HOST_GLOBALS]).length;
  if (!own) fail(`src/${name} now type-checks cleanly — remove it from NOT_YET so it stays that way.`);
  checks++;
}

console.log(`PASS tests/pure-types.test.cjs (${pure.length} pure modules type-checked, ${checks} checks)`);
