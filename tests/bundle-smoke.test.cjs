'use strict';
/* The BUNDLE gate — the only test that looks at main.js rather than src/.

   Every other test in here requires ../src/* directly, which means they pass
   identically whether the bundle is minified, mangled, or never built at all.
   That is the right call for logic tests, but it leaves the build step itself
   completely unguarded: `node --check main.js` only proves the file PARSES,
   and a bundle can parse perfectly while throwing on the first line the engine
   actually runs.

   That gap became load-bearing when build.sh started passing --minify. The
   risk of minification is not syntax, it is renaming: anything that looked up
   a function or class by NAME at runtime would break silently, at plugin load,
   on the user's phone, with a green test suite behind it. Nothing in src/ does
   that today — this test is what keeps it true tomorrow.

   What it proves: the bundle evaluates end to end against the obsidian stub
   (so every module's top-level ran), and it still exports a plugin class whose
   prototype carries the lifecycle methods Obsidian calls by name. Those method
   NAMES are part of Obsidian's API contract and are the one thing a mangler
   must never touch. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');

const BUNDLE = path.join(__dirname, '..', 'main.js');

stubObsidian();

assert.ok(fs.existsSync(BUNDLE), 'main.js is missing — run ./build.sh first');

/* The evaluation itself IS the assertion: a throw anywhere in any module's
   top-level scope fails the test here, with the real stack. */
const BudgetPlugin = require(BUNDLE);

assert.strictEqual(typeof BudgetPlugin, 'function', 'bundle must export the plugin class');

/* Called by name from outside the class — `onload` by Obsidian itself, the
   rest by view.js / settings-tab.js / onboarding.js through the plugin handle
   they are given. A mangler that renamed any of them would produce a plugin
   that loads, does nothing, and reports no error at all.

   `onunload` is deliberately NOT in this list: this plugin doesn't define one
   (Obsidian's Plugin base handles teardown, and registerEvent/registerView
   unwind themselves), so asserting it here would fail on a correct bundle. */
for (const method of ['onload', 'loadSettings', 'saveSettings', 'activateView', 'reloadViews', 'forEachView']) {
  assert.strictEqual(
    typeof BudgetPlugin.prototype[method], 'function',
    `BudgetPlugin.prototype.${method} must survive the bundle (Obsidian calls it by name)`,
  );
}

/* It must extend SOMETHING — the obsidian stub's Plugin. A bundle that lost
   the base class would still export a function and still pass the checks
   above, while every this.addCommand / this.registerView call fails at load. */
assert.notStrictEqual(
  Object.getPrototypeOf(BudgetPlugin), Function.prototype,
  'BudgetPlugin must still extend obsidian\'s Plugin',
);

/* The iOS 15 floor, checked on what the engine actually parses. Grepping src/
   for this pattern flags the COMMENTS that explain why a hand-rolled scanner
   was used instead of a lookbehind — a red failure on exactly the code that
   got it right. The bundle has no comments, so it cannot lie this way. */
const src = fs.readFileSync(BUNDLE, 'utf8');
assert.ok(
  !/\(\?<[=!]/.test(src),
  'regex lookbehind in the bundle — a parse-time SyntaxError on WebKit before iOS 16.4, which kills the WHOLE plugin',
);

console.log('bundle-smoke: ok — main.js evaluates, exports BudgetPlugin, lifecycle methods intact');
