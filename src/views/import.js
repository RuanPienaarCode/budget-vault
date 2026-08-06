'use strict';
/* Statement import — bank statement exports (the banks named in the country
   profile) or any delimited text with Date/Title/Amount headers: parse,
   auto-categorise via Data/Categorisation Rules.csv, dedupe against existing
   transactions, review, commit. Columns are matched by header name, so a
   hand-built Google Sheets / Excel export works the same as a bank's. Date
   order for ambiguous DD/MM vs MM/DD dates follows the country profile.

   Comma, semicolon, tab and pipe files all import: the delimiter is sniffed
   from the file, and the character encoding is read off its bytes rather than
   assumed to be UTF-8. Both live in util.js so they are testable on their own,
   and both are deliberately confined to FOREIGN files — the app's own CSVs are
   read by parseCsv, which is comma-only. */

const { el, parseStatement, decodeStatement, parseStatementDate, normalizeAmount, detectStatementColumns, reconcileAmounts } = require('../util');
const { buildIndex, addToIndex, flagItems } = require('../dedupe');

module.exports = function registerImport(ctx) {
  const { S, $, money, toast, writeFile, currentPeriod, periodRange, periodTitle, deferredCatSelect, serializeTxFile, locale, learnRules, txSegment, accountForLabel } = ctx;

  /* Static-ish view chrome that varies by country — banner blurb + drop hint. */
  function renderImport() {
    const loc = locale();
    // "tested with" rather than "works with": other banks are expected to work,
    // and the review screen reports how much it could verify for each file.
    $('#importSubNote').textContent = loc.banks
      ? `Bank statement exports — tested with ${loc.banks}, other banks usually work too — or your own CSV`
      : 'Bank statement exports — or any CSV / TSV with Date / Description / Amount columns';
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
  function detectAccountLabel(filename, rows) {
    // Discovery-style "Label_12345_..." or a bare account number ("12345678901.csv",
    // "12345678901 (3).csv" — FNB names exports after the account alone). The bare
    // form needs 6+ digits so a leading year ("2026-07 export.csv") never matches.
    const m = filename.match(/^[A-Za-z][A-Za-z0-9]*_(\d{4,})(?:_|\.)/) ||
              filename.match(/^(\d{6,})\D/);
    const byNumber = n => {
      const acc = S.accounts.find(a => a.account_number === n);
      return acc ? (acc.tx_label || acc.name) : '';
    };
    if (m) { const l = byNumber(m[1]); if (l) return l; }
    // Nedbank prints "Account Number :,1041005172" in its preamble — the only
    // handle left once the file has been renamed on the way out of the browser.
    for (const r of (rows || []).slice(0, 10)) {
      const i = r.findIndex(c => /account\s*number/i.test(c || ''));
      if (i === -1) continue;
      const digits = ((r[i + 1] || r[i]).match(/\d{4,}/) || [])[0];
      if (digits) { const l = byNumber(digits); if (l) return l; }
    }
    return '';
  }

  async function handleStatementFile(file) {
    // Bytes, not file.text() — the encoding is read off the bytes rather than
    // assumed to be UTF-8, and the delimiter off the decoded text rather than
    // assumed to be a comma. See decodeStatement / sniffDelimiter in util.js.
    const text = decodeStatement(new Uint8Array(await file.arrayBuffer()));
    const rows = parseStatement(text);
    if (!rows.length) return toast('Empty statement file', true);
    const loc = locale();
    const map = detectStatementColumns(rows, loc.dayFirst);
    // Nothing resolved — but the file is readable, so ask instead of refusing.
    // This is what makes a bank nobody has tested importable at all.
    if (!map) return showColumnMapper(rows, file, null);
    await runImport(rows, map, file);
  }

  /* Parse the rows under a column map (auto-detected or chosen by hand) and put
     the result on the review screen. Split out from handleStatementFile so the manual
     mapper re-enters at exactly the same place with exactly the same rules. */
  async function runImport(rows, map, file) {
    const loc = locale();
    const { iDate, iDesc, iAmount, iDebit, iCredit, iBalance, iExtra } = map;
    const dataRows = rows.slice(map.dataStart);

    const index = dedupIndex();
    const items = [];
    let skipped = 0;
    const label0 = detectAccountLabel(file.name, rows);

    /* Auto-categorisation is O(rows × rules); chunk with a progress bar for
       anything sizeable so the UI stays responsive. */
    // Threshold sized to where the work is actually perceptible: 400 rows
    // against a typical rule set is a few milliseconds, so the bar used to
    // flash for nothing.
    const rules = prepareRules();
    /* Every row's (amount, balance) pair in file order — including the rows that
       never become transactions, because an unbroken run of balances is what
       makes the reconciliation below conclusive. */
    const ledger = [];
    const showBar = dataRows.length > 1500;
    if (showBar) importProgress('start', 'Categorising transactions…');
    const CHUNK = Math.max(250, Math.ceil(dataRows.length / 15));
    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const rawDate = (r[iDate] || '').trim();
      let desc = (r[iDesc] || '').trim();
      // A second text column, only ever set by hand in the mapper — statements
      // that split the counterparty from the reference ("to"/"from" columns)
      // need both to describe the transaction.
      if (iExtra !== -1 && iExtra !== iDesc) {
        const extra = (r[iExtra] || '').trim();
        if (extra && extra !== desc) desc = desc ? `${desc} — ${extra}` : extra;
      }
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
      if (iBalance !== -1 && amount != null) ledger.push({ amount, balance: normalizeAmount(r[iBalance]) });
      const date = rawDate ? parseStatementDate(rawDate, loc.dayFirst) : null;
      if (date && desc && amount != null && amount !== 0) {
        items.push({ date, desc, amount: parseFloat(amount.toFixed(2)), cat: autoCategorise(desc, rules), include: true, excluded: false });
      } else if (date || amount != null) {
        // Looked like a transaction and wasn't usable — worth reporting.
        skipped++;
      }
      // Anything else (a preamble line, a blank, a trailing disclaimer) carries
      // neither a date nor an amount and is ignored silently. Counting those as
      // "unparseable" made a hand-mapped statement look broken when it wasn't.
      if (showBar && (i % CHUNK === CHUNK - 1)) {
        importProgress('set', null, (i + 1) / dataRows.length * 0.9);
        await new Promise(res => setTimeout(res, 0));
      }
    }
    if (showBar) { importProgress('set', 'Preparing review…', 0.95); await new Promise(res => setTimeout(res, 0)); }
    /* Prove the sign convention against the statement's own balance column.
       This is what lets a bank nobody has tested import safely: if its single
       Amount column lists debits as positive, the balances say so and every
       amount is corrected here. Only a signed Amount column is ever flipped —
       a Debit/Credit pair is already normalised by name above, so a failure
       there means something else is off and is reported, not "fixed".
       A file that doesn't prove itself is imported UNCHANGED and flagged in the
       review; silent correction on a guess is the one outcome to avoid. */
    const rec = iBalance !== -1 ? reconcileAmounts(ledger) : null;
    if (rec && rec.verified && rec.flip && iAmount !== -1) for (const it of items) it.amount = -it.amount;
    /* The file's own date span. The near-duplicate pass treats "this row is no
       longer in the statement" as evidence it settled and was rewritten, so it
       may only reason about vault rows the statement actually covers. */
    let range = null;
    for (const it of items) {
      if (!range) range = { min: it.date, max: it.date };
      else { if (it.date < range.min) range.min = it.date; if (it.date > range.max) range.max = it.date; }
    }
    S.pendingImport = { items, label: label0, index, range, skipped, filename: file.name,
      reconcile: rec ? { ...rec, flipped: rec.verified && rec.flip && iAmount !== -1 } : null,
      // Kept so "Columns wrong?" can reopen the mapper on the SAME file without
      // asking the user to find and drop it again.
      rows, map, file };
    $('#importMap').classList.add('hidden');
    importShown = IMPORT_PAGE;   // a fresh file starts at the first page
    renderImportReview();
    if (showBar) importProgress('done');
  }

  /* ---------------------------------------------------------------- mapper
     Auto-detection is the fast path and runs first; this is how the user
     overrides it — either because nothing resolved (an untested bank) or
     because the review screen showed the wrong column picked. Prefilled with
     whatever WAS detected, so it's an adjustment rather than a blank form. */
  const MAP_FIELDS = [
    { key: 'iDate', label: 'Date', required: true, hint: 'When the transaction happened' },
    { key: 'iDesc', label: 'Description', required: true, hint: 'The payee or reference' },
    { key: 'iExtra', label: 'Extra detail', required: false, hint: 'Optional second text column — added to the description' },
    { key: 'iAmount', label: 'Amount', required: false, hint: 'One signed column: negative is money out' },
    { key: 'iDebit', label: 'Money out', required: false, hint: 'Use instead of Amount when out and in are separate columns' },
    { key: 'iCredit', label: 'Money in', required: false, hint: 'The partner column to Money out' },
    { key: 'iBalance', label: 'Balance', required: false, hint: 'Optional — lets the amounts be checked against the running balance' },
  ];

  function showColumnMapper(rows, file, detected) {
    const loc = locale();
    // Widest row wins: a preamble or a ragged total line must not decide how
    // many columns the user is offered.
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    if (!width) return toast('Empty statement file', true);
    const headerIdx = detected && detected.headerIdx >= 0 ? detected.headerIdx : -1;
    const header = headerIdx >= 0 ? rows[headerIdx] : null;
    // A row that looks like data is the useful preview; failing that, show the
    // top of the file so the user can at least see what they're mapping.
    let start = detected ? detected.dataStart : rows.findIndex(r =>
      r.length >= 3 && r.some(c => parseStatementDate(c, loc.dayFirst)) && r.some(c => normalizeAmount(c) != null));
    if (start == null || start < 0) start = 0;

    $('#importReview').classList.add('hidden');
    $('#importMap').classList.remove('hidden');
    $('#impMapNote').textContent = detected
      ? `${file.name} — change any column the importer got wrong, then re-read the file.`
      : `${file.name} — this export isn't one the importer recognises. Point it at the right columns and it will import like any other.`;
    $('#impMapWarn').textContent = '';

    const colLabel = i => {
      const name = header && (header[i] || '').trim();
      const sample = (rows[start] && (rows[start][i] || '').trim()) || '';
      return `${i + 1}${name ? ` — ${name}` : ''}${!name && sample ? ` — e.g. ${sample.slice(0, 22)}` : ''}`;
    };
    /* Starting picks for the two required fields when nothing was detected.
       Defaulting both to column 0 guaranteed that the first press of "Use these
       columns" failed the Date-and-Description-are-the-same guard — a mapper
       that opens in an invalid state teaches the user the button is broken.
       These are the same cheap signals the shape detector reads, so where the
       file is at all conventional the mapper opens on a sane guess; where it
       isn't, the picks are at least distinct and the user moves two selects. */
    const sample = rows[start] || [];
    const looksDate = i => !!parseStatementDate((sample[i] || '').trim(), loc.dayFirst);
    const looksText = i => {
      const v = (sample[i] || '').trim();
      return !!v && normalizeAmount(v) == null && !looksDate(i);
    };
    const firstOr = (pred, fallback) => {
      for (let i = 0; i < width; i++) if (pred(i)) return i;
      return fallback;
    };
    const defDate = firstOr(looksDate, 0);
    // Never the date column, even when no column reads as free text — two
    // required fields on one column is the one combination that cannot import.
    const defDesc = firstOr(i => i !== defDate && looksText(i), defDate === 0 ? 1 : 0);
    const fallbackFor = key => key === 'iDate' ? defDate : key === 'iDesc' ? defDesc : -1;

    const fields = $('#impMapFields'); fields.empty();
    const selects = {};
    for (const f of MAP_FIELDS) {
      const sel = el('select', { class: 'form-select form-select-sm', id: `impMap_${f.key}`, 'aria-label': f.label });
      if (!f.required) sel.append(el('option', { value: '-1' }, '(none)'));
      for (let i = 0; i < width; i++) sel.append(el('option', { value: String(i) }, colLabel(i)));
      const cur = detected ? detected[f.key] : -1;
      sel.value = String(cur != null && cur >= 0 ? cur : fallbackFor(f.key));
      selects[f.key] = sel;
      fields.append(el('label', { class: 'imp-map-field' },
        el('span', { class: 'imp-map-label' }, f.label + (f.required ? '' : ' (optional)')),
        sel, el('span', { class: 'imp-map-hint' }, f.hint)));
    }

    // Preview the rows as they'll actually be read, so a wrong pick is visible
    // here rather than discovered in the review table.
    const prev = $('#impMapPreview'); prev.empty();
    prev.append(el('thead', {}, el('tr', {}, ...Array.from({ length: width }, (_, i) =>
      el('th', { scope: 'col' }, colLabel(i))))));
    prev.append(el('tbody', {}, ...rows.slice(start, start + 5).map(r =>
      el('tr', {}, ...Array.from({ length: width }, (_, i) => el('td', {}, (r[i] || '').trim()))))));

    $('#impMapCancel').onclick = () => {
      $('#importMap').classList.add('hidden');
      if (S.pendingImport) $('#importReview').classList.remove('hidden');
    };
    $('#impMapApply').onclick = async () => {
      // Clear first: a warning left over from the previous press outlives the
      // problem it described, so a successful mapping would still be sitting
      // under a sentence telling the user it failed.
      $('#impMapWarn').textContent = '';
      const map = { headerIdx, dataStart: start, iExtra: -1 };
      for (const f of MAP_FIELDS) map[f.key] = parseInt(selects[f.key].value, 10);
      // Refuse the two combinations that can't produce a transaction, and say
      // which — an empty review table is a far worse answer than a sentence.
      if (map.iDate === map.iDesc)
        return ($('#impMapWarn').textContent = 'Date and Description are the same column — pick different ones.');
      if (map.iAmount === -1 && (map.iDebit === -1 || map.iCredit === -1))
        return ($('#impMapWarn').textContent = 'Pick an Amount column, or both Money out and Money in.');
      await runImport(rows, map, file);
      if (!S.pendingImport || !S.pendingImport.items.length) {
        $('#importMap').classList.remove('hidden');
        $('#impMapWarn').textContent = 'That mapping produced no transactions — check the Date column especially.';
      }
    };
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
    /* Say out loud whether the file proved its own amounts. A bank this app has
       never been tested against is perfectly importable — but the user is the
       one who should decide how much to trust it, and that decision needs the
       evidence, not silence. */
    const rec = p.reconcile;
    const recEl = $('#impReconcile');
    recEl.empty();
    recEl.classList.toggle('hidden', !rec);
    recEl.classList.toggle('imp-reconcile-warn', !!rec && !rec.verified);
    if (rec) recEl.textContent = rec.flipped
      ? 'This statement lists money out as positive. Checked against its balance column and corrected — money out shows as negative below.'
      : rec.verified
        ? 'Amounts check out against this statement’s own balance column.'
        : 'Could not check these amounts against the balance column — the balances don’t line up. Spot-check a few rows below before importing, especially the + and − signs.';

    /* Say where these rows are going to land BEFORE they land. An account
       flagged `budget: false` still imports and still shows in Transactions,
       but never reaches the Dashboard's income/spend — which looks like a
       broken import to anyone who doesn't know the flag is set. */
    const target = accountForLabel(p.label || '');
    const nbEl = $('#impNonBudget');
    const nonBudget = !!target && !target.in_budget;
    nbEl.classList.toggle('hidden', !nonBudget);
    if (nonBudget) nbEl.textContent =
      `${target.name} is excluded from the budget — these rows will import and show in Transactions, but won’t count toward income or spending totals.`;

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

  /* "Columns wrong?" on the review screen — reopen the mapper against the file
     already in hand, prefilled with the mapping that produced what's on screen.
     Nothing is committed yet at this point, so re-reading is free. */
  function remapImport() {
    const p = S.pendingImport;
    if (!p || !p.rows) return toast('Drop a statement first', true);
    showColumnMapper(p.rows, p.file, p.map);
  }

  ctx.provide({ handleStatementFile, commitImport, renderImport, remapImport });
};
