'use strict';
/* Category <select> builders + the create-category flow, shared by the
   Transactions table, Budget page and CSV import review. */

const { opWriterOf } = require('./io');
const { el } = require('./dom');
const { parseFrontmatter, yamlStr } = require('./markdown');
const { checkSubcategoryName, formatSubcategories, offeredNames, inUseByCategory, setRuleCategory } = require('./subcategories');
const { csvCell } = require('./csv');
const { learnPattern, prepareRules, matchRule, ruleText, answerKey, rulesSubColumn, ruleSubcategory } = require('./rules');
const { safeSeg } = require('./vault-path');
const { typeOrder, typeRank } = require('./groups');
const { todayIso } = require('./dates');
const { askFields, confirmModal, askRulesCleanup } = require('./modal');
const { analyseRules } = require('./rule-cleanup');
const { supersededBySplit } = require('./tx-role');
/* Namespace import: `t` is a local in several files of this app. */
const i18n = require('./i18n');

module.exports = function registerCategories(ctx) {
  const { S, app, vault, toast, writeFile, readFile, fileAt, pathTaken, mdFilesIn, mdFilesUnder, trashFile } = ctx;

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
    /* The category is typed for the book on screen; a switch while the dialog
       is open must not create it in the next one (io.js opWriter). */
    const op = opWriterOf(ctx, { book: true });   // bound to the BOOK, not the exact load: this only creates from what is typed (io.js opWriter({ book: true }))
    const r = await askFields(app, 'New category', [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Coffee budget' },
      { key: 'type', label: 'Type', type: 'select', options: typeOrder(S.settings.groups), value: 'expense' },
      // `toggles` resolves to an ARRAY of the values switched on — not an
      // object keyed by them. One entry here, so the array is the whole
      // answer (same idiom as plan.js's "Remove this item" toggle). Matches
      // this dialog's own existing fields (Name, Type above) in staying
      // hardcoded English rather than i18n.t() — see the note at this
      // function's call site for why that split is deliberate for now.
      { key: 'fixed', label: 'Fixed / committed bill', type: 'toggles',
        options: [{ value: 'yes', label: 'Money you are committed to pay every period — rent, debt repayments, insurance' }] },
    ]);
    if (!r) return null;
    const gone = op.replaced();
    if (gone) { toast(gone, true); return null; }
    /* A blank name used to close the dialog with no word said, so Create
       looked like it had done nothing at all. The Add-transaction form toasts
       for its blank field (tx.err.desc); this does the same. Cancel returns
       null above and stays silent. */
    if (!r.name.trim()) { toast(i18n.t('cat.err.nameRequired'), true); return null; }
    const realName = r.name.trim();
    if (S.categories.some(c => c.name.toLowerCase() === realName.toLowerCase())) { toast('Category already exists', true); return null; }
    const type = r.type;
    if (!typeOrder(S.settings.groups).includes(type)) { toast('Invalid type', true); return null; }
    // Income and a transfer are never a commitment to pay — the same rule
    // the Budget page's per-row toggle enforces by simply not offering itself
    // there (views/budgets.js). The form above can't hide the field reactively
    // as `type` changes, so a stray tick is dropped here rather than written
    // as a `fixed: true` that would read as nonsense next to those two types.
    const fixed = (r.fixed || []).includes('yes') && type !== 'income' && type !== 'transfer';
    // safeSeg, not a local copy of it: a name like ".hidden" would otherwise
    // write a dotfile Obsidian never indexes, so the category vanishes on the
    // next load and promptDeleteCategory can never find it again.
    const safe = safeSeg(realName);
    if (!safe) { toast('That name has no usable characters for a filename', true); return null; }
    // Two display names can sanitise to one filename ("Kids/School" and
    // "Kids:School"). The name check above compares display names, so probe
    // the resolved path too — otherwise the second write silently replaces
    // the first category file.
    // ISSUE 64: pathTaken, not fileAt — the filesystem is case-insensitive.
    if (pathTaken(`Categories/${safe}.md`)) { toast(`Categories/${safe}.md already exists`, true); return null; }
    const nameLine = safe !== realName ? `name: ${yamlStr(realName)}\n` : '';
    // Absent is `fixed`'s own default (load.js), so the key is only written
    // at all when it's true — mirrors toggleAssumeSpent's null-removes-the-key
    // trick, just on the write-once path instead of the patch path.
    const fixedLine = fixed ? 'fixed: true\n' : '';
    await op.writeFile(`Categories/${safe}.md`,
      `---\n${nameLine}type: ${type}\ncolor: "#888888"\n${fixedLine}tags: [finance, finance/budget, finance/budget/categories]\n---\n\n# ${realName}\n\nBudget category of type **${type}**.\n`);
    /* `rel` is budget-folder-relative, the same shape load.js's own read
       builds (see its comment there) — without it here, a category created
       THIS session had no path for toggleAssumeSpent (or the new fixed-bill
       toggle below) to write to, and both bailed with "no file" until the
       next full reload. `fixed` is set explicitly too (not left to the
       object's absence read as falsy) so a category ticked fixed above shows
       correctly on the Budget page before any reload, matching the boolean
       load.js always assigns. */
    const cat = { name: realName, type, color: '#888888', fixed, rel: `Categories/${safe}.md` };
    S.categories.push(cat);
    const order = typeOrder(S.settings.groups);
    S.categories.sort((a, b) => typeRank(a.type, order) - typeRank(b.type, order) || a.name.localeCompare(b.name));
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
      'aria-label': !label ? undefined
        : value ? i18n.t('cat.aria.current', { label, value }) : i18n.t('cat.aria.currentNone', { label }),
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

  /* ---------------------------- subcategories ----------------------------
     ADR-0010. The names a transaction may carry under a category live on the
     category's own note, `subcategories:` in its frontmatter — the same
     comma-list shape `groups:` has in Settings.md — because the list belongs
     to the category and travels with it. Everything here that writes one goes
     through saveSubcategories, so the note, the open book and the page agree. */

  /* Every name a category's transactions carry, listed or not, as of right now
     (a scan of the open book's rows, so a name set a moment ago in an unsaved
     edit counts). */
  function subcategoriesInUse(catName) {
    function* rows() { for (const f of Object.values(S.txFiles || {})) for (const r of f.rows) yield r; }
    return inUseByCategory(rows()).get(catName) || [];
  }
  /* What a dropdown for this category offers: the listed names in the order
     written, then any a row carries that the list does not. */
  function subcategoryNamesFor(catName) {
    const cat = (S.categories || []).find(c => c.name === catName);
    return offeredNames(cat && cat.subcategories, subcategoriesInUse(catName));
  }

  /* Write the category's list to its note and into the open book. Resolves true
     only if the note was written. `names` is the WHOLE list; none removes the
     key, so a note that never had one never gains an empty one. Only the
     frontmatter key is patched — the body and every other key stay as they were
     (io.js patchFile). A failure is said and nothing changes, the page keeps
     showing what the file says (the rule toggleAssumeSpent follows).

     Nothing here touches a transaction: removing a name from the list stops it
     being offered and rewrites no row. */
  async function saveSubcategories(catName, names) {
    const cat = (S.categories || []).find(c => c.name === catName);
    if (!cat || !cat.rel) { toast(i18n.t('subcat.err.noFile', { category: catName }), true); return false; }
    /* `cat` is this load's; the read below is an await, so the patch is bound to
       the load (io.js opWriter) and cannot land in another book's file of the
       same name. */
    const op = opWriterOf(ctx);
    const text = await readFile(cat.rel);
    if (text == null) { toast(i18n.t('subcat.err.noFile', { category: catName }), true); return false; }
    const { raw, body } = parseFrontmatter(text);
    const value = formatSubcategories(names);
    try {
      await op.patchFile(cat.rel, raw, body, { subcategories: value ? yamlStr(value) : null });
    } catch (e) {
      toast(i18n.t('subcat.err.save', { category: catName, error: (e && e.message) || e }), true);
      return false;
    }
    cat.subcategories = [...names];
    return true;
  }

  /* "＋ New subcategory…": ask for a name, save it to the category note straight
     away, and hand it back (null when cancelled or not saved). Refused inside
     the dialog while the reader is still looking at it: blank, a comma, a name
     already listed. The name goes last, so the order written stays the order
     offered. */
  async function promptNewSubcategory(catName) {
    const cat = (S.categories || []).find(c => c.name === catName);
    const listed = (cat && cat.subcategories) || [];
    const r = await askFields(app, i18n.t('tx.subcategory.newTitle', { category: catName }), [
      { key: 'name', label: i18n.t('bud.subcat.addLabel'), type: 'text', placeholder: i18n.t('bud.subcat.placeholder') },
    ], {
      validate: v => {
        const check = checkSubcategoryName(v.name, listed);
        return check.error ? { field: 'name', message: i18n.t('subcat.err.' + check.error) } : null;
      },
    });
    if (!r) return null;
    const check = checkSubcategoryName(r.name, listed);
    if (check.error) { toast(i18n.t('subcat.err.' + check.error), true); return null; }
    if (!(await saveSubcategories(catName, [...listed, check.name]))) return null;
    toast(i18n.t('subcat.added', { name: check.name, category: catName }));
    return check.name;
  }

  /* The subcategory dropdown inside a Transactions row's category cell. Deferred
     like the category control beside it — a button until first use, then a real
     <select> — for the same reason (categories.js deferredCatSelect: a native
     select is the priciest control in a mobile WebView, and a page is a hundred
     rows). It reuses that control's button and select classes, so it takes the
     same sizing, focus ring and 44px touch target on a phone, and adds only
     `sub-cell` so the stylesheet can set it on its own line under the category
     (phone cards show it as a second line in the category cell).

     `current` is the name the row carries; `names()` the offered ones, read when
     the list OPENS so a name made a moment ago on another row is there. The
     list ends with "＋ New subcategory…", which asks for a name, saves it to the
     category note and selects it — and on a cancel or a failed save puts the
     control back on what the row carries. `onchange(name)` is called with ''
     for none. */
  function deferredSubSelect(catName, current, names, onchange, label) {
    const wrap = el('span', { class: 'sub-cell' });
    let value = current || '';
    const aria = () => (!label ? undefined
      : value ? i18n.t('cat.aria.current', { label, value }) : i18n.t('subcat.aria.currentNone', { label }));
    const btn = el('button', {
      type: 'button',
      class: `cat-cell-btn sub-cell-btn${value ? '' : ' cat-cell-empty'}`,
      'aria-label': aria(),
    }, value || i18n.t('tx.field.none'));
    let swapped = false;
    const swap = () => {
      if (swapped) return;          // click also focuses; swap exactly once
      swapped = true;
      const sel = el('select', { class: 'category-select sub-select', ...(label ? { 'aria-label': label } : {}) });
      const fill = () => {
        sel.empty();
        sel.append(el('option', { value: '' }, i18n.t('tx.field.none')));
        const offered = names();
        /* The row's own name is always among them, so the select can show it
           even if it was dropped from the list a moment ago. */
        for (const n of value && !offered.includes(value) ? [...offered, value] : offered) sel.append(el('option', { value: n }, n));
        sel.append(el('option', { value: '__new__' }, i18n.t('tx.subcategory.new')));
        sel.value = value;
      };
      fill();
      sel.addEventListener('change', async () => {
        if (sel.value === '__new__') {
          const made = await promptNewSubcategory(catName);
          if (made) { value = made; fill(); onchange(made); }
          else sel.value = value;
          return;
        }
        value = sel.value;
        onchange(value);
      });
      wrap.replaceChildren(sel);
      sel.focus();
      if (typeof sel.showPicker === 'function') {
        try { sel.showPicker(); } catch (e) { /* not allowed outside a user gesture */ }
      }
    };
    btn.addEventListener('click', swap);
    btn.addEventListener('focus', swap);
    wrap.append(btn);
    return wrap;
  }

  /* What the delete confirm says (2026-11-25 audit, BUD-1). It used to read
     "Past budget files are not changed", which is true of the budget files and
     hides the thing that does change: a transaction's kind (income / transfer /
     spending) is looked up from its category's NOTE (ledger.js), so trashing
     the note takes the kind from every row filed under it, in EVERY period
     the rows fall in. An income category's money stops counting as income; a
     transfer category's rows become uncategorised spending. So when anything
     is filed under the name the dialog says how many rows, which kind goes,
     and what the figures do until the rows are re-categorised.

     The categorisation rules that name the category are counted too: they are
     not touched by a delete (RUL-9), so they go on filing new imports under a
     name with no note, and the same rows come back after the reader has
     tidied them. Said here, not fixed: whether an in-use category should be
     archived or refused is the owner's decision, and the delete stays
     possible.

     Built from sentences (cat.delete.*) so each can be left out and each can
     take its own plural; the kind is the group's translated name, falling back
     to the stored word the way views/budgets.js typeGroupLabel does. */
  function deleteMessage(name, used, known) {
    const type = (known && known.type) || '';
    const key = 'wiz.type.' + type;
    const word = type ? i18n.t(key) : '';
    const kind = word && word !== key ? word : type;
    const parts = [i18n.t('cat.delete.lead', { name })];
    if (used) {
      parts.push(i18n.t('cat.delete.used', { count: used }));
      if (kind) parts.push(i18n.t('cat.delete.kindLost', { kind }));
      parts.push(i18n.t(type === 'income' ? 'cat.delete.effect.income'
        : type === 'transfer' ? 'cat.delete.effect.transfer' : 'cat.delete.effect.other'));
    } else {
      parts.push(i18n.t('cat.delete.unused'));
    }
    const rules = (S.rules || []).filter(r => r.category === name).length;
    if (rules) parts.push(i18n.t('cat.delete.rules', { count: rules, name }));
    parts.push(i18n.t('cat.delete.trash'));
    return parts.join(' ');
  }

  /* Delete a category after confirmation: the file goes to the vault's trash
     (recoverable), the in-memory list drops it. Existing transactions and past
     budget files are deliberately untouched — selects already render a stored
     name with no category file as "(missing)". Returns true if deleted.

     This confirmModal — with the used-transaction count and the vault-trash
     explanation spelled out below — IS this app's safety net for a delete
     that reaches every period, not the row button that opens it. An audit
     ("13-agent" comprehension pass, Aug 2026) suggested moving the delete
     entirely out of the Budget row and into a category-edit dialog. There is
     no such dialog anywhere in this app — categories are create-only today,
     never edited — so that would be new UI surface crossing modal.js (owned
     by no one this round) to build a whole screen around one already-guarded
     action. Kept in place; the row button's ICON was made to disagree with
     the neighbouring clear-this-period button instead, so the two no longer
     read as two flavours of the same "remove" gesture (see the Delete/Clear
     buttons in views/budgets.js). */
  async function promptDeleteCategory(name) {
    if (!S.categories.some(c => c.name === name)) return false;
    let used = 0;
    for (const f of Object.values(S.txFiles)) {
      for (const r of f.rows) if (r.cat === name) used++;
    }
    /* The file is resolved BEFORE the confirm, and that TFile is what gets
       trashed, through io.trashFile (2026-10-07 audit, L3-18). The lookup
       used to run after the dialog, which is the exact pattern io.trashFile's
       header warns about: a path re-resolved after a dialog the reader spends
       seconds in either no longer exists, or now points at a DIFFERENT file.
       In the audit's reproduction the category note was renamed while the
       dialog was open and a shopping list arrived at the old path. The
       shopping list went to the trash, and the toast said the category had
       been deleted. Notes, plans and tax years already resolved first.

       The filename is the sanitised name; older or hand-made files may
       differ, so fall back to scanning frontmatter `name` for an exact match
       — which also covers files written before safeSeg was used here. */
    const safe = safeSeg(name);
    /* ISSUE 97 — the loaded record knows the path it came from; only fall back
       to assembling one for a name no loaded category claims. The scan below
       recurses for the same reason. */
    const known = (S.categories || []).find(c => c.name === name);
    let file = (known && known.rel && fileAt(known.rel)) || fileAt(`Categories/${safe}.md`);
    if (!file) {
      for (const f of mdFilesUnder('Categories')) {
        const { fm } = parseFrontmatter(await vault.cachedRead(f));
        if ((fm.name || f.basename) === name) { file = f; break; }
      }
    }
    const op = opWriterOf(ctx);   // `known`, `file` and S.categories below are this load's
    const ok = await confirmModal(app, {
      title: i18n.t('cat.delete.title'),
      message: deleteMessage(name, used, known),
      confirmText: i18n.t('cat.delete.confirm'),
    });
    if (!ok) return false;
    const gone = op.replaced();
    if (gone) { toast(gone, true); return false; }
    if (file) {
      /* Still the file the vault holds? A TFile follows its file through a
         rename, so a category renamed while the dialog was open is still
         this object, at its new path. A file deleted and replaced in that
         time (a sync, another pane) is a NEW TFile, and the one held here
         would trash whatever now sits at its path. The vault knows which
         object it holds, so ask it, and refuse rather than guess. */
      if (vault.getFileByPath(file.path) !== file) {
        toast(`The file for "${name}" was moved or replaced while this dialog was open, so nothing was deleted.`, true);
        return false;
      }
      try {
        await op.trashFile(file);
      } catch (e) {
        toast(`Could not delete that category: ${(e && e.message) || e}`, true);
        return false;
      }
    }
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
     file that stabilises and one that grows with the history forever.

     "Answered" means the category AND the subcategory (ADR-0010 section 5,
     issue #185): a shorter rule that files Car under Fuel does not answer a
     longer description the reader filed under Car and Services, so two rules
     for one category with different subcategories are both kept. Spoken
     plainly, a pair is `{ desc, cat, subcategory? }` and a blank subcategory
     is a pair that says the category alone. */
  /* `op`, when given, is the calling operation's writer (io.js opWriter): the
     pairs were read from ITS load, so if another load has replaced it since —
     another book opened while the save or import was writing — nothing is
     learned into the state that won, and the answer is null rather than 0, so
     the caller can say the rules were NOT learned instead of reporting a save
     with none to learn (2026-11 final review). */
  async function learnRules(pairs, op) {
    const res = await learnRulesWithCorrections(pairs, op);
    return res === null ? null : res.added + res.updated;
  }

  /* learnRules with what it did NOT do, said (2026-11-25 audit, RUL-3).

     A pair whose pattern the file already holds is skipped — that is the
     never-silently-overwritten rule above, and it stays. But on the import
     review the skip was the end of it: a reader who refiled every
     "CHECKERS RONDEBOSCH" row from Food to Liquor got "Imported 3
     transactions", no rule, and Food again on every statement after. So the
     skipped disagreements come back to the caller, which ASKS (views/import.js)
     — the Transactions page's "Update the rule" offer, for a commit's worth of
     rows at once. This function still changes no existing rule's CATEGORY.

     Returns { added, updated, corrections, conflicts }, or null when the load
     was replaced (see above):
       updated      how many EXISTING rules were given a different
                    subcategory. The one thing here that changes a rule the
                    file already held, and only in the narrow case the issue
                    asks for: the same pattern, the same category, and a pair
                    that NAMES a subcategory different from the rule's. A pair
                    with none never takes one away, because it says nothing
                    about it; and a pair for another category is a correction
                    (below), which this still does not apply.
       corrections  [{ pattern, from, to, count, rule }] — every review pair
                    with this pattern chose `to`, the rule says `from`. `rule`
                    is the S.rules object itself, this load's, so correctRules
                    can repoint exactly it and nothing it would have to search
                    for again.
       conflicts    [{ pattern, category, chosen: [{ cat, count }] }] — pairs
                    with one pattern chose DIFFERENT categories. Never a
                    correction: there is no one answer the rule could follow,
                    and picking one would be the app deciding which of the
                    reader's own choices was the exception.
     Only rules that were in the file BEFORE this call count. A pattern first
     learned earlier in this same batch is learnRules' own first-wins, as it
     always was, and not a correction of anything the household wrote. The
     first rule for a pattern is the one compared, the one matchRule's tie
     goes to and the one governingRule hands the Transactions page. */
  async function learnRulesWithCorrections(pairs, op) {
    if (op && op.replaced()) return null;
    if (!rulesWritable()) return { added: 0, updated: 0, corrections: [], conflicts: [] };
    // ruleText: the matcher's own normalisation, so "already have it" means
    // exactly what prepareRules will make of the pattern.
    const have = new Set(S.rules.map(r => ruleText(r.pattern)));
    const before = new Map();   // pattern key -> the first rule the file had for it
    for (const r of S.rules) {
      const k = ruleText(r.pattern);
      if (k && !before.has(k)) before.set(k, r);
    }
    const chosen = new Map();   // pattern key -> Map(category -> pairs choosing it)
    // Prepared once, then extended as we go: a rule learned earlier in this
    // same batch must be able to make a later one redundant.
    const matcher = prepareRules(S.rules);
    let added = 0;
    const first = new Map();    // rule -> the subcategory it had before this batch
    for (const { desc, cat, subcategory } of pairs) {
      if (!cat) continue;
      const sub = String(subcategory ?? '').trim();
      const pattern = learnPattern(desc);
      const key = ruleText(pattern);
      if (!key) continue;
      if (before.has(key)) {
        const rule = before.get(key);
        if (sub && rule.category === cat && ruleSubcategory(rule) !== sub) {
          if (!first.has(rule)) first.set(rule, ruleSubcategory(rule));
          setRuleCategory(rule, cat, sub);
          const e = matcher.find(m => m.p === key);
          if (e) e.subcategory = sub;
        }
        if (!chosen.has(key)) chosen.set(key, new Map());
        const m = chosen.get(key);
        m.set(cat, (m.get(cat) || 0) + 1);
        continue;
      }
      if (have.has(key)) continue;
      const answer = sub ? { category: cat, subcategory: sub } : { category: cat };
      if (answerKey(matchRule(pattern, matcher)) === answerKey(answer)) { have.add(key); continue; }
      S.rules.push(sub ? { pattern, category: cat, subcategory: sub } : { pattern, category: cat });
      matcher.push(sub ? { p: key, category: cat, subcategory: sub } : { p: key, category: cat });
      have.add(key);
      added++;
    }
    const updated = [...first].filter(([rule, was]) => ruleSubcategory(rule) !== was).length;
    /* Appended, never re-sorted (2026-10-07 audit, L3-13). This sorted the
       whole set alphabetically before every write. But order decides which
       rule wins when two matches are the same length (rules.js matchRule
       keeps the first), so one unrelated learn could change how a merchant
       was filed on every import after it. The audit's reproduction moved a
       two-shop description from Liquor to Food that way. In the guard test
       (tests/rules-csv-roundtrip.test.cjs), CORNER (Food) is listed above
       CELLAR (Liquor) on purpose; the sort put CELLAR first after one learn,
       and a description holding both moved to Liquor. The file's own order
       is the household's, and a learned rule goes at the end, where it
       outranks nothing it ties with. */
    if (added || updated) await writeRulesCsv(op);
    const corrections = [], conflicts = [];
    for (const [key, m] of chosen) {
      const rule = before.get(key);
      const cats = [...m];
      if (cats.length > 1) {
        conflicts.push({ pattern: rule.pattern, category: rule.category, chosen: cats.map(([cat, count]) => ({ cat, count })) });
      } else if (cats[0][0] !== rule.category) {
        corrections.push({ pattern: rule.pattern, from: rule.category, to: cats[0][0], count: cats[0][1], rule });
      }
    }
    return { added, updated, corrections, conflicts };
  }

  /* The rule CURRENTLY governing a description — the same winning rule
     matchRule would hand autoCategorise, but with the ORIGINAL S.rules entry
     (case preserved, and the actual object, not a copy) rather than the
     lowercased one prepareRules builds for matching. Re-deriving that by hand
     from the lowercased pattern would be a second implementation of
     matchRule's own tie-break (exact match wins outright, else the longest
     substring) — this repo's own recurring bug shape is exactly two figures
     that were supposed to agree and were derived by different rules, so this
     reuses matchRule and only recovers the original object afterwards.

     Returns null when nothing governs the description yet — a brand new
     merchant, or a description too short for learnPattern to have kept
     anything meaningful.

     Exposed so the Transactions page can offer to fix the rule ITSELF when a
     recategorisation disagrees with it, instead of learning a second rule
     that could only ever mask the first (learnRules' own have.has guard,
     just above, is what makes that masking possible — a rule is never
     silently overwritten by a new one, only by an explicit correction, which
     is what correctRule below is for). */
  function governingRule(desc) {
    const matched = matchRule(desc, prepareRules(S.rules));
    if (!matched) return null;
    return S.rules.find(r => ruleText(r.pattern) === matched.p) || null;
  }

  /* Repoint an EXISTING rule at a new category. The one correction path
     learnRules deliberately has none of — "an established rule is never
     silently overwritten" is right for AUTOMATIC learning (an import running
     unattended must never let a later, looser pattern quietly repoint an
     earlier one), but leaves no way back for a person who has just noticed
     the rule is wrong, short of hand-editing Data/Categorisation Rules.csv,
     which the app never even names. This is that way back: it only ever
     changes a rule the caller already has in hand (governingRule's return),
     never searches for one and never adds one, so it can't be reached by
     anything automatic. */
  async function correctRule(rule, newCat, op) {
    return (await correctRules([{ rule, to: newCat }], op)) > 0;
  }

  /* correctRule for several rules at once — the import review's "Update the
     rules" (2026-11-25 audit, RUL-3), which may repoint a dozen after one
     statement. Same rules as correctRule: only rules the caller holds, never
     a search, never an addition. And ONE write of the file for the lot, by
     the one serializer, so the household's order and extra columns come back
     exactly as they went in — a write per rule would rewrite the file a dozen
     times on an iCloud vault for the same bytes. Returns how many changed. */
  async function correctRules(changes, op) {
    const todo = (changes || []).filter(c => c && c.rule && c.to && c.rule.category !== c.to);
    if (!todo.length) return 0;
    if (op && op.replaced()) return 0;
    if (!rulesWritable()) return 0;
    /* setRuleCategory, not an assignment: a rule's subcategory belongs to its
       category, so a rule repointed at another one loses it (ADR-0010
       section 1). A change may name the pair it sets, and none of today's
       callers do. */
    for (const c of todo) setRuleCategory(c.rule, c.to, c.subcategory);
    await writeRulesCsv(op);
    return todo.length;
  }

  /* One serializer for the rules file, so learning, tidying and the pre-tidy
     backup can never write it three different ways. Takes the rules rather
     than reading S.rules, so the backup can serialize the set as it was
     BEFORE the delete without a second copy of this.

     The file's own header, and every cell past a rule's category, are
     written back as they were read (load.js keeps them as S.rulesHeader and
     each rule's `extra`). This used to rebuild the file from two columns
     under a fresh `pattern,category` header, so a household's `why` column
     was deleted by the first learn (2026-10-07 audit, L3-14). The file is
     one they open in a spreadsheet, which is where a column like that gets
     added. A rule learned this session has no `extra`, so it gets empty
     cells up to the header's width and lines up with the rest. A loaded row
     that was shorter than the header is written back exactly as short. */
  const RULES_HEAD = ['pattern', 'category'];
  /* The header a write of `rules` leaves. The file's own, unchanged, unless a
     rule to be written carries a subcategory and the header names no column for
     it: then `subcategory` is appended after every column the file already has
     (ADR-0010 section 4's rule, for the rules file), capitalised like the first
     header cell, so a household's `Pattern,Category` gets `Subcategory` and the
     app's own `pattern,category` gets `subcategory`. A file whose rules carry
     none is never given the column — a two-column file is two columns until a
     rule needs a third (issue #185). */
  function rulesHead(rules) {
    const head = Array.isArray(S.rulesHeader) && S.rulesHeader.length ? S.rulesHeader : RULES_HEAD;
    if (rulesSubColumn(head) >= 0 || !rules.some(r => ruleSubcategory(r))) return head;
    return [...head, /^[A-Z]/.test(String(head[0] ?? '')) ? 'Subcategory' : 'subcategory'];
  }
  /* 2026-10-14 audit, L3-03. A line the loader could not turn into a rule — a
     `# comment`, a pattern still waiting for its category, a category with no
     pattern — is written back exactly where it stood: after the rule it
     followed, or straight under the header when it opened the file. load.js
     keeps each as {prev, cells}, `prev` being the last rule read above it.
     When a tidy has removed that rule the line moves up to the nearest rule
     above it that survives (S.rulesLoaded is the file's own order), so a note
     a household left is never dropped because a neighbour was. */
  function rulesCsv(rules) {
    const head = rulesHead(rules);
    const subAt = rulesSubColumn(head);
    const pad = Math.max(0, head.length - RULES_HEAD.length);
    const line = cells => cells.map(csvCell).join(',');
    const live = new Set(rules);
    const loaded = S.rulesLoaded || [];
    const anchorOf = e => {
      if (!e.prev || live.has(e.prev)) return e.prev || null;
      for (let i = loaded.indexOf(e.prev) - 1; i >= 0; i--) if (live.has(loaded[i])) return loaded[i];
      return null;
    };
    const under = new Map();                     // rule (or null = top) -> its kept lines
    for (const e of S.rulesExtras || []) {
      const a = anchorOf(e);
      if (!under.has(a)) under.set(a, []);
      under.get(a).push(line(e.cells));
    }
    const body = [...(under.get(null) || [])];
    for (const r of rules) {
      const cells = Array.isArray(r.extra) ? r.extra.slice() : new Array(pad).fill('');
      if (subAt >= 0) {
        /* The cell is rewritten only when it no longer says what the rule says:
           one the household typed (" Fuel ") goes back as typed, and a loaded
           row with nothing there stays as short as it was. */
        const at = subAt - RULES_HEAD.length, want = ruleSubcategory(r), typed = cells[at];
        if (typed === undefined ? want : String(typed).trim() !== want) {
          while (cells.length < at) cells.push('');
          cells[at] = want;
        }
      }
      body.push(line([r.pattern, r.category, ...cells]));
      if (under.has(r)) body.push(...under.get(r));
    }
    return line(head) + '\n' + (body.length ? body.join('\n') + '\n' : '');
  }

  /* A rules file the loader read as content but found no rule in (load.js:
     S.rulesUnreadable) is never rewritten. Rewriting means serialising S.rules,
     which is empty here, so the next learn would replace the household's file
     with one rule — the hundreds-to-1 loss of the 2026-10-14 audit. Every path that
     writes the file asks first, says why in plain words, and the file stays
     as it is. Returns true when it is safe to go on. */
  function rulesWritable() {
    if (!S.rulesUnreadable) return true;
    toast('Data/Categorisation Rules.csv has lines this app could not read as rules (it expects one rule per line: pattern, then category, separated by commas), so nothing was changed. Open it in a text editor and fix it, then reload.', true);
    return false;
  }

  async function writeRulesCsv(op) {
    if (!rulesWritable()) return;
    const head = rulesHead(S.rules);
    const wrote = await (op ? op.writeFile : writeFile)('Data/Categorisation Rules.csv', rulesCsv(S.rules));
    /* The file now has a subcategory column, so the state says so: the next
       write in this session must find it by header rather than add it again,
       and a tidy that removes the last rule using one must not drop it. Not
       when the load was replaced under the write — what is in memory then is
       another load's, and it reads its own header from the file. */
    if (rulesSubColumn(head) >= 0 && rulesSubColumn(S.rulesHeader) < 0 && !(op && op.replaced())) S.rulesHeader = head;
    return wrote;
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
    if (!rulesWritable()) return 0;
    /* Each description goes in with the category its row is filed under,
       which is the household's own evidence that a broad rule spans more
       than one kind of spending (rule-cleanup.js `ambiguous`). A split
       parent's category is left out: its parts carry that money under the
       categories the reader chose, and the parent's own label is the one
       those parts replaced (tx-role.js). Its description stays, because it
       is still the line the bank printed and the next import will match. */
    const descs = [];
    for (const f of Object.values(S.txFiles || {})) {
      for (const row of f.rows || []) {
        if (row.desc) descs.push({ desc: row.desc, cat: supersededBySplit(row) ? '' : row.cat });
      }
    }
    if (!S.rules.length && !descs.length) {
      toast('No budget data loaded yet.', true);
      return 0;
    }
    const report = analyseRules(S.rules, descs);
    /* `report.remove` is a list of INDICES into this load's S.rules. Applied to
       another load's — a book switched while the preview was open — it would
       delete that book's rules by position. So the preview is bound to this
       load, and every write after it too. */
    const op = opWriterOf(ctx);
    if (!await askRulesCleanup(app, report)) return 0;
    const gone = op.replaced();
    if (gone) { toast(gone, true); return 0; }

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
        await op.writeFile(backup, rulesCsv(S.rules));
      } catch (err) {
        toast(`Could not write the backup — nothing was deleted. ${err && err.message ? err.message : err}`, true);
        return 0;
      }
    }

    const drop = new Set(report.remove.map(r => r.index));
    /* The backup write was an await: asked again before the indices are used. */
    const goneNow = op.replaced();
    if (goneNow) { toast(goneNow, true); return 0; }
    S.rules = S.rules.filter((_, i) => !drop.has(i));
    await writeRulesCsv(op);
    toast(`Removed ${drop.size} categorisation ${drop.size === 1 ? 'rule' : 'rules'} — ${S.rules.length} left. Previous set saved to ${backup.split('/').pop()}`);
    return drop.size;
  }

  ctx.provide({ fillCatOptions, promptCreateCategory, promptDeleteCategory, lazyCatSelect, deferredCatSelect,
    saveSubcategories, promptNewSubcategory, deferredSubSelect, subcategoryNamesFor, subcategoriesInUse,
    learnRules, learnRulesWithCorrections, governingRule, correctRule, correctRules, cleanupRules });
};
