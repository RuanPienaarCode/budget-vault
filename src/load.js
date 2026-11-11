'use strict';
/* loadVault — reads every budget file into the in-memory state S. */

const { TFile } = require('obsidian');
const { TYPE_ORDER, overspendLag, emergencyTarget, inputMode } = require('./constants');
const { milesRate } = require('./miles');
const { periodDaysOrZero } = require('./dates');
const { parseNum, normalizeAmount } = require('./amount');
const { normalizeCode, normalizeCadence, currencyConflict } = require('./fx');
const { parseFrontmatter, parseMdTableWithSeparator, unescMd,
  splitAroundTable, extraContent, headingOf, findTable } = require('./markdown');
const { parseDelimited, sniffDelimiter, uncsvCell } = require('./csv');
/* One declaration per flat table drives this loader's reads AND the views'
   writes — ADR-0003. The generic reader is called here ONLY; downstream
   consumers of transaction rows still go through tx-role.js. */
const { SCHEMAS, rowToObject, attachExtraCells, extraColsOf, knownColumns, lineEndingOf, keepsDigits } = require('./table-schema');
const { PLAN_TABLES, TAX_TABLES } = require('./table-schema');
const i18n = require('./i18n');
const { setLanguage, defaultLanguage, resolveLanguage } = i18n;
const { safeSeg } = require('./vault-path');
const { isRealIsoDate } = require('./dates');
const { parseOwners } = require('./owners');
const { parseGroups, parseNonEssential, typeOrder, typeRank } = require('./groups');
const { NOTES_DIR, parseNote, sortNotes } = require('./note-file');
const { RECEIPTS_DIR, FOOD_ITEMS_FILE, parseReceiptFile, parseFoodItems } = require('./receipt-file');

/* ADR-0007 · fmNum: absent or unreadable is null, never 0. NOT parseNum — its fallback
   of 0 is a figure the file never claimed. */
function fmNum(v) {
  const s = (v ?? '').toString().trim();
  return s ? normalizeAmount(s) : null;
}

/* ADR-0007 · Heading slice before parseMdTable. The chunk under one `## Heading`;
   the one definition Plans and Tax share.

   2026-10-14 audit, L3-04. The heading must BE the section's name (trimmed,
   case-folded, markdown.js headingOf — the same reading extraContent uses),
   not merely start with it. The first PREFIX match used to win, so a
   household's `## Documents still to request` above or below the real
   `## Documents` was read as the Documents table: the document list came back
   empty or wrong, and the next Save wrote that over the real one. Anything
   that is not exactly a known heading is an extra, kept whole. */
function section(body, name) {
  for (const chunk of body.split(/\r?\n##\s+/).slice(1)) {
    if (headingOf(chunk) === name) return chunk;
  }
  return '';
}

/* One plan or tax table, read the way the four flat tables are (L3-05):
   rows with a blank first cell are KEPT — "R750 deposit, name it later" is the
   row a household types by hand, and `.filter(c => c[0])` dropped it from the
   page, from the Tax totals, and from the file on the next Save — and a cell
   past the schema's own columns is carried verbatim (attachExtraCells), with
   the table-level half (extraColsOf) kept beside the rows so a hand-added
   column, or the tail of a bare `[[a|b]]` wikilink the table splits in two,
   is written back where it was. A row with nothing in any cell is not a row.
   `first` is the first header of the plugin's table in this section, so a
   small table of the household's own above it is not mistaken for it. */
function readSectionTable(body, name, spec, map) {
  const { header, sep, dataRows } = parseMdTableWithSeparator(section(body, name), spec.first);
  const rows = [];
  for (const c of dataRows) {
    if (c.every(x => !x)) continue;
    rows.push(attachExtraCells(map(c), spec.known, c));
  }
  return { rows, extraCols: extraColsOf(spec.known, header, sep, dataRows) };
}

/* Does the text open with a frontmatter block that CLOSES? A leading BOM is
   not content (parseFrontmatter strips it the same way). The block may be
   empty (`---` straight over `---`). */
const stripBom = text => (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
const startsFence = text => /^---[ \t]*\r?\n/.test(stripBom(text));
const hasFrontmatterBlock = text => /^---\r?\n(?:[\s\S]*?\r?\n)?---/.test(stripBom(text));
/* A flat-table file that has words in it and no table row at all. An absent or
   empty file is a new one (never written), not an unreadable one. */
function lacksTable(text) {
  if (!text || !text.trim()) return false;
  const body = parseFrontmatter(text).body;
  return body.trim() !== '' && !body.split(/\r?\n/).some(l => l.trim().startsWith('|'));
}

/* ADR-0007 · fmBool is tri-state. absent → undefined, written → true/false,
   unreadable → undefined (never false). */
function fmBool(v) {
  const s = (v ?? '').toString().trim().toLowerCase();
  if (!s) return undefined;
  if (/^(true|yes|on|1)$/.test(s)) return true;
  if (/^(false|no|off|0)$/.test(s)) return false;
  return undefined;
}

/* ISSUE 67/69 — the four flat single-table files (Assets/Debts/Owed/Services)
   share one shape: frontmatter, a lead paragraph the view owns, one table,
   nothing after it — except what a household hand-added in those last two
   spots, which mdTableFile's leadRaw/trailRaw/extraCols carry back out.
   `text` null (file never written) leaves every field null or empty, which a
   brand-new file's serializer treats as "generate the fixed shape fresh".
   L3-20 (2026-10-07 audit): lead/trail come back in the file's OWN line
   ending (its first break decides), so a CRLF file is not written back half
   LF. `tx` is CONTRACT 1 with serializeTxFile — see verbatimAroundTable. */
function tableParts(text, first) {
  if (!text) {
    return { lead: null, trail: null, header: undefined, sep: null, dataRows: [], tx: { lead: '', trail: '', sep: '' } };
  }
  const eol = lineEndingOf(text) || '\n';
  const inFileEol = s => (eol === '\n' ? s : s.split('\n').join(eol));
  const { before, after } = splitAroundTable(parseFrontmatter(text).body, first);
  const { header, sep, dataRows } = parseMdTableWithSeparator(text, first);
  return { lead: inFileEol(before), trail: inFileEol(after), header, sep, dataRows, tx: verbatimAroundTable(text, first) };
}

/* CONTRACT 1 (2026-10-07 audit, L3-02 + L3-22's separator half): a month
   file's text the transactions serializer does not model. `lead` is the text
   from the fence's line break up to the header line, `trail` everything after
   the last row's line break, `sep` the separator row as written (each '' if
   none), so '---\n' + fm + '\n---\n' + (lead || '\n') + header + '\n' + sep +
   '\n' + rows + trail is the file again. No table: all of it is lead. No
   frontmatter: lead starts at the top. LF-normalised and BOM-free, because the
   serializer writes '\n' throughout (a CRLF piece in an LF file is L3-20). */
function verbatimAroundTable(text, first) {
  const t = (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text).replace(/\r\n/g, '\n');
  const { body } = parseFrontmatter(t);
  let rest = body;
  if (body.length !== t.length) {          // a frontmatter block was consumed: skip the rest of its closing line
    const nl = body.indexOf('\n');
    rest = nl < 0 ? '' : body.slice(nl + 1);
  }
  const lines = rest.split('\n');
  /* `first`: the plugin's table, not a household's small one above it (L3-10,
     markdown.js findTable) — the same choice the row reader makes, so the lead
     and the rows can never come from two different tables. */
  const run = findTable(lines, first);
  if (!run) return { lead: rest, trail: '', sep: '' };
  const { start, end } = run;
  const next = start + 1 < end ? lines[start + 1] : '';
  return {
    lead: lines.slice(0, start).map(l => l + '\n').join(''),
    trail: lines.slice(end).join('\n'),
    sep: /^\|[\s:|-]+\|$/.test(next.trim()) ? next : '',
  };
}

/* One flat table's rows, read the way all four are read. `known` is the
   FILE's own column count (knownColumns, L3-21): a cell past it is the
   household's own column and is carried, never interpreted.

   A row with a blank FIRST cell is kept (L3-12). "R500 owed for the flat
   deposit, name to follow" is precisely the row a household types by hand,
   and `if (!c[0]) continue` used to drop it here — so the next save of the
   page, for an edit to any OTHER row, deleted it, amount and all. Nothing
   that reads these rows keys them by name (owed-math and worth key by
   currency, debt-math by row, a service's merchant tokens drop short and
   empty words), so a nameless row is listed and counted like any other. A
   row with nothing in ANY cell is still not a row. */
function readFlatTable(schema, text) {
  const { lead, trail, header, sep, dataRows } = tableParts(text, schema.columns[0].header);
  const known = knownColumns(schema, header, dataRows);
  const rows = [];
  for (const c of dataRows) {
    if (c.every(x => !x)) continue;
    rows.push(attachExtraCells(rowToObject(schema, c.slice(0, known)), known, c));
  }
  return { rows, lead, trail, extraCols: extraColsOf(known, header, sep, dataRows) };
}

module.exports = function registerLoad(ctx) {
  const { S, vault, currentPeriod, periodKeyValid } = ctx;

  /* ADR-0007 · Every load starts from the default settings. The defaults are
     what this ctx's S carried when the loader was registered — controller.js's
     and api.js's literal (tests/api-state-settings-parity.test.cjs holds the
     two together), or a test harness's own — copied, so no load can reach
     back into them. Starting from the last load's instead let a key a book's
     Settings.md leaves out inherit the PREVIOUS book's value. */
  const SETTINGS_DEFAULTS = JSON.parse(JSON.stringify(S.settings || {}));

  /* ADR-0007 · Reads in parallel, parsing serial. The wait is I/O round trips, not work.
     ADR-0007 · read() is declared where loadNotes can reach it. Not inside loadVault. */
  const read = async files => {
    const texts = await Promise.all(files.map(f => vault.cachedRead(f)));
    return files.map((file, i) => ({ file, text: texts[i] }));
  };

  /* ---- which book is in memory, and the one rule for loading another ----
     ADR-0007 · loadVault is single-flight. Only for one folder: a call for
     another folder starts its own load.
     ADR-0007 · A load is for one book, built aside, committed whole. It reads
     every file through io.js readersAt() pinned to the folder it started for,
     builds its state off to the side, and commits in one synchronous step only
     if that folder is still open and no newer load has committed. A caller
     whose load was superseded follows the switch. `committed` is the folder
     the state in S was read from (basePath() form) and the load's sequence
     number — io.js refuses a write into any other folder (loadedBook). */
  /* `staleMark` is WHEN that load began, on io.js's stale sequence: every
     change somebody else made that was marked at or before it, this load read
     after. It is the only honest bound for lifting those marks, and it travels
     with the load rather than with whoever asked for it, because the asker may
     have JOINED (2026-11-11 audit, task 1). controller.js's reloadFromDisk took
     its own mark; joined onto a load that had already read a month file, it
     lifted the mark for a phone row that load never saw, and the next Save
     deleted the row (tests/save-refuses-stale-joined-reload.test.cjs). */
  let committed = null;    // { folder, seq, staleMark } — frozen; replaced, never mutated
  let seq = 0;
  let inFlight = null;      // { folder, promise } — the load a same-folder caller joins
  const openFolder = () => ctx.basePath();

  function loadVault() {
    const folder = openFolder();
    if (inFlight && inFlight.folder === folder) return inFlight.promise;
    const entry = { folder, promise: null };
    const mine = ++seq;
    entry.promise = doLoadVault(folder, mine)
      .finally(() => { if (inFlight === entry) inFlight = null; })
      .then(() => {
        /* Superseded: the open book moved while this read. Follow it; a load
           already running for the new folder is joined, not doubled. */
        if (!committed || committed.folder !== openFolder()) return loadVault();
        return undefined;
      }, err => {
        /* A superseded load's FAILURE is followed the same way: it was a read
           of a book nobody is looking at, and handing it to its caller marked
           the open book's screen as failed (connectVault: S.loaded = false)
           under a state that had loaded fine. */
        if (folder !== openFolder()) return loadVault();
        throw err;
      });
    inFlight = entry;
    return entry.promise;
  }

  /* The book the state in memory was read from, or null before the first load:
     { folder, seq, staleMark }, one frozen object per committed load, so a caller holding
     one across an await can tell "still the same load" by identity.
     ADR-0007 · A confirmation dialog takes a load stamp. io.js opWriter() takes
     this before the operation's first await and binds every write to it. */
  function loadedBook() { return committed; }

  /* The same question as opWriter().replaced(), for a caller holding only a
     stamp: null while the state is still the load the stamp was taken on (and
     the open book's), else the sentence to show. */
  function stateReplaced(stamp) {
    if (committed === stamp && (!committed || committed.folder === openFolder())) return null;
    return i18n.t('io.reloaded.message');
  }

  async function doLoadVault(folder, mySeq) {
    /* Taken before the first read, and before anything is awaited: what was
       marked stale up to here is older than every byte this load will hold.
       A ctx assembled without io.js's ledger has nothing to bound. */
    const began = typeof ctx.staleMark === 'function' ? ctx.staleMark() : 0;
    // Every read below goes through R, rooted at `folder`; T is committed at the end.
    const R = ctx.readersAt(folder);
    const T = { settings: JSON.parse(JSON.stringify(SETTINGS_DEFAULTS)) };
    /* ADR-0007 · The interface language is set at commit. i18n.js holds it as a
       global, so a superseded load must not set it; no Settings.md means the
       default language, as at a fresh mount — not the previous book's. */
    let language = defaultLanguage();
    /* ADR-0007 · Unreadable files are recorded, not swallowed. Every fallback
       below still opens the app; S.unreadableFiles ({ rel, why }, rel relative
       to the budget folder) names what it fell back past, for the page banner. */
    const unreadable = [];
    T.unreadableFiles = unreadable;
    const settingsTxt = await R.readFile('Settings.md');
    if (!settingsTxt || !settingsTxt.trim()) unreadable.push({ rel: 'Settings.md', why: 'missing' });
    else if (!hasFrontmatterBlock(settingsTxt)) unreadable.push({ rel: 'Settings.md', why: 'frontmatter' });
    if (settingsTxt) {
      const { fm } = parseFrontmatter(settingsTxt);
      if (fm.month_start_day) {
        // Clamp 1–28 even for hand-edited files: 29–31 skews period lengths and
        // misassigns rolled-over days (the settings UI already clamps).
        const n = parseInt(fm.month_start_day, 10) || 23;
        T.settings.month_start_day = Math.min(28, Math.max(1, n));
      }
      /* ADR-0007 · Pay cycle is a length in days with an anchor. Absent means payday months;
         a cycle without an anchor is dropped with it. */
      /* A real date, not merely a date-SHAPED string — the same test period.js
         gates the cycle on. A shape check accepted 2026-13-45 and stored the
         pair, while period.js refused it and ran payday months, so the settings
         screen sat there showing a cycle the app was not running. */
      const anchor = (fm.period_anchor || '').toString().trim();
      const anchorOk = isRealIsoDate(anchor);
      T.settings.period_days = anchorOk ? periodDaysOrZero(fm.period_days) : 0;
      T.settings.period_anchor = anchorOk ? anchor : '';
      if (fm.currency) T.settings.currency = fm.currency;
      /* ADR-0007 · Exchange rates are opt-in and normalised to a boolean. ISSUE 30 — absent
         means off: zero network requests. */
      T.settings.exchange_rates = String(fm.exchange_rates ?? '').trim().toLowerCase() === 'on';
      /* ADR-0007 · rate_refresh defaults to daily and is normalised. Through fx.normalizeCadence,
         so a hand-edited `hourly` falls back. */
      T.settings.rate_refresh = normalizeCadence(fm.rate_refresh);
      /* The ISO code the rate lookup asks for. The `currency` symbol above is
         what gets PRINTED; this says which currency that symbol means, because
         "$" is four of them. Blank is a complete answer — it just means rates
         cannot be fetched. */
      T.settings.currency_code = normalizeCode(fm.currency_code);
      // Country code (za/us/uk/…) — localeFor falls back to za for unknown
      // values, so a hand-edited Settings.md can't break the app.
      T.settings.country = (fm.country || 'za').toString().trim().toLowerCase();
      /* ADR-0007 · Language is independent of country. Absent follows Obsidian's display
         language; an unknown value falls back to English. */
      language = resolveLanguage(fm.language || defaultLanguage());
      T.settings.language = language;
      /* ADR-0007 · input_mode defaults to csv and is assigned unconditionally. inputMode() in
         constants.js is the one normaliser. */
      T.settings.input_mode = inputMode(fm.input_mode);
      T.settings.household = fm.household || '';
      /* The people the household's accounts can belong to. Absent means "one
         person", which is what every vault written before this key existed
         says — and the Accounts page then hides the owner controls entirely
         rather than offering a question with one possible answer. */
      T.settings.owners = parseOwners(fm.owners);
      /* The household's own category groups and which groups the emergency
         maths may drop — see src/groups.js for the shape and the rules. Both
         absent means the built-in types only, which is what every vault
         written before these keys existed says. */
      T.settings.groups = parseGroups(fm.groups);
      T.settings.nonessential_groups = parseNonEssential(fm.nonessential_groups, T.settings.groups);
      /* ADR-0007 · overspend_lag is clamped to 1–12. A credit card settles a month in arrears;
         0 would read a deficit that is still growing. */
      T.settings.overspend_lag = overspendLag(fm.overspend_lag);
      /* ADR-0007 · emergency_target_months is assigned unconditionally. The clamp lives in
         constants.js beside the settings tab's. */
      T.settings.emergency_target_months = emergencyTarget(fm.emergency_target_months);
      /* The value of one Discovery Mile, in the household's currency, for the Miles
         importer (src/miles.js). Assigned unconditionally like the two above, and
         through the one definition, so a blank, zero or unreadable hand-edit
         reads as the default 10 Miles to the rand rather than as nothing. */
      T.settings.miles_rate = milesRate(fm.miles_rate);
    }
    T.categories = [];
    for (const { file, text } of await read(R.mdFilesUnder('Categories'))) {
      const { fm } = parseFrontmatter(text);
      // Prefer the exact name from frontmatter — filenames drop filesystem-illegal
      // chars, so the frontmatter `name` is the source of truth.
      T.categories.push({
        name: fm.name || file.basename, type: fm.type || 'expense', color: fm.color || '#888',
        /* ADR-0007 · type_stated: an absent type is not an answer. `type` defaults to expense;
           ISSUE 32's pairing rule must not read the default as a statement. */
        type_stated: String(fm.type ?? '').trim() !== '',
        /* ADR-0007 · assume_spent: a category whose budget is its actual spend. The money left
           last period; fmBool, so unreadable is unset; `rel` below carries the path. */
        assumeSpent: fmBool(fm.assume_spent) === true,
        /* ADR-0007 · fixed is its own flag, not derived from type. Rent is an ordinary expense
           (19.9% vs 44.4% of income committed). */
        fixed: fmBool(fm.fixed) === true,
        /* ADR-0007 · interest marks income a fund itself earned. ITEM 2 (2026-08-26); opt-in,
           read by savings-math.js's classifyRow. */
        interest: fmBool(fm.interest) === true,
        /* Budget-folder-relative, because that is the currency readFile and
           writeFile deal in — file.path is absolute within the vault and would
           be re-prefixed by relPath into a path that does not exist. */
        rel: file.path.slice(R.basePath().length + 1),   // ISSUE 97 — READ from, never assembled
      });
    }
    const order = typeOrder(T.settings.groups);
    T.categories.sort((a, b) => typeRank(a.type, order) - typeRank(b.type, order) || a.name.localeCompare(b.name));

    T.accounts = [];
    /* ADR-0007 · Nested account files are named, not loaded. ISSUE 60: every write site
       addresses Accounts/<name>.md, so loading them would fork the file on the next save. */
    /* Found minus read, not "deeper than one level": the disclosure then states
       what this loader actually skipped rather than a second guess at it, and
       empties itself the day the read below recurses — a caveat that outlives
       the thing it qualifies is how a real one stops being believed. */
    /* ISSUE 60, closed: the writers address `a.rel` now (views/accounts.js's
       acctPath), so a file found deeper is edited in place instead of being
       forked to a second copy at the top level. That order was the whole
       blocker — tests/account-file-paths.test.cjs holds it. */
    const acctFiles = R.mdFilesUnder('Accounts');
    const acctRead = new Set(acctFiles.map(f => f.path));
    T.accountsIgnored = R.mdFilesUnder('Accounts').filter(f => !acctRead.has(f.path)).map(f => f.path);
    /* ADR-0007 · Two accounts claiming one transaction folder. ISSUE 72: keyed the way
       accountForLabel keys; filled after the accounts loop below. */
    T.accountsDuplicated = [];
    const acctBase = R.basePath();
    for (const { file: f, text: acctText } of await read(acctFiles)) {
      const { fm, body, raw } = parseFrontmatter(acctText);
      /* An account file that OPENS a frontmatter block and never closes it:
         the fence is lost, not absent. A note with no `---` at all is a
         hand-made account and legitimately has no properties (L3-07). */
      if (startsFence(acctText) && !hasFrontmatterBlock(acctText)) {
        unreadable.push({ rel: f.path.slice(acctBase.length + 1), why: 'frontmatter' });
      }
      T.accounts.push({
        name: f.basename,
        /* The file this account WAS read from, from its own path — loadNotes'
           rule below, and categories' `rel`. `Accounts/<name>.md` is a guess
           about where the file sits, and ISSUE 60 is that guess being wrong;
           an account save must address the file, not the guess. Equal to the
           assembled path for every account loaded today, so nothing moves —
           see the ADR-0007 register, "An account carries the path it was read
           from", for why the writers must adopt it before the loader recurses. */
        rel: f.path.slice(acctBase.length + 1),
        fmRaw: raw,   // verbatim frontmatter, for lossless write-back of unmodeled keys
        type: fm.type || 'other', institution: fm.institution || '',
        account_number: fm.account_number || '', tx_label: fm.tx_label || '',
        /* Which member of the household this account belongs to — a name from
           Settings.md's `owners:` line, the reserved word `joint`, or absent.
           Kept verbatim rather than matched against the declared list here:
           owners.js owns what the value means, so an owner since removed from
           the settings line keeps its account instead of quietly losing it. */
        owner: String(fm.owner || '').trim(),
        /* The symbol this account's OWN figures are printed in. Absent means
           the household's, so no existing vault renders differently on
           upgrade. It never converts and never excludes — see currency.js. */
        currency: String(fm.currency || '').trim(),
        /* ADR-0007 · currency_code is read at load. "$" is four currencies; absent means
           not convertible (docs/adr/0004). */
        currency_code: normalizeCode(fm.currency_code),
        /* ADR-0007 · currency_conflict is decided at load. A home symbol with a foreign code was
           HOME to currency.js and FOREIGN to fx.js (R1 000 vs R17 985,61); flagged here, where
           both halves are in scope, only for the contradictory case. */
        ...((clash => (clash ? { currency_conflict: clash } : {}))(
          currencyConflict(fm.currency, fm.currency_code, T.settings.currency, T.settings.currency_code))),
        /* Warnings this account has been told to stay quiet about — `true`, or
           a list like [no-transactions, unconfirmed]. Kept as the raw string;
           acct-status.js owns what the words mean, so there is one parser
           rather than one here and another there. */
        ignore_warnings: String(fm.ignore_warnings || '').trim(),
        // parseNum, not parseFloat: a hand-edited "1,234.56" read as 1 would be
        // written straight back as 1.00 on the next balance edit, destroying the
        // real figure. balanceRaw preserves anything the strict parse rejected,
        // exactly as amountRaw does for transaction cells.
        ...(bal => ({ balance: bal.value, balanceRaw: bal.ok ? null : bal.raw }))(parseNum(fm.balance || '0')),
        balance_updated: fm.balance_updated || '',
        /* ADR-0007 · budget: false opts an account out; absent means in. So no vault's figures
           move on upgrade. */
        in_budget: !/^(false|no|off|0)$/i.test(String(fm.budget ?? '').trim()),
        /* ADR-0007 · in_budget_stated: an absent key is not consent. ISSUE 41: the earmark
           rule in period.js needs the difference. */
        in_budget_stated: String(fm.budget ?? '').trim() !== '',
        /* A card the household clears in full before interest. Its outstanding
           balance is money already spent that has not left the cheque account
           yet, so it counts as committed rather than as negative cash.
           `settle_day` narrows WHEN; it is optional and only ever narrows. */
        settle_monthly: /^(true|yes|on|1)$/i.test(String(fm.settle_monthly ?? '').trim()),
        settle_day: fmNum(fm.settle_day),
        /* ADR-0007 · Account numbers go through fmNum, never parseFloat. Every one is
           written back by saveAccount's FM_WRITERS. */
        credit_limit: fmNum(fm.credit_limit),
        /* ADR-0007 · emergency_fund is tri-state. true (whole balance), a number (that slice),
           null (never asked, or unreadable). */
        emergency_fund: (v => {
          if (fmBool(v) === true) { return true; }
          const n = fmNum(v);
          return n !== null && n > 0 ? n : null;
        })(fm.emergency_fund),
        goal_amount: fmNum(fm.goal_amount),
        target_date: fm.target_date || '',
        monthly_contribution: fmNum(fm.monthly_contribution),
        total_invested: fmNum(fm.total_invested),
        starting_amount: fmNum(fm.starting_amount),
        inception_date: fm.inception_date || '',
        tags: fm.tags || '',
        body,
      });
    }
    T.accounts.sort((a, b) => a.name.localeCompare(b.name));

    T.budgets = {};
    T.budgetMeta = {};
    /* Both period-name shapes load side by side. A vault that has switched
       between monthly and interval periods keeps both sets of files, and the
       one the active period type can't address simply never gets asked for —
       nothing is deleted, so switching back finds them where they were. */
    for (const { file: f, text } of await read(R.mdFilesUnder('Budgets').filter(f => /^\d{4}-\d{2}(-\d{2})?$/.test(f.basename)))) {
      const period = f.basename;
      const { raw, body } = parseFrontmatter(text);
      // ISSUE 97 — `rel` beside the frontmatter: views/budgets.js writes the
      // period back, and must write it where it came from.
      /* ISSUE 67 — leadRaw/trailRaw: budget-file.js regenerates the title and
         range note fresh every save (the range note must keep tracking
         month_start_day/period_days, so it is never frozen from disk), but a
         paragraph a household added above or below the table has nowhere
         else to live and was being destroyed on the next save. */
      const { before, after } = splitAroundTable(body, 'Category');
      /* 2026-10-07 round-trip audit — what a Budget Save must give back, read
         here, written by budget-file.js. extraCols/extraCells (L3-25): a column
         added after Notes is carried the ISSUE 69 way; c[0]..c[3] were all
         this read, so the column went at the next Save. order (L3-22): each
         row's category in file order, null for a nameless one; only new rows
         are placed by the type-then-name rule (every row was re-sorted).
         unnamed (L3-12): a row with no category is kept BESIDE the rows, not in
         them — every reader keys budget rows by category and byCat[''] holds
         uncategorised spend, so in S.budgets it would claim that spend as its
         Actual (and persistedRows() deleted it at Save). The Budget page says
         it is counted nowhere. A row with nothing in any cell is not kept. */
      const { header, sep, dataRows } = parseMdTableWithSeparator(text, 'Category');
      const rows = [], unnamed = [], order = [];
      for (const c of dataRows) {
        if (c.every(x => !x)) continue;
        const amt = parseNum(c[2]);
        // type is unescMd'd for the same reason category and notes are: the
        // serializer escapes it, so a household group named with a pipe must
        // come back as the name the user typed, not as `needs\|wants`.
        const row = attachExtraCells({ category: unescMd(c[0]), type: unescMd(c[1] || ''), amount: amt.value, amountRaw: amt.ok ? null : amt.raw, notes: unescMd(c[3] || '') }, 4, c);
        /* L3-17: an amount two decimals cannot hold keeps its own text, the
           money() rule in table-schema.js. */
        if (amt.ok && keepsDigits(amt.value)) row.amountText = String(c[2]).trim();
        if (row.category) { rows.push(row); order.push(row.category); }
        else { unnamed.push(row); order.push(null); }
      }
      T.budgets[period] = rows;
      T.budgetMeta[period] = {
        raw, rel: f.path.slice(R.basePath().length + 1), leadRaw: before, trailRaw: after,
        extraCols: extraColsOf(4, header, sep, dataRows), order, unnamed,
      };
    }

    T.txFiles = {};
    /* ADR-0007 · The undo receipt is cleared beside the state it depends on. It holds
       references to the rows just replaced. */
    T.lastImport = null;
    /* ADR-0007 · Every Transactions/ folder is recorded. S.txFiles is keyed per month
       file and cannot see an empty folder. */
    {
      const seen = new Map();
      for (const a of T.accounts) {
        const key = safeSeg(a.tx_label || a.name).toLowerCase();
        if (seen.has(key)) T.accountsDuplicated.push({ label: a.tx_label || a.name, first: seen.get(key), second: a.name });
        else seen.set(key, a.name);
      }
    }
    T.txFolders = [];
    T.txFolderPaths = {};
    T.txFoldersIgnored = [];
    /* ADR-0007 · Transactions are read at any depth, and the label is the leaf.
       ISSUE 97 — read one level, an account under Transactions/Closed/<name>/
       lost its ROWS while ISSUE 60's fix kept its balance counting: R88 000
       present, its R250 of interest absent, nothing said. txFolderPaths is the
       seam the writers need — see txFileRel. */
    const txFiles = [];
    for (const folder of R.subfoldersUnder('Transactions')) {
      const months = folder.children.filter(f => f instanceof TFile && f.extension === 'md' && /^\d{4}-\d{2}$/.test(f.basename));
      const rel = folder.path.slice(R.basePath().length + 1);
      const depth = rel.split('/').length - 1;          // Transactions/Cheque -> 1
      if (T.txFolderPaths[folder.name] !== undefined) {
        // A shallower folder already claimed this label. Only say so if this
        // one actually holds months — an empty namesake folder costs nothing.
        if (months.length) T.txFoldersIgnored.push(rel);
        continue;
      }
      /* An empty folder at depth 1 is "linked, not imported yet" and MUST be
         recorded — tests/accounts-folder-state.test.cjs holds that, and losing
         it sends a reader to re-link a folder already on disk. Deeper, an empty
         folder cannot be told apart from a pure container like
         Transactions/Closed/, so there a folder earns its label by holding
         months. Depth 1 therefore keeps exactly the semantics it always had,
         and recursion only ever ADDS folders that hold real rows. */
      if (depth > 1 && !months.length) continue;
      T.txFolderPaths[folder.name] = rel;
      T.txFolders.push(folder.name);
      for (const f of months) txFiles.push({ acct: folder, f });
    }
    const txTexts = await Promise.all(txFiles.map(({ f }) => vault.cachedRead(f)));
    txFiles.forEach(({ acct, f }, i) => {
      const month = f.basename;
      const text = txTexts[i];
      const { raw } = parseFrontmatter(text);
      /* ISSUE 69 — a hand-added column (a running Balance) past what this
         schema knows about; parseMdTableWithSeparator, not parseMdTable, since
         the header/separator cells past `known` are what names and aligns it.
         `known` is read off the file's OWN header rather than assumed to be
         the full 7-column schema, because Split is itself conditional
         (serializeTxFile writes it only into a file that has one) — a
         6-column file with a hand-added Balance column also has 7 cells on
         disk, and treating position 6 as Split there would read the reader's
         figure through splitRole and lose it outright. */
      const { header, sep, dataRows, tx } = tableParts(text, SCHEMAS.transactions.columns[0].header);
      const splitCol = SCHEMAS.transactions.columns[6];
      const hasSplitHeader = !!(header && header[6] && header[6].trim().toLowerCase() === splitCol.header.toLowerCase());
      const known = hasSplitHeader ? 7 : 6;
      T.txFiles[`${acct.name}/${month}`] = {
        label: acct.name, month, dirty: false, fmRaw: raw,
        rel: f.path.slice(R.basePath().length + 1),   // ISSUE 97 — the path it was READ from
        /* CONTRACT 1, the loader's half: the prose around the table and the
           file's own separator, which the next write of the month deleted or
           rewrote (L3-02, L3-22). Exactly what each holds: verbatimAroundTable;
           tests/tx-file-lead-trail-sep.test.cjs pins them and the round trip. */
        lead: tx.lead, trail: tx.trail, sep: tx.sep,
        extraCols: extraColsOf(known, header, sep, dataRows),
        /* ISSUE 69 — serializeTxFile decides per save whether a row still
           needs Split at all; when this file ALSO carries an extra column
           that decision must not move it, since the extra sits at position
           `known` regardless of whether a split survives today's edit. */
        splitHeaderPresent: hasSplitHeader,

        /* The Split column was added after these files started being written —
           absent on every row of every file that predates it, which the
           schema's read yields as '' exactly as it reads a blank cell. The
           truncation sweep in tests/table-schema-guards.test.cjs holds that
           property for every column, current and future.

           `c.slice(0, known)`, not the raw row: rowToObject then sees an
           index past `known` as undefined, the same shape a short row has
           always read as, so a six-column file's own extra cell can never be
           misread as Split — attachExtraCells below still gets the REAL `c`. */
        rows: dataRows.map(c => attachExtraCells(rowToObject(SCHEMAS.transactions, c.slice(0, known)), known, c)),
      };
    });

    /* Data/Categorisation Rules.csv, the one CSV this app writes AND reads.
       ADR-0007 · The rules CSV is the household's file, read as they saved it.
       Delimiter sniffed, BOM dropped, every cell through uncsvCell; lines that
       are not rules are kept in S.rulesExtras, and a file that yields no rule
       at all sets S.rulesUnreadable so no rules write can empty it. */
    T.rules = [];
    T.rulesHeader = null;
    T.rulesExtras = [];
    T.rulesLoaded = [];
    T.rulesUnreadable = false;
    const rulesCsv = await R.readFile('Data/Categorisation Rules.csv');
    if (rulesCsv) {
      const rulesText = rulesCsv.charCodeAt(0) === 0xFEFF ? rulesCsv.slice(1) : rulesCsv;
      const rows = parseDelimited(rulesText, sniffDelimiter(rulesText)).map(row => row.map(uncsvCell));
      if (rows.length) T.rulesHeader = rows[0];
      let prev = null;
      for (const row of rows.slice(1)) {
        if (row.length >= 2 && row[0]) {
          prev = { pattern: row[0], category: row[1], extra: row.slice(2) };
          T.rules.push(prev);
        } else {
          T.rulesExtras.push({ prev, cells: row });
        }
      }
      T.rulesLoaded = T.rules.slice();
      if (rows.length > 1 && !T.rules.length) {
        T.rulesUnreadable = true;
        unreadable.push({ rel: 'Data/Categorisation Rules.csv', why: 'table' });
      }
    }

    T.owed = []; T.owedDirty = false;
    const owedTxt = await R.readFile('Owed Money.md');
    // Keep the file's own frontmatter verbatim (tags etc.) for write-back.
    T.owedFm = (owedTxt && parseFrontmatter(owedTxt).raw) || 'kind: owed';
    {
      const t = readFlatTable(SCHEMAS.owed, owedTxt);
      if (lacksTable(owedTxt)) unreadable.push({ rel: 'Owed Money.md', why: 'table' });
      T.owedLead = t.lead; T.owedTrail = t.trail; T.owedExtraCols = t.extraCols;
      T.owed.push(...t.rows);
    }

    T.debts = []; T.debtsDirty = false;
    const debtTxt = await R.readFile('Debts.md');
    T.debtsFm = (debtTxt && parseFrontmatter(debtTxt).raw) || 'kind: debts';
    {
      const t = readFlatTable(SCHEMAS.debts, debtTxt);
      if (lacksTable(debtTxt)) unreadable.push({ rel: 'Debts.md', why: 'table' });
      T.debtsLead = t.lead; T.debtsTrail = t.trail; T.debtsExtraCols = t.extraCols;
      for (const d of t.rows) {
        /* post() — the one fix-up a single cell cannot express (ADR-0003).
           Original is null when absent: a file written before the column
           existed, or a debt added without one. Fall back to the balance so
           the "paid off" bar reads 0% rather than dividing by zero. */
        /* ADR-0007 · A debt's original falls back for arithmetic only. ISSUE 68: originalStated
           lets the writer put the cell back empty. */
        if (d.original === null) { d.original = d.balance; d.originalStated = false; }
        else { d.originalStated = true; }
        T.debts.push(d);
      }
    }

    /* Assets — what the household owns that is not an account. Columns,
       defaults and the strict-parse rules live in table-schema.js (ADR-0003):
       one declaration drives this read and the view's write. */
    T.assets = []; T.assetsDirty = false;
    const assetTxt = await R.readFile('Assets.md');
    T.assetsFm = (assetTxt && parseFrontmatter(assetTxt).raw) || 'kind: assets';
    {
      const t = readFlatTable(SCHEMAS.assets, assetTxt);
      if (lacksTable(assetTxt)) unreadable.push({ rel: 'Assets.md', why: 'table' });
      T.assetsLead = t.lead; T.assetsTrail = t.trail; T.assetsExtraCols = t.extraCols;
      T.assets.push(...t.rows);
    }

    T.services = []; T.servicesDirty = false;
    const svcTxt = await R.readFile('Services.md');
    T.servicesFm = (svcTxt && parseFrontmatter(svcTxt).raw) || 'kind: services';
    {
      const t = readFlatTable(SCHEMAS.services, svcTxt);
      if (lacksTable(svcTxt)) unreadable.push({ rel: 'Services.md', why: 'table' });
      T.servicesLead = t.lead; T.servicesTrail = t.trail; T.servicesExtraCols = t.extraCols;
      T.services.push(...t.rows);
    }
    /* ADR-0007 · Plans: one file per plan, sliced by heading. The section names are
       load-bearing (plan.js writes them). */
    T.plans = {}; T.planDirty = false;
    for (const { file: f, text } of await read(R.mdFilesUnder('Plans'))) {
      const { fm, raw, body } = parseFrontmatter(text);
      // Money columns go through normalizeAmount for the reason the debt
      // balances do: a hand-typed "40 000,00" read as 40 would be written
      // straight back over a figure nobody was editing.
      const amt = v => normalizeAmount(v) ?? 0;
      /* ADR-0007 · Plans and Tax cells keep <key>Raw when unreadable. ISSUE 59/63 —
         table-schema's money()/vocab() contract, applied by hand. */
      const cellMoney = (key, v) => {
        const raw = String(v ?? '').trim();
        const n = normalizeAmount(v);
        return n === null && raw ? { [key]: 0, [`${key}Raw`]: raw } : { [key]: n ?? 0 };
      };
      const cellVocab = (key, v, allowed, fallback) => {
        const raw = String(v ?? '').trim();
        const hit = allowed.find(a => a === raw.toLowerCase());
        return (!raw || hit) ? { [key]: hit || fallback } : { [key]: fallback, [`${key}Raw`]: raw };
      };

      /* ISSUE 67 — the lead paragraph above "## Money in" and anything a
         household added of its own: a `## heading` anywhere in the file, or a
         plain paragraph left after one of these three tables and before the
         next heading. Both survive a save now — see markdown.js's
         extraContent for the rule and plan.js's serializePlan for where each
         piece lands. */
      const plan67 = extraContent(body, ['money in', 'envelopes', 'items'],
        { 'money in': PLAN_TABLES['money in'].first, envelopes: PLAN_TABLES.envelopes.first, items: PLAN_TABLES.items.first });
      /* unescMd, not a bare trim, on every free-text cell: plan.js writes them
         through escMd, and a read that does not reverse it re-escapes the cell
         on every save — the same pair table-schema.js's verbatim() carries.
         Tint is written back verbatim so a hand-picked colour survives, and an
         absent one renders as no wash rather than as the string "". */
      const sources = readSectionTable(body, 'money in', PLAN_TABLES['money in'], c => ({
        name: unescMd(c[0] || ''), kind: unescMd(c[1] || 'Other'), ...cellMoney('amount', c[2]),
        date: unescMd(c[3] || ''), ...cellVocab('status', c[4], ['expected', 'received'], 'received'),
        notes: unescMd(c[5] || ''),
      }));
      const envelopes = readSectionTable(body, 'envelopes', PLAN_TABLES.envelopes, c => ({
        name: unescMd(c[0] || ''), ...cellMoney('amount', c[1]), note: unescMd(c[2] || ''),
        tint: unescMd(c[3] || ''),
      }));
      const items = readSectionTable(body, 'items', PLAN_TABLES.items, c => ({
        name: unescMd(c[0] || ''), envelope: unescMd(c[1] || ''), ...cellMoney('amount', c[2]),
        ...cellMoney('spent', c[3]), ...cellVocab('status', c[4], ['planned', 'part', 'done'], 'planned'),
        category: unescMd(c[5] || ''), notes: unescMd(c[6] || ''),
      }));

      T.plans[f.basename] = {
        /* ADR-0007 · Plans are keyed by basename, not display name. The file is the identity;
           writers derive the path from `file`. */
        file: f.basename,
        rel: f.path.slice(R.basePath().length + 1),   // ISSUE 97 — READ from, never assembled
        name: (fm.plan || '').toString().trim() || f.basename,
        fmRaw: raw,   // verbatim frontmatter, for lossless write-back
        leadRaw: plan67.lead, extras: plan67.extras,
        /* L3-05: prose a household typed between a heading and its table, and
           a column or cell tail past the plugin's own, per table. */
        sectionLeads: plan67.leads,
        extraCols: { sources: sources.extraCols, envelopes: envelopes.extraCols, items: items.extraCols },
        /* L3-12: the titles THIS file's heading may be — what the plugin wrote
           there: the name it was loaded under, and the file's own name. A plan
           renamed since has its heading follow; any other heading is the
           household's (markdown.js ownTitleLine). */
        ownTitles: [(fm.plan || '').toString().trim(), f.basename].filter(Boolean),
        started: (fm.started || '').toString().trim(),
        status: (fm.status || 'active').toString().trim(),
        sources: sources.rows,
        envelopes: envelopes.rows,
        items: items.rows,
      };
    }

    T.tax = {}; T.taxDirty = false;
    /* ADR-0007 · A tax year file is one whose parent is not itself a year.
       ISSUE 97 — Tax/<year>/ is a DOCUMENTS folder (views/tax.js writes
       attachments into it), and the filter tests the basename only, so a
       recursing loader would read Tax/2026/2023.md — a receipt named like a
       year — as a tax year the household never created.

       Read off the PATH rather than f.parent: the path is the same string in
       Obsidian and in the harness, where relying on a host object's property
       would be a divergence waiting to be discovered in production. */
    const taxYearFile = f => /^\d{4}$/.test(f.basename)
      && !/^\d{4}$/.test(f.path.split('/').slice(-2, -1)[0] || '');
    for (const { file: f, text } of await read(R.mdFilesUnder('Tax').filter(taxYearFile))) {
      const { fm, raw, body } = parseFrontmatter(text);
      // The body holds three tables under "## Progress", "## Documents" and
      // "## Figures". parseMdTable reads every table row in the text it's
      // given, so slice the body by heading first and parse each on its own.
      /* ADR-0007 · Tax figures go through normalizeAmount. The one reader every hand-editable
         amount shares; coerce, do not throw. */
      const figAmount = s => normalizeAmount(s) ?? 0;
      /* ADR-0007 · Plans and Tax cells keep <key>Raw when unreadable. ISSUE 59/63, Tax half —
         the same contract as the Plans copy above. */
      const cellMoney = (key, v) => {
        const raw = String(v ?? '').trim();
        const n = normalizeAmount(v);
        return n === null && raw ? { [key]: 0, [`${key}Raw`]: raw } : { [key]: n ?? 0 };
      };
      const cellVocab = (key, v, allowed, fallback) => {
        const raw = String(v ?? '').trim();
        const hit = allowed.find(a => a === raw.toLowerCase());
        return (!raw || hit) ? { [key]: hit || fallback } : { [key]: fallback, [`${key}Raw`]: raw };
      };

      /* ADR-0007 · Assessment figures: normalizeAmount, not a digit-scraper. ISSUE 52:
         "-1 234,56" read as -123456; unreadable keeps its text in <key>Raw. */
      const signedNum = v => {
        if (v === undefined || v === null || String(v).trim() === '') return { value: null, raw: null };
        const n = normalizeAmount(v);
        return n === null ? { value: null, raw: String(v) } : { value: n, raw: null };
      };
      const assessResult = signedNum(fm.assessment_result);
      const assessIncome = signedNum(fm.assessment_income);
      /* ISSUE 67 — same rule as Plans, over this file's own three sections.
         The intro paragraph is locale-derived (loc.authority/yearSpan), so it
         is never frozen from disk — only whatever a household added of their
         own, above it or under one of the tables, survives verbatim. */
      const tax67 = extraContent(body, ['progress', 'documents', 'figures'],
        { progress: TAX_TABLES.progress.first, documents: TAX_TABLES.documents.first, figures: TAX_TABLES.figures.first });
      /* L3-05, as for Plans: blank-first rows kept (a Figures row "code to look
         up" is the one that was also left out of the totals), extra columns and
         cell tails carried. unescMd on `due` and the free text: views/tax.js
         writes them through escMd, and a read that does not reverse it
         re-escaped the cell on every save (`June \| maybe` gained a backslash
         per save) — ISSUE 76's plan.js fix, which never reached this table. */
      const steps = readSectionTable(body, 'progress', TAX_TABLES.progress, c => ({
        step: unescMd(c[0] || ''), ...cellVocab('status', c[1], ['todo', 'busy', 'done', 'n/a'], 'todo'),
        due: unescMd(c[2] || ''), notes: unescMd(c[3] || ''),
      }));
      const docs = readSectionTable(body, 'documents', TAX_TABLES.documents, c => ({
        name: unescMd(c[0] || ''), source: unescMd(c[1] || ''),
        ...cellVocab('status', c[2], ['needed', 'uploaded', 'n/a'], 'needed'),
        file: unescMd(c[3] || ''), notes: unescMd(c[4] || ''),
      }));
      // Absent on every page written before the Figures table existed — an
      // empty list keeps those loading unchanged.
      const figures = readSectionTable(body, 'figures', TAX_TABLES.figures, c => ({
        code: unescMd(c[0] || ''), description: unescMd(c[1] || ''),
        source: unescMd(c[2] || ''), ...cellMoney('amount', c[3]),
      }));
      T.tax[f.basename] = {
        fmRaw: raw,   // verbatim frontmatter, for lossless write-back of unmodeled keys
        rel: f.path.slice(R.basePath().length + 1),   // ISSUE 97 — READ from, never assembled
        leadRaw: tax67.lead, extras: tax67.extras, sectionLeads: tax67.leads,
        extraCols: { steps: steps.extraCols, docs: docs.extraCols, figures: figures.extraCols },
        /* The two frontmatter vocabularies go through cellVocab, the reader
           the tables below already use: case is folded (`Provisional` is a
           provisional taxpayer), and a word outside the vocabulary reads as
           `unknown` with the reader's own text kept in `<key>Raw`, which
           views/tax.js writes back untouched. An exact-match allow-list used to
           turn both into `unknown` — on screen, where za then counted a
           provisional taxpayer down to the standard deadline, and on disk at
           the next save of the page (2026-10-07 round-trip audit). */
        ...cellVocab('taxpayer_type', fm.taxpayer_type, ['provisional', 'standard', 'unknown'], 'unknown'),
        ...cellVocab('assessment', fm.assessment, ['auto-assessed', 'submit-requested', 'assessed', 'unknown'], 'unknown'),
        deadline_standard: fm.deadline_standard || '',
        deadline_provisional: fm.deadline_provisional || '',
        // Assessment outcome — only meaningful once `assessment` is 'assessed'.
        // Result is signed the way tax authorities print it: negative = refund.
        assessment_date: fm.assessment_date || '',
        assessment_ref: fm.assessment_ref || '',
        assessment_result: assessResult.value,
        assessment_resultRaw: assessResult.raw,
        assessment_income: assessIncome.value,
        assessment_incomeRaw: assessIncome.raw,
        steps: steps.rows,
        docs: docs.rows,
        figures: figures.rows,
      };
    }

    // Prior-year certificates often land in Tax/<year>/ before anyone creates
    // the matching page, leaving the folder invisible to the view. Surface the
    // orphans so the Tax page can offer to seed a page for them.
    T.taxOrphanYears = R.subfoldersIn('Tax')
      .map(f => f.name).filter(n => /^\d{4}$/.test(n) && !T.tax[n]).sort();

    await loadNotes(T, R);
    await loadReceipts(T, R);

    /* Commit — only if this load's folder is still the open book's, and no
       load that started after it has committed already. Synchronous from here
       to the end, so no render, write or second load can see half of it. */
    if (folder !== openFolder() || (committed && mySeq < committed.seq)) return false;
    Object.assign(S, T);
    committed = Object.freeze({ folder, seq: mySeq, staleMark: began });
    setLanguage(language);
    /* The three selections that survive a reload — the open plan, the open
       tax year, the period on screen — are the reader's, kept when the
       freshly committed state can still address them. Decided against S, now
       that it holds this load's state; currentPeriod() and periodKeyValid()
       read S.settings. */
    // Keep the open plan if it still exists; otherwise fall to the first by
    // name, or null — which is what renders the empty state.
    if (!S.planName || !S.plans[S.planName]) S.planName = Object.keys(S.plans).sort()[0] || null;
    if (!S.taxYear || !S.tax[S.taxYear]) S.taxYear = Object.keys(S.tax).sort().pop() || null;
    // The remembered period must still be one the current settings can address.
    // Changing the period length reaches this line via main.js's reload, and the
    // old name would otherwise survive it in a shape nothing can read.
    if (!S.period || !periodKeyValid(S.period)) S.period = currentPeriod();
    return true;
  }

  /* The readers a standalone re-read of Notes/ or Receipts/ uses (views/notes.js
     and views/food.js call these after their own writes): the book the state
     in memory was read from, so a note list re-read in the window between a
     switch and its reload is the same book's as everything beside it. */
  const committedReaders = () => (committed ? ctx.readersAt(committed.folder) : ctx);

  /* Receipts/ — one file per till slip, read the way Notes are: under, not
     in (a household files them by month), in parallel, and a slip that
     cannot be read is skipped rather than taking the budget down. Nothing
     here feeds a budget total: the bank line is the figure, the receipt is
     its itemised account. Food Items.md lives in the same folder and is the
     one file under it that is not a receipt. Exposed on ctx because
     views/food.js re-reads after every write. */
  /* `into`/`R`: a full load passes its own state-in-progress and pinned
     readers; a standalone call (views/food.js) fills S from the committed book. */
  async function loadReceipts(into = S, R = committedReaders()) {
    const files = R.mdFilesUnder(RECEIPTS_DIR);
    const texts = await Promise.all(files.map(f => vault.cachedRead(f).catch(() => null)));
    const base = R.basePath();
    const receipts = [];
    into.foodItems = new Map();
    files.forEach((f, i) => {
      if (texts[i] == null) return;
      const rel = f.path.slice(base.length + 1);
      if (rel === FOOD_ITEMS_FILE) {
        into.foodItems = parseFoodItems(texts[i]);
        return;
      }
      const fm = parseFrontmatter(texts[i]).fm;
      if (String(fm.kind || '').trim().toLowerCase() !== 'receipt') return;
      receipts.push(parseReceiptFile(texts[i], rel));
    });
    receipts.sort((a, b) => b.date.localeCompare(a.date) || String(b.time).localeCompare(String(a.time)));
    into.receipts = receipts;
  }

  /* ADR-0007 · A note that cannot be read is skipped. Per-file catch, so one bad note cannot
     take the budget down; exposed on ctx because views/notes.js re-reads after every write.
     ADR-0007 · Notes read in parallel. 172ms of a 233ms load at thirty notes when sequential. */
  async function loadNotes(into = S, R = committedReaders()) {
    /* Under, not in: a user who files a year of notes into Notes/2026/ has
       tidied a folder of markdown, not deleted it, and the page must not go
       blank because of it. See mdFilesUnder in io.js. */
    const files = R.mdFilesUnder(NOTES_DIR);
    const texts = await Promise.all(files.map(f => vault.cachedRead(f).catch(() => null)));
    const base = R.basePath();
    const notes = [];
    files.forEach((f, i) => {
      if (texts[i] == null) return;
      /* Derived from the file's OWN path rather than assembled from the folder
         and the name — the note may be several levels down, and every writer
         (readFile, writeFile, fileAt) takes a budget-folder-relative path. */
      const rel = f.path.slice(base.length + 1);
      notes.push({ rel, name: f.name, ...parseNote(texts[i], rel) });
    });
    into.notes = sortNotes(notes);
  }

  /* ADR-0007 · An existing transaction folder wins verbatim. Only a never-written label
     is sanitised into a new segment. */
  /* ADR-0007 · txSegment is case-folded. macOS, iOS and Windows resolve cheque/ and
     Cheque/ to one directory. */
  function txSegment(label) {
    const want = safeSeg(label);
    const key = want.toLowerCase();
    for (const f of Object.values(S.txFiles)) {
      if (f.label === label || safeSeg(f.label).toLowerCase() === key) return f.label;
    }
    return want;
  }

  /* ADR-0007 · A transaction month is addressed at the folder it was read from.
     ISSUE 97 — five writers assembled the path by hand, which forks an account
     the moment its folder is not flat. Keyed by LABEL, not by file: a brand-new
     month has none to have been read from. */
  function txFileRel(label, month) {
    const folder = (S.txFolderPaths || {})[label] || `Transactions/${label}`;
    return `${folder}/${month}.md`;
  }

  ctx.provide({ loadVault, loadNotes, loadReceipts, txSegment, txFileRel, loadedBook, stateReplaced });
};
