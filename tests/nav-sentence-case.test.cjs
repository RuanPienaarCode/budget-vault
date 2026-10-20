'use strict';
/* PAGE NAMES ARE SENTENCE CASE, AND THE SHELL'S FALLBACK TEXT IS THE ENGLISH STRING
   (2026-10-20 audit, D1-09 / D2-20).

   The 1.51.0 type pass set every label in sentence case. Three page names kept
   Title Case in the drawer and as their page's <h1>: "Savings & Investments",
   "Owed Money", "Loan Calculators", while the Dashboard's own tile beside the
   first already said "Savings & investments". Each page name is a nav.* key,
   so the rule is checked on all of them: after the first word, a word is
   lowercase unless it is an acronym ("Import CSV").

   The shell (src/shell.js) prints a fallback text inside every data-i18n
   element, which is what a reader sees before i18n.applyDom() runs and what a
   key missing from a language falls back to. Three of them had drifted from
   en.js: "Spending Trend" (en: "Spending trend"), "Budget" for the chart's
   budget line (en: "Spending budget"), "Budget vs Actual" (en: "Budget vs
   actual"). For the keys this lane owns (nav.*, shell.*, topbar.*), the
   fallback must BE the English string.

     node tests/nav-sentence-case.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const enMod = require('../src/lang/en.js');
const EN = enMod.default || enMod;
let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

/* ---- 1. page names ---- */
const navKeys = Object.keys(EN).filter(k => k.startsWith('nav.'));
ok(navKeys.length >= 20, `sanity: en.js carries the nav.* keys, found ${navKeys.length}`);
const titleCased = s => String(s).split(/\s+/).slice(1).filter(w => /^[A-Z][a-z]/.test(w));
for (const k of navKeys) {
  const bad = titleCased(EN[k]);
  ok(!bad.length, `${k}: "${EN[k]}" is Title Case (${bad.join(', ')}); page names are sentence case`);
}
for (const [k, want] of [['nav.savings', 'Savings & investments'], ['nav.owed', 'Owed money'], ['nav.loans', 'Loan calculators']]) {
  ok(EN[k] === want, `${k} reads "${want}", found "${EN[k]}"`);
}

/* ---- 2. the shell's fallback text is the English string ---- */
const shell = fs.readFileSync(path.join(__dirname, '..', 'src', 'shell.js'), 'utf8');
const decode = t => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
let seen = 0;
for (const m of shell.matchAll(/<(\w+)[^>]*?\sdata-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
  const key = m[2];
  if (!/^(nav|shell|topbar)\./.test(key)) continue;
  seen++;
  ok(Object.prototype.hasOwnProperty.call(EN, key), `shell.js uses ${key}, which en.js does not define`);
  const fallback = decode(m[3]).trim().replace(/\s+/g, ' ');
  ok(fallback === String(EN[key]).trim(), `shell.js fallback for ${key} is "${fallback}", en.js says "${EN[key]}"`);
}
ok(seen >= 40, `sanity: the shell's nav/shell/topbar labels are read, found ${seen}`);

if (failures.length) { console.error(`FAIL — nav-sentence-case: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
assert.ok(true);
console.log(`PASS — nav-sentence-case: ${navKeys.length} page names in sentence case, ${seen} shell fallbacks equal to en.js (${checks} checks).`);
