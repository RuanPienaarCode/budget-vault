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

/* ISSUE 62. The one translated string this otherwise English-only view
   prints — the date-reading banner — reached through the namespace import
   because `t` is already a local in several files. */
const { opWriterOf } = require('../io');
const i18n = require('../i18n');
const { el, tableCells, refocus, caveatChip } = require('../dom');
const { normalizeAmount, inferGrouping, readAmountColumn } = require('../amount');
const { parseStatement, decodeStatement, parseStatementDate, detectStatementColumns, reconcileAmounts, reconcileFeesBesideAmount, applyCounterparties,
  transferLegStanding, statementAccountNumber, sameAccountNumber, TRANSFER_LEG_DAYS, balanceStepVerdicts, isBalanceCarry, drCrOf } = require('../statement');
const { prepareRules, autoCategorise, matchRule } = require('../rules');
const { setRowCategory, subcategoryOf } = require('../subcategories');
const { buildIndex, addToIndex, flagItems } = require('../dedupe');
const { confirmModal } = require('../modal');
const { splitRole, SPLIT_PARENT, splitPartsOf, splitParentsSharingKey } = require('../tx-role');
const { isCreditCard } = require('../committed');
const { symbolOf, isForeign, formatSigned } = require('../currency');
const { todayIso, isoDayNumber, nowLocalMinute } = require('../dates');
const { decimalText } = require('../locale');
const { detectMilesExport, milesRows, milesRate, milesFilenameNumber } = require('../miles');

/* ISSUE 62 — see the call site. Decides which way round the day and month go
   in a file's dates and returns { dayFirst, assumed }.

   The household profile is only the tie-breaker: a statement is written in
   date order and covers a stretch of weeks, and today is a limit on it, so the
   file's own evidence is read first, in this order -
     1. a reading that fails to read dates the other one reads is wrong;
     2. a reading that puts any row after TODAY is wrong - a statement cannot
        hold a transaction that has not happened;
     3. of what is left, the reading that keeps the rows in date order wins;
     4. of what is left, the reading with the SHORTER SPAN wins.
   Steps 2 and 4 are new (2026-10-14 audit, L2b-05). The old rule stopped at 3,
   so a month-first export whose days were all 12 or less - in order under both
   readings - went to the household default without a word and was dated months
   apart, with rows after today.

   `assumed` is true only when all four steps tie and the household default had
   to decide. The review then says which convention it assumed instead of
   showing parsed ISO dates that hide the guess. Only rows that read differently
   under the two readings matter; a file with none (ISO dates, or every day
   above 12) returns the household reading with nothing assumed. `today` is
   injected, as everywhere in the pure code. */
function decideDayFirst(rawDates, householdDayFirst, today) {
  const under = df => rawDates.map(d => parseStatementDate(d, df)).filter(Boolean);
  const monotonic = ds => {
    let asc = true, desc = true;
    for (let i = 1; i < ds.length; i++) { if (ds[i] < ds[i - 1]) asc = false; if (ds[i] > ds[i - 1]) desc = false; }
    return asc || desc;
  };
  const span = ds => {
    // A loop, not Math.max(...): a statement can run to tens of thousands of rows.
    let lo = Infinity, hi = -Infinity;
    for (const d of ds) { const n = isoDayNumber(d); if (n < lo) lo = n; if (n > hi) hi = n; }
    return ds.length ? hi - lo : 0;
  };
  const hh = under(householdDayFirst), ot = under(!householdDayFirst);
  const keep = { dayFirst: householdDayFirst, assumed: false };
  if (!hh.length || hh.join() === ot.join()) return keep;
  const swap = { dayFirst: !householdDayFirst, assumed: false };
  // A step decides only when exactly one reading passes it.
  const pick = (householdPasses, otherPasses) => (householdPasses === otherPasses ? null : householdPasses ? keep : swap);
  const late = ds => !!today && ds.some(d => d > today);
  const spanH = span(hh), spanO = span(ot);
  const verdict =
    pick(hh.length >= ot.length, ot.length >= hh.length) ||
    pick(!late(hh), !late(ot)) ||
    pick(monotonic(hh), monotonic(ot)) ||
    pick(spanH <= spanO, spanO <= spanH);
  if (verdict) return verdict;
  return { dayFirst: householdDayFirst, assumed: true };
}

/* The subcategory a matched rule sets with its category (ADR-0010 section 5),
   as the field a row carries it in — and no field at all when the rule has
   none, which is what a row loaded from a file with no Subcategory column
   looks like. Spread into the review item beside `cat`. */
function ruleLabel(matched) {
  return matched && matched.subcategory ? { subcategory: matched.subcategory } : {};
}

module.exports = function registerImport(ctx) {
  const { S, $, app, money, toast, writeFile, currentPeriod, periodRange, periodTitle, deferredCatSelect, serializeTxFile, locale, learnRules, txSegment, accountForLabel, txFileRel,
    pathTaken, fileAt, trashFile } = ctx;

  /* The formatter for a previewed row, rebound whenever the destination
     account changes (see renderPreview). Defaults to money() so any path that
     renders before an account is chosen still prints something sane, and so a
     single-currency vault — nearly all of them — is on the same formatter as
     the rest of the app. */
  let previewMoney = v => money(v);
  /* The same row's amount as a FLOW (2026-11-25 audit, VIS-5): "−R 812.40" and
     "+R 410.00", the form Transactions prints these very lines in a tap later
     (transactions.js rowFlow), rather than the balance form "R -812.40".
     rowFlow is private to that view, so the rule is rebuilt here from the same
     two public pieces it is made of — currency.js formatSigned, and a plus
     exactly where formatSigned would have put a minus on the negation, so a
     figure that rounds to nothing carries neither. Rebound with previewMoney,
     for the same reason: the symbol is the destination account's. */
  let previewFlow = v => flowIn((S.settings || {}).currency, v);
  function flowIn(sym, v) {
    const n = Number.isFinite(Number(v)) ? Number(v) : 0;
    const loc = locale();
    const text = formatSigned(sym, n, 2, loc);
    return n > 0 && formatSigned(sym, -n, 2, loc) !== text ? `+${text}` : text;
  }
  /* A counter, not the object: each statement put on the review gets the next
     number, and a receipt remembers the number of the import it was written
     for — so a retry after a stopped import can add to its OWN receipt and
     never to another file's (commitImport). */
  let importSeq = 0;
  /* What is writing right now: 'commit', 'undo' or null (2026-11-25 audit,
     IMP-2). See runExclusive. */
  let inFlight = null;

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
  /* The rows already in the vault for an account — what applyCounterparties
     looks in for the OTHER leg of a transfer before it pre-excludes a row
     (statement.js; 2026-10-07 audit, L4B-TXT-COUNTERPARTY). period.js's
     accountIndex, the one account → rows join, built once per call and late
     bound because period.js registers on its own. Without it there is no
     evidence, and the safe answer is that nothing is pre-excluded. */
  function legsOfAccounts() {
    const idx = typeof ctx.accountIndex === 'function' ? ctx.accountIndex() : new Map();
    return acct => (idx.get(acct) || {}).rows || [];
  }

  /* THE OTHER HALF, STILL COUNTED (2026-11-25 audit, IMP-5). applyCounterparties
     excludes the row coming in when the vault holds its other leg; that vault
     leg went in counted, when its partner did not exist yet, and nothing came
     back for it. So after every counterparty pass each row that found a leg
     asks where that leg stands (statement.js transferLegStanding) and keeps
     the answer for the review and the commit:

       it.legState   'counted' | 'split' | null (nothing to say)
       it.legKey     the S.txFiles key of the leg's month file
       it.legAcct    the leg's account, as the reader knows it

     Only a row that will be written can speak for a leg: a duplicate is
     already in the vault and writes nothing. A leg in a non-budget account is
     outside every budget total whatever its tick says, so there is nothing
     still counted to name. A leg that is no longer in any month file of this
     load (deleted since the pass) is not named either.

     Asked again at commit, so the vault the leg is judged against is the one
     about to be written — a leg the reader excluded on the Transactions page
     meanwhile is not offered twice. One row → file map per call, built only
     when some row found a leg. */
  function judgeLegs(p) {
    let fileOf = null;
    for (const it of p.items) {
      it.legState = null; it.legKey = ''; it.legAcct = '';
      const leg = it.transferLegRow;
      /* A row an earlier, stopped attempt already wrote is a duplicate of
         itself by now, and still owes its leg the mark (`legOwed`). */
      if (!leg || (it.dup && !it.legOwed)) continue;
      if (!fileOf) {
        fileOf = new Map();
        for (const [key, f] of Object.entries(S.txFiles)) for (const r of f.rows) fileOf.set(r, key);
      }
      const key = fileOf.get(leg);
      const file = key ? S.txFiles[key] : null;
      if (!file) continue;
      const acct = accountForLabel(file.label);
      if (acct && !acct.in_budget) continue;
      const standing = transferLegStanding(leg, file.rows);
      if (standing === 'excluded') continue;
      it.legState = standing; it.legKey = key; it.legAcct = acct ? acct.name : file.label;
    }
  }
  /* A row the import will write EXCLUDED, as a transfer, whose leg is still
     counted: the rows the review speaks about. A row the reader unticked, or
     counts after all (Exclude off), has made no claim that it is a transfer,
     so it makes no claim on its other half either. */
  const speaksForLeg = it => !!it.legState && it.include && !it.dup && !!it.excluded;
  /* ...and of those, the legs the commit will mark: an ordinary row, with the
     choice left ticked (`keepLegCounted` is the reader's untick). */
  const legToExclude = it => speaksForLeg(it) && it.legState === 'counted' && !it.keepLegCounted;
  /* A row this import has already written whose leg is still to be marked —
     the retry's share of the work (commitImport). */
  const legOwedNow = it => !!it.legOwed && !it.legDone && it.legState === 'counted' && !!it.excluded && !it.keepLegCounted;
  /* The leg row's own amount in its own account's currency, flow form. */
  const legFlow = it => {
    const acct = accountForLabel((S.txFiles[it.legKey] || {}).label || '');
    const home = (S.settings || {}).currency;
    return flowIn(isForeign(acct, home) ? symbolOf(acct, home) : home, it.transferLegRow.amount);
  };
  /* `nonBudgetOnly` is for a Discovery Miles file and nothing else. Its filename
     (`DiscoveryBankMiles_<n>_…`) matches the very pattern the other Discovery
     exports route by, and nothing says <n> differs from the cheque account's
     number — if it is the same, routing by number alone would send a rewards
     balance into the account the budget counts, and every Mile would arrive as
     income. So a Miles file is only ever auto-routed to an account that has
     opted out of the budget (ADR-0007); otherwise it is left unrouted and the
     review asks, exactly as it does for any file it cannot place.

     The converse holds too, and is why `find` became a preference: once a Miles
     account carries that same number, an ordinary Discovery bank statement
     matches TWO accounts, and the old first-match-wins answer depended on which
     sorted first. A bank statement now prefers the account that counts toward
     the budget; it falls back to whichever matches only when none does, so a
     household whose one account with that number is a deliberate non-budget one
     still routes to it. */
  function detectAccountLabel(filename, rows, { nonBudgetOnly = false } = {}) {
    // Discovery-style "Label_12345_..." or a bare account number ("12345678901.csv",
    // "12345678901 (3).csv" — FNB names exports after the account alone). The bare
    // form needs 6+ digits so a leading year ("2026-07 export.csv") never matches.
    const m = filename.match(/^[A-Za-z][A-Za-z0-9]*_(\d{4,})(?:_|\.)/) ||
              filename.match(/^(\d{6,})\D/);
    const byNumber = n => {
      const hits = S.accounts.filter(a => a.account_number === n);
      const acc = nonBudgetOnly ? hits.find(a => !a.in_budget) : (hits.find(a => a.in_budget) || hits[0]);
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
    /* A Discovery Miles export is asked about FIRST. It has no amount column, so
       its header is not read as a statement header — and the headerless SHAPE
       detector then takes the Miles column as the Amount and "Additional
       information" as the description, without opening the mapper: one rand a
       Mile, under a review screen that looks routine (measured on the real file:
       R667,502 of earned "income"). See src/miles.js. */
    const milesMap = detectMilesExport(rows, file.name);
    if (milesMap) {
      try { await runMilesImport(rows, milesMap, file); } finally { importProgress('done'); }
      return;
    }
    const map = detectStatementColumns(rows, loc.dayFirst);
    // Nothing resolved — but the file is readable, so ask instead of refusing.
    // This is what makes a bank nobody has tested importable at all.
    if (!map) return showColumnMapper(rows, file, null);
    /* `finally`, not a bare await. importProgress('done') is the LAST line of
       runImport, so a throw anywhere after the bar went up left it on screen
       forever. Reproduced on a 1600-row CSV whose review render threw: the bar
       stopped at "Preparing review… 95%" and stayed there — the screen still
       claiming to be working on an import that had already given up, which is
       what made a failed drop read as a hung one. Hiding a bar that was never
       shown is a no-op (importProgress('done') only adds a class), so the
       small-file path that never starts one is unaffected.

       The throw itself still propagates: src/controller.js's wireDropZone is
       the seam that reports it, and swallowing it here would trade a frozen
       bar for a silent one. */
    try { await runImport(rows, map, file); } finally { importProgress('done'); }
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
    let skipped = 0, noted = 0;
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
    /* The rows that print a fee BESIDE an amount (the third column is otherwise
       read only when the amount is missing, below). Kept with enough to decide
       afterwards, from the balance column, whether the fee is a charge of its
       own — see reconcileFeesBesideAmount. `at` is where the row's item sits (or
       would sit) in `items`, so a fee row can be inserted right after it. */
    const feeCarriers = [];
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
    /* ISSUE 70. When the file offers no evidence — every amount a bare
       "250.000", nothing with two groups — inferGrouping returns null and
       every cell parses as it did before grouping detection existed, which on
       an EU or Indonesian export reads 250.000 as two hundred and fifty. With
       no balance column there is no reconcile banner either, so the review
       showed an internally consistent set of numbers all off by a thousand.
       Worse, the same account flipped scale the month one 1.500.000 row
       appeared. The household's own profile already says which separator it
       groups with (`loc.thousands`), and this file already reaches for
       loc.dayFirst from the same object; it is the tie-breaker the file could
       not provide. A space groups unambiguously and needs no verdict. */
    const localeGrouping = loc.thousands === '.' ? 'dot' : loc.thousands === ',' ? 'comma' : null;
    const numOpts = { grouping: inferGrouping(amountCells) ?? localeGrouping };
    const num = v => normalizeAmount(v, numOpts);
    /* The Amount column, read as a COLUMN (amount.js readAmountColumn): one that
       marks money in with "Cr" and leaves money out bare has its bare values
       read as money out. Whether to KEEP that reading is decided below, once
       the rows are in, because with a balance column the balances have the
       last word. For every other column `values` is exactly num() per cell. */
    const amountCol = iAmount !== -1 ? readAmountColumn(dataRows.map(r => r[iAmount]), numOpts) : null;
    /* The rows whose amount the rule negated, with what they read as before. */
    const creditRule = [];
    /* A Dr/Cr marker column beside the Amount (statement.js DRCR_COLS; 2026-11-25
       audit, IMP-1). Where one is mapped, EACH ROW's marker says which way its
       amount went, by the importer's own pair rule: a debit is money out
       whatever sign the cell carries, a credit is read as written — so a
       "-30.00 Cr" reversal stays money out, as it does in a Credit column.
       It replaces the credit-marked column rule (amount.js) for this file: the
       marker is the explicit statement that rule could only infer. A row with
       no marker is read as written. The balance column still judges the result
       (signVerdict): the marker is the file's claim, the balances its proof.
       `map.iDrCr` is absent on a map made before the field existed. */
    const iDrCr = map.iDrCr == null || iAmount === -1 || !amountCol ? -1 : map.iDrCr;
    let drCrMarked = 0;
    /* ISSUE 62. Which way round the day and month are is a property of the
       FILE, and the file says so: a statement is written in date order, so the
       reading under which its dates go backwards is the wrong reading. The
       household profile decides only when the file cannot. A US export on a
       South African household used to read 01/03 as the 1st of March, scatter
       a three-month statement across five month files, and say nothing.
       Ambiguous rows (both parts <= 12) are where the two readings differ; if
       one ordering is monotonic and the other is not, the monotonic one wins
       and the review says which was used. */
    const reading = decideDayFirst(dataRows.map(r => (iDate !== -1 ? r[iDate] : '')), loc.dayFirst, todayIso());
    const dayFirst = reading.dayFirst;
    /* Three states for the banner: the file overruled the household
       ('day-first' / 'month-first'), the file could not decide so the
       household's convention was ASSUMED ('assumed-…'), or nothing was in
       question (null). */
    const dateReading = reading.assumed ? (dayFirst ? 'assumed-day-first' : 'assumed-month-first')
      : dayFirst === loc.dayFirst ? null : (dayFirst ? 'day-first' : 'month-first');
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
      let amount = amountCol ? amountCol.values[i] : null;
      let wasAmount = amountCol && amountCol.applied && amount !== amountCol.plain[i] ? amountCol.plain[i] : null;
      if (iDrCr !== -1) {
        const plain = amountCol.plain[i];
        const mark = drCrOf(r[iDrCr]);
        amount = plain == null ? null : mark === 'debit' ? -Math.abs(plain) : plain;
        if (mark && plain != null) drCrMarked++;
        wasAmount = null;
      }
      // A non-blank amount cell that normalizeAmount refused: the only thing a
      // row is "unparseable" FOR, as far as the money goes (see below).
      const unreadable = [iAmount, iDebit, iCredit, iFee].some(i => i !== -1 && (r[i] || '').trim() !== '' && num(r[i]) == null);
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
      /* A fee on a row that ALSO has an amount is not read by the fallback below
         (that is the pair-the-header-named rule above, deliberately), and was
         dropped without a trace: -200.00 and a 5.00 fee imported as -200.00,
         and the 80% slack in reconcileAmounts let the one row the balance
         disagreed on through under a green banner. Noticed here, decided once
         the whole column is in (reconcileFeesBesideAmount): the balance either
         shows the fee was already inside the amount, or that it was charged on
         top, or it cannot say — and each of the three is spoken, never silent. */
      let feeBeside = 0;
      if (amount != null && iFee !== -1) {
        const fb = num(r[iFee]);
        if (fb != null && fb !== 0) feeBeside = fb;
      }
      if (amount == null && iFee !== -1) {
        const f = num(r[iFee]);
        if (f != null && f !== 0) amount = f;
      }
      const ledgerEntry = iBalance !== -1 && amount != null ? { amount, balance: num(r[iBalance]), fee: feeBeside } : null;
      if (ledgerEntry) ledger.push(ledgerEntry);
      /* A balance carried in or out (statement.js isBalanceCarry; 2026-11-25
         audit, IMP-4): its balance is the point the next row is measured from
         and its own movement is NOTHING, so the ledger carries it as 0. Read at
         face value it was the one row nothing tested at the top of a statement
         (R5 000 of "income" under the green banner), and a pair the file lost
         at the bottom. The row itself is kept and unticked below, not dropped:
         the reader may know it was a real first deposit. */
      const carry = !!ledgerEntry && isBalanceCarry(desc, amount, ledgerEntry.balance);
      if (carry) { ledgerEntry.amount = 0; ledgerEntry.carry = true; }
      const rule = wasAmount != null ? { was: wasAmount, entry: ledgerEntry, item: null } : null;
      if (rule) creditRule.push(rule);
      const carrier = feeBeside ? { fee: feeBeside, date: null, desc, entry: ledgerEntry, at: -1, noted: false } : null;
      if (carrier) feeCarriers.push(carrier);
      const date = rawDate ? parseStatementDate(rawDate, dayFirst) : null;
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
        /* `ledgerAt` ties the item to its balance step, so signVerdict can ask
           whether THIS row's step agrees with the sign it is given; -1 when the
           row has no step (no balance column, or no balance on the row). */
        items.push({ date, desc, amount: parseFloat(amount.toFixed(2)), cat: matched ? matched.category : '',
          ...ruleLabel(matched),
          matchedPattern: matched ? matched.p : '',
          include: true, excluded: false, transferTo: '',
          ledgerAt: ledgerEntry ? ledger.length - 1 : -1, carry });
        if (rule) rule.item = items[items.length - 1];
      } else if (date && desc && (amount === 0 || (amount == null && !unreadable))) {
        /* A dated, described line with NO MONEY on it: the 0.00 an FNB
           statement prints for a waived fee, the notice Capitec prints for a
           declined withdrawal. Nothing was misread - there is simply no amount
           to import - so it is counted apart rather than as "unparseable",
           which told the reader the importer had failed on rows it had read
           perfectly well (2026-10-14 audit, L2b-06). */
        noted++;
        if (carrier) carrier.noted = true;
      } else if (date || amount != null) {
        // Looked like a transaction and wasn't usable — worth reporting.
        skipped++;
      }
      if (carrier) { carrier.date = date; carrier.at = items.length; }
      // Anything else (a preamble line, a blank, a trailing disclaimer) carries
      // neither a date nor an amount and is ignored silently. Counting those as
      // "unparseable" made a hand-mapped statement look broken when it wasn't.
      if (showBar && (i % CHUNK === CHUNK - 1)) {
        importProgress('set', null, (i + 1) / dataRows.length * 0.9);
        await new Promise(res => setTimeout(res, 0));
      }
    }
    /* The credit-marked column rule (amount.js creditMarkedColumn), kept or
       dropped. Decided BEFORE the fee pass and the sign verdict below, which both
       read the amounts as they stand here.

       With a balance column the file has to prove it: the rule stands only when
       the balances reconcile under it and do NOT already reconcile under the
       per-cell reading. Anything else - the balances prove the old reading, or
       prove neither - puts every negated row back, and the review then says
       what it always said for that file. Reconciliation does not depend on the
       account (reconcileAmounts tries both signs, and only which one wins
       follows the liability flag), so the account that is not settled yet does
       not matter here. Without a balance column there is nothing to prove it
       against and the column's own explicit markers decide; the review says so
       either way (`creditMarked`). A fee beside the amount is the one case left
       to the fee pass after this, untouched. */
    let creditMarked = false;
    if (creditRule.length) {
      if (iBalance === -1) creditMarked = true;
      else {
        const asRead = ledger.map(e => ({ amount: e.amount, balance: e.balance }));
        const before = ledger.map(e => ({ amount: e.amount, balance: e.balance }));
        // A carried balance moves nothing under either reading (see `carry`).
        for (const k of creditRule) if (k.entry && !k.entry.carry) before[ledger.indexOf(k.entry)].amount = k.was;
        creditMarked = reconcileAmounts(asRead).verified && !reconcileAmounts(before).verified;
      }
      if (!creditMarked) {
        for (const k of creditRule) {
          if (k.entry && !k.entry.carry) k.entry.amount = k.was;
          if (k.item) k.item.amount = parseFloat(k.was.toFixed(2));
        }
      }
    }
    /* The fees printed beside amounts, decided from the balance column (see the
       note where they are noticed). Only a carrier that is a real, importable
       row is counted or inserted; every carrier's fee still goes into the
       ledger when it is added, because the balance stepped over it either way. */
    let feeNote = null;
    if (feeCarriers.length) {
      const importable = feeCarriers.filter(k => k.date && k.desc);
      const verdict = iBalance !== -1 ? reconcileFeesBesideAmount(ledger) : { reading: 'unproven' };
      if (verdict.reading === 'extra') {
        // Back to front, so earlier insertion points stay valid.
        for (let n = feeCarriers.length - 1; n >= 0; n--) {
          const k = feeCarriers[n];
          const idx = ledger.indexOf(k.entry);
          const fee = idx === -1 ? null : verdict.items[idx];
          if (fee == null) continue;
          k.entry.amount = parseFloat((k.entry.amount + fee).toFixed(2));
          if (!(k.date && k.desc)) continue;
          const feeDesc = `${k.desc} (fee)`;
          /* Only a rule that answers for the FEE (2026-11-25 audit, RUL-6). The
             merchant's name is a substring of "<merchant> (fee)", so matching
             the fee row against every rule handed it the merchant's category —
             a R5 ATM fee filed as "Cash withdrawal". A rule that also matches
             the merchant row on its own is the merchant's, and is set aside;
             what is left can only have matched the fee wording (a rule on
             "(fee)", or one written for this exact fee row). Nothing left:
             uncategorised, for the reader to pick on the review. */
          const feeRules = rules.filter(rule => !matchRule(k.desc, [rule]));
          const matched = matchRule(feeDesc, feeRules);
          items.splice(k.at, 0, { date: k.date, desc: feeDesc, amount: parseFloat(fee.toFixed(2)),
            cat: matched ? matched.category : '', ...ruleLabel(matched), matchedPattern: matched ? matched.p : '',
            include: true, excluded: false, transferTo: '', feeOf: k.desc, ledgerAt: -1, carry: false });
          // A row with an amount of 0 was counted as "no amount" above; it has
          // a fee row now, so it is not that any more.
          if (k.noted) noted--;
        }
        feeNote = importable.length ? { added: true, count: importable.length,
          total: parseFloat(importable.reduce((n, k) => n + Math.abs(k.fee), 0).toFixed(2)) } : null;
      } else if (verdict.reading !== 'inside' && importable.length) {
        // Not provable, or no balance to prove it with: amounts stay exactly as
        // read and the review says what was left out.
        feeNote = { added: false, count: importable.length,
          total: parseFloat(importable.reduce((n, k) => n + Math.abs(k.fee), 0).toFixed(2)) };
      }
    }
    if (showBar) { importProgress('set', 'Preparing review…', 0.95); await new Promise(res => setTimeout(res, 0)); }
    /* Moving your own money between your own accounts is not income and not
       spend, so a recognised counterparty arrives pre-excluded rather than
       counted — when the other account holds the other leg of it. A number in
       the description alone only SUGGESTS: whoever typed the reference wrote
       it, and an account number is what a household gives out to be paid
       (statement.js applyCounterparties). Pre-EXCLUDED, not pre-categorised:
       there is no transfer category in this app's vocabulary, and "vetoed from
       income and spend totals" is exactly what an excluded transaction means.
       Never a decision — the review's exclude tick is live on this row like
       any other, and `transferTo` is carried so the reader can see WHY it is
       badged. renderImportReview runs this again whenever the account changes —
       and, like this, only AFTER the signs are decided (see the note there):
       the first call below is that same pass, put after the verdict so the
       provisional state on the pending import is never one the review would
       contradict. */
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
    /* Which column the signs came from, by the name the file gives it, for the
       review to say so — or null when no row carried a marker it could read. */
    const drCrName = iDrCr !== -1 && map.headerIdx >= 0 ? String((rows[map.headerIdx] || [])[iDrCr] || '').trim() : '';
    const drCr = drCrMarked ? { name: drCrName || 'Dr/Cr', marked: drCrMarked } : null;
    const rec = signVerdict(items, ledger, iBalance, iAmount, acct0, drCr);
    applyCounterparties(items, S.accounts, label0, legsOfAccounts());
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
    S.pendingImport = { items, label: label0, index, range, skipped, noted, filename: file.name, feeNote,
      // Which pending import a receipt belongs to (see commitImport).
      importId: ++importSeq,
      // The Dr/Cr marker column the signs were read from, or null.
      drCr,
      // What the FILE says it is, kept beside what the user picked — the two
      // are compared on every render and again at commit. See acctIdentity().
      acctNumber: statementAccountNumber(rows, map),
      reconcile: rec,
      // True only when the credit-marked column rule was applied and kept.
      creditMarked,
      /* ISSUE 62. Non-null only when the file overruled the household's date
         convention, so the review can say so. */
      dateReading,
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

  /* A Discovery Miles export, put on the same review screen as any statement.

     Everything that makes it different is decided in src/miles.js (what a row is
     worth, what goes in the Note, which rows are skipped); this only supplies
     the household's rate and the vault's state, and builds the one object the
     review, the commit and the undo already understand. Deliberately NOT a
     parallel path: dedupe, the account select, the identity gate, the commit
     and Undo are all the ordinary ones, and a Miles row is an ordinary item
     that happens to carry a `note`.

     Left out on purpose, each for the reason the ordinary path has it:
       - no sign verdict / reconcile banner: there is no balance column to prove
         anything against, and the sign is not a convention here — the file says
         earned or redeemed in the Miles figure itself;
       - no date-reading verdict: the export is ISO dates, so nothing is ambiguous;
       - no `acctNumber`: the number in the FILENAME is a routing hint, not the
         file's own claim about itself, and acctIdentity must not BLOCK an import
         on a guess read off a name the reader may have changed.

     `miles` on the pending import is what marks it as one, and what the review
     reads to say so. */
  async function runMilesImport(rows, map, file) {
    const rate = milesRate((S.settings || {}).miles_rate);
    const { items, skipped, zero, tooSmall, miles } = milesRows(rows, map, { rate });
    let range = null;
    for (const it of items) {
      if (!range) range = { min: it.date, max: it.date };
      else { if (it.date < range.min) range.min = it.date; if (it.date > range.max) range.max = it.date; }
    }
    S.pendingImport = { items, label: detectAccountLabel(file.name, rows, { nonBudgetOnly: true }),
      index: dedupIndex(), range, skipped, noted: zero + tooSmall, filename: file.name,
      acctNumber: '', reconcile: null, dateReading: null, iBalance: -1, iAmount: -1,
      miles: { rate, total: miles, zero, tooSmall, number: milesFilenameNumber(file.name) },
      importId: ++importSeq, drCr: null,
      rows, map, file };
    $('#importMap').classList.add('hidden');
    importShown = IMPORT_PAGE;
    renderImportReview();
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
    /* 2026-11-25 audit, IMP-1. The marker column the detector recognises by
       heading (statement.js DRCR_COLS), offered here for a heading it does not
       know. Only read beside an Amount column (runImport). */
    { key: 'iDrCr', label: 'Dr/Cr marker', required: false, hint: 'Optional — a column saying which way each Amount went (Dr/Cr, Debit/Credit, D/C)' },
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
    /* ISSUE 91. THE SECOND SEAM. `onclick` is a DOM property: it awaits
       nothing and returns nowhere, so a throw in here became a rejected
       promise with no owner — invisible on iOS, invisible on desktop unless
       the console is open, and indistinguishable from a button that does
       nothing. src/controller.js's wireDropZone already holds this for the two
       drop targets; this entry is reached through a BUTTON instead of a drop
       and so never passed through it. Same rule, spelled here:

       REPORTS, IT DOES NOT REPAIR. runImport hides #importMap before it
       renders, so a failure mid-render leaves the screen half-changed and
       nothing here can know how far it got — S.pendingImport is left exactly
       as the failure left it, the same discipline save-failure.test.cjs holds
       for the nine Save paths. What it must NOT do is fall through to the
       "produced no transactions" sentence below: telling a reader to check the
       Date column when the render threw is a confident wrong diagnosis. */
    $('#impMapApply').onclick = async () => {
      try {
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
        // Same `finally` as handleStatementFile's, for the same reason and with
        // the same caveat — see the comment there. Both entries to runImport
        // carry it, because "present in one and easy to lose in the other" is
        // precisely how this file's drop-zone wiring went wrong before.
        try { await runImport(rows, map, file); } finally { importProgress('done'); }
        if (!S.pendingImport || !S.pendingImport.items.length) {
          $('#importMap').classList.remove('hidden');
          $('#impMapWarn').textContent = 'That mapping produced no transactions — check the Date column especially.';
        }
      } catch (e) {
        console.error('Budget: the column mapper\'s Apply handler failed', e);
        toast(`Could not read "${(file && file.name) || 'that file'}" with those columns (${(e && e.message) || e})`, true);
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
  /* Why a row arrives unticked, for the two holds renderImportReview adds
     (balance-carry rows, 2026-11-25 audit IMP-4; rows whose balance step
     contradicts their sign, IMP-1). Printed under the description and at the
     end of the tick box's name. */
  const CARRY_WHY = 'Described as a balance carried in or out, and its amount equals the balance beside it — a balance, not money moving. Tick to import it anyway if it really was a deposit.';
  const STEP_WHY = 'The balance beside this row does not move by this amount the way it does for the rest of the statement, so the row is left as the file wrote it. Check it against your statement, then tick to import it.';
  let importShown = IMPORT_PAGE;

  /* The sentence under a transfer whose other half is still counted (IMP-5;
     see judgeLegs). Named in full — account, date, description, amount — so
     the reader can find the row on the Transactions page without this screen.

     An ordinary leg gets the choice, ticked: marking it excluded is what the
     incoming row's own Exclude tick already says about the money, and left
     unticked the sentence stays as the warning it is. The tick is in a
     `tbl-tick` label like the row's own two, for the same 44px phone target,
     and it is its own visible label, so it needs no accessible name of its
     own (tests/accessible-names-keyed.test.cjs holds those to i18n keys;
     visible copy on this page is English, see heldWhy).

     A split leg gets the sentence only. Its parts are the reader's slices
     under their own categories, and which of them were the transfer is not a
     question an import can answer; the Transactions page is where they are. */
  function legNote(it, i, onChoice) {
    const leg = it.transferLegRow;
    const what = `“${leg.desc}” on ${leg.date}, ${legFlow(it)}`;
    if (it.legState === 'split') {
      return el('div', { class: 'imp-near-why' },
        `The other half of this transfer is in ${it.legAcct} (${what}), split into parts that are still counted. `
        + 'Split rows are left as they are — if those parts are this transfer, exclude them on the Transactions page.');
    }
    // The choice on a line of its own, tick first, as the row's own ticks sit.
    return el('div', { class: 'imp-near-why' },
      `The other half of this transfer is still counted in ${it.legAcct}: ${what}.`,
      el('div', {}, el('label', { class: 'tbl-tick' }, el('input', { type: 'checkbox', 'data-focus-key': `leg:${i}`,
        ...(it.keepLegCounted ? {} : { checked: '' }),
        onchange: e => { it.keepLegCounted = !e.target.checked; onChoice(); } }),
      ` Mark it excluded in ${it.legAcct} with this import`)));
  }
  /* A tick that changes whether a row speaks for its leg (Import, Exclude)
     redraws the review, so the sentence and its choice come and go with it;
     no other row pays for that. Focus is handed back to the tick that was
     pressed (dom.js refocus — the redraw removed it). */
  function legRedraw(it, key) {
    if (!it.legState) return;
    renderImportReview();
    refocus($('#impTable'), [key]);
  }

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
  function signVerdict(items, ledger, iBalance, iAmount, account, drCr) {
    const liability = isCreditCard(account);
    const rec = iBalance !== -1
      ? reconcileAmounts(ledger, { liability })
      : null;
    const flipped = !!rec && rec.verified && rec.flip && iAmount !== -1;
    /* `verified && flip` on a Debit/Credit PAIR, where it cannot be acted on:
       the balance column has proved that what the header calls "money out" is
       money in. Not auto-correcting is deliberate — the sign came from a column
       NAME, so a disagreement means the mapping is wrong, not the arithmetic —
       but the verdict must still reach the banner rather than falling through
       to "amounts check out". */
    const inverted = !!rec && rec.verified && rec.flip && iAmount === -1;
    /* THE ROWS THE MAJORITY WOULD CARRY ALONG (2026-11-25 audit, IMP-1). A
       verdict is a judgement on the FILE with 80% slack, and on a statement of
       six purchases and one salary, all positive, "every amount negated" fits
       five pairs of six: the salary was flipped into spending with the rest,
       under "checked and corrected", though its own balance step said it went
       UP. So wherever the verdict SET the signs — a whole-file flip, or a
       Dr/Cr marker column the balances are now judging — each row's own step
       is asked too (statement.js balanceStepVerdicts, the same step rule), and
       a row it contradicts is left exactly as the file wrote it and marked
       `stepFlag`; renderImportReview unticks it and says why. Not re-signed to
       fit: that would be the app correcting one row on a guess, the one thing
       this function exists not to do. Recomputed on every call, so a flag
       follows the account the reader picks. A file whose signs nobody changed
       is not second-guessed row by row here; the banner covers it, as before. */
    const steps = rec && rec.verified && (flipped || (drCr && iAmount !== -1))
      ? balanceStepVerdicts(ledger, { order: rec.order, flip: rec.flip, liability })
      : null;
    let disputed = 0;
    for (const it of items) {
      const doubt = !!steps && it.ledgerAt != null && it.ledgerAt >= 0 && steps[it.ledgerAt] === false && !it.carry;
      it.stepFlag = doubt;
      if (doubt) disputed++;
      it.amount = flipped && !doubt ? -it.amount0 : it.amount0;
    }
    if (rec) return { ...rec, flipped, inverted, disputed };
    /* ISSUE 95. No balance column means the check cannot be MADE — which is a
       thing to say, not a reason to go quiet. Returning null hid the banner
       entirely, so the one file the importer could not verify was also the one
       file that said nothing about it, while every verifiable file got a
       sentence. reconcileAmounts is already honest here (it returns a
       structured unverified verdict for a thin ledger); the caller simply
       declined to ask.

       `oneSign` is the tell worth naming: a real statement mixes money in and
       money out, so a file where every amount points the same way is usually a
       debit/credit pair that resolved to a single column — the shape the two
       fixes in statement.js address. With no balance column there is nothing
       to prove it either way, which is exactly why the reader is told rather
       than corrected. */
    const signs = new Set(items.map(it => Math.sign(it.amount0)).filter(Boolean));
    return { verified: false, flipped: false, inverted: false, unchecked: true,
      oneSign: items.length > 1 && signs.size === 1 };
  }

  function renderImportReview() {
    const p = S.pendingImport;
    if (!p) return;
    $('#importReview').classList.remove('hidden');
    const accSel = $('#impAccount'); accSel.empty();
    const labels = [...new Set([
      ...S.accounts.map(a => a.tx_label || a.name),
      ...Object.values(S.txFiles).map(f => f.label)])].sort();
    /* Nothing detected is a QUESTION, not a default (2026-10-14 audit, L6-06).
       This used to end with `if (!p.label && labels.length) p.label =
       accSel.value`, which took whatever a browser selects when no option is
       marked — the first account alphabetically — and left Import rows
       enabled: one tap posted a whole statement to an account the reader never
       chose, with the sign verdict, the duplicate count and the transfer
       suggestions all computed against that guess. The reader is the only one
       who can say which account a hand-saved export belongs to, so the select
       opens on a placeholder, p.label stays empty, and the button below stays
       off until they pick. The placeholder goes once a label is set (a
       re-render follows every pick), so it is never offered as a destination.

       A label that is SET but is no option fell through both halves of that:
       no placeholder (it is not empty) and no option marked (none is equal),
       so the select showed the first account while p.label, which commitImport
       writes under, still named another. It happens when the account it was
       detected for is deleted or re-pointed on the Accounts page while this
       review is open, and the next render rebuilds the options without it;
       the rows would then land in a folder no account claims. So a label is
       settled to the option it MEANS (accountForLabel folds case and safeSegs,
       as the writer does, and an account's option is always tx_label || name),
       and one that means no account is not settled at all: it goes back to
       the question above. Either way the select shows what p.label holds. */
    if (p.label && !labels.includes(p.label)) {
      const acct = accountForLabel(p.label);
      p.label = acct ? (acct.tx_label || acct.name) : '';
    }
    if (!p.label) accSel.append(el('option', { value: '', selected: '' }, 'Choose an account…'));
    for (const l of labels) accSel.append(el('option', { value: l, ...(l === p.label ? { selected: '' } : {}) }, l));
    accSel.onchange = () => { p.label = accSel.value; renderImportReview(); };
    /* The account is only settled HERE — by the user's pick, by an account made
       on the spot, or by detection. When detection came back empty it is NOT
       settled, and nothing below is allowed to behave as if it were. The
       self-transfer suggestion is a function of that account, so it is
       recomputed every render rather than left as parse-time guesswork; rows
       the reader has decided on carry manualExclude and are skipped. */
    /* ISSUE 53. The account is settled by here, so the sign verdict is
       re-decided from that account — not from the parse-time guess. Idempotent
       (see signVerdict), so re-rendering for "show more" or a category change
       costs nothing and changes nothing.

       DECIDED FIRST, and the order is the point. A transfer is "the same
       amount, the OPPOSITE sign" (statement.js oppositeLeg), so the transfer
       pass has to see the signs this account will actually import with. Run
       before the verdict, it saw the previous account's signs: pick a credit
       card for a file that had been read as an asset ledger and the card
       payment, still carrying the old sign, looked for the wrong leg, stayed
       +500 income and un-excluded — and the very next render, with the signs
       settled, excluded it. Pressing Import between the two imported the
       transfer as income. One render now gives the final state. */
    if (p.ledger) {
      p.reconcile = signVerdict(p.items, p.ledger, p.iBalance, p.iAmount,
        p.label ? accountForLabel(p.label) : null, p.drCr);
    }
    /* Pre-excluded transfers follow from the account AND the decided signs —
       see the note on applyCounterparties. */
    applyCounterparties(p.items, S.accounts, p.label, legsOfAccounts());

    /* The statement is already parsed and on screen by the time anyone notices
       it belongs to an account this vault has never had — and on a fresh vault
       the select above is EMPTY, so "Import rows" could only ever answer "pick
       an account first". Make one from here and land the rows in it.

       Assigned rather than addEventListener'd, matching the select above: this
       function re-runs on every account switch and every "show more", and a
       listener added each time would open one dialog per render. */
    $('#impNewAccount').onclick = async () => {
      /* A Miles file's account is offered as what it is: a rewards balance that
         sits outside the budget, named and numbered from the file, so the
         reader confirms rather than composes it. The reader still sees the whole
         create form and can change any of it — these are defaults. */
      const acct = await ctx.addAccount(p.miles
        ? { type: 'other', budget: 'no', name: i18n.t('imp.miles.newAccountName'), institution: 'Discovery',
          account_number: p.miles.number }
        : { type: 'checking' });
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
    /* The two other reasons a row arrives unticked, applied AFTER flagItems so
       neither can be undone by its re-include of a row that stopped being a
       duplicate: a balance carried in or out (`carry`, set once at parse time)
       and a row whose own balance step contradicts the sign the verdict gave it
       (`stepFlag`, re-decided by signVerdict above on every render). The same
       untick-not-skip as the near and pending rows, with the reader's own tick
       as the sticky bit: once they have ticked or unticked a row by hand
       (`manualInclude`), no re-render overrides it. `heldAuto` records that
       the untick was ours, so a flag that clears (the reader picked another
       account) gives the row back — unless some other reason still holds it. */
    let carried = 0, disputed = 0;
    for (const it of p.items) {
      const hold = !it.dup && (it.carry || it.stepFlag);
      if (hold) { if (it.carry) carried++; else disputed++; }
      if (it.manualInclude) continue;
      if (hold) { it.include = false; it.heldAuto = true; }
      else if (it.heldAuto) {
        it.heldAuto = false;
        if (!it.dup && !it.near && !it.pending) it.include = true;
      }
    }
    /* Where each proven transfer's other half stands (IMP-5) — after
       flagItems, because a duplicate writes nothing and speaks for no leg. */
    judgeLegs(p);
    const newOnes = p.items.filter(i => !i.dup);
    const auto = newOnes.filter(i => i.cat).length;
    const cur = currentPeriod();
    const curRange = periodRange(cur);
    const inCurrent = it => it.date >= curRange.start && it.date <= curRange.end;
    const curCount = p.items.filter(inCurrent).length;
    const shown = Math.min(importShown, p.items.length);
    /* No account yet means no duplicate check has been made — flagItems ran
       against an empty label and "0 duplicates skipped" would read as a clean
       result for a question nobody has asked. Said plainly instead; the count
       appears with the first pick.

       "new" and "will import" are both the number commitImport WRITES — ticked
       and not a duplicate (2026-11-25 audit, IMP-7). "new" used to count the
       unticked near-duplicates as well, and "all N will import" every row on
       the statement, duplicates included, so the two figures the reader is
       about to act on were the two that did not match what Import rows does.
       A function rather than one assignment so a tick, which re-renders
       nothing, can bring the line up to date (the row's onchange below). */
    const writeStats = () => {
      const writes = p.items.filter(i => i.include && !i.dup).length;
      /* The other halves (IMP-5), counted over EVERY row, not the rendered
         page: a leg named on row 340 of a long statement is still marked at
         commit, and the line the reader acts on has to say so. */
      const legsMarked = p.items.filter(i => legToExclude(i) || legOwedNow(i)).length;
      const legsLeft = p.items.filter(i => speaksForLeg(i) && !legToExclude(i)).length;
      $('#impStats').textContent =
        `${p.filename} — ${p.items.length} rows` +
        (p.label
          ? ` · ${writes} new · ${dupes} duplicates skipped`
          : ' · choose an account to check which of these are already in the vault') +
        (nears ? ` · ${nears} likely re-dated/re-worded (unticked)` : '') +
        (pendings ? ` · ${pendings} still pending (unticked)` : '') +
        (carried ? ` · ${carried} balance carried in or out (unticked)` : '') +
        (disputed ? ` · ${disputed} disagree with the balance column (unticked)` : '') +
        (legsMarked ? ` · ${legsMarked} transfer${legsMarked === 1 ? '’s other half' : 's’ other halves'} in another account will be marked excluded` : '') +
        (legsLeft ? ` · ${legsLeft} transfer${legsLeft === 1 ? '’s other half stays' : 's’ other halves stay'} counted in another account` : '') +
        ` · ${auto} auto-categorised` +
        (p.skipped ? ` · ${p.skipped} unparseable` : '') +
        (p.noted ? ` · ${p.noted} with no amount (not imported)` : '') +
        /* An exact duplicate is the one decision on this screen the reader
           cannot override — it renders a "dup" badge instead of a checkbox,
           with no explanation. The dedupe itself is sound and this is
           deliberately not an offer to import them anyway (see flagItems in
           src/dedupe.js for what "exact" means here) — but a bare count with
           nothing said about WHY reads as "these rows vanished", which for a
           statement the reader chose on purpose looks like data loss rather
           than the plugin correctly recognising rows it already has. */
        (dupes ? ' · already in the vault — check the Transactions page if you expected to see them' : '') +
        /* Say so out loud — a silent cap reads as "these are all the rows",
           and the user is about to press a button that imports the ones
           off-screen too. */
        (p.items.length > shown ? ` · showing ${shown}, all ${writes} will import` : '');
    };
    writeStats();
    $('#impLegend').empty();
    $('#impLegend').append(
      el('span', { class: 'imp-legend-swatch' }),
      el('span', {}, `${curCount} in the current period — ${periodTitle(cur)}`));
    /* Say out loud whether the file proved its own amounts. A bank this app has
       never been tested against is perfectly importable — but the user is the
       one who should decide how much to trust it, and that decision needs the
       evidence, not silence. */
    const rec = p.reconcile;
    /* ISSUE 62. Say which way the dates were read when the file overruled the
       household profile — the parsed ISO date on screen hides the decision. */
    /* Hidden again when this file has no date verdict. Nothing else ever hid it,
       so the sentence about the PREVIOUS statement's dates stayed on screen over
       a file it said nothing about — noticed with a Miles export dropped after a
       month-first statement, whose dates are ISO and were never in question. */
    const dateNote = $('#impDateReading');
    if (!p.dateReading && dateNote) dateNote.classList.add('hidden');
    if (p.dateReading) {
      const noteEl = $('#impDateReading');
      if (noteEl) {
        noteEl.classList.remove('hidden');
        // Two-way ternaries of literal keys, not a lookup table: the plural-count
        // guard (tests/i18n-plural-count-guard.test.cjs) resolves exactly that shape.
        noteEl.textContent = String(p.dateReading).startsWith('assumed')
          ? i18n.t(p.dateReading === 'assumed-day-first' ? 'imp.dateReading.assumedDayFirst' : 'imp.dateReading.assumedMonthFirst')
          : i18n.t(p.dateReading === 'day-first' ? 'imp.dateReading.dayFirst' : 'imp.dateReading.monthFirst');
      }
    }
    const recEl = $('#impReconcile');
    recEl.empty();
    recEl.classList.toggle('hidden', !rec);
    recEl.classList.toggle('imp-reconcile-warn', !!rec && (!rec.verified || rec.inverted));
    /* A Dr/Cr marker column set the signs (runImport; 2026-11-25 audit,
       IMP-1). Every sentence below says so when it did, because "the amounts
       check out" means something different when the file named each row's
       direction itself — and when the balance column then DISAGREES with those
       names, that is a fact about the file the reader has to see, not a
       correction to report as routine. */
    const dc = p.drCr ? `“${p.drCr.name}”` : '';
    if (rec && rec.unchecked) {
      recEl.textContent = dc
        ? `This statement has no balance column, so these amounts could not be checked against it. Their signs were read from its ${dc} column, row by row — spot-check a few rows below before importing.`
        : rec.oneSign
          ? 'This statement has no balance column, so these amounts could not be checked against anything — and every one of them has the same sign, which usually means a money-in and money-out pair was read as a single column. Check the + and − signs below, and use “Columns wrong?” if they are.'
          : 'This statement has no balance column, so these amounts could not be checked against it. Spot-check a few rows below before importing, especially the + and − signs.';
    } else if (rec) recEl.textContent = rec.flipped && dc
      ? `This statement’s ${dc} column and its balance column disagree: read the way the ${dc} column says, the amounts move the balance the wrong way. The balance column was followed — money out shows as negative below. Check a few rows against the statement, and use “Columns wrong?” if the wrong column was read as ${dc}.`
      : rec.flipped
        ? 'This statement lists money out as positive. Checked against its balance column and corrected — money out shows as negative below.'
        : rec.inverted
          ? 'This statement’s balance column says the money-in and money-out columns are the wrong way round — every amount below has the opposite sign to what the balances imply. Nothing has been corrected, because the signs came from the column names: open “Columns wrong?” and swap them before importing.'
          : rec.verified
            ? 'Amounts check out against this statement’s own balance column.' + (dc ? ` Their signs were read from its ${dc} column, row by row.` : '')
            : 'Could not check these amounts against the balance column — the balances don’t line up. Spot-check a few rows below before importing, especially the + and − signs.'
              + (dc ? ` Their signs were read from its ${dc} column.` : '');
    if (rec && rec.flipped && dc) recEl.classList.add('imp-reconcile-warn');

    /* The credit-marked column rule changes how a column is read, so the
       review says so, whatever the verdict above (runImport has the why). */
    if (p.creditMarked && rec) {
      recEl.textContent += ' This statement’s amounts mark money in with “Cr” and leave money out unmarked, so the unmarked amounts were read as money out.';
    }

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
    // The flow form of the same choice (see previewFlow's note).
    const flowSym = isForeign(target, home) && typeof ctx.moneyIn === 'function' ? symbolOf(target, home) : home;
    previewFlow = v => flowIn(flowSym, v);
    /* A fee printed BESIDE an amount (reconcileFeesBesideAmount). Said whichever
       way it went, because both outcomes change what lands in the vault:

         added      the balance showed each fee was charged on top, so each is a
                    "(fee)" row of its own — told, so the extra rows are not a
                    surprise on the table below;
         not added  the file could not settle it (no balance column, or the
                    fee rows disagreed), so the amounts are exactly as read and
                    the fee is NOT in them. That is a warning, and the plain
                    green sentence is withdrawn: the rows the balance disagrees
                    on used to be absorbed by the 80% slack under it. */
    const fn = p.feeNote;
    if (fn && rec) {
      const n = fn.count, m = previewMoney(fn.total);
      if (fn.added) {
        recEl.textContent += ` ${n === 1 ? '1 row printed a fee' : `${n} rows printed a fee`} beside its amount (${m} in total); the balance column shows ${n === 1 ? 'it was' : 'each was'} charged on top, so ${n === 1 ? 'it is' : 'each is'} imported as a separate “(fee)” row.`;
      } else {
        const said = `${n === 1 ? '1 row carries a fee' : `${n} rows carry a fee`} beside its amount (${m} in total), and ${n === 1 ? 'it was' : 'they were'} NOT added to the amounts below. `
          + (p.iBalance === -1
            ? 'There is no balance column to show whether a fee is already inside the amount or charged on top of it. '
            : 'The balance column does not settle whether a fee is already inside the amount or charged on top of it. ')
          + 'If a fee is a charge of its own, add it on the Transactions page after importing.';
        const plainGreen = rec.verified && !rec.flipped && !rec.inverted && !rec.unchecked;
        recEl.textContent = plainGreen ? said : `${recEl.textContent} ${said}`;
        recEl.classList.add('imp-reconcile-warn');
      }
    }
    /* The rows signVerdict would not carry along with the rest (`stepFlag`):
       counted here, reasoned on each row, unticked by the loop above. After
       the fee sentence, which may replace the whole banner. */
    /* `disputed` and `carried` are the counts the summary line uses (the loop
       after flagItems), so the two can never disagree about a row that is also
       a duplicate. */
    if (rec && disputed) {
      const n = disputed;
      recEl.textContent += dc && !rec.flipped
        ? ` ${n === 1 ? '1 row’s' : `${n} rows’`} ${dc} marker ${n === 1 ? 'disagrees' : 'disagree'} with the balance beside ${n === 1 ? 'it' : 'them'}, so ${n === 1 ? 'it was' : 'they were'} left as the marker says and unticked — check ${n === 1 ? 'it' : 'each'} below.`
        : ` ${n === 1 ? '1 row’s' : `${n} rows’`} own balance step does not fit that, so ${n === 1 ? 'it was' : 'they were'} left as the file wrote ${n === 1 ? 'it' : 'them'} and unticked — check ${n === 1 ? 'it' : 'each'} below.`;
      recEl.classList.add('imp-reconcile-warn');
    }
    /* Balance-carry rows (runImport `carry`). Said, so a row missing from the
       ticks is not a mystery; not a warning, since nothing about the amounts
       is in doubt. */
    const carriedN = rec ? carried : 0;
    if (carriedN) {
      recEl.textContent += ` ${carriedN === 1 ? '1 row is' : `${carriedN} rows are`} described as a balance carried in or out, with an amount equal to the balance beside ${carriedN === 1 ? 'it' : 'them'}, so ${carriedN === 1 ? 'it arrives' : 'they arrive'} unticked: a balance is not money moving. Tick ${carriedN === 1 ? 'it' : 'one'} if it was a real deposit.`;
    }

    const nbEl = $('#impNonBudget');
    const nonBudget = !!target && !target.in_budget;
    nbEl.classList.toggle('hidden', !nonBudget);
    if (nonBudget) nbEl.textContent =
      `${target.name} is excluded from the budget — these rows will import and show in Transactions, but won’t count toward income or spending totals.`;

    /* A Discovery Miles file says what it was read as, at what rate, and what it
       comes to — the review is where the rate is a claim the reader can check
       before it is written — and ARGUES when the account it is bound for counts
       toward the budget: Miles are a rewards balance, not money in a bank, and
       landing in a budget account they would be income (the card spend that
       earned them is already in that account's own rows). Said, not corrected:
       the pick is the reader's, and the one-tap alternative is the account
       button beside it. Reuses the reconcile line, which a Miles file has no use
       for (no balance column), rather than adding a second banner slot. */
    if (p.miles) {
      const loc = locale();
      const total = p.items.reduce((n, it) => n + it.miles, 0);
      const value = p.items.reduce((n, it) => n + it.amount, 0);
      const places = Math.abs(p.miles.rate * 100 - Math.round(p.miles.rate * 100)) < 1e-9 ? 2 : 4;
      recEl.classList.remove('hidden', 'imp-reconcile-warn');
      recEl.textContent = i18n.t('imp.miles.banner', {
        miles: typeof ctx.moneyIn === 'function' ? ctx.moneyIn('', total, 0).trim() : String(total),
        rate: decimalText(p.miles.rate, places, loc),
        value: previewMoney(value),
      });
      if (target && target.in_budget) {
        recEl.classList.add('imp-reconcile-warn');
        recEl.textContent += ' ' + i18n.t('imp.miles.budgetWarn', { account: target.name });
      }
    }

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
    /* Off until an account is chosen (see the placeholder above) as well as
       on a mismatch; commitImport refuses an empty label too, so this is the
       tell and that is the backstop. */
    $('#impCommit').disabled = ident.state === 'mismatch' || !p.label || inFlight === 'commit';

    const t = $('#impTable'); t.empty();
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, el('span', { class: 'sr-only' }, 'Import')),
      el('th', { scope: 'col' }, 'Date'), el('th', { scope: 'col' }, 'Description'),
      el('th', { scope: 'col', class: 'num' }, 'Amount'), el('th', { scope: 'col' }, 'Category'), el('th', { scope: 'col' }, 'Excl.'))));
    const body = el('tbody', {});
    const visible = p.items.slice(0, importShown);
    for (const [i, it] of visible.entries()) {
      const cls = (it.dup ? 'imp-dup' : it.near || it.pending ? 'imp-near' : '') + (inCurrent(it) ? ' imp-current' : '');
      // Spelled out rather than left to the badge: the row is unticked, and the
      // user needs to know WHICH existing row it collided with to judge whether
      // this is the bank rewriting a pending charge or a real second purchase.
      const nearWhy = it.near
        ? i18n.t('imp.near.why', { desc: it.near.desc, date: it.near.date })
        : '';
      /* Same shape as nearWhy, and said for the same reason: the row arrives
         unticked, so it has to say what made it so or the reader finds a
         missing purchase later with no trail back to this screen. */
      const pendingWhy = it.pending
        ? i18n.t('imp.pending.why')
        : '';
      /* The two holds this screen adds itself (see the loop after flagItems):
         a balance carried in or out, and a row whose balance step contradicts
         its sign. Same shape as the two above, for the same reason — but in
         English, like the rest of this page: tests/i18n.test.cjs holds an
         untranslated view under ten visible keys until the whole page is
         translated, so these wait for that pass rather than half-keying it. */
      const heldWhy = it.dup ? '' : it.carry ? CARRY_WHY : it.stepFlag ? STEP_WHY : '';
      const why = it.near ? nearWhy : it.pending ? pendingWhy : heldWhy;
      /* What the rule chose under the category, as text beside it (ADR-0010
         section 5). Not a control: the review does not edit a subcategory, it is
         changed on Transactions afterwards. It describes what will be written,
         so it leaves the screen the moment the category changes, which is also
         the moment the row stops carrying it (setRowCategory). */
      const ruleSub = subcategoryOf(it);
      const subNote = ruleSub ? el('span', { class: 'imp-rule-sub' }, ruleSub) : null;
      // Keyed by position as the landing for "Show more" below (dom.js refocus).
      body.append(el('tr', { class: cls.trim(), 'data-focus-key': `row:${i}` },
        /* Both ticks sit in a <label> so the phone card can give them a 44px
           target (statement/phone-tables.css); inert on a desktop. */
        el('td', {}, it.dup ? el('span', { class: 'category-badge badge-dup' }, 'dup') :
          el('label', { class: 'tbl-tick' }, el('input', { type: 'checkbox', 'aria-label': why
            ? i18n.t('imp.aria.importRowWhy', { date: it.date, desc: it.desc, amount: previewFlow(it.amount), why })
            : i18n.t('imp.aria.importRow', { date: it.date, desc: it.desc, amount: previewFlow(it.amount) }),
            // nearAuto stays TRUE once we have auto-unticked: it records that the
            // untick already happened, so a re-render (account switch, "show
            // more") leaves the user's decision — either way — alone.
            /* manualInclude: the reader has decided, and the carry / balance-
               step holds above leave the row alone from now on. The summary
               line counts what will be written, so it follows the tick. */
            ...(it.include ? { checked: '' } : {}),
            'data-focus-key': `inc:${i}`,
            onchange: e => { it.include = e.target.checked; it.manualInclude = true; writeStats(); legRedraw(it, `inc:${i}`); } }))),
        el('td', { class: 'text-muted', style: 'white-space:nowrap' }, it.date),
        el('td', {}, it.desc, ...(it.near ? [
          el('span', { class: 'category-badge badge-near', title: nearWhy }, 'likely dup'),
          el('div', { class: 'imp-near-why' }, nearWhy),
        ] : []), ...(p.miles && it.note ? [
          // The facts the rand figure was derived from, where the reader can see
          // them before they are written — the same text the Note column gets.
          el('div', { class: 'text-muted', style: 'font-size:0.8em' }, it.note),
        ] : []), ...(it.pending && !it.near ? [
          el('span', { class: 'category-badge badge-near', title: pendingWhy }, 'pending'),
          el('div', { class: 'imp-near-why' }, pendingWhy),
        ] : []), ...(heldWhy && !it.near && !it.pending ? [
          /* No `title` here, unlike the near and pending badges: those carry a
             keyed reason, this one is English (see heldWhy), and an English
             accessible name is the one thing tests/accessible-names-keyed.test.cjs
             refuses. The reason is printed in full on the line below anyway. */
          el('span', { class: 'category-badge badge-near' }, it.carry ? 'balance' : 'check'),
          el('div', { class: 'imp-near-why' }, heldWhy),
        ] : []), ...(it.transferTo ? [
          // Named, not silent: a row that arrives excluded must say what made
          // it so, or the reader finds a missing figure later with no trail —
          // and a row that only LOOKS like a transfer must say why it was
          // left counted, so the reader can make the call the app would not.
          /* The closing sentence follows the tick as it stands, so a row the
             reader has decided on never reads as the opposite of its box. */
          /* A chip, not a <span> with a `title` (dom.js caveatChip). "Named,
             not silent" was only true under a mouse: this is the row whose
             Exclude tick the reader is being asked to judge, and on a phone
             or a keyboard the reason it arrived ticked — or did not — could
             not be reached at all (audit of 11 Nov 2026, task 18). The near
             and pending badges above already print their reason beside
             themselves; these two were the ones that did not. */
          it.transferLeg
            ? caveatChip('transfer',
              `The description names your ${it.transferTo} account, and ${it.transferTo} already has the same amount the other way on ${it.transferLeg} — money moved between your own accounts rather than income or spend. `
                + (it.excluded ? 'So it arrives excluded; untick Exclude to count it.' : 'You have chosen to count it anyway.'),
              'category-badge badge-transfer badge-chip')
            : caveatChip('transfer?',
              `The description quotes the number of your ${it.transferTo} account, but ${it.transferTo} has no matching amount the other way within ${TRANSFER_LEG_DAYS} days — and anyone paying you can type that number as their reference. `
                + (it.excluded ? 'You have excluded it as a transfer.' : 'So it is counted as income or spend, not as a transfer; tick Exclude if it really was money moved between your own accounts.'),
              'category-badge badge-transfer badge-chip'),
        ] : []), ...(speaksForLeg(it) ? [legNote(it, i, writeStats)] : [])),
        el('td', { class: `num${it.amount >= 0 ? ' text-success' : ''}`, style: 'white-space:nowrap;font-weight:600' }, previewFlow(it.amount)),
        el('td', {}, it.dup ? (it.cat || '') : deferredCatSelect(it.cat, v => {
          /* setRowCategory, the one door for a category change: the rule's
             subcategory belonged to the old category, so it goes with it. */
          setRowCategory(it, v);
          it.manual = true;
          if (subNote && !subcategoryOf(it)) subNote.remove();
        }, i18n.t('imp.aria.category', { desc: it.desc })),
          ...(subNote ? [subNote] : []),
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
        el('td', {}, it.dup ? '' : el('label', { class: 'tbl-tick' }, el('input', { type: 'checkbox', 'aria-label': i18n.t('tx.aria.exclude', { desc: it.desc }),
          // manualExclude is the same sticky bit as nearAuto above: once the
          // reader has ticked either way, switching account must not silently
          // undo it on the next render.
          ...(it.excluded ? { checked: '' } : {}),
          'data-focus-key': `exc:${i}`,
          onchange: e => { it.excluded = e.target.checked; it.manualExclude = true; writeStats(); legRedraw(it, `exc:${i}`); } })))));
    }
    if (p.items.length > visible.length) {
      const rest = p.items.length - visible.length;
      const more = el('button', { class: 'btn-ghost', style: 'width:100%;padding:0.6rem', 'data-focus-key': 'more' },
        `Show ${Math.min(IMPORT_PAGE, rest)} more of ${rest} remaining`);
      /* The press rebuilds the table with this button in it, and focus fell to
         <body> — on the one screen where a keyboard reader is working down a
         statement row by row. They land on the first row the press revealed.
         The ROW, not its tick: a duplicate has no control to land on, and the
         category cell opens a picker the moment it takes focus. */
      const revealedFrom = visible.length;
      more.addEventListener('click', () => { importShown += IMPORT_PAGE; renderImportReview(); refocus(t, [`row:${revealedFrom}`, 'more']); });
      body.append(el('tr', {}, el('td', { colspan: '6', style: 'padding:0' }, more)));
    }
    t.append(body);
    /* Phone width stacks each row into a card (statement/phone-tables.css):
       keep the column names and the table semantics (dom.js tableCells). The
       first column (the Import tick, or the "dup" badge) has no visible header
       and goes unlabelled. */
    tableCells(t, [null, 'Date', 'Description', 'Amount', 'Category', 'Excl.']);
  }

  /* ONE WRITE AT A TIME (2026-11-25 audit, IMP-2). Import rows and Undo
     import both serialise whole month files from memory across several
     awaited writes, and on an iCloud vault each write can take seconds. With
     no guard a second tap on Import rows started a second commit over the same
     review: memory got every row twice, and Undo then took one copy back and
     reported success while the disk still held the rows. An Undo pressed
     mid-commit would act on the PREVIOUS receipt while this one's files were
     still being written.

     So a call while either is running returns without doing anything — a
     second tap of the same button silently, since the first is already doing
     what was asked; the OTHER operation with a word, since that press would
     otherwise look like a button that does nothing. The button that started it
     is off for the duration and given back in `finally`, whatever happened in
     between. The Import button is this view's; the Undo button belongs to the
     Transactions page's bar, so it is found by its class and left alone if
     that page has not drawn one. */
  async function runExclusive(kind, button, work) {
    if (inFlight) {
      if (inFlight !== kind) toast('The last import is still being written — try again in a moment.', true);
      return;
    }
    inFlight = kind;
    const btn = button();
    const was = btn ? btn.disabled : false;
    if (btn) btn.disabled = true;
    try { return await work(); }
    finally {
      inFlight = null;
      /* Given back to what the review says it should be, not blindly to what
         it was: a stopped import re-renders the review mid-flight, and an
         account mismatch found there must keep the button off. */
      if (btn) btn.disabled = kind === 'commit' && S.pendingImport ? commitBlocked(S.pendingImport) : was;
    }
  }
  const commitBlocked = p => acctIdentity(p).state === 'mismatch' || !p.label;
  const undoButton = () => {
    const bar = $('#txUndoBar');
    return bar && typeof bar.querySelector === 'function' ? bar.querySelector('.tx-undo-btn') : null;
  };
  const commitImport = () => runExclusive('commit', () => $('#impCommit'), commitImportNow);
  const undoImport = () => runExclusive('undo', undoButton, undoImportNow);

  async function commitImportNow() {
    const p = S.pendingImport;
    if (!p || !p.label) return toast('Pick an account first', true);
    // Resolve the label before it becomes a folder name — it can originate from
    // an Accounts file's tx_label, which may be edited on a synced device.
    // txSegment keeps an existing folder's on-disk name so the S.txFiles key
    // below and the path written match exactly.
    const label = txSegment(p.label);
    if (!label) return toast('Invalid account name for import', true);
    const toAdd = p.items.filter(i => i.include && !i.dup);
    /* The other halves this commit is to mark excluded (IMP-5), judged
       against the vault as it is now, not as it was at the last render. Two
       kinds: the legs of rows about to be written, and the legs of rows an
       earlier, stopped attempt of this same import wrote but did not get as
       far as marking (`legOwed`, set as each row lands) — a retry finishes
       those, or they would stay counted with nothing left on screen to say so. */
    judgeLegs(p);
    const owedLegs = () => p.items.filter(legOwedNow);
    const legKeys = new Set([...toAdd.filter(legToExclude), ...owedLegs()].map(it => it.legKey));
    // Named in the closing toast: the halves the reader chose to leave counted.
    const legsKept = toAdd.filter(it => speaksForLeg(it) && !legToExclude(it));
    if (!toAdd.length && !legKeys.size) return toast('Nothing selected to import', true);
    /* The review was built over this load's months, and the months below are
       written from them: every write is bound to it (io.js opWriter). A
       pending import counts as unsaved work, so switchBook() refuses over it
       — but another device removing this book from the list does not ask. */
    const op = opWriterOf(ctx);

    /* The identity gate, re-asked here rather than trusted from the render:
       the account select is live, so the pick can change after the banner was
       drawn — and this is the last point at which anything can be stopped. */
    const ident = acctIdentity(p);
    if (ident.state === 'mismatch') {
      return toast(`That statement belongs to account ${ident.ours}, not ${ident.acct.name} (${ident.theirs}) — nothing was imported`, true);
    }
    /* Not into a month with unsaved edits (2026-10-07 audit, L3-26). Each
       month is written whole from its live model, so an unsaved recategorise
       there went to disk with the imported rows — Save never pressed, and
       "Reload from disk" no longer a way back from it. Refused for the whole
       import rather than for the one month: half a statement landing is a
       state the reader has to untangle, and nothing is lost by waiting — the
       review stays on screen exactly as it is, the edits stay unsaved. Asked
       before the account-number offer below, so a refused import writes
       nothing at all. Only the months this import writes are looked at —
       which includes the month file of every other half it is to mark
       excluded (IMP-5): that file is written whole too. */
    const unsaved = [...new Set(toAdd.map(it => it.date.slice(0, 7)))]
      .filter(month => (S.txFiles[`${label}/${month}`] || {}).dirty)
      .map(month => txFileRel(label, month))
      .concat([...legKeys].filter(k => (S.txFiles[k] || {}).dirty).map(k => txFileRel(S.txFiles[k].label, S.txFiles[k].month)));
    if (unsaved.length) {
      return toast(`${unsaved.join(', ')} ${unsaved.length === 1 ? 'has' : 'have'} changes you have not saved. `
        + 'Importing writes each month file whole, so it would save them too — Save or reload them on the '
        + 'Transactions page first, then Import rows again. Nothing was imported.', true);
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
      const gone = op.replaced();
      if (gone) return toast(gone, true);
      if (go) {
        ident.acct.account_number = ident.ours;
        // saveAccount no longer throws on a disk error — it toasts its own
        // failure and resolves false, so a try/catch here would never see
        // one. Check the return instead: not fatal to the import either way,
        // the rows are still going to the account the reader picked, but
        // account_number stays set in memory regardless of whether the write
        // landed, so a failed save is worth its own word on top of
        // saveAccount's toast rather than being silently swallowed.
        if (!(await ctx.saveAccount(ident.acct, ['account_number'], op))) {
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
      const row = {
        /* A Miles row carries its facts in `note` (src/miles.js). The reader's
           own Excluded tick is appended AFTER them, so the Miles count stays the
           first thing in the cell for parseMilesNote. */
        date: it.date, desc: it.desc, cat: it.cat, amount: it.amount, excluded: it.excluded,
        note: it.note ? (it.excluded ? `${it.note} \u00b7 Excluded during import` : it.note)
          : it.excluded ? 'Excluded during import' : '' };
      /* The subcategory a rule chose, through the one door so a label with no
         category is never written. A row with none gets no field, and a month
         file in which no row has one gets no Subcategory column. */
      if (subcategoryOf(it)) setRowCategory(row, it.cat, subcategoryOf(it));
      additions.get(key).entries.push({ row, src: it });
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
    const legsLanded = [];   // the other halves marked excluded (IMP-5)
    try {
      for (const [key, { month, entries }] of additions) {
        const rows = entries.map(e => e.row);
        const existing = S.txFiles[key];
        const fileModel = existing
          ? { ...existing, rows: existing.rows.concat(rows) }
          : { label, month, rows, dirty: false, fmRaw: TX_FM };
        /* Whether THIS write brings the month file into existence — the fact
           undoImport needs to take it back rather than leave a header-only
           file behind (2026-10-07 audit, L3-19). Asked of the vault, case-folded
           the way the filesystem answers (io.js pathTaken), as well as of the
           model: a month that reached disk some other way since the last load
           is not one this import made, and must never be trashed by its Undo. */
        const created = !existing && !pathTaken(txFileRel(label, month));
        await op.writeFile(txFileRel(label, month), serializeTxFile(fileModel));
        /* Landed — in the book this import was reviewed in. If another load
           replaced the state while that write was in flight, the model below
           is not this book's any more: counted, said, and nothing of it is
           pushed into the state that won. */
        if (op.replaced()) { done += rows.length; throw new Error(op.replaced()); }
        if (!S.txFiles[key]) S.txFiles[key] = { label, month, rows: [], dirty: false, fmRaw: TX_FM };
        S.txFiles[key].rows.push(...rows);
        // Neutralise the committed items and record them in the dedup snapshot so
        // a re-render / retry treats them as already-present (no re-import).
        for (const e of entries) {
          // Asked before the tick goes: a landed row whose leg is to be
          // marked owes that mark, even if the pass below never gets to it.
          if (legToExclude(e.src)) e.src.legOwed = true;
          e.src.include = false;
          // Into BOTH layers: a retry must see the landed row as an exact dup,
          // and the near pass must be able to match a later rewrite of it.
          addToIndex(p.index, e.src.date, e.src.desc, e.src.amount, lab);
        }
        landed.push({ key, month, rows, created });
        done += rows.length;
      }
      /* THE OTHER HALVES (IMP-5), after this import's own rows, so a leg is
         only ever marked for a row that is in the vault. One write per month
         file, through the same `op` as the rows above, written from a model
         and only then reflected in memory — the lockstep rule this loop
         follows. `excluded` is the one field changed: the reader's category,
         note and every other cell are the row as it was, and the live row
         object is kept (mutated, not replaced) so anything holding it still
         holds the row. Each lands in `legsLanded`, which the receipt keeps so
         Undo can count exactly these rows again. */
      const byFile = new Map();
      for (const it of owedLegs()) {
        if (!byFile.has(it.legKey)) byFile.set(it.legKey, []);
        byFile.get(it.legKey).push(it);
      }
      for (const [key, its] of byFile) {
        const file = S.txFiles[key];
        if (!file) continue;
        const mark = new Set(its.map(it => it.transferLegRow));
        await op.writeFile(txFileRel(file.label, file.month),
          serializeTxFile({ ...file, rows: file.rows.map(r => (mark.has(r) ? { ...r, excluded: true } : r)) }));
        if (op.replaced()) throw new Error(op.replaced());
        for (const r of mark) r.excluded = true;
        for (const it of its) it.legDone = true;
        legsLanded.push({ key, rows: [...mark] });
      }
    } catch (err) {
      // The rows that DID land are still undoable — the receipt is written on
      // this path too, or a partial import would be the one nobody can take
      // back. Left of the toast so it exists before the early return.
      const rows = `${done} row${done === 1 ? '' : 's'}`;
      /* No receipt when the state was replaced under the import: its rows are
         objects of a load nobody is looking at, so there is nothing an Undo
         could take back — and the toast must not offer one (2026-11 final
         review). The review screen went with that reload too. */
      if (op.replaced()) {
        return toast(`Import stopped after ${rows} (${err.message || err}). `
          + (done ? 'Those rows are saved in their month files, but the budget was read again meanwhile, so this import cannot be undone from here — check the Transactions page and delete any that should not be there.'
            : 'Nothing was imported.'), true);
      }
      if (landed.length || legsLanded.length) S.lastImport = receipt(p, label, landed, done, legsLanded);
      renderImportReview();   // reflect what already landed; the rest stays selectable
      /* Undo is offered only for what THIS file put in the vault (2026-11-25
         audit, IMP-3). When the very first write failed and no earlier
         attempt of this same import landed anything, S.lastImport is still
         an EARLIER import's receipt — "Undo it" pointed at that other file.
         Its receipt is left as it is (the Transactions bar names its own
         file), and this toast does not offer it. */
      const mine = S.lastImport && S.lastImport.importId === p.importId;
      return toast(mine
        ? `Import stopped after ${rows} (${err.message || err}). Saved rows kept — click Import rows again to retry the rest, or Undo it on the Transactions page.`
        : `Import stopped before any row was saved (${err.message || err}). Nothing was imported — click Import rows again to retry.`, true);
    }
    S.lastImport = receipt(p, label, landed, done, legsLanded);
    const touched = additions;
    let newRules = 0, ruleNote = { updated: 0, note: '' };
    if ($('#impRemember').checked) {
      /* A pair carries the subcategory its row has, so a rule is taught the
         pair the reader is looking at and not the category alone. The review
         cannot set one itself: what a row carries here came from a rule and
         survives only while the category is the rule's own. */
      const pairs = toAdd.filter(it => it.manual && it.cat).map(it => (subcategoryOf(it)
        ? { desc: it.desc, cat: it.cat, subcategory: subcategoryOf(it) }
        : { desc: it.desc, cat: it.cat }));
      /* With what the learn skipped (categories.js learnRulesWithCorrections;
         2026-11-25 audit, RUL-3). A ctx without it — a test that mounts this
         view alone — learns as before and has nothing to ask. */
      const learned = typeof ctx.learnRulesWithCorrections === 'function'
        ? await ctx.learnRulesWithCorrections(pairs, op)
        : { added: await learnRules(pairs, op), corrections: [], conflicts: [] };
      newRules = learned === null || learned.added === null ? null : learned.added;
      if (learned) ruleNote = await askRuleCorrections(learned, op);
    }
    S.pendingImport = null;
    $('#importReview').classList.add('hidden');
    /* learnRules says null when it learned nothing because the state was
       replaced since this import read it — said, rather than left out. */
    /* The other halves (IMP-5): what was marked, by account, and what the
       reader chose to leave counted — said here as well as on the review,
       because the review is gone the moment this toast appears. */
    const n = k => `${k} transfer${k === 1 ? '' : 's'}`;
    const acctsOf = keys => [...new Set(keys.map(k => { const f = S.txFiles[k]; const a = f && accountForLabel(f.label); return a ? a.name : (f ? f.label : k); }))].join(', ');
    const marked = legsLanded.reduce((k, l) => k + l.rows.length, 0);
    const legSaid = marked ? `, and marked the other half of ${n(marked)} excluded in ${acctsOf(legsLanded.map(l => l.key))}` : '';
    const keptSaid = legsKept.length
      ? ` The other half of ${n(legsKept.length)} is still counted in ${acctsOf(legsKept.map(it => it.legKey))}.` : '';
    toast(`Imported ${toAdd.length} transactions into ${touched.size} file${touched.size === 1 ? '' : 's'}` + legSaid
          + (newRules ? `, saved ${newRules} new rules` : '')
          + (ruleNote.updated ? `, updated ${ruleNote.updated} rule${ruleNote.updated === 1 ? '' : 's'} to the ${ruleNote.updated === 1 ? 'category' : 'categories'} you chose` : '')
          + '.'
          + (newRules === null ? ' ' + i18n.t('tx.savedNotLearned') : '')
          + ruleNote.note + keptSaid);
    ctx.switchView('transactions');
  }

  /* THE RULES THE READER DISAGREED WITH (2026-11-25 audit, RUL-3). A row
     refiled on the review whose pattern is already a rule pointing elsewhere
     was dropped by learnRules without a word — rightly not overwritten, but
     the toast only spoke about NEW rules, so the same wrong category came
     back on every import with nothing to say why. Asked once per commit, the
     Transactions page's own question (transactions.js offerRuleCorrection)
     for a statement's worth of rows: the list, capped so the dialog stays
     readable, then "and N more".

     The same shape of answer, deliberately: "Keep the rules" is the cancel
     side and drawn as the call to action, so Escape, a tap outside and every
     other way of not answering leaves the file alone; "Update the rules" is
     plain beside it, because it refiles every future import of those
     merchants. Update repoints through categories.js correctRules — the
     objects learnRules handed back, one write. A pattern two rows filed two
     ways is listed and never repointed.

     In English, like the rest of this page (tests/i18n.test.cjs holds an
     untranslated view under ten visible keys until the whole page is
     translated, and this view sits at that line) — the Transactions page's
     tx.ruleFix.* wording is echoed rather than called for that reason.

     Returns { updated, note } for the commit toast: how many rules were
     repointed, and the sentences that follow — which rules were kept and
     still point elsewhere, which patterns were left as conflicting. */
  const RULE_LIST_CAP = 5;
  async function askRuleCorrections({ corrections = [], conflicts = [] }, op) {
    if (!corrections.length && !conflicts.length) return { updated: 0, note: '' };
    const rows = n => `${n} row${n === 1 ? '' : 's'}`;
    const listed = (items, say) => {
      const shown = items.slice(0, RULE_LIST_CAP).map(say).join('; ');
      return items.length > RULE_LIST_CAP ? `${shown}; and ${items.length - RULE_LIST_CAP} more` : shown;
    };
    const conflictSaid = conflicts.length
      ? `${conflicts.length === 1 ? 'One rule is' : `${conflicts.length} rules are`} left as ${conflicts.length === 1 ? 'it is' : 'they are'}, because the rows matching ${conflicts.length === 1 ? 'it' : 'each'} were filed under different categories: `
        + listed(conflicts, c => `"${c.pattern}" (the rule says ${c.category}; you chose ${c.chosen.map(x => `${x.cat} for ${rows(x.count)}`).join(' and ')})`) + '.'
      : '';
    if (!corrections.length) return { updated: 0, note: ` ${conflictSaid}` };
    const go = await confirmModal(app, {
      title: corrections.length === 1 ? 'Update the matching rule too?' : 'Update the matching rules too?',
      message: `You filed rows differently from the ${corrections.length === 1 ? 'rule' : 'rules'} that matched them, so the next import would file them the old way again: `
        + listed(corrections, c => `"${c.pattern}" (the rule says ${c.from}, you chose ${c.to} for ${rows(c.count)})`) + '. '
        + `Update ${corrections.length === 1 ? 'the rule' : 'them'} only if every row matching ${corrections.length === 1 ? 'it' : 'each pattern'} belongs in the category you chose. `
        + 'Your rows are filed as you chose either way.'
        + (conflictSaid ? ` ${conflictSaid}` : ''),
      cancelText: 'Keep the rules',
      confirmText: corrections.length === 1 ? 'Update the rule' : 'Update the rules',
      primary: 'cancel',
    });
    const names = corrections.slice(0, RULE_LIST_CAP).map(c => `"${c.pattern}"`).join(', ')
      + (corrections.length > RULE_LIST_CAP ? ` and ${corrections.length - RULE_LIST_CAP} more` : '');
    const kept = corrections.length === 1
      ? ` The rule for ${names} still points to ${corrections[0].from}, so the next import files those rows that way again.`
      : ` The rules for ${names} still point to their old categories, so the next import files those rows that way again.`
      + (conflictSaid ? ` ${conflictSaid}` : '');
    if (!go) return { updated: 0, note: kept };
    /* The dialog is a window in which the state can be replaced (io.js
       opWriter): the rule objects in hand would then belong to a load nobody
       is looking at, and correctRules refuses on `op` — said, not dropped. */
    const changed = await correctRules(corrections.map(c => ({ rule: c.rule, to: c.to })), op);
    if (!changed) return { updated: 0, note: kept };
    return { updated: changed, note: conflictSaid ? ` ${conflictSaid}` : '' };
  }
  const correctRules = (changes, op) => (typeof ctx.correctRules === 'function' ? ctx.correctRules(changes, op) : 0);

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
  /* One import, one receipt (2026-11-25 audit, IMP-3). A retry after a
     stopped import is the SAME import finishing, so its rows join the receipt
     the first attempt wrote rather than replacing it — replaced, Undo took back
     only the retried rows and the first attempt's had no way back. Same
     pending import (importId) and same destination only; anything else is a
     new receipt, as before. A month both attempts wrote is one entry, so Undo
     judges it whole: whether the import created it, and whether all its rows
     are this import's, are questions about the file, not about one attempt.

     `at` is LOCAL time (IMP-8), through dates.js nowLocalMinute, the one copy
     of that rule: the UTC slice it replaced told a reader in Johannesburg that
     an import made at 14:00 was made at 12:00. */
  /* `legs` (IMP-5): [{ key, rows }] — the other halves of transfers this
     import marked excluded in their own month files, as the row objects it
     changed, so Undo counts exactly those rows again. A retry's join the
     first attempt's, like its rows. */
  function receipt(p, label, landed, count, legs = []) {
    const prior = S.lastImport;
    if (prior && p && prior.importId === p.importId && prior.label === label) {
      for (const f of landed) {
        const same = prior.files.find(x => x.key === f.key);
        if (same) same.rows = same.rows.concat(f.rows);
        else prior.files.push(f);
      }
      prior.legs = (prior.legs || []).concat(legs);
      prior.count += count;
      return prior;
    }
    return {
      label,
      filename: (p && p.filename) || '',
      at: nowLocalMinute().slice(11),
      count,
      files: landed,
      legs,
      importId: p ? p.importId : null,
    };
  }

  /* An OPEN review keeps the dedupe index it was built with, and commitImport
     adds each landed row to it so a retry after a stopped import sees them as
     present — which they are. Undo takes rows back out of the ledger, and an
     index nobody refreshed went on calling them duplicates: a badge with no
     tick box and "already in the vault", on rows that are not (2026-11-17
     audit, M1). Rebuilt from S.txFiles rather than subtracted from: with a
     same-day, same-amount pair the vault's copies and the statement's are
     indistinguishable by key, and the rebuild is right by construction.
     Nothing else on the review is touched — flagItems re-judges on the next
     render and keeps every sticky bit (a hand-made tick or untick) where the
     row is still eligible. No review open: nothing to do. */
  function refreshPendingIndex() {
    if (S.pendingImport) S.pendingImport.index = dedupIndex();
  }

  async function undoImportNow() {
    const r = S.lastImport;
    if (!r || (!r.files.length && !(r.legs || []).length)) return;
    /* The load this receipt's row objects belong to. Every write below is
       bound to it (io.js opWriter), and it is asked again after the dialog. */
    const op = opWriterOf(ctx);

    /* Resolved against the CURRENT model, not the receipt's own count: a row
       may already have been deleted by hand from the Transactions table since
       the import, and offering to remove 42 rows while removing 41 is the kind
       of small lie that costs the reader's trust in every other figure here. */
    const targets = [];
    for (const f of r.files) {
      const file = S.txFiles[f.key];
      if (!file) continue;
      const live = new Set(file.rows);
      const imported = new Set(f.rows.filter(row => live.has(row)));
      const doomed = new Set(imported);
      /* A row that was split AFTER it was imported has parts the receipt never
         held: applySplit mutates the imported row into the parent in place (so
         it is still on the receipt) but the parts are new row objects made on
         the Transactions page. Left behind they described a charge that no
         longer exists, counted as ordinary spend, and kept a created month from
         counting as emptied. They go with their parent — found the way that page
         finds them (tx-role.js splitPartsOf).

         The one case that cannot be settled by looking: another split parent in
         the same file with the same date and description that this undo is NOT
         taking back. Its parts are indistinguishable from these, so removing
         "these" could remove the other's, a reader's own categorisation. Left
         in place and counted, and the confirmation and the result say so. */
      const partsGone = new Set(), partsKept = new Set();
      for (const parent of imported) {
        if (splitRole(parent.split) !== SPLIT_PARENT) continue;
        const mine = splitPartsOf(file.rows, parent);
        if (!mine.length) continue;
        const shared = splitParentsSharingKey(file.rows, parent).some(x => !imported.has(x));
        for (const part of mine) (shared ? partsKept : partsGone).add(part);
      }
      for (const part of partsGone) doomed.add(part);
      /* `emptied` — a month this import CREATED, left with nothing but its own
         rows. Taking those back means taking the file back too: rewriting it
         header-only left a month file the import had invented, and a second
         Undo could not remove it (2026-10-07 audit, L3-19). A created month
         that has since gained a row of the reader's own (Add transaction) is
         not emptied, and is rewritten like any other. Asked of the doomed set
         AFTER the split parts joined it — a split's parts are the import's own
         rows by then, not the reader's. */
      const emptied = !!f.created && file.rows.every(row => doomed.has(row));
      /* The file to trash is taken HERE, before the confirmation below, as a
         TFile — io.js trashFile's own rule: a path re-resolved after a dialog
         may name nothing by then, or a different file, while a TFile survives
         a rename. The account, plan, tax-year and note deletes do the same. */
      const tfile = emptied ? fileAt(txFileRel(file.label, file.month)) : null;
      if (doomed.size) targets.push({ key: f.key, file, doomed, dirty: file.dirty, emptied, tfile,
        parts: partsGone.size, keptParts: partsKept.size });
    }
    const total = targets.reduce((n, t) => n + t.doomed.size, 0);
    /* The other halves this import marked excluded (IMP-5), counted again —
       only those still exactly as the import left them: in the same file of
       this load, still excluded, and not split since (a split parent's
       Excluded tick is what keeps its money from being counted twice, and is
       not this undo's to take off). A leg the reader has un-excluded, split
       or deleted since is theirs now, and left. Grouped per file, so a file
       is written once. */
    const legBack = new Map();   // key -> { file, rows: Set }
    for (const l of r.legs || []) {
      const file = S.txFiles[l.key];
      if (!file) continue;
      const live = new Set(file.rows);
      const rows = l.rows.filter(row => live.has(row) && row.excluded === true && !splitRole(row.split));
      if (!rows.length) continue;
      if (!legBack.has(l.key)) legBack.set(l.key, { file, rows: new Set() });
      for (const row of rows) legBack.get(l.key).rows.add(row);
    }
    const legCount = [...legBack.values()].reduce((n, b) => n + b.rows.size, 0);
    const legAccts = [...new Set([...legBack.values()].map(b => { const a = accountForLabel(b.file.label); return a ? a.name : b.file.label; }))].join(', ');
    if (!total && !legCount) {
      S.lastImport = null;
      ctx.renderTransactions();
      return toast('Those rows are no longer in the app — nothing to undo', true);
    }
    /* Unsaved edits in the same months go to disk with the undo, because the
       write below serialises the whole file from memory. Said out loud rather
       than discovered afterwards: it is a save the reader did not press Save
       for, and on this page there is always the possibility of one. A month
       going to the trash writes nothing, so it cannot carry an edit out. */
    const rewritten = targets.filter(t => !t.emptied).length;
    const trashed = targets.length - rewritten;
    const alsoSaves = targets.some(t => t.dirty && !t.emptied) || [...legBack.values()].some(b => b.file.dirty);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const acts = [];
    if (rewritten) acts.push(`rewrite ${plural(rewritten, 'monthly file')}`);
    if (trashed) acts.push(`move the ${plural(trashed, 'file')} this import created to the vault's trash`);
    /* The split parts that go with their parents, said by number whenever there
       are any — "remove 3 rows" over a dialog that removes 5 is the small lie
       the resolved-against-the-model count above exists to avoid. Parts left in
       place (see the lookup) are named too, so they are not mistaken for rows
       this undo missed. */
    const parts = targets.reduce((n, t) => n + t.parts, 0);
    const keptParts = targets.reduce((n, t) => n + t.keptParts, 0);
    const keptSaid = keptParts
      ? `${plural(keptParts, 'split part')} could not be told apart from those of another split row with the same date and description that is not in this import, so ${keptParts === 1 ? 'it stays' : 'they stay'} in place — delete ${keptParts === 1 ? 'it' : 'them'} on the Transactions page if ${keptParts === 1 ? 'it is' : 'they are'} not wanted.`
      : '';
    // The other halves (IMP-5), named by account so the reader knows which
    // rows elsewhere are about to count again.
    const legsSaid = legCount
      ? `the other half of ${plural(legCount, 'transfer')} this import marked excluded in ${legAccts} will be counted again`
      : '';
    const go = await confirmModal(app, {
      title: 'Undo this import',
      message: (total
        ? `Remove the ${plural(total - parts, 'row')} imported into ${r.label}`
          + (r.filename ? ` from ${r.filename}` : '')
          + (parts ? `, plus the ${plural(parts, 'split part')} of rows you split afterwards` : '')
          + `, and ${acts.join(', and ')}? `
          + (legsSaid ? `${legsSaid.charAt(0).toUpperCase() + legsSaid.slice(1)}. ` : '')
        : `The rows imported into ${r.label} are already gone, but ${legsSaid}. Go ahead? `)
        + 'Categorisation rules learned during the import are kept — they cost nothing and '
        + 'are useful whichever account the statement really belongs to.'
        + (alsoSaves ? ' Unsaved edits you have made in those same months will be written out too.' : '')
        + (keptSaid ? ' ' + keptSaid.charAt(0).toUpperCase() + keptSaid.slice(1) : ''),
      confirmText: total ? `Remove ${total} row${total === 1 ? '' : 's'}` : 'Count them again',
    });
    if (!go) return;
    /* The dialog is a window in which the state can be replaced under this
       operation (ADR 0009, 2026-11 review): a book switch from the headless
       API, a second Budget view or a popout reloads every view, and the dirty
       refusal does not cover this page because an undo runs on a clean one.
       `targets` then holds the PREVIOUS book's month objects while
       txFileRel() resolves into the new book, and confirming wrote the
       household's rows over the client's month of the same account and month.
       A reload of the same book is the same hazard one step smaller — the
       receipt's rows are objects nothing holds any more (S.lastImport is
       cleared by every load). So: if the state the targets were gathered from
       is gone, nothing is written, and the reader is told why. io.js refuses
       the write too, for the window before the reload lands.

       The loop below awaits between files as well, and a switch whose reload
       commits there made the next write land in the new book (the 2026-11
       re-review). So each write goes through `op`, which refuses once the load
       in memory is not this one, and the toast says how many files it took
       back before it stopped. */
    const replaced = op.replaced();
    if (replaced || S.lastImport !== r) {
      ctx.renderTransactions();
      return toast(replaced || i18n.t('io.reloaded.message'), true);
    }

    let undone = 0, files = 0, legsUndone = 0;
    try {
      for (const t of targets) {
        if (t.emptied) {
          /* io.js trashFile: the vault's own .trash, recoverable from inside
             Obsidian — never the system trash. A file already gone by now is
             simply no longer there to take back (trashFile says false), and
             memory follows the disk either way. */
          await op.trashFile(t.tfile);
          /* Only the object this undo held: if another load has replaced the
             state meanwhile, the key may name the new book's month. */
          if (S.txFiles[t.key] === t.file) delete S.txFiles[t.key];
        } else {
          const keep = t.file.rows.filter(row => !t.doomed.has(row));
          /* A leg this undo counts again that sits in this same file goes in
             the same write (IMP-5) — one write per file. */
          const back = legBack.get(t.key);
          legBack.delete(t.key);
          /* Written from a MODEL rather than by mutating first: a write that
             fails must leave the row in memory as well as on disk, or the app
             starts reporting a total the file does not hold. Same lockstep rule
             commitImport follows in the other direction. */
          await op.writeFile(txFileRel(t.file.label, t.file.month), serializeTxFile({ ...t.file,
            rows: back ? keep.map(row => (back.rows.has(row) ? { ...row, excluded: false } : row)) : keep }));
          t.file.rows = keep;
          if (back) { for (const row of back.rows) row.excluded = false; legsUndone += back.rows.size; }
          // Disk now matches memory for this file, including whatever unsaved
          // edits it carried — so it is genuinely clean, not merely written.
          t.file.dirty = false;
        }
        undone += t.doomed.size;
        files++;
      }
      /* The other halves in files this undo removes nothing from (IMP-5):
         the same model-first write, `excluded` the only field it touches. */
      for (const [key, back] of legBack) {
        await op.writeFile(txFileRel(back.file.label, back.file.month),
          serializeTxFile({ ...back.file, rows: back.file.rows.map(row => (back.rows.has(row) ? { ...row, excluded: false } : row)) }));
        for (const row of back.rows) row.excluded = false;
        back.file.dirty = false;
        legsUndone += back.rows.size;
        legBack.delete(key);
        files++;
      }
    } catch (err) {
      S.lastImport = null;
      /* Files already taken back are out of the ledger, so an open review has
         to stop counting them as present — same as the success path below. */
      refreshPendingIndex();
      ctx.renderTransactions();
      return toast(`Undo stopped after ${files} file${files === 1 ? '' : 's'} (${err.message || err}) — the rest are unchanged`, true);
    }
    S.lastImport = null;
    refreshPendingIndex();
    /* The Save button may have been lit by edits that have just been written
       out above. Asking the page to recompute is not possible from here — the
       predicate lives in controller.js — so re-render and let it settle: any
       file still dirty re-lights it on its own next edit. */
    if (!Object.values(S.txFiles).some(f => f.dirty)) $('#txSave').disabled = true;
    ctx.render();
    toast(`Undone — ${undone} row${undone === 1 ? '' : 's'} removed from ${files} file${files === 1 ? '' : 's'}`
      + (parts ? ` (${plural(parts, 'split part')} included)` : '')
      + (legsUndone ? `, and the other half of ${plural(legsUndone, 'transfer')} in ${legAccts} counted again` : '')
      + (keptSaid ? `. ${keptSaid.charAt(0).toUpperCase() + keptSaid.slice(1)}` : ''));
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

module.exports.decideDayFirst = decideDayFirst;
