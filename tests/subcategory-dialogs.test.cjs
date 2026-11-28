'use strict';
/* The two dialogs subcategories add to src/modal.js, driven for real over
   Obsidian's shipped markup (tests/helpers/modal-stub.cjs):

     1. askFields' dependent dropdown — Add transaction's Subcategory under
        Category: empty and disabled until a category that has subcategories is
        chosen, and emptied again when the category moves.
     2. askSubcategories — the Budget page's per-category dialog: add and
        remove names, refuse a bad one in the dialog, say when a save failed,
        and never touch anything but the list it is given.

   The views that open them are tested in tests/subcategory-views.test.cjs with
   the dialogs scripted; this is the other half.

     node tests/subcategory-dialogs.test.cjs */

const assert = require('assert');
const { stubModalObsidian, byTag } = require('./helpers/modal-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { Modal } = stubModalObsidian();
const { askFields, askSubcategories } = require('../src/modal');
const tick = () => new Promise(r => setImmediate(r));

const NONE = { value: '', label: '— none —' };
const NAMES = { Car: ['Fuel', 'Services'], Home: [] };
const optionsFor = cat => [NONE, ...(NAMES[cat] || []).map(n => ({ value: n, label: n }))];
const FIELDS = (cat = '', sub = '') => [
  { key: 'cat', label: 'Category', type: 'select', value: cat,
    options: [{ value: '', label: '— none —' }, { value: 'Car', label: 'Car' }, { value: 'Home', label: 'Home' }] },
  { key: 'subcategory', label: 'Subcategory', type: 'select', follows: 'cat', optionsFor, value: sub },
];
const optionList = sel => byTag(sel, 'option').map(o => o.attrs.value);

(async () => {
  /* ---- 1. the dependent dropdown --------------------------------------- */
  {
    const state = { settled: false, value: undefined };
    askFields({}, 'Add', FIELDS()).then(v => { state.settled = true; state.value = v; });
    const m = Modal.last;
    const [catSel, subSel] = byTag(m.contentEl, 'select');
    eq(optionList(subSel), [''], 'with no category the dropdown holds only "none"');
    ok(subSel.disabled === true, 'and is disabled');

    catSel.value = 'Car'; catSel._change('Car');
    eq(optionList(subSel), ['', 'Fuel', 'Services'], 'choosing a category that has subcategories offers them');
    ok(subSel.disabled === false, 'and enables the dropdown');
    subSel.value = 'Services'; subSel._change('Services');

    catSel.value = 'Home'; catSel._change('Home');
    eq(optionList(subSel), [''], 'moving to a category with none leaves only "none"');
    ok(subSel.disabled === true, 'disabled again');
    eq(subSel.value, '', 'and empty: the subcategory chosen under Car did not follow the row');

    catSel.value = 'Car'; catSel._change('Car');
    eq(subSel.value, '', 'coming back to Car does not bring the old choice back either');
    subSel.value = 'Fuel'; subSel._change('Fuel');
    byTag(m.contentEl, 'button').find(b => b.textContent === 'OK')._onClick();
    await tick();
    eq(state.value, { cat: 'Car', subcategory: 'Fuel' }, 'the answer carries the category and its subcategory');
  }
  {
    /* Moving the category BEFORE choosing a subcategory, then submitting. */
    const state = {};
    askFields({}, 'Add', FIELDS()).then(v => { state.value = v; });
    const m = Modal.last;
    const [catSel, subSel] = byTag(m.contentEl, 'select');
    catSel.value = 'Car'; catSel._change('Car');
    subSel.value = 'Fuel'; subSel._change('Fuel');
    catSel.value = ''; catSel._change('');
    byTag(m.contentEl, 'button').find(b => b.textContent === 'OK')._onClick();
    await tick();
    eq(state.value, { cat: '', subcategory: '' }, 'a category removed after a subcategory was chosen leaves no subcategory behind');
  }
  {
    /* A draft that reopens with a category and its subcategory. */
    askFields({}, 'Add', FIELDS('Car', 'Fuel'));
    const [catSel, subSel] = byTag(Modal.last.contentEl, 'select');
    eq(optionList(subSel), ['', 'Fuel', 'Services'], 'opened on a category, the dropdown offers its names at once');
    ok(subSel.disabled === false, 'enabled');
    eq(subSel.value, 'Fuel', 'on the value the draft held');
    Modal.last.close();
    askFields({}, 'Add', FIELDS('Home', 'Fuel'));
    const sub2 = byTag(Modal.last.contentEl, 'select')[1];
    eq(sub2.value, '', 'a draft value the category does not offer is not shown');
    ok(sub2.disabled === true, 'and the dropdown is disabled');
    Modal.last.close();
  }
  {
    /* A plain select is untouched by the new field kind. */
    const state = {};
    askFields({}, 'Plain', [{ key: 'k', label: 'K', type: 'select', options: ['a', 'b'], value: 'a' }]).then(v => { state.value = v; });
    const sel = byTag(Modal.last.contentEl, 'select')[0];
    ok(sel.disabled !== true, 'an ordinary select is not disabled');
    eq(optionList(sel), ['a', 'b'], 'and keeps its options');
    byTag(Modal.last.contentEl, 'button').find(b => b.textContent === 'OK')._onClick();
    await tick();
    eq(state.value, { k: 'a' }, 'and its answer');
  }

  /* ---- 2. the Subcategories dialog -------------------------------------- */
  const open = (opts = {}) => {
    const saves = [];
    const state = { closed: false };
    const o = {
      category: 'Car', names: ['Fuel', 'Services'], inUse: [],
      save: async names => { saves.push(names); return o.result !== false; }, ...opts,
    };
    const p = askSubcategories({}, o).then(() => { state.closed = true; });
    const m = Modal.last;
    const c = m.contentEl;
    const nameRows = () => byTag(c, 'div').filter(d => d.hasClass('setting-item') && !d.hasClass('subcat-add') && d.children[0]
      && byTag(d, 'button').some(b => (b.getAttribute('aria-label') || '').startsWith('Remove ')));
    return {
      m, c, saves, state, o, p,
      names: () => nameRows().map(r => r.children[0].children[0].textContent),
      removeBtn: name => byTag(c, 'button').find(b => b.getAttribute('aria-label') === `Remove ${name}`),
      input: () => byTag(c, 'input')[0],
      addBtn: () => byTag(c, 'button').find(b => b.textContent === 'Add'),
      doneBtn: () => byTag(c, 'button').find(b => b.textContent === 'Done'),
      alert: () => byTag(c, 'div').find(d => d.getAttribute('role') === 'alert'),
      type: v => { const i = byTag(c, 'input')[0]; i.value = v; i._change(v); },
    };
  };

  {
    const d = open({ inUse: ['Tolls'] });
    eq(d.m.titleEl.textContent, 'Subcategories of Car', 'the dialog is titled for its category');
    eq(d.names(), ['Fuel', 'Services'], 'it lists the names in the order written');
    ok(/Tolls/.test(d.c.textContent), 'and says which names transactions use that the list does not');
    ok(d.input() && d.addBtn() && d.doneBtn(), 'with a field to type a new name, Add and Done');

    /* adding */
    d.type('  Parking ');
    d.addBtn()._onClick();
    await tick();
    eq(d.saves, [['Fuel', 'Services', 'Parking']], 'adding saves the whole list, the new name last and trimmed');
    eq(d.names(), ['Fuel', 'Services', 'Parking'], 'and the dialog now lists it');
    eq(d.input().value, '', 'with the field emptied for the next one');

    /* removing */
    d.removeBtn('Fuel')._onClick();
    await tick();
    eq(d.saves.at(-1), ['Services', 'Parking'], 'removing saves the list without it');
    eq(d.names(), ['Services', 'Parking'], 'and the dialog drops it');
    ok(/never changes a transaction|keep/i.test(d.c.textContent), 'the dialog says a removal changes no transaction');

    /* refusing a bad name inside the dialog, saving nothing */
    const n = d.saves.length;
    for (const [typed, why] of [['   ', 'blank'], ['a, b', 'a comma'], ['Parking', 'a name already listed']]) {
      d.type(typed);
      d.addBtn()._onClick();
      await tick();
      eq(d.saves.length, n, `${why} saves nothing`);
      ok(d.alert() && d.alert().textContent !== '', `${why} is said, in the dialog`);
    }
    d.type('Tolls');
    d.addBtn()._onClick();
    await tick();
    eq(d.saves.at(-1), ['Services', 'Parking', 'Tolls'], 'a name the transactions already use can be added to the list');
    eq(d.alert().textContent, '', 'and a good name clears the message');

    /* Enter in the field adds, as in every other form */
    d.type('Wash');
    d.m.press('Enter', d.input());
    await tick();
    eq(d.saves.at(-1), ['Services', 'Parking', 'Tolls', 'Wash'], 'Enter in the field adds the name');
    d.m.press('Enter', d.doneBtn());
    eq(d.state.closed, false, 'Enter on a button is left to the button');

    d.doneBtn()._onClick();
    await d.p;
    ok(d.state.closed, 'Done closes the dialog');
  }
  {
    /* A save that fails changes nothing on screen. */
    const d = open({ result: false });
    d.type('Parking');
    d.addBtn()._onClick();
    await tick();
    eq(d.names(), ['Fuel', 'Services'], 'a name that could not be saved is not shown as added');
    eq(d.input().value, 'Parking', 'and stays in the field to try again');
    d.removeBtn('Fuel')._onClick();
    await tick();
    eq(d.names(), ['Fuel', 'Services'], 'a removal that could not be saved is not shown either');
    d.m.close();
  }
  {
    /* An empty category. */
    const d = open({ names: [] });
    eq(d.names(), [], 'nothing listed');
    ok(/no subcategories yet/i.test(d.c.textContent), 'and says so');
    d.type('Fuel'); d.addBtn()._onClick(); await tick();
    eq(d.saves, [['Fuel']], 'the first name is saved');
    d.m.close();
  }
  {
    /* Two quick presses do not save twice. */
    let release; const gate = new Promise(r => { release = r; });
    const saves = [];
    const d = open({ save: async names => { saves.push(names); await gate; return true; } });
    d.type('A'); d.addBtn()._onClick();
    d.type('B'); d.addBtn()._onClick();
    release(); await tick(); await tick();
    eq(saves, [['Fuel', 'Services', 'A']], 'a second press while a save is in flight is ignored');
    d.m.close();
  }

  console.log(`subcategory-dialogs.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
