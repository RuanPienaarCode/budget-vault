'use strict';
/* The Assets page's Kind labels are sentence case, the word in the file is not
   touched, and the page's dead formatter fallback is gone (2026-10-20 audit,
   D1-08 / D2-26).

   D1-08  The Kind select printed its stored words as they are stored —
          "vehicle", "precious metals", "household contents" — beside a page
          (and an app) whose every other label is sentence case. Displayed as
          "Vehicle", "Precious metals"; the option VALUE stays the stored word,
          so a save writes exactly what the file said. A kind a reader typed by
          hand keeps its own option, labelled the same way. The New asset
          dialog's Kind list follows suit.
   D2-26  `typeof ctx.moneyIn === 'function' ? … : \`${sym} ${Math.round(v)}\``
          was a hand-written second money formatter for a case that cannot
          happen: controller.js puts moneyIn on ctx before any view registers
          (and the test harness does the same), so the fallback never ran — and
          if it ever had, it would have printed "R 1234567" with no grouping.

   The REAL Assets view over the real loader; every figure made up.

     node tests/assets-kind-labels.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

/* The New asset dialog, captured rather than opened: assets.js takes askFields
   off the modal module when it is first required, so it is swapped in before
   that view loads (below). */
let lastFields = null;

let checks = 0;
const soft = process.env.SOFT === '1';
const failed = [];
const guard = fn => (...a) => { try { fn(...a); } catch (e) { if (!soft) throw e; failed.push(e.message); } checks++; };
const ok = guard((c, m) => assert.ok(c, m));
const eq = guard((a, b, m) => assert.deepStrictEqual(a, b, m));

const B = 'Budget';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n'
    + '| Coins | precious metals | 15000.20 | 2026-06-01 |  |\n'
    + '| Dinghy | boat | 8000.00 | 2026-06-01 |  |\n',
};

(async () => {
  const ctx = makeCtx({ ...FILES });
  const S = await loadInto(ctx);
  S.period = '2026-10';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/modal').askFields = async (app, title, fields) => { lastFields = fields; return null; };
  require('../src/views/assets')(ctx);
  ctx.renderAssets();

  const selects = descend(ctx.$('#assetTable')).filter(n => n.tagName === 'SELECT');
  eq(selects.length, 2, 'one Kind select per row');
  const opts = s => descend(s).filter(n => n.tagName === 'OPTION')
    .map(o => ({ value: o.getAttribute('value'), label: String(o.textContent), selected: o.getAttribute('selected') !== null && o.getAttribute('selected') !== undefined }));

  const coins = opts(selects[0]);
  ok(coins.some(o => o.value === 'precious metals' && o.label === 'Precious metals'),
    `"precious metals" reads "Precious metals" (got ${JSON.stringify(coins.map(o => o.label))})`);
  ok(coins.some(o => o.value === 'household contents' && o.label === 'Household contents'), 'every preset kind is sentence case');
  ok(coins.every(o => !/^[a-z]/.test(o.label)), 'no kind label starts lower case');
  ok(coins.every(o => o.value === o.value.toLowerCase()), 'while every option VALUE stays the stored word');

  const dinghy = opts(selects[1]);
  ok(dinghy.some(o => o.value === 'boat' && o.label === 'Boat'), `a hand-typed kind keeps its own option, labelled the same way (got ${JSON.stringify(dinghy)})`);

  /* The file is unchanged by the labels: the stored words go back out. */
  const out = ctx.serializeAssets();
  ok(/\| precious metals \|/.test(out) && /\| boat \|/.test(out), 'a save writes the stored words, not the labels');
  ok(!/Precious metals|\| Boat \|/.test(out), 'and never the display labels');

  /* The New asset dialog's Kind list. */
  await ctx.addAsset();
  const kind = (lastFields || []).find(f => f.key === 'type');
  ok(kind && kind.options.every(o => typeof o === 'object' && o.label === o.value.charAt(0).toUpperCase() + o.value.slice(1)),
    `the dialog labels each kind in sentence case (got ${JSON.stringify(kind && kind.options)})`);
  ok(kind && kind.options.some(o => o.value === 'precious metals'), 'and keeps the stored word as its value');

  /* D2-26: no second, hand-rolled money formatter on this page. */
  const src = fs.readFileSync(path.join(__dirname, '../src/views/assets.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/typeof ctx\.moneyIn/.test(src), 'no `typeof ctx.moneyIn` guard: moneyIn is on ctx before any view registers');
  ok(!/Math\.round\(v\)/.test(src), 'and no ungrouped Math.round fallback behind it');

  if (failed.length) { console.error(failed.join('\n')); process.exit(1); }
  console.log(`PASS assets-kind-labels (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
