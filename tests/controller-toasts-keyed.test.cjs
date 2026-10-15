'use strict';
/* Every toast and Notice the shell controller raises goes through i18n
   (2026-10-14 audit, L8-09 shell half).

   controller.js said "Reloaded — files changed in the vault", "Loaded N
   transactions", the unsaved-changes Notice, both rename re-point toasts and
   "Could not save that setting" in English whatever language the household had
   chosen — in an app whose six main pages are translated, those are the words
   the reader sees after every reload and every rename. They are keyed now, with
   whole-sentence plurals where a count appears ("Loaded 1 transaction", never
   "Loaded 1 transactions").

   Two things pinned:
     1. no toast(...) / new Notice(...) in controller.js takes a string or
        template literal directly — it takes i18n.t(...);
     2. each key renders in every language with every placeholder its call site
        passes, and the plural keys pick the right form for 0, 1 and many.

     node tests/controller-toasts-keyed.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');

/* ---- 1. no literal reaches a toast or Notice ---- */
{
  const bare = [];
  src.split('\n').forEach((l, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
    for (const m of l.matchAll(/\b(?:toast|new Notice)\(\s*([`'"])/g)) bare.push(`controller.js:${i + 1} — ${l.trim().slice(0, 80)}`);
  });
  eq(bare, [], 'every toast()/Notice in controller.js is keyed (i18n.t), none carries an English literal');
}

/* ---- 2. each key, in every language, with its call site's placeholders ---- */
const CALLS = {
  'ctl.toast.loaded': { count: 7 },
  'ctl.toast.reloadedChanged': {},
  'ctl.toast.reloadedDisk': {},
  'ctl.toast.reloadFailed': { error: 'E_X' },
  'ctl.toast.repointed': { count: 3, from: 'AAA', to: 'BBB' },
  'ctl.toast.repointFailed': { from: 'AAA', to: 'BBB', error: 'E_X' },
  'ctl.notice.unsavedReloadSkipped': {},
  'ctl.toast.fileFailed': { name: 'NNN', error: 'E_X' },
  'ctl.toast.thatFile': {},
};
for (const key of Object.keys(CALLS)) ok(src.includes(`'${key}'`), `controller.js uses ${key}`);
for (const lang of ['en', 'af', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'pt', 'xh', 'zh', 'zu']) {
  i18n.setLanguage(lang);
  for (const [key, params] of Object.entries(CALLS)) {
    const out = i18n.t(key, params);
    ok(typeof out === 'string' && out && out !== key, `${lang}: ${key} resolves`);
    ok(!/[{}]/.test(out), `${lang}: ${key} leaves no placeholder unfilled — got: ${out}`);
    for (const [p, v] of Object.entries(params)) {
      if (p === 'count') continue;
      ok(out.includes(String(v)), `${lang}: ${key} carries {${p}} — got: ${out}`);
    }
  }
}

/* ---- 3. the singular reads as a singular ---- */
i18n.setLanguage('en');
eq(i18n.t('ctl.toast.loaded', { count: 1 }), 'Loaded 1 transaction', 'en: one transaction is singular');
eq(i18n.t('ctl.toast.loaded', { count: 12 }), 'Loaded 12 transactions', 'en: many are plural');
eq(i18n.t('ctl.toast.repointed', { count: 1, from: 'A', to: 'B' }), 'Re-pointed 1 note from "A" to "B"', 'en: one note is singular');
i18n.setLanguage('fr');
ok(!/transactions/.test(i18n.t('ctl.toast.loaded', { count: 0 })), 'fr: zero is singular ("0 transaction chargée")');
i18n.setLanguage('ja');
ok(/3/.test(i18n.t('ctl.toast.loaded', { count: 3 })), 'ja: the single form carries the count');
i18n.setLanguage('en');

console.log(`PASS controller-toasts-keyed — no English literal reaches a toast/Notice, 9 keys render in 12 languages with their placeholders (${checks} checks)`);
