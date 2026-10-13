'use strict';
/* The six phone-card tables name their columns and keep their table semantics.

   Under 600px Debts, Owed Money, Assets, Services, Tax (steps, figures,
   documents) and Import review stack each row into a card
   (src/statement/phone-tables.css). A card has no column header above it, so
   each cell prints its own column name from a `data-label`, and a grid <tr> is
   no longer a row to VoiceOver, so the ARIA roles are stamped explicitly —
   dom.js tableCells does both, and the card CSS is gated on the roles it
   leaves. This pins the half that lives in the views:

     1. every view calls tableCells with ONE label per thead column — the count
        read out of the source, so a column added to a thead without a label
        (the card would print it unlabelled and shift every later label one
        column left) fails here;
     2. rendered over the synthetic household, the labels land on the right
        cells — the same text as the column header — including the rows the
        table-position arithmetic is easy to get wrong in: Services' group bars
        (a colspan name, then a subtotal in the LAST column) and Tax's figure
        totals (a colspan in the middle);
     3. tableCells itself counts columns by colspan.

   Synthetic household; the figures are invented.

     node tests/phone-tables-labels.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend, FakeEl } = require('./helpers/dom-stub.cjs');
const { tableCells } = require('../src/dom');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- 1. the source: one label per column ---------------------------------- */
/* Top-level comma split of an array literal's body, honouring quotes and
   brackets, so `locale().figureCodeLabel` and a 'Extra / month' count once. */
function splitTop(body) {
  const out = []; let depth = 0, cur = '', q = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) { cur += c; if (c === '\\') cur += body[++i]; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const VIEWS = { debts: 1, owed: 1, assets: 1, services: 1, tax: 3, import: 1 };
let calls = 0;
for (const [view, want] of Object.entries(VIEWS)) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', `${view}.js`), 'utf8');
  ok(/require\('\.\.\/dom'\)/.test(src) && /\btableCells\b/.test(src.split('require(\'../dom\')')[0].split('\n').pop()),
    `${view}.js imports tableCells from ../dom`);
  const found = [...src.matchAll(/tableCells\(\s*\w+\s*,\s*\[/g)];
  eq(found.length, want, `${view}.js stamps ${want} table(s) with tableCells`);
  for (const m of found) {
    const open = m.index + m[0].length - 1;
    let depth = 0, end = open;
    for (; end < src.length; end++) { if (src[end] === '[') depth++; else if (src[end] === ']' && --depth === 0) break; }
    const labels = splitTop(src.slice(open + 1, end));
    const before = src.slice(0, m.index);
    const headAt = before.lastIndexOf("el('thead'");
    ok(headAt !== -1, `${view}.js: a thead precedes the tableCells call`);
    const head = before.slice(headAt);
    const th = (head.match(/el\('th'/g) || []).length;
    eq(labels.length, th, `${view}.js: tableCells gets one label per thead column (${th} th, ${labels.length} labels)`);
    ok(labels[labels.length - 1] === 'null' || view === 'import' || view === 'tax',
      `${view}.js: the actions column goes unlabelled`);
    calls++;
  }
}
eq(calls, 8, 'eight tables are stamped across the six views');

/* ---- 3. tableCells counts columns, not child nodes ------------------------- */
{
  const mk = (tag, attrs = {}) => { const n = new FakeEl(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const row = (...cells) => { const tr = mk('tr'); tr.append(...cells); return tr; };
  const table = mk('table');
  const tbody = mk('tbody'), tfoot = mk('tfoot'), thead = mk('thead');
  thead.append(row(mk('th'), mk('th'), mk('th'), mk('th'), mk('th')));
  // a group bar: a name spanning four columns, then the subtotal in the fifth
  tbody.append(row(mk('td', { colspan: '4' }), mk('td')));
  // a totals row: code, a two-column label, the figure, an empty actions cell
  tfoot.append(row(mk('td'), mk('td', { colspan: '2' }), mk('td'), mk('td')));
  table.append(thead, tbody, tfoot);
  tableCells(table, ['A', 'B', 'C', 'D', null]);
  const [bar, sub] = tbody.children[0].children;
  ok(!bar.hasAttribute('data-label'), 'a spanning cell carries no label');
  ok(!sub.hasAttribute('data-label'), 'the subtotal after a 4-column bar is column 5 (the actions column), not "B"');
  const [t0, tspan, t3, t4] = tfoot.children[0].children;
  eq([t0.getAttribute('data-label'), tspan.getAttribute('data-label'), t3.getAttribute('data-label'), t4.getAttribute('data-label')],
    ['A', null, 'D', null], 'a mid-row colspan shifts every later label by its width');
  eq(table.getAttribute('role'), 'table', 'the table says it is one');
}

/* ---- 2. rendered over the household ---------------------------------------- */
const FILES = require('./helpers/views-vault.cjs');
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
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) require(`../src/views/${f}`)(ctx);

  const kids = n => (n.children || []).filter(c => c && c.nodeType === 1);
  const text = n => n.textContent.replace(/\s+/g, ' ').trim();
  function check(id, name) {
    const table = $(id);
    eq(table.getAttribute('role'), 'table', `${name}: role=table`);
    const [thead, ...rest] = kids(table);
    eq(thead.getAttribute('role'), 'rowgroup', `${name}: thead is a rowgroup`);
    const heads = kids(kids(thead)[0]);
    heads.forEach(th => eq(th.getAttribute('role'), 'columnheader', `${name}: a header cell is a columnheader`));
    let dataRows = 0;
    for (const group of rest) {
      eq(group.getAttribute('role'), 'rowgroup', `${name}: ${group.tagName} is a rowgroup`);
      for (const tr of kids(group)) {
        eq(tr.getAttribute('role'), 'row', `${name}: a body row is a row`);
        const cells = kids(tr);
        cells.forEach(td => eq(td.getAttribute('role'), 'cell', `${name}: a body cell is a cell`));
        if (cells.some(td => td.hasAttribute('colspan'))) {
          // a spanning row: whatever follows the span is in the column it occupies
          let col = 0;
          for (const td of cells) {
            const span = td.colSpan;
            if (td.hasAttribute('colspan')) ok(!td.hasAttribute('data-label'), `${name}: a spanning cell carries no label`);
            else if (col === heads.length - 1) ok(!td.hasAttribute('data-label'), `${name}: the last column's cell is unlabelled`);
            else eq(td.getAttribute('data-label'), text(heads[col]), `${name}: column ${col + 1} of a spanning row is named by its header`);
            col += span;
          }
          continue;
        }
        eq(cells.length, heads.length, `${name}: a data row has one cell per header (${heads.length})`);
        cells.forEach((td, i) => {
          const h = text(heads[i]);
          if (!h) ok(!td.hasAttribute('data-label'), `${name}: the unnamed column's cell is unlabelled`);
          else ok(td.getAttribute('data-label') && h.startsWith(td.getAttribute('data-label')),
            `${name}: column ${i + 1} is labelled with its header (header "${h}", label "${td.getAttribute('data-label')}")`);
        });
        dataRows++;
      }
    }
    ok(dataRows > 0, `${name}: at least one data row was checked`);
    return table;
  }

  ctx.renderDebts(); check('#debtTable', 'Debts');
  ctx.renderOwed(); check('#owedTable', 'Owed');
  ctx.renderAssets(); check('#assetTable', 'Assets');
  ctx.renderServices();
  const svc = check('#svcTable', 'Services');
  ok(descend(svc).some(n => n._cls && n._cls.has('type-row')), 'Services drew a group bar to check');
  ctx.renderTax();
  check('#taxStepsTable', 'Tax steps');
  check('#taxDocsTable', 'Tax documents');
  const fig = check('#taxFiguresTable', 'Tax figures');
  const foot = kids(fig).find(g => g.tagName === 'TFOOT');
  ok(foot, 'the figures table has its totals');
  const totals = kids(kids(foot)[0]);
  eq(totals[2].getAttribute('data-label'), 'Amount', 'the total is labelled Amount although a colspan sits before it');

  console.log(`PASS phone-tables-labels (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
