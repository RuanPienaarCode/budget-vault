'use strict';
/* Every control in a dialog says what it is.

   FieldModal builds each field as an Obsidian Setting: the label goes through
   setName(), which renders it as a <div class="setting-item-name"> beside the
   control. That is a sibling, not a <label for>, so nothing ties the words to
   the field and a screen reader announced "edit text" with no name on all
   thirty-two dialogs behind askFields (audit of 11 Nov 2026, task 15). The
   wizard's own fields have carried a name since they were written
   (src/onboarding.js sets aria-label); this dialog never did.

   The name is bound to the visible label by reference, so the two cannot
   drift, and a field's hint travels with it as the description. What is
   pinned, through the real FieldModal over Obsidian's shipped markup
   (tests/helpers/modal-stub.cjs):

     1. text, number, date, dropdown and textarea each resolve to their label.
     2. a field with a hint is described by it; a field without one carries no
        description at all, rather than a reference to an empty element.
     3. a toggle is named by its group AND its own label ("Mute warnings" +
        "Low balance"): one word of a row means nothing without its heading.
     4. the toggle's tab stop is the <label>, which has no role of its own, so
        it is given one — and its on/off state, which Obsidian keeps in a
        class. Initial state and every flip after it.
     5. in the older toggle markup the checkbox is the tab stop: it takes the
        name, and its `checked` follows the toggle, since setValue() never
        touched it.
     6. ids are unique across two dialogs opened one after another.

     node tests/modal-field-names.test.cjs */

const assert = require('assert');
const { stubModalObsidian, byTag, byId } = require('./helpers/modal-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const obsidian = stubModalObsidian();
const { Modal } = obsidian;
const { askFields } = require('../src/modal');

/* What a browser computes: aria-labelledby wins over aria-label, and each id
   is resolved against the dialog. A reference to nothing contributes nothing,
   which is the failure a dangling id would be. */
function refText(root, node, attr) {
  const ids = (node.getAttribute(attr) || '').split(/\s+/).filter(Boolean);
  return ids.map(id => { const t = byId(root, id); return t ? t.textContent : `<missing #${id}>`; }).join(' ').trim();
}
const nameOf = (root, node) => refText(root, node, 'aria-labelledby') || node.getAttribute('aria-label') || '';
const descOf = (root, node) => refText(root, node, 'aria-describedby');

const FIELDS = () => [
  { key: 'name', label: 'Service name', type: 'text' },
  { key: 'amount', label: 'Amount per billing cycle', type: 'number', desc: 'What one charge costs.' },
  { key: 'next', label: 'Next billing', type: 'date' },
  { key: 'cycle', label: 'Billing cycle', type: 'select', options: ['monthly', 'yearly'], desc: 'How often it is charged.' },
  { key: 'body', label: 'Note', type: 'textarea', desc: 'Anything worth remembering.' },
  { key: 'mute', label: 'Mute warnings', type: 'toggles', desc: 'Stop these being raised for this account.',
    value: ['stale'],
    options: [{ value: 'low', label: 'Low balance', desc: 'Under the floor you set.' }, { value: 'stale', label: 'Stale balance' }] },
];

function open() {
  askFields({}, 'Edit', FIELDS());
  const m = Modal.last;
  return { m, c: m.contentEl, inputs: byTag(m.contentEl, 'input') };
}

/* ---- 1 + 2. the typed fields and the dropdown --------------------------- */
{
  const { c, inputs, m } = open();
  const text = inputs.find(i => i.type === 'text');
  const number = inputs.find(i => i.type === 'number');
  const date = inputs.find(i => i.type === 'date');
  const select = byTag(c, 'select')[0];
  const area = byTag(c, 'textarea')[0];

  eq(nameOf(c, text), 'Service name', 'a text field is named by its label');
  eq(nameOf(c, number), 'Amount per billing cycle', 'a number field is named by its label');
  eq(nameOf(c, date), 'Next billing', 'a date field is named by its label');
  eq(nameOf(c, select), 'Billing cycle', 'a dropdown is named by its label');
  eq(nameOf(c, area), 'Note', 'a textarea is named by its label');

  eq(descOf(c, number), 'What one charge costs.', 'a field with a hint is described by it');
  eq(descOf(c, select), 'How often it is charged.', 'a dropdown with a hint is described by it');
  eq(descOf(c, area), 'Anything worth remembering.', 'a textarea with a hint is described by it');
  eq(text.getAttribute('aria-describedby'), null, 'a field with no hint carries no description');
  eq(date.getAttribute('aria-describedby'), null, 'and neither does a date field with none');
  m.close();
}

/* ---- 3 + 4. toggles, current markup ------------------------------------- */
{
  const { c, m } = open();
  const [low, stale] = byTag(c, 'label');
  ok(low && stale, 'two toggles are rendered');
  eq(low.getAttribute('tabindex'), '0', 'the <label> is the tab stop in the current markup');

  eq(nameOf(c, low), 'Mute warnings Low balance', 'a toggle is named by its group and its own label');
  eq(nameOf(c, stale), 'Mute warnings Stale balance', 'and so is the next one');
  eq(descOf(c, low), 'Stop these being raised for this account. Under the floor you set.',
    'a toggle is described by the group hint and its own');
  eq(descOf(c, stale), 'Stop these being raised for this account.',
    'a toggle with no hint of its own still carries the group\'s');

  eq(low.getAttribute('role'), 'switch', 'the tab stop is given the role a <label> lacks');
  eq(low.getAttribute('aria-checked'), 'false', 'an off toggle says it is off');
  eq(stale.getAttribute('aria-checked'), 'true', 'a toggle that opens on says it is on');
  low._toggle.flip();
  eq(low.getAttribute('aria-checked'), 'true', 'flipping it on is announced');
  low._toggle.flip();
  eq(low.getAttribute('aria-checked'), 'false', 'and flipping it back off');

  /* The checkbox inside is what a pointer click lands on. Named and kept in
     step as well, so neither element can say something the other contradicts. */
  const inner = byTag(stale, 'input')[0];
  eq(nameOf(c, inner), 'Mute warnings Stale balance', 'the checkbox inside carries the same name');
  eq(inner.checked, true, 'and its checked state follows the toggle, which setValue() never set');
  stale._toggle.flip();
  eq(inner.checked, false, 'through a flip too');
  m.close();
}

/* ---- 5. toggles, older markup ------------------------------------------- */
{
  obsidian.shape.legacyToggle = true;
  const { c, inputs, m } = open();
  const boxes = inputs.filter(i => i.type === 'checkbox');
  eq(boxes.length, 2, 'two toggles in the older markup');
  const [low, stale] = boxes;
  eq(low.getAttribute('tabindex'), '0', 'the checkbox is the tab stop there');
  eq(nameOf(c, low), 'Mute warnings Low balance', 'so the checkbox takes the name');
  eq(descOf(c, low), 'Stop these being raised for this account. Under the floor you set.', 'and the description');
  eq([low.checked, stale.checked], [false, true], 'its checked state opens matching the toggle');
  low._toggle.flip();
  eq(low.checked, true, 'and follows a flip');
  eq(low._parent.getAttribute('role'), null, 'the container is not a tab stop, so it is given no role');
  obsidian.shape.legacyToggle = false;
  m.close();
}

/* ---- 6. ids do not collide across dialogs -------------------------------- */
{
  const a = open();
  const b = open();
  const ids = root => {
    const out = [];
    const walk = e => { for (const k of e.children) { if (k.attrs && k.attrs.id) out.push(k.attrs.id); walk(k); } };
    walk(root);
    return out;
  };
  const all = [...ids(a.c), ...ids(b.c)];
  ok(all.length > 0, 'the dialogs carry ids to reference');
  eq(new Set(all).size, all.length, 'no id is used twice, within a dialog or across two');
  a.m.close(); b.m.close();
}

console.log(`PASS modal-field-names — every dialog control resolves to its label, and to its hint where it has one (${checks} checks)`);
