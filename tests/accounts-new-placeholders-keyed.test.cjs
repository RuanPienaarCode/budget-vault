'use strict';
/* The "New account" form's two example placeholders are translated like the
   rest of the dialog (audit 2026-10-14, L8-09, the Accounts half).

   accounts.js is a translated view but its create dialog still passed two
   English literals ("e.g. Easy Equities TFSA", "e.g. Easy Equities") as input
   placeholders, so every other language saw English in the middle of a
   translated form. They are keys now, in all twelve language files.

     node tests/accounts-new-placeholders-keyed.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const view = fs.readFileSync(path.join(SRC, 'views', 'accounts.js'), 'utf8');
ok(!/placeholder:\s*'e\.g\./.test(view), 'accounts.js carries no English "e.g." placeholder literal');
for (const k of ['acct.new.namePlaceholder', 'acct.new.institutionPlaceholder']) {
  ok(view.includes(`i18n.t('${k}')`), `accounts.js asks i18n for ${k}`);
}

const langs = fs.readdirSync(path.join(SRC, 'lang')).filter(f => /^[a-z]{2}\.js$/.test(f));
ok(langs.length === 12, `twelve language files (got ${langs.length})`);
for (const f of langs) {
  const src = fs.readFileSync(path.join(SRC, 'lang', f), 'utf8');
  for (const k of ['acct.new.namePlaceholder', 'acct.new.institutionPlaceholder']) {
    ok(new RegExp(`'${k.replace(/\./g, '\\.')}':\\s*'[^']+'`).test(src), `${f} has ${k}`);
  }
}

console.log(`PASS accounts-new-placeholders-keyed (${checks} checks)`);
