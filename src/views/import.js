'use strict';
/* CSV import — bank statement exports (the banks named in the country
   profile) or any CSV with Date/Title/Amount headers: parse, auto-categorise
   via Data/Categorisation Rules.csv, dedupe against existing transactions,
   review, commit. Columns are matched by header name, so a hand-built
   Google Sheets / Excel export works the same as a bank's. Date order for
   ambiguous DD/MM vs MM/DD dates follows the country profile. */

const { el, parseCsv, parseStatementDate, normalizeAmount, safeSeg } = require('../util');

/* Header-name aliases, lowercase. Exact match wins in array order; amount can
   come from a single signed column OR a debit + credit pair (Capitec "Money
   In"/"Money Out", Nedbank/Absa/Standard Bank Debit/Credit statements). */
const DATE_COLS = ['value date', 'date', 'transaction date', 'posting date', 'trans date'];
const DESC_COLS = ['description', 'title', 'narrative', 'details', 'transaction description', 'reference', 'payee', 'memo'];
const AMOUNT_COLS = ['amount', 'transaction amount', 'amount (zar)', 'value'];
const DEBIT_COLS = ['debit', 'debits', 'debit amount', 'money out', 'amount out', 'withdrawal', 'withdrawals', 'paid out'];
const CREDIT_COLS = ['credit', 'credits', 'credit amount', 'money in', 'amount in', 'deposit', 'deposits', 'paid in'];

module.exports = function registerImport(ctx) {
  const { S, $, money, toast, writeFile, currentPeriod, periodRange, periodTitle, lazyCatSelect, serializeTxFile, locale } = ctx;

  /* Static-ish view chrome that varies by country — banner blurb + drop hint. */
  function renderImport() {
    const loc = locale();
    $('#importSubNote').textContent = loc.banks
      ? `Bank statement exports — ${loc.banks} — or your own CSV`
      : 'Bank statement CSV exports — or any CSV with Date / Description / Amount columns';
    if (loc.importHint) $('#importDropHint').textContent = loc.importHint;
  }

  function autoCategorise(desc) {
    const d = desc.trim().toLowerCase();
    let best = '', bestLen = 0;
    for (const r of S.rules) {
      const p = r.pattern.trim().toLowerCase();
      if (!p) continue;
      if (p === d) return r.category;
      if (d.includes(p) && p.length > bestLen) { best = r.category; bestLen = p.length; }
    }
    return best;
  }
  function dedupSet() {
    const set = new Set();
    for (const f of Object.values(S.txFiles)) {
      for (const r of f.rows) set.add(`${r.date}|${r.desc.trim().toLowerCase()}|${r.amount.toFixed(2)}|${f.label.trim().toLowerCase()}`);
    }
    return set;
  }
  function detectAccountLabel(filename) {
    // Discovery-style "Label_12345_..." or a bare account number ("62351028991.csv",
    // "62351028991 (3).csv" — FNB names exports after the account alone). The bare
    // form needs 6+ digits so a leading year ("2026-07 export.csv") never matches.
    const m = filename.match(/^[A-Za-z][A-Za-z0-9]*_(\d{4,})(?:_|\.)/) ||
              filename.match(/^(\d{6,})\D/);
    if (m) {
      const acc = S.accounts.find(a => a.account_number === m[1]);
      if (acc) return acc.tx_label || acc.name;
    }
    return '';
  }

  async function handleCsvFile(file) {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) return toast('Empty CSV', true);
    let headerIdx = rows.findIndex(r => {
      const low = r.map(c => c.trim().toLowerCase());
      const has = names => names.some(n => low.includes(n));
      return (has(DATE_COLS) || low.some(c => c.includes('date'))) &&
             (has(AMOUNT_COLS) || (has(DEBIT_COLS) && has(CREDIT_COLS)));
    });
    if (headerIdx === -1) return toast('Could not find a header row with Date + Amount (or Debit/Credit) columns', true);
    const header = rows[headerIdx].map(c => c.trim());
    const low = header.map(c => c.toLowerCase());
    const col = names => { for (const n of names) { const i = low.indexOf(n); if (i !== -1) return i; } return -1; };
    const iDate = col(DATE_COLS);
    let iDesc = col(DESC_COLS);
    if (iDesc === -1) iDesc = low.findIndex(c => c.includes('desc'));  // e.g. "Transaction Descr."
    const iAmount = col(AMOUNT_COLS);
    const iDebit = col(DEBIT_COLS), iCredit = col(CREDIT_COLS);
    if (iDate === -1 || iDesc === -1 || (iAmount === -1 && (iDebit === -1 || iCredit === -1)))
      return toast('Missing columns — need Date, Title/Description, and Amount (or Debit + Credit)', true);

    const seen = dedupSet();
    const items = [];
    let skipped = 0;
    const label0 = detectAccountLabel(file.name);
    const dataRows = rows.slice(headerIdx + 1);
    const loc = locale();

    /* Auto-categorisation is O(rows × rules); chunk with a progress bar for
       anything sizeable so the UI stays responsive. */
    const showBar = dataRows.length > 400;
    if (showBar) importProgress('start', 'Categorising transactions…');
    const CHUNK = Math.max(250, Math.ceil(dataRows.length / 15));
    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const rawDate = (r[iDate] || '').trim();
      let desc = (r[iDesc] || '').trim();
      // Some banks suffix card rows with a country code (Discovery: " ZA") —
      // strip it so descriptions (and therefore dedup keys + categorisation)
      // stay clean. Which suffix, if any, comes from the country profile.
      if (loc.stripDescSuffix && desc.endsWith(loc.stripDescSuffix)) desc = desc.slice(0, -loc.stripDescSuffix.length);
      /* Amount: a single signed column when present, else credit (positive) /
         debit (negated — statements list debits as positive numbers). */
      let amount = iAmount !== -1 ? normalizeAmount(r[iAmount]) : null;
      if (amount == null && iCredit !== -1) {
        const c = normalizeAmount(r[iCredit]);
        if (c != null && c !== 0) amount = Math.abs(c);
      }
      if (amount == null && iDebit !== -1) {
        const d = normalizeAmount(r[iDebit]);
        if (d != null && d !== 0) amount = -Math.abs(d);
      }
      if (rawDate && desc && amount != null && amount !== 0) {
        const date = parseStatementDate(rawDate, loc.dayFirst);
        if (!date) { skipped++; }
        else {
          items.push({ date, desc, amount: parseFloat(amount.toFixed(2)), cat: autoCategorise(desc), include: true, excluded: false });
        }
      } else if (rawDate || desc) { skipped++; }
      if (showBar && (i % CHUNK === CHUNK - 1)) {
        importProgress('set', null, (i + 1) / dataRows.length * 0.9);
        await new Promise(res => setTimeout(res, 0));
      }
    }
    if (showBar) { importProgress('set', 'Preparing review…', 0.95); await new Promise(res => setTimeout(res, 0)); }
    S.pendingImport = { items, label: label0, seen, skipped, filename: file.name };
    renderImportReview();
    if (showBar) importProgress('done');
  }

  function importProgress(phase, text, frac) {
    const wrap = $('#importProgress'), bar = $('#ipBar'), pct = $('#ipPct'), lbl = $('#ipText');
    if (phase === 'done') { wrap.classList.add('hidden'); return; }
    if (phase === 'start') { wrap.classList.remove('hidden'); bar.style.width = '0%'; }
    if (text) lbl.textContent = text;
    if (frac != null) { const p = Math.round(frac * 100); bar.style.width = p + '%'; pct.textContent = p + '%'; }
  }

  function renderImportReview() {
    const p = S.pendingImport;
    if (!p) return;
    $('#importReview').classList.remove('hidden');
    const accSel = $('#impAccount'); accSel.innerHTML = '';
    const labels = [...new Set([
      ...S.accounts.map(a => a.tx_label || a.name),
      ...Object.values(S.txFiles).map(f => f.label)])].sort();
    for (const l of labels) accSel.append(el('option', { value: l, ...(l === p.label ? { selected: '' } : {}) }, l));
    if (!p.label && labels.length) p.label = accSel.value;
    accSel.onchange = () => { p.label = accSel.value; renderImportReview(); };

    const lab = (p.label || '').trim().toLowerCase();
    let dupes = 0;
    for (const it of p.items) {
      it.dup = p.seen.has(`${it.date}|${it.desc.trim().toLowerCase()}|${it.amount.toFixed(2)}|${lab}`);
      if (it.dup) { it.include = false; it.autoExcluded = true; dupes++; }
      else if (it.autoExcluded) { it.include = true; it.autoExcluded = false; }  // no longer a dup for this account → re-include
    }
    const newOnes = p.items.filter(i => !i.dup);
    const auto = newOnes.filter(i => i.cat).length;
    const cur = currentPeriod();
    const curRange = periodRange(cur);
    const inCurrent = it => it.date >= curRange.start && it.date <= curRange.end;
    const curCount = p.items.filter(inCurrent).length;
    $('#impStats').textContent =
      `${p.filename} — ${p.items.length} rows · ${newOnes.length} new · ${dupes} duplicates skipped · ${auto} auto-categorised` +
      (p.skipped ? ` · ${p.skipped} unparseable` : '');
    $('#impLegend').innerHTML = '';
    $('#impLegend').append(
      el('span', { class: 'imp-legend-swatch' }),
      el('span', {}, `${curCount} in the current period — ${periodTitle(cur)}`));

    const t = $('#impTable'); t.innerHTML = '';
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, ''), el('th', { scope: 'col' }, 'Date'), el('th', { scope: 'col' }, 'Description'),
      el('th', { scope: 'col', class: 'num' }, 'Amount'), el('th', { scope: 'col' }, 'Category'), el('th', { scope: 'col' }, 'Excl.'))));
    const body = el('tbody', {});
    for (const it of p.items) {
      const cls = (it.dup ? 'imp-dup' : '') + (inCurrent(it) ? ' imp-current' : '');
      body.append(el('tr', { class: cls.trim() },
        el('td', {}, it.dup ? el('span', { class: 'category-badge badge-dup' }, 'dup') :
          el('input', { type: 'checkbox', ...(it.include ? { checked: '' } : {}), onchange: e => it.include = e.target.checked })),
        el('td', { class: 'text-muted', style: 'white-space:nowrap' }, it.date),
        el('td', {}, it.desc),
        el('td', { class: `num${it.amount >= 0 ? ' text-success' : ''}`, style: 'white-space:nowrap;font-weight:600' }, money(it.amount)),
        el('td', {}, it.dup ? (it.cat || '') : lazyCatSelect(it.cat, v => { it.cat = v; it.manual = true; })),
        el('td', {}, it.dup ? '' : el('input', { type: 'checkbox', onchange: e => it.excluded = e.target.checked }))));
    }
    t.append(body);
  }

  async function commitImport() {
    const p = S.pendingImport;
    if (!p || !p.label) return toast('Pick an account first', true);
    // Sanitise the label before it becomes a folder name — it can originate
    // from an Accounts file's tx_label, which may be edited on a synced device.
    const label = safeSeg(p.label);
    if (!label) return toast('Invalid account name for import', true);
    const toAdd = p.items.filter(i => i.include && !i.dup);
    if (!toAdd.length) return toast('Nothing selected to import', true);

    // Group the new rows per month WITHOUT touching S yet. We write every file
    // first and only merge into S.txFiles once all writes succeed — so a failed
    // write (iCloud/disk error) leaves memory untouched and a retry can't
    // duplicate rows. serializeTxFile is fed a cloned row array (concat), so it
    // never mutates the live S.txFiles rows during the write phase.
    const additions = new Map();   // key -> { month, rows: [] }
    for (const it of toAdd) {
      const month = it.date.slice(0, 7);
      const key = `${label}/${month}`;
      if (!additions.has(key)) additions.set(key, { month, rows: [] });
      additions.get(key).rows.push({ date: it.date, desc: it.desc, cat: it.cat, amount: it.amount, excluded: it.excluded, note: it.excluded ? 'Excluded during import' : '' });
    }
    const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
    for (const [key, { month, rows }] of additions) {
      const existing = S.txFiles[key];
      const fileModel = existing
        ? { ...existing, rows: existing.rows.concat(rows) }
        : { label, month, rows, dirty: false, fmRaw: TX_FM };
      await writeFile(`Transactions/${label}/${month}.md`, serializeTxFile(fileModel));
    }
    // All writes succeeded — now merge into memory.
    for (const [key, { month, rows }] of additions) {
      if (!S.txFiles[key]) S.txFiles[key] = { label, month, rows: [], dirty: false, fmRaw: TX_FM };
      S.txFiles[key].rows.push(...rows);
    }
    const touched = additions;
    let newRules = 0;
    if ($('#impRemember').checked) {
      const have = new Set(S.rules.map(r => r.pattern.trim().toLowerCase()));
      for (const it of toAdd) {
        if (it.manual && it.cat && !have.has(it.desc.trim().toLowerCase())) {
          S.rules.push({ pattern: it.desc.trim(), category: it.cat });
          have.add(it.desc.trim().toLowerCase());
          newRules++;
        }
      }
      if (newRules) {
        S.rules.sort((a, b) => a.pattern.localeCompare(b.pattern, undefined, { sensitivity: 'base' }));
        const csv = 'pattern,category\n' + S.rules.map(r =>
          [r.pattern, r.category].map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n') + '\n';
        await writeFile('Data/Categorisation Rules.csv', csv);
      }
    }
    S.pendingImport = null;
    $('#importReview').classList.add('hidden');
    toast(`Imported ${toAdd.length} transactions into ${touched.size} file${touched.size === 1 ? '' : 's'}` +
          (newRules ? `, saved ${newRules} new rules` : ''));
    ctx.switchView('transactions');
  }

  Object.assign(ctx, { handleCsvFile, commitImport, renderImport });
};
