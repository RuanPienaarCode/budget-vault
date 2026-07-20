'use strict';
/* Transactions — filterable table with inline category / exclude / note
   editing, saved back to Transactions/<account>/<month>.md files. */

const { el, escMd, patchFrontmatter } = require('../util');

module.exports = function registerTransactions(ctx) {
  // lazyCatSelect (not catSelect): builds its full <option> list only on first
  // focus, so rendering up to 800 rows doesn't create ~20-30k option nodes up
  // front — the main source of jank on the phone at 5,700 transactions.
  const { S, $, money, toast, writeFile, periodTitle, periodMonthName, txInPeriod, lazyCatSelect } = ctx;

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
        el('td', {}, lazyCatSelect(r.cat, v => { r.cat = v; mark(); })),
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

  async function saveTransactions() {
    let n = 0;
    for (const f of Object.values(S.txFiles)) {
      if (!f.dirty) continue;
      await writeFile(`Transactions/${f.label}/${f.month}.md`, serializeTxFile(f));
      f.dirty = false; n++;
    }
    $('#txSave').disabled = true;
    toast(`Saved ${n} file${n === 1 ? '' : 's'}`);
  }

  Object.assign(ctx, { renderTransactions, serializeTxFile, saveTransactions });
};
