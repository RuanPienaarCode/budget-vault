'use strict';
/* ONE APP, NOT TWO STYLES (2026-11-25 audit: VIS-1/2/3, CSS-1/2/3/4/7, FUN-5).

   Five pages were restyled in the statement type and twelve kept the legacy
   sheet's controls. Measured at 1440px: fields 40px / 12px corners / 15px
   text on Transactions, Budget and Plan, 29-31px / 8px / 12.8px on the rest;
   table headings 500 in --text-light on two pages and 600 in --text-muted on
   the others; row actions a quiet 34px icon square on two pages and a
   bordered 28px pill on five; three recipes for a card header's buttons;
   Plan's cards inset 28px where every other card is 44px; and on a 375px
   phone the Transactions and Budget action rails put Add transaction and New
   category off screen with nothing to say so.

   The fix promotes the restyled pages' values into the foundation layer
   (statement/foundation.css tokens + table voice, statement/primitives.css
   controls). This asks the stylesheet, through the repo's cascade resolver,
   what each control ACTUALLY resolves to on the old pages and the restyled
   ones alike — so a lane rule that out-ranks the shared one, or a shared rule
   that out-ranks the touch rules, fails here.

   THE TOUCH SECTION IS THE ONE THAT BIT. The first cut put the field
   font-size in an (0,2,1) rule, which out-ranked phone.css's (0,2,0) 16px
   touch rule for every <select> and every input with no type attribute:
   iOS zooms the page when a field under 16px takes focus. Section 2 holds
   every field kind at 16px under a coarse pointer.

   Negative controls, each run by hand and each failing here: move the field
   font-size back into the `input.form-control` rule; take the row hover out
   of @media (hover: hover); put Plan's header padding back to 28px; drop the
   #txAdd order from the phone rail; give the Budget table heading weight 600.

     node tests/css-one-app-controls.test.cjs */

const { computed, node, ROOT } = require('./helpers/css-cascade.cjs');
const { readRules, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

const DESK = { width: 1440, pointer: 'fine', hover: 'hover' };
const PHONE = { width: 375, pointer: 'coarse', hover: 'none' };
const LAND = { width: 740, pointer: 'coarse', hover: 'none' };

/* A custom property's value on the root, then var() resolved against it (one
   level is all these tokens use). */
const token = (name, env = DESK) => { const d = computed(ROOT(), name, env); return d ? d.value : undefined; };
const val = (pathArr, prop, env = DESK) => {
  const d = computed(pathArr, prop, env);
  if (!d) return { value: undefined, where: 'not set' };
  const v = d.value.replace(/var\((--[\w-]+)\)/g, (m, n) => token(n, env) || m);
  return { value: v, where: locate(d.line) };
};
const want = (label, pathArr, prop, expect, env = DESK) => {
  const got = val(pathArr, prop, env);
  const pass = typeof expect === 'function' ? expect(got.value) : got.value === expect;
  ok(pass, `${label}: ${prop} is "${got.value}" (${got.where}), want ${typeof expect === 'function' ? 'a passing value' : `"${expect}"`}`);
};
const page = (id, ...more) => [...ROOT(...more), node('section', [], { id: `view-${id}` }), node('div', ['card'])];
const phonePage = id => [...ROOT('phone'), node('section', [], { id: `view-${id}` }), node('div', ['card'])];
const cell = (base, ...tdClasses) => [...base, node('div', ['table-responsive']), node('table', ['table']), node('tbody'), node('tr'), node('td', tdClasses)];

/* ---- 0. the tokens ---- */
ok(token('--st-control-h') === '40px', `--st-control-h is 40px (found ${token('--st-control-h')})`);
ok(token('--st-control-radius') === '12px', `--st-control-radius is 12px (found ${token('--st-control-radius')})`);
ok(token('--st-control-font') === '15px', `--st-control-font is 15px (found ${token('--st-control-font')})`);
ok(token('--st-control-h-cell') === '36px' && token('--st-control-font-cell') === '14px', 'the in-row field tokens are the Transactions note field: 36px / 14px');

/* ---- 1. fields at a desktop: one geometry ---- */
const FIELDS = {
  'text field': node('input', ['form-control', 'form-control-sm'], { attrs: { type: 'text' } }),
  'untyped input': node('input', ['form-control']),
  'number field': node('input', ['form-control', 'form-control-sm'], { attrs: { type: 'number' } }),
  'date field': node('input', ['form-control', 'form-control-sm'], { attrs: { type: 'date' } }),
  select: node('select', ['form-select', 'form-select-sm']),
};
for (const id of ['debts', 'owed', 'assets', 'services', 'tax', 'loans', 'report', 'import', 'food', 'notes', 'savings']) {
  for (const [kind, f] of Object.entries(FIELDS)) {
    const p = [...page(id), node('div', ['card-h']), f];
    want(`${id} ${kind}`, p, 'height', '40px');
    want(`${id} ${kind}`, p, 'border-radius', '12px');
    want(`${id} ${kind}`, p, 'font-size', '15px');
  }
  // in a table row: the row's field
  for (const kind of ['text field', 'select']) {
    const p = [...cell(page(id)), FIELDS[kind]];
    want(`${id} in-row ${kind}`, p, 'height', '36px');
    want(`${id} in-row ${kind}`, p, 'border-radius', '12px');
    want(`${id} in-row ${kind}`, p, 'font-size', '14px');
  }
}
// the restyled pages read the same tokens
{
  const tx = [...page('transactions'), node('div', ['card-h', 'tx-head']), node('div', ['row', 'tx-filters'])];
  want('Transactions filter select', [...tx, node('select', ['form-select', 'form-select-sm'], { id: 'txAccount' })], 'height', '40px');
  want('Transactions filter select', [...tx, node('select', ['form-select', 'form-select-sm'], { id: 'txAccount' })], 'font-size', '15px');
  want('Transactions search (a pill)', [...tx, node('input', ['form-control', 'form-control-sm'], { id: 'txSearch', attrs: { type: 'search' } })], 'border-radius', '999px');
  const bud = [...page('budgets'), node('table', ['table', 'bud-table']), node('tbody'), node('tr'), node('td', ['num']), node('div', ['bud-amt-wrap']), node('input', ['form-control'], { attrs: { type: 'number' } })];
  want('Budget amount field (the row figure, kept at the full size)', bud, 'height', '40px');
  want('Budget amount field', bud, 'font-size', '15px');
  want('Budget amount field', bud, 'border-radius', '12px');
  const plan = [...page('plan'), node('li', ['env-item', 'env-item-add']), node('input', ['env-add-name'], { attrs: { type: 'text' } })];
  want('Plan add-item field (was 10px / 14.5px)', plan, 'border-radius', '12px');
  want('Plan add-item field', plan, 'font-size', '15px');
  want('Plan add-item field', plan, 'height', '40px');
}
// the search boxes are the one pill
for (const [label, p] of [
  ['Food search', [...page('food'), node('div', ['row', 'note-filters']), node('input', ['form-control', 'form-control-sm'], { id: 'foodSearch', attrs: { type: 'search' } })]],
  ['Notes search', [...page('notes'), node('div', ['row', 'note-filters']), node('input', ['form-control', 'form-control-sm'], { id: 'noteSearch', attrs: { type: 'search' } })]],
  ['Accounts search', [...page('accounts'), node('div', ['acct-search']), node('input', [], { id: 'acctSearch', attrs: { type: 'search' } })]],
]) {
  want(label, p, 'border-radius', '999px');
  want(label, p, 'height', '40px');
  want(label, p, 'font-size', '15px');
}

/* ---- 2. fields under a finger: still 16px (no iOS zoom) and 44px ---- */
for (const env of [PHONE, LAND]) {
  const at = `${env.width}px touch`;
  for (const id of ['debts', 'food', 'tax', 'transactions']) {
    for (const [kind, f] of Object.entries(FIELDS)) {
      const p = [...(env === PHONE ? phonePage(id) : page(id)), node('div', ['card-h']), f];
      want(`${at} ${id} ${kind}`, p, 'font-size', '16px', env);
      want(`${at} ${id} ${kind}`, p, 'min-height', '44px', env);
    }
    for (const kind of ['text field', 'select', 'untyped input']) {
      const p = [...cell(env === PHONE ? phonePage(id) : page(id)), FIELDS[kind]];
      want(`${at} ${id} in-row ${kind}`, p, 'font-size', '16px', env);
      want(`${at} ${id} in-row ${kind}`, p, 'min-height', v => v === '40px' || v === '44px', env);
    }
    const search = [...(env === PHONE ? phonePage(id) : page(id)), node('input', ['form-control', 'form-control-sm'], { attrs: { type: 'search' } })];
    want(`${at} ${id} search`, search, 'font-size', '16px', env);
  }
  want(`${at} Accounts search`, [...page('accounts'), node('div', ['acct-search']), node('input', [], { attrs: { type: 'search' } })], 'font-size', '16px', env);
}

/* ---- 3. one table voice ---- */
const TABLES = {
  debts: [...page('debts'), node('table', ['table', 'table-hover'], { id: 'debtTable' })],
  owed: [...page('owed'), node('table', ['table', 'table-hover'], { id: 'owedTable' })],
  loans: [...page('loans'), node('table', ['table'])],
  food: [...page('food'), node('table', ['table', 'food-items-table'], { id: 'foodItemsTable' })],
  import: [...page('import'), node('table', ['table', 'table-hover'], { id: 'impTable' })],
  dashboard: [...page('dashboard'), node('table', ['table'], { id: 'dashBudget' })],
  budgets: [...page('budgets'), node('table', ['table', 'bud-table'], { id: 'budTable' })],
  transactions: [...page('transactions'), node('table', ['table', 'table-hover'], { id: 'txTable' })],
};
for (const [id, t] of Object.entries(TABLES)) {
  const th = [...t, node('thead'), node('tr'), node('th')];
  want(`${id} table heading`, th, 'font-weight', '500');
  want(`${id} table heading`, th, 'color', token('--text-light'));
  want(`${id} table heading`, th, 'font-size', '13px');
  const num = [...t, node('tbody'), node('tr'), node('td', ['num'])];
  want(`${id} money cell`, num, 'font-size', id === 'transactions' ? '16px' : '15px');
  want(`${id} money cell`, num, 'font-weight', '500');
  want(`${id} money cell`, num, 'font-variant-numeric', 'tabular-nums lining-nums');
}
{
  const rules = readRules();
  const spec = s => require('./helpers/css-cascade.cjs').specificity(s);
  const cmp = require('./helpers/css-cascade.cjs').cmp;
  const shared = rules.find(r => r.selectors.includes('.budget-app-root .table tbody tr:not(.type-row, .acct-row):hover'));
  ok(shared, 'the shared row hover `.budget-app-root .table tbody tr:not(.type-row, .acct-row):hover` exists');
  if (shared) {
    ok(JSON.stringify(shared.context) === JSON.stringify(['@media (hover: hover)']), `the shared row hover sits in @media (hover: hover) (a tap must not leave a row lit); context is ${JSON.stringify(shared.context)}`);
    ok(shared.decls.some(d => /background/.test(d.prop) && d.value === 'var(--line-soft)'), 'the shared row hover is the --line-soft wash');
    const base = rules.find(r => r.selectors.includes('.budget-app-root .table.table-hover tbody tr:hover'));
    ok(base && cmp(spec('.budget-app-root .table tbody tr:not(.type-row, .acct-row):hover'), spec('.budget-app-root .table.table-hover tbody tr:hover')) >= 0 && shared.line > base.line,
      'the shared row hover out-ranks or ties the legacy .table-hover green and comes after it');
  }
  // the lane copies are gone: no restyled lane restates the heading or the hover
  for (const r of rules) {
    const f = locate(r.line);
    if (!/statement\/(budget|transactions)\.css/.test(f)) continue;
    for (const s of r.selectors) {
      ok(!/thead th$/.test(s) || !r.decls.some(d => /^(font-weight|color)$/.test(d.prop)), `${f}: "${s}" restates the table heading the foundation now owns`);
      ok(!/tr:hover$/.test(s), `${f}: "${s}" restates the row hover the foundation now owns`);
    }
  }
}

/* ---- 4. row actions: the quiet icon square, icon-only buttons only ---- */
const rowBtn = (base, key, extra = []) => [...cell(base), node('button', ['btn-ghost', 'btn-ghost-sm', ...extra], { attrs: { 'data-focus-key': key } })];
for (const id of ['debts', 'assets', 'services', 'tax', 'transactions']) {
  const p = rowBtn(page(id), 'del:3');
  want(`${id} row Delete`, p, 'width', '34px');
  want(`${id} row Delete`, p, 'height', '34px');
  want(`${id} row Delete`, p, 'border-color', 'transparent');
  want(`${id} row Delete`, p, 'color', token('--text-muted'));
}
{
  const owed = [...cell(page('owed')), node('div', ['owed-acts']), node('button', ['btn-ghost', 'btn-ghost-sm'])];
  want('Owed row "+" repayment', owed, 'width', '34px');
  want('Owed row "+" repayment', owed, 'border-color', 'transparent');
  want('Transactions row Split', rowBtn(page('transactions'), 'split:3'), 'height', '34px');
  // Copy (#188) is the third icon in that cell: the same quiet square, and 44px under a finger like its neighbours
  for (const prop of ['width', 'height']) want('Transactions row Copy', rowBtn(page('transactions'), 'copy:3'), prop, '34px');
  want('Transactions row Copy', rowBtn(page('transactions'), 'copy:3'), 'border-color', 'transparent');
  want('375px touch Transactions row Copy', rowBtn(phonePage('transactions'), 'copy:0'), 'min-height', '44px', PHONE);
  want('375px touch Transactions row Copy', rowBtn(phonePage('transactions'), 'copy:0'), 'min-width', '44px', PHONE);
  want('375px touch Transactions row Split', rowBtn(phonePage('transactions'), 'split:0'), 'min-width', '44px', PHONE);
  // words stay a pill
  for (const [label, key] of [['Tax Upload', 'upload:2'], ['Food Open', 'open:2']]) {
    want(`${label} (a word, not an icon)`, rowBtn(page(label.split(' ')[0].toLowerCase()), key), 'width', v => v === undefined);
    want(`${label} (a word, not an icon)`, rowBtn(page(label.split(' ')[0].toLowerCase()), key), 'padding', v => v !== '0');
  }
  // Budget's slotted squares stay budget.css's
  const bud = [...page('budgets'), node('table', ['table', 'bud-table']), node('tbody'), node('tr'), node('td'),
    node('button', ['btn-ghost', 'btn-ghost-sm', 'bud-act', 'bud-act-delete'], { attrs: { 'data-focus-key': 'del:Food' } })];
  const w = computed(bud, 'width', DESK);
  ok(w && /statement\/budget\.css/.test(locate(w.line)), `the Budget table's Delete keeps its size from budget.css (resolved at ${w && locate(w.line)})`);
  // under a finger the squares are 44px
  want('375px touch Debts row Delete', rowBtn(phonePage('debts'), 'del:0'), 'min-height', '44px', PHONE);
  want('375px touch Debts row Delete', rowBtn(phonePage('debts'), 'del:0'), 'min-width', '44px', PHONE);
  const rules = readRules();
  const rose = rules.filter(r => r.decls.some(d => d.prop === 'color' && d.value === 'var(--color-danger-ink)')
    && r.selectors.some(s => s.includes('[data-focus-key^="del:"]') && s.endsWith(':hover')));
  ok(rose.length && rose.every(r => JSON.stringify(r.context) === JSON.stringify(['@media (hover: hover)'])), 'the rose Delete hover exists and sits in @media (hover: hover)');
}

/* ---- 5. toolbar buttons: the Transactions recipe ---- */
const TOOLBARS = {
  debts: [...page('debts'), node('div', ['card-h']), node('div', ['row'])],
  budgets: [...page('budgets'), node('div', ['card-h']), node('div', ['row'])],
  transactions: [...page('transactions'), node('div', ['card-h', 'tx-head']), node('div', ['row', 'tx-actions'])],
  'plan bucket head': [...page('plan'), node('div', ['card', 'plan-buckets']), node('div', ['plan-env-head'])],
  'plan page rail': [...page('plan'), node('div', ['plan-actions-v2']), node('div', ['plan-actions-rail'])],
};
for (const [id, bar] of Object.entries(TOOLBARS)) {
  const ghost = [...bar, node('button', ['btn-ghost', ...(/plan/.test(id) ? ['btn-sm'] : [])])];
  const grad = [...bar, node('button', ['btn-gradient', ...(/plan/.test(id) ? ['btn-sm'] : [])])];
  want(`${id} ghost button`, ghost, 'font-size', '13px');
  want(`${id} ghost button`, ghost, 'font-weight', '500');
  want(`${id} ghost button`, ghost, 'padding', '0 14px');
  want(`${id} ghost button`, ghost, 'line-height', '1');
  want(`${id} ghost button`, ghost, 'min-height', '34px');
  if (id !== 'plan bucket head') {
    want(`${id} gradient button`, grad, 'font-weight', '600');
    want(`${id} gradient button`, grad, 'font-size', '13px');
  }
  want(`${id} ghost button under a finger`, ghost, 'min-height', '44px', LAND);
}
// a chip in a header is not a toolbar button
want('a .btn-ghost-sm chip in a card header', [...TOOLBARS.debts, node('button', ['btn-ghost', 'btn-ghost-sm'])], 'font-size', v => v !== '13px');

/* ---- 6. Plan's gutter ---- */
const side = v => (v || '').split(/\s+/)[1];
for (const [label, p] of [
  ['Plan hero', [...page('plan'), node('div', ['card', 'plan-hero']), node('div', ['pot'])]],
  ['Plan bucket header', [...page('plan'), node('div', ['card', 'plan-buckets']), node('div', ['plan-env-head'])]],
  ['Plan Money in header', [...page('plan'), node('div', ['card', 'plan-money-in']), node('div', ['card-h'])]],
  ['Plan Money in body', [...page('plan'), node('div', ['card', 'plan-money-in']), node('div', ['body-pad'], { id: 'planSources' })]],
]) {
  want(label, p, 'padding', v => side(v) === '44px');
  want(`${label} at 700px`, p, 'padding', v => side(v) === '20px', { width: 700, pointer: 'fine' });
  want(`${label} on a phone`, p, 'padding', v => side(v) === '20px', { width: 375, pointer: 'coarse', hover: 'none' });
}
want('Plan bucket header', [...page('plan'), node('div', ['plan-env-head'])], 'align-items', 'center');
want('Plan bucket rows sit on the 44px line (28px + the row\'s 16px)', [...page('plan'), node('div', ['mini-grid'], { id: 'planEnvelopes' })], 'padding', v => side(v) === '28px');

/* ---- 7. the phone rails: the primary actions first, and an edge ---- */
for (const [env, base] of [[PHONE, ROOT('phone')], [LAND, ROOT('phone')]]) {
  const at = `${env.width}px phone`;
  const tx = [...base, node('section', [], { id: 'view-transactions' }), node('div', ['card-h', 'tx-head']), node('div', ['row', 'tx-actions'])];
  const ord = id => val([...tx, node('button', ['btn-ghost'], { id })], 'order', env).value;
  ok(ord('txAdd') === '-3' && ord('txSave') === '-2', `${at}: Add transaction then Save changes lead the rail (order ${ord('txAdd')}, ${ord('txSave')})`);
  ok(val([...tx, node('span', ['count-note'], { id: 'txCount' })], 'order', env).value === '-1', `${at}: the row count follows them`);
  ok(ord('txExport') === undefined, `${at}: the other actions keep their markup order`);
  want(`${at} Transactions rail`, tx, '-webkit-mask-image', v => /linear-gradient\(to right/.test(v || ''), env);
  want(`${at} Transactions rail end spacer`, tx, 'order', '99', { ...env, pseudo: '::after' });
}
{
  const rail = [...ROOT('phone'), node('section', [], { id: 'view-budgets' }), node('div', ['card']), node('div', ['card-h']), node('div', ['row'])];
  const ord = id => val([...rail, node('button', ['btn-ghost'], { id })], 'order', PHONE).value;
  ok(ord('budSave') === '-1' && ord('budAddCat') === undefined && ord('budCopyPrev') === '1' && ord('budExport') === '2',
    `375px phone: Save budget, New category, Copy previous period, Export (orders ${ord('budSave')}, ${ord('budAddCat')}, ${ord('budCopyPrev')}, ${ord('budExport')})`);
  want('375px phone Budget rail', rail, 'mask-image', v => /linear-gradient\(to right/.test(v || ''), PHONE);
  want('desktop Budget header row has no mask', rail.map(n => n.tag === 'body' ? node('body') : n), 'mask-image', v => v === undefined, DESK);
}

if (failures.length) {
  console.log(`FAIL — css-one-app-controls: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — css-one-app-controls: ${checks} checks (one field geometry and the touch floor under it, one table voice and hover, the quiet row square, one toolbar recipe, Plan's 44px gutter, the phone rails' order and edge).`);
