'use strict';
/* The cleanup preview actually renders — and says the right number.

   analyseRules is tested to death next door, but the whole safety story of
   this feature is "the user reads what will be deleted and agrees". A modal
   that throws on open, lists the wrong rules, or wires the destructive button
   to the wrong branch turns a verified cleanup into a blind one, and no
   assertion about the analysis catches that.

   Three things pinned here:

     • it opens without a real DOM or a real Obsidian (so a typo in the render
       path is a build failure, not a bug report from a phone)
     • EVERY removal is listed — not a sample — because a truncated list means
       the one rule the user wanted to check is the one they cannot see
     • it resolves false unless the destructive button is the thing clicked,
       including when the box is simply closed

   Minimal DOM + Obsidian stub, same shape as onboarding-render.test.cjs.
   Wired into ./build.sh via the tests/*.test.cjs glob.
     node tests/rule-cleanup-modal.test.cjs
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
    // dom.js el() branches on nodeType to tell an element child from a string.
    // Without it every nested element is wrapped as a text node and the whole
    // structure flattens — which is exactly how this stub failed first time.
    this.nodeType = 1;
    this.children = []; this.attrs = {}; this._cls = new Set(); this._text = '';
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
  append(...kids) { for (const k of kids.flat()) this.children.push(k?.tagName ? k : new FakeEl('span', { text: k })); }
  appendChild(n) { this.children.push(n); return n; }
  addClass(...c) { c.forEach(x => this._cls.add(x)); }
  hasClass(c) { return this._cls.has(c); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() {}
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

const { RulesCleanupModal } = require('../src/modal');
const { analyseRules } = require('../src/rule-cleanup');

/* Open a modal against a report and hand back the rendered tree + a resolver. */
function open(report) {
  let resolved = null;
  const m = new RulesCleanupModal({}, report, v => { resolved = v; });
  m.open();
  return { m, c: m.contentEl, buttons: all(m.contentEl, e => e.tagName === 'BUTTON'),
    result: () => resolved };
}

/* ============================ nothing to do ============================= */
{
  const report = analyseRules([{ pattern: 'CORNER MART', category: 'Groceries' }], ['CORNER MART CENTRAL']);
  const { m, c, buttons, result } = open(report);
  ok(/Nothing to remove/.test(c.textContent), 'a clean rule set says so plainly');
  eq(buttons.length, 1, 'and offers only a way out, no destructive button');
  m.close();
  eq(result(), false, 'closing the clean state resolves false');
}

/* ======================= a report with removals ========================= */
{
  const rules = [
    { pattern: 'CORNER MART', category: 'Groceries' },
    { pattern: 'CORNER MART CENTRAL', category: 'Groceries' },
    { pattern: 'CORNER MART NORTH', category: 'Groceries' },
    { pattern: 'NEVER BILLED YET', category: 'Medical' },
  ];
  const descs = ['CORNER MART CENTRAL 1', 'CORNER MART NORTH 2'];
  const report = analyseRules(rules, descs);
  eq(report.remove.length, 2, 'fixture removes exactly two rules');

  const { c, buttons } = open(report);
  const rows = byClass(c, 'budget-tidy-row');
  eq(rows.length, report.remove.length, 'every removal is listed, not a sample');

  const listed = byClass(c, 'budget-tidy-pattern').map(e => e.textContent).sort();
  eq(listed, ['CORNER MART CENTRAL', 'CORNER MART NORTH'],
    'the listed patterns are exactly the ones that would be deleted');

  const why = byClass(c, 'budget-tidy-why').map(e => e.textContent).join(' ');
  ok(why.includes('already covered by'), 'each row says which rule covers it');
  ok(why.includes('Groceries'), 'and which category it resolves to');

  ok(c.textContent.includes('2 of 4 rules can go'), 'the headline counts match the report');
  ok(/NEVER BILLED YET|matches? nothing/i.test(c.textContent),
    'the dormant rule is disclosed as kept rather than silently omitted');

  const remove = buttons.find(b => b.hasClass('mod-warning'));
  ok(remove, 'the destructive action is marked as a warning');
  ok(/Remove 2 rules/.test(remove.textContent), 'and names the count it will delete');
}

/* ===================== the button wiring, both ways ===================== */
{
  const rules = [
    { pattern: 'CORNER MART', category: 'Groceries' },
    { pattern: 'CORNER MART CENTRAL', category: 'Groceries' },
  ];
  const report = analyseRules(rules, ['CORNER MART CENTRAL 1']);

  const cancelled = open(report);
  cancelled.buttons.find(b => !b.hasClass('mod-warning'))._onClick();
  eq(cancelled.result(), false, 'cancel resolves false — nothing is deleted');

  const closed = open(report);
  closed.m.close();
  eq(closed.result(), false, 'dismissing without choosing resolves false');

  const confirmed = open(report);
  confirmed.buttons.find(b => b.hasClass('mod-warning'))._onClick();
  eq(confirmed.result(), true, 'only the remove button resolves true');
}

/* ===================== singular/plural, since it is user-facing ========== */
{
  const rules = [
    { pattern: 'CORNER MART', category: 'Groceries' },
    { pattern: 'CORNER MART CENTRAL', category: 'Groceries' },
  ];
  const { buttons } = open(analyseRules(rules, ['CORNER MART CENTRAL 1']));
  ok(/Remove 1 rule\b/.test(buttons.find(b => b.hasClass('mod-warning')).textContent),
    'one rule is "1 rule", not "1 rules"');
}

Module._load = origLoad;
console.log(`PASS — cleanup preview renders and gates the delete (${checks} assertions).`);
