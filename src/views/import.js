'use strict';
/* Statement import — bank statement exports (the banks named in the country
   profile) or any delimited text with Date/Title/Amount headers: parse,
   auto-categorise via Data/Categorisation Rules.csv, dedupe against existing
   transactions, review, commit. Columns are matched by header name, so a
   hand-built Google Sheets / Excel export works the same as a bank's. Date
   order for ambiguous DD/MM vs MM/DD dates follows the country profile.

   Comma, semicolon, tab and pipe files all import: the delimiter is sniffed
   from the file, and the character encoding is read off its bytes rather than
   assumed to be UTF-8. Both live in statement.js so they are testable on their own,
   and both are deliberately confined to FOREIGN files — the app's own CSVs are
   read by parseCsv, which is comma-only. */

const { el } = require('../dom');
const { normalizeAmount, inferGrouping } = require('../amount');
const { parseStatement, decodeStatement, parseStatementDate, detectStatementColumns, reconcileAmounts, applyCounterparties,
  statementAccountNumber, sameAccountNumber } = require('../statement');
const { prepareRules, autoCategorise, matchRule } = require('../rules');
const { buildIndex, addToIndex, flagItems } = require('../dedupe');
const { confirmModal } = require('../modal');
const { isCreditCard } = require('../committed');
const { symbolOf, isForeign } = require('../currency');

module.exports = function registerImport(ctx) {
  const { S, $, app, money, toast, writeFile, currentPeriod, periodRange, periodTitle, deferredCatSelect, serializeTxFile, locale, learnRules, txSegment, accountForLabel } = ctx;

  /* The formatter for a previewed row, rebound whenever the destination
     account changes (see renderPreview). Defaults to money() so any path that
     renders before an account is chosen still prints something sane, and so a
     single-currency vault — nearly all of them — is on the same formatter as
     the rest of the app. */
  let previewMoney = v => money(v);

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

  // Mirrors what #fileInput already advertises (src/shell.js:
  // accept=".csv,.tsv,.txt,…") so the two entry points never disagree about
  // what this importer accepts.
  const STATEMENT_EXT = /\.(csv|tsv|txt)$/i;

  async function handleStatementFile(file) {
    /* The native file picker's `accept` only SUGGESTS a filter (and a user
       can pick "All Files" through it anyway); a drag-drop has no filter at
       all — src/controller.js's wireDropZone hands `e.dataTransfer.files[0]`
       straight to this function. Checked again here, the ONE place both
       paths funnel through, because the single most likely wrong file to
       drop is a bank statement PDF sitting right next to the CSV in
       Downloads. Without this, decodeStatement below turns it into binary
       garbage, column detection fails, and showColumnMapper then tells the
       user "this export isn't one the importer recognises. Point it at the
       right columns and it will import like any other" over a preview of
       mojibake — confidently wrong about what actually happened. Extension
       only, not MIME: a dropped file's `file.type` is frequently empty or
       wrong, where the name is what the user actually sees and chose. */
    if (!STATEMENT_EXT.test(file.name || '')) {
      return toast(
        `"${file.name}" doesn't look like a bank statement export — this importer reads CSV, TSV or TXT files. ` +
        'If your bank only gives you a PDF, export or save it as CSV first.',
        true,
      );
    }
    // Bytes, not file.text() — the encoding is read off the bytes rather than
    // assumed to be UTF-8, and the delimiter off the decoded text rather than
    // assumed to be a comma. See decodeStatement in statement.js / sniffDelimiter in csv.js.
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
     the result on the review screen. Split out from handleStatementFile so the
     manual mapper re-enters at exactly the same place with exactly the same
     rules. */
  async function runImport(rows, map, file) {
    const loc = locale();
    const { iDate, iDesc, iAmount, iDebit, iCredit, iBalance, iExtra } = map;
    // Defaulted rather than destructured: a map built before the fee column
    // existed (the manual mapper's, on a re-read of an open file) carries no
    // iFee, and `undefined !== -1` would index every row at r[undefined].
    const iFee = map.iFee == null ? -1 : map.iFee;
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
    const rules = prepareRules(S.rules);
    /* Every row's (amount, balance) pair in file order — including the rows that
       never become transactions, because an unbroken run of balances is what
       makes the reconciliation below conclusive. */
    const ledger = [];
    /* ISSUE 30. What "1.500" means is a property of the FILE, not of the cell,
       and reading it per cell put two different answers in one column. On a
       real Indonesian export:

         Rp -1.500.000  ->  -1500000   (two dot groups: unambiguous)
         Rp   -250.000  ->      -250   (one group: ambiguous, left alone)

       -250 sitting next to -1500000, off by a thousand, with nothing on screen
       to suggest anything had happened. Inferred once here over every amount
       column this file actually has — signed, debit, credit, fee and balance —
       so the evidence is as wide as possible, and applied to every cell below.
       inferGrouping() only ever takes evidence from the UNAMBIGUOUS forms and
       returns null when a file offers none or offers both, in which case every
       cell parses exactly as it did before this existed. */
    const amountCells = [];
    for (const r of dataRows) {
      for (const i of [iAmount, iDebit, iCredit, iFee, iBalance]) {
        if (i !== -1 && r[i]) amountCells.push(r[i]);
      }
    }
    const numOpts = { grouping: inferGrouping(amountCells) };
    const num = v => normalizeAmount(v, numOpts);
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
      let amount = iAmount !== -1 ? num(r[iAmount]) : null;
      if (amount == null && iCredit !== -1) {
        const c = num(r[iCredit]);
        // Money in is normally written as a plain positive number, but an
        // explicit sign in the cell is the statement telling us something —
        // a reversal-of-a-refund posted as "-30.00" in the Credit column is
        // money OUT, and abs-ing it away booked a real outflow as income.
        // Honour whatever sign normalizeAmount actually read.
        if (c != null && c !== 0) amount = c;
      }
      if (amount == null && iDebit !== -1) {
        const d = num(r[iDebit]);
        if (d != null && d !== 0) amount = -Math.abs(d);
      }
      /* The third column — a bank charge, which Capitec writes in `Fee` with
         Money In and Money Out both empty. Read LAST, so a file that somehow
         carries both keeps the pair the header named.

         The cell's own sign is honoured, exactly as the credit branch honours
         it and unlike the debit branch's -Math.abs(). That is not a stylistic
         choice: the fee column is already signed (-0.35 for a charge), and 8 of
         the 553 fee rows on the statement this was written against are
         REVERSALS — "Correction: Cash Withdrawal Fee" at +30.00. Negating by
         magnitude would turn every refunded charge into a second charge, which
         is a worse error than the one being fixed here because it invents money
         leaving rather than merely failing to see it leave. A bank that writes
         fees unsigned instead is caught by the balance column: fee rows are in
         the ledger below, so the reconciliation now judges them too. */
      if (amount == null && iFee !== -1) {
        const f = num(r[iFee]);
        if (f != null && f !== 0) amount = f;
      }
      if (iBalance !== -1 && amount != null) ledger.push({ amount, balance: num(r[iBalance]) });
      const date = rawDate ? parseStatementDate(rawDate, loc.dayFirst) : null;
      if (date && desc && amount != null && amount !== 0) {
        /* excluded/transferTo are filled in by applyCounterparties below, once
           for the whole file, because the account this statement is believed to
           belong to is not settled yet — see the note on that function. */
        /* matchRule, not autoCategorise, so the WINNING rule survives onto the
           item and not just the category it resolved to — autoCategorise
           (still used elsewhere: rule-cleanup.js, categories.js) throws that
           away. Without it there was no way to tell the reader WHICH rule
           categorised a row, so a wrong rule could only be found by opening
           Data/Categorisation Rules.csv, which the review screen never even
           names. See renderImportReview's category cell, which renders
           matchedPattern as a muted hint under the select. */
        const matched = matchRule(desc, rules);
        items.push({ date, desc, amount: parseFloat(amount.toFixed(2)), cat: matched ? matched.category : '',
          matchedPattern: matched ? matched.p : '',
          include: true, excluded: false, transferTo: '' });
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
    /* Moving your own money between your own accounts is not income and not
       spend, so a recognised counterparty arrives pre-excluded rather than
       counted. Pre-EXCLUDED, not pre-categorised: there is no transfer category
       in this app's vocabulary, and "vetoed from income and spend totals" is
       exactly what an excluded transaction means. A suggestion, never a
       decision — the review's exclude tick is live on this row like any other,
       and `transferTo` is carried only so the reader can see WHY it arrived
       ticked. renderImportReview runs this again whenever the account changes. */
    applyCounterparties(items, S.accounts, label0);
    /* Prove the sign convention against the statement's own balance column.
       This is what lets a bank nobody has tested import safely: if its single
       Amount column lists debits as positive, the balances say so and every
       amount is corrected here. Only a signed Amount column is ever flipped —
       a Debit/Credit pair is already normalised by name above, so a failure
       there means something else is off and is reported, not "fixed".
       A file that doesn't prove itself is imported UNCHANGED and flagged in the
       review; silent correction on a guess is the one outcome to avoid. */
    /* A credit card's balance column is the amount OWING and rises when you
       spend, so the relation the ledger has to satisfy is the opposite of an
       asset account's. The numbers reconcile either way — only the account can
       say which reading is right. An account the importer could not identify
       keeps the asset reading rather than guessing at a sign, which is the one
       thing this whole block exists to avoid. */
    const acct0 = label0 ? accountForLabel(label0) : null;
    /* ISSUE 53. The unflipped parsed amount, kept so the verdict can be
       RE-decided. Everything below reads `amount0` and writes `amount`, so
       applying the verdict twice, or after the reader corrects the account,
       lands on the same numbers rather than negating them again. */
    for (const it of items) it.amount0 = it.amount;
    const rec = signVerdict(items, ledger, iBalance, iAmount, acct0);
    /* The same verdict on a Debit/Credit PAIR, where it cannot be acted on.
       `verified && flip` means the file only reconciles with every amount
       negated — so the balance column has just proved that what the header calls
       "money out" is money in. Not auto-correcting that is deliberate (the sign
       came from a column NAME, so a disagreement means the mapping is wrong, not
       the arithmetic), but the verdict was then dropped on the floor: with
       `flipped` false and `verified` true the review fell through to "Amounts
       check out against this statement's own balance column" — the reassuring
       message, on the one file that had just failed. That is precisely the
       plausible-wrong-number outcome this whole reconciliation exists to
       prevent, arriving through the one branch that does not correct it. */
    const inverted = !!rec && rec.inverted;
    /* The file's own date span. The near-duplicate pass treats "this row is no
       longer in the statement" as evidence it settled and was rewritten, so it
       may only reason about vault rows the statement actually covers. */
    let range = null;
    for (const it of items) {
      if (!range) range = { min: it.date, max: it.date };
      else { if (it.date < range.min) range.min = it.date; if (it.date > range.max) range.max = it.date; }
    }
    S.pendingImport = { items, label: label0, index, range, skipped, filename: file.name,
      // What the FILE says it is, kept beside what the user picked — the two
      // are compared on every render and again at commit. See acctIdentity().
      acctNumber: statementAccountNumber(rows, map),
      reconcile: rec,
      // Kept so the verdict can be recomputed when the reader corrects the
      // account — see signVerdict() and the #impAccount handler.
      ledger, iBalance, iAmount,
      // Kept so "Columns wrong?" can reopen the mapper on the SAME file without
      // asking the user to find and drop it again.
      rows, map, file };
    $('#importMap').classList.add('hidden');
    importShown = IMPORT_PAGE;   // a fresh file starts at the first page
    renderImportReview();
    if (showBar) importProgress('done');
  }

  /* ------------------------- is this the right account? --------------------
     What the statement says about itself, against what the reader has picked.

     This exists because the failure it prevents is both easy and catastrophic:
     one wrong pick in the account dropdown wrote 933 rows of one account's
     history into another, with no warning, and it survived a year of daily use
     because the result LOOKS right — two accounts, both populated, both full of
     plausible transactions. Every total in the vault was double-counted, and it
     was found only by hashing the monthly files and noticing 25 byte-identical
     pairs across two folders.

     Three answers, and the middle one is the point:

       'mismatch' — both numbers known and different. The import is BLOCKED,
                    not warned about. This is the one case in the app where a
                    guess is not offered, because "the file disagrees with the
                    destination" has no reading under which importing is right.
       'adopt'    — the file names a number and the account has none. Offered
                    at commit, never written silently: it is the reader's own
                    frontmatter, and recording it is what makes every future
                    import checkable.
       'ok'       — they agree, or there is not enough to say. Silent. */
  function acctIdentity(p) {
    const acct = accountForLabel(p.label || '');
    if (!acct || !p.acctNumber) return { state: 'ok', acct };
    const same = sameAccountNumber(p.acctNumber, acct.account_number);
    if (same === false) return { state: 'mismatch', acct, theirs: acct.account_number, ours: p.acctNumber };
    if (same === null) return { state: 'adopt', acct, ours: p.acctNumber };
    return { state: 'ok', acct };
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
    { key: 'iFee', label: 'Fee', required: false, hint: 'A third amount column for bank charges (Capitec) — read when the other two are empty' },
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

  /* ISSUE 53. THE ONE PLACE the sign verdict is decided, and the reason it is a
     function rather than four lines inside runImport.

     `rec`, `flipped` and `inverted` used to be computed ONCE, from
     `accountForLabel(label0)` — the filename/preamble guess. renderImportReview
     re-runs applyCounterparties on every account change and never recomputed
     any of them. This file's own applyCounterparties header says the guess
     failing is "the ordinary case for any hand-saved or renamed export, not an
     edge one"; that reasoning reached transfers and not the sign.

     What it cost: a credit-card export whose account the importer could not
     identify keeps the ASSET reading (deliberately — guessing a sign is the one
     thing that block avoids). The reader then picks the card in the account
     select, and the verdict, the banner and every amount stay on the asset
     reading straight through commitImport. R1 894,75 of card spending imports
     as INCOME, under a green "Amounts check out against this statement's own
     balance column" — the reassuring sentence, on the file that had just been
     read backwards.

     IDEMPOTENT BY CONSTRUCTION. It reads `amount0` (the unflipped parsed value,
     stamped once at parse time) and writes `amount`, so calling it again — on
     every account switch, however many times — cannot double-negate. The old
     code negated `amount` in place, which is why recomputation was not simply a
     matter of calling it twice. */
  function signVerdict(items, ledger, iBalance, iAmount, account) {
    const rec = iBalance !== -1
      ? reconcileAmounts(ledger, { liability: isCreditCard(account) })
      : null;
    const flipped = !!rec && rec.verified && rec.flip && iAmount !== -1;
    /* `verified && flip` on a Debit/Credit PAIR, where it cannot be acted on:
       the balance column has proved that what the header calls "money out" is
       money in. Not auto-correcting is deliberate — the sign came from a column
       NAME, so a disagreement means the mapping is wrong, not the arithmetic —
       but the verdict must still reach the banner rather than falling through
       to "amounts check out". */
    const inverted = !!rec && rec.verified && rec.flip && iAmount === -1;
    for (const it of items) it.amount = flipped ? -it.amount0 : it.amount0;
    return rec ? { ...rec, flipped, inverted } : null;
  }

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
    /* The account is only settled HERE — by the user's pick, by an account made
       on the spot, or by the default above when detection came back empty. The
       self-transfer suggestion is a function of that account, so it is
       recomputed every render rather than left as parse-time guesswork; rows
       the reader has decided on carry manualExclude and are skipped. */
    applyCounterparties(p.items, S.accounts, p.label);

    /* ISSUE 53. The account is settled by the line above, so the sign verdict
       is re-decided here from the SAME account — not from the parse-time guess.
       Idempotent (see signVerdict), so re-rendering for "show more" or a
       category change costs nothing and changes nothing. */
    if (p.ledger) {
      p.reconcile = signVerdict(p.items, p.ledger, p.iBalance, p.iAmount,
        p.label ? accountForLabel(p.label) : null);
    }

    /* The statement is already parsed and on screen by the time anyone notices
       it belongs to an account this vault has never had — and on a fresh vault
       the select above is EMPTY, so "Import rows" could only ever answer "pick
       an account first". Make one from here and land the rows in it.

       Assigned rather than addEventListener'd, matching the select above: this
       function re-runs on every account switch and every "show more", and a
       listener added each time would open one dialog per render. */
    $('#impNewAccount').onclick = async () => {
      const acct = await ctx.addAccount({ type: 'checking' });
      if (!acct) return;                       // cancelled or rejected — leave the review alone
      // The folder transactions live under, which is what p.label means — not
      // the account's display name. Same resolution the select's options use.
      p.label = acct.tx_label || acct.name;
      renderImportReview();
    };

    // Canonicalise through txSegment — the same resolver commitImport writes
    // with, and the same string dedupIndex keyed by. Probing with the raw label
    // (or with a differently-sanitised one) would miss duplicates and re-import
    // rows that are already on disk.
    const lab = txSegment(p.label || '').trim().toLowerCase();
    /* Exact duplicates, then the charges the bank re-dated or re-worded between
       exports — see src/dedupe.js for both. Near-dups are unticked and labelled,
       never skipped: the user sees what each collided with and can override. */
    const { dupes, nears, pendings } = flagItems(p.items, p.index, lab, p.range);
    const newOnes = p.items.filter(i => !i.dup);
    const auto = newOnes.filter(i => i.cat).length;
    const cur = currentPeriod();
    const curRange = periodRange(cur);
    const inCurrent = it => it.date >= curRange.start && it.date <= curRange.end;
    const curCount = p.items.filter(inCurrent).length;
    $('#impStats').textContent =
      `${p.filename} — ${p.items.length} rows · ${newOnes.length} new · ${dupes} duplicates skipped` +
      (nears ? ` · ${nears} likely re-dated/re-worded (unticked)` : '') +
      (pendings ? ` · ${pendings} still pending (unticked)` : '') +
      ` · ${auto} auto-categorised` +
      (p.skipped ? ` · ${p.skipped} unparseable` : '') +
      /* An exact duplicate is the one decision on this screen the reader
         cannot override — it renders a "dup" badge instead of a checkbox,
         with no explanation. The dedupe itself is sound and this is
         deliberately not an offer to import them anyway (see flagItems in
         src/dedupe.js for what "exact" means here) — but a bare count with
         nothing said about WHY reads as "these rows vanished", which for a
         statement the reader chose on purpose looks like data loss rather
         than the plugin correctly recognising rows it already has. */
      (dupes ? ' · already in the vault — check the Transactions page if you expected to see them' : '');
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
    recEl.classList.toggle('imp-reconcile-warn', !!rec && (!rec.verified || rec.inverted));
    if (rec) recEl.textContent = rec.flipped
      ? 'This statement lists money out as positive. Checked against its balance column and corrected — money out shows as negative below.'
      : rec.inverted
        ? 'This statement’s balance column says the money-in and money-out columns are the wrong way round — every amount below has the opposite sign to what the balances imply. Nothing has been corrected, because the signs came from the column names: open “Columns wrong?” and swap them before importing.'
        : rec.verified
          ? 'Amounts check out against this statement’s own balance column.'
          : 'Could not check these amounts against the balance column — the balances don’t line up. Spot-check a few rows below before importing, especially the + and − signs.';

    /* Say where these rows are going to land BEFORE they land. An account
       flagged `budget: false` still imports and still shows in Transactions,
       but never reaches the Dashboard's income/spend — which looks like a
       broken import to anyone who doesn't know the flag is set. */
    const target = accountForLabel(p.label || '');
    /* ISSUE 30. The rows on this screen are about to land in `target`, whose
       currency was resolved right here and then ignored: the preview printed
       every amount with money(), the household's formatter, so a €900 row
       heading for a euro account previewed as "R -900.00". The Accounts page
       has done this correctly since it gained per-account symbols; the one
       screen where the reader decides whether the import is right was the one
       still showing the wrong unit. */
    const home = (S.settings || {}).currency;
    previewMoney = v => (isForeign(target, home) && typeof ctx.moneyIn === 'function'
      ? ctx.moneyIn(symbolOf(target, home), v)
      : money(v));
    const nbEl = $('#impNonBudget');
    const nonBudget = !!target && !target.in_budget;
    nbEl.classList.toggle('hidden', !nonBudget);
    if (nonBudget) nbEl.textContent =
      `${target.name} is excluded from the budget — these rows will import and show in Transactions, but won’t count toward income or spending totals.`;

    /* The account-identity verdict, said on the review screen and enforced
       again at commit. Both, deliberately: the banner is what lets the reader
       fix the pick before they press anything, and the block is what catches
       the case where they press it anyway. */
    const ident = acctIdentity(p);
    const idEl = $('#impAcctCheck');
    idEl.classList.toggle('hidden', ident.state !== 'mismatch');
    idEl.textContent = ident.state === 'mismatch'
      ? `This statement says it belongs to account ${ident.ours}, but ${ident.acct.name} is recorded as ${ident.theirs}. `
        + 'Nothing will import until they agree — pick the right account above, or correct the number on the account itself. '
        + 'A statement written into the wrong account looks entirely normal afterwards and is very hard to unpick.'
      : '';
    $('#impCommit').disabled = ident.state === 'mismatch';

    const t = $('#impTable'); t.empty();
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, el('span', { class: 'sr-only' }, 'Import')),
      el('th', { scope: 'col' }, 'Date'), el('th', { scope: 'col' }, 'Description'),
      el('th', { scope: 'col', class: 'num' }, 'Amount'), el('th', { scope: 'col' }, 'Category'), el('th', { scope: 'col' }, 'Excl.'))));
    const body = el('tbody', {});
    const visible = p.items.slice(0, importShown);
    for (const it of visible) {
      const cls = (it.dup ? 'imp-dup' : it.near || it.pending ? 'imp-near' : '') + (inCurrent(it) ? ' imp-current' : '');
      // Spelled out rather than left to the badge: the row is unticked, and the
      // user needs to know WHICH existing row it collided with to judge whether
      // this is the bank rewriting a pending charge or a real second purchase.
      const nearWhy = it.near
        ? `Looks like the already-imported "${it.near.desc}" on ${it.near.date} — the bank re-dates and re-words a charge when it settles. Tick to import anyway.`
        : '';
      /* Same shape as nearWhy, and said for the same reason: the row arrives
         unticked, so it has to say what made it so or the reader finds a
         missing purchase later with no trail back to this screen. */
      const pendingWhy = it.pending
        ? 'The bank still lists this as pending, so its date and amount can both change when it settles — '
          + 'and a settled row at a different amount would import as a second transaction. It will arrive on the next '
          + 'statement as a final figure. Tick to import it now anyway.'
        : '';
      body.append(el('tr', { class: cls.trim() },
        el('td', {}, it.dup ? el('span', { class: 'category-badge badge-dup' }, 'dup') :
          el('input', { type: 'checkbox', 'aria-label': `Import ${it.date} ${it.desc}, ${previewMoney(it.amount)}${it.near ? '. ' + nearWhy : it.pending ? '. ' + pendingWhy : ''}`,
            // nearAuto stays TRUE once we have auto-unticked: it records that the
            // untick already happened, so a re-render (account switch, "show
            // more") leaves the user's decision — either way — alone.
            ...(it.include ? { checked: '' } : {}), onchange: e => it.include = e.target.checked })),
        el('td', { class: 'text-muted', style: 'white-space:nowrap' }, it.date),
        el('td', {}, it.desc, ...(it.near ? [
          el('span', { class: 'category-badge badge-near', title: nearWhy }, 'likely dup'),
          el('div', { class: 'imp-near-why' }, nearWhy),
        ] : []), ...(it.pending && !it.near ? [
          el('span', { class: 'category-badge badge-near', title: pendingWhy }, 'pending'),
          el('div', { class: 'imp-near-why' }, pendingWhy),
        ] : []), ...(it.transferTo ? [
          // Named, not silent: a row that arrives excluded must say what made
          // it so, or the reader finds a missing figure later with no trail.
          el('span', { class: 'category-badge badge-transfer',
            title: `The description names your ${it.transferTo} account, so this looks like money moved between your own accounts rather than income or spend. Untick Exclude to count it.` },
          'transfer'),
        ] : [])),
        el('td', { class: `num${it.amount >= 0 ? ' text-success' : ''}`, style: 'white-space:nowrap;font-weight:600' }, previewMoney(it.amount)),
        el('td', {}, it.dup ? (it.cat || '') : deferredCatSelect(it.cat, v => { it.cat = v; it.manual = true; }, `Category for ${it.desc}`),
          // Named, not silent: a rule that fires wrong is only fixable if the
          // reader can tell WHICH rule fired — otherwise the only way to find
          // it is opening Data/Categorisation Rules.csv, which this screen
          // never mentions. Dropped once the reader has typed their own
          // category over it (it.manual): the hint would then describe a rule
          // that no longer explains what's in the cell.
          ...(it.matchedPattern && !it.manual ? [el('div', { class: 'text-muted', style: 'font-size:0.8em' },
            `matched "${it.matchedPattern}"`)] : [])),
        // `checked` reflects the model: after a partial-failure re-render the
        // ticks used to vanish while the rows stayed excluded.
        el('td', {}, it.dup ? '' : el('input', { type: 'checkbox', 'aria-label': `Exclude ${it.desc} from budget totals`,
          // manualExclude is the same sticky bit as nearAuto above: once the
          // reader has ticked either way, switching account must not silently
          // undo it on the next render.
          ...(it.excluded ? { checked: '' } : {}),
          onchange: e => { it.excluded = e.target.checked; it.manualExclude = true; } }))));
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

    /* The identity gate, re-asked here rather than trusted from the render:
       the account select is live, so the pick can change after the banner was
       drawn — and this is the last point at which anything can be stopped. */
    const ident = acctIdentity(p);
    if (ident.state === 'mismatch') {
      return toast(`That statement belongs to account ${ident.ours}, not ${ident.acct.name} (${ident.theirs}) — nothing was imported`, true);
    }
    if (ident.state === 'adopt') {
      /* Asked once, on the first import into an account that has no number.
         Declining is a real answer and is not asked again this session: the
         reader may be importing a hand-built CSV whose stray digits are not an
         account number at all, and nagging would train them to dismiss the one
         dialog that later blocks a genuine mis-import. */
      const go = await confirmModal(app, {
        title: 'Record this account number?',
        message: `${p.filename} says it belongs to account ${ident.ours}. Recording that on ${ident.acct.name} is what lets a future import stop `
          + 'itself before writing a statement into the wrong account — which is silent, and expensive to unpick afterwards.',
        confirmText: 'Record it',
        cancelText: 'Not now',
      });
      if (go) {
        ident.acct.account_number = ident.ours;
        // saveAccount no longer throws on a disk error — it toasts its own
        // failure and resolves false, so a try/catch here would never see
        // one. Check the return instead: not fatal to the import either way,
        // the rows are still going to the account the reader picked, but
        // account_number stays set in memory regardless of whether the write
        // landed, so a failed save is worth its own word on top of
        // saveAccount's toast rather than being silently swallowed.
        if (!(await ctx.saveAccount(ident.acct, ['account_number']))) {
          toast('Could not record the account number — importing anyway', true);
        }
      }
      // Either way, not again for this file.
      p.acctNumber = '';
    }

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
    /* The receipt the undo is built from, filled as each file lands rather than
       at the end — a run that stops half way through has still written rows,
       and those are exactly the ones somebody wants to take back. Holds the
       ROW OBJECTS that were pushed into S.txFiles, not copies of their values:
       undo then removes precisely what this import added, even where an
       identical line already existed in the same month. */
    const landed = [];
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
        landed.push({ key, month, rows });
        done += rows.length;
      }
    } catch (err) {
      // The rows that DID land are still undoable — the receipt is written on
      // this path too, or a partial import would be the one nobody can take
      // back. Left of the toast so it exists before the early return.
      if (landed.length) S.lastImport = receipt(p, label, landed, done);
      renderImportReview();   // reflect what already landed; the rest stays selectable
      return toast(`Import stopped after ${done} row${done === 1 ? '' : 's'} (${err.message || err}). Saved rows kept — click Import rows again to retry the rest, or Undo it on the Transactions page.`, true);
    }
    S.lastImport = receipt(p, label, landed, done);
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

  /* ------------------------- taking an import back -------------------------
     A statement dropped into the wrong account is the mistake this app makes
     easiest to make and, until now, hardest to fix: the rows land in files
     named after an account they have nothing to do with, they count toward
     every period total from the moment they land, and the only way back was to
     open each month file in Obsidian and delete the lines by hand.

     Undo is precise rather than clever. The receipt holds the ROW OBJECTS
     commitImport pushed into S.txFiles, so removing them takes back exactly
     what that import added and nothing that looks like it — which matters most
     in the case that motivates the feature, a statement imported twice into
     two different accounts, where every row has a twin.

     It lasts for the session and not beyond, and the banner says so. A vault
     re-read rebuilds every row object from the files, and the receipt's
     references then point at objects nothing holds — so rather than fall back
     to matching on date/description/amount, which would happily delete a
     genuine duplicate the reader had entered by hand, reloadFromDisk drops the
     receipt and the offer goes with it. After that the per-row delete on this
     page is the honest tool.

     `at` is a display string only. Stamped here rather than derived later so
     the banner can say WHICH import it is offering to take back — with two
     statements imported in a row, "the last one" is not enough to act on. */
  function receipt(p, label, landed, count) {
    return {
      label,
      filename: (p && p.filename) || '',
      at: new Date().toISOString().slice(11, 16),
      count,
      files: landed,
    };
  }

  async function undoImport() {
    const r = S.lastImport;
    if (!r || !r.files.length) return;

    /* Resolved against the CURRENT model, not the receipt's own count: a row
       may already have been deleted by hand from the Transactions table since
       the import, and offering to remove 42 rows while removing 41 is the kind
       of small lie that costs the reader's trust in every other figure here. */
    const targets = [];
    for (const f of r.files) {
      const file = S.txFiles[f.key];
      if (!file) continue;
      const live = new Set(file.rows);
      const doomed = new Set(f.rows.filter(row => live.has(row)));
      if (doomed.size) targets.push({ file, doomed, dirty: file.dirty });
    }
    const total = targets.reduce((n, t) => n + t.doomed.size, 0);
    if (!total) {
      S.lastImport = null;
      ctx.renderTransactions();
      return toast('Those rows are no longer in the app — nothing to undo', true);
    }
    /* Unsaved edits in the same months go to disk with the undo, because the
       write below serialises the whole file from memory. Said out loud rather
       than discovered afterwards: it is a save the reader did not press Save
       for, and on this page there is always the possibility of one. */
    const alsoSaves = targets.some(t => t.dirty);
    const go = await confirmModal(app, {
      title: 'Undo this import',
      message: `Remove the ${total} row${total === 1 ? '' : 's'} imported into ${r.label}`
        + (r.filename ? ` from ${r.filename}` : '') + ', and rewrite '
        + `${targets.length} monthly file${targets.length === 1 ? '' : 's'}? `
        + 'Categorisation rules learned during the import are kept — they cost nothing and '
        + 'are useful whichever account the statement really belongs to.'
        + (alsoSaves ? ' Unsaved edits you have made in those same months will be written out too.' : ''),
      confirmText: `Remove ${total} row${total === 1 ? '' : 's'}`,
    });
    if (!go) return;

    let undone = 0, files = 0;
    try {
      for (const t of targets) {
        const keep = t.file.rows.filter(row => !t.doomed.has(row));
        /* Written from a MODEL rather than by mutating first: a write that
           fails must leave the row in memory as well as on disk, or the app
           starts reporting a total the file does not hold. Same lockstep rule
           commitImport follows in the other direction. */
        await writeFile(`Transactions/${t.file.label}/${t.file.month}.md`,
          serializeTxFile({ ...t.file, rows: keep }));
        t.file.rows = keep;
        // Disk now matches memory for this file, including whatever unsaved
        // edits it carried — so it is genuinely clean, not merely written.
        t.file.dirty = false;
        undone += t.doomed.size;
        files++;
      }
    } catch (err) {
      S.lastImport = null;
      ctx.renderTransactions();
      return toast(`Undo stopped after ${files} file${files === 1 ? '' : 's'} (${err.message || err}) — the rest are unchanged`, true);
    }
    S.lastImport = null;
    /* The Save button may have been lit by edits that have just been written
       out above. Asking the page to recompute is not possible from here — the
       predicate lives in controller.js — so re-render and let it settle: any
       file still dirty re-lights it on its own next edit. */
    if (!Object.values(S.txFiles).some(f => f.dirty)) $('#txSave').disabled = true;
    ctx.render();
    toast(`Undone — ${undone} row${undone === 1 ? '' : 's'} removed from ${files} file${files === 1 ? '' : 's'}`);
  }

  /* "Columns wrong?" on the review screen — reopen the mapper against the file
     already in hand, prefilled with the mapping that produced what's on screen.
     Nothing is committed yet at this point, so re-reading is free. */
  function remapImport() {
    const p = S.pendingImport;
    if (!p || !p.rows) return toast('Drop a statement first', true);
    showColumnMapper(p.rows, p.file, p.map);
  }

  /* Drop a parsed-but-uncommitted statement. The review screen had no exit: a
     file opened by mistake stayed on screen until a DIFFERENT file replaced it
     or the vault was reloaded from the menu — so the only way out of an import
     was through it. Nothing has been written to disk at this point, so this
     costs only the parse. */
  async function cancelImport() {
    const p = S.pendingImport;
    if (!p) return;
    // Only ask when there is hand work to lose. A file dropped by mistake must
    // close in one tap; a review someone has spent ten minutes categorising
    // must not vanish on a mis-tap.
    if (p.items.some(it => it.manual)) {
      const go = await confirmModal(app, {
        title: 'Discard this import?',
        message: `${p.filename} hasn't been imported yet. The categories you picked on this screen will be lost.`,
        confirmText: 'Discard import',
      });
      if (!go) return;
    }
    S.pendingImport = null;
    importShown = IMPORT_PAGE;     // the next file starts at the first page
    $('#importReview').classList.add('hidden');
    $('#importMap').classList.add('hidden');
    toast('Import cancelled — nothing was saved');
  }

  // renderImportReview, published for the same reason filteredRows is on
  // transactions.js's ctx: so a test can re-render the REAL review screen
  // (e.g. after the reader edits a category) instead of asserting only on
  // the state runImport's own first call already produced.
  ctx.provide({ handleStatementFile, commitImport, renderImport, renderImportReview, remapImport, cancelImport, undoImport });
};
