'use strict';
/* Two ways the budget export's PDF made a correct figure unreadable.

   1. THE SUMMARY NEEDED TO SAY WHICH TYPE A SUBTOTAL COVERS (2026-10-14 audit,
      L4A-03). Rows are grouped by type and a subtotal is printed only under a
      group of two or more (a group of one is its own total). On a real
      household that left eight one-row groups of eight different types and then
      a "Total expense" covering two of them - and with no type printed
      anywhere, the subtotal sat directly under ten lines and read as the total
      of all ten. Wave A answered with a Type column; on the real 12-month
      landscape export that column took the category names to the 6 pt font
      floor and truncated three of them (Wave B, lane B4). The PDF summary now
      opens each type with a HEADING ROW instead (the Budget page's type bar):
      the same separation, no width. The workbook and CSV keep the Type column.

   2. DATES WERE CUT TO "2026-09…" ON THE IMAGE PATH (L4A-05). A household
      whose language is Chinese, Japanese or Hindi gets the image PDF
      (docEncodable() is false for their own labels), and that path lays the
      same document out with the CANVAS's metrics. The transactions table fixes
      its column widths by weight, and the Date column's weight — 1.1 of 10.4 —
      is wide enough for ten Helvetica characters and not for ten characters
      in the system CJK-capable face, whose digits are wider. Every date lost
      its day. Helvetica was always enough, which is why no test noticed: the
      vector path is the one bare node can run.

      A column of dates is now laid out from what a date measures under the
      ACTIVE measure — '0000-00-00' and the real cells — and is never
      shortened; the other columns share what is left. The test stands in for
      the canvas with a measure that makes every glyph 40% wider than
      Helvetica, which is within the spread the system stacks show.

   Pure — no DOM, no obsidian: layoutDocument takes the measure as an argument.
     node tests/budget-export-pdf-layout.test.cjs */

const assert = require('assert');
const bx = require('../src/budget-export');
const pdf = require('../src/pdf');
const { budgetRowStatus } = require('../src/money-flow');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const row = (cat, type, budget, actual) => ({ cat, type, budget, actual, notes: '', assumed: false, ...budgetRowStatus({ budget, actual, type }) });
const META = { generated: '2026-09-17 10:30', currency: 'R', inProgress: null };
const money = v => 'R ' + Number(v).toFixed(2);

/* ---------------------------------------------------------------- 1. Type */
{
  /* The shape found on the real vault, with round numbers: income, then eight
     one-row types, then two plain expenses that DO get a subtotal. */
  const one = ['utilities', 'food', 'transport', 'health', 'family', 'personal', 'fees', 'treats'];
  const rows = [row('Salary', 'income', 0, 1000),
    ...one.map((t, i) => row(`Cat ${t}`, t, 0, 10 * (i + 1))),
    row('Groceries', 'expense', 0, 300), row('Fuel', 'expense', 0, 200)];
  const P = [{ key: '2026-09', name: 'September 2026', title: 'x', start: '2026-08-23', end: '2026-09-22', rows, txs: [],
    summary: { income: 1000, spend: 860, uncatSpend: 0, foreign: { count: 0, labels: [], symbols: [] } } }];
  const doc = bx.modelToDoc(bx.buildModel({ periods: P, content: 'summary', categories: null, includeTx: false, ...META }),
    { money, plainMoney: v => Number(v).toFixed(2) });
  const t = doc.blocks.find(b => b.type === 'table');
  eq(t.head.slice(0, 2), ['Category', 'September 2026'], 'the summary table has NO Type column: the category is followed by the months');
  ok(!t.head.includes('Type'), 'and no Type header anywhere in it');
  ok(t.rows.every(r => r.length === t.head.length), 'every row is as wide as its header');
  eq(t.align, ['left', 'right', 'right', 'right', 'right'], 'only the category is text; every other column is a right-aligned figure');

  /* Each type opens with a bold heading row naming it, figure cells blank. */
  const isHeading = i => t.boldRows.includes(i) && t.rows[i].slice(1).every(c => c === '');
  const headings = t.rows.map((r, i) => (isHeading(i) ? r[0] : null)).filter(Boolean);
  eq(headings, ['income', ...one, 'expense'], 'one heading row per type, in the household\'s order, each once');
  const sub = t.rows.find(r => r[0] === 'Total expense');
  ok(sub && t.boldRows.includes(t.rows.indexOf(sub)), 'a subtotal row is still there and bold, and its label names the type');

  /* The reader's check: walk down from a heading; the rows before the next
     heading are that type, and the subtotal adds exactly those. */
  const totalCol = t.head.indexOf('Total');
  const groups = [];
  t.rows.forEach((r, i) => { if (isHeading(i)) groups.push({ type: r[0], rows: [] }); else groups[groups.length - 1].rows.push(r); });
  const exp = groups.find(g => g.type === 'expense').rows;
  eq(exp.map(r => r[0]), ['Fuel', 'Groceries', 'Total expense'], 'the expense group is its two rows and the subtotal that adds them');
  eq(exp.slice(0, 2).reduce((s, r) => s + Number(r[totalCol]), 0), Number(exp[2][totalCol]), 'and they add up to the subtotal printed under them');
  ok(groups.filter(g => g.type !== 'expense').every(g => g.rows.length === 1), 'while the eight other types are one-row groups, each under its own heading, so none can read as part of the subtotal');

  /* Past twelve periods the month columns drop; the heading rows stay. */
  const many = Array.from({ length: 14 }, (_, i) => ({ ...P[0], key: `p${i}`, name: `Period ${i + 1}` }));
  const wide = bx.modelToDoc(bx.buildModel({ periods: many, content: 'summary', categories: null, includeTx: false, ...META }), { money });
  const wt = wide.blocks.find(b => b.type === 'table');
  eq(wt.head, ['Category', 'Total', 'Average', 'Budgeted'], 'the wide summary keeps the same shape');
  ok(wt.rows.some(r => r[0] === 'income') && wt.boldRows.length >= 10, 'and its heading rows');

  /* The workbook and the CSV still carry a Type column. */
  const model = bx.buildModel({ periods: P, content: 'summary', categories: null, includeTx: false, ...META });
  eq(bx.modelToSheets(model, {})[0].rows[0].map(c => (c && c.v !== undefined ? c.v : c)).slice(0, 2), ['Category', 'Type'], 'the workbook summary keeps its Type column');
  ok(/^Category,Type,/.test(bx.modelToCsv(model, {})[0].text), 'and so does the CSV');
}

/* ------------------------------------- 1b. a long name survives a 12-month page */
{
  /* Twelve periods is the widest summary the PDF prints with month columns
     (PDF_MAX_PERIOD_COLS); on the real vault the Type column left three of the
     long category names truncated at the 6 pt floor. A 40-character name must
     be drawn whole on the landscape page, in every one of its appearances. */
  const LONG = 'Household Insurance And Medical Cover XY'; // 40 characters
  eq(LONG.length, 40, 'the probe name is forty characters');
  const rowsFor = () => [row('Salary', 'income', 0, 1000), row('Rent', 'housing', 0, 300), row('Rates', 'housing', 0, 100),
    row('Electricity', 'utilities', 0, 80), row(LONG, 'insurance', 0, 250), row('Groceries', 'expense', 0, 500),
    row('Fuel', 'expense', 0, 120), row('Emergency fund', 'saving', 0, 150)];
  /* The month names a month-by-month export really prints (period.js MONTH_FULL), the widest of them "September 2026". */
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const periods = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    return { key: `2026-${mm}`, name: `${MONTH_NAMES[i]} 2026`, title: 'x', start: `2026-${mm}-01`, end: `2026-${mm}-28`, rows: rowsFor(), txs: [],
      summary: { income: 1000, spend: 1350, uncatSpend: 0, foreign: { count: 0, labels: [], symbols: [] } } };
  });
  const model = bx.buildModel({ periods, content: 'summary', categories: null, includeTx: false, ...META });
  const plain = v => Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const doc = bx.modelToDoc(model, { money, plainMoney: plain });
  eq(doc.landscape, true, 'twelve month columns want a landscape page');
  const printed = d => pdf.layoutDocument(d, { measure: pdf.helveticaMeasure, page: pdf.PAGE.A4_LANDSCAPE })
    .flatMap(p => p.ops).filter(o => o.op === 'text').map(o => o.text);
  const texts = printed(doc);
  ok(texts.includes(LONG), 'the 40-character category name is drawn whole on the 12-period landscape summary');
  ok(!texts.some(x => x.endsWith('\u2026') && LONG.startsWith(x.slice(0, -1))), 'and no truncated form of it ("Household Insurance…") is drawn');
  /* Every category name is whole, not just the probe. */
  for (const r of model.summary.rows) ok(texts.includes(r.cat), `${r.cat}: drawn whole`);

  /* The control: the same table with the Wave A Type column put back is the
     layout that truncated it. If this ever stops truncating, the probe above no
     longer proves anything and the 40-character figure should be raised. */
  const t = doc.blocks.find(b => b.type === 'table');
  let cur = '';
  const typed = t.rows.map((r, i) => {
    const heading = t.boldRows.includes(i) && r.slice(1).every(c => c === '');
    if (heading) { cur = r[0]; return null; }
    return [r[0], r[0].startsWith('Total ') ? '' : cur, ...r.slice(1)];
  }).filter(Boolean);
  const old = { ...t, head: [t.head[0], 'Type', ...t.head.slice(1)], rows: typed,
    boldRows: typed.map((r, i) => (r[0].startsWith('Total ') ? i : -1)).filter(i => i >= 0), align: ['left', 'left', ...t.align.slice(1)] };
  const oldTexts = printed({ ...doc, blocks: doc.blocks.map(b => (b === t ? old : b)) });
  ok(!oldTexts.includes(LONG), 'control: with a Type column in the same table the 40-character name IS truncated - the probe has teeth');
}

/* ------------------------------------------------------------------ 2. Dates */
{
  const tx = (date, desc, amount) => ({ date, desc, label: 'Cheque', cat: 'Groceries', amount, excluded: false, note: '', split: '' });
  const txs = [];
  for (let d = 1; d <= 28; d++) txs.push(tx(`2026-09-${String(d).padStart(2, '0')}`, `Checkers branch ${d}`, -(d * 11.5)));
  const P = [{ key: '2026-09', name: 'September 2026', title: 'x', start: '2026-09-01', end: '2026-09-28', rows: [row('Groceries', 'expense', 0, 1)], txs,
    summary: { income: 0, spend: 1, uncatSpend: 0, foreign: { count: 0, labels: [], symbols: [] } } }];
  const model = bx.buildModel({ periods: P, content: 'summary', categories: null, includeTx: true, ...META });
  const doc = bx.modelToDoc(model, { money, rowMoney: v => money(v) });

  const wider = k => (text, font, size) => pdf.helveticaMeasure(text, font, size) * k;
  const datesOn = (measure, page) => pdf.layoutDocument(doc, { measure, page })
    .flatMap(p => p.ops).filter(o => o.op === 'text' && /^\d{4}-\d{2}/.test(o.text)).map(o => o.text);

  const want = txs.map(t => t.date);
  eq(datesOn(pdf.helveticaMeasure, pdf.PAGE.A4), want, 'the vector path always printed every date whole');
  for (const [k, label] of [[1.15, 'a face 15% wider'], [1.4, 'a face 40% wider'], [1.8, 'a face 80% wider']]) {
    eq(datesOn(wider(k), pdf.PAGE.A4), want, `${label}, portrait: every date still whole — no "2026-09…"`);
    eq(datesOn(wider(k), pdf.PAGE.A4_LANDSCAPE), want, `${label}, landscape: likewise`);
  }

  /* The room for the date came out of the other columns, not out of the
     figures: the description column still draws, and so does every amount. */
  const pages = pdf.layoutDocument(doc, { measure: wider(1.4), page: pdf.PAGE.A4 });
  const texts = pages.flatMap(p => p.ops).filter(o => o.op === 'text').map(o => o.text);
  ok(texts.some(t => /^Checkers/.test(t)), 'descriptions are still drawn');
  ok(txs.every(t => texts.includes(money(t.amount))), 'and every amount is drawn whole, because numeric columns never give way');

  /* The layout itself: the date column is never narrower than a date. */
  const m = wider(1.4);
  const probe = { type: 'table', head: ['Date', 'Description'], align: ['left', 'left'], weights: [0.01, 9], keepWhole: [{ col: 0, widest: '0000-00-00' }],
    rows: [['2026-09-17', 'x']] };
  const [page] = pdf.layoutDocument({ title: 't', blocks: [probe] }, { measure: m, page: pdf.PAGE.A4 });
  const cell = page.ops.find(o => o.op === 'text' && o.text === '2026-09-17');
  ok(cell, 'a table that asks for a tiny weight on its date column still prints the date whole');
}

console.log(`PASS budget-export-pdf-layout (${checks} checks)`);
