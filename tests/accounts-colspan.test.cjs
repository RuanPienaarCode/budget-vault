'use strict';
/* The Accounts table's colspan ↔ column-count contract.

   Three rows in that table span the WHOLE width rather than sitting in the
   columns: the empty state, each group's subtotal bar, and the drawer that
   opens under an account. All three carry a hardcoded `colspan` string in
   views/accounts.js, and nothing has ever checked it against the number of
   columns the header actually emits.

   That is a silent failure. A table whose colspan is one short does not throw,
   does not warn and still renders — it just pulls the last column in on those
   rows, so the group subtotal stops lining up with the balances above it and
   the drawer leaves a narrow empty cell at the end. You find it by looking,
   which means you find it after it ships.

   It has already moved once: 1.16.0 added a notes column and all three sites
   went 7 -> 8 by hand. There is no reason to believe the next column will
   remember to.

   So this asserts the RELATIONSHIP rather than the number — the expected value
   is read from the rendered header, so adding a ninth column fails this file
   until the three sites follow. Nothing here needs updating when the table
   grows; that is the point.

   Runs in bare node against the real view. Wired into ./build.sh.
     node tests/accounts-colspan.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
/* Two accounts in DIFFERENT groups, so the grouped render emits at least one
   `.type-row` subtotal bar — the row that is easiest to lose from this test by
   accident, because a single-group fixture still renders one and would hide a
   regression in the grouping branch. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ninstitution: "Bank A"\ntx_label: "Cheque"\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Savings Pot.md`]:
    '---\ntype: savings\nbalance: 55000.00\nbalance_updated: 2026-07-01\n---\n',
};

async function mount() {
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
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  return { ctx, S, $ };
}

const headerCount = table =>
  descend(table).filter(n => n.tagName === 'TH').length;

/* Every cell in the table that claims to span the full width, as
   [rowClass, colspan] pairs. Read from the DOM rather than from a list of
   selectors this file maintains, so a FOURTH full-width row added later is
   covered the day it appears rather than the day someone remembers it. */
const spanningCells = table =>
  descend(table)
    .filter(n => n.tagName === 'TD' && n.attrs.colspan)
    .map(n => [[...(n._parent?._cls || [])].join(' ') || '(no class)', n.attrs.colspan]);

(async () => {
  const { ctx, S } = await mount();

  /* ---- 1. the header, which is the source of truth for all of it ---- */
  ctx.renderAccounts();
  const table = ctx.$('#acctTable');
  const cols = headerCount(table);
  ok(cols >= 7, `the accounts table still has a recognisable header (found ${cols} columns)`);

  /* ---- 2. the group subtotal bar ---- */
  eq(S.acctView.grouped, true, 'the table groups by default — the subtotal bar is on screen');
  let spans = spanningCells(table);
  const groupRows = spans.filter(([cls]) => cls.includes('type-row'));
  ok(groupRows.length > 0, 'the grouped render emits at least one subtotal bar');
  for (const [cls, span] of groupRows) {
    eq(span, String(cols), `a subtotal bar spans every column (${cls})`);
  }

  /* ---- 3. the drawer that opens under an account ---- */
  S.acctView.open = 'Cheque';
  ctx.renderAccounts();
  spans = spanningCells(ctx.$('#acctTable'));
  const drawer = spans.filter(([cls]) => cls.includes('acct-drawer-row'));
  eq(drawer.length, 1, 'opening an account emits exactly one drawer row');
  eq(drawer[0][1], String(cols), 'the drawer spans every column');

  /* ---- 4. the empty state ---- */
  S.acctView.open = null;
  ctx.acctSearch('zzz-matches-nothing');
  spans = spanningCells(ctx.$('#acctTable'));
  const empty = spans.filter(([cls]) => cls.includes('acct-empty'));
  eq(empty.length, 1, 'a search matching nothing emits the empty row');
  eq(empty[0][1], String(cols), 'the empty row spans every column');
  ctx.acctSearch('');

  /* ---- 5. the blanket claim, so a NEW spanning row is covered too ----
     Everything above names a row it knows about. This one does not: whatever
     full-width cells the table emits, in any state, every one of them agrees
     with the header. That is the assertion that survives the next feature. */
  S.acctView.open = 'Cheque';
  ctx.renderAccounts();
  const all = spanningCells(ctx.$('#acctTable'));
  ok(all.length >= 3, `the three known full-width rows are all present (found ${all.length})`);
  const wrong = all.filter(([, span]) => span !== String(cols));
  eq(wrong, [], `every full-width cell spans exactly ${cols} columns`);

  /* ---- 6. negative control ----
     The checks above compare a rendered value against a rendered value, which
     is exactly the shape that can agree with itself and prove nothing. So:
     feed the same comparison a cell that is deliberately one short, and
     require it to be caught. If this ever passes, checks 2-5 are decoration. */
  const { el } = require('../src/dom');
  const fake = el('table', {},
    el('thead', {}, el('tr', {}, ...Array.from({ length: cols }, () => el('th', {}, 'x')))),
    el('tbody', {}, el('tr', { class: 'type-row' }, el('td', { colspan: String(cols - 1) }, 'stale'))));
  eq(headerCount(fake), cols, 'the control table has the same column count');
  const caught = spanningCells(fake).filter(([, span]) => span !== String(cols));
  eq(caught.length, 1, 'negative control: a colspan one short of the header IS caught');
  eq(caught[0][1], String(cols - 1), 'negative control: and it reports the stale value');

  console.log(`PASS — every full-width row spans the accounts table's ${cols} columns, and a stale colspan is caught (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
