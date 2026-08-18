'use strict';
/* The two settings tabs must stay in step.

   src/settings-tab.js describes the same settings twice: display() builds them
   imperatively for Obsidian below 1.13, and getSettingDefinitions() declares
   them for 1.13+, which falls back to display() only when the declarative list
   comes back empty. Both ship in every build, and users on either side of that
   version line see only one of them — so a setting added to one and forgotten
   in the other is invisible to whoever is on the other version, with nothing at
   runtime to complain.

   Five invariants, pinned so the drift becomes a build failure:

     1. both paths cover the same set of setting names
     2. every declarative control key is either a plugin-data key or a
        Settings.md key routed through the get/setControlValue overrides
     3. every MD_KEY is actually handled in both overrides
     4. getSettingDefinitions() stays cheap — no await, no vault read
     5. a description that has to react to the file's state is derived on both
        sides, not inlined as the bare constant on one of them

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
/* Matches BOTH an inline literal and a translated name:
     .setName('Country')            -> 'Country'
     .setName(i18n.t('settings.language.name')) -> 'settings.language.name'
   Without the optional `i18n.t(` the translated settings would match on
   NEITHER side — absent from both, therefore "consistent", and this check would
   go quietly blind exactly as the tab gets translated. Comparing the key is as
   good as comparing the English: the two halves must name the same key, and
   tests/i18n.test.cjs separately pins that the key exists. */
const names = text => new Set(
  [...text.matchAll(/(?:\.setName\(|\bname:\s*)(?:i18n\.t\()?'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'")));
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
eq([...mdKeys].sort(),
  ['country', 'currency', 'emergency_target_months', 'household', 'language', 'month_start_day',
    'overspend_lag', 'owners', 'period_anchor', 'period_days'],
  'MD_KEYS holds every Settings.md key');

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

/* ---- 5. state-dependent descriptions are derived on BOTH sides ---- */
/* Period length's description carries a warning when Settings.md names a cycle
   length with no usable anchor — the app runs payday months in that pairing, so
   a description that just states what the dropdown says would be describing a
   cycle the app is not running. It is computed by periodLengthDesc(), and the
   failure mode this pins is one half keeping the derived call while the other
   reverts to the bare constant: the two tabs would then disagree about whether
   to warn, and only the users on the other side of the 1.13 line would see it.
   Check 1 cannot catch that — the setting NAME is present either way.

   Anchored on the CALL SITE, not the bare name: periodLengthDesc is DEFINED
   above display(), so it falls inside the imperative slice and a loose
   /periodLengthDesc\(/ would match its own definition and pass even after
   display() reverted to the constant. */
for (const [label, half, call] of [
  ['display()', imperative, /\.setDesc\(periodLengthDesc\(/],
  ['getSettingDefinitions()', declarative, /\bdesc:\s*periodLengthDesc\(/],
]) {
  ok(call.test(half),
    `${label} must derive the Period length description via periodLengthDesc(), not inline PERIOD_LENGTH_DESC`);
  ok(!/(?:setDesc\(|desc:\s*)PERIOD_LENGTH_DESC\b/.test(half),
    `${label} uses the bare PERIOD_LENGTH_DESC — the no-anchor warning would never appear on that tab`);
}
ok(/function periodLengthDesc\(/.test(src), 'periodLengthDesc() is defined once and shared by both halves');

/* ---- 6. one YAML-quoting rule, one Settings.md patcher ----
   The Settings.md write path had grown two private dialects of the shared
   rules: onboarding.js quoted currency/household as `"${v.replace(/"/g,''))}"`
   (deletes quotes, escapes nothing — a backslash in a household name made the
   whole block unparseable to Obsidian), and main.js patched keys with a line
   regex that orphaned block values instead of collapsing them the way
   patchFrontmatter does. Both are text-analysis-checkable, so the drift is
   pinned here where the other settings-write invariants already live. */
{
  const srcDir = path.join(__dirname, '..', 'src');
  const onboarding = fs.readFileSync(path.join(srcDir, 'onboarding.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(srcDir, 'main.js'), 'utf8');

  // The quote-deleting idiom must not exist as CODE anywhere in either writer.
  // (csv.js's `replace(/"/g, '""')` is CSV doubling — a different, correct rule
  // — and stays out of scope by only scanning the two frontmatter writers.
  // Comments may cite the idiom as history; code lines may not.)
  const codeLines = s => s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l));
  for (const [name, text] of [['onboarding.js', onboarding], ['settings-tab.js', src]]) {
    ok(!codeLines(text).some(l => l.includes(`replace(/"/g, '')`)),
      `${name} must not hand-quote a frontmatter value by deleting quotes — use yamlStr`);
  }

  // The wizard routes every free-text scalar through yamlStr.
  ok(/updateBudgetSettingsMd\('currency', yamlStr\(/.test(onboarding),
    'onboarding writes currency through yamlStr');
  ok(/updateBudgetSettingsMd\('household', yamlStr\(/.test(onboarding),
    'onboarding writes household through yamlStr');
  ok(/institution: \$\{yamlStr\(/.test(onboarding),
    'onboarding quotes the free-text institution scalar');

  // Settings.md is patched by the shared patcher, never by a fresh regex.
  ok(/patchFrontmatter\(/.test(mainSrc),
    'updateBudgetSettingsMd goes through patchFrontmatter');
  ok(!/new RegExp\('\^\(/.test(mainSrc),
    'the line-regex patcher must not come back — it orphans YAML block values');
}

console.log(`PASS — settings tab parity: ${impNames.size} settings declared both ways (${checks} checks).`);
