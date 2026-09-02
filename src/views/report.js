'use strict';
/* Report — one page that turns figures several OTHER pages already computed
   into a Markdown note and/or a JSON file, for an advisor, an AI chat, or a
   tool that would rather parse than read — none of which are this app. No
   dialog: the options live on the page (period, detail level, format,
   destination folder), a "Create report" button writes whichever file(s) are
   selected, and the result panel that appears offers three ways to get them
   elsewhere — Open (from where Obsidian's own share sheet / desktop Export
   to PDF takes over, Markdown only), Copy report (the Markdown, paste-ready
   for a chat or an email) and Copy JSON (when a JSON file was generated). A
   plugin cannot invoke the native share sheet itself; these are the honest
   affordances, not a substitute for a "Share" button this API has no way to
   offer.

   ONE `data` OBJECT PER REPORT, BUILT ONCE. createReport() below assembles it
   exactly once per click and hands the SAME object to both
   financialReportMarkdown() and financialReportJson() (src/report.js) —
   never two passes over the vault for two documents that are supposed to
   agree. See that module's own header for why this discipline is the whole
   point: "two figures derived by different rules" is this codebase's
   most-repeated bug shape, and a Markdown report that disagreed with its own
   JSON sibling would be exactly that shape wearing a new hat.

   THIS FILE OWNS NO ARITHMETIC. Every number in `data` comes from a ctx
   helper or a math module some other screen already reads — periodSummary/
   budgetTotals (period.js), budgetVsActualRows/categorySpendRows
   (views/dashboard.js — the Budget-vs-Actual table and the "Where it went"
   donut, published on ctx for exactly this reason), worth() (worth.js,
   the Dashboard's own net-worth tiles), totalReturn()/poolCatType()/
   chartable() (savings-math.js, the Savings page's own growth tile),
   monthlyInterest() (debt-math.js, the Debt page's own KPI strip) and
   healthSnapshot() (health-data.js, shared by the Dashboard's health card
   and the Score page). A report that disagreed with the screen it was
   generated from would be the same repeated bug shape a third way, and the
   one thing a report exists to be trusted is the same lie a page already
   tells.

   Two ranges are genuinely different questions, both answered honestly.
   Income, spend, spend-by-category and Budget-vs-Actual are scoped to
   whichever period selection the reader picked — they are about a WINDOW of
   time. Savings growth, debt, net worth and the health score are not paged
   by period on their OWN pages either (the Dashboard's own health card
   comment: "ANCHORED AT THE CURRENT PERIOD, whatever period is on screen")
   — they are a household's CURRENT position, so the report states them
   as-of today regardless of which period is selected, and says so in the
   document rather than leaving the two kinds of figure to look like one. */

const { el } = require('../dom');
const { rangePills } = require('../chart');
/* otherCurrencyNet: worth() has returned `otherCurrencies` — the foreign
   assets and foreign debts it filtered out — since ADR-0004, and this page
   disclosed the ACCOUNTS half only (splitByCurrency's `others`). So a euro
   flat and a euro bond left the Net Worth section with nothing said. See
   that function's own header in src/worth.js. */
const { worth, otherCurrencyNet } = require('../worth');
const { symbolOf, splitByCurrency, isForeign } = require('../currency');
const { poolCatType, growthTotals } = require('../savings-math');
const { monthlyInterest } = require('../debt-math');
/* The canonical monthly-interest aggregate. This section used to sum its
   own rows and printed R0,00 into a document that leaves the app for a
   household whose Rate column was blank — see health-math.js's own header
   for the reproduction. monthlyInterest above is still imported for the
   PER-ROW figure in the table, which is a different question. */
const { debtInterestCoverage } = require('../health-math');
const { todayIso, nowLocalMinute } = require('../dates');
const { typeOrder, typeRank } = require('../groups');
const {
  REPORT_DIR, reportPaths, mergeCategoryRows, managedFolderMatch,
  financialReportMarkdown, financialReportJson, copyBody,
} = require('../report');
/* Namespace import: see views/dashboard.js's own comment on why every view
   in this app imports i18n the same way regardless of whether `t` happens
   to be a local name in this particular file. */
const i18n = require('../i18n');

module.exports = function registerReport(ctx) {
  /* fileAtVaultPath/readVaultFile/folderAtVaultPath — NOT fileAt/readFile/
     folderAt. Reports/ is a vault-root sibling of the budget folder (see
     src/report.js's own header), and fileAt/readFile/folderAt all resolve
     through relPath(), which PREFIXES the budget folder unconditionally.
     writeVaultFile already writes at vault-root (guardedVaultPath, not
     relPath); reading the same file back through the budget-relative door
     is the exact bug that shipped in 1.28.0 — the write landed at the real
     `Reports/…`, the read looked for `<budget folder>/Reports/…`, found
     nothing, and silently cleared the `result` the write had just set. Every
     lookup below stays on the vault-root side of that line. */
  const {
    S, $, app, plugin, money, toast,
    fileAtVaultPath, folderAtVaultPath, readVaultFile, writeVaultFile, ensureVaultFolder,
    currentPeriod, periodRange, periodMonthName, dayLabel, shiftPeriod,
    periodsForMonths, earliestDataMonth, periodSummary, budgetTotals, catKnown,
    accountIndex, healthSnapshot, txInPeriod,
    budgetVsActualRows, categorySpendRows,
  } = ctx;

  /* -------------------------------- state --------------------------------
     Closures, not S — a report page's own picks are a scratchpad the same
     way views/loans.js's home/car inputs are (see that file's header): they
     answer "what would this report say", not household data, so nothing
     here needs saving, reloading or a dirty flag. `folder` stays null until
     the reader actually types one, so the preview keeps following
     plugin.settings.reportFolder (or the REPORT_DIR default) the way
     views/transactions.js's own export folder field does. `formats` is a
     Set rather than a single value — Markdown and JSON are independent
     yes/no choices, not one exclusive pick, and at least one must always
     stay on (toggleFormat refuses to empty it). `result` tracks each
     format's OWN file — either just written, or found already on disk (see
     refreshResult()) — and is rebuilt the moment the selection changes to a
     path that has no file behind it yet. */
  let period = 'current';   // 'current' | '3m' | '12m'
  let detail = 'summary';   // 'summary' | 'detail'
  let formats = new Set(['md']);   // subset of {'md', 'json'}, never empty
  let folder = null;
  let result = null;   // { md: {path, text|null} | null, json: {path, text|null} | null, generatedAt }

  /* C1 in the 2026-08-29 audit: 'current' used to anchor on currentPeriod()
     (the wall clock) while '3m'/'12m' anchored on S.period (the header pill
     the reader can move, and which switchView() below un-hides everywhere
     EXCEPT the Report page — see controller.js's own comment on that line).
     On a vault holding May/June/July, today 2026-08-29, with S.period parked
     on '2026-05': "Current month" produced August, "Last 3 months" produced
     a SINGLE-month report for May — two pills that don't even describe
     overlapping windows, and June/July silently dropped off a label that
     said "last 3 months".

     All three branches now anchor on currentPeriod() — the wall clock, which
     is what "Current month" / "Last 3 months" / "Last 12 months" actually
     promise in their own labels (report.period.current/3m/12m.desc). This
     duplicates trendPeriods()'s own walk (periodsFromAnchor below) rather
     than reaching into trend-math.js to change what it anchors on:
     trendPeriods() is the Dashboard trend's own contract, read there off
     S.period on purpose (chartTrendRange overlays the period ON SCREEN), and
     a second caller wanting a different anchor is not a reason to loosen
     that contract for the one that does. */
  function selectedPeriods() {
    const anchor = currentPeriod();
    if (period === 'current') return [anchor];
    const months = period === '3m' ? 3 : 12;
    return periodsFromAnchor(anchor, periodsForMonths(months));
  }

  /* Same walk trendPeriods() (trend-math.js) performs — oldest first, `want`
     of them at most, stopping at the earliest month the vault actually has
     data for (a vault younger than the chosen span reports on what it
     actually has rather than inventing zero-filled history) — but anchored
     on the `anchor` the caller passes instead of S.period. See
     selectedPeriods()'s own comment for why this is a deliberate, small
     duplication rather than a change to trendPeriods()'s contract.

     M2, 2026-08-29 audit — this had trendPeriods()'s OWN bug, carried over
     verbatim by the duplication above: `earliest && i > 0` never breaks on a
     genuinely empty vault (earliestDataMonth() returns null, so the `earliest
     &&` guard was always false), so every `want` period got pushed — twelve
     invented zero-months on the very first report a brand-new household
     generated. Fixed the same way trend-math.js's own copy was: no data at
     all means no floor to test against, which is the same as "before
     whatever floor there is" — `!earliest` breaks here exactly where a real
     earliest date immediately would. */
  function periodsFromAnchor(anchor, want) {
    const earliest = earliestDataMonth();
    const out = [];
    for (let i = 0; i < want; i++) {
      const p = shiftPeriod(anchor, -i);
      if (i > 0 && (!earliest || periodRange(p).end.slice(0, 7) < earliest)) break;
      out.push(p);
    }
    return out.reverse();
  }

  function periodLabelFor(periods) {
    return periods.length === 1
      ? periodMonthName(periods[0])
      : `${periodMonthName(periods[0])} ${i18n.t('report.to')} ${periodMonthName(periods[periods.length - 1])}`;
  }

  /* L2, 2026-08-29 audit (Phase 4b) — the ON-DISK PATH, unlike
     periodLabelFor()'s document heading just above, must stay the SAME no
     matter what Settings.md's `language` says. Before this fix, BOTH read
     periodLabelFor(): switching the interface language between two reports
     of the exact SAME period selection changed reportPaths()' `label`
     input, which changed the path — silently breaking "regenerating
     overwrites the earlier file" (reportPaths()'s own comment, src/report.js)
     and leaving an orphan in Reports/ the "Already exists" note (below,
     #reportExistsNote) never mentions, because it only ever checks the ONE
     path the CURRENT language would produce.

     The fix is a literal, untranslated "to" — not i18n.t('report.to'), on
     purpose, and not a second look at periodMonthName() either: those month
     names are already English regardless of interface language
     (src/period.js's own hard-coded MONTH_FULL, an existing, app-wide fact
     this file did not create and is not the one to fix here — see this
     comment's own audit note), so a multi-period filename was already not
     FULLY translated before this change; only the one further word this
     file itself chose needed to stop moving under a reader's feet.

     Existing reports written before this fix keep their OLD path (with
     whatever language's word for "to" was active that day) — this is not
     migrated, on purpose: a report is a point-in-time export, trivially
     regenerable from the same period selection, and it is exactly the fix
     the audit says makes it fine to leave alone. */
  function filenameLabel(periods) {
    return periods.length === 1
      ? periodMonthName(periods[0])
      : `${periodMonthName(periods[0])} to ${periodMonthName(periods[periods.length - 1])}`;
  }

  /* Same shape periodTitle() (period.js) builds for a single period — reused
     by hand rather than through that function because this spans several
     periods at once, which periodTitle was never asked to model. */
  function rangeNoteFor(periods) {
    const first = periodRange(periods[0]).start;
    const last = periodRange(periods[periods.length - 1]).end;
    const sy = first.slice(0, 4), ey = last.slice(0, 4);
    return sy === ey ? `${dayLabel(first)} – ${dayLabel(last)}, ${ey}` : `${dayLabel(first)}, ${sy} – ${dayLabel(last)}, ${ey}`;
  }

  function currentPaths() {
    const periods = selectedPeriods();
    return reportPaths(filenameLabel(periods), folder ?? (plugin.settings.reportFolder || REPORT_DIR));
  }

  /* A report already sitting on disk for the exact selection on screen is
     shown, not hidden behind a button that looks like it has nothing to do
     yet — the brief that shaped this page is explicit that pretending
     nothing exists is the wrong default. Checked per format independently
     (a vault can hold a Markdown report and no JSON one, or the reverse),
     and each entry keeps its in-memory `text` across a call that finds the
     SAME path again — so a report just created by this session stays
     copyable without a round trip back to disk — but resets it the moment
     the path changes underneath it (a period/detail/folder/format edit). */
  function refreshResult() {
    const { mdPath, jsonPath } = currentPaths();
    const keep = (key, path) => {
      const prior = result && result[key];
      return (prior && prior.path === path) ? prior : null;
    };
    const mdFile = fileAtVaultPath(mdPath);
    const jsonFile = fileAtVaultPath(jsonPath);
    const md = mdFile ? (keep('md', mdPath) || { path: mdPath, text: null }) : null;
    const json = jsonFile ? (keep('json', jsonPath) || { path: jsonPath, text: null }) : null;
    result = (md || json) ? { md, json, generatedAt: result && result.generatedAt } : null;
  }

  /* ------------------------------- render --------------------------------
     The FOLDER field is the one static shell.js control (a text input) — see
     views/transactions.js's own #txSearch for why: a control that is never
     torn down cannot lose focus to its own rebuild, and typing fires on
     every keystroke where a click does not. Period, detail and format are
     all pill GROUPS instead of selects/checkboxes specifically so they can
     be rebuilt freely — same reasoning views/dashboard.js's own trend-range
     pills rely on. Period/detail reuse chart.js's rangePills (one active
     choice); format is hand-built because it is a MULTI-select — rangePills
     enforces exactly one active pill, which is the wrong shape for "which
     file(s) do you want", so this uses the identical `chart-range`/
     `chart-range-btn` classes without borrowing that single-select
     contract. */
  function renderReport() {
    refreshResult();

    $('#reportSubNote').textContent = i18n.t('report.pageSub');
    $('#reportOptionsTitle').textContent = i18n.t('report.options.title');
    $('#reportPeriodLabel').textContent = i18n.t('report.field.period');
    $('#reportDetailLabel').textContent = i18n.t('report.field.detail');
    $('#reportFormatLabel').textContent = i18n.t('report.field.format');
    $('#reportFolderLabel').textContent = i18n.t('report.field.folder');
    $('#reportCopyNowLabel').textContent = i18n.t('report.copyNow');
    $('#reportResultTitle').textContent = i18n.t('report.result.title');
    $('#reportOpenLabel').textContent = i18n.t('report.open');
    $('#reportRevealLabel').textContent = i18n.t('report.reveal');
    $('#reportCopyLabel').textContent = i18n.t('report.copy');
    $('#reportCopyJsonLabel').textContent = i18n.t('report.copyJson');
    $('#reportShareHint').textContent = i18n.t('report.shareHint');

    const periodOpts = [
      { key: 'current', label: i18n.t('report.period.current'), desc: i18n.t('report.period.current.desc') },
      { key: '3m', label: i18n.t('report.period.3m'), desc: i18n.t('report.period.3m.desc') },
      { key: '12m', label: i18n.t('report.period.12m'), desc: i18n.t('report.period.12m.desc') },
    ];
    const periodPills = $('#reportPeriodPills'); periodPills.empty();
    periodPills.append(rangePills({
      ranges: periodOpts.map(o => ({ key: o.key, label: o.label })),
      value: period, label: i18n.t('report.period.pillsAria'),
      onPick: setPeriod,
    }));
    $('#reportPeriodDesc').textContent = (periodOpts.find(o => o.key === period) || {}).desc || '';

    const detailOpts = [
      { key: 'summary', label: i18n.t('report.detail.summary'), desc: i18n.t('report.detail.summary.desc') },
      { key: 'detail', label: i18n.t('report.detail.detail'), desc: i18n.t('report.detail.detail.desc') },
    ];
    const detailPills = $('#reportDetailPills'); detailPills.empty();
    detailPills.append(rangePills({
      ranges: detailOpts.map(o => ({ key: o.key, label: o.label })),
      value: detail, label: i18n.t('report.detail.pillsAria'),
      onPick: setDetail,
    }));
    $('#reportDetailDesc').textContent = (detailOpts.find(o => o.key === detail) || {}).desc || '';

    const formatOpts = [
      { key: 'md', label: i18n.t('report.format.md'), desc: i18n.t('report.format.md.desc') },
      { key: 'json', label: i18n.t('report.format.json'), desc: i18n.t('report.format.json.desc') },
    ];
    const formatPills = $('#reportFormatPills'); formatPills.empty();
    const formatRow = el('div', { class: 'chart-range', role: 'group', 'aria-label': i18n.t('report.format.pillsAria') });
    for (const o of formatOpts) {
      const active = formats.has(o.key);
      formatRow.append(el('button', {
        type: 'button', class: `chart-range-btn${active ? ' is-active' : ''}`,
        'aria-pressed': active ? 'true' : 'false',
        onclick: () => toggleFormat(o.key),
      }, o.label));
    }
    formatPills.append(formatRow);
    $('#reportFormatDesc').textContent = formatOpts.filter(o => formats.has(o.key)).map(o => o.desc).join(' ');

    $('#reportFolder').value = folder ?? (plugin.settings.reportFolder || REPORT_DIR);

    const { mdPath, jsonPath, dir } = currentPaths();
    const previewPaths = [formats.has('md') ? mdPath : null, formats.has('json') ? jsonPath : null].filter(Boolean);
    $('#reportPreview').textContent = i18n.t('report.preview', { path: previewPaths.join(' · ') });

    /* M1, 2026-08-29 audit — the folder field is free text with no relation
       to load.js's own allow-list (Categories/, Accounts/, Budgets/, Plans/,
       Tax/, Transactions/, Notes/ — see src/report.js's own header). Point it
       at one of those and the generated .md is parsed back in as ordinary
       vault data on the next load — silently, and specifically as the
       category/account/plan the reader never meant to create. REFUSED, not
       warned-and-allowed: the failure mode is silent corruption of the
       household's own category list, not merely an untidy file, and told
       BEFORE the click via the SAME description line the folder field
       already carries (`#reportFolderDesc`, populated from here per the
       existing `#reportExistsNote` pattern on this page) rather than a new
       static element. createReport() below refuses the write a second time,
       independently — this line can be bypassed by editing state directly in
       a test harness; the write-time refusal cannot. */
    const managedConflict = managedFolderMatch(dir, plugin.settings.budgetFolder);
    $('#reportFolderDesc').textContent = managedConflict
      ? i18n.t('report.field.folderManaged', { folder: managedConflict })
      : i18n.t('report.field.folderDesc');
    $('#reportFolderDesc').classList.toggle('text-danger', !!managedConflict);

    const existing = [
      (result && result.md) ? i18n.t('report.format.md') : null,
      (result && result.json) ? i18n.t('report.format.json') : null,
    ].filter(Boolean);
    $('#reportExistsNote').textContent = existing.length ? i18n.t('report.exists', { formats: existing.join(', ') }) : '';
    $('#reportCreateLabel').textContent = i18n.t(existing.length ? 'report.recreate' : 'report.create');
    $('#reportCreate').disabled = !!managedConflict;

    /* What the note will actually contain — a straight list of the sections
       src/report.js's financialReportMarkdown()/financialReportJson() write,
       so a reader can see the shape before spending a write on it. The
       transaction-detail line only appears in detail mode, the one section
       that is genuinely optional (every other section is always assembled —
       see this file's own header on why savings/debt/net worth/health are
       always "as of today" rather than conditional on the period picked
       here). */
    const containsList = $('#reportContains'); containsList.empty();
    $('#reportContainsLabel').textContent = i18n.t('report.contains.title');
    const bullets = [
      i18n.t('report.contains.incomeSpend'),
      i18n.t('report.contains.category'),
      i18n.t('report.contains.budget'),
      i18n.t('report.contains.savings'),
      i18n.t('report.contains.debt'),
      i18n.t('report.contains.netWorth'),
      i18n.t('report.contains.health'),
      ...(detail === 'detail' ? [i18n.t('report.contains.transactions')] : []),
    ];
    for (const b of bullets) containsList.append(el('li', {}, b));

    /* P2, 2026-08-29 audit — the same not-financial-advice line the
       generated document carries above every section (report.disclaimer,
       src/report.js), said here too so a reader sees it BEFORE spending a
       write on the file, not only after opening what came out. */
    $('#reportDisclaimer').textContent = i18n.t('report.disclaimer');

    const card = $('#reportResultCard');
    if (result) {
      card.classList.remove('hidden');
      $('#reportResultSub').textContent = [result.md && result.md.path, result.json && result.json.path].filter(Boolean).join(' · ');
      $('#reportResultNote').textContent = result.generatedAt
        ? i18n.t('report.result.generated', { date: result.generatedAt })
        : i18n.t('report.result.found');
      $('#reportOpen').classList.toggle('hidden', !result.md);
      // Always available whenever the panel is — reveal falls back to
      // whichever of md/json exists, or the folder itself, on its own.
      $('#reportReveal').classList.remove('hidden');
      $('#reportCopy').classList.toggle('hidden', !result.md);
      $('#reportCopyJson').classList.toggle('hidden', !result.json);
    } else {
      card.classList.add('hidden');
    }
  }

  /* ----------------------------- assembly ---------------------------------
     Every function below reaches into ctx or a math module for its figures;
     none of them sum a transaction or a balance on their own. */

  /* Savings & investment growth, as of today — growthTotals() itself now
     lives in savings-math.js (2026-08-29 audit, M4), called here with the
     SAME `entries` shape views/savings.js's own growthTile() builds, so this
     section can never disagree with that page's own tile about what
     "growth" or "rate of growth" mean — see growthTotals' own header for
     why `negCapital` (a drawn-down account, excluded from the rate but not
     from the plain growth total) used to be computed here a SECOND time and
     silently dropped that field, the exact "two figures derived by
     different rules" shape this codebase keeps repeating. */
  function savingsSummary() {
    const poolType = name => poolCatType(S.categories, name);
    const typeIs = (a, t) => String((a && a.type) || '').trim().toLowerCase() === t;
    const pool = S.accounts.filter(a => typeIs(a, 'savings') || typeIs(a, 'investment'));
    const idx = accountIndex();
    const entries = pool.map(a => ({ account: a, rows: (idx.get(a) || {}).rows || [] }));
    /* HOME-CURRENCY ENTRIES ONLY — the same predicate and the same name
       views/savings.js's growthTile() uses, so one grep finds both call
       sites and neither can quietly stop matching the other.

       That file's own comment says the narrowing was put at the CALL SITE
       rather than inside growthTotals precisely because "that function is
       shared with src/report.js's savings section, and it has no business
       learning about currencies when what it actually needs is a homogeneous
       pool". Only one of the two call sites ever did the narrowing. So on a
       mixed pool this section printed "Total growth R 5900.00 / +53.2%"
       while the Savings page printed "R 1000.00 / +9.1%" for the same
       household on the same day — and the report is the copy that gets
       forwarded to somebody who cannot open the app and see the other one.
       growthTotals sums `growth` and `capitalIn` and the caller divides one
       by the other; across two currencies that is not an overstated rate but
       a percentage of a quantity that does not exist. */
    const homeEntry = e => !isForeign(e.account, S.settings.currency);
    const foreignEntries = entries.filter(e => !homeEntry(e));
    return {
      ...growthTotals(entries.filter(homeEntry), poolType, { today: todayIso() }),
      /* Named, never silently dropped — currency.js's own header is explicit
         that this app does not exclude in silence, and an account left out
         of a growth figure is an exclusion however good the reason. */
      foreign: {
        count: foreignEntries.length,
        symbols: [...new Set(foreignEntries.map(e => symbolOf(e.account, S.settings.currency)))],
      },
    };
  }

  /* Debt, as of today — worth.js's own activeDebts() (via w.active) is the
     SAME filter the Dashboard's net-worth tile and health-data.js's
     debtInterestMonthly() both read, so "how many debts" cannot disagree
     between this section and the net-worth one below it. `perMonth` mirrors
     views/debts.js's own committed() one-liner — payment plus any extra —
     rather than importing a closure that file does not export. */
  function debtsSummary(w) {
    /* ISSUE 30's rule, which this section was the last surface not to apply.
       `w.active` is activeDebts() — a STATUS filter ("not paid off"), with no
       currency filter in it at all — so every figure below used to add a euro
       bond into a rand total, print its balance in the per-debt table as
       though R100 000 were owed, and sum its interest with the cards'.
       views/debts.js has narrowed its own page since ADR-0004 landed
       (`activeAll().filter(d => !isForeign(...))`), and worth.js narrows the
       same list eight lines into its own body — which is why THIS document's
       Net Worth section already excluded that bond from `Owed` while the
       section above it included it. One report, two answers, one debt.

       `count` stays the FULL tracked list, exactly as the Debt page's own
       tile does ("N active · M tracked"): a foreign debt is still tracked,
       still listed on its page, still real. It is only held out of arithmetic
       that cannot span currencies. */
    const home = w.active.filter(d => !isForeign(d, S.settings.currency));
    const away = w.active.filter(d => isForeign(d, S.settings.currency));
    const rows = home.map(d => ({ name: d.name, balance: d.balance || 0, rate: d.rate || 0, interest: monthlyInterest(d.balance, d.rate) }));
    /* Per SYMBOL, not a bare count — the same shape worth.js's own
       foreignTotals() returns and the same shape the Net Worth disclosure
       below reads, so src/report.js prints ONE sentence for both rather than
       two differently-worded caveats a reader has to decide are the same
       statement. The count travels too, for the JSON sibling. */
    const others = new Map();
    for (const d of away) {
      const sym = symbolOf(d, S.settings.currency);
      others.set(sym, (others.get(sym) || 0) + Math.max(0, d.balance || 0));
    }
    /* The section total comes from health-math.js's shared rule, NOT from
       summing `rows` — and those two are not the same figure when a Rate
       cell is blank. `rows.reduce` reported a measured zero, the same claim
       the Debt page's tile was making and the opposite of what the score
       said about the identical ledger. The cover object's own active slice
       is activeDebts narrowed by isForeign, which is exactly `home` above,
       so the count in the disclosure and the debts in the table describe one
       book. `coverage` travels beside the figure the way `foreign` already
       does: src/report.js states it as prose, the JSON sibling as data, and
       neither re-derives it. */
    const cover = debtInterestCoverage(S.debts, S.settings.currency);
    return {
      count: S.debts.length,
      active: home.length,
      total: rows.reduce((t, r) => t + r.balance, 0),
      perMonth: home.reduce((t, d) => t + (d.payment || 0) + (d.extra || 0), 0),
      interest: cover.monthly,
      coverage: { shown: cover.shown, total: cover.total, missing: cover.missing },
      rows,
      foreign: {
        count: away.length,
        others: [...others].map(([sym, v]) => [sym, (Math.round(v * 100) / 100) || 0]),
      },
    };
  }

  /* Financial health, as of today — healthSnapshot() is the one function the
     Dashboard's health card and the Score page both call (health-data.js's
     own header explains why two callers assembling it separately is exactly
     how it drifted before); this only reshapes its return into the report's
     own field names and drops the section when snap.empty says there is
     nothing honest to show yet, the same gate the Dashboard card uses. */
  function healthSummary() {
    const snap = healthSnapshot();
    if (snap.empty) return null;
    const H = snap.metrics;
    return {
      score: H.score ? H.score.value : null,
      months: H.months,
      target: snap.target,
      savingsRatePct: H.savingsRate !== null ? H.savingsRate * 100 : null,
      interestSharePct: H.interestShare !== null ? H.interestShare * 100 : null,
    };
  }

  /* The one place `data` is assembled — see this file's header for why it is
     built exactly ONCE per click and handed unchanged to both serialisers. */
  function buildReportData() {
    const periods = selectedPeriods();
    let income = 0, spend = 0, net = 0, budgetIncome = 0, budgetSpend = 0;
    /* C2 in the 2026-08-29 audit — the exact three-line gap
       views/dashboard.js's own donut discloses beside itself
       (dashboard.js:1717-1719, "what this donut does NOT show"), run once
       per period and summed the same additive way mergeCategoryRows already
       sums budget/actual/amount below: the SAME rule per period, never a
       second guess at what it means. `spendRows` is kept per period so
       spendByCategory's own merge (below) does not call categorySpendRows()
       a second time for figures already in hand. */
    let uncat = 0, netted = 0;
    const spendRowsByPeriod = [];
    /* periodSummary() returns `foreign` WITH the figures rather than beside
       them, and period.js's own comment says every tile, table, chart and
       aria-label built from that object is expected to say something when
       `foreign.count` is non-zero. views/dashboard.js's hero does
       (dash.foreignExcluded). This page read the same object, summed the
       five figures it carries and printed them with no caveat at all — in
       the one document that gets forwarded to a reader who cannot open the
       app and check.

       LABELS unioned rather than counts summed: the same foreign account
       appears in every period of a 12-month selection, and adding its count
       twelve times would report twelve accounts. Symbols keep first-met
       order, the same stability rule currenciesIn() and splitByCurrency()
       already follow so two documents about one household list them alike. */
    const foreignLabels = new Set();
    const foreignSymbols = [];
    for (const p of periods) {
      const sum = periodSummary(p);
      income += sum.income; spend += sum.spend; net += sum.net;
      for (const l of (sum.foreign && sum.foreign.labels) || []) foreignLabels.add(l);
      for (const sym of (sum.foreign && sum.foreign.symbols) || []) {
        if (!foreignSymbols.includes(sym)) foreignSymbols.push(sym);
      }
      const bt = budgetTotals(p);
      budgetIncome += bt.income; budgetSpend += bt.spend;

      const spendRows = categorySpendRows(p);
      spendRowsByPeriod.push(spendRows);
      const total = spendRows.reduce((t, r) => t + r.amount, 0);
      const notShown = Math.max(0, sum.spend - total);
      const uncatHere = Math.min(sum.uncatSpend || 0, notShown);
      uncat += uncatHere;
      netted += notShown - uncatHere;
    }
    /* H1 in the audit — typeRank order, same as renderBudgetTable's own sort
       (views/dashboard.js), off the SAME S.settings.groups this vault's
       Budget page reads; a plain alphabetical re-sort here used to throw
       that grouping away, which is what let an income row's "Remaining"
       read exactly like an overspend and a transfer row read like a
       category nothing was spent on — the Type column (src/report.js's
       budgetTable) needs the grouping to actually mean something. */
    const order = typeOrder(S.settings.groups);
    /* `orphaned` — R5, 2026-08-29 audit, the same catKnown() predicate
       spendByCategory's own merge already applies below. A category renamed
       partway through the selection leaves its OLD name answering to no
       current Categories/ file (the rename moved the file, not the string
       already written into an earlier period's budget/transaction rows), so
       it now surfaces here too rather than only in "Spend by Category" —
       closing an asymmetry where the same fact was disclosed in one table
       and silently absent from the other. See mergeCategoryRows' own header
       and this file's buildReportData/financialReportMarkdown for why a real
       MERGE across the rename is not attempted: see R5's note there. */
    const categories = mergeCategoryRows(periods.map(p => budgetVsActualRows(p)), ['budget', 'actual'])
      .sort((a, b) => typeRank(a.type, order) - typeRank(b.type, order) || a.cat.localeCompare(b.cat))
      .map(r => ({ ...r, orphaned: !catKnown(r.cat) }));
    /* `orphaned` — catKnown() is the SAME predicate period.js's own catType()
       and dashboard.js's `sum.unknown` both key off (see catKnown's own
       header on why "no category" and "a category no file answers to" are
       deliberately different questions); applying it directly to the merged
       row is what the row actually shown here, in THIS table, is — not a
       wider per-period set that could also hold an income-side orphan never
       drawn as a spend row at all. */
    const spendByCategory = mergeCategoryRows(spendRowsByPeriod, ['amount'])
      .sort((a, b) => b.amount - a.amount)
      .map(r => ({ ...r, orphaned: !catKnown(r.cat) }));

    /* ISSUE 28 (2026-08-29 audit). The Report's Net Worth section printed a
       total that added unlike currencies and — alone among the three surfaces
       that compute it — disclosed nothing. That is the worse half of this
       repo's recurring shape: the one document meant to LEAVE the app and be
       handed to somebody else carried no caveat, while both of its on-screen
       twins did. Same rule as those twins now, and `otherCurrencies` travels
       into the document so the section can say what it holds. */
    const { primary: homeAccounts, others: reportOthers } =
      splitByCurrency(S.accounts, S.settings.currency);
    const w = worth(homeAccounts, S.debts, S.assets, S.settings.currency);
    return {
      /* M3, 2026-08-29 audit — this was `new Date().toISOString().slice(0,
         16).replace('T', ' ')`, UTC, while todayIso() a few lines up (and
         everywhere else this app stamps "now") reads local calendar parts —
         see src/dates.js's own header for why that split is the whole
         reason the module exists. Generated at 06:18 SAST, this line used to
         print "04:18"; for a reader east of Greenwich it is the wrong
         CALENDAR DAY, not just the wrong hour, in both the frontmatter and
         the "Generated" line the reader actually sees. */
      generated: nowLocalMinute(),
      periodLabel: periodLabelFor(periods),
      rangeNote: rangeNoteFor(periods),
      /* R5 — how many periods this selection actually merged. A rename
         mid-selection can only ever SPLIT a category across two rows when
         there is more than one period to split across; financialReportMarkdown
         gates its rename caveat on this so a single-period ("Current month")
         report, which can never exhibit R5, never prints a caveat about it. */
      periodCount: periods.length,
      detail,
      currency: S.settings.currency || '',
      /* Every other currency this household holds, each in its own symbol and
         never converted. A document that declares ONE `currency` and then
         carries figures in another is not merely incomplete, it is wrong
         about itself — a parser (the stated audience for the JSON) reads
         -900 as rand when it is euro. So the list is stated, and the
         per-row currency below closes the same gap for transactions. */
      /* The ACCOUNTS half was all this ever carried — splitByCurrency's
         `others`, computed above — so a euro flat and a euro bond, both
         already held out of the net-worth total by worth() itself, were
         disclosed nowhere. otherCurrencyNet merges all three ledgers into
         one per-symbol NET, which is the right shape for a figure that
         calls itself a net worth: "held" beside that number means "in the
         household's position", not "in a bank". See its own header in
         src/worth.js. */
      otherCurrencies: otherCurrencyNet(w, reportOthers),
      /* What the Income & Spend section leaves out, travelling with the
         figures the same way periodSummary hands it over. */
      foreign: { count: foreignLabels.size, symbols: foreignSymbols },
      household: S.settings.currency || '',
      income, spend, net, budgetIncome, budgetSpend,
      categories, spendByCategory,
      categoryGap: { uncat, netted },
      savings: savingsSummary(),
      debts: debtsSummary(w),
      netWorth: { net: w.net, assets: w.assets, liabilities: w.liabilities },
      health: healthSummary(),
      /* Each row stamped with the symbol of the account whose folder it lives
         in, so neither the markdown table nor the JSON can print a euro
         charge under the household's symbol. */
      transactions: detail === 'detail'
        ? periods.flatMap(p => txInPeriod(p)).map(r => ({
          ...r, currency: symbolOf(ctx.accountForLabel(r.label), S.settings.currency),
        }))
        : null,
    };
  }

  /* The WHOLE body is one try/catch. Not the 1.28.0 dead-button's actual
     cause (that was refreshResult() reading the file back through the wrong
     root — see fileAtVaultPath's header in src/io.js) — but a real,
     independent gap all the same: this is an async click listener wired bare
     (`$('#reportCreate').addEventListener('click', ctx.createReport)`), and
     nothing in Obsidian or the DOM awaits or catches what it returns. A throw
     ANYWHERE in an async function becomes a REJECTED PROMISE, and a rejected
     promise nobody awaits is an unhandled rejection — invisible on iOS,
     invisible on desktop unless the console happens to be open, and
     indistinguishable from the button doing nothing at all. The two
     per-format try/catches below were never the whole story: buildReportData
     (six math-module calls deep), reportPaths, ensureVaultFolder and even the
     final renderReport()/toast() pair all ran OUTSIDE them. This one wraps
     every line, so the worst case is now always the createFailed toast,
     never silence. */
  async function createReport() {
    try {
      const data = buildReportData();
      /* L2 — the write path is named off filenameLabel() (language-stable),
         NOT data.periodLabel (the document's own translated heading — see
         filenameLabel's own comment above for why the two must differ). A
         second, cheap selectedPeriods() call: pure, and nothing async runs
         between it and buildReportData()'s own identical call, so the two
         can never disagree about which periods this selection means. */
      const paths = reportPaths(filenameLabel(selectedPeriods()), folder ?? (plugin.settings.reportFolder || REPORT_DIR));
      /* M1, 2026-08-29 audit — refused a SECOND time, independently of the
         renderReport()/disabled-button guard above: that one only stops a
         click through the rendered page, and buildReportData()/reportPaths()
         run first in this function regardless, so a caller that reached
         createReport() any other way (a future command-palette entry, a test
         that calls it directly) would otherwise still write. Thrown, not
         toasted directly — the whole-body try/catch below is what turns this
         into the SAME createFailed toast every other failure in this
         function produces, not a second, differently-shaped error path. */
      const conflict = managedFolderMatch(paths.dir, plugin.settings.budgetFolder);
      if (conflict) throw new Error(i18n.t('report.field.folderManaged', { folder: conflict }));
      /* Explicit, not left to writeVaultFile's own internal ensureFolder —
         both now run (ensureFolder is idempotent: it checks
         getAbstractFileByPath and returns immediately if the folder is
         already there, so calling it twice costs nothing). NOT the
         dead-button's cause — the verifier proved writeVaultFile's own
         ensureFolder already self-heals a missing Reports/ correctly — but a
         cheap, correct belt-and-braces step done once up front rather than
         raced independently by two writeVaultFile calls when both formats
         are selected. */
      await ensureVaultFolder(paths.dir);

      const written = { md: null, json: null };
      const errors = [];
      /* Each format writes independently and a failure in one does not lose
         the other — same shape views/transactions.js's exportTransactions()
         already accepts for its own four sequential writes: the ones that
         landed are real files, and a single toast at the end must not read
         as though NOTHING happened when something did. */
      if (formats.has('md')) {
        const md = financialReportMarkdown(data, money);
        try {
          written.md = { path: await writeVaultFile(paths.mdPath, md), text: md };
        } catch (e) { errors.push(e.message || String(e)); }
      }
      if (formats.has('json')) {
        const json = financialReportJson(data);
        try {
          written.json = { path: await writeVaultFile(paths.jsonPath, json), text: json };
        } catch (e) { errors.push(e.message || String(e)); }
      }
      if (!written.md && !written.json) {
        return toast(i18n.t('report.createFailed', { error: errors.join('; ') }), true);
      }

      /* Remembered only after at least one write actually landed — same rule
         views/transactions.js's exportTransactions() applies to exportFolder,
         for the same reason: a destination that failed entirely must not
         become next time's default. */
      if (plugin.settings.reportFolder !== paths.dir) {
        plugin.settings.reportFolder = paths.dir;
        try {
          await plugin.saveSettings();
        } catch (e) {
          toast(i18n.t('settings.err.save', { error: e.message || e }), true);
        }
      }
      result = { md: written.md, json: written.json, generatedAt: data.generated };
      renderReport();
      toast(errors.length ? i18n.t('report.createdPartial', { error: errors.join('; ') }) : i18n.t('report.created'));
    } catch (e) {
      console.error('Budget: createReport failed', e);
      toast(i18n.t('report.createFailed', { error: e.message || e }), true);
    }
  }

  /* Markdown only — the format the share sheet / Export to PDF chain reads.
     Falls back to the JSON file when no Markdown was generated for this
     selection, rather than doing nothing: a reader who picked JSON-only
     still typed a folder and clicked Create expecting SOMETHING to open.
     Whole-body try/catch for the same reason createReport()'s own header
     gives — a bare async listener with no wrapper turns any throw into a
     silent, unhandled rejection. */
  async function openReport() {
    try {
      if (!result) return;
      const entry = result.md || result.json;
      if (!entry) return toast(i18n.t('report.openFailed'), true);
      const file = fileAtVaultPath(entry.path);
      if (!file) return toast(i18n.t('report.openFailed'), true);
      await app.workspace.getLeaf('tab').openFile(file);
    } catch (e) {
      toast(i18n.t('report.openFailed'), true);
    }
  }

  /* Reveals the created report in Obsidian's OWN file-explorer panel — NOT
     the OS Finder/File Explorer (app.showInFolder / Electron's
     shell.showItemInFolder), which is desktop-only and would silently do
     nothing on iOS. `internalPlugins.getEnabledPluginById('file-explorer')
     .revealInFolder(file)` is the in-app sidebar reveal Obsidian's own
     bookmarks pane and right-click "Reveal file in navigation" use
     internally — undocumented in the public API but stable across desktop
     AND mobile, since it never leaves the app (the sidebar file tree is core
     to both). Falls back to opening the file directly only if the File
     Explorer CORE PLUGIN itself has been disabled — a real but rare
     platform-independent case, not an iOS-specific one. */
  async function revealReportFolder() {
    try {
      const entry = result && (result.md || result.json);
      const target = entry ? fileAtVaultPath(entry.path) : folderAtVaultPath(currentPaths().dir);
      if (!target) return toast(i18n.t('report.revealNone'), true);

      const explorer = app.internalPlugins && typeof app.internalPlugins.getEnabledPluginById === 'function'
        ? app.internalPlugins.getEnabledPluginById('file-explorer') : null;
      if (explorer && typeof explorer.revealInFolder === 'function') {
        explorer.revealInFolder(target);
        return;
      }
      // File Explorer disabled — reveal is unavailable on ANY platform, not
      // only mobile. Falling back to opening the file is still useful; a
      // folder has nothing to "open" instead, so that case is an honest toast.
      if (entry) {
        await app.workspace.getLeaf('tab').openFile(target);
      } else {
        toast(i18n.t('report.revealUnavailable'), true);
      }
    } catch (e) {
      toast(i18n.t('report.revealFailed', { error: e.message || e }), true);
    }
  }

  /* navigator.clipboard, not an Electron/Node API — this is the same
     standard browser Clipboard API iOS Safari has carried since 13.4, well
     under the iOS 15 floor this repo builds to. Reads from disk when the
     entry came from refreshResult() (a report found already on the vault,
     never loaded into memory) rather than one just generated in this
     session. `strip` trims the Markdown down to its copy-ready body (see
     copyBody's own header); the JSON file has no frontmatter to strip, so
     copyReportJson passes it through untouched. Whole-body try/catch — same
     reasoning as createReport()/openReport() above. */
  async function copyEntry(entry, strip) {
    try {
      if (!entry) return;
      let text = entry.text;
      if (text == null) text = await readVaultFile(entry.path);
      await navigator.clipboard.writeText(strip ? copyBody(text) : text);
      toast(i18n.t('report.copied'));
    } catch (e) {
      toast(i18n.t('report.copyFailed', { error: e.message || e }), true);
    }
  }
  const copyReport = () => copyEntry(result && result.md, true);
  const copyReportJson = () => copyEntry(result && result.json, false);

  /* "Copy report" up front, from the OPTIONS card — no vault write at all.
     Ruan's own ask: copy-paste-ready output before committing to a file.
     Builds the SAME `data` object createReport() would (buildReportData()),
     runs it through the SAME markdown serialiser, and puts the SAME
     frontmatter-stripped body on the clipboard copyReport() already does for
     a saved report — the only difference is nothing ever reaches disk. */
  async function copyReportNow() {
    try {
      const data = buildReportData();
      const md = financialReportMarkdown(data, money);
      await navigator.clipboard.writeText(copyBody(md));
      toast(i18n.t('report.copied'));
    } catch (e) {
      toast(i18n.t('report.copyFailed', { error: e.message || e }), true);
    }
  }

  function setPeriod(v) { period = v; renderReport(); }
  function setDetail(v) { detail = v; renderReport(); }
  function setFolder(v) { folder = v; renderReport(); }
  /* At least one format must always stay selected — a page offering to
     create nothing is not a smaller report, it is a broken button. */
  function toggleFormat(key) {
    if (formats.has(key)) {
      if (formats.size === 1) return;
      formats.delete(key);
    } else {
      formats.add(key);
    }
    renderReport();
  }

  ctx.provide({
    renderReport, createReport, openReport, revealReportFolder, copyReport, copyReportJson, copyReportNow,
    setReportPeriod: setPeriod, setReportDetail: setDetail, setReportFolder: setFolder,
  });
};
