'use strict';
/* A TYPE HEADING ROW KEEPS WITH THE ROW IT HEADS
   (left over from the 14 Oct 2026 audit fix wave, beside L4A-03).

   The budget export's PDF summary opens each type with a heading row (the type
   name, bold, its figure cells blank) instead of a Type column - the L4A-03
   fix, see budget-export-pdf-layout.test.cjs. The table paginates row by row,
   and a row only asks "do I fit on this page?", so a heading that fell on the
   last line of a page was drawn there alone, and the rows it names opened the
   next page under a repeated column header with nothing saying which type they
   were. The block-level heading above the table has always kept with what it
   heads (pdf.js layoutHeading's lookahead); a heading ROW had nothing like it.

   A table block may now name rows that keep with the next one (`keepWithNext`,
   row indices), and budget-export.js names its type heading rows. Proved by
   sliding the headings through every position at the foot of a page - one
   more filler category per run - and requiring, every time, that each heading
   row is drawn on the same page as the first row of its group. Without the
   rule some of those runs strand a heading; the control below shows which.

   Pure - no DOM, no obsidian: layoutDocument takes the measure as an argument.
     node tests/budget-export-pdf-heading-keep.test.cjs */

const assert = require('assert');
const bx = require('../src/budget-export');
const pdf = require('../src/pdf');
const { budgetRowStatus } = require('../src/money-flow');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const row = (cat, type, budget, actual) => ({ cat, type, budget, actual, notes: '', assumed: false, ...budgetRowStatus({ budget, actual, type }) });
const META = { generated: '2026-09-17 10:30', currency: 'R', inProgress: null };
const money = v => 'R ' + Number(v).toFixed(2);
const TYPES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

function summaryDoc(fillers) {
  const rows = [
    ...Array.from({ length: fillers }, (_, i) => row(`Filler ${i + 1}`, 'income', 0, 100 + i)),
    ...TYPES.flatMap((t, ti) => [row(`${t} one`, t, 0, 10 * (ti + 1)), row(`${t} two`, t, 0, 20 * (ti + 1))]),
  ];
  const P = [{ key: '2026-09', name: 'September 2026', title: 'x', start: '2026-08-23', end: '2026-09-22', rows, txs: [],
    summary: { income: 1000, spend: 860, uncatSpend: 0, foreign: { count: 0, labels: [], symbols: [] } } }];
  return bx.modelToDoc(bx.buildModel({ periods: P, content: 'summary', categories: null, includeTx: false, ...META }),
    { money, plainMoney: v => Number(v).toFixed(2) });
}

/* Which page each row of the summary table is drawn on, found by its first
   cell (every label in this fixture is unique). */
function pageOfRows(doc, table) {
  const pages = pdf.layoutDocument(doc, { measure: pdf.helveticaMeasure });
  const where = new Map();
  pages.forEach((p, n) => {
    for (const o of p.ops) if (o.op === 'text' && !where.has(o.text)) where.set(o.text, n);
  });
  return { pages, at: i => where.get(table.rows[i][0]) };
}
const headingRows = t => t.rows.map((r, i) => i)
  .filter(i => t.boldRows.includes(i) && t.rows[i].slice(1).every(c => c === '') && i + 1 < t.rows.length);

/* What the run would strand without the rule: the same doc with the table's
   keepWithNext taken away. */
const withoutKeep = doc => ({ ...doc, blocks: doc.blocks.map(b => {
  if (b.type !== 'table') return b;
  const { keepWithNext, ...rest } = b;
  return rest;
}) });

let stranded = 0, runs = 0;
for (let fillers = 0; fillers <= 90; fillers++) {
  const doc = summaryDoc(fillers);
  const t = doc.blocks.find(b => b.type === 'table');
  const heads = headingRows(t);
  ok(heads.length === TYPES.length + (fillers ? 1 : 0), `fillers=${fillers}: one heading row per type (${heads.length})`);
  const { pages, at } = pageOfRows(doc, t);
  for (const h of heads) {
    ok(at(h) !== undefined && at(h) === at(h + 1),
      `fillers=${fillers}: heading row "${t.rows[h][0]}" is on page ${at(h) + 1} but "${t.rows[h + 1][0]}", the first row it heads, is on page ${at(h + 1) + 1}`);
  }
  /* Every row is still drawn, once, and no page is left without a row. */
  ok(t.rows.every((r, i) => at(i) !== undefined), `fillers=${fillers}: every row is drawn`);
  ok(pages.every((p, n) => t.rows.some((r, i) => at(i) === n) || n === 0),
    `fillers=${fillers}: no page is left without a row of the table`);

  const ctl = pageOfRows(withoutKeep(doc), t);
  if (heads.some(h => ctl.at(h) !== ctl.at(h + 1))) stranded++;
  runs++;
}
/* The control: without the rule the slide DOES strand headings, so the sweep
   above is reaching the page foot rather than passing by luck. */
ok(stranded > 0, `control: without keepWithNext, ${stranded} of ${runs} runs strand a heading row at a page foot`);

/* The rule is the table's, not the summary's: a plain table with a keep-with-
   next row behaves the same, and a keep-with-next LAST row asks for nothing. */
{
  const filler = Array.from({ length: 60 }, (_, i) => [`r${i}`, String(i)]);
  for (let at = 20; at < 60; at++) {
    const rows = [...filler.slice(0, at), ['HEAD', ''], ['first under head', '1'], ...filler.slice(at)];
    const doc = { title: 'T', blocks: [{ type: 'table', head: ['Name', 'N'], rows, boldRows: [at], keepWithNext: [at], align: ['left', 'right'] }] };
    const { at: pg } = pageOfRows(doc, doc.blocks[0]);
    ok(pg(at) === pg(at + 1), `plain table, heading at ${at}: drawn on page ${pg(at) + 1}, its next row on ${pg(at + 1) + 1}`);
  }
  const last = { title: 'T', blocks: [{ type: 'table', head: ['Name'], rows: [['a'], ['b'], ['LAST']], keepWithNext: [2], align: ['left'] }] };
  ok(pdf.layoutDocument(last, { measure: pdf.helveticaMeasure }).length === 1, 'a keep-with-next last row adds no page');
}

console.log(`PASS budget-export-pdf-heading-keep: type heading rows keep with their first row across ${runs} page-foot positions (control strands ${stranded}); ${checks} checks.`);
