'use strict';
/* Transactions — filterable table with inline category / exclude / note
   editing, saved back to Transactions/<account>/<month>.md files. */

const { el, escMd, icoEl, patchFrontmatter, normalizeAmount, yamlStr } = require('../util');
const { askFields, askSplit } = require('../modal');

module.exports = function registerTransactions(ctx) {
  // lazyCatSelect (not catSelect): builds its full <option> list only on first
  // focus, so rendering up to 800 rows doesn't create ~20-30k option nodes up
  // front — the main source of jank on the phone at 5,700 transactions.
  const { S, $, app, money, toast, writeFile, periodTitle, periodMonthName, txInPeriod, deferredCatSelect, learnRules, txSegment } = ctx;

  /* Category changes made here teach the auto-categoriser too (not just the
     import review): desc → category, flushed to the rules CSV on save. A Map
     so re-picking the same transaction keeps only the final choice. */
  const pendingLearns = new Map();

  /* Windowing state. `renderToken` changes whenever the FILTERS change, which
     is what resets the window — a plain re-render (a category edit, a reload)
     must not throw the reader back to the first page. */
  const PAGE = 100;
  let shown = PAGE, shownFor = null;

  function renderTransactions() {
    $('#txSubNote').textContent = $('#txWholeHistory').checked ? 'Whole history' : `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
    /* Rebuild these on CONTENT, not option count. Comparing counts meant a
       rename on another device (one label out, one in) left the select showing
       a name that no longer matches anything — the table then reads "0 rows"
       with no explanation and no way back short of reopening the view.
       The previous selection is re-applied, and falls back to "all" if the
       value it pointed at is gone. */
    const syncOptions = (sel, values, fixed) => {
      const current = [...sel.options].slice(fixed.length).map(o => o.value);
      if (current.length === values.length && current.every((v, i) => v === values[i])) return;
      const keep = sel.value;
      sel.empty();
      for (const [value, label] of fixed) sel.append(el('option', { value }, label));
      for (const v of values) sel.append(el('option', { value: v }, v));
      sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
    };
    syncOptions($('#txAccount'), [...new Set(Object.values(S.txFiles).map(f => f.label))].sort(),
      [['', 'All accounts']]);
    syncOptions($('#txCategory'), S.categories.map(c => c.name),
      [['', 'All categories'], ['__none__', 'Uncategorised']]);
    const accSel = $('#txAccount'), catSel = $('#txCategory');
    let list;
    if ($('#txWholeHistory').checked) {
      list = [];
      for (const f of Object.values(S.txFiles)) for (const r of f.rows) list.push({ ...r, label: f.label, _file: f, _row: r });
      list.sort((a, b) => b.date.localeCompare(a.date));
    } else {
      list = txInPeriod(S.period).reverse();
    }
    const acc = accSel.value, cat = catSel.value, q = $('#txSearch').value.trim().toLowerCase();
    const renderToken = `${acc}|${cat}|${q}|${$('#txWholeHistory').checked}|${S.period}`;
    list = list.filter(t =>
      (!acc || t.label === acc) &&
      (!cat || (cat === '__none__' ? !t.cat : t.cat === cat)) &&
      (!q || t.desc.toLowerCase().includes(q)));
    /* Window the table. The old shape sliced to 800 and built every one: ~13,600
       nodes and, before deferredCatSelect, 800 native <select>s — rebuilt in full
       on every search pause and filter change. Render a page at a time instead
       and let the reader ask for more; the data pipeline is not the cost here
       (building and sorting all 5,700 rows measures under a millisecond). */
    const total = list.length;
    if (shownFor !== renderToken) { shown = PAGE; shownFor = renderToken; }
    const visible = list.slice(0, shown);
    $('#txCount').textContent = total > visible.length
      ? `${visible.length} of ${total} rows`
      : `${total} rows`;
    list = visible;
    const t = $('#txTable'); t.empty();
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Date'), el('th', { scope: 'col' }, 'Description'), el('th', { scope: 'col' }, 'Account'),
      el('th', { scope: 'col' }, 'Category'), el('th', { scope: 'col', class: 'num' }, 'Amount'), el('th', { scope: 'col' }, 'Excl.'), el('th', { scope: 'col' }, 'Note'),
      el('th', { scope: 'col' }, el('span', { class: 'sr-only' }, 'Split')))));
    const body = el('tbody', {});
    for (const item of list) {
      const r = item._row;
      const mark = () => { item._file.dirty = true; $('#txSave').disabled = false; };
      body.append(el('tr', {},
        el('td', { class: 'text-muted', style: 'white-space:nowrap' }, r.date),
        el('td', {}, r.desc),
        el('td', { class: 'text-muted' }, item.label),
        // deferredCatSelect: a button until first use. See categories.js — at a
        // full page of rows this is the difference between 0 and 100 native
        // selects, and a select is the priciest control in a mobile WebView.
        el('td', {}, deferredCatSelect(r.cat, v => {
          r.cat = v;
          if (v) pendingLearns.set(r.desc, v); else pendingLearns.delete(r.desc);
          mark();
        }, `Category for ${r.date} ${r.desc}`)),
        el('td', { class: `num${r.amount >= 0 ? ' text-success' : ''}`, style: 'white-space:nowrap;font-weight:600' }, money(r.amount)),
        el('td', {}, el('input', { type: 'checkbox', 'aria-label': `Exclude ${r.desc} from budget totals`,
          ...(r.excluded ? { checked: '' } : {}), onchange: e => { r.excluded = e.target.checked; mark(); } })),
        el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: r.note, style: 'width:130px',
          'aria-label': `Note for ${r.date} ${r.desc}`,
          onchange: e => { r.note = e.target.value; mark(); } })),
        el('td', {}, splitButton(item))));
    }
    if (!list.length) body.append(el('tr', {}, el('td', { colspan: '8', class: 'text-muted' }, 'No transactions match.')));
    if (total > list.length) {
      const more = el('button', { class: 'btn-ghost', style: 'width:100%;padding:0.6rem' },
        `Show ${Math.min(PAGE, total - list.length)} more of ${total - list.length} remaining`);
      more.addEventListener('click', () => { shown += PAGE; renderTransactions(); });
      body.append(el('tr', {}, el('td', { colspan: '8', style: 'padding:0' }, more)));
    }
    t.append(body);
  }

  /* ------------------------------- splitting -------------------------------
     One bank line often covers several categories — a supermarket shop that
     is half groceries and half household, a card payment covering two people.
     A split carves it into parts that sum back to the original.

     The original row is KEPT and marked excluded rather than deleted. That is
     the whole design, and it is not squeamishness:

       • Every total (dashboard, budget-vs-actual, trend) is computed from
         non-excluded rows — periodSummary filters them out — so parking the
         parent as excluded leaves the arithmetic identical to before.
       • The CSV importer dedupes on `date|desc|amount|label`. Delete the
         parent and that key vanishes from the file, so re-importing the same
         statement would cheerfully re-add the original line ON TOP of the
         parts and silently double-count it. Keeping the parent keeps the key.
       • It is reversible by hand in the markdown: untick Excluded, delete the
         parts. Nothing about the split is a one-way door. */
  function splitButton(item) {
    const r = item._row;
    const b = el('button', {
      type: 'button', class: 'btn-ghost btn-ghost-sm',
      'aria-label': `Split ${r.date} ${r.desc} into categories`, title: 'Split into categories',
    }, icoEl(['split', 'git-fork', 'scissors']));
    b.addEventListener('click', () => splitTransaction(item));
    return b;
  }

  async function splitTransaction(item) {
    const r = item._row;
    if (!r.amount) return toast('A zero-amount line has nothing to split', true);
    if (r.excluded) return toast('This line is already excluded — untick it first', true);
    const parts = await askSplit(app, {
      tx: { date: r.date, desc: r.desc, label: item.label, amount: r.amount, cat: r.cat },
      categories: S.categories.map(c => c.name),
      money,
    });
    if (!parts) return;

    /* amountRaw is the loader's "I could not strictly parse this cell, write it
       back verbatim" flag. The parent keeps its own (it is unchanged on disk
       apart from the Excluded column); the parts are new numbers we computed,
       so they must not inherit it or they would serialise as the parent's
       amount. */
    const rows = parts.map(p => ({
      date: r.date, desc: r.desc, cat: p.cat, amount: p.amount, excluded: false, note: p.note,
    }));
    r.excluded = true;
    const marker = `Split into ${rows.length}`;
    r.note = r.note ? `${r.note} · ${marker}` : marker;
    // Same file: every part shares the parent's date, so it shares its month.
    item._file.rows.push(...rows);
    item._file.dirty = true;
    $('#txSave').disabled = false;
    /* Deliberately NOT fed to pendingLearns: the parts share one description
       with different categories, so learning from them would teach the
       auto-categoriser a rule that contradicts itself on every import. */
    renderTransactions();
    toast(`Split into ${rows.length} — review, then Save changes`);
  }

  function serializeTxFile(f) {
    // Preserve the file's own frontmatter (tags, any hand-added keys); patch only
    // the account label + month. amountRaw !== null means the loader could not
    // strictly parse that cell — write it back verbatim rather than corrupting it.
    const fm = patchFrontmatter(f.fmRaw || '', { account: yamlStr(f.label), month: f.month });
    const lines = ['---', fm, '---', '',
      '| Date | Description | Category | Amount | Excluded | Note |',
      '|------|-------------|----------|-------:|----------|------|'];
    f.rows.sort((a, b) => a.date.localeCompare(b.date));
    for (const r of f.rows) {
      const amt = r.amountRaw != null ? r.amountRaw : r.amount.toFixed(2);
      lines.push(`| ${r.date} | ${escMd(r.desc)} | ${escMd(r.cat)} | ${amt} | ${r.excluded ? 'yes' : ''} | ${escMd(r.note)} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  /* Manual entry — cash spends, transfers, savings deposits, anything that
     never reaches a bank CSV. Written to disk immediately (same lockstep
     pattern as the CSV import commit), so there's nothing extra to save. */
  async function addTransaction() {
    const labels = [...new Set([
      ...S.accounts.map(a => a.tx_label || a.name),
      ...Object.values(S.txFiles).map(f => f.label)])].sort();
    if (!labels.length) return toast('Add an account first — every transaction belongs to one', true);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const r = await askFields(app, 'Add transaction', [
      { key: 'date', label: 'Date', type: 'date', value: today },
      { key: 'desc', label: 'Description', type: 'text', placeholder: 'e.g. Cash — vegetables at the market' },
      { key: 'label', label: 'Account', type: 'select', options: labels, value: $('#txAccount').value || labels[0] },
      { key: 'dir', label: 'Direction', type: 'select', value: 'out', options: [
        { value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }] },
      { key: 'amount', label: 'Amount', type: 'number', placeholder: '0.00', desc: 'Always positive — direction sets the sign' },
      { key: 'cat', label: 'Category', type: 'select', options: [
        { value: '', label: '— none —' }, ...S.categories.map(c => ({ value: c.name, label: c.name }))], value: '' },
      { key: 'note', label: 'Note', type: 'text', placeholder: 'optional' },
    ]);
    if (!r) return;
    const date = r.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Date must be YYYY-MM-DD', true);
    const desc = r.desc.trim();
    if (!desc) return toast('Description is required', true);
    // txSegment, not safeSeg: the key below and the path further down must be
    // the same string, and an existing folder keeps its on-disk name.
    const label = txSegment(r.label);
    if (!label) return toast('Invalid account name', true);
    let amount = normalizeAmount(r.amount);
    if (amount == null || amount === 0) return toast('Amount must be a number other than 0', true);
    amount = parseFloat((r.dir === 'in' ? Math.abs(amount) : -Math.abs(amount)).toFixed(2));

    const month = date.slice(0, 7);
    const key = `${label}/${month}`;
    const row = { date, desc, cat: r.cat, amount, excluded: false, note: (r.note || '').trim() };
    const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
    // Write first, then mirror into S.txFiles — memory never models a row the
    // disk doesn't have. serializeTxFile gets a cloned rows array (concat), so
    // a failed write leaves the live model untouched.
    const existing = S.txFiles[key];
    const fileModel = existing
      ? { ...existing, rows: existing.rows.concat([row]) }
      : { label, month, rows: [row], dirty: false, fmRaw: TX_FM };
    try {
      await writeFile(`Transactions/${label}/${month}.md`, serializeTxFile(fileModel));
    } catch (err) {
      return toast(`Could not save the transaction (${err.message || err})`, true);
    }
    if (!S.txFiles[key]) S.txFiles[key] = { label, month, rows: [], dirty: false, fmRaw: TX_FM };
    S.txFiles[key].rows.push(row);
    renderTransactions();
    toast(`Added ${money(amount)} · ${label} · ${month}`);
  }

  async function saveTransactions() {
    let n = 0;
    for (const f of Object.values(S.txFiles)) {
      if (!f.dirty) continue;
      await writeFile(`Transactions/${f.label}/${f.month}.md`, serializeTxFile(f));
      f.dirty = false; n++;
    }
    let learned = 0;
    if (pendingLearns.size) {
      learned = await learnRules([...pendingLearns].map(([desc, cat]) => ({ desc, cat })));
      pendingLearns.clear();
    }
    $('#txSave').disabled = true;
    toast(`Saved ${n} file${n === 1 ? '' : 's'}` + (learned ? ` · learned ${learned} new rule${learned === 1 ? '' : 's'}` : ''));
  }

  ctx.provide({ renderTransactions, serializeTxFile, saveTransactions, addTransaction, splitTransaction });
};
