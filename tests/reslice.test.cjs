'use strict';
/* Bringing a stranded budget's amounts across.

   The feature's whole safety story is "a scaled figure is a guess, so the user
   sees each one and accepts it by hand". Two halves, both pinned here:

     • the arithmetic (src/reslice.js) — the factor, the rounding, and the
       honest null when the old period length simply cannot be known
     • the gate (BudgetResliceModal) — every row rendered, every row starting
       UNTICKED, and nothing resolved but the lines actually accepted

   The second matters more than it looks. A modal that defaults its boxes to
   ticked, or that resolves the whole list regardless of them, is a silent bulk
   conversion wearing a preview's clothes — which is the exact thing the issue
   this implements said must never exist. No assertion about the arithmetic
   catches that.

   Minimal DOM + Obsidian stub, same shape as rule-cleanup-modal.test.cjs, but
   with event listeners actually RECORDED — the boxes have to be clickable here,
   where that test only ever needed buttons.

   Wired into ./build.sh via the tests/*.test.cjs glob.
     node tests/reslice.test.cjs
*/

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* --------------------------------- DOM ---------------------------------- */
class FakeEl {
  constructor(tag, o = {}) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = []; this.attrs = {}; this._cls = new Set(); this._text = '';
    this._on = {};
    this.checked = false;
    if (o.text != null) this._text = String(o.text);
    if (o.cls) for (const c of [].concat(o.cls)) String(c).split(/\s+/).filter(Boolean).forEach(x => this._cls.add(x));
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  setText(v) { this.textContent = v; }
  empty() { this.children = []; this._text = ''; }
  createEl(tag, o = {}) { const n = new FakeEl(tag, o); this.children.push(n); return n; }
  createDiv(o) { return this.createEl('div', typeof o === 'string' ? { cls: o } : (o || {})); }
  append(...kids) { for (const k of kids.flat()) { if (k == null) continue; this.children.push(k?.tagName ? k : new FakeEl('span', { text: k })); } }
  appendChild(n) { this.children.push(n); return n; }
  addClass(...c) { c.forEach(x => this._cls.add(x)); }
  hasClass(c) { return this._cls.has(c); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(ev, fn) { (this._on[ev] = this._on[ev] || []).push(fn); }
  fire(ev) { for (const fn of this._on[ev] || []) fn({}); }
}
global.document = { createElement: tag => new FakeEl(tag), createTextNode: t => new FakeEl('span', { text: t }) };

function all(el, pred, out = []) {
  for (const c of el.children) { if (pred(c)) out.push(c); all(c, pred, out); }
  return out;
}
const byClass = (el, cls) => all(el, e => e.hasClass && e.hasClass(cls));

/* ------------------------------ obsidian -------------------------------- */
class Modal {
  constructor(app) { this.app = app; this.contentEl = new FakeEl('div'); this.titleEl = new FakeEl('div'); }
  open() { this.onOpen(); }
  close() { this.onClose(); }
}
class Setting {
  constructor(container) {
    this.settingEl = new FakeEl('div', { cls: 'setting-item' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    container.appendChild(this.settingEl);
  }
  setName() { return this; }
  setDesc() { return this; }
  addButton(cb) {
    const el = this.controlEl.createEl('button');
    const c = {
      buttonEl: el,
      setButtonText(t) { el.textContent = t; return c; },
      setCta() { el.addClass('mod-cta'); return c; },
      setWarning() { el.addClass('mod-warning'); return c; },
      setDisabled(v) { el._disabled = !!v; return c; },
      onClick(fn) { el._onClick = fn; return c; },
    };
    cb(c); return this;
  }
}
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { Modal, Setting, setIcon() {} };
  return origLoad.call(this, req, ...rest);
};

const { inferIntervalFromKeys, resliceBudget, roundCents } = require('../src/reslice');
const { BudgetResliceModal } = require('../src/modal');

/* ====================== inferring the old cycle length =================== */
{
  eq(inferIntervalFromKeys(['2026-07-24', '2026-08-07']), 14,
    'two consecutive starts are one cycle apart — that gap IS the old length');
  eq(inferIntervalFromKeys(['2026-08-07']), null,
    'one file gives no gap, and a guess here would scale every amount by a made-up factor');
  eq(inferIntervalFromKeys([]), null, 'nor does an empty list invent one');

  // Out of order on purpose: Object.keys order is not a promise.
  eq(inferIntervalFromKeys(['2026-08-21', '2026-07-24', '2026-08-07']), 14,
    'the keys are sorted before differencing, not trusted in the order they arrive');

  /* A vault that skipped a period shows 14 and 28. Only the smaller is a cycle:
     taking the first gap, or the largest, would double every suggestion. */
  eq(inferIntervalFromKeys(['2026-07-10', '2026-07-24', '2026-08-21']), 14,
    'a skipped period does not stretch the inferred length');

  eq(inferIntervalFromKeys(['2026-08', '2026-09']), null,
    'month names are not date starts — differencing them would be meaningless');
  eq(inferIntervalFromKeys(['2026-08-07', '2026-08-07']), null,
    'a duplicate is a zero gap, not a zero-day cycle');
  eq(inferIntervalFromKeys(['2026-07-31', '2026-08-07']), 7, 'and a weekly cycle reads as 7');
}

/* ============================== the rounding ============================= */
{
  eq(roundCents(12.344), 12.34, 'cents round down');
  eq(roundCents(12.345), 12.35, 'and half rounds up');
  eq(roundCents(-12.345), -12.35,
    'half away from zero on the negative side too — Math.round would give -12.34');
  eq(roundCents(-0.001), -0, 'and a hair below zero does not become a signed -0.01');
}

/* ========================= the suggestion arithmetic ==================== */
const ROWS = [
  { category: 'Groceries', type: 'expense', amount: 4000, notes: 'weekly shop' },
  { category: 'Rent', type: 'expense', amount: 12000, notes: '' },
  { category: 'Salary', type: 'income', amount: 30000, notes: '' },
];
{
  const p = resliceBudget({ rows: ROWS, oldDays: 31, dstDays: 14 });
  eq(p.oldDays, 31, 'the plan reports what it scaled from');
  eq(p.dstDays, 14, 'and what it scaled to');
  ok(Math.abs(p.factor - 14 / 31) < 1e-12, 'the factor is dst/old, nothing cleverer');
  eq(p.rows.map(r => r.suggested), [1806.45, 5419.35, 13548.39],
    'every row is the old amount pro-rata, rounded to cents');
  ok(p.rows.every(r => r.scaled), 'and each is flagged as genuinely scaled');
  eq(p.rows.map(r => r.oldAmount), [4000, 12000, 30000],
    'the old amount travels with it — the reader is comparing, not trusting');
  eq(p.rows[0].notes, 'weekly shop', 'notes come across so an accepted line keeps its context');
}
{
  // The doubling case, where the arithmetic is easy to eyeball.
  const p = resliceBudget({ rows: ROWS, oldDays: 7, dstDays: 14 });
  eq(p.rows.map(r => r.suggested), [8000, 24000, 60000], '7 → 14 doubles every line exactly');
}

/* ================= an old length that cannot be known =================== */
{
  const p = resliceBudget({ rows: ROWS, oldDays: null, dstDays: 14 });
  eq(p.factor, null, 'no inferred length means no factor');
  eq(p.oldDays, null, 'and the plan says so rather than filling in a plausible number');
  eq(p.rows.map(r => r.suggested), [null, null, null],
    'no suggestion is offered — a factor of 1 dressed up as a re-slice is the silent conversion');
  ok(p.rows.every(r => !r.scaled), 'and every row is flagged as NOT scaled');
  eq(p.rows.map(r => r.oldAmount), [4000, 12000, 30000],
    'the old amounts are still shown — they may well be what the reader wants');

  for (const bad of [0, -14, NaN, undefined, 'fourteen']) {
    ok(!resliceBudget({ rows: ROWS, oldDays: bad, dstDays: 14 }).factor,
      `${JSON.stringify(bad)} days is not a length to divide by`);
    ok(!resliceBudget({ rows: ROWS, oldDays: 31, dstDays: bad }).factor,
      `${JSON.stringify(bad)} days is not a length to scale to`);
  }
}

/* ============ a category already budgeted for THIS period =============== */
{
  const p = resliceBudget({ rows: ROWS, oldDays: 31, dstDays: 14, existingByCategory: { Rent: 5500 } });
  const rent = p.rows.find(r => r.category === 'Rent');
  eq(rent.existing, 5500, 'work already done for this period is carried into the plan');
  ok(rent.hasExisting, 'and flagged, so the modal can say what ticking it would replace');
  ok(!p.rows.find(r => r.category === 'Groceries').hasExisting,
    'while an untouched category is not');
}

/* ========================= the modal: the gate ========================== */
const money = n => 'R' + Number(n).toFixed(2);
function open(plan, opts = {}) {
  let resolved;
  let settled = false;
  const m = new BudgetResliceModal({}, plan, { money, sourceLabel: '2026-08-07', ...opts },
    v => { resolved = v; settled = true; });
  m.open();
  const c = m.contentEl;
  return {
    m, c,
    rows: byClass(c, 'budget-reslice-row'),
    boxes: all(c, e => e.tagName === 'INPUT'),
    buttons: all(c, e => e.tagName === 'BUTTON'),
    apply: () => all(c, e => e.tagName === 'BUTTON').find(b => b.hasClass('mod-cta')),
    all: () => all(c, e => e.tagName === 'BUTTON').find(b => /Accept all|Clear all/.test(b.textContent)),
    result: () => { ok(settled, 'the modal resolved'); return resolved; },
  };
}

{
  const plan = resliceBudget({ rows: ROWS, oldDays: 31, dstDays: 14 });
  const v = open(plan);

  eq(v.rows.length, 3, 'every row is listed — a truncated list hides the line worth checking');
  eq(v.boxes.length, 3, 'and each carries its own box');
  ok(v.boxes.every(b => b.checked === false),
    'EVERY box starts unticked — a pre-ticked preview is a bulk conversion with extra steps');
  ok(v.apply()._disabled, 'and the apply button is disabled until something is accepted');

  const txt = v.c.textContent;
  ok(txt.includes('31 days') && txt.includes('14'), 'the lead states both lengths');
  ok(txt.includes('14/31'), 'and shows the factor rather than just asserting a number');
  ok(/right for something like groceries and wrong for a rent/.test(txt),
    'and says plainly where a flat pro-rata is the wrong answer');
  ok(txt.includes('R4000.00') && txt.includes('R1806.45'),
    'each row shows old and new, so the reader is comparing rather than trusting');
}

/* --------- only the accepted lines come back, with the SCALED figure ----- */
{
  const plan = resliceBudget({ rows: ROWS, oldDays: 31, dstDays: 14 });
  const v = open(plan);
  v.boxes[0].checked = true; v.boxes[0].fire('change');
  ok(!v.apply()._disabled, 'accepting one line enables the button');
  ok(/Bring 1 amount across/.test(v.apply().textContent), 'which names the count, singular');

  v.boxes[2].checked = true; v.boxes[2].fire('change');
  ok(/Bring 2 amounts across/.test(v.apply().textContent), 'and plural');

  v.apply()._onClick();
  eq(v.result(), [
    { category: 'Groceries', amount: 1806.45, notes: 'weekly shop' },
    { category: 'Salary', amount: 13548.39, notes: '' },
  ], 'exactly the ticked rows come back, carrying the SCALED amount');
}

/* ------------------- untick puts a line back out of scope --------------- */
{
  const v = open(resliceBudget({ rows: ROWS, oldDays: 7, dstDays: 14 }));
  v.boxes[1].checked = true; v.boxes[1].fire('change');
  v.boxes[1].checked = false; v.boxes[1].fire('change');
  ok(v.apply()._disabled, 'unticking the only accepted line disables the button again');
}

/* ------------------------- cancel and dismiss --------------------------- */
{
  const plan = resliceBudget({ rows: ROWS, oldDays: 31, dstDays: 14 });

  const cancelled = open(plan);
  cancelled.boxes[0].checked = true; cancelled.boxes[0].fire('change');
  cancelled.buttons.find(b => b.textContent === 'Cancel')._onClick();
  eq(cancelled.result(), null, 'cancel resolves null even with lines ticked — nothing is written');

  const dismissed = open(plan);
  dismissed.boxes[0].checked = true; dismissed.boxes[0].fire('change');
  dismissed.m.close();
  eq(dismissed.result(), null, 'and dismissing the box resolves null too');

  const empty = open(plan);
  empty.apply()._onClick();
  ok(!empty.m.answer, 'clicking apply with nothing accepted cannot resolve a list');
}

/* ----------------------------- accept all ------------------------------- */
{
  const v = open(resliceBudget({ rows: ROWS, oldDays: 7, dstDays: 14 }));
  v.all().fire('click');
  ok(v.boxes.every(b => b.checked), 'accept-all ticks every box');
  ok(/Bring 3 amounts across/.test(v.apply().textContent), 'and the count follows');
  eq(v.all().textContent, 'Clear all', 'the control flips to its inverse once everything is on');
  v.all().fire('click');
  ok(v.boxes.every(b => !b.checked), 'and clears them again');
  ok(v.apply()._disabled, 'leaving nothing accepted');
}

/* ------------- unknown length: a copy, and it says it is one ------------ */
{
  const v = open(resliceBudget({ rows: ROWS, oldDays: null, dstDays: 14 }));
  const txt = v.c.textContent;
  ok(/UNCHANGED, not re-sliced/.test(txt), 'the lead says plainly that nothing was scaled');
  ok(!txt.includes('×'), 'and shows no factor, because there is none');
  v.boxes[1].checked = true; v.boxes[1].fire('change');
  v.apply()._onClick();
  eq(v.result(), [{ category: 'Rent', amount: 12000, notes: '' }],
    'an accepted line carries the old amount verbatim');
}

/* ------------------- a row that would overwrite work -------------------- */
{
  const plan = resliceBudget({ rows: ROWS, oldDays: 31, dstDays: 14, existingByCategory: { Rent: 5500 } });
  const v = open(plan);
  ok(/already set to R5500.00 for this period — ticking this replaces it/.test(v.c.textContent),
    'a category already budgeted here says what accepting it would cost');
  ok(v.boxes.every(b => b.checked === false), 'and is no more pre-ticked than any other row');
}

/* ------------------------------ no rows -------------------------------- */
{
  const v = open(resliceBudget({ rows: [], oldDays: 31, dstDays: 14 }));
  ok(/no amounts to bring across/.test(v.c.textContent), 'an empty budget says so');
  eq(v.buttons.length, 1, 'and offers only a way out');
  v.m.close();
  eq(v.result(), null, 'resolving null, like every other non-acceptance');
}

console.log(`PASS — budget re-slice: suggestions are pro-rata, and nothing crosses unaccepted (${checks} assertions).`);
