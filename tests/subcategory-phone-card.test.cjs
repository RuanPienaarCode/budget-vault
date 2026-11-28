'use strict';
/* The phone card shows the subcategory as a second line inside the category
   cell (ADR-0010, issue #184: "the phone card (<=600px) shows the subcategory as
   a second line in the category cell").

   Asked of the stylesheet itself, through the cascade resolver every other CSS
   guard here uses (tests/helpers/css-cascade.cjs): for the subcategory control
   inside a Transactions row's category cell, at a phone width and at a desktop
   width, which declaration wins. A guard that only checks a rule is present
   passes a rule that loses to an older one; the resolver answers the question
   the browser does.

   What it pins:
     1. on a phone card the control is a block under the category control, in the
        same cell, not beside it, and does not hold the desktop's 130px floor;
     2. on a phone card it takes the category control's own card size and its
        right alignment, so the two lines read as one cell;
     3. on a desktop table it is also a line of its own, set a size down;
     4. no new grid cell: it is inside the fourth cell (category) at both widths,
        and no rule addresses a ninth column the table does not have.

   Only what the resolver can answer is asserted; a real phone is the other half
   and is not claimed here.

     node tests/subcategory-phone-card.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { computed } = require('./helpers/css-cascade.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const cell = (bodyClasses, ...inner) => [
  { tag: 'body', classes: bodyClasses },
  { tag: 'div', classes: ['budget-app-root'] },
  { tag: 'section', id: 'view-transactions' },
  { tag: 'table', id: 'txTable', classes: ['table'], attrs: { role: 'table' } },
  { tag: 'tbody' }, { tag: 'tr' },
  { tag: 'td', nth: 4, of: 8 },
  ...inner,
];
const sub = bodyClasses => cell(bodyClasses,
  { tag: 'span', classes: ['sub-cell'] }, { tag: 'button', classes: ['cat-cell-btn', 'sub-cell-btn'] });
const cat = bodyClasses => cell(bodyClasses,
  { tag: 'span', classes: ['cat-cell'] }, { tag: 'button', classes: ['cat-cell-btn'] });
const subWrap = bodyClasses => cell(bodyClasses, { tag: 'span', classes: ['sub-cell'] });
const val = (p, prop, o) => { const r = computed(p, prop, o); return r && r.value; };

/* ---- 1. a phone card: a block under the category, in the same cell ------- */
for (const [label, classes, width] of [['portrait phone', ['is-phone'], 375], ['landscape phone', ['is-phone'], 844], ['narrow window', [], 560]]) {
  eq(val(subWrap(classes), 'display', { width }), 'block', `${label}: the subcategory is a block, so it sits under the category control and not beside it`);
  eq(val(subWrap(classes), 'min-width', { width }), '0', `${label}: it does not hold the desktop's 130px floor inside a card`);
}

/* ---- 2. the card's category size and alignment --------------------------- */
for (const [label, classes, width] of [['portrait phone', ['is-phone'], 375], ['landscape phone', ['is-phone'], 844]]) {
  eq(val(sub(classes), 'font-size', { width }), val(cat(classes), 'font-size', { width }),
    `${label}: the subcategory takes the category control's card font size`);
  eq(val(sub(classes), 'justify-content', { width }), 'flex-end', `${label}: and its right alignment`);
  eq(val(sub(classes), 'width', { width }), val(cat(classes), 'width', { width }), `${label}: and its width rule`);
}

/* ---- 3. a desktop table: its own line, a size down ----------------------- */
eq(val(subWrap([]), 'display', { width: 1280 }), 'block', 'desktop: a line of its own under the category control');
eq(val(sub([]), 'font-size', { width: 1280 }), '12px', 'desktop: set a size down from the category');
eq(val(cat([]), 'font-size', { width: 1280 }), '14px', 'desktop: and the category control is unchanged');
eq(val(cat([]), 'display', { width: 1280 }) !== undefined, true, 'desktop: the category control still has its own display rule');

/* ---- 4. no new cell ------------------------------------------------------ */
{
  const { readRules } = require('./helpers/css-sources.cjs');
  const rules = readRules();
  const text = r => (r.selectors || []).join(',');
  const touching = rules.filter(r => /sub-cell/.test(text(r)));
  ok(touching.length >= 5, 'the stylesheet sources carry rules for the subcategory control');
  ok(touching.every(r => !/nth-child\((?:9|1\d)\)/.test(text(r))), 'none addresses a column the table does not have');
  /* The control is rendered inside the category cell, not as a ninth cell of its own. */
  const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'transactions.js'), 'utf8');
  ok(/catTd\.append\(subHost\)/.test(view), 'the view appends it to the category cell');
  eq((view.match(/el\('th', \{ scope: 'col'/g) || []).length, 8, 'and the table still has its eight column headers');
}

console.log(`subcategory-phone-card.test.cjs — ${checks} checks OK`);
