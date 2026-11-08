'use strict';
/* Accounts-table column resizing is RETIRED — and stays retired.

   This file used to pin the feature: the reader dragged a column edge, the width
   was stored in plugin data (settings.acctColWidths) and re-applied on every
   render, and the table switched to a fixed layout (`is-sized`) once any column
   had one. It existed because eight columns fought over ~760px of an Obsidian
   pane and a reader could take width from one to give another.

   The list/inspector redesign took the table to four columns — name, balance
   (with the period's movement under it), status, notes — and moved everything
   that made the others wide into the inspector beside it. The name column takes
   whatever the balance, the status and the notes chip leave, so there is no width
   worth dragging, and a drag handle on a three-column list is a control that
   does nothing useful. The grips, the fixed-layout switch and the stored-width
   restore are deleted from views/accounts.js and src/styles.css.

   WHAT THIS PINS INSTEAD is the part that is easy to get half right when a
   feature is removed:

     1. NOTHING OF IT RENDERS. No header carries a data-col key or a grip, and
        the table never takes the fixed layout — not even for a vault that still
        carries a width written by an older build, which would otherwise be
        applied to a column that is no longer the one it was dragged on.
     2. THE STORED WIDTH IS LEFT ALONE. `settings.acctColWidths` is still in the
        plugin's defaults, so a data.json written by an older build loads
        unchanged and an older build reading this one's data.json finds the key
        it expects. Rendering neither reads it into the table nor writes it, and
        saveSettings is never called by a render — display state in plugin data
        was only ever written on a finished drag, and there is no drag now.
     3. THE HEADER STILL SORTS. Dropping the grips must not have taken the sort
        buttons with them: they live in the same cells.

   Runs in bare node against the real view. Wired into ./build.sh.
     node tests/accounts-col-widths.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ninstitution: "Bank A"\ntx_label: "Cheque"\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
};

/* A desktop-wide viewport, so nothing below can pass merely because the stub's
   default matchMedia (which reports no match for everything) reads as a phone. */
function viewport(wide) {
  const mm = () => ({ matches: wide, addEventListener() {}, removeEventListener() {} });
  global.matchMedia = mm;
  if (global.window) { global.window.matchMedia = mm; }
}

async function mount(settings) {
  const ctx = makeCtx(FILES, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  viewport(true);
  /* A save is recorded rather than stubbed away, so a render that starts writing
     plugin data shows up as a count here. */
  const saves = [];
  ctx.plugin = { settings: { acctColWidths: {}, ...settings }, saveSettings: async () => { saves.push(1); } };
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  return { ctx, S, saves };
}

const ths = table => descend(table).filter(n => n.tagName === 'TH');
const hasCls = (n, c) => !!(n._cls && n._cls.has(c));

(async () => {
  /* ---- 1. a fresh table has no resizing ---- */
  {
    const { ctx } = await mount();
    ctx.renderAccounts();
    const table = ctx.$('#acctTable');
    eq(descend(table).filter(n => hasCls(n, 'acct-grip')).length, 0, 'no header carries a drag grip');
    eq(ths(table).filter(t => t.attrs['data-col']).length, 0, 'and none carries a resize key');
    ok(!hasCls(table, 'is-sized'), 'the table keeps the automatic layout');
  }

  /* ---- 2. a width an older build stored is not applied, and is not touched ---- */
  {
    const { ctx, saves } = await mount({ acctColWidths: { name: 305, balance: 140 } });
    ctx.renderAccounts();
    ctx.renderAccounts();
    const table = ctx.$('#acctTable');
    ok(!hasCls(table, 'is-sized'),
      'a stored width does not put the table on a fixed layout — it would be shared out among columns it was not dragged on');
    ok(ths(table).every(t => !t.style.width), 'and lands on no header');
    eq(ctx.plugin.settings.acctColWidths, { name: 305, balance: 140 },
      'but the stored figure is kept, exactly as it was — an older build reading this data.json still finds it');
    eq(saves.length, 0, 'drawing the table writes nothing to plugin data');
  }

  /* ---- 3. the default is still declared, so data.json round-trips ---- */
  {
    const { DEFAULT_SETTINGS } = require('../src/constants');
    ok(DEFAULT_SETTINGS && 'acctColWidths' in DEFAULT_SETTINGS,
      'acctColWidths stays in DEFAULT_SETTINGS: removing the key is a data.json migration, and nothing here is worth one');
    eq(DEFAULT_SETTINGS.acctColWidths, {}, 'and its default is the empty object');
  }

  /* ---- 4. the header still sorts ---- */
  {
    const { ctx } = await mount();
    ctx.renderAccounts();
    const heads = ths(ctx.$('#acctTable'));
    const sortable = heads.filter(t => descend(t).some(n => n.tagName === 'BUTTON'));
    ok(sortable.length >= 3, `the name, balance and state headers keep their sort buttons (found ${sortable.length})`);
    const buttons = heads.flatMap(t => descend(t).filter(n => n.tagName === 'BUTTON'));
    ok(buttons.length >= 4, `and the balance header holds a second sort for the period's movement (found ${buttons.length} buttons in all)`);
  }

  console.log(`PASS — accounts column resizing is retired: nothing renders, the stored width is left alone, the header still sorts (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
