'use strict';
/* Interface translation — the guarantees that keep a half-written language
   table from shipping as a half-broken interface.

   Seven invariants, pinned so the drift becomes a build failure:

     1. every table has exactly English's key set — no missing, no orphans
     2. a plural entry stays a plural entry, and carries every category its own
        language can actually ask for
     3. {placeholders} survive translation — a dropped {count} silently loses
        the number from the sentence
     4. plural categories are right per language (1-form, 0-is-singular, plain)
     5. lookup falls back active -> English -> the key itself, never blank
     6. every data-i18n key in the shell, and every i18n.t('…') key in src/,
        exists in English
     7. the language dropdown can only offer a language that has a table AND a
        native name

   Pure node — no Obsidian, no DOM (applyDom is driven against a tiny fake).
     node tests/i18n.test.cjs
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const i18n = require(path.join(SRC, 'i18n.js'));
const { t, setLanguage, resolveLanguage, pluralCategory, applyDom, TABLES, LANGUAGE_NAMES, LANGUAGE_ORDER } = i18n;

const en = TABLES.en;
const enKeys = Object.keys(en).sort();

/* ---- 1. every table has exactly English's key set ---- */
ok(enKeys.length > 0, 'English table is not empty');
for (const [lang, table] of Object.entries(TABLES)) {
  const keys = Object.keys(table).sort();
  const missing = enKeys.filter(k => !(k in table));
  const orphan = keys.filter(k => !(k in en));
  eq(missing, [], `${lang}.js is missing keys English has: ${missing.join(', ')}`);
  eq(orphan, [], `${lang}.js has keys English does not — dead strings, or a typo'd key: ${orphan.join(', ')}`);
}

/* ---- 2. plural entries stay plural, and cover their own categories ---- */
/* A language is only ever asked for the categories ITS OWN rule produces, so
   Chinese and Japanese legitimately need only `other`. What must not happen is
   a translator flattening a plural entry to a bare string: the count would then
   read correctly at 1 and wrong at everything else, which is the kind of bug
   nobody reports because it looks like clumsy writing rather than a fault. */
for (const [lang, table] of Object.entries(TABLES)) {
  for (const key of enKeys) {
    const enV = en[key];
    const v = table[key];
    if (typeof enV === 'string') {
      ok(typeof v === 'string', `${lang}.js '${key}' should be a plain string, matching English`);
      continue;
    }
    ok(v && typeof v === 'object',
      `${lang}.js '${key}' must stay a plural entry (an object), not be flattened to one string`);
    // Every category this language's rule can actually produce must be present.
    const needed = new Set([0, 1, 2, 5].map(n => pluralCategory(lang, n)));
    for (const cat of needed) {
      ok(typeof v[cat] === 'string',
        `${lang}.js '${key}' is missing the '${cat}' form, which ${lang} asks for`);
    }
  }
}

/* ---- 3. placeholders survive translation ---- */
const placeholders = s => {
  const out = new Set();
  for (const m of String(s).matchAll(/\{(\w+)\}/g)) out.add(m[1]);
  return [...out].sort();
};
/* Compared PER PLURAL FORM, not against the union of the English forms. A
   singular form legitimately drops the count when the language has a word for
   it — English says "Built from a balance" against "Built from {count}
   balances" — and demanding every form carry every placeholder would force
   {count} back into a sentence that reads better without it. What must not
   happen is `other` losing the number that only `other` states. */
for (const [lang, table] of Object.entries(TABLES)) {
  if (lang === 'en') continue;
  for (const key of enKeys) {
    const enV = en[key], v = table[key];
    const pairs = typeof enV === 'string'
      ? [['', enV, v]]
      : Object.keys(enV)
        // Only forms this language actually asks for; zh/ja never see `one`.
        .filter(cat => typeof v === 'object' && typeof v[cat] === 'string')
        .map(cat => [cat, enV[cat], v[cat]]);
    for (const [cat, enForm, form] of pairs) {
      const want = placeholders(enForm);
      if (!want.length) continue;
      const dropped = want.filter(p => !placeholders(form).includes(p));
      eq(dropped, [],
        `${lang}.js '${key}'${cat ? ` (${cat})` : ''} drops the ` +
        `${dropped.map(d => '{' + d + '}').join(', ')} placeholder — ` +
        'the value would vanish from the sentence');
    }
  }
}

/* ---- 4. plural categories per language ---- */
/* English, Afrikaans, German, Spanish: plural at 0. */
for (const lang of ['en', 'af', 'de', 'es']) {
  eq(pluralCategory(lang, 1), 'one', `${lang}: 1 is singular`);
  eq(pluralCategory(lang, 0), 'other', `${lang}: 0 takes the plural`);
  eq(pluralCategory(lang, 2), 'other', `${lang}: 2 takes the plural`);
}
/* French: 0 takes the singular alongside 1. */
eq(pluralCategory('fr', 0), 'one', 'fr: 0 is singular');
eq(pluralCategory('fr', 1), 'one', 'fr: 1 is singular');
eq(pluralCategory('fr', 2), 'other', 'fr: 2 is plural');
/* Chinese, Japanese: one noun form, always. */
for (const lang of ['zh', 'ja']) {
  for (const n of [0, 1, 2, 11]) {
    eq(pluralCategory(lang, n), 'other', `${lang}: ${n} uses the single form`);
  }
}

/* ---- 5. resolution order and interpolation ---- */
setLanguage('en');
eq(t('nav.dashboard'), 'Dashboard', 'English resolves from the English table');
eq(t('settings.budgetsKept', { count: 1 }).includes('file stays'), true, 'singular form at count 1');
eq(t('settings.budgetsKept', { count: 3 }).includes('files stay'), true, 'plural form at count 3');
eq(t('settings.budgetsKept', { count: 3 }).includes('your 3 existing'), true, '{count} interpolated');
eq(t('settings.dateNotReal', { value: '2026-13-45' }).includes('"2026-13-45"'), true, '{value} interpolated');
eq(t('settings.dateNotReal'), en['settings.dateNotReal'], 'no params leaves the placeholder standing');
eq(t('nope.not.a.key'), 'nope.not.a.key', 'an unknown key returns itself — visible and greppable, never blank');

setLanguage('af');
eq(t('nav.dashboard'), 'Paneelbord', 'Afrikaans resolves from the Afrikaans table');
eq(t('settings.budgetsKept', { count: 1 }).includes('begrotingslêer bly'), true, 'af singular form');
eq(t('settings.budgetsKept', { count: 4 }).includes('begrotingslêers bly'), true, 'af plural form');

/* Fallback: a key present in English but absent from the active table. Injected
   rather than relying on af being incomplete — invariant 1 guarantees it isn't. */
TABLES.en['test.only.english'] = 'Only in English';
eq(t('test.only.english'), 'Only in English', 'a key missing from the active language falls back to English');
delete TABLES.en['test.only.english'];

eq(resolveLanguage('AF'), 'af', 'a stored value is case-insensitive');
eq(resolveLanguage('  af '), 'af', 'a stored value is trimmed');
eq(resolveLanguage('klingon'), 'en', 'an unknown hand-edited language falls back to English, never throws');
eq(resolveLanguage(''), 'en', 'a blank language falls back to English');
eq(resolveLanguage(undefined), 'en', 'a missing language falls back to English');

/* ---- 5b. applyDom writes text and attributes, against a tiny fake ---- */
setLanguage('af');
const node = (attrs, kids) => ({
  attrs: { ...attrs }, kids: kids || [], textContent: '',
  getAttribute(a) { return this.attrs[a]; },
  setAttribute(a, v) { this.attrs[a] = v; },
});
const label = node({ 'data-i18n': 'nav.dashboard' });
const aria = node({ 'data-i18n-aria': 'nav.close', 'aria-label': 'Close menu' });
const all = [label, aria];
applyDom({
  querySelectorAll(sel) {
    const attr = sel.slice(1, -1);
    return all.filter(n => attr in n.attrs);
  },
});
eq(label.textContent, 'Paneelbord', 'applyDom writes textContent for data-i18n');
eq(aria.attrs['aria-label'], 'Maak kieslys toe', 'applyDom writes aria-label for data-i18n-aria');

/* applyDom must be RE-RUNNABLE over the same nodes. The shell is translated
   once at mount, so changing the language can only take effect on an open view
   if the pass can be run again — which requires it to READ data-i18n rather
   than consume it. This shipped broken in 1.8.0: the setting was written and
   the language moved, but an open budget view kept the language it was mounted
   in until it was closed and reopened. */
const fakeRoot = {
  querySelectorAll(sel) {
    const attr = sel.slice(1, -1);
    return all.filter(n => attr in n.attrs);
  },
};
setLanguage('de');
applyDom(fakeRoot);
eq(label.textContent, 'Übersicht', 'a second applyDom re-translates an already-translated node');
eq(aria.attrs['aria-label'], 'Menü schließen', 'and re-writes the attribute too');
setLanguage('en');
applyDom(fakeRoot);
eq(label.textContent, 'Dashboard', 'and back again — the pass is idempotent per language');
setLanguage('en');

/* Read once here — invariants 6 and 8 both analyse these files. */
const settingsTab = fs.readFileSync(path.join(SRC, 'settings-tab.js'), 'utf8');
const onboarding = fs.readFileSync(path.join(SRC, 'onboarding.js'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(SRC, 'i18n.js'), 'utf8');


/* ---- 6. every key used in src/ actually exists ---- */
const srcFiles = [];
for (const d of [SRC, path.join(SRC, 'views')]) {
  for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) srcFiles.push(path.join(d, f));
}
const used = new Map();                       // key -> where it was seen
for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(path.join(SRC, '..'), file);
  // data-i18n / data-i18n-aria / data-i18n-title / data-i18n-placeholder
  for (const m of text.matchAll(/data-i18n(?:-(?:aria|title|placeholder))?="([^"]+)"/g)) {
    used.set(m[1], rel);
  }
  // i18n.t('key') — the namespace form this codebase uses, because a bare `t`
  // would be shadowed by the 22 `.addText(t => …)` params already in src/.
  for (const m of text.matchAll(/\bi18n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    used.set(m[1], rel);
  }
  /* i18n.t(cond ? 'a' : 'b') — the form the manual-mode empty states use, and
     the one the pattern above CANNOT see, because the first thing after the
     open bracket is a condition rather than a quote. Three real keys were
     invisible to this check that way (dash.trend.empty.manual,
     score.empty.body.manual, wiz.finish.nextBody.manual): a typo in any of
     them would have rendered the raw key at the user with the whole suite
     green, which is precisely the failure invariant 6 exists to prevent.

     Deliberately narrow: one ternary, two string literals, one line, and a
     condition that is either paren-free and comma-free (which still allows
     `S.settings.input_mode === 'manual'`, quotes and all) or a single no-arg
     method call (`this.isManual()`). Both shapes are bounded so the scan
     cannot run past the closing bracket of the i18n.t() call and pair up with
     an unrelated ternary further along the same line — an earlier, looser
     version did exactly that and reported three CSS class names as missing
     translation keys. A general expression parser here would be a second
     language implementation to maintain; anything more complicated than these
     two shapes should be hoisted to a named constant in src/ and picked up by
     the plain form above. */
  for (const m of text.matchAll(
    /\bi18n\.t\(\s*(?:[^(),\n]*|this\.\w+\(\))\s*\?\s*'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
    used.set(m[1], rel);
    used.set(m[2], rel);
  }
}
ok(used.size >= 25, `expected the shell + settings tab to use at least 25 keys, found ${used.size}`);

/* A key built by concatenation — i18n.t('wiz.type.' + type) — extracts as the
   literal PREFIX ending in a dot. Those cannot be checked as whole keys, so
   they are checked two ways instead, which together are stronger than the
   static check would have been: the prefix must have entries behind it, and
   every value of the enumeration that drives it must have its own key. */
const prefixes = [...used.keys()].filter(k => k.endsWith('.'));
const wholeKeys = [...used.entries()].filter(([k]) => !k.endsWith('.'));

const unknown = wholeKeys.filter(([k]) => !(k in en));
eq(unknown.map(([k, where]) => `${k} (${where})`), [],
  'keys used in src/ with no entry in lang/en.js — they would render as the raw key');

for (const p of prefixes) {
  ok(enKeys.some(k => k.startsWith(p)),
    `src/ builds keys as '${p}<something>' but lang/en.js has nothing under that prefix`);
}

/* The enumerations behind those dynamic keys, each read from the code that
   actually drives them — so adding a category type or account type without a
   label fails the build rather than rendering the raw key at the user. */
const { TYPE_ORDER } = require(path.join(SRC, 'constants.js'));
for (const type of TYPE_ORDER) {
  ok(('wiz.type.' + type) in en,
    `TYPE_ORDER has '${type}' but lang/en.js has no 'wiz.type.${type}' — the category step would show the raw key`);
}

const acctKeys = (onboarding.match(/const ACCOUNT_TYPE_KEYS = \[([^\]]*)\]/) || [])[1] || '';
const acctList = [...acctKeys.matchAll(/'([^']+)'/g)].map(m => m[1]);
ok(acctList.length >= 4, `ACCOUNT_TYPE_KEYS parsed (${acctList.length} types)`);
for (const k of acctList) {
  ok(('acctType.' + k) in en, `ACCOUNT_TYPE_KEYS has '${k}' but lang/en.js has no 'acctType.${k}'`);
}

/* Only the strings inside the ARRAY literals steps() returns — a loose scan
   over the whole method also picks up the `this.mode === 'connect'` test and
   asks for a 'wiz.step.connect' that should not exist.

   [a-zA-Z], not [a-z]: 'firstBudget' is camelCase and a lower-case-only
   pattern skipped it silently, which is the worst possible outcome for a
   check like this — it kept passing while the one step whose title was most
   likely to be forgotten went unexamined. */
const stepsBody = (onboarding.match(/steps\(\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
const stepList = [...new Set(
  [...stepsBody.matchAll(/\[([^\]]*)\]/g)]
    .flatMap(arr => [...arr[1].matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1])))];
ok(stepList.length >= 6, `steps() parsed (${stepList.length} step names)`);
ok(stepList.includes('firstBudget'),
  'the manual path\'s first-budget step must be visible to this scan — see the camelCase note above');
for (const step of stepList) {
  // 'welcome' is the one step with no title — it is not numbered either.
  if (step === 'welcome') continue;
  ok(('wiz.step.' + step) in en, `steps() has '${step}' but lang/en.js has no 'wiz.step.${step}'`);
}

/* The reverse is NOT an error: lang/en.js deliberately runs ahead of the
   conversion, holding translated strings for surfaces not yet wired up. Report
   the count so the backlog stays visible rather than silently growing. */
const unused = enKeys.filter(k => !used.has(k));

/* ---- 7. the dropdown can only offer a real language ---- */
for (const id of LANGUAGE_ORDER) {
  ok(!!TABLES[id], `LANGUAGE_ORDER offers '${id}' but there is no lang/${id}.js behind it`);
  ok(!!LANGUAGE_NAMES[id], `LANGUAGE_ORDER offers '${id}' but LANGUAGE_NAMES has no native name for it`);
}
eq(LANGUAGE_ORDER[0], 'en', 'English stays first — it is the pre-language default');
for (const id of Object.keys(TABLES)) {
  ok(LANGUAGE_ORDER.includes(id), `lang/${id}.js ships but LANGUAGE_ORDER never offers it — unreachable`);
}

/* ---- 8. every surface that OFFERS the language also APPLIES it ---- */
/* A picker that stores the choice without calling setLanguage() looks correct
   in review and in the file it writes, and renders the following screen in the
   previous language. It is invisible today only because the wizard's own copy
   is still English — which is exactly why it needs pinning now rather than
   after that copy is translated. */
for (const [label, text] of [['settings-tab.js', settingsTab], ['onboarding.js', onboarding]]) {
  ok(/setLanguage\(/.test(text), `${label} offers the language picker but never applies it via setLanguage()`);
}
/* The wizard specifically: applied on open and after adopting an existing
   vault's Settings.md, not only in the dropdown's onChange. */
ok(/onOpen\(\)\s*\{[\s\S]{0,600}?setLanguage\(/.test(onboarding),
  'the wizard must apply the language in onOpen(), before its first render');
/* Scoped to the METHOD BODY rather than to "somewhere in the next 2000
   characters". The proximity form failed the moment the method grew a longer
   comment, which is a false alarm dressed as a regression — and it would
   equally have passed on a setLanguage() call that belonged to the method
   AFTER this one. Same `\n  }` method-end anchor the steps() scan uses. */
const prefillBody = (onboarding.match(/async prefillFromSettingsMd\(\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
ok(prefillBody.length > 200, 'prefillFromSettingsMd() is still parseable as one method');
ok(/setLanguage\(/.test(prefillBody),
  'the wizard must apply the language it adopts from an existing Settings.md');
/* And the wizard must persist it on BOTH paths — create writes the file
   itself, connect goes through updateBudgetSettingsMd. */
ok(/language:\s*\$\{/.test(onboarding),
  'the create path must write `language:` into the Settings.md it generates');
ok(/updateBudgetSettingsMd\('language'/.test(onboarding),
  'the connect path must write `language` through updateBudgetSettingsMd');

/* A language change must reach views that are ALREADY OPEN. The shell is
   translated at mount, and reloadViews() re-reads the vault without
   re-mounting — so writing the setting is not enough on its own. Both halves
   of the settings tab have to push the new language into open views, the same
   way applyTheme and applyPrivacyLock do. */
const controller = fs.readFileSync(path.join(SRC, 'controller.js'), 'utf8');
/* Both halves, because the interface is built two ways: the shell is static
   markup applyDom() re-translates in place, and the view bodies are rebuilt by
   render(). Missing either one leaves half the screen in the old language. */
const applyLang = (controller.match(/applyLanguage:[^\n]*\n?[^\n]*/) || [''])[0];
ok(/applyLanguage:/.test(controller),
  'controller must expose applyLanguage() so an open view can be re-translated in place');
ok(/applyDom\(root\)/.test(applyLang),
  'applyLanguage() must re-run applyDom — otherwise the shell keeps its mounted language');
ok(/render\(\)/.test(applyLang),
  'applyLanguage() must re-run render() — otherwise the view bodies keep their old strings');
eq(settingsTab.split('ctl.applyLanguage()').length - 1, 2,
  'BOTH settings paths (display() dropdown and setControlValue) must re-translate open views — ' +
  'miss one and users on that side of the 1.13 line see nothing change');

/* i18n.js itself must seed from Obsidian rather than hardcoding English, or
   the first run renders in English no matter what Obsidian is set to. */

ok(/let current = defaultLanguage\(\)/.test(i18nSrc),
  'the active language must be seeded from defaultLanguage(), not hardcoded');

/* ---- 9. TRANSLATED_VIEWS is the inventory, and the definition of "done" ----
   The i18n migration is 4 views of 14, and until now nothing distinguished
   "this view is translated" from "this view is next" — a contributor adding a
   string to views/tax.js has no signal that hardcoding English there is fine
   while doing it in views/accounts.js is a regression. This list is that
   signal. Moving a view INTO the set is the definition of translating it.

   Two directions, both pinned:
   - a view in the set must stay substantially translated (a floor on its
     i18n usage count — gutting the calls is a loud failure, and detecting
     individual new English literals by regex would drown in false positives
     from class names and data attributes);
   - a view NOT in the set that grows real i18n usage must be promoted, so
     the inventory cannot silently rot as views migrate. */
{
  const TRANSLATED_VIEWS = new Set(['accounts.js', 'dashboard.js', 'budgets.js', 'transactions.js', 'score.js']);
  const VIEWS = path.join(SRC, 'views');
  const usage = f => {
    const text = fs.readFileSync(path.join(VIEWS, f), 'utf8');
    return (text.match(/\bi18n\.t\(/g) || []).length +
           (text.match(/data-i18n(?:-(?:aria|title|placeholder))?="/g) || []).length;
  };
  for (const f of fs.readdirSync(VIEWS).filter(f => f.endsWith('.js'))) {
    const n = usage(f);
    if (TRANSLATED_VIEWS.has(f)) {
      ok(n >= 30,
        `views/${f} is in TRANSLATED_VIEWS but carries only ${n} i18n uses — translated views must stay translated`);
    } else {
      ok(n < 10,
        `views/${f} now carries ${n} i18n uses — promote it into TRANSLATED_VIEWS so "done" stays defined`);
    }
  }
}

console.log(
  `PASS — i18n: ${Object.keys(TABLES).length} languages x ${enKeys.length} keys, ` +
  `${used.size} wired up, ${unused.length} staged for the next surface (${checks} checks).`);
