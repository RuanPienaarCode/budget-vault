'use strict';
/* The Dashboard's "Where it went" expands a category into its subcategories
   (ADR-0010, issue #186, slice 3 of 4).

   The REAL Dashboard, mounted the way the app mounts it (src/wiring.js) over the
   real loader and an in-memory vault, read through the DOM stub. Only the
   Transactions page's routing is stubbed (switchView re-renders it in place), so
   what a click opens is read off the filter controls and the rows the real
   Transactions filter would list.

   CONTRACT, in the reader's terms:

     - A category expands only when at least one KEPT row in the donut's window
       carries a subcategory for it. Otherwise nothing about its row changes: no
       chevron, no aria-expanded, and a click opens Transactions as it always did.
     - Expanded, it lists one row per subcategory with an amount, a "No
       subcategory" row when what is left nets to something, and an "All
       transactions" row. The amounts are printed in whole units and add up to the
       category's own printed figure, refunds included.
     - A subcategory row opens Transactions with the category and subcategory
       filters set; "No subcategory" sets the sentinel; "All transactions" is the
       old click (category only, any stale subcategory filter cleared).
     - The donut wedge of an expandable category expands its legend row instead
       of navigating. Other stays an inert row.
     - Every control is a real <button> with an accessible name from i18n; the
       expansion reports aria-expanded and aria-controls, and while collapsed its
       rows are out of the tab order. It is not remembered: arriving on the
       Dashboard again closes it, re-rendering in place does not.
     - A book that uses no subcategory shows none of this.

     node tests/dashboard-subcategories.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { find, hasClass, textOf } = require('./helpers/dash-audit.cjs');
const { NO_SUBCATEGORY } = require('../src/subcategories');
const { TABLES } = require('../src/i18n');
const household = require('./figures/household.cjs');
const household2 = require('./figures/household2.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const cents = v => { const n = Math.round(v * 100); return n === 0 ? 0 : n; };

/* ---- reading the rendered legend ----------------------------------------- */
const split = M => M.nodes.get('#dashSplit');
const legend = M => find(split(M), n => n.tagName === 'UL' && hasClass(n, 'donut-legend'))[0];
const items = M => legend(M).children.filter(n => n.tagName === 'LI' && !hasClass(n, 'donut-legend-head'));
const nameOf = li => textOf(find(li, n => hasClass(n, 'dl-name'))[0]);
const rowFor = (M, cat) => items(M).find(li => nameOf(li) === cat);
const mainBtn = li => find(li, n => n.tagName === 'BUTTON' && hasClass(n, 'dl-link'))[0];
const subList = li => find(li, n => n.tagName === 'UL' && hasClass(n, 'dl-subs'))[0] || null;
const subBtns = li => (subList(li) ? find(subList(li), n => n.tagName === 'BUTTON') : []);
const subBtn = (li, label) => subBtns(li).find(b => textOf(find(b, n => hasClass(n, 'dl-sub-name'))[0]) === label);
/* A printed whole-unit figure: the digits, signed (the formatter's separators,
   symbol and unicode minus are not the subject). */
const num = text => {
  const digits = String(text).replace(/[^\d]/g, '');
  if (digits === '') return null;
  return (/[-−–]/.test(text) ? -1 : 1) * Number(digits);
};
const valOf = (node, cls) => num(textOf(find(node, n => hasClass(n, cls))[0]));
const isOpen = li => mainBtn(li).getAttribute('aria-expanded') === 'true';

/* ---- the Transactions page, as far as a drill-through touches it --------- */
function realSelect(sel) {
  Object.defineProperty(sel, 'options', {
    configurable: true,
    get() { return sel.children.filter(c => c.tagName === 'OPTION').map(o => ({ value: o.attrs.value, textContent: o.textContent })); },
  });
  return sel;
}
function wire(M) {
  const { ctx } = M;
  M.switched = [];
  ctx.switchView = v => { M.switched.push(v); ctx.renderTransactions(); };
  M.cat = realSelect(ctx.$('#txCategory'));
  M.sub = realSelect(ctx.$('#txSubcategory'));
  ctx.$('#txWholeHistory').checked = false;
  return M;
}
async function open(files, { today, period }) {
  const unpin = pinClock(today);
  try {
    const M = await mountFor(files, { period });
    M.ctx.renderDashboard();
    return wire(M);
  } finally { unpin(); }
}
const sumRows = rows => Math.round(rows.reduce((t, r) => t + Number(r.amount || 0), 0) * 100) / 100;

/* ========================================================================
   1. The sums, on both committed households, refunds included.
   ======================================================================== */

/* Which subcategory each row of a category gets: a cycle that leaves some rows
   with none, repeats a name, and gives a category two names. Deterministic. */
const CYCLE = {
  Groceries: ['Fresh', '', 'Pantry', 'Fresh'],
  Rent: ['', 'Levy'],
  Gym: ['Classes', ''],
  Software: ['Backup', ''],
  Investing: ['Unit trust'],
};
function addColumn(text) {
  const seen = {};
  return text.split('\n').map(line => {
    if (!line.startsWith('|')) return line;
    if (line.startsWith('| Date')) return `${line.replace(/\s*$/, '')} Subcategory |`;
    if (/^\|[-:|]+\|$/.test(line)) return `${line}---|`;
    const cat = line.split('|').map(c => c.trim())[3];
    const cycle = CYCLE[cat] || ['Other', ''];
    seen[cat] = (seen[cat] || 0) + 1;
    return `${line.replace(/\s*$/, '')} ${cat ? cycle[(seen[cat] - 1) % cycle.length] : ''} |`;
  }).join('\n');
}
const REFUND = (date, desc, cat, amount, sub) => `| ${date} | ${desc} | ${cat} | ${amount.toFixed(2)} |  |  |  | ${sub} |\n`;
function seeded(seed, refunds) {
  const files = {};
  for (const [path, text] of Object.entries(seed.SEED)) files[path] = path.includes('/Transactions/') ? addColumn(text) : text;
  for (const [path, rows] of Object.entries(refunds)) files[path] += rows.join('');
  return files;
}
const SEEDS = [
  {
    name: 'household', seed: household, expands: 2,
    refunds: {
      [`${household.B}/Transactions/Cheque/2026-09.md`]: [
        REFUND('2026-09-02', 'Checkers refund', 'Groceries', 150, 'Fresh'),
        REFUND('2026-09-02', 'Checkers refund', 'Groceries', 80, ''),
        REFUND('2026-09-02', 'Gym refund', 'Gym', 50, 'Classes'),
        REFUND('2026-09-02', 'Landlord overpaid', 'Rent', 9500, 'Levy'),
      ],
    },
  },
  {
    name: 'household2', seed: household2, expands: 1,   // its window holds one category: Groceries, and the two refunds
    refunds: {
      [`${household2.B}/Transactions/Cheque/2026-11.md`]: [
        REFUND('2026-11-26', 'Checkers refund', 'Groceries', 200, 'Pantry'),
        REFUND('2026-11-26', 'Checkers refund', 'Groceries', 40, ''),
      ],
    },
  },
];

(async () => {
  for (const { name, seed, refunds, expands } of SEEDS) {
    const M = await open(seeded(seed, refunds), { today: seed.TODAY, period: seed.PERIOD });
    const rows = items(M);
    ok(rows.length >= expands, `${name}: the legend is drawn (${rows.length} rows)`);
    const breakdowns = M.ctx.categorySplitBreakdowns(seed.PERIOD);
    const spend = M.ctx.categorySpendRows(seed.PERIOD);

    let expandable = 0, withNone = 0, withRefund = 0;
    for (const li of rows) {
      const cat = nameOf(li);
      const list = subList(li);
      if (!list) {
        ok(!(cat in breakdowns) || /Other/.test(cat), `${name}: "${cat}" has no expansion because it has no breakdown`);
        ok(mainBtn(li) ? mainBtn(li).getAttribute('aria-expanded') === null : true, `${name}: "${cat}" carries no aria-expanded`);
        continue;
      }
      expandable++;
      const printed = valOf(mainBtn(li), 'dl-val');
      const parts = subBtns(li).filter(b => !hasClass(b, 'dl-sub-all'));
      const shownSum = parts.reduce((t, b) => t + valOf(b, 'dl-sub-val'), 0);
      eq(shownSum, printed, `${name}: "${cat}" — the expanded amounts add up to the printed ${printed}`);

      /* Not merely consistent with itself: each is within a unit of the ledger's
         own exact figure, in the legend's sign, and the exact ones add up to the
         category's figure on the donut to the cent. */
      const exact = breakdowns[cat];
      eq(parts.length, exact.length, `${name}: "${cat}" — one row per subcategory, plus none when it has something`);
      exact.forEach((r, i) => ok(Math.abs(valOf(parts[i], 'dl-sub-val') - r.amount) < 1, `${name}: "${cat}" row ${i} is within a unit of ${r.amount}`));
      const donut = spend.find(r => r.cat === cat);
      eq(cents(exact.reduce((t, r) => t + r.amount, 0)), cents(donut.amount), `${name}: "${cat}" — the exact rows add up to the donut's figure to the cent`);
      if (exact.some(r => r.kind === 'none')) withNone++;
      if (exact.some(r => r.amount < 0 || /refund/i.test(r.name))) withRefund++;
    }
    ok(expandable >= expands && withNone >= 1, `${name}: the expansion was exercised (${expandable} expandable, ${withNone} with a none row)`);
    /* A category that nets the refund against a subcategory: Groceries on both. */
    const groc = rowFor(M, 'Groceries');
    ok(groc && subList(groc), `${name}: Groceries, which carries refunds, expands`);
  }

  /* ======================================================================
     2. A small book with every shape the rule has to tell apart.
     ====================================================================== */
  const B = 'Budget';
  const PERIOD = '2026-09';
  const TODAY = '2026-09-15';
  const HEAD = '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note | Subcategory |\n|---|---|---|---:|---|---|---|\n';
  const row = (date, desc, cat, amount, sub = '', excluded = '') => `| ${date} | ${desc} | ${cat} | ${amount.toFixed(2)} | ${excluded} |  | ${sub} |\n`;
  const book = (rows, extra = {}) => ({
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000.00\nbalance_updated: 2026-08-31\n---\n',
    [`${B}/Categories/Car.md`]: '---\ntype: expense\ncolor: "#123456"\nsubcategories: Fuel, Tolls\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    [`${B}/Categories/Home.md`]: '---\ntype: expense\ncolor: "#aa3366"\n---\n',
    [`${B}/Categories/Gym.md`]: '---\ntype: expense\ncolor: "#22aa66"\n---\n',
    [`${B}/Transactions/Cheque/2026-09.md`]: HEAD + rows.join(''),
    ...extra,
  });
  const ROWS = [
    row('2026-09-01', 'Engen', 'Car', -500, 'Fuel'),
    row('2026-09-02', 'Engen again', 'Car', -120.5, 'Fuel'),
    row('2026-09-03', 'Engen refund', 'Car', 20.5, 'Fuel'),
    row('2026-09-04', 'Servicing', 'Car', -900),
    row('2026-09-05', 'e-tag', 'Car', -65, 'Tolls'),
    row('2026-09-06', 'Checkers', 'Groceries', -2500),
    row('2026-09-07', 'Rates', 'Home', -700),
    /* Home carries a subcategory, but only on a row the budget holds out (excluded)
       and on one dated after today: neither is in the figure being explained. */
    row('2026-09-08', 'Insurance', 'Home', -300, 'Cover', 'x'),
    row('2026-09-25', 'Water', 'Home', -90, 'Utilities'),
    /* Gym: subcategorised only AFTER today. */
    row('2026-09-09', 'Gym', 'Gym', -400),
    row('2026-09-28', 'Gym classes', 'Gym', -100, 'Classes'),
  ];

  const M = await open(book(ROWS), { today: TODAY, period: PERIOD });
  const car = rowFor(M, 'Car');
  ok(car && subList(car), 'Car, with subcategorised spending in the window, expands');

  /* -- when it expands, and when it does not -- */
  for (const cat of ['Groceries', 'Home', 'Gym']) {
    const li = rowFor(M, cat);
    ok(li, `${cat} is on the donut`);
    ok(!subList(li), `${cat}: no expansion — ${cat === 'Groceries' ? 'no subcategory anywhere' : cat === 'Home' ? 'its only labelled rows are excluded or after today' : 'its only labelled row is after today'}`);
    eq(mainBtn(li).getAttribute('aria-expanded'), null, `${cat}: nothing on its row says it expands`);
    eq(find(li, n => hasClass(n, 'dl-chev')).length, 0, `${cat}: and no chevron is drawn`);
  }

  /* -- the shape of the expansion -- */
  ok(!isOpen(car), 'collapsed on arrival');
  eq(mainBtn(car).getAttribute('type'), 'button', 'the row is a real button');
  eq(mainBtn(car).getAttribute('aria-controls'), subList(car).attrs.id, 'aria-controls names the list it opens');
  ok(subList(car).attrs.id && find(split(M), n => n.attrs && n.attrs.id === subList(car).attrs.id).length === 1, 'and that id is unique on the page');
  ok(hasClass(subList(car), 'hidden'), 'collapsed rows are display:none, so out of the tab order and the accessibility tree');
  eq(subList(car).getAttribute('aria-label') && subList(car).getAttribute('aria-label').includes('Car'), true, 'the list is named after its category');

  const labels = subBtns(car).map(b => textOf(find(b, n => hasClass(n, 'dl-sub-name'))[0]));
  eq(labels, ['Fuel', 'Tolls', 'No subcategory', 'All transactions'],
    'rows: the subcategories biggest first, then the rows with none, then All transactions last');

  /* Fuel nets -500 -120.50 +20.50 = 600 out; Tolls 65; none 900: 1565 in all. */
  eq(valOf(mainBtn(car), 'dl-val'), 1565, 'the category prints 1 565');
  eq(valOf(subBtn(car, 'Fuel'), 'dl-sub-val'), 600, 'Fuel nets its refund: 600');
  eq(valOf(subBtn(car, 'Tolls'), 'dl-sub-val'), 65, 'Tolls: 65');
  eq(valOf(subBtn(car, 'No subcategory'), 'dl-sub-val'), 900, 'No subcategory: 900');
  eq(find(subBtn(car, 'All transactions'), n => hasClass(n, 'dl-sub-val')).length, 0, 'All transactions is an action, not a part: it prints no figure to add in');
  
  /* -- accessible names -- */
  for (const b of subBtns(car)) {
    const label = b.getAttribute('aria-label');
    ok(label && label.trim() && label.includes('Car'), `every row has an accessible name that says whose it is: "${label}"`);
    eq(b.tagName, 'BUTTON', 'each row is a button');
    eq(b.getAttribute('type'), 'button', 'of type button');
    eq(b.attrs.tabindex, undefined, 'with no tabindex override (a button is already in the tab order)');
  }
  ok(mainBtn(car).getAttribute('aria-label').includes('Car') && /1[\s ]?565/.test(mainBtn(car).getAttribute('aria-label')),
    'the expandable row is named with its category and figure');
  ok(/Fuel/.test(subBtn(car, 'Fuel').getAttribute('aria-label')) && /600/.test(subBtn(car, 'Fuel').getAttribute('aria-label').replace(/[\s ]/g, '')),
    'a subcategory row is named with the category, the subcategory and the amount');
  ok(mainBtn(car).getAttribute('aria-label') !== find(rowFor(M, 'Groceries'), n => n.tagName === 'BUTTON')[0].getAttribute('aria-label'), 'and it does not claim to show transactions, as a plain row does');

  /* -- toggling by keyboard or pointer: a button's click is Enter and Space -- */
  mainBtn(car)._fire('click');
  ok(isOpen(car) && !hasClass(subList(car), 'hidden'), 'activating the row opens it');
  eq(M.switched, [], 'and opening it does not leave the Dashboard');
  mainBtn(car)._fire('click');
  ok(!isOpen(car) && hasClass(subList(car), 'hidden'), 'activating it again closes it');

  /* -- the drill-throughs -- */
  const drill = (label, before) => {
    M.switched.length = 0;
    if (before) before();
    mainBtn(car)._fire('click');
    if (!isOpen(car)) mainBtn(car)._fire('click');
    subBtn(car, label)._fire('click');
  };
  const rowsListed = () => M.ctx.filteredRows().rows;

  drill('Fuel');
  eq([M.switched, M.cat.value, M.sub.value], [['transactions'], 'Car', 'Fuel'], 'Fuel opens Transactions with Car and Fuel set');
  eq(rowsListed().map(r => r.desc).sort(), ['Engen', 'Engen again', 'Engen refund'], 'and lists exactly the Fuel rows');
  eq(sumRows(rowsListed()), -600, 'which add up to the amount printed on the row');

  drill('Tolls');
  eq([M.cat.value, M.sub.value], ['Car', 'Tolls'], 'Tolls sets Car and Tolls');
  eq(rowsListed().map(r => r.desc), ['e-tag'], 'and lists its one row');

  drill('No subcategory');
  eq([M.cat.value, M.sub.value], ['Car', NO_SUBCATEGORY], 'No subcategory sets the sentinel');
  eq(rowsListed().map(r => r.desc), ['Servicing'], 'and lists the rows that have none');
  eq(sumRows(rowsListed()), -900, 'adding up to the amount printed');

  drill('All transactions', () => { M.sub.value = 'Tolls'; });
  eq([M.cat.value, M.sub.value], ['Car', ''], 'All transactions is the old click: the category alone, and a leftover subcategory filter is cleared');
  eq(rowsListed().length, 5, 'every Car row');
  eq(sumRows(rowsListed()), -1565, 'adding up to the category');

  /* A category that does not expand still clicks through as before, and leaves no
     subcategory filter behind from an earlier drill. */
  M.switched.length = 0;
  M.sub.value = 'Fuel';
  mainBtn(rowFor(M, 'Groceries'))._fire('click');
  eq([M.switched, M.cat.value, M.sub.value], [['transactions'], 'Groceries', ''], 'Groceries (no subcategory) opens its transactions exactly as before');
  eq(rowsListed().map(r => r.desc), ['Checkers'], 'with a stale subcategory filter from an earlier visit cleared');

  /* -- the donut wedge -- */
  const wedges = () => find(split(M), n => hasClass(n, 'donut-slice'));
  const wedgeOf = cat => {
    const idx = items(M).findIndex(li => nameOf(li) === cat);
    return wedges()[idx];
  };
  M.switched.length = 0;
  if (isOpen(car)) mainBtn(car)._fire('click');   // the drill-throughs above left it open
  ok(!isOpen(car), 'closed before the wedge is clicked');
  wedgeOf('Car')._fire('click');
  eq(M.switched, [], 'the wedge of an expandable category does not navigate');
  ok(isOpen(car), 'it expands the legend row instead');
  wedgeOf('Car')._fire('click');
  ok(!isOpen(car), 'and a second click closes it');
  wedgeOf('Groceries')._fire('click');
  eq([M.switched, M.cat.value, M.sub.value], [['transactions'], 'Groceries', ''], 'a wedge with no subcategories navigates as before');

  /* -- Other -- */
  {
    /* Nine categories, so the ninth falls into Other; the smallest carries
       subcategories, which must not make Other expand. */
    const names = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Tiny'];
    const files = book(names.map((n, i) => row(`2026-09-0${1 + (i % 8)}`, `${n} spend`, n, -(1000 - i * 100), n === 'Tiny' ? 'Bits' : '')).concat(
      [row('2026-09-09', 'Tiny more', 'Tiny', -10)]));
    for (const n of names) files[`${B}/Categories/${n}.md`] = '---\ntype: expense\ncolor: "#777777"\n---\n';
    const O = await open(files, { today: TODAY, period: PERIOD });
    const other = items(O).find(li => /^Other/.test(nameOf(li)));
    ok(other, 'the tail collapses into an Other row');
    eq(find(other, n => n.tagName === 'BUTTON').length, 0, 'Other has no button: it stays inert');
    eq(find(other, n => hasClass(n, 'dl-subs')).length, 0, 'and no expansion');
    eq(other.children.filter(n => n.tagName === 'LI' || n.tagName === 'UL').length, 0, 'and nothing nested');
    const otherWedge = find(split(O), n => n.tagName === 'path' || n.tagName === 'PATH').filter(n => !hasClass(n, 'donut-slice'));
    ok(otherWedge.length >= 1, "Other's wedge is not a donut-slice, so it is not clickable");
    O.switched.length = 0;
    otherWedge.forEach(w => w._fire('click'));
    eq(O.switched, [], 'clicking it does nothing');
  }

  /* -- whole units that still add up: three parts of R 10,40 print 31, not 30 -- */
  {
    const R = await open(book([
      row('2026-09-01', 'Engen', 'Car', -10.4, 'Fuel'),
      row('2026-09-02', 'e-tag', 'Car', -10.4, 'Tolls'),
      row('2026-09-03', 'Servicing', 'Car', -10.4),
    ]), { today: TODAY, period: PERIOD });
    const li = rowFor(R, 'Car');
    eq(valOf(mainBtn(li), 'dl-val'), 31, 'the category prints R 31 (31,20 to the unit)');
    const printed = subBtns(li).filter(b => !hasClass(b, 'dl-sub-all')).map(b => valOf(b, 'dl-sub-val'));
    eq(printed.length, 3, 'three parts');
    eq(printed.reduce((t, v) => t + v, 0), 31, `and they print so they add up to it, not 30 (printed ${printed.join(' + ')})`);
    ok(printed.every(v => v === 10 || v === 11), 'each within a unit of its own R 10,40');
  }

  /* -- not remembered -- */
  mainBtn(car)._fire('click');
  ok(isOpen(car), 'open');
  M.ctx.renderSplit();
  ok(isOpen(rowFor(M, 'Car')), 're-rendering the card in place (a range pill, a theme flip) keeps it open');
  const sameBtn = mainBtn(rowFor(M, 'Car'));
  eq(sameBtn.getAttribute('aria-expanded'), 'true', 'with its state reported');
  M.ctx.replayDashMotion();           // what switchView calls on arriving at the Dashboard
  M.ctx.renderDashboard();
  ok(!isOpen(rowFor(M, 'Car')), 'arriving on the Dashboard again finds it closed');
  mainBtn(rowFor(M, 'Car'))._fire('click');
  ok(isOpen(rowFor(M, 'Car')), 'and it opens again');

  /* -- out of sight until used -- */
  {
    const plain = book(ROWS.filter(r => !/Fuel|Tolls|Cover|Utilities|Classes/.test(r)));
    plain[`${B}/Categories/Car.md`] = '---\ntype: expense\ncolor: "#123456"\n---\n';
    const P = await open(plain, { today: TODAY, period: PERIOD });
    eq(find(split(P), n => hasClass(n, 'dl-subs') || hasClass(n, 'dl-chev')).length, 0, 'a book that uses no subcategory draws no expansion and no chevron');
    eq(find(split(P), n => n.getAttribute && n.getAttribute('aria-expanded') !== null).length, 0, 'and nothing reports aria-expanded');
    P.switched.length = 0;
    mainBtn(rowFor(P, 'Car'))._fire('click');
    eq([P.switched, P.cat.value], [['transactions'], 'Car'], 'every row opens Transactions as before');
  }

  /* -- every new string is in all twelve languages -- */
  const KEYS = ['dash.split.expandAria', 'dash.split.subsAria', 'dash.split.subAria', 'dash.split.subNoneAria', 'dash.split.subAllAria', 'dash.split.subAll'];
  const langs = Object.keys(TABLES);
  eq(langs.length, 12, 'twelve languages');
  for (const lang of langs) {
    for (const k of KEYS) ok(typeof TABLES[lang][k] === 'string' && TABLES[lang][k].trim(), `${lang} has ${k}`);
    for (const [k, ph] of [['dash.split.expandAria', ['{cat}', '{amount}', '{pct}']], ['dash.split.subAria', ['{cat}', '{sub}', '{amount}']],
      ['dash.split.subNoneAria', ['{cat}', '{amount}']], ['dash.split.subsAria', ['{cat}']], ['dash.split.subAllAria', ['{cat}']]]) {
      for (const p of ph) ok(TABLES[lang][k].includes(p), `${lang} ${k} keeps ${p}`);
    }
    if (lang !== 'en') ok(TABLES[lang]['dash.split.subAll'] !== TABLES.en['dash.split.subAll'], `${lang} translates "All transactions"`);
  }

  console.log(`PASS dashboard-subcategories (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
