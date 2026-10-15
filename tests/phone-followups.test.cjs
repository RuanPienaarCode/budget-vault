'use strict';
/* The three phone follow-ups (Oct 2026), rendered rather than read.

   Yesterday's phone pass (PR #127) fixed what a 375x667 iPhone could measure.
   Three things were left, and each has a half that no stylesheet reader can
   see - the markup the CSS sizes or the geometry a chart draws with:

     1. TRANSACTIONS "EXCL. BUDGET". The checkbox sat in no <label>, so the
        page's "every checkbox is 44px" rule drew it as a 44px empty square
        (32px sideways). It is now inside <label class="tbl-tick">, the
        wrapper Services' Active and Import's tick already use: the label is
        the 44px target and the box in it is drawn at 24px. This pins the
        wrapper, and that the aria-label, the change handler and the checked
        state are the input's own, as before.
     2. LANDSCAPE CHART TEXT. The two Savings charts drew 13/12/9.5-unit text
        that came out at 8, 7.5 and 6px at 667x375. Under .is-phone the
        stylesheet now sets 20 units, and the charts draw the roomier
        geometry (taller strip, wider row spacing, no in-chart "Growth with
        no date" note) whenever body.is-phone is set, orientation or not.
        This pins that geometry in all three modes - and that a desktop gets
        exactly the old one.
     3. TAX STEPS. Five cells, in order, with their labels and write paths,
        because the card CSS places them by position.

   Synthetic household; the figures are invented.

     node tests/phone-followups.test.cjs */
const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const BASE = require('./helpers/views-vault.cjs');
/* The household's accounts have no inception date, so the Savings growth chart is
   (correctly) hidden for it. One fund with a starting amount, an inception date and
   a deposit makes it draw, with a balance the deposit does not explain: that gap is
   the "growth with no date" block the landscape fix has to leave room for. */
const FILES = {
  ...BASE,
  'Budget/Accounts/Growth Fund.md': '---\ntype: investment\ntx_label: "Growth Fund"\nbalance: 30000\nbalance_updated: 2026-07-01\n'
    + 'starting_amount: 20000\ninception_date: 2025-01-01\n---\n',
  'Budget/Transactions/Growth Fund/2025-02.md': '---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
    + '| 2025-02-05 | Deposit | Transfer | 5000.00 |  |  |  |\n',
};
const kids = n => (n.children || []).filter(c => c && c.nodeType === 1);
const within = (n, tag) => descend(n).filter(e => e.tagName === tag);

(async () => {
  const ctx = makeCtx({ ...FILES });
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.switchView = () => {};
  ctx.render = () => {};
  ctx.reloadFromDisk = async () => {};
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) require(`../src/views/${f}`)(ctx);

  /* ---- 1. Transactions: the Excl. budget tick is a .tbl-tick label ---------- */
  ctx.renderTransactions();
  {
    const tbody = kids($('#txTable')).find(n => n.tagName === 'TBODY');
    const rows = kids(tbody).filter(tr => kids(tr).length === 8);
    ok(rows.length >= 3, `the household draws transaction rows to check (${rows.length})`);
    let boxes = 0;
    for (const tr of rows) {
      const cell = kids(tr)[5];
      const inputs = within(cell, 'INPUT');
      if (!inputs.length) continue;               // a split parent shows its chip instead; that is not this item
      boxes++;
      eq(inputs.length, 1, 'the Excluded cell holds one checkbox');
      const box = inputs[0];
      eq(box.getAttribute('type'), 'checkbox', 'it is a checkbox');
      const label = box._parent;
      ok(label && label.tagName === 'LABEL' && label._cls.has('tbl-tick'),
        'the checkbox sits directly in a <label class="tbl-tick">: the label is the 44px target, the box draws at 24px');
      eq(label._parent, cell, 'and that label is the cell\'s own child, so td:nth-child(6) .tbl-tick reaches it');
      ok(/^Exclude .+ from budget totals$/.test(box.getAttribute('aria-label')),
        `the input keeps its own aria-label ("${box.getAttribute('aria-label')}")`);
      ok(!label.hasAttribute('aria-label'), 'the label adds no second accessible name');
      eq((box._on && box._on.change || []).length, 1, 'and its change handler');
    }
    ok(boxes >= 3, `checked ${boxes} Excluded checkboxes`);
  }

  /* ---- 2. Savings: the chart geometry in desktop, landscape-phone, portrait-phone ---- */
  const bodyClasses = new Set();
  const savedBody = global.document.body;
  global.document.body = { classList: { contains: c => bodyClasses.has(c), add: c => bodyClasses.add(c), remove: c => bodyClasses.delete(c) } };
  const savedWin = global.window.matchMedia;
  const draw = (mode) => {
    bodyClasses.clear();
    global.window.matchMedia = q => ({ matches: mode === 'portrait' && q === '(max-width: 600px)', addEventListener() {}, removeEventListener() {} });
    if (mode !== 'desktop') for (const c of ['is-mobile', 'is-phone', 'is-ios']) bodyClasses.add(c);
    for (const id of ['#savingsWorth', '#savingsGrowth']) $(id).empty();
    ctx.renderSavings();
    const svg = cls => descend($('#' + (cls === 'worth-svg' ? 'savingsWorth' : 'savingsGrowth'))).find(n => (n.getAttribute('class') || '') === cls);
    const out = {};
    for (const cls of ['worth-svg', 'growth-svg']) {
      const s = svg(cls);
      out[cls] = s ? { h: Number(s.getAttribute('viewBox').split(/\s+/)[3]), texts: within(s, 'TEXT').map(t => t.textContent) } : null;
    }
    return out;
  };
  const desktop = draw('desktop'), landscape = draw('landscape'), portrait = draw('portrait');
  ok(desktop['worth-svg'] && desktop['growth-svg'], 'the household draws both Savings charts');
  eq([desktop['worth-svg'].h, desktop['growth-svg'].h], [118, 250], 'a desktop draws the original geometry (118 / 250 units tall)');
  /* Until 15 Oct 2026 the desktop still printed the in-chart "Growth with" /
     "no date" note here, and its first line was cut off by the chart's own
     clip; it now leaves the note to the legend as the phone does
     (savings-growth-label-clipped.test.cjs, which also holds that the
     household's undated block is drawn, so this is not passing vacuously). */
  ok(!desktop['growth-svg'].texts.includes('Growth with') && !desktop['growth-svg'].texts.includes('no date'),
    'and, like the phone, leaves the "Growth with no date" note to the legend');
  eq([landscape['worth-svg'].h, landscape['growth-svg'].h], [134, 266], 'a landscape phone (.is-phone, wider than 600px) gets the roomier geometry');
  ok(!landscape['growth-svg'].texts.includes('Growth with') && !landscape['growth-svg'].texts.includes('no date'),
    'and drops the in-chart note, which does not fit a 78-unit column at 20 units (the legend below says the same thing)');
  eq([portrait['worth-svg'].h, portrait['growth-svg'].h], [134, 266], 'a portrait phone keeps its roomier geometry (unchanged)');
  eq(landscape['growth-svg'].texts.filter(t => /^\d{4}-\d{2}$/.test(t)).length, 2, 'the growth chart still labels its first and last month in landscape');
  eq(landscape['worth-svg'].texts.length, desktop['worth-svg'].texts.length, 'the net-worth bars keep every heading and total');
  global.window.matchMedia = savedWin;
  global.document.body = savedBody;

  /* ---- 3. Tax steps: the five cells, in order, with their controls ------------ */
  ctx.renderTax();
  {
    const tbody = kids($('#taxStepsTable')).find(n => n.tagName === 'TBODY');
    const rows = kids(tbody);
    ok(rows.length >= 1, `the household draws Tax steps (${rows.length})`);
    for (const tr of rows) {
      const cells = kids(tr);
      eq(cells.length, 5, 'a step is five cells: step, status, due, notes, remove');
      eq(cells.map(c => c.getAttribute('data-label')), ['Step', 'Status', 'Due', 'Notes', null], 'the cells carry their column names (the card prints them inline)');
      const step = cells[0].textContent;
      eq(within(cells[1], 'BUTTON').length, 1, 'cell 2 is the status pill');
      ok(/^Status: /.test(within(cells[1], 'BUTTON')[0].getAttribute('aria-label')), 'whose aria-label names the status');
      const due = within(cells[2], 'INPUT')[0], notes = within(cells[3], 'INPUT')[0];
      ok(due && due.getAttribute('aria-label') === `Due date for ${step}`, 'cell 3 is the due date field');
      ok(notes && notes.getAttribute('aria-label') === `Notes for ${step}` && notes.getAttribute('type') === 'text', 'cell 4 is the notes field');
      eq((notes._on.change || []).length, 1, 'which still writes on change');
      ok(within(cells[4], 'BUTTON')[0].getAttribute('aria-label') === `Remove step ${step}`, 'cell 5 is the remove button');
    }
  }

  console.log(`PASS phone-followups (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
