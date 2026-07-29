'use strict';
/* dateInput / keepScroll guard.

   dateInput decides between a native <input type="date"> — the picker, and no
   soft keyboard for iOS autocorrect to interfere with — and a plain text field.
   That branch is the whole point: these markdown files are hand-editable, and a
   date input renders anything it can't parse as BLANK, so committing a field
   that had held "end of October" would silently destroy it. This test pins:

     1. empty and ISO values get the picker,
     2. free text falls back to text, verbatim, with correction features off,
     3. caller attrs still apply and can override,
     4. commit receives the trimmed value and the event.

   keepScroll exists because rebuilding a table's innerHTML resets its scroll
   container to the left edge — on a phone every table here is wider than the
   screen, so that yanks the columns out from under the reader.

   Runs in bare node with a minimal DOM stub. Wired into ./build.sh.
     node tests/date-input.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const Module = require('module');

// util.js imports `setIcon` from obsidian — stub it so this runs in bare node.
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { setIcon() {}, normalizePath: p => p };
  return origLoad.call(this, req, ...rest);
};

/* Just enough DOM for util.js's `el`: attributes, listeners, children. */
class FakeEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.parentElement = null;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); }
  append(...kids) { this.children.push(...kids); }
  set className(v) { this.attrs.class = v; }
  get className() { return this.attrs.class; }
  fire(type, evt) { for (const fn of this.listeners[type] || []) fn(evt); }
}
global.document = {
  createElement: t => new FakeEl(t),
  createTextNode: text => ({ nodeType: 3, text }),
};

const { dateInput, keepScroll } = require('../src/util');

let n = 0;
const check = (label, fn) => { fn(); n++; if (process.env.VERBOSE) console.log('  ok', label); };

/* ---------------------- 1. picker for empty + ISO ----------------------- */
check('empty value gets the picker', () => {
  const i = dateInput('', {}, () => {});
  assert.strictEqual(i.getAttribute('type'), 'date');
  assert.strictEqual(i.getAttribute('value'), '');
});
check('ISO value gets the picker and keeps its value', () => {
  const i = dateInput('2026-10-20', {}, () => {});
  assert.strictEqual(i.getAttribute('type'), 'date');
  assert.strictEqual(i.getAttribute('value'), '2026-10-20');
});
check('surrounding whitespace does not defeat the ISO test', () => {
  const i = dateInput('  2026-10-20  ', {}, () => {});
  assert.strictEqual(i.getAttribute('type'), 'date');
  assert.strictEqual(i.getAttribute('value'), '2026-10-20');
});
check('null / undefined behave as empty', () => {
  for (const v of [null, undefined]) {
    const i = dateInput(v, {}, () => {});
    assert.strictEqual(i.getAttribute('type'), 'date');
    assert.strictEqual(i.getAttribute('value'), '');
  }
});

/* -------------------- 2. text fallback for free text -------------------- */
check('free text falls back to a text field, verbatim', () => {
  const i = dateInput('end of October', {}, () => {});
  assert.strictEqual(i.getAttribute('type'), 'text');
  assert.strictEqual(i.getAttribute('value'), 'end of October');
});
check('a near-miss date is not treated as ISO', () => {
  // "2026-7-1" would render blank in a date input and be lost on first commit.
  for (const v of ['2026-7-1', '20/10/2026', '2026-10', '2026-13-99x']) {
    assert.strictEqual(dateInput(v, {}, () => {}).getAttribute('type'), 'text', v);
    assert.strictEqual(dateInput(v, {}, () => {}).getAttribute('value'), v, v);
  }
});
check('the text fallback switches off iOS correction features', () => {
  const i = dateInput('end of October', {}, () => {});
  assert.strictEqual(i.getAttribute('placeholder'), 'YYYY-MM-DD');
  assert.strictEqual(i.getAttribute('inputmode'), 'numeric');
  assert.strictEqual(i.getAttribute('autocomplete'), 'off');
  assert.strictEqual(i.getAttribute('autocorrect'), 'off');
  assert.strictEqual(i.getAttribute('autocapitalize'), 'off');
  assert.strictEqual(i.getAttribute('spellcheck'), 'false');
});
check('the picker carries no placeholder or correction attrs', () => {
  const i = dateInput('2026-10-20', {}, () => {});
  for (const k of ['placeholder', 'inputmode', 'autocorrect', 'autocapitalize', 'spellcheck']) {
    assert.strictEqual(i.getAttribute(k), null, k);
  }
});

/* --------------------------- 3. caller attrs ---------------------------- */
check('caller attrs apply, and can override the chosen type', () => {
  const i = dateInput('2026-10-20', { class: 'form-control form-control-sm', style: 'width:120px', 'aria-label': 'Due' }, () => {});
  assert.strictEqual(i.className, 'form-control form-control-sm');
  assert.strictEqual(i.getAttribute('style'), 'width:120px');
  assert.strictEqual(i.getAttribute('aria-label'), 'Due');
  assert.strictEqual(dateInput('2026-10-20', { type: 'text' }, () => {}).getAttribute('type'), 'text');
});

/* ---------------------------- 4. commit --------------------------------- */
check('commit receives the trimmed value and the event', () => {
  let got = null, evt = null;
  const i = dateInput('', {}, (v, e) => { got = v; evt = e; });
  const e = { target: { value: '  2026-10-20  ' } };
  i.fire('change', e);
  assert.strictEqual(got, '2026-10-20');
  assert.strictEqual(evt, e);
});
check('clearing a date commits an empty string, not undefined', () => {
  let got = 'unset';
  // A date input reports '' for a value the browser considers invalid/cleared.
  dateInput('2026-10-20', {}, v => { got = v; }).fire('change', { target: { value: '' } });
  assert.strictEqual(got, '');
});

/* --------------------------- 5. keepScroll ------------------------------ */
check('keepScroll restores the container position across a rebuild', () => {
  const box = { scrollLeft: 240 };
  const tbl = new FakeEl('table');
  tbl.parentElement = box;
  let ran = false;
  keepScroll(tbl, () => { ran = true; box.scrollLeft = 0; });   // what innerHTML='' does
  assert.strictEqual(ran, true);
  assert.strictEqual(box.scrollLeft, 240);
});
check('keepScroll still runs the rebuild when there is no container', () => {
  const tbl = new FakeEl('table');
  let ran = false;
  keepScroll(tbl, () => { ran = true; });
  assert.strictEqual(ran, true);
});

console.log(`PASS — dateInput picker/text branch + keepScroll intact (${n} checks).`);
