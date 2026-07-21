'use strict';
/* Category <select> builders + the create-category flow, shared by the
   Transactions table, Budget page and CSV import review. */

const { el, parseFrontmatter, learnPattern } = require('./util');
const { TYPE_ORDER } = require('./constants');
const { askFields, confirmModal } = require('./modal');

module.exports = function registerCategories(ctx) {
  const { S, app, vault, toast, writeFile, fileAt, mdFilesIn } = ctx;

  /* Bumped whenever the category list changes (create/delete). Selects built
     earlier compare against this on open and rebuild their options if stale —
     so a category added through one row's select shows up in every other
     select on the page without a re-render. */
  let catsVersion = 1;

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
    catsVersion++;
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
  /* Refresh a select's options on open when the category list has changed
     since they were last built. Rebuild only on a version mismatch — never
     unconditionally — so arrow-key navigation inside an open dropdown isn't
     disturbed by needless rebuilds. */
  function refreshOnOpen(sel, getVersion, setVersion) {
    const refresh = () => {
      if (getVersion() === catsVersion) return;
      setVersion(catsVersion);
      const val = sel.value;
      fillCatOptions(sel, val);
      sel.value = val;
    };
    sel.addEventListener('mousedown', refresh);
    sel.addEventListener('focus', refresh);
    sel.addEventListener('keydown', refresh);
  }
  function catSelect(current, onchange) {
    const sel = el('select', { class: 'category-select' });
    fillCatOptions(sel, current);
    let builtVersion = catsVersion;
    refreshOnOpen(sel, () => builtVersion, v => builtVersion = v);
    wireCatChange(sel, current, onchange);
    return sel;
  }
  /* Lazy variant for large lists (Transactions table, CSV import review):
     starts with just the current value and builds the full list on first
     open — version 0 forces that initial build through the same path. */
  function lazyCatSelect(current, onchange) {
    const sel = el('select', { class: 'category-select' });
    sel.append(el('option', { value: current, selected: '' }, current || '— none —'));
    let builtVersion = 0;
    refreshOnOpen(sel, () => builtVersion, v => builtVersion = v);
    wireCatChange(sel, current, onchange);
    return sel;
  }

  /* Delete a category after confirmation: the file goes to the vault's trash
     (recoverable), the in-memory list drops it. Existing transactions and past
     budget files are deliberately untouched — selects already render a stored
     name with no category file as "(missing)". Returns true if deleted. */
  async function promptDeleteCategory(name) {
    if (!S.categories.some(c => c.name === name)) return false;
    let used = 0;
    for (const f of Object.values(S.txFiles)) {
      for (const r of f.rows) if (r.cat === name) used++;
    }
    const ok = await confirmModal(app, {
      title: 'Delete category',
      message: `Delete "${name}"? ` +
        (used ? `${used} existing transaction${used === 1 ? '' : 's'} keep the name and will show it as "(missing)" until re-categorised. ` : '') +
        'Past budget files are not changed, and the category file goes to your vault trash.',
      confirmText: 'Delete',
    });
    if (!ok) return false;
    // The filename is the sanitised name; older or hand-made files may differ,
    // so fall back to scanning frontmatter `name` for an exact match.
    const safe = name.replace(/[\\/:*?"<>|]/g, '-').trim();
    let file = fileAt(`Categories/${safe}.md`);
    if (!file) {
      for (const f of mdFilesIn('Categories')) {
        const { fm } = parseFrontmatter(await vault.cachedRead(f));
        if ((fm.name || f.basename) === name) { file = f; break; }
      }
    }
    if (file) await vault.trash(file, false);
    S.categories = S.categories.filter(c => c.name !== name);
    catsVersion++;
    toast(`Deleted category "${name}"`);
    return true;
  }

  /* Learn pattern → category rules from {desc, cat} pairs: descriptions are
     trimmed of trailing reference noise (learnPattern) so rules generalise,
     deduped against existing patterns (first rule for a pattern wins — an
     established rule is never silently overwritten), then the rules CSV is
     rewritten once. Returns how many rules were added. Shared by the CSV
     import commit and the Transactions-page save. */
  async function learnRules(pairs) {
    const have = new Set(S.rules.map(r => r.pattern.trim().toLowerCase()));
    let added = 0;
    for (const { desc, cat } of pairs) {
      if (!cat) continue;
      const pattern = learnPattern(desc);
      const key = pattern.trim().toLowerCase();
      if (!key || have.has(key)) continue;
      S.rules.push({ pattern, category: cat });
      have.add(key);
      added++;
    }
    if (added) {
      S.rules.sort((a, b) => a.pattern.localeCompare(b.pattern, undefined, { sensitivity: 'base' }));
      const csv = 'pattern,category\n' + S.rules.map(r =>
        [r.pattern, r.category].map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n') + '\n';
      await writeFile('Data/Categorisation Rules.csv', csv);
    }
    return added;
  }

  Object.assign(ctx, { fillCatOptions, promptCreateCategory, promptDeleteCategory, catSelect, lazyCatSelect, learnRules });
};
