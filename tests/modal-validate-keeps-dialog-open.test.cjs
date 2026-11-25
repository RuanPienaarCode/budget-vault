'use strict';
/* A form dialog that refuses an answer stays open, with everything typed.

   Every form behind askFields validated AFTER the dialog had closed. A missing
   description, note title or account name, or a mistyped amount, closed the
   dialog with a toast and threw away everything else the reader had entered —
   a long note body included (2026-11-25 audit, FUN-1). The check has to run
   while the form is still on screen, which only the dialog can arrange, so
   askFields now takes `validate(values)`.

   Pinned here, through the real FieldModal over Obsidian's shipped markup
   (tests/helpers/modal-stub.cjs):

     1. a hook that returns a message keeps the dialog open: the promise does
        not settle, the dialog is not closed, and every value is as typed
     2. the message is printed in the dialog, as an alert, under the field it
        names when it names one, and that field takes focus and is marked
        aria-invalid
     3. a hook that names no field (a bare string) still refuses, prints the
        message, and puts nothing out of place
     4. editing the field clears the message and the mark; editing a DIFFERENT
        field leaves a message about the first one standing
     5. correcting the value and pressing OK again resolves with ALL the values,
        including the ones typed before the first refusal
     6. Enter submits through the same gate; Cancel resolves null whatever the
        hook would say
     7. the hook is handed a copy: mutating it changes neither the form nor the
        resolved values
     8. a dialog with NO hook is exactly what it was: no message element, and
        OK resolves at once (the thirty callers that pass nothing)

     node tests/modal-validate-keeps-dialog-open.test.cjs */

const assert = require('assert');
const { stubModalObsidian, byTag, El } = require('./helpers/modal-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { Modal } = stubModalObsidian();
const { askFields } = require('../src/modal');

/* Element.after(), which the stub's elements lack: moves the node to sit right
   behind this one in its parent, as the DOM method does. */
El.prototype.after = function after(node) {
  if (node._parent) node._parent.children = node._parent.children.filter(c => c !== node);
  const sibs = this._parent.children;
  sibs.splice(sibs.indexOf(this) + 1, 0, node);
  node._parent = this._parent;
};

const FIELDS = () => [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'about', label: 'About', type: 'select', options: ['a', 'b'], value: 'a' },
  { key: 'body', label: 'Note', type: 'textarea' },
  { key: 'amount', label: 'Amount', type: 'number' },
];

const tick = () => new Promise(r => setImmediate(r));

function open(validate) {
  const state = { settled: false, value: undefined };
  const opts = validate ? { validate } : undefined;
  askFields({}, 'New note', FIELDS(), opts).then(v => { state.settled = true; state.value = v; });
  const m = Modal.last;
  const c = m.contentEl;
  const inputs = byTag(c, 'input');
  const d = {
    m, state, c,
    title: inputs[0], amount: inputs[1],
    textarea: byTag(c, 'textarea')[0],
    buttons: byTag(c, 'button'),
    focused: [],
  };
  for (const el of [d.title, d.amount, d.textarea]) el.focus = () => d.focused.push(el);
  d.type = (el, v) => { el.value = v; el._change(v); };
  d.ok = () => d.buttons[1]._onClick();
  d.cancel = () => d.buttons[0]._onClick();
  d.alert = () => byTag(c, 'div').find(e => e.attrs && e.attrs.role === 'alert') || null;
  return d;
}

(async () => {
  const needTitle = v => ((v.title || '').trim() ? null : { field: 'title', message: 'A note needs a title' });

  /* ---- 1-2. a refusal keeps the dialog open and names the field ---------- */
  {
    const d = open(needTitle);
    d.type(d.textarea, 'Three paragraphs of the reader\'s own writing.');
    d.type(d.amount, '12.50');
    d.ok();
    await tick();
    eq(d.state.settled, false, 'the promise has not settled — nothing is thrown away');
    eq(d.m.isOpen, true, 'and the dialog is still open');
    eq(d.textarea.value, 'Three paragraphs of the reader\'s own writing.', 'the note body is still in its box');
    const a = d.alert();
    ok(a, 'the message has a place in the dialog, announced as an alert');
    eq(a.textContent, 'A note needs a title', 'and it says what is wrong');
    eq(d.focused, [d.title], 'focus is on the field at fault');
    eq(d.title.getAttribute('aria-invalid'), 'true', 'which is marked invalid for a screen reader');
    const rows = d.c.children;
    const titleRow = rows.find(r => r.children.length && byTag(r, 'input')[0] === d.title);
    ok(titleRow && rows[rows.indexOf(titleRow) + 1] === a,
      'the message sits directly under that field, not at the other end of a tall form');

    /* ---- 5. fix it, press OK, and ALL the values arrive ------------------- */
    d.type(d.title, 'Bank call');
    eq(a.textContent, '', '4. editing the field clears the message');
    eq(d.title.getAttribute('aria-invalid'), null, 'and the invalid mark');
    d.ok();
    await tick();
    eq(d.state.settled, true, 'the corrected form resolves');
    eq(d.state.value, {
      title: 'Bank call', about: 'a', body: 'Three paragraphs of the reader\'s own writing.', amount: '12.50',
    }, 'with the values typed before the refusal as well as after it');
    eq(d.m.isOpen, false, 'and only then closes');
  }

  /* ---- 3. a bare string refuses without naming a field ------------------- */
  {
    const d = open(() => 'Nothing here adds up');
    d.type(d.amount, '5');
    d.ok();
    await tick();
    eq([d.state.settled, d.m.isOpen], [false, true], 'a string verdict refuses too');
    eq(d.alert().textContent, 'Nothing here adds up', 'and prints it');
    eq(d.focused, [], 'with no field to name, focus is not moved anywhere');
    eq(byTag(d.c, 'input').some(i => i.getAttribute('aria-invalid')), false, 'and nothing is marked invalid');
    d.type(d.amount, '6');
    eq(d.alert().textContent, '', 'any edit clears a message that names no field');
    d.cancel();
    await tick();
  }

  /* ---- 4. editing ANOTHER field leaves the message standing -------------- */
  {
    const d = open(needTitle);
    d.ok();
    await tick();
    d.type(d.amount, '9');
    eq(d.alert().textContent, 'A note needs a title',
      'a message about the title is not cleared by typing in the amount');
    eq(d.title.getAttribute('aria-invalid'), 'true', 'nor is the title unmarked');
    d.cancel();
    await tick();
  }

  /* ---- 6. Enter goes through the same gate; Cancel is never gated -------- */
  {
    const d = open(needTitle);
    const r = d.m.press('Enter', d.title);
    await tick();
    eq([r.prevented, r.closed, d.state.settled], [true, false, false],
      'Enter in a field is a submit, and it is refused like the button');
    eq(d.alert().textContent, 'A note needs a title', 'with the same message');
    d.cancel();
    await tick();
    eq(d.state.value, null, 'Cancel resolves null although the hook would have refused');
  }

  /* ---- 7. the hook is handed a copy -------------------------------------- */
  {
    let seen = null;
    const d = open(v => { seen = v; v.title = 'tampered'; return null; });
    d.type(d.title, 'Real');
    d.ok();
    await tick();
    eq(d.state.value.title, 'Real', 'a hook that edits its argument changes nothing that resolves');
    eq(seen.title, 'tampered', 'and it did get a value object to edit');
  }

  /* ---- 8. no hook: the dialog it always was ------------------------------ */
  {
    const d = open(null);
    eq(d.alert(), null, 'no hook, no message element');
    d.ok();
    await tick();
    eq(d.state.settled, true, 'OK resolves at once');
    eq(d.state.value.title, '', 'with whatever was typed, blank included — the caller still decides');
  }

  console.log(`PASS modal-validate-keeps-dialog-open — a refused answer keeps the form open with everything typed (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
