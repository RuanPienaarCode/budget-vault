'use strict';
/* Category <select> builders + the create-category flow, shared by the
   Transactions table, Budget page and CSV import review. */

const { el } = require('./dom');
const { parseFrontmatter, yamlStr } = require('./markdown');
const { csvCell } = require('./csv');
const { learnPattern, prepareRules, autoCategorise } = require('./rules');
const { safeSeg } = require('./vault-path');
const { TYPE_ORDER } = require('./constants');
const { todayIso } = require('./dates');
const { askFields, confirmModal, askRulesCleanup } = require('./modal');
const { analyseRules } = require('./rule-cleanup');

module.exports = function registerCategories(ctx) {
  const { S, app, vault, toast, writeFile, fileAt, mdFilesIn } = ctx;

  /* Bumped whenever the category list changes (create/delete). Selects built
     earlier compare against this on open and rebuild their options if stale —
     so a category added through one row's select shows up in every other
     select on the page without a re-render. */
  let catsVersion = 1;

  function fillCatOptions(sel, current) {
    sel.empty();
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
    // safeSeg, not a local copy of it: a name like ".hidden" would otherwise
    // write a dotfile Obsidian never indexes, so the category vanishes on the
    // next load and promptDeleteCategory can never find it again.
    const safe = safeSeg(realName);
    if (!safe) { toast('That name has no usable characters for a filename', true); return null; }
    // Two display names can sanitise to one filename ("Kids/School" and
    // "Kids:School"). The name check above compares display names, so probe
    // the resolved path too — otherwise the second write silently replaces
    // the first category file.
    if (fileAt(`Categories/${safe}.md`)) { toast(`Categories/${safe}.md already exists`, true); return null; }
    const nameLine = safe !== realName ? `name: ${yamlStr(realName)}\n` : '';
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
  function catSelect(current, onchange, label) {
    const sel = el('select', { class: 'category-select', ...(label ? { 'aria-label': label } : {}) });
    fillCatOptions(sel, current);
    let builtVersion = catsVersion;
    refreshOnOpen(sel, () => builtVersion, v => builtVersion = v);
    wireCatChange(sel, current, onchange);
    return sel;
  }
  /* Lazy variant for large lists (Transactions table, CSV import review):
     starts with just the current value and builds the full list on first
     open — version 0 forces that initial build through the same path. */
  // `label` is the accessible name — a bare <select> in a table cell is only
  // named by its column header, which AT reads solely in table-navigation mode.
  function lazyCatSelect(current, onchange, label) {
    const sel = el('select', { class: 'category-select', ...(label ? { 'aria-label': label } : {}) });
    sel.append(el('option', { value: current, selected: '' }, current || '— none —'));
    let builtVersion = 0;
    refreshOnOpen(sel, () => builtVersion, v => builtVersion = v);
    wireCatChange(sel, current, onchange);
    return sel;
  }

  /* Deferred variant: renders as a button and becomes a real <select> on first
     interaction. lazyCatSelect already removed the ~40k <option> nodes at 800
     rows; the 800 <select> ELEMENTS are what was left, and a native select is
     the most expensive control in a mobile WebView — each carries a picker and
     an accessibility subtree. This takes selects at rest from 800 to 0 and
     drops ~3,200 listeners, at the cost of one extra tap the first time a row
     is categorised. The button carries the same accessible name, so nothing is
     lost for a screen reader; it just announces as a button until used. */
  function deferredCatSelect(current, onchange, label) {
    const wrap = el('span', { class: 'cat-cell' });
    let value = current;
    const btn = el('button', {
      type: 'button',
      class: `cat-cell-btn${value ? '' : ' cat-cell-empty'}`,
      'aria-label': label ? `${label} — currently ${value || 'uncategorised'}` : undefined,
    }, value || '— none —');
    let swapped = false;
    const swap = () => {
      if (swapped) return;          // click also focuses; swap exactly once
      swapped = true;
      const sel = lazyCatSelect(value, v => { value = v; onchange(v); }, label);
      wrap.replaceChildren(sel);
      sel.focus();
      // Open the picker straight away so the swap costs no extra interaction on
      // desktop; mobile ignores this and shows the control ready to tap.
      if (typeof sel.showPicker === 'function') {
        try { sel.showPicker(); } catch (e) { /* not allowed outside a user gesture */ }
      }
    };
    btn.addEventListener('click', swap);
    btn.addEventListener('focus', swap);
    wrap.append(btn);
    return wrap;
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
    // so fall back to scanning frontmatter `name` for an exact match — which
    // also covers files written before safeSeg was used here.
    const safe = safeSeg(name);
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
     import commit and the Transactions-page save.

     A rule the existing set ALREADY resolves to the same category is not
     learned. It could never change an import's outcome, but it would cost a
     comparison on every row of every future import, and — because the rules
     file is the user's own markdown-adjacent CSV, not plugin state — it would
     put a line in front of them that explains nothing. Measured on a real
     1,342-rule vault: 832 of them (62%) were already answered by a shorter
     rule pointing at the same category, so this is the difference between a
     file that stabilises and one that grows with the history forever. */
  async function learnRules(pairs) {
    const have = new Set(S.rules.map(r => r.pattern.trim().toLowerCase()));
    // Prepared once, then extended as we go: a rule learned earlier in this
    // same batch must be able to make a later one redundant.
    const matcher = prepareRules(S.rules);
    let added = 0;
    for (const { desc, cat } of pairs) {
      if (!cat) continue;
      const pattern = learnPattern(desc);
      const key = pattern.trim().toLowerCase();
      if (!key || have.has(key)) continue;
      if (autoCategorise(pattern, matcher) === cat) { have.add(key); continue; }
      S.rules.push({ pattern, category: cat });
      matcher.push({ p: key, category: cat });
      have.add(key);
      added++;
    }
    if (added) {
      S.rules.sort((a, b) => a.pattern.localeCompare(b.pattern, undefined, { sensitivity: 'base' }));
      await writeRulesCsv();
    }
    return added;
  }

  /* One serializer for the rules file, so learning, tidying and the pre-tidy
     backup can never write it three different ways. Takes the rules rather
     than reading S.rules, so the backup can serialize the set as it was
     BEFORE the delete without a second copy of this. */
  function rulesCsv(rules) {
    const body = rules.length
      ? rules.map(r => [r.pattern, r.category].map(csvCell).join(',')).join('\n') + '\n'
      : '';
    return 'pattern,category\n' + body;
  }

  function writeRulesCsv() {
    return writeFile('Data/Categorisation Rules.csv', rulesCsv(S.rules));
  }

  /* Remove the rules that have stopped earning their place — see
     rule-cleanup.js for what "redundant" is allowed to mean, and why it is
     decided by replaying the vault rather than by reading the rule file.

     Nothing is written until the preview comes back true. A bulk delete on a
     file the user owns is exactly the wrong place for the plugin to act first
     and report afterwards.

     And the preview is not enough on its own. A confirmed run routinely drops
     the majority of the file — 832 of 1,342 on the vault this was built
     against — and no one can meaningfully audit eight hundred lines in a
     dialog. So the pre-delete set is written beside the live file first, and
     the delete is abandoned if that write fails: a tidy that cannot leave a
     way back does not happen. */
  async function cleanupRules() {
    const descs = [];
    for (const f of Object.values(S.txFiles || {})) {
      for (const row of f.rows || []) if (row.desc) descs.push(row.desc);
    }
    if (!S.rules.length && !descs.length) {
      toast('No budget data loaded yet.', true);
      return 0;
    }
    const report = analyseRules(S.rules, descs);
    if (!await askRulesCleanup(app, report)) return 0;

    /* LOCAL calendar date, not toISOString(): that is UTC, and at 01:00 in
       Johannesburg it names the backup after yesterday — which reads as an
       older file than it is at exactly the moment someone is looking for the
       newest one. */
    const backup = `Data/Categorisation Rules.pre-tidy-${todayIso()}.csv`;
    /* Tidy twice in one day and the second run must NOT overwrite the first:
       the earlier file is the more complete snapshot — it predates both
       deletes — and rewriting it would trade the only full copy for a partial
       one. First backup of the day wins; later runs keep it. */
    if (!fileAt(backup)) {
      try {
        await writeFile(backup, rulesCsv(S.rules));
      } catch (err) {
        toast(`Could not write the backup — nothing was deleted. ${err && err.message ? err.message : err}`, true);
        return 0;
      }
    }

    const drop = new Set(report.remove.map(r => r.index));
    S.rules = S.rules.filter((_, i) => !drop.has(i));
    await writeRulesCsv();
    toast(`Removed ${drop.size} categorisation ${drop.size === 1 ? 'rule' : 'rules'} — ${S.rules.length} left. Previous set saved to ${backup.split('/').pop()}`);
    return drop.size;
  }

  ctx.provide({ fillCatOptions, promptCreateCategory, promptDeleteCategory, catSelect, lazyCatSelect, deferredCatSelect, learnRules, cleanupRules });
};
