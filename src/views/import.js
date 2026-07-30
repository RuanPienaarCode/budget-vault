'use strict';
/* CSV import — bank statement exports (the banks named in the country
   profile) or any CSV with Date/Title/Amount headers: parse, auto-categorise
   via Data/Categorisation Rules.csv, dedupe against existing transactions,
   review, commit. Columns are matched by header name, so a hand-built
   Google Sheets / Excel export works the same as a bank's. Date order for
   ambiguous DD/MM vs MM/DD dates follows the country profile. */

const { el, parseCsv, parseStatementDate, normalizeAmount } = require('../util');
const { buildIndex, addToIndex, flagItems } = require('../dedupe');

/* Header-name aliases, lowercase. Exact match wins in array order; amount can
   come from a single signed column OR a debit + credit pair (Capitec "Money
   In"/"Money Out", Nedbank/Absa/Standard Bank Debit/Credit statements). */
const DATE_COLS = ['value date', 'date', 'transaction date', 'posting date', 'trans date'];
const DESC_COLS = ['description', 'title', 'narrative', 'details', 'transaction description', 'reference', 'payee', 'memo'];
const AMOUNT_COLS = ['amount', 'transaction amount', 'amount (zar)', 'value'];
const DEBIT_COLS = ['debit', 'debits', 'debit amount', 'money out', 'amount out', 'withdrawal', 'withdrawals', 'paid out'];
const CREDIT_COLS = ['credit', 'credits', 'credit amount', 'money in', 'amount in', 'deposit', 'deposits', 'paid in'];

module.exports = function registerImport(ctx) {
  const { S, $, money, toast, writeFile, currentPeriod, periodRange, periodTitle, deferredCatSelect, serializeTxFile, locale, learnRules, txSegment } = ctx;

  /* Static-ish view chrome that varies by country — banner blurb + drop hint. */
  function renderImport() {
    const loc = locale();
    $('#importSubNote').textContent = loc.banks
      ? `Bank statement exports — ${loc.banks} — or your own CSV`
      : 'Bank statement CSV exports — or any CSV with Date / Description / Amount columns';
    if (loc.importHint) $('#importDropHint').textContent = loc.importHint;
  }

  /* Normalise the rule list ONCE per import, not once per row. Rules grow
     monotonically (learnRules adds one per new merchant every import), so the
     inner-loop lowercasing was rows × rules: measured 51ms at 1,200 rows and
     2,000 rules on desktop, several hundred on a phone. The length test comes
     before includes() for the same reason — it's the cheaper comparison. */
  function prepareRules() {
    return S.rules
      .map(r => ({ p: r.pattern.trim().toLowerCase(), category: r.category }))
      .filter(r => r.p);
  }
  function autoCategorise(desc, rules) {
    const d = desc.trim().toLowerCase();
    let best = '', bestLen = 0;
    for (const r of rules) {
      if (r.p === d) return r.category;
      if (r.p.length > bestLen && d.includes(r.p)) { best = r.category; bestLen = r.p.length; }
    }
    return best;
  }
  function dedupIndex() {
    return buildIndex(S.txFiles);
  }
  function detectAccountLabel(filename) {
    // Discovery-style "Label_12345_..." or a bare account number ("12345678901.csv",
    // "12345678901 (3).csv" — FNB names exports after the account alone). The bare
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
    // Both fall back to a substring match, mirroring the loose test the header
    // row itself was detected with — otherwise a file headed "Date Posted" or
    // "Effective Date" passes detection and then fails as "missing columns".
    let iDate = col(DATE_COLS);
    if (iDate === -1) iDate = low.findIndex(c => c.includes('date'));
    let iDesc = col(DESC_COLS);
    if (iDesc === -1) iDesc = low.findIndex(c => c.includes('desc'));  // e.g. "Transaction Descr."
    const iAmount = col(AMOUNT_COLS);
    const iDebit = col(DEBIT_COLS), iCredit = col(CREDIT_COLS);
    if (iDate === -1 || iDesc === -1 || (iAmount === -1 && (iDebit === -1 || iCredit === -1)))
      return toast('Missing columns — need Date, Title/Description, and Amount (or Debit + Credit)', true);

    const index = dedupIndex();
    const items = [];
    let skipped = 0;
    const label0 = detectAccountLabel(file.name);
    const dataRows = rows.slice(headerIdx + 1);
    const loc = locale();

    /* Auto-categorisation is O(rows × rules); chunk with a progress bar for
       anything sizeable so the UI stays responsive. */
    // Threshold sized to where the work is actually perceptible: 400 rows
    // against a typical rule set is a few milliseconds, so the bar used to
    // flash for nothing.
    const rules = prepareRules();
    const showBar = dataRows.length > 1500;
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
          items.push({ date, desc, amount: parseFloat(amount.toFixed(2)), cat: autoCategorise(desc, rules), include: true, excluded: false });
        }
      } else if (rawDate || desc) { skipped++; }
      if (showBar && (i % CHUNK === CHUNK - 1)) {
        importProgress('set', null, (i + 1) / dataRows.length * 0.9);
        await new Promise(res => setTimeout(res, 0));
      }
    }
    if (showBar) { importProgress('set', 'Preparing review…', 0.95); await new Promise(res => setTimeout(res, 0)); }
    /* The file's own date span. The near-duplicate pass treats "this row is no
       longer in the statement" as evidence it settled and was rewritten, so it
       may only reason about vault rows the statement actually covers. */
    let range = null;
    for (const it of items) {
      if (!range) range = { min: it.date, max: it.date };
      else { if (it.date < range.min) range.min = it.date; if (it.date > range.max) range.max = it.date; }
    }
    S.pendingImport = { items, label: label0, index, range, skipped, filename: file.name };
    importShown = IMPORT_PAGE;   // a fresh file starts at the first page
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

  /* The review table had no cap at all: a 12-month export (2,000 rows) built
     ~30,000 nodes and 6,000 native controls in one uninterruptible pass, so the
     screen froze right after the progress bar reached "Preparing review… 95%" —
     a stall longer than everything the bar was actually measuring. Render a
     page at a time; the checkboxes below operate on p.items, not on the DOM, so
     selecting all still covers rows that were never rendered. */
  const IMPORT_PAGE = 200;
  let importShown = IMPORT_PAGE;

  function renderImportReview() {
    const p = S.pendingImport;
    if (!p) return;
    $('#importReview').classList.remove('hidden');
    const accSel = $('#impAccount'); accSel.empty();
    const labels = [...new Set([
      ...S.accounts.map(a => a.tx_label || a.name),
      ...Object.values(S.txFiles).map(f => f.label)])].sort();
    for (const l of labels) accSel.append(el('option', { value: l, ...(l === p.label ? { selected: '' } : {}) }, l));
    if (!p.label && labels.length) p.label = accSel.value;
    accSel.onchange = () => { p.label = accSel.value; renderImportReview(); };

    // Canonicalise through txSegment — the same resolver commitImport writes
    // with, and the same string dedupIndex keyed by. Probing with the raw label
    // (or with a differently-sanitised one) would miss duplicates and re-import
    // rows that are already on disk.
    const lab = txSegment(p.label || '').trim().toLowerCase();
    /* Exact duplicates, then the charges the bank re-dated or re-worded between
       exports — see src/dedupe.js for both. Near-dups are unticked and labelled,
       never skipped: the user sees what each collided with and can override. */
    const { dupes, nears } = flagItems(p.items, p.index, lab, p.range);
    const newOnes = p.items.filter(i => !i.dup);
    const auto = newOnes.filter(i => i.cat).length;
    const cur = currentPeriod();
    const curRange = periodRange(cur);
    const inCurrent = it => it.date >= curRange.start && it.date <= curRange.end;
    const curCount = p.items.filter(inCurrent).length;
    $('#impStats').textContent =
      `${p.filename} — ${p.items.length} rows · ${newOnes.length} new · ${dupes} duplicates skipped` +
      (nears ? ` · ${nears} likely re-dated/re-worded (unticked)` : '') +
      ` · ${auto} auto-categorised` +
      (p.skipped ? ` · ${p.skipped} unparseable` : '');
    $('#impLegend').empty();
    $('#impLegend').append(
      el('span', { class: 'imp-legend-swatch' }),
      el('span', {}, `${curCount} in the current period — ${periodTitle(cur)}`));

    const t = $('#impTable'); t.empty();
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, el('span', { class: 'sr-only' }, 'Import')),
      el('th', { scope: 'col' }, 'Date'), el('th', { scope: 'col' }, 'Description'),
      el('th', { scope: 'col', class: 'num' }, 'Amount'), el('th', { scope: 'col' }, 'Category'), el('th', { scope: 'col' }, 'Excl.'))));
    const body = el('tbody', {});
    const visible = p.items.slice(0, importShown);
    for (const it of visible) {
      const cls = (it.dup ? 'imp-dup' : it.near ? 'imp-near' : '') + (inCurrent(it) ? ' imp-current' : '');
      // Spelled out rather than left to the badge: the row is unticked, and the
      // user needs to know WHICH existing row it collided with to judge whether
      // this is the bank rewriting a pending charge or a real second purchase.
      const nearWhy = it.near
        ? `Looks like the already-imported "${it.near.desc}" on ${it.near.date} — the bank re-dates and re-words a charge when it settles. Tick to import anyway.`
        : '';
      body.append(el('tr', { class: cls.trim() },
        el('td', {}, it.dup ? el('span', { class: 'category-badge badge-dup' }, 'dup') :
          el('input', { type: 'checkbox', 'aria-label': `Import ${it.date} ${it.desc}, ${money(it.amount)}${it.near ? '. ' + nearWhy : ''}`,
            // nearAuto stays TRUE once we have auto-unticked: it records that the
            // untick already happened, so a re-render (account switch, "show
            // more") leaves the user's decision — either way — alone.
            ...(it.include ? { checked: '' } : {}), onchange: e => it.include = e.target.checked })),
        el('td', { class: 'text-muted', style: 'white-space:nowrap' }, it.date),
        el('td', {}, it.desc, ...(it.near ? [
          el('span', { class: 'category-badge badge-near', title: nearWhy }, 'likely dup'),
          el('div', { class: 'imp-near-why' }, nearWhy),
        ] : [])),
        el('td', { class: `num${it.amount >= 0 ? ' text-success' : ''}`, style: 'white-space:nowrap;font-weight:600' }, money(it.amount)),
        el('td', {}, it.dup ? (it.cat || '') : deferredCatSelect(it.cat, v => { it.cat = v; it.manual = true; }, `Category for ${it.desc}`)),
        // `checked` reflects the model: after a partial-failure re-render the
        // ticks used to vanish while the rows stayed excluded.
        el('td', {}, it.dup ? '' : el('input', { type: 'checkbox', 'aria-label': `Exclude ${it.desc} from budget totals`,
          ...(it.excluded ? { checked: '' } : {}), onchange: e => it.excluded = e.target.checked }))));
    }
    if (p.items.length > visible.length) {
      const rest = p.items.length - visible.length;
      const more = el('button', { class: 'btn-ghost', style: 'width:100%;padding:0.6rem' },
        `Show ${Math.min(IMPORT_PAGE, rest)} more of ${rest} remaining`);
      more.addEventListener('click', () => { importShown += IMPORT_PAGE; renderImportReview(); });
      body.append(el('tr', {}, el('td', { colspan: '6', style: 'padding:0' }, more)));
      // Say so out loud — a silent cap reads as "these are all the rows", and
      // the user is about to press a button that imports the ones off-screen too.
      $('#impStats').textContent += ` · showing ${visible.length}, all ${p.items.length} will import`;
    }
    t.append(body);
  }

  async function commitImport() {
    const p = S.pendingImport;
    if (!p || !p.label) return toast('Pick an account first', true);
    // Resolve the label before it becomes a folder name — it can originate from
    // an Accounts file's tx_label, which may be edited on a synced device.
    // txSegment keeps an existing folder's on-disk name so the S.txFiles key
    // below and the path written match exactly.
    const label = txSegment(p.label);
    if (!label) return toast('Invalid account name for import', true);
    const toAdd = p.items.filter(i => i.include && !i.dup);
    if (!toAdd.length) return toast('Nothing selected to import', true);

    // Group the new rows per month, keeping a back-reference to each source item
    // so a committed row can be neutralised after it lands.
    const additions = new Map();   // key -> { month, entries: [{ row, src }] }
    for (const it of toAdd) {
      const month = it.date.slice(0, 7);
      const key = `${label}/${month}`;
      if (!additions.has(key)) additions.set(key, { month, entries: [] });
      additions.get(key).entries.push({
        row: { date: it.date, desc: it.desc, cat: it.cat, amount: it.amount, excluded: it.excluded, note: it.excluded ? 'Excluded during import' : '' },
        src: it,
      });
    }
    const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
    // Same canonical form dedupIndex / renderImportReview key by (the txSegment'd
    // folder label), so a retry after a partial failure recognises landed rows.
    const lab = label.trim().toLowerCase();
    // Write each month-file and reflect it in memory in the SAME step — disk and
    // S.txFiles stay in lockstep per file. If a later file's write fails (iCloud /
    // disk error), the files already written are modelled in memory AND their
    // source rows are marked done, so a retry imports only the rest — it can
    // never re-append a row that already reached disk. serializeTxFile is fed a
    // cloned row array (concat), so it never mutates live S.txFiles rows.
    let done = 0;
    try {
      for (const [key, { month, entries }] of additions) {
        const rows = entries.map(e => e.row);
        const existing = S.txFiles[key];
        const fileModel = existing
          ? { ...existing, rows: existing.rows.concat(rows) }
          : { label, month, rows, dirty: false, fmRaw: TX_FM };
        await writeFile(`Transactions/${label}/${month}.md`, serializeTxFile(fileModel));
        if (!S.txFiles[key]) S.txFiles[key] = { label, month, rows: [], dirty: false, fmRaw: TX_FM };
        S.txFiles[key].rows.push(...rows);
        // Neutralise the committed items and record them in the dedup snapshot so
        // a re-render / retry treats them as already-present (no re-import).
        for (const e of entries) {
          e.src.include = false;
          // Into BOTH layers: a retry must see the landed row as an exact dup,
          // and the near pass must be able to match a later rewrite of it.
          addToIndex(p.index, e.src.date, e.src.desc, e.src.amount, lab);
        }
        done += rows.length;
      }
    } catch (err) {
      renderImportReview();   // reflect what already landed; the rest stays selectable
      return toast(`Import stopped after ${done} row${done === 1 ? '' : 's'} (${err.message || err}). Saved rows kept — click Import rows again to retry the rest.`, true);
    }
    const touched = additions;
    let newRules = 0;
    if ($('#impRemember').checked) {
      newRules = await learnRules(toAdd.filter(it => it.manual && it.cat).map(it => ({ desc: it.desc, cat: it.cat })));
    }
    S.pendingImport = null;
    $('#importReview').classList.add('hidden');
    toast(`Imported ${toAdd.length} transactions into ${touched.size} file${touched.size === 1 ? '' : 's'}` +
          (newRules ? `, saved ${newRules} new rules` : ''));
    ctx.switchView('transactions');
  }

  ctx.provide({ handleCsvFile, commitImport, renderImport });
};
