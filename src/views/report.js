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
const { worth } = require('../worth');
const { totalReturn, poolCatType, chartable } = require('../savings-math');
const { monthlyInterest } = require('../debt-math');
const { todayIso } = require('../dates');
const { REPORT_DIR, reportPaths, mergeCategoryRows, financialReportMarkdown, financialReportJson, copyBody } = require('../report');
/* Namespace import: see views/dashboard.js's own comment on why every view
   in this app imports i18n the same way regardless of whether `t` happens
   to be a local name in this particular file. */
const i18n = require('../i18n');

module.exports = function registerReport(ctx) {
  const {
    S, $, app, plugin, money, toast, fileAt, readFile, writeVaultFile,
    currentPeriod, periodRange, periodMonthName, dayLabel,
    periodsForMonths, trendPeriods, periodSummary, budgetTotals,
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

  function selectedPeriods() {
    if (period === 'current') return [currentPeriod()];
    const months = period === '3m' ? 3 : 12;
    // trendPeriods always includes the current period even when it is empty
    // (see trend-math.js) and stops at the earliest real data otherwise, so
    // a vault younger than the chosen span reports on what it actually has
    // rather than inventing zero-filled history for months before it existed.
    return trendPeriods(periodsForMonths(months));
  }

  function periodLabelFor(periods) {
    return periods.length === 1
      ? periodMonthName(periods[0])
      : `${periodMonthName(periods[0])} ${i18n.t('report.to')} ${periodMonthName(periods[periods.length - 1])}`;
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
    return reportPaths(periodLabelFor(periods), folder ?? (plugin.settings.reportFolder || REPORT_DIR));
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
    const mdFile = fileAt(mdPath);
    const jsonFile = fileAt(jsonPath);
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
    $('#reportResultTitle').textContent = i18n.t('report.result.title');
    $('#reportOpenLabel').textContent = i18n.t('report.open');
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
    $('#reportFolderDesc').textContent = i18n.t('report.field.folderDesc');

    const { mdPath, jsonPath } = currentPaths();
    const previewPaths = [formats.has('md') ? mdPath : null, formats.has('json') ? jsonPath : null].filter(Boolean);
    $('#reportPreview').textContent = i18n.t('report.preview', { path: previewPaths.join(' · ') });

    const existing = [
      (result && result.md) ? i18n.t('report.format.md') : null,
      (result && result.json) ? i18n.t('report.format.json') : null,
    ].filter(Boolean);
    $('#reportExistsNote').textContent = existing.length ? i18n.t('report.exists', { formats: existing.join(', ') }) : '';
    $('#reportCreateLabel').textContent = i18n.t(existing.length ? 'report.recreate' : 'report.create');

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

    const card = $('#reportResultCard');
    if (result) {
      card.classList.remove('hidden');
      $('#reportResultSub').textContent = [result.md && result.md.path, result.json && result.json.path].filter(Boolean).join(' · ');
      $('#reportResultNote').textContent = result.generatedAt
        ? i18n.t('report.result.generated', { date: result.generatedAt })
        : i18n.t('report.result.found');
      $('#reportOpen').classList.toggle('hidden', !result.md);
      $('#reportCopy').classList.toggle('hidden', !result.md);
      $('#reportCopyJson').classList.toggle('hidden', !result.json);
    } else {
      card.classList.add('hidden');
    }
  }

  /* ----------------------------- assembly ---------------------------------
     Every function below reaches into ctx or a math module for its figures;
     none of them sum a transaction or a balance on their own. */

  /* Savings & investment growth, as of today — the exact reasoning
     views/savings.js's own growthTile()/growthTotals() apply, reproduced
     here because that pair are DOM-bound closures over the Savings view's
     own `tile()`/`money()` calls and cannot be called from another page;
     the CALLS they make (totalReturn, chartable, poolCatType) are the same
     ones, not a second guess at what they return. */
  function savingsSummary() {
    const poolType = name => poolCatType(S.categories, name);
    const typeIs = (a, t) => String((a && a.type) || '').trim().toLowerCase() === t;
    const pool = S.accounts.filter(a => typeIs(a, 'savings') || typeIs(a, 'investment'));
    const idx = accountIndex();
    let growth = 0, rateGrowth = 0, rateCapital = 0, measured = 0, unmeasured = 0;
    for (const a of pool) {
      const rows = (idx.get(a) || {}).rows || [];
      const r = totalReturn(a, rows, poolType, { today: todayIso() });
      if (!chartable(a, r)) { unmeasured++; continue; }
      measured++;
      growth += r.growth;
      if (r.capitalIn > 0) { rateGrowth += r.growth; rateCapital += r.capitalIn; }
    }
    return { growth, rateGrowth, rateCapital, measured, unmeasured, total: measured + unmeasured };
  }

  /* Debt, as of today — worth.js's own activeDebts() (via w.active) is the
     SAME filter the Dashboard's net-worth tile and health-data.js's
     debtInterestMonthly() both read, so "how many debts" cannot disagree
     between this section and the net-worth one below it. `perMonth` mirrors
     views/debts.js's own committed() one-liner — payment plus any extra —
     rather than importing a closure that file does not export. */
  function debtsSummary(w) {
    const active = w.active;
    const rows = active.map(d => ({ name: d.name, balance: d.balance || 0, rate: d.rate || 0, interest: monthlyInterest(d.balance, d.rate) }));
    return {
      count: S.debts.length,
      active: active.length,
      total: rows.reduce((t, r) => t + r.balance, 0),
      perMonth: active.reduce((t, d) => t + (d.payment || 0) + (d.extra || 0), 0),
      interest: rows.reduce((t, r) => t + r.interest, 0),
      rows,
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
    for (const p of periods) {
      const sum = periodSummary(p);
      income += sum.income; spend += sum.spend; net += sum.net;
      const bt = budgetTotals(p);
      budgetIncome += bt.income; budgetSpend += bt.spend;
    }
    const categories = mergeCategoryRows(periods.map(p => budgetVsActualRows(p)), ['budget', 'actual'])
      .sort((a, b) => a.cat.localeCompare(b.cat));
    const spendByCategory = mergeCategoryRows(periods.map(p => categorySpendRows(p)), ['amount'])
      .sort((a, b) => b.amount - a.amount);

    const w = worth(S.accounts, S.debts, S.assets);
    return {
      generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
      periodLabel: periodLabelFor(periods),
      rangeNote: rangeNoteFor(periods),
      detail,
      currency: S.settings.currency || '',
      income, spend, net, budgetIncome, budgetSpend,
      categories, spendByCategory,
      savings: savingsSummary(),
      debts: debtsSummary(w),
      netWorth: { net: w.net, assets: w.assets, liabilities: w.liabilities },
      health: healthSummary(),
      transactions: detail === 'detail' ? periods.flatMap(p => txInPeriod(p)) : null,
    };
  }

  async function createReport() {
    const data = buildReportData();
    const paths = reportPaths(data.periodLabel, folder ?? (plugin.settings.reportFolder || REPORT_DIR));

    const written = { md: null, json: null };
    const errors = [];
    /* Each format writes independently and a failure in one does not lose
       the other — same shape views/transactions.js's exportTransactions()
       already accepts for its own four sequential writes: the ones that
       landed are real files, and a single toast at the end must not read as
       though NOTHING happened when something did. */
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
  }

  /* Markdown only — the format the share sheet / Export to PDF chain reads.
     Falls back to the JSON file when no Markdown was generated for this
     selection, rather than doing nothing: a reader who picked JSON-only
     still typed a folder and clicked Create expecting SOMETHING to open. */
  async function openReport() {
    if (!result) return;
    const entry = result.md || result.json;
    if (!entry) return toast(i18n.t('report.openFailed'), true);
    const file = fileAt(entry.path);
    if (!file) return toast(i18n.t('report.openFailed'), true);
    await app.workspace.getLeaf('tab').openFile(file);
  }

  /* navigator.clipboard, not an Electron/Node API — this is the same
     standard browser Clipboard API iOS Safari has carried since 13.4, well
     under the iOS 15 floor this repo builds to. Reads from disk when the
     entry came from refreshResult() (a report found already on the vault,
     never loaded into memory) rather than one just generated in this
     session. `strip` trims the Markdown down to its copy-ready body (see
     copyBody's own header); the JSON file has no frontmatter to strip, so
     copyReportJson passes it through untouched. */
  async function copyEntry(entry, strip) {
    if (!entry) return;
    let text = entry.text;
    if (text == null) {
      try {
        text = await readFile(entry.path);
      } catch (e) {
        return toast(i18n.t('report.copyFailed', { error: e.message || e }), true);
      }
    }
    try {
      await navigator.clipboard.writeText(strip ? copyBody(text) : text);
      toast(i18n.t('report.copied'));
    } catch (e) {
      toast(i18n.t('report.copyFailed', { error: e.message || e }), true);
    }
  }
  const copyReport = () => copyEntry(result && result.md, true);
  const copyReportJson = () => copyEntry(result && result.json, false);

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
    renderReport, createReport, openReport, copyReport, copyReportJson,
    setReportPeriod: setPeriod, setReportDetail: setDetail, setReportFolder: setFolder,
  });
};
