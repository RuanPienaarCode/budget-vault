'use strict';
/* A LANGUAGE TABLE IS LOADED WHEN IT IS FIRST READ, NEVER AT PLUGIN LOAD — AND
   A TABLE THAT CANNOT BE LOADED READS AS ENGLISH, NOT AS A BROKEN INTERFACE.

   Until November 2026 src/i18n.js required all twelve tables at module load.
   Measured on the 1.59.0 bundle: the tables were 1.77 MB of its 2.63 MB (67%),
   and requiring the bundle kept 8.9 MB of heap — for a reader who will only
   ever see one of the twelve. esbuild already wraps every CommonJS module in a
   function that runs on its first require(), so nothing about the BUNDLER had
   to change to stop paying for the other eleven: the requires only had to move
   out of the module's top level and behind the first lookup.

   That makes "is it still lazy" a property nothing else in the suite would
   notice breaking. A `const de = require('./lang/de')` put back at the top of
   i18n.js, or a view that calls i18n.t() at its own top level, passes every
   other test here and silently restores the whole cost. So it is pinned:

     1. requiring src/i18n.js loads NO table — not even English;
     2. requiring the whole plugin (src/main.js, obsidian stubbed) loads none
        either, so no module translates anything while it is being loaded;
     3. reading one language loads that table and no other;
     4. the public TABLES object still looks the way every test reads it —
        twelve enumerable keys, each the table itself — and listing its keys
        does not load anything;
     5. a table that throws while loading falls back to English key by key,
        exactly as a missing key does, says so once on the console rather than
        failing in silence, and is not retried on every lookup;
     6. if ENGLISH is the table that cannot load, a lookup returns the key —
        the same visible, greppable worst case t() has always had.

   The loader is intercepted through Module._load, the same seam
   tests/helpers/harness.cjs uses to stub `obsidian`, so the failure in 5 and 6
   is a real require() throwing inside the real src/i18n.js — no test-only
   branch exists in src/ for it.

   Pure node.  node tests/i18n-lazy-tables.test.cjs */

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const LANG_DIR = path.join(SRC, 'lang') + path.sep;
const CODES = fs.readdirSync(LANG_DIR).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort();
ok(CODES.length >= 12, `src/lang/ holds the shipped tables (${CODES.length})`);

/* Which tables this process has actually evaluated, read off Node's own module
   cache — so the answer is "what was required", not "what i18n.js says it
   required". */
const loadedTables = () => Object.keys(require.cache)
  .filter(f => f.startsWith(LANG_DIR)).map(f => path.basename(f, '.js')).sort();

/* A fresh copy of the module graph, so each scenario starts with nothing
   loaded and its own `current` language. */
const forgetSrc = () => {
  for (const f of Object.keys(require.cache)) if (f.startsWith(SRC + path.sep)) delete require.cache[f];
};
const freshI18n = () => { forgetSrc(); return require(path.join(SRC, 'i18n.js')); };

/* ---- 1. requiring i18n.js loads no table ---- */
{
  const i18n = freshI18n();
  eq(loadedTables(), [], 'requiring src/i18n.js evaluates no language table — not even English');
  ok(typeof i18n.t === 'function', 'and the module is the real one');
}

/* ---- 2. requiring the whole plugin loads no table ---- */
{
  forgetSrc();
  require('./helpers/harness.cjs').stubObsidian();
  const Plugin = require(path.join(SRC, 'main.js'));
  ok(typeof Plugin === 'function', 'src/main.js evaluated and exports the plugin class');
  eq(loadedTables(), [],
    'loading the plugin evaluates no language table — a module that calls i18n.t() at its own '
    + 'top level pulls a whole table in for every reader, on every load. Move the call into the '
    + 'function that renders it');
}

/* ---- 3. one language read, one table loaded ---- */
{
  const i18n = freshI18n();
  i18n.setLanguage('en');
  eq(loadedTables(), [], 'choosing a language loads nothing by itself');
  eq(i18n.t('nav.dashboard'), 'Dashboard', 'English resolves');
  eq(loadedTables(), ['en'], 'the first English lookup loads English and nothing else');

  i18n.setLanguage('de');
  eq(i18n.t('nav.dashboard'), 'Übersicht', 'German resolves');
  eq(loadedTables(), ['de', 'en'], 'switching to German adds exactly the German table');

  /* A reader in German never touches English unless German lacks the key. */
  const only = freshI18n();
  only.setLanguage('af');
  eq(only.t('nav.dashboard'), 'Paneelbord', 'Afrikaans resolves on a fresh module');
  eq(loadedTables(), ['af'], 'a reader in another language does not load English for a key their table has');
  eq(only.t('nope.not.a.key'), 'nope.not.a.key', 'an unknown key still returns itself');
  eq(loadedTables(), ['af', 'en'], '… having asked English for it, which is when English is first needed');
}

/* ---- 4. the public TABLES surface is unchanged ---- */
{
  const i18n = freshI18n();
  const { TABLES, LANGUAGE_ORDER, LANGUAGE_NAMES } = i18n;
  eq(Object.keys(TABLES).sort(), CODES, 'TABLES lists every file in src/lang/ as an enumerable key');
  eq([...LANGUAGE_ORDER].sort(), CODES, 'LANGUAGE_ORDER offers every shipped table');
  for (const code of CODES) ok(LANGUAGE_NAMES[code], `${code} has a native name`);
  ok('de' in TABLES && !('klingon' in TABLES), '`in` answers for a shipped and an unshipped code');
  eq(loadedTables(), [], 'listing the languages — keys, order, names, `in` — loads no table');

  ok(TABLES.de === require(path.join(LANG_DIR, 'de.js')), 'TABLES.de IS the table module, not a copy');
  eq(loadedTables(), ['de'], 'reading TABLES.de loads German only');
  ok(TABLES.de === TABLES.de, 'and the same object on every read');
  eq(TABLES.klingon, undefined, 'an unshipped code reads as undefined, as it always did');

  /* Tests inject and remove keys through TABLES (tests/i18n.test.cjs,
     dash-unreadable-dates-disclosed) — that only works if what TABLES hands
     back is the object t() reads. */
  i18n.setLanguage('de');
  TABLES.de['test.lazy.injected'] = 'eingefügt';
  eq(i18n.t('test.lazy.injected'), 'eingefügt', 'a key written through TABLES is the key t() reads');
  delete TABLES.de['test.lazy.injected'];
  eq(i18n.t('test.lazy.injected'), 'test.lazy.injected', 'and removing it is seen too');

  const entries = Object.entries(TABLES);
  eq(entries.map(([c]) => c).sort(), CODES, 'Object.entries(TABLES) walks every table');
  ok(entries.every(([, table]) => table && typeof table === 'object' && Object.keys(table).length > 100),
    'and hands each one over as a real, populated table');
  eq(loadedTables(), CODES, 'which is the one thing that loads all of them');

  /* A hand-edited Settings.md is untrusted text. `constructor` is a property
     every object inherits, and a lookup by plain indexing would have called it
     a language. */
  for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    eq(i18n.resolveLanguage(word), 'en', `"${word}" in Settings.md is not a language`);
  }
}

/* ---- 5. a table that fails to load falls back to English ---- */
const origLoad = Module._load;
const origError = console.error;
const failing = (codes, body) => {
  const attempts = Object.fromEntries(codes.map(c => [c, 0]));
  const said = [];
  Module._load = function (request, ...rest) {
    const m = /^\.\/lang\/(\w+)$/.exec(request);
    if (m && codes.includes(m[1])) {
      attempts[m[1]]++;
      throw new Error(`planted: lang/${m[1]}.js failed to evaluate`);
    }
    return origLoad.call(this, request, ...rest);
  };
  console.error = (...args) => { said.push(args.map(String).join(' ')); };
  try { body(attempts, said); } finally { Module._load = origLoad; console.error = origError; }
};

failing(['fr'], (attempts, said) => {
  const i18n = freshI18n();
  eq(i18n.resolveLanguage('fr'), 'fr', 'French is still a shipped language — nothing has tried to load it yet');
  eq(i18n.setLanguage('fr'), 'fr', 'and can be chosen');
  let text;
  assert.doesNotThrow(() => { text = i18n.t('nav.dashboard'); }, 'a table that throws while loading must not throw out of t()');
  checks++;
  eq(text, 'Dashboard', 'the lookup falls back to English, the way a missing key does');
  eq(i18n.t('settings.budgetsKept', { count: 3 }).includes('your 3 existing'), true,
    'plural selection and interpolation still work through the fallback');
  eq(i18n.t('nope.not.a.key'), 'nope.not.a.key', 'and an unknown key is still returned as itself');
  for (let n = 0; n < 50; n++) i18n.t('nav.dashboard');
  eq(attempts.fr, 1, 'the failed table is tried ONCE, not on every one of the lookups that follow');
  eq(said.length, 1, 'the failure is reported once on the console — unavailable, but never silently');
  ok(/\bfr\b/.test(said[0]) && /English/.test(said[0]) && /planted/.test(said[0]),
    `the report names the language, the fallback and the cause — got: ${said[0]}`);
  eq(i18n.TABLES.fr, undefined, 'TABLES reads a table that could not load as absent, not as an empty one');
  eq(Object.keys(i18n.TABLES).sort(), CODES, 'while still listing it as shipped');

  /* The other tables are untouched by one failing. */
  i18n.setLanguage('de');
  eq(i18n.t('nav.dashboard'), 'Übersicht', 'another language loads normally beside the failed one');
  eq(said.length, 1, 'with nothing further reported');
});

/* ---- 6. English itself failing: the key, never a throw or a blank ---- */
failing(['en'], (attempts, said) => {
  const i18n = freshI18n();
  i18n.setLanguage('en');
  let text;
  assert.doesNotThrow(() => { text = i18n.t('nav.dashboard'); }, 'English failing to load must not throw out of t()');
  checks++;
  eq(text, 'nav.dashboard', 'with no English to fall back to, the key is returned — visible and greppable');
  i18n.setLanguage('af');
  eq(i18n.t('nav.dashboard'), 'Paneelbord', 'a language that did load is unaffected');
  eq(i18n.t('nope.not.a.key'), 'nope.not.a.key', 'and its missing keys still come back as themselves');
  eq(attempts.en, 1, 'English is tried once');
  eq(said.length, 1, 'and reported once');
});

/* A table that evaluates but exports something that is not a table (a bad
   merge leaving `module.exports = undefined`) is the same failure by another
   route. */
{
  const said = [];
  Module._load = function (request, ...rest) {
    if (request === './lang/es') return undefined;
    return origLoad.call(this, request, ...rest);
  };
  console.error = (...args) => { said.push(args.map(String).join(' ')); };
  try {
    const i18n = freshI18n();
    i18n.setLanguage('es');
    eq(i18n.t('nav.dashboard'), 'Dashboard', 'a table that exports nothing falls back to English too');
    eq(said.length, 1, 'and is reported');
  } finally { Module._load = origLoad; console.error = origError; }
}

/* ---- the source keeps the shape that makes this true ---- */
{
  const src = fs.readFileSync(path.join(SRC, 'i18n.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const requires = [...src.matchAll(/require\('\.\/lang\/(\w+)'\)/g)];
  eq(requires.map(m => m[1]).sort(), CODES,
    'src/i18n.js names every file in src/lang/ exactly once — a string literal each, because '
    + 'esbuild only bundles a require() whose path it can read');
  for (const m of requires) {
    ok(/\(\)\s*=>\s*$/.test(src.slice(0, m.index)),
      `require('./lang/${m[1]}') sits behind an arrow function, so it runs on first use — `
      + 'at the top level it would load the table for every reader');
  }
}

forgetSrc();
console.log(`PASS i18n-lazy-tables — no table loads until it is read, one read loads one table, and a table that cannot load reads as English (${checks} checks)`);
