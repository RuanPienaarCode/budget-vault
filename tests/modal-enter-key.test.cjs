'use strict';
/* Enter submits a dialog from a text field, and from nowhere else.

   FieldModal registers Enter on its scope so a reader can type a name and
   press Enter rather than reach for OK. The handler let one control off —
   a <textarea>, where Enter is a new paragraph — and then prevented the
   default and submitted for every other target. Obsidian runs scope handlers
   from a keydown listener on `window` in the capture phase, so that handler
   sees the key BEFORE the control that has focus. A keyboard user who tabbed
   to Cancel and pressed Enter therefore SAVED the form: the button's own
   activation never ran, and the one control whose whole meaning is "do not do
   this" did it (audit of 11 Nov 2026, task 14). Thirty-two askFields call
   sites sit behind this dialog, several of them deletes and bulk edits.

   The same held for a dropdown, where Enter is how an open list is committed
   on Windows and Linux, and for a toggle, whose own keydown turns Enter into a
   flip: the choice was made and the dialog closed in the same keystroke.

   Pinned here, through the real FieldModal over Obsidian's shipped markup
   (tests/helpers/modal-stub.cjs):

     1. Enter on Cancel is left to the button: not prevented, not submitted.
     2. Enter on OK is left to the button too (its own click submits).
     3. Enter on a dropdown, a toggle and the checkbox inside one are left
        alone. The checkbox is the tab stop in Obsidian's older toggle markup,
        the <label> around it in the current one.
     4. Enter in a textarea is still a new line.
     5. Enter in a text, number or date field still submits with the values.
     6. Enter with nothing focusable under it (the dialog body) still submits,
        so a reader who clicked the dialog's padding is not stranded.

     node tests/modal-enter-key.test.cjs */

const assert = require('assert');
const { stubModalObsidian, byTag } = require('./helpers/modal-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { Modal } = stubModalObsidian();
const { askFields } = require('../src/modal');

const FIELDS = () => [
  { key: 'name', label: 'Name', type: 'text', value: 'Rent' },
  { key: 'amount', label: 'Amount', type: 'number', value: '12' },
  { key: 'due', label: 'Due', type: 'date', value: '2026-11-25' },
  { key: 'kind', label: 'Kind', type: 'select', options: ['a', 'b'], value: 'a' },
  { key: 'mute', label: 'Mute', type: 'toggles', options: [{ value: 'x', label: 'Low balance' }] },
  { key: 'body', label: 'Note', type: 'textarea' },
];

/* Opens the dialog and reports whether its promise has settled, without
   waiting on it: an unsettled promise is the assertion in half these cases. */
function open() {
  const state = { settled: false, value: undefined };
  askFields({}, 'Edit', FIELDS()).then(v => { state.settled = true; state.value = v; });
  const m = Modal.last;
  const c = m.contentEl;
  return {
    m, state,
    buttons: byTag(c, 'button'),
    inputs: byTag(c, 'input'),
    select: byTag(c, 'select')[0],
    textarea: byTag(c, 'textarea')[0],
    toggle: byTag(c, 'label')[0],
  };
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  /* ---- 1. Cancel keeps its own Enter ------------------------------------ */
  {
    const d = open();
    const [cancel] = d.buttons;
    eq(cancel.textContent, 'Cancel', 'the first button is Cancel');
    const r = d.m.press('Enter', cancel);
    await tick();
    eq(r.prevented, false, 'Enter on Cancel is not prevented, so the button still gets its click');
    eq(r.closed, false, 'and the dialog does not close on the dialog handler\'s say-so');
    eq(d.state.settled, false, 'so nothing was submitted');
    // What the browser does next with the key it was left: the button's click.
    cancel._onClick();
    await tick();
    eq(d.state.value, null, 'Cancel then cancels: the caller gets null, not the form');
  }

  /* ---- 2. OK keeps its own Enter ---------------------------------------- */
  {
    const d = open();
    const okBtn = d.buttons[1];
    eq(okBtn.textContent, 'OK', 'the second button is OK');
    const r = d.m.press('Enter', okBtn);
    await tick();
    eq([r.prevented, r.closed], [false, false], 'Enter on OK is left to the button as well');
    okBtn._onClick();
    await tick();
    eq(d.state.value && d.state.value.name, 'Rent', 'and its own click submits the form');
  }

  /* ---- 3. dropdown, toggle, the checkbox inside a toggle ---------------- */
  for (const [what, pick] of [
    ['a dropdown', d => d.select],
    ['a toggle', d => d.toggle],
    ['the checkbox inside a toggle', d => d.inputs.find(i => i.type === 'checkbox')],
  ]) {
    const d = open();
    const target = pick(d);
    ok(target, `the dialog has ${what}`);
    const r = d.m.press('Enter', target);
    await tick();
    eq([r.prevented, r.closed, d.state.settled], [false, false, false], `Enter on ${what} is left to the control and submits nothing`);
    d.m.close();
  }

  /* ---- 4. a textarea keeps its new line --------------------------------- */
  {
    const d = open();
    const r = d.m.press('Enter', d.textarea);
    await tick();
    eq([r.prevented, r.closed], [false, false], 'Enter in a textarea is a new line, as before');
    d.m.close();
  }

  /* ---- 5. a text field still submits ------------------------------------ */
  for (const type of ['text', 'number', 'date']) {
    const d = open();
    const input = d.inputs.find(i => i.type === type);
    ok(input, `the dialog has a ${type} field`);
    const r = d.m.press('Enter', input);
    await tick();
    eq([r.prevented, r.closed], [true, true], `Enter in a ${type} field submits`);
    eq(d.state.value && d.state.value.name, 'Rent', `and the caller gets the values (${type})`);
  }

  /* ---- 6. nothing focusable under the key ------------------------------- */
  {
    const d = open();
    const r = d.m.press('Enter', d.m.contentEl);
    await tick();
    eq([r.prevented, r.closed], [true, true], 'Enter on the dialog body still submits');
  }
  {
    const d = open();
    const r = d.m.press('Enter', undefined);
    await tick();
    eq(r.closed, true, 'and so does a key event with no target at all');
  }

  console.log(`PASS modal-enter-key — Enter submits from a text field and leaves every other control its own key (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
