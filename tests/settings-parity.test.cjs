'use strict';
/* The two settings tabs must stay in step.

   src/settings-tab.js describes the same settings twice: display() builds them
   imperatively for Obsidian below 1.13, and getSettingDefinitions() declares
   them for 1.13+, which falls back to display() only when the declarative list
   comes back empty. Both ship in every build, and users on either side of that
   version line see only one of them — so a setting added to one and forgotten
   in the other is invisible to whoever is on the other version, with nothing at
   runtime to complain.

   Four invariants, pinned so the drift becomes a build failure:

     1. both paths cover the same set of setting names
     2. every declarative control key is either a plugin-data key or a
        Settings.md key routed through the get/setControlValue overrides
     3. every MD_KEY is actually handled in both overrides
     4. getSettingDefinitions() stays cheap — no await, no vault read

   Pure text analysis — no Obsidian, no DOM.
     node tests/settings-parity.test.cjs
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const file = path.join(__dirname, '..', 'src', 'settings-tab.js');
const src = fs.readFileSync(file, 'utf8');

// Split the class at getSettingDefinitions: everything before it is the
// imperative half (display + renderMdSettings), everything after is declarative.
// Anchor on the method definition, not the first prose mention of it in the
// comments above — otherwise the split lands mid-comment and every slice below
// silently comes back empty.
const split = src.indexOf('\n  getSettingDefinitions() {');
ok(split > 0, 'settings-tab.js still defines getSettingDefinitions()');
const imperative = src.slice(0, split);
const declarative = src.slice(split);

/* ---- 1. same setting names on both sides ---- */
const names = text => new Set(
  [...text.matchAll(/(?:\.setName\(|\bname:\s*)'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'")));
const impNames = names(imperative);
const decNames = names(declarative);

const missingFromDeclarative = [...impNames].filter(n => !decNames.has(n));
const missingFromImperative = [...decNames].filter(n => !impNames.has(n));
eq(missingFromDeclarative, [], 'settings in display() but not in getSettingDefinitions(): ' + missingFromDeclarative);
eq(missingFromImperative, [], 'settings in getSettingDefinitions() but not in display(): ' + missingFromImperative);
ok(impNames.size >= 8, `expected at least 8 settings, found ${impNames.size}`);

/* ---- 2. every control key is a known storage key ---- */
const mdKeys = new Set(
  [...src.matchAll(/const MD_KEYS = new Set\(\[([^\]]*)\]\)/g)]
    .flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])));
eq([...mdKeys].sort(), ['country', 'currency', 'household', 'month_start_day'], 'MD_KEYS holds the four Settings.md keys');

const defaults = fs.readFileSync(path.join(__dirname, '..', 'src', 'constants.js'), 'utf8');
const defaultsBlock = defaults.match(/const DEFAULT_SETTINGS = \{([\s\S]*?)\n\};/);
ok(!!defaultsBlock, 'DEFAULT_SETTINGS block found in constants.js');
const pluginKeys = new Set([...defaultsBlock[1].matchAll(/^\s*(\w+):/gm)].map(x => x[1]));
ok(pluginKeys.has('budgetFolder') && pluginKeys.has('theme'), 'DEFAULT_SETTINGS parsed');

const controlKeys = [...declarative.matchAll(/\bkey:\s*'([^']+)'/g)].map(m => m[1]);
ok(controlKeys.length >= 7, `expected at least 7 bound controls, found ${controlKeys.length}`);
for (const k of controlKeys) {
  ok(mdKeys.has(k) || pluginKeys.has(k),
    `control key '${k}' is neither a DEFAULT_SETTINGS key nor a Settings.md key — it would bind to undefined`);
}

/* ---- 3. both overrides handle every Settings.md key ---- */
const getBody = src.slice(src.indexOf('\n  getControlValue(key) {'), split);
ok(getBody.length > 0, 'getControlValue/setControlValue overrides found');
for (const k of mdKeys) {
  ok(getBody.includes(`'${k}'`), `getControlValue/setControlValue never mention Settings.md key '${k}'`);
}
ok(/super\.getControlValue\(key\)/.test(getBody), 'getControlValue still delegates plugin-data keys to super');
ok(/super\.setControlValue\(key, value\)/.test(getBody), 'setControlValue still delegates plugin-data keys to super');

/* ---- 4. getSettingDefinitions() stays cheap ---- */
const defsBody = src.slice(split, src.indexOf('\n  }\n}', split));
ok(!/\bawait\b/.test(defsBody), 'getSettingDefinitions() must not await — it runs on every update()');
ok(!/readBudgetSettingsMd|vault\.(read|cachedRead)/.test(defsBody),
  'getSettingDefinitions() must not read the vault — use mdSettings() (metadataCache) instead');
ok(/metadataCache/.test(src), 'mdSettings() reads frontmatter from metadataCache, not the vault');

console.log(`PASS — settings tab parity: ${impNames.size} settings declared both ways (${checks} checks).`);
