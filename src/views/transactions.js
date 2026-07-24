'use strict';
/* Transactions — filterable table with inline category / exclude / note
   editing, saved back to Transactions/<account>/<month>.md files. */

const { el, escMd, patchFrontmatter, normalizeAmount, safeSeg } = require('../util');
const { askFields } = require('../modal');

module.exports = function registerTransactions(ctx) {
  // lazyCatSelect (not catSelect): builds its full <option> list only on first
  // focus, so rendering up to 800 rows doesn't create ~20-30k option nodes up
  // front — the main source of jank on the phone at 5,700 transactions.
  const { S, $, app, money, toast, writeFile, periodTitle, periodMonthName, txInPeriod, lazyCatSelect, learnRules } = ctx;

  /* Category changes made here teach the auto-categoriser too (not just the
     import review): desc → category, flushed to the rules CSV on save. A Map
     so re-picking the same transaction keeps only the final choice. */
  const pendingLearns = new Map();

  function renderTransactions() {
    $('#txSubNote').textContent = $('#txWholeHistory').checked ? 'Whole history' : `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
    const accSel = $('#txAccount');
    const labels = [...new Set(Object.values(S.txFiles).map(f => f.label))].sort();
    if (accSel.options.length !== labels.length + 1) {
      accSel.innerHTML = '<option value="">All accounts</option>';
      for (const l of labels) accSel.append(el('option', { value: l }, l));
    }
    const catSel = $('#txCategory');
    if (catSel.options.length !== S.categories.length + 2) {
      catSel.innerHTML = '<option value="">All categories</option><option value="__none__">Uncategorised</option>';
      for (const c of S.categories) catSel.append(el('option', { value: c.name }, c.name));
    }
    let list;
    if ($('#txWholeHistory').checked) {
      list = [];
      for (const f of Object.values(S.txFiles)) for (const r of f.rows) list.push({ ...r, label: f.label, _file: f, _row: r });
      list.sort((a, b) => b.date.localeCompare(a.date));
    } else {
      list = txInPeriod(S.period).reverse();
    }
    const acc = accSel.value, cat = catSel.value, q = $('#txSearch').value.trim().toLowerCase();
    list = list.filter(t =>
      (!acc || t.label === acc) &&
      (!cat || (cat === '__none__' ? !t.cat : t.cat === cat)) &&
      (!q || t.desc.toLowerCase().includes(q)));
    if (list.length > 800) list = list.slice(0, 800);
    $('#txCount').textContent = `${list.length} rows`;
    const t = $('#txTable'); t.innerHTML = '';
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Date'), el('th', { scope: 'col' }, 'Description'), el('th', { scope: 'col' }, 'Account'),
      el('th', { scope: 'col' }, 'Category'), el('th', { scope: 'col', class: 'num' }, 'Amount'), el('th', { scope: 'col' }, 'Excl.'), el('th', { scope: 'col' }, 'Note'))));
    const body = el('tbody', {});
    for (const item of list) {
      const r = item._row;
      const mark = () => { item._file.dirty = true; $('#txSave').disabled = false; };
      body.append(el('tr', {},
        el('td', { class: 'text-muted', style: 'white-space:nowrap' }, r.date),
        el('td', {}, r.desc),
        el('td', { class: 'text-muted' }, item.label),
        el('td', {}, lazyCatSelect(r.cat, v => {
          r.cat = v;
          if (v) pendingLearns.set(r.desc, v); else pendingLearns.delete(r.desc);
          mark();
        })),
        el('td', { class: `num${r.amount >= 0 ? ' text-success' : ''}`, style: 'white-space:nowrap;font-weight:600' }, money(r.amount)),
        el('td', {}, el('input', { type: 'checkbox', ...(r.excluded ? { checked: '' } : {}), onchange: e => { r.excluded = e.target.checked; mark(); } })),
        el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: r.note, style: 'width:130px', onchange: e => { r.note = e.target.value; mark(); } }))));
    }
    if (!list.length) body.append(el('tr', {}, el('td', { colspan: '7', class: 'text-muted' }, 'No transactions match.')));
    t.append(body);
  }

  function serializeTxFile(f) {
    // Preserve the file's own frontmatter (tags, any hand-added keys); patch only
    // the account label + month. amountRaw !== null means the loader could not
    // strictly parse that cell — write it back verbatim rather than corrupting it.
    const fm = patchFrontmatter(f.fmRaw || '', { account: `"${f.label}"`, month: f.month });
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
    const label = safeSeg(r.label);
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

  Object.assign(ctx, { renderTransactions, serializeTxFile, saveTransactions, addTransaction });
};
