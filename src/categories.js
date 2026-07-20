'use strict';
/* Category <select> builders + the create-category flow, shared by the
   Transactions table, Budget page and CSV import review. */

const { el } = require('./util');
const { TYPE_ORDER } = require('./constants');
const { askFields } = require('./modal');

module.exports = function registerCategories(ctx) {
  const { S, app, toast, writeFile } = ctx;

  function fillCatOptions(sel, current) {
    sel.innerHTML = '';
    sel.append(el('option', { value: '' }, '— none —'));
    let lastType = null, group = null;
    for (const c of S.categories) {
      if (c.type !== lastType) { lastType = c.type; group = el('optgroup', { label: c.type }); sel.append(group); }
      const o = el('option', { value: c.name }, c.name);
      if (c.name === current) o.selected = true;
      group.append(o);
    }
    if (current && !S.categories.some(c => c.name === current)) {
      const o = el('option', { value: current }, `${current} (missing)`); o.selected = true; sel.append(o);
    }
    sel.append(el('option', { value: '__new__' }, '＋ Add new category…'));
  }

  /* Create a category on disk + in memory and return it (or null). */
  async function promptCreateCategory() {
    const r = await askFields(app, 'New category', [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Coffee budget' },
      { key: 'type', label: 'Type', type: 'select', options: TYPE_ORDER, value: 'expense' },
    ]);
    if (!r || !r.name.trim()) return null;
    const realName = r.name.trim();
    if (S.categories.some(c => c.name.toLowerCase() === realName.toLowerCase())) { toast('Category already exists', true); return null; }
    const type = r.type;
    if (!TYPE_ORDER.includes(type)) { toast('Invalid type', true); return null; }
    const safe = realName.replace(/[\\/:*?"<>|]/g, '-').trim();
    const nameLine = safe !== realName ? `name: "${realName}"\n` : '';
    await writeFile(`Categories/${safe}.md`,
      `---\n${nameLine}type: ${type}\ncolor: "#888888"\ntags: [finance, finance/budget, finance/budget/categories]\n---\n\n# ${realName}\n\nBudget category of type **${type}**.\n`);
    const cat = { name: realName, type, color: '#888888' };
    S.categories.push(cat);
    S.categories.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name));
    toast(`Created Categories/${safe}.md`);
    return cat;
  }

  function wireCatChange(sel, current, onchange) {
    let cur = current;
    sel.addEventListener('change', async () => {
      if (sel.value === '__new__') {
        const cat = await promptCreateCategory();
        if (cat) { fillCatOptions(sel, cat.name); sel.value = cat.name; cur = cat.name; onchange(cat.name); }
        else { sel.value = cur; }
        return;
      }
      cur = sel.value; onchange(cur);
    });
  }
  function catSelect(current, onchange) {
    const sel = el('select', { class: 'category-select' });
    fillCatOptions(sel, current);
    wireCatChange(sel, current, onchange);
    return sel;
  }
  /* Lazy variant for large lists (CSV import review). */
  function lazyCatSelect(current, onchange) {
    const sel = el('select', { class: 'category-select' });
    sel.append(el('option', { value: current, selected: '' }, current || '— none —'));
    let built = false;
    const build = () => {
      if (built) return; built = true;
      const val = sel.value;
      fillCatOptions(sel, val);
      sel.value = val;
    };
    sel.addEventListener('mousedown', build);
    sel.addEventListener('focus', build);
    sel.addEventListener('keydown', build);
    wireCatChange(sel, current, onchange);
    return sel;
  }

  Object.assign(ctx, { fillCatOptions, promptCreateCategory, catSelect, lazyCatSelect });
};
