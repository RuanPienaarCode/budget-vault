'use strict';
/* confirmModal can mark its SAFE answer as the one to press.

   The confirmation dialog draws one style only: the confirm button as a
   warning, the cancel button plain. That is right where confirming is the
   risky act and declining is just leaving. It is wrong for the Transactions
   page's rule-fix question — "Update the matching rule too?" — where the
   answer the page wants a reader to reach for is the cancel side, "Just this
   row" (it is also where Escape and tapping outside resolve), and the confirm
   side repoints a rule deciding every future import. The page had to settle
   for a warning-red "Update the rule" sitting beside a plain "Just this row":
   the risky act marked, the safe one not offered as the default (2026-10-07
   audit, RULEFIX carry-over).

   `primary: 'cancel'` gives the cancel button Obsidian's call-to-action style
   and leaves the confirm button plain. Without it nothing changes. The answer
   is still true only when the confirm button is the one pressed.

   Real ConfirmModal over a minimal Obsidian + DOM stub (rule-cleanup-modal's).
     node tests/modal-confirm-primary.test.cjs */

const assert = require('assert');
const Module = require('module');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

class FakeEl {
  constructor(tag, o = {}) {
    this.tagName = String(tag).toUpperCase(); this.nodeType = 1;
    this.children = []; this.attrs = {}; this._cls = new Set(); this._text = o.text != null ? String(o.text) : '';
  }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  setText(v) { this.textContent = v; }
  empty() { this.children = []; this._text = ''; }
  createEl(tag, o = {}) { const n = new FakeEl(tag, o); this.children.push(n); return n; }
  createDiv(o) { return this.createEl('div', o || {}); }
  append(...kids) { for (const k of kids.flat()) this.children.push(k && k.tagName ? k : new FakeEl('span', { text: k })); }
  appendChild(n) { this.children.push(n); return n; }
  addClass(...c) { c.forEach(x => this._cls.add(x)); }
  hasClass(c) { return this._cls.has(c); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() {}
}
global.document = { createElement: tag => new FakeEl(tag), createTextNode: t => new FakeEl('span', { text: t }) };

class Modal {
  constructor(app) { this.app = app; this.contentEl = new FakeEl('div'); this.titleEl = new FakeEl('div'); }
  open() { this.onOpen(); Modal.last = this; }
  close() { this.onClose(); }
}
class Setting {
  constructor(container) { this.el = container.createDiv(); }
  addButton(cb) {
    const el = this.el.createEl('button');
    const c = {
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
  if (req === 'obsidian') return { Modal, Setting };
  return origLoad.call(this, req, ...rest);
};
const { confirmModal } = require('../src/modal');

const buttons = m => {
  const out = [];
  const walk = e => { for (const c of e.children) { if (c.tagName === 'BUTTON') out.push(c); walk(c); } };
  walk(m.contentEl);
  return out;
};
const style = b => ['mod-cta', 'mod-warning'].filter(c => b.hasClass(c));

(async () => {
  /* ---- the default is unchanged: the confirm is the warning ------------- */
  {
    const p = confirmModal({}, { title: 'Delete?', message: 'x', confirmText: 'Delete' });
    const [cancel, confirm] = buttons(Modal.last);
    eq([cancel.textContent, confirm.textContent], ['Cancel', 'Delete'], 'cancel first, then confirm, as always');
    eq([style(cancel), style(confirm)], [[], ['mod-warning']], 'with no option, the confirm button is the warning and cancel is plain');
    confirm._onClick();
    eq(await p, true, 'pressing confirm resolves true');
  }

  /* ---- primary: 'cancel' puts the call to action on the safe answer ------ */
  {
    const p = confirmModal({}, { title: 'Update the matching rule too?', message: 'x', cancelText: 'Just this row', confirmText: 'Update the rule', primary: 'cancel' });
    const [cancel, confirm] = buttons(Modal.last);
    eq(style(cancel), ['mod-cta'], '"Just this row" carries the call-to-action style');
    eq(style(confirm), [], 'and "Update the rule" is plain — neither the default nor marked as a warning');
    cancel._onClick();
    eq(await p, false, 'pressing the styled cancel still resolves false');
  }
  {
    const p = confirmModal({}, { message: 'x', primary: 'cancel' });
    const [, confirm] = buttons(Modal.last);
    confirm._onClick();
    eq(await p, true, 'the plain confirm is still the only way to a true');
  }
  {
    const p = confirmModal({}, { message: 'x', primary: 'cancel' });
    Modal.last.close();
    eq(await p, false, 'closing the dialog any other way resolves false');
  }
  ok(true, 'done');
  console.log(`PASS modal-confirm-primary — a confirmation can mark its safe answer as the one to press (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
