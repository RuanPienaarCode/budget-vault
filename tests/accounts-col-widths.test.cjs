'use strict';
/* Accounts-table column widths: stored as plugin data, restored on render.

   The reader drags a column edge and the width is remembered. Two halves of
   that can rot independently, and only one of them is visible:

     1. WRITING it. A drag that never reaches plugin.settings is a width that
        survives until the next render and no further — which looks like it
        worked, because the drag itself repainted the column.
     2. READING it back. A stored width the header never re-applies is a
        setting that accumulates in data.json and does nothing.

   So this drives the real view: render, assert the header carries a keyed
   column and a grip, seed a stored width, re-render, and assert the width
   landed on the right `th`. No pointer events — the drag itself is browser
   behaviour that a DOM stub cannot honestly simulate (see the note on
   `is-sized` below for the one part of it that IS assertable here).

   THE `is-sized` FLAG IS THE LOAD-BEARING PART. A width on a `th` means
   nothing under the automatic table layout this table ships with — the engine
   is free to ignore it the moment content disagrees, which is exactly what a
   narrowed column asks it to do. views/accounts.js therefore switches the
   table to a fixed layout only once a width exists. A regression that stored
   widths but stopped emitting the flag would pass every "is the width there"
   assertion and still do nothing on screen, so the flag is asserted in BOTH
   directions rather than only when set.

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

/* The DOM stub's matchMedia deliberately reports NO match for everything (see
   its own note: it models a phone, which is the harder branch). Column
   resizing is desktop-only BY DESIGN — the three `acct-col-drop` columns are
   display:none under 760px, so a width dragged on a desktop would be shared
   among a different set of columns there. So the width is the one thing this
   file has to say which side of that line it is standing on, explicitly, in
   both directions. */
function viewport(wide) {
  const mm = () => ({ matches: wide, addEventListener() {}, removeEventListener() {} });
  global.matchMedia = mm;
  if (global.window) { global.window.matchMedia = mm; }
}

async function mount(settings, wide = true) {
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
  viewport(wide);
  /* The real shape: a plugin object carrying settings and an async save. The
     save is recorded rather than stubbed away to nothing, so a future change
     that writes on every pointermove shows up as a count here. */
  const saves = [];
  ctx.plugin = { settings: { acctColWidths: {}, ...settings }, saveSettings: async () => { saves.push(1); } };
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  return { ctx, S, saves };
}

const ths = table => descend(table).filter(n => n.tagName === 'TH');
const hasCls = (n, c) => !!(n._cls && n._cls.has(c));

(async () => {
  /* ---- 1. a fresh table is UNSIZED and automatic ---- */
  {
    const { ctx } = await mount();
    ctx.renderAccounts();
    const table = ctx.$('#acctTable');
    ok(!hasCls(table, 'is-sized'),
      'a table nobody has dragged keeps the automatic layout — the min-width floor on the name column depends on it');

    const keyed = ths(table).filter(t => t.attrs['data-col']);
    ok(keyed.length >= 6,
      `every resizable header carries a stable key (found ${keyed.length})`);
    const keys = keyed.map(t => t.attrs['data-col']);
    eq([...new Set(keys)].length, keys.length,
      'and no two columns answer to the same key — a duplicate would make one column drag the other');
    ok(keys.includes('name') && keys.includes('balance'),
      'including the two columns a reader is most likely to want wider');

    /* The grip is what a pointer actually lands on. It must exist per keyed
       column, and NOT on the icon-only notes column, which has no width worth
       dragging and whose header carries only a screen-reader label. */
    const grips = descend(table).filter(n => hasCls(n, 'acct-grip'));
    eq(grips.length, keyed.length,
      'one drag grip per keyed column, and none on the columns without a key');
  }

  /* ---- 2. a stored width is re-applied, on the right column ---- */
  {
    const { ctx } = await mount({ acctColWidths: { name: 305 } });
    ctx.renderAccounts();
    const table = ctx.$('#acctTable');
    ok(hasCls(table, 'is-sized'),
      'a table with a stored width takes the fixed layout — without it the width is a suggestion the engine may ignore');

    const byKey = Object.fromEntries(ths(table).filter(t => t.attrs['data-col'])
      .map(t => [t.attrs['data-col'], t]));
    /* Asserted on the `style` PROPERTY, which is what views/accounts.js sets
       and what a browser lays out from — not on the style attribute, which it
       never writes. */
    eq(byKey.name.style.width, '305px', 'the stored width lands on its own column');
    ok(!byKey.balance.style.width,
      'and only on that one — a column nobody sized keeps its automatic width');
  }

  /* ---- 3. an empty map is not a width ----
     `{}` is the default in DEFAULT_SETTINGS, and it has to mean "never
     dragged" rather than "dragged to nothing". Reading it as a size would put
     every vault on a fixed layout on first open. */
  {
    const { ctx } = await mount({ acctColWidths: {} });
    ctx.renderAccounts();
    ok(!hasCls(ctx.$('#acctTable'), 'is-sized'),
      'an empty width map leaves the table automatic — it means "untouched", not "sized to zero"');
  }

  /* ---- 3b. a phone ignores a desktop width, without discarding it ----
     The stored figure is deliberately KEPT rather than cleared: the same vault
     opens on both, and a width dragged on the desktop has to still be there
     when the reader goes back to it. */
  {
    const { ctx } = await mount({ acctColWidths: { name: 305 } }, false);
    ctx.renderAccounts();
    const table = ctx.$('#acctTable');
    ok(!hasCls(table, 'is-sized'),
      'a narrow viewport keeps the automatic layout — three columns are hidden there, so a desktop width would be shared among a different set');
    const nameTh = ths(table).find(t2 => t2.attrs['data-col'] === 'name');
    ok(!nameTh.style.width, 'and the width is not applied');
    eq(ctx.plugin.settings.acctColWidths, { name: 305 },
      'but it is still stored — going back to the desktop restores it');
  }

  /* ---- 4. rendering never writes ----
     saveSettings belongs to the drag's release, not to the render. A render
     that saved would put a data.json write behind every route change into
     this page, on a file that syncs. */
  {
    const { ctx, saves } = await mount({ acctColWidths: { name: 305 } });
    ctx.renderAccounts();
    ctx.renderAccounts();
    eq(saves.length, 0, 'drawing the table stores nothing — only a finished drag does');
  }

  console.log(`PASS — accounts column widths: keyed headers, stored widths restored, fixed layout only when sized (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
