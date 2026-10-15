'use strict';
/* The README describes the product that ships (2026-10-14 audit, L7-02).

   Three drifts the audit found, each of them a sentence that was true once:
     - the Debts.md section told a hand-writer to "keep all twelve" columns
       while src/table-schema.js declares thirteen (the thirteenth, Currency, is
       an optional tail);
     - the "What it does" list named nine screens of the sixteen and none of the
       twelve languages, the several-currency handling, or the PDF / Excel / CSV
       budget export;
     - Install described only the manual copy although the plugin is in the
       community store — the route nearly every reader should take.

   Derived from the code, not from a second list in the test: the column
   headers come from SCHEMAS.debts and the language count from i18n.

     node tests/readme-matches-the-product.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { SCHEMAS } = require('../src/table-schema');
const { LANGUAGE_ORDER } = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const section = (from, to) => {
  const a = readme.indexOf(from); const b = readme.indexOf(to, a + 1);
  ok(a >= 0 && b > a, `README still has "${from}" followed by "${to}"`);
  return readme.slice(a, b);
};

/* ---- Debts.md: the documented columns ARE the schema's, in order ---- */
{
  const debts = section('### Debts.md', '## CSV import');
  const rows = [...debts.matchAll(/^\| ([^|]+?) \|/gm)].map(m => m[1]).filter(h => h !== 'Column' && !/^-+$/.test(h));
  eq(rows, SCHEMAS.debts.columns.map(c => c.header),
    'the Debts.md table lists exactly the schema\'s columns, in the schema\'s order');
  ok(!/keep all twelve/i.test(debts), 'the stale "keep all twelve" is gone');
  const required = SCHEMAS.debts.columns.length - SCHEMAS.debts.optionalTail;
  ok(new RegExp(`first ${required === 12 ? 'twelve' : required}\\b`, 'i').test(debts),
    `it says the first ${required} are the positional ones`);
  ok(/optional/i.test(debts) && /Currency/.test(debts), 'and that the trailing Currency column is optional');
}

/* ---- the feature list ---- */
{
  const list = section('## What it does', '## Install');
  for (const w of ['Dashboard', 'Score', 'Transactions', 'Budget', 'Plan', 'CSV import', 'Report', 'Notes',
    'Accounts', 'assets', 'debt', 'owed money', 'services', 'tax', 'savings', 'loan']) {
    ok(new RegExp(w, 'i').test(list), `the feature list mentions ${w}`);
  }
  ok(/PDF/.test(list) && /Excel/.test(list) && /CSV/.test(list) && /export/i.test(list), 'it mentions the PDF / Excel / CSV budget export');
  ok(/currenc/i.test(list), 'it mentions several currencies');
  const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];
  ok(new RegExp(`${words[LANGUAGE_ORDER.length - 1]} languages`, 'i').test(list),
    `it names the real language count (${LANGUAGE_ORDER.length})`);
  ok(/iOS and Android/.test(list), 'it still names phone support');
}

/* ---- Install: the store first ---- */
{
  const install = section('## Install', '## Where your data lives');
  const store = install.search(/community plugins/i);
  const manual = install.search(/By hand|Copy `manifest\.json`/);
  ok(store >= 0 && manual > store, 'the community-store route is described before the manual copy');
  ok(/Budget Vault/.test(install.slice(store, manual)) && /Browse/.test(install.slice(store, manual)),
    'the store route says to Browse and search for Budget Vault');
}

console.log(`PASS readme-matches-the-product — Debts columns, feature list and install route match what ships (${checks} checks)`);
