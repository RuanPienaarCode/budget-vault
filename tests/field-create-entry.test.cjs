'use strict';
/* askFields' create entry (issue #189), driven for real over Obsidian's shipped
   markup (tests/helpers/modal-stub.cjs).

   A select field may carry `create: { label }`. It ends in one extra entry, and
   picking it LEAVES the form: the dialog closes and resolves the values as
   typed, plus the key of the field it was picked in. It never opens anything
   itself -- the caller closes, creates, and reopens (src/add-create.js says why
   it is not a stacked dialog).

   What is pinned here:
     1. The entry is last, labelled, and a field without `create` has none.
     2. Picking it closes the form, keeps everything typed, leaves the dropdown on
        what it held, and is not validated (an unfinished form is a valid thing to
        leave behind).
     3. OK and Cancel are what they were.
     4. A dependent dropdown (Subcategory under Category) offers the entry only
        while a category is chosen, and the entry alone keeps it enabled: that is
        how a category with no subcategories yet reaches "＋ New subcategory…".
     5. Names and keyboard behaviour of the controls are intact.

     node tests/field-create-entry.test.cjs */

const assert = require('assert');
const { stubModalObsidian, byTag, byId } = require('./helpers/modal-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { Modal } = stubModalObsidian();
const { askFields } = require('../src/modal');
const { CREATE_OPTION, CREATE_KEY, pickedCreate } = require('../src/add-create');

const NONE = { value: '', label: '— none —' };
const NAMES = { Car: ['Fuel', 'Services'], Home: [] };
const optionsFor = cat => [NONE, ...(NAMES[cat] || []).map(n => ({ value: n, label: n }))];
const FIELDS = (over = {}) => [
  { key: 'desc', label: 'Description', type: 'text' },
  { key: 'label', label: 'Account', type: 'select', options: ['Cheque', 'Savings'], value: 'Savings', create: { label: '＋ Add new account…' } },
  { key: 'cat', label: 'Category', type: 'select', value: over.cat || '',
    options: [NONE, { value: 'Car', label: 'Car' }, { value: 'Home', label: 'Home' }], create: { label: '＋ Add new category…' } },
  { key: 'subcategory', label: 'Subcategory', type: 'select', follows: 'cat', optionsFor, value: over.sub || '',
    create: { label: '＋ New subcategory…' } },
];
const optionList = sel => byTag(sel, 'option').map(o => o.attrs.value);
const labelList = sel => byTag(sel, 'option').map(o => o.textContent);
const tick = () => new Promise(r => setImmediate(r));
const pick = (sel, value) => { sel.value = value; sel._change(value); };

(async () => {
  /* ---- 1. the entry is last, and only where asked for -------------------- */
  {
    askFields({}, 'Add', FIELDS());
    const m = Modal.last;
    const [acct, cat, sub] = byTag(m.contentEl, 'select');
    eq(optionList(acct), ['Cheque', 'Savings', CREATE_OPTION], 'a plain dropdown ends in the create entry');
    eq(labelList(acct).slice(-1), ['＋ Add new account…'], 'carrying the label it was given');
    eq(optionList(cat), ['', 'Car', 'Home', CREATE_OPTION], 'a dropdown of {value,label} options too');
    eq(labelList(cat).slice(-1), ['＋ Add new category…'], 'its own label');
    eq(acct.value, 'Savings', 'the dropdown still opens on the value it was given, not on the entry');
    eq(cat.value, '', 'and the other on none');
    ok(sub !== undefined, 'the dependent dropdown is built');
    m.close();
  }
  {
    askFields({}, 'Plain', [
      { key: 'a', label: 'A', type: 'select', options: ['x', 'y'] },
      { key: 'b', label: 'B', type: 'select', options: [NONE, { value: 'k', label: 'K' }], value: 'k' },
      { key: 'c', label: 'C', type: 'select', follows: 'b', optionsFor, value: '' },
    ]);
    const m = Modal.last;
    const sels = byTag(m.contentEl, 'select');
    eq(sels.map(optionList), [['x', 'y'], ['', 'k'], ['']], 'a field with no `create` has no entry, in any of the three dropdown shapes');
    m.close();
  }

  /* ---- 2. picking it leaves the form, keeping what was typed -------------- */
  {
    let validated = 0;
    const state = { settled: false, value: undefined };
    askFields({}, 'Add', FIELDS(), { validate: () => { validated++; return 'never reached'; } })
      .then(v => { state.settled = true; state.value = v; });
    const m = Modal.last;
    const [desc] = byTag(m.contentEl, 'input');
    const [acct, cat] = byTag(m.contentEl, 'select');
    desc.value = 'Coffee'; desc._change('Coffee');
    pick(cat, 'Car');

    pick(acct, CREATE_OPTION);
    await tick();
    ok(state.settled, 'picking the entry settles the dialog');
    ok(m.isOpen === false, 'and closes it: nothing is stacked');
    eq(pickedCreate(state.value), 'label', 'saying which field\'s entry was picked');
    eq(state.value.desc, 'Coffee', 'everything typed comes back as typed');
    eq(state.value.cat, 'Car', 'including the other dropdowns');
    eq(state.value.label, 'Savings', 'and the dropdown it was picked in still holds what it held, not the entry');
    ok(state.value.label !== CREATE_OPTION && !Object.values(state.value).includes(CREATE_OPTION), 'the entry\'s own value is nowhere in the answer');
    eq(validated, 0, 'validate was never asked: an unfinished form is a fine thing to leave behind');
    eq(acct.value, 'Savings', 'the control itself was put back, so it never shows the entry as the choice');
  }
  {
    // Picked from the second dropdown, with a blank description (invalid) and nothing else typed.
    const state = {};
    askFields({}, 'Add', FIELDS(), { validate: () => ({ field: 'desc', message: 'needs a description' }) })
      .then(v => { state.value = v; });
    const m = Modal.last;
    const [, cat] = byTag(m.contentEl, 'select');
    pick(cat, CREATE_OPTION);
    await tick();
    eq(pickedCreate(state.value), 'cat', 'the marker names the field picked in');
    eq(state.value.desc, '', 'a blank, invalid form leaves anyway');
    eq(state.value.cat, '', 'with the dropdown unchanged (none)');
    ok(m.isOpen === false, 'closed, and no error was put up over it');
  }

  /* ---- 3. OK and Cancel are what they were --------------------------------- */
  {
    const state = {};
    askFields({}, 'Add', FIELDS()).then(v => { state.value = v; });
    const m = Modal.last;
    const [acct] = byTag(m.contentEl, 'select');
    pick(acct, 'Cheque');
    const buttons = byTag(m.contentEl, 'button');
    buttons[buttons.length - 1]._onClick();
    await tick();
    ok(state.value && !(CREATE_KEY in state.value), 'OK resolves the values with no marker');
    eq(state.value.label, 'Cheque', 'and the real choice made');
  }
  {
    const state = { value: 'unset' };
    askFields({}, 'Add', FIELDS()).then(v => { state.value = v; });
    const m = Modal.last;
    m.close();
    await tick();
    eq(state.value, null, 'closing without picking is still a cancel (null)');
  }

  /* ---- 4. the dependent dropdown ------------------------------------------- */
  {
    askFields({}, 'Add', FIELDS());
    const m = Modal.last;
    const [, cat, sub] = byTag(m.contentEl, 'select');
    eq(optionList(sub), [''], 'no category: only "none" -- there is nothing to create a subcategory under');
    ok(sub.disabled === true, 'and the dropdown is disabled, as it was');

    pick(cat, 'Home');
    eq(optionList(sub), ['', CREATE_OPTION], 'a category with no subcategories offers "none" and the create entry');
    ok(sub.disabled === false, 'and is ENABLED: the entry is the way to the first one');
    eq(labelList(sub).slice(-1), ['＋ New subcategory…'], 'with its label');

    pick(cat, 'Car');
    eq(optionList(sub), ['', 'Fuel', 'Services', CREATE_OPTION], 'a category with some: its names, then the entry last');
    ok(sub.disabled === false, 'enabled');

    pick(cat, '');
    eq(optionList(sub), [''], 'back to no category: the entry goes again');
    ok(sub.disabled === true, 'and the dropdown is disabled again');
    m.close();
  }
  {
    // Picking the subcategory entry: the category it is under comes back, so the caller knows where to create it.
    const state = {};
    askFields({}, 'Add', FIELDS()).then(v => { state.value = v; });
    const m = Modal.last;
    const [, cat, sub] = byTag(m.contentEl, 'select');
    pick(cat, 'Car');
    pick(sub, 'Services');
    pick(sub, CREATE_OPTION);
    await tick();
    eq(pickedCreate(state.value), 'subcategory', 'the subcategory entry names its own field');
    eq(state.value.cat, 'Car', 'and the answer carries the category it sits under');
    eq(state.value.subcategory, 'Services', 'with the subcategory unchanged');
    eq(sub.value, 'Services', 'the control shows what it held');
  }
  {
    // A kept draft that holds a subcategory the category offers is shown; the entry does not disturb that.
    askFields({}, 'Add', FIELDS({ cat: 'Car', sub: 'Fuel' }));
    const m = Modal.last;
    const [, cat, sub] = byTag(m.contentEl, 'select');
    eq([cat.value, sub.value], ['Car', 'Fuel'], 'a draft\'s category and subcategory open selected');
    eq(optionList(sub), ['', 'Fuel', 'Services', CREATE_OPTION], 'with the entry still last');
    ok(sub.disabled === false, 'enabled');
    m.close();
  }

  /* ---- 5. names and keyboard ----------------------------------------------- */
  {
    askFields({}, 'Add', FIELDS());
    const m = Modal.last;
    const sels = byTag(m.contentEl, 'select');
    ok(sels.every(s => s.attrs['aria-labelledby'] || s.attrs['aria-label']), 'every dropdown is still named');
    const names = sels.map(s => byId(m.contentEl, s.attrs['aria-labelledby']));
    eq(names.map(n => n && n.textContent), ['Account', 'Category', 'Subcategory'], 'by the label on screen, as before: the entry adds no name of its own');
    // Enter on a dropdown is how an open list is committed; it must not submit the form, so it cannot "pick" the entry either.
    const r = m.press('Enter', sels[1]);
    ok(!r.prevented && !r.closed, 'Enter on a dropdown does nothing to the form (it is the list\'s own key)');
    m.close();
  }

  console.log(`PASS field-create-entry (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
