'use strict';
/* THE PLUGIN SAYS WHICH LANGUAGE IT IS WRITTEN IN — `lang`, EVERYWHERE IT DRAWS.

   The interface language is this plugin's own setting, independent of
   Obsidian's (src/i18n.js): an English Obsidian with the budget in isiZulu is
   an ordinary household. A screen reader chooses its voice from the nearest
   `lang` up the tree, and until November 2026 the nearest one was Obsidian's,
   on <html> — so a French or Zulu budget was read aloud by the host's voice,
   every word mispronounced (audit of 11 Nov 2026, task 19). The words were
   translated; nothing told the engine what they were.

   Four things have to hold for that to stay fixed, and each is a way it would
   quietly come back:

     1. every table has a tag, and the tag is real. A table added without one
        still gets its code as a fallback, which is a valid tag for all twelve
        today and would not be for a table whose SCRIPT matters (zh is
        `zh-Hans` for that reason). Well-formed BCP 47, canonical, and the
        same language as the table.
     2. no table is right-to-left. i18n.js says `dir` is deliberately absent
        because nothing shipped needs it; that is a claim about the tables,
        so it is checked against them. An Arabic or Hebrew table fails here
        until `dir` is set beside `lang`.
     3. the attribute FOLLOWS the language. Settings.md is read after the root
        is built, the settings tab and the wizard change the language while
        they are open, and a book switch can change it again — so a root
        stamped once is right at mount and wrong from then on. Everything that
        changes the language goes through setLanguage(), which re-stamps.
     4. every surface is covered. The view's root is the obvious one; a modal,
        the setup wizard and the settings tab are mounted by Obsidian OUTSIDE
        that root and inherit <html>'s `lang`, not ours. A new dialog that
        forgets is the likeliest regression, so the source is read for it:
        every class that extends Modal follows its modalEl in onOpen.

   mountApp() cannot be built in bare node (it needs a DOMParser shell — see
   tests/controller-destroy-clears-timers.test.cjs), so 3 is proven on the real
   i18n module against small fake elements and 4 is read from the source with
   the TypeScript parser, the way tests/ios-floor.test.cjs reads it: a comment
   that mentions followLanguage is not a call to it.

     node tests/i18n-lang-attribute.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let ts;
try {
  ts = require('typescript');
} catch (e) {
  console.error('FAIL tests/i18n-lang-attribute.test.cjs — the dev dependencies are not installed. Run `npm ci`.');
  process.exit(1);
}

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const i18n = require(path.join(SRC, 'i18n.js'));
const { TABLES, LANGUAGE_TAGS, languageTag, followLanguage, unfollowLanguage, setLanguage } = i18n;
const K = ts.SyntaxKind;

/* ---- 1. every table has a real tag ---- */
eq(Object.keys(LANGUAGE_TAGS).sort(), Object.keys(TABLES).sort(),
  'LANGUAGE_TAGS names exactly the tables that ship — a table with no tag is read in a guessed voice, a tag with no table is dead');
/* language[-Script][-REGION], which is every shape a table here could need. */
const BCP47 = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/;
for (const [code, tag] of Object.entries(LANGUAGE_TAGS)) {
  ok(BCP47.test(tag), `LANGUAGE_TAGS.${code} = "${tag}" is not a well-formed BCP 47 tag`);
  eq(Intl.getCanonicalLocales(tag), [tag], `"${tag}" is already in its canonical form — what the engine would normalise it to`);
  eq(tag.split('-')[0], code, `the tag for lang/${code}.js is a tag for ${code}, not for another language`);
  eq(languageTag(code), tag, `languageTag('${code}') answers from the table`);
}
/* The script subtag is there because the script is not implied — and only there. */
eq(Object.entries(LANGUAGE_TAGS).filter(([, tag]) => tag.includes('-')).map(([code]) => code), ['zh'],
  'Chinese alone carries more than a language subtag: lang/zh.js is Simplified, which a bare `zh` leaves to a guess');
ok(/Simplified/.test(fs.readFileSync(path.join(SRC, 'lang', 'zh.js'), 'utf8').slice(0, 400)),
  'and lang/zh.js still says it is Simplified — if that changes, so must the tag');
eq(languageTag('klingon'), 'en', 'an unknown code resolves to English, as resolveLanguage does — never to an invented tag');

/* ---- 2. nothing shipped is right-to-left ---- */
/* Asked of the engine's own data rather than a hand-kept list of languages:
   the likely script of each tag, against the scripts that run right to left. */
const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Syrc', 'Thaa', 'Nkoo', 'Adlm', 'Rohg', 'Samr', 'Mand', 'Yezi']);
for (const [code, tag] of Object.entries(LANGUAGE_TAGS)) {
  const script = new Intl.Locale(tag).maximize().script;
  ok(script && !RTL_SCRIPTS.has(script),
    `lang/${code}.js is written in ${script}, which runs right to left — set dir="rtl" beside lang in i18n.js followLanguage(), `
    + 'and review the stylesheet\'s physical left/right properties, before shipping it');
}
/* The control: the same question, asked of languages that ARE. */
for (const tag of ['ar', 'he', 'ur', 'fa']) {
  ok(RTL_SCRIPTS.has(new Intl.Locale(tag).maximize().script), `the check above would catch ${tag}`);
}

/* ---- 3. the attribute follows the language ---- */
const fake = (connected) => ({
  attrs: {},
  ...(connected === undefined ? {} : { isConnected: connected }),
  setAttribute(k, v) { this.attrs[k] = String(v); },
  removeAttribute(k) { delete this.attrs[k]; },
});
setLanguage('en');
const root = fake(true);
followLanguage(root);
eq(root.attrs.lang, 'en', 'following an element stamps the active language at once');
setLanguage('fr');
eq(root.attrs.lang, 'fr', 'and every later setLanguage() re-stamps it — no caller has to remember to');
setLanguage('zh');
eq(root.attrs.lang, 'zh-Hans', 'with the TAG, not the table code');
setLanguage('ZU ');
eq(root.attrs.lang, 'zu', 'a hand-edited value is resolved before it is stamped');
setLanguage('klingon');
eq(root.attrs.lang, 'en', 'and an unknown one falls back to English with the text it falls back to');

/* Two surfaces at once — the view and a dialog over it. */
const modal = fake(true);
setLanguage('de');
followLanguage(modal);
eq([root.attrs.lang, modal.attrs.lang], ['de', 'de'], 'a dialog opened later starts in the current language');
setLanguage('ja');
eq([root.attrs.lang, modal.attrs.lang], ['ja', 'ja'], 'and both follow the next change');

/* A closed dialog is never told it closed. It is dropped the first time the
   language moves after it left the document, not kept alive and re-stamped. */
modal.isConnected = false;
setLanguage('pt');
eq([root.attrs.lang, modal.attrs.lang], ['pt', 'ja'], 'an element that has left the document is not stamped again');
modal.isConnected = true;
setLanguage('es');
eq(modal.attrs.lang, 'ja', 'and was dropped for good — re-attaching it does not bring it back unasked');
followLanguage(modal);
eq(modal.attrs.lang, 'es', 'following it again does');

/* And it does not take a change of language to let go of one: the language can
   go a whole session unchanged while confirm and field dialogs open and close
   by the dozen. Opening the next dialog drops the ones already closed. */
{
  const first = fake(true), second = fake(true);
  followLanguage(first);
  first.isConnected = false;                 // closed; nothing tells i18n
  followLanguage(second);                    // the next dialog opens
  first.isConnected = true;                  // only so that a stamp would show
  const before = first.attrs.lang;
  setLanguage('id');
  eq(second.attrs.lang, 'id', 'the open dialog follows the change');
  eq(first.attrs.lang, before, 'and the closed one was let go when the next was opened, not kept until the language moved');
  second.isConnected = false;
}

/* The bare-node fakes the rest of the suite uses have no isConnected at all. */
const plain = fake();
followLanguage(plain);
setLanguage('af');
eq(plain.attrs.lang, 'af', 'an element with no isConnected is treated as attached, so a stub is never silently dropped');

/* Following twice is one follow: the settings tab's display() runs on every re-open. */
let writes = 0;
const counted = { isConnected: true, setAttribute() { writes++; }, removeAttribute() {} };
followLanguage(counted); followLanguage(counted); followLanguage(counted);
writes = 0;
setLanguage('hi');
eq(writes, 1, 'an element followed three times is stamped once per change');

/* Letting go: the view's contentEl is Obsidian's, and outlives the view. */
unfollowLanguage(root);
eq('lang' in root.attrs, false, 'unfollowLanguage() removes the attribute it added');
setLanguage('xh');
eq('lang' in root.attrs, false, 'and the element is no longer stamped — the next view in that leaf is not this plugin\'s');

/* Nothing to stamp is not an error: a host, or a test's stub of one, that built no modalEl. */
assert.doesNotThrow(() => { followLanguage(undefined); followLanguage(null); followLanguage({}); unfollowLanguage(undefined); });
checks++;
setLanguage('en');

/* ---- 4. every surface is covered — read from the source ---- */
const parse = rel => {
  const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  ok(!(sf.parseDiagnostics && sf.parseDiagnostics.length), `src/${rel} parses`);
  return sf;
};
/* Every call `<anything>.<name>(<arg>)` or `<name>(<arg>)` under `node`, as the text of its first argument. */
const callsTo = (node, name) => {
  const out = [];
  const walk = n => {
    if (n.kind === K.CallExpression) {
      const c = n.expression;
      const called = c.kind === K.Identifier ? c.text : c.kind === K.PropertyAccessExpression ? c.name.text : null;
      if (called === name && n.arguments[0]) out.push(n.arguments[0].getText());
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return out;
};
const methodOf = (cls, name) => cls.members.find(m => m.kind === K.MethodDeclaration && m.name && m.name.getText() === name);
const classesExtending = (sf, base) => {
  const out = [];
  const walk = n => {
    if (n.kind === K.ClassDeclaration && (n.heritageClauses || []).some(h => h.types.some(t => t.expression.getText() === base))) out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
};

/* Every dialog. Found by walking src/ rather than listed, so a new one is
   held to this the day it is written. */
const dialogs = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'lang') walk(p); continue; }
    if (!e.name.endsWith('.js')) continue;
    const rel = path.relative(SRC, p).split(path.sep).join('/');
    if (!/extends\s+Modal\b/.test(fs.readFileSync(p, 'utf8'))) continue;
    for (const cls of classesExtending(parse(rel), 'Modal')) dialogs.push({ rel, cls });
  }
}(SRC));
ok(dialogs.length >= 11, `the scan found the plugin's dialogs (${dialogs.length} classes extend Modal)`);
for (const { rel, cls } of dialogs) {
  const name = cls.name.text;
  const onOpen = methodOf(cls, 'onOpen');
  ok(onOpen, `${name} (src/${rel}) has an onOpen()`);
  ok(callsTo(onOpen, 'followLanguage').includes('this.modalEl'),
    `${name} (src/${rel}) is mounted on <body>, outside the plugin root, so its onOpen() must call `
    + 'i18n.followLanguage(this.modalEl) — without it the dialog is read in Obsidian\'s language, not the budget\'s');
}
/* The control: the walk can tell a dialog that does from one that does not. */
{
  const sf = ts.createSourceFile('control.js',
    'class A extends Modal { onOpen() { i18n.followLanguage(this.modalEl); } }\n'
    + 'class B extends Modal { onOpen() { /* i18n.followLanguage(this.modalEl) */ this.titleEl.setText("x"); } }\n'
    + 'class C extends Modal { onOpen() { i18n.followLanguage(this.contentEl); } }\n'
    + 'class D extends Other { onOpen() {} }',
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  eq(classesExtending(sf, 'Modal').map(c => [c.name.text, callsTo(methodOf(c, 'onOpen'), 'followLanguage').includes('this.modalEl')]),
    [['A', true], ['B', false], ['C', false]],
    'a call in a comment, or on another element, is not a call on the dialog — and a class that is not a Modal is not asked');
}

/* The settings tab: Obsidian's pane, the plugin's words. */
{
  const tabs = classesExtending(parse('settings-tab.js'), 'PluginSettingTab');
  eq(tabs.length, 1, 'one settings tab');
  ok(callsTo(methodOf(tabs[0], 'display'), 'followLanguage').includes('containerEl'),
    'the settings tab\'s display() follows its own containerEl — its language dropdown changes the language while it is open');
}

/* The view root: followed where it is built, let go where the view closes. */
{
  const ctl = parse('controller.js');
  let mountApp = null;
  ts.forEachChild(ctl, n => { if (n.kind === K.FunctionDeclaration && n.name && n.name.text === 'mountApp') mountApp = n; });
  ok(mountApp, 'controller.js still declares mountApp()');
  ok(callsTo(mountApp, 'followLanguage').includes('root'),
    'mountApp() follows the plugin root — the one element every view body is drawn inside');

  const views = classesExtending(parse('view.js'), 'ItemView');
  eq(views.length, 1, 'one view class');
  ok(callsTo(methodOf(views[0], 'onClose'), 'unfollowLanguage').includes('this.contentEl'),
    'BudgetView.onClose() lets go of contentEl — Obsidian hands that element to the next view in the leaf');
}

/* And the one place the attribute is written again is setLanguage() itself. */
{
  const sf = parse('i18n.js');
  let fn = null;
  ts.forEachChild(sf, n => { if (n.kind === K.FunctionDeclaration && n.name && n.name.text === 'setLanguage') fn = n; });
  ok(fn && /restampLanguage\(\)/.test(fn.getText()),
    'setLanguage() re-stamps every followed element — load.js, the settings tab and the wizard all change the language through it');
}

console.log(`PASS i18n-lang-attribute — ${Object.keys(LANGUAGE_TAGS).length} tables tagged (none right-to-left), `
  + `the attribute follows setLanguage(), and ${dialogs.length} dialogs + the settings tab + the view root carry it (${checks} checks)`);
