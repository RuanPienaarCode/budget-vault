'use strict';
/* App controller — mounts the shell into the view, assembles the shared ctx,
   registers every module onto it, and owns the app shell: view switching,
   drawer, theme, dirty tracking, vault-change watcher and event wiring. */

const { Notice } = require('obsidian');
const { el, setIco, setInert } = require('./dom');
const { SHELL_HTML } = require('./shell');
const { confirmModal } = require('./modal');
const { localeFor } = require('./locale');
const { applyDom } = require('./i18n');
// Namespaced import, not a bare `t` — this file already uses `t` as a local
// variable name inside toast() ($('#toast')), and the rest of src/ resolves
// the same shadowing risk the same way (see lang/en.js's own header).
const i18n = require('./i18n');
const { PALETTE_PRESETS, DEFAULT_PALETTE } = require('./constants');

const registerIo = require('./io');
const registerFxLive = require('./fx-live');
const registerPeriod = require('./period');
const registerLoad = require('./load');
const registerCategories = require('./categories');
const registerTrendMath = require('./trend-math');
const registerHealthData = require('./health-data');
const registerDashboard = require('./views/dashboard');
const registerScore = require('./views/score');
const registerTransactions = require('./views/transactions');
const registerBudgets = require('./views/budgets');
const registerPlan = require('./views/plan');
const registerAccounts = require('./views/accounts');
const registerSavings = require('./views/savings');
const registerAssets = require('./views/assets');
const registerDebts = require('./views/debts');
const registerOwed = require('./views/owed');
const registerServices = require('./views/services');
const registerTax = require('./views/tax');
const registerLoans = require('./views/loans');
const registerImport = require('./views/import');
const registerNotes = require('./views/notes');
const registerReport = require('./views/report');

/* The pure core of money formatting, pulled out of moneyIn() so it is
   testable without a live mount — see tests/controller-money.test.cjs.
   Guards non-finite input: `(NaN).toFixed(2)` is the string "NaN", which has
   no '.' to split on, so parts[1] comes back undefined and the caller renders
   "R NaN,undefined" — a garbage figure sitting next to every real one on the
   screen. No loader coercion or render-path division has been found to reach
   this un-guarded (every one is already checked), so this is a latent-hazard
   guard, not a fix for a proven path: render 0 rather than propagate garbage.

   The sign is decided from the ROUNDED magnitude, not from `v`. Taking it from
   the unrounded value while the digits came from the rounded one let the two
   halves of the string disagree, and the reader got a minus in front of a zero.
   -0 was safe by accident (`-0 < 0` is false in JS); every other negative that
   rounds away to nothing was not. Summing signed floats leaves a remainder like
   -7.1e-15 behind — the exact remainder currency.js's primaryTotal exists to
   collapse — so a break-even household printed "R -0,00", a negative figure in
   danger red for a household that owes nothing; and at decimals=0 (the compact
   tiles) every amount between -0,5 and 0 printed "R -0". A minus is the
   strongest claim a money label makes, and it must not outlive the rounding
   that erased the number it belonged to. It survives only while a digit does —
   -0,005 still rounds to a cent, so it keeps its sign.

   currency.js's formatAmount is the byte-for-byte twin of this function (its
   header explains why the copy exists) and carries the identical change; the
   two are held together by tests/controller-money.test.cjs. */
function formatMoney(symbol, v, decimals, loc) {
  if (!Number.isFinite(v)) v = 0;
  const abs = Math.abs(v).toFixed(decimals);
  const sign = v < 0 && Number(abs) !== 0 ? '-' : '';
  const parts = abs.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, loc.thousands);
  return `${symbol} ${sign}${parts[0]}${decimals > 0 ? loc.decimal + parts[1] : ''}`;
}

/* Should a vault rename move the notes attached to what was renamed, and from
   what name to what name? Pure, and pulled out of the watcher below for the
   same reason formatMoney was pulled out of moneyIn(): the whole decision lived
   inside a closure passed to vault.on(), which nothing can call without a live
   mount — so a regex that stopped matching, or a guard that started matching
   too much, would have shipped with every suite green.

   Returns null for "not a rename this plugin should act on", or
   {kind, from, to}. `categories` is S.categories.

   Only accounts and categories: they are the two kinds whose identity IS a
   file, so a rename is an event there is something to observe. Debts, assets,
   services and owed entries are rows in a markdown table — renamed by editing a
   cell, which the vault reports as a modify of the whole file with no way to
   know what changed inside it. Those are caught after the fact by the
   "unmatched" badge on the Notes page instead. */
function classifyRename(basePath, oldPath, newPath, categories) {
  const bp = basePath;
  const kindOf = p => {
    if (typeof p !== 'string' || (p !== bp && !p.startsWith(bp + '/'))) return null;
    const rel = p.slice(bp.length + 1);
    if (/^Accounts\/[^/]+\.md$/.test(rel)) return 'account';
    if (/^Categories\/[^/]+\.md$/.test(rel)) return 'category';
    return null;
  };
  const kind = kindOf(oldPath);
  /* Moved OUT of Accounts/ (or into it, or between the two) is not a rename of
     an account — it is a file leaving or joining the model, and re-pointing
     notes at wherever it landed would be a guess. */
  if (!kind || kindOf(newPath) !== kind) return null;

  const base = p => p.split('/').pop().replace(/\.md$/, '');

  /* An account IS its filename — the loader takes the name from there, so
     renaming the file renames the account and its notes must follow.

     A CATEGORY is not. load.js prefers `fm.name` and only falls back to the
     basename, because two display names can sanitise to one file. So a category
     carrying an explicit `name:` does not change its name when its FILE is
     renamed — and repointing then moves every note off a subject that never
     moved, orphaning them while toasting that it had helped. The only honest
     move there is to do nothing.

     Told apart by asking whether the name currently tracks the filename: if it
     does, the rename renames the category; if it does not, `fm.name` is in
     charge and the file is merely where it happens to live. Deriving this the
     same way the loader does is the whole fix — deriving it differently is the
     bug, and it is the second time in this repo (import.js, July: a safeSeg'd
     label probed against a raw one). */
  if (kind === 'category') {
    const rel = oldPath.slice(bp.length + 1);
    const cat = (categories || []).find(c => c.rel === rel);
    if (cat && cat.name !== base(oldPath)) return null;
  }

  const from = base(oldPath);
  const to = base(newPath);
  if (!from || from === to) return null;
  return { kind, from, to };
}

/* Which CSV-import affordances the shell ADVERTISES, given the household's
   `input_mode` from Settings.md.

   Standalone and exported for the same reason classifyRename above is: this is
   the whole of the manual-mode shell decision, and as a closure inside
   mountApp it could only ever be reached through a full DOMParser mount, which
   no bare-node test performs — so a selector that stopped matching would ship
   with every suite green.

   HIDES, IT DOES NOT DISABLE. switchView('import') stays reachable, and
   there are exactly two routes left to it: the command palette's "Import a
   bank statement (CSV)" (registered in main.js for this reason) and turning
   the setting back to CSV. The Accounts page's own "Import transactions"
   button is NOT a third — it only appears on an account with no transactions
   yet — so a manual household that later receives a CSV for an account that
   already has rows would otherwise have had no route at all. Manual mode is a
   statement about what to put in front of someone on day one, not about what
   they are allowed to do.

   Toggled rather than only added, because a household can change its mind:
   flipping the setting back to CSV and reloading has to bring the link back,
   and an add-only version would leave the drawer permanently short of an entry
   the settings screen says is on. */
function applyInputMode(root, mode) {
  const manual = mode === 'manual';
  for (const sel of ['[data-view="import"]', '#topbarImport']) {
    const el = root.querySelector(sel);
    if (el) el.classList.toggle('hidden', manual);
  }
  return manual;
}

/* The ONLY sanctioned way to re-read the vault. loadVault() is a whole-state
   reset — it replaces S.budgets, S.owed, S.services and S.tax and clears
   their dirty flags — so everything holding a pre-reload draft or snapshot
   has to be dropped in the same breath or it gets saved over the fresh data
   later. Three callers used to do this cleanup by hand, and the tax-year
   switch forgot, which silently discarded Owed/Services edits and left a
   stale budget draft armed behind an enabled Save button.

   Extracted to a standalone, ctx-free function (rather than left as a
   closure inside mountApp) so this seam can be guard-tested directly instead
   of through a full DOMParser mount — see tests/reload-from-disk.test.cjs.

   disableSaveButtons() runs in a `finally`, not after a plain `await`. Every
   S.<section> reset inside loadVault's load.js clears the array and its
   dirty flag TOGETHER before its own read resolves (S.owed = []; S.owedDirty
   = false; then `await readFile(...)`), so a rejection partway through
   leaves some sections already emptied while the Save buttons for them are
   still whatever they were before the reload started. Without the finally, a
   rejected loadVault() skipped this cleanup entirely and left an enabled
   Save button sitting over an emptied array — one click away from writing a
   blank table over the user's real file. `finally` closes that regardless of
   which section failed or how load.js's internals change later: every
   reload attempt, success or failure, ends with no Save button left armed
   over data that might not be what it claims to be.

   This does not restore S.<section> to its pre-reload contents on failure —
   that would need load.js itself to defer each swap until its own read
   resolves, so a failure downstream never empties a section that already
   read fine. That is a real, separate hardening (tracked, not done here):
   this fix's job is narrower and more urgent — make sure nothing on screen
   can be SAVED while the state underneath it is unknown. Disabling the
   buttons does that outright; it does not also need to guess at what the
   "right" in-memory data would have been. */
async function reloadFromDisk(ctx, S, $, disableSaveButtons) {
  ctx.invalidateBudgetDraft();
  // The import review's dedup snapshot was taken against the pre-reload
  // transactions; keeping it would re-import every row as "new".
  S.pendingImport = null;
  $('#importReview').classList.add('hidden');
  try {
    await ctx.loadVault();
  } finally {
    disableSaveButtons();
  }
  /* ISSUE 30 — exchange rates, refreshed AFTER the vault is on screen and
     deliberately not awaited into it.

     Two properties this ordering buys, both of which matter more than the
     half-second it costs:

       - a render never waits on the network. A page that blocked on a rate
         lookup would be a page that goes blank when the wifi does, and the
         un-converted split it draws first is a correct, complete view in its
         own right — the conversion is an improvement on it, not a
         prerequisite for it.
       - nothing happens at all while the setting is off, which is the
         default and the README's promise. refreshRates() returns immediately
         in that case without reading a file or opening a socket.

     The redraw is conditional on the table actually CHANGING, so a fresh
     cached rate (the normal case, once a day) repaints nothing. Errors are
     swallowed by refreshRates itself; the .catch here is belt and braces
     against a caller that has not been registered yet. */
  if (typeof ctx.refreshRates === 'function') {
    ctx.refreshRates()
      .then(changed => { if (changed) ctx.render(); })
      .catch(() => {});
  }
}

function mountApp(view) {
  const plugin = view.plugin;
  const app = view.app;
  const vault = app.vault;
  const root = view.contentEl;

  root.classList.add('budget-app-root');
  // SHELL_HTML is a static developer-authored constant with no interpolation,
  // but assigning it via innerHTML trips Obsidian's plugin-review checks (and
  // any future CSP tightening). Parse it out-of-document instead: DOMParser
  // does no sanitising, so attributes the shell relies on — inert, data-ico,
  // aria-current — survive verbatim, which sanitizeHTMLToDom() would not
  // guarantee.
  root.empty();
  const parsed = new DOMParser().parseFromString(SHELL_HTML, 'text/html');
  while (parsed.body.firstChild) root.appendChild(parsed.body.firstChild);
  /* The shell ships its English text inline and carries data-i18n attributes
     beside it, so this pass is a no-op in English and the markup stays readable
     as markup. Runs BEFORE the icon pass purely so a data-i18n element can
     never be handed an already-resolved icon to overwrite — no element carries
     both today, and this keeps that cheap to maintain. */
  applyDom(root);
  root.querySelectorAll('span[data-ico]').forEach(sp => setIco(sp, sp.getAttribute('data-ico').split('|')));

  const $ = s => root.querySelector(s);
  const $$ = s => root.querySelectorAll(s);

  /* ------------------------------- state -------------------------------- */
  /* This block is the SCHEMA — every key S carries appears here, with its
     shape, and tests/shell-contract.test.cjs fails the build on any `S.<key>`
     used in src/ that this declaration does not list. It used to omit eleven
     keys (six of them canonical vault state written by the loader), so
     checking reloadFromDisk's "whole-state reset" claim meant reading all of
     load.js because the one place documenting the state told half the story.

     TWO KINDS OF KEY, fenced below: everything above the marker is CANONICAL
     VAULT STATE, cleared and refilled by loadVault() on every (re)load;
     everything below it SURVIVES the reset — view UI state and debounce
     handles that a vault re-read must not blank (a reload landing mid-search
     should not lose the reader's filter). */
  const S = {
    loaded: false,
    settings: { month_start_day: 23, currency: 'R', country: 'za', language: 'en', input_mode: 'csv', period_days: 0, period_anchor: '', overspend_lag: 1, emergency_target_months: 6, owners: [], groups: [], nonessential_groups: [] },
    categories: [],            // {name, type, color, assumeSpent, rel}
    accounts: [],              // account frontmatter + body
    budgets: {},               // 'YYYY-MM' -> [{category, type, amount, notes}]
    budgetMeta: {},
    txFiles: {},               // 'label/YYYY-MM' -> {label, month, rows, dirty}
    txFolders: [],             // account names whose Transactions/ folder exists on disk
    rules: [],                 // {pattern, category}
    assets: [],                // {name, type, value, valued, notes} — owned, but not an account
    assetsFm: '',              // Assets.md verbatim frontmatter, re-emitted by the serializer
    assetsDirty: false,
    debts: [],                 // {name, lender, type, balance, original, rate, payment, extra, start, category, status, notes}
    debtsFm: '',               // Debts.md verbatim frontmatter
    debtsDirty: false,
    owed: [],                  // {person, amount, description, due, status}
    owedFm: '',                // Owed Money.md verbatim frontmatter
    owedDirty: false,
    services: [],              // {name, provider, amount, cycle, next, category, active, notes}
    servicesFm: '',            // Services.md verbatim frontmatter
    servicesDirty: false,
    // basename -> {file, name, fmRaw, started, status, sources, envelopes, items}
    plans: {},
    planName: null,            // the open plan's FILE key, not its display name
    planDirty: false,
    tax: {},                   // 'YYYY' -> {fmRaw, taxpayer_type, assessment, deadlines, steps, docs}
    taxYear: null,
    taxDirty: false,
    taxOrphanYears: [],        // Tax/<year>/ folders holding files but no Tax/<year>.md
    // {rel, name, kind, subject, created, title, excerpt} — one entry per file
    // in Notes/, filled by loadVault. Prose, not figures: nothing here feeds a
    // total. The Notes page's own filter state is seeded by views/notes.js,
    // which owns its shape.
    notes: [],
    period: null,
    view: 'dashboard',
    pendingImport: null,
    /* The receipt for the import that just landed, or null — {label, filename,
       at, count, files:[{key, month, rows}]}, where `rows` holds the very row
       OBJECTS that were pushed into S.txFiles. Canonical vault state on
       purpose, above the fence: those references only mean anything against the
       rows currently in memory, so a reload — which rebuilds every one of them
       — has to take the offer away with it rather than leave an undo pointing
       at objects nothing holds. See undoImport in views/import.js. */
    lastImport: null,
    /* ---- survives loadVault(): UI state and debounce handles ---- */
    acctView: null,            // Accounts page card/list mode, owned by views/accounts.js
    noteFilter: null,          // Notes page {about, q}, seeded by views/notes.js
    _q: 0,                     // transactions-search debounce timer handle
    _acctQ: 0,                 // accounts-search debounce timer handle
    _noteQ: 0,                 // notes-search debounce timer handle
  };

  function toast(msg, bad = false) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.className = bad ? 'bad' : 'good';
    t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* Country locale profile for the configured country (Settings.md `country`,
     default South Africa). Resolved per call so a settings change applies on
     the next render without re-mounting. */
  const locale = () => localeFor(S.settings.country);

  /* Amount formatting — thousands/decimal separators come from the country
     profile (SA: "R 1 234,56"; US: "$ 1,234.56"). The symbol itself comes
     from Settings.md (`currency`). */
  /* The separators stay the COUNTRY's either way: a South African reading a
     euro balance still reads "1 234,56", because the convention belongs to the
     person reading the figure, not to the currency it is denominated in.
     Only the symbol moves. */
  function moneyIn(symbol, v, decimals = 2) { return formatMoney(symbol, v, decimals, locale()); }
  function money(v, decimals = 2) { return moneyIn(S.settings.currency, v, decimals); }
  /* wiz.type.* keys exist and are translated in every language, but a
     household can name its own custom category group — a raw string with no
     matching key. i18n.t() returns the key itself when nothing matches (its
     documented worst case, see i18n.js), and rendering THAT would show
     "wiz.type.mygroup" on screen — worse than the raw word it replaced. So the
     fallback compares the result against the key it asked for, not against
     `undefined`, and falls back to the raw enum value either way. */
  const typeBadge = type => {
    const key = 'wiz.type.' + type;
    const label = i18n.t(key);
    return el('span', { class: `category-badge badge-${type}` }, label === key ? type : label);
  };

  /* --------------------------- assemble ctx ----------------------------- */
  const ctx = { plugin, app, vault, view, root, $, $$, S, toast, money, moneyIn, typeBadge, locale };

  /* Every module publishes onto this one flat namespace — 60+ keys with no
     collision detection, where a silent overwrite would show up much later as
     "the wrong function ran". Throw at mount instead. */
  ctx.provide = obj => {
    for (const k of Object.keys(obj)) {
      if (k in ctx) throw new Error(`Budget: ctx.${k} is already defined — two modules are publishing the same name.`);
    }
    Object.assign(ctx, obj);
  };

  /* A view reports "I have unsaved edits" by registering a predicate rather
     than by adding a line to hasDirty(). The old shape failed OPEN: a view that
     forgot its entry looked clean to the file watcher, which then reloaded the
     vault over the user's unsaved work 800ms after any sync event. Registering
     is done by the view itself, so forgetting is no longer possible. */
  const dirtyChecks = [];
  ctx.registerDirty = fn => dirtyChecks.push(fn);

  /* The Save buttons that must go back to disabled when the vault is re-read.
     Registered by the view that owns each one, for exactly the reason above:
     the list used to be written out by hand in reloadFromDisk, and #txSave was
     missing from it — so "Reload from disk" discarded transaction edits and
     left Transactions' Save button lit over them, offering to save nothing.
     Returns the view's own disable(), so the same registration also gives it
     the call it makes after a successful save. */
  const saveButtons = [];
  ctx.registerSaveButton = sel => {
    saveButtons.push(sel);
    return () => { const b = $(sel); if (b) b.disabled = true; };
  };
  function disableSaveButtons() {
    for (const sel of saveButtons) { const b = $(sel); if (b) b.disabled = true; }
  }

  /* The shape four of the five editable pages share: a boolean on S, a Save
     button mirroring it, and a dirty predicate the file watcher reads. Three
     halves of one fact, previously spelled out separately in each view (and in
     reloadFromDisk). Budgets and Transactions keep their own predicates —
     neither is backed by a plain flag — but still register their buttons. */
  ctx.dirtyFlag = (stateKey, saveSel) => {
    const disable = ctx.registerSaveButton(saveSel);
    ctx.registerDirty(() => !!S[stateKey]);
    return {
      mark: () => { S[stateKey] = true; const b = $(saveSel); if (b) b.disabled = false; },
      clear: () => { S[stateKey] = false; disable(); },
    };
  };

  /* Assigned BEFORE the register chain so view modules can destructure them
     like anything else. They used to be attached afterwards, which meant every
     module had to reach through `ctx.render()` late and there was an unwritten
     "destructure everything except render/switchView" rule waiting to bite. */
  ctx.switchView = v => switchView(v);
  ctx.render = () => render();

  /* Order is load-bearing: io before all (writeFile/readFile); period before
     load/dashboard/transactions/budgets/import (currentPeriod, txInPeriod);
     categories before transactions/budgets/import (lazyCatSelect); transactions
     before import (serializeTxFile). Reordering these silently produces
     "x is not a function" a whole screen away from the cause. */
  registerIo(ctx);          // basePath, readFile, writeFile, mdFilesIn, …
  registerPeriod(ctx);      // periodRange, currentPeriod, periodSummary, …
  registerLoad(ctx);        // loadVault, txSegment
  /* After load (it reads S.settings) and before every view that might print a
     converted figure. Registering it does NOT touch the network — see its own
     header; nothing happens at all until exchange_rates is switched on. */
  registerFxLive(ctx);      // fxTable, fxState, refreshRates, fxConvert
  registerCategories(ctx);  // catSelect, lazyCatSelect, promptCreateCategory
  registerTrendMath(ctx);   // trendPeriods, historySpan, periodSpend, … (needs period)
  // After trend-math, whose periodsForMonths it uses, and before the two views
  // that read the snapshot it assembles.
  registerHealthData(ctx);  // healthSnapshot
  /* Before the views, because five of them render its noteButton() chip — they
     reach it through ctx at render time rather than by destructuring, so the
     order is belt-and-braces rather than load-bearing. loadVault calls
     ctx.loadNotes(), which is late-bound for the same reason. */
  registerNotes(ctx);
  registerDashboard(ctx);
  // After dashboard, whose budgetVsActualRows/categorySpendRows it reads —
  // the report page's whole reason for existing is never re-deriving those.
  registerReport(ctx);
  registerScore(ctx);
  registerTransactions(ctx);
  registerBudgets(ctx);
  registerPlan(ctx);
  registerAccounts(ctx);
  registerSavings(ctx);
  registerAssets(ctx);
  registerDebts(ctx);
  registerOwed(ctx);
  registerServices(ctx);
  registerTax(ctx);
  registerLoans(ctx);
  registerImport(ctx);

  /* ---------------------------- view switching --------------------------- */
  function switchView(v) {
    S.view = v;
    for (const b of $$('.drawer-link[data-view]')) {
      if (b.dataset.view === v) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    for (const sec of $$('main > section')) sec.classList.add('hidden');
    $(`#view-${v}`).classList.remove('hidden');
    /* C1 in the 2026-08-29 report audit: the Report page has its own period
       pills (views/report.js), anchored on currentPeriod() — the wall clock,
       matching what "Current month" / "Last 3 months" / "Last 12 months"
       actually promise. The header pill lets the reader move S.period
       independently, which is exactly what the Dashboard trend wants
       (trend-math.js's trendPeriods reads S.period on purpose) but which the
       Report page must NOT also answer to — a second, silent period control
       on the one page that generates a document meant to leave the app. Only
       this view hides it; connectVault's own hide/show pair above stays in
       charge of the not-yet-loaded case. */
    $('#periodPill').classList.toggle('hidden', v === 'report');
    closeDrawer();
    render();
    /* Move focus to the new route's heading. closeDrawer() puts it back on the
       hamburger, which tells a screen-reader user only that the drawer shut —
       not that the whole content region changed underneath. */
    const h = $(`#view-${v} h1`);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }
  function render() {
    if (!S.loaded) return;
    $('#periodLabel').textContent = ctx.periodTitle(S.period);
    ({ dashboard: ctx.renderDashboard, score: ctx.renderScore,
       transactions: ctx.renderTransactions, budgets: ctx.renderBudgets,
       plan: ctx.renderPlan, notes: ctx.renderNotes, report: ctx.renderReport,
       savings: ctx.renderSavings, accounts: ctx.renderAccounts, assets: ctx.renderAssets,
       debts: ctx.renderDebts, owed: ctx.renderOwed,
       services: ctx.renderServices,
       tax: ctx.renderTax, loans: ctx.renderLoans, import: ctx.renderImport, connect: () => {} })[S.view]();
    /* A vault change can re-render underneath a locked gate. Real `inert` covers
       whatever the subtree happens to contain at any moment, but the old-engine
       fallback stamps tabindex on the nodes it can see — so freshly built rows
       would be tabbable behind the gate. Re-assert; it's idempotent. */
    if (locked) setInert($('.bud-scroll'), true);
  }
  /* ---------------------- drawer + theme (app shell) --------------------- */
  function openDrawer() {
    const d = $('#appDrawer');
    d.classList.add('open');
    setInert(d, false);                         // re-enter the tab / AT order
    $('#drawerOverlay').classList.add('open');
    $('#menuBtn').setAttribute('aria-expanded', 'true');
    $('#drawerClose').focus();                  // move focus into the drawer
  }
  function closeDrawer() {
    const d = $('#appDrawer');
    const wasOpen = d.classList.contains('open');
    d.classList.remove('open');
    setInert(d, true);                          // leave the tab / AT order
    $('#drawerOverlay').classList.remove('open');
    $('#menuBtn').setAttribute('aria-expanded', 'false');
    if (wasOpen) $('#menuBtn').focus();         // restore focus only on a real close
  }
  /* Topbar personalisation from Settings.md `household` — brand subtitle and
     avatar initials (first + last word, e.g. "Jane & John Smith" → JS). */
  function applyIdentity() {
    const name = (S.settings.household || '').trim();
    $('#brandSub').textContent = name ? `${name} · Obsidian` : 'Obsidian vault budget';
    const words = name.split(/\s+/).filter(w => /^[\p{L}\p{N}]/u.test(w));
    const initials = words.length
      ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
      : 'BV';
    const av = $('#topbarAvatar');
    av.textContent = initials;
    av.setAttribute('aria-label', name ? `Budget settings — ${name}` : 'Open budget settings');
    av.setAttribute('title', name ? `${name} · budget settings` : 'Budget settings');
  }

  function applyTheme() {
    const pref = plugin.settings.theme;
    const dark = pref === 'dark' || (pref === 'auto' && document.body.classList.contains('theme-dark'));
    root.classList.toggle('bud-dark', dark);
    /* Palette is a second, orthogonal axis: which colours, independent of which
       mode. Every previous bud-palette-* class comes off first — toggling only
       the new one would leave two palettes on the root, and the winner would be
       whichever the stylesheet happened to define last rather than the one that
       was chosen.

       An unknown id (a palette retired between versions, or a hand-edited
       data.json) falls back to the default rather than leaving the root with no
       palette class at all: the base blocks in src/styles.css would still paint
       it Vault Green, so it would LOOK fine while the setting silently did
       nothing — the kind of mismatch that gets reported as "the theme picker is
       broken" long after the release that caused it. */
    for (const c of [...root.classList]) {
      if (c.startsWith('bud-palette-')) root.classList.remove(c);
    }
    const id = PALETTE_PRESETS[plugin.settings.palette] ? plugin.settings.palette : DEFAULT_PALETTE;
    root.classList.add(`bud-palette-${id}`);
    /* Every chart bakes the resolved palette into SVG attributes at render
       time — SVG has no way to say "this fill is var(--color-success)" — so a
       theme flip leaves them painted in the outgoing theme until they are
       rebuilt. Only the charts on the view actually being looked at: the rest
       redraw on their own when switched to. */
    if (!S.loaded) return;
    if (S.view === 'dashboard') { ctx.renderTrend(); ctx.renderSplit(); }
    else if (S.view === 'savings') ctx.renderWorth();
    else if (S.view === 'debts') ctx.replan();
  }

  /* --------------------------- dirty tracking ----------------------------
     Gates the file watcher, so a false negative here means unsaved work gets
     overwritten by a sync. Every view registers its own predicate (see
     ctx.registerDirty above); the two below have no view module of their own. */
  ctx.registerDirty(() => Object.values(S.txFiles).some(f => f.dirty));
  ctx.registerDirty(() => !!S.pendingImport);
  function hasDirty() {
    return dirtyChecks.some(fn => fn());
  }

  /* ------------------------------ bootstrap ------------------------------ */
  // See the module-level reloadFromDisk above (and tests/reload-from-disk.test.cjs)
  // for what this does and why disableSaveButtons runs in a finally.
  const doReloadFromDisk = () => reloadFromDisk(ctx, S, $, disableSaveButtons);
  ctx.reloadFromDisk = doReloadFromDisk;

  async function connectVault() {
    try {
      await doReloadFromDisk();
    } catch (e) {
      S.loaded = false;
      $('#connectErr').textContent = e.message || String(e);
      return;
    }
    if (!S.categories.length && !Object.keys(S.txFiles).length) {
      S.loaded = false;
      for (const sec of $$('main > section')) sec.classList.add('hidden');
      $('#view-connect').classList.remove('hidden');
      $('#periodPill').classList.add('hidden');
      $('#topbarImport').classList.add('hidden');
      $('#topbarReport').classList.add('hidden');
      $('#connectPathNote').empty();
      $('#connectPathNote').append(
        'Looked in ', el('code', {}, ctx.basePath()),
        ' but found no Categories/ or Transactions/ inside it. Point the plugin at the Budget folder itself.');
      return;
    }
    S.loaded = true;
    applyIdentity();
    $('#view-connect').classList.add('hidden');
    $('#periodPill').classList.remove('hidden');
    $('#topbarImport').classList.remove('hidden');
    $('#topbarReport').classList.remove('hidden');
    /* AFTER the unconditional un-hide above, and here rather than at mount,
       because Settings.md is only read once the vault has loaded — and because
       reload() routes through this function, so changing the setting and
       reloading takes effect without re-mounting the shell. */
    applyInputMode(root, S.settings.input_mode);
    switchView(S.view === 'connect' ? 'dashboard' : S.view);
    toast(`Loaded ${Object.values(S.txFiles).reduce((a, f) => a + f.rows.length, 0)} transactions`);
  }

  /* ------------------------- privacy splash gate -------------------------
     An opaque cover over the whole pane so balances are never on screen for a
     shoulder-surfer (or in the OS app-switcher snapshot) until the owner taps
     "Enter budget". On the FIRST lock the vault has not been read at all, so
     there are no amounts anywhere in the DOM to be found — connectVault() only
     runs on unlock. A later re-lock (Obsidian backgrounded) covers the already-
     rendered view instead: unsaved edits and the current period survive it. */
  let locked = false;
  /* The gate clips its own drifting background layers, which makes it a scroll
     container whose scrollHeight exceeds its height. Plain .focus() then scrolls
     the splash content up out of sight to "reveal" the button it just focused.
     preventScroll stops that; the scrollTop reset covers engines that ignore it
     (the option is Safari 14.1+, and this plugin's floor is iOS 15). */
  function focusEnter() {
    const g = $('#splashGate');
    $('#gateEnter').focus({ preventScroll: true });
    g.scrollTop = 0;
  }
  function lockGate() {
    if (locked) return;
    locked = true;
    closeDrawer();
    $('#splashGate').classList.remove('hidden');
    // inert, not just visually covered — otherwise Tab walks through the
    // hidden table behind the gate and a screen reader reads out the balances.
    // setInert, not the bare attribute: `inert` is Safari 15.5+ and this
    // plugin's floor is iOS 15.0, where the attribute is inert itself.
    setInert($('.topbar'), true);
    setInert($('.bud-scroll'), true);
    // Making an ancestor inert blurs whatever had focus, so on a re-lock focus
    // would otherwise land on <body> with nothing to Tab to but the gate.
    focusEnter();
  }
  async function unlockGate() {
    if (!locked) return;
    locked = false;
    $('#splashGate').classList.add('hidden');
    setInert($('.topbar'), false);
    setInert($('.bud-scroll'), false);
    // First unlock: this is where the vault is actually read. Later unlocks
    // land back on the view that was already rendered. Either way focus has to
    // be moved off the gate button that just went away — returning early on the
    // first unlock left it on <body>, so the very first Tab after opening the
    // plugin started from the top of Obsidian rather than from the view.
    if (!S.loaded) await connectVault();
    const h = $(`#view-${S.view} h1`);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  }
  $('#gateEnter').addEventListener('click', () => { unlockGate(); });
  /* Re-lock the moment Obsidian goes to the background, so the numbers are
     already gone by the time iOS/Android takes its app-switcher screenshot —
     and so reopening the app asks for the tap again, which is the whole point
     of the feature. Fires for the window, not for switching Obsidian tabs. */
  view.registerDomEvent(document, 'visibilitychange', () => {
    if (document.hidden && plugin.settings.privacyLock) lockGate();
  });

  /* Dirty flags are only set on `change`, which fires on blur — so a field
     being typed into right now counts as neither clean nor dirty. Without this
     an external file change (iCloud, Obsidian Sync) sails past hasDirty() and
     reloads the vault out from under a half-entered value, replacing the DOM
     and popping a toast for no reason the reader can see. Treat "a field in
     this view has focus" and "a keystroke landed a moment ago" as editing. */
  let lastInputAt = 0;
  view.registerDomEvent(root, 'input', () => { lastInputAt = Date.now(); });
  function isEditing() {
    const a = document.activeElement;
    // INPUT/TEXTAREA only — deliberately not SELECT. A <select> keeps focus
    // indefinitely after a value is picked, so treating it as "mid-edit" would
    // suppress reloads forever for anyone who touched a filter and walked away.
    if (a && root.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return true;
    return Date.now() - lastInputAt < 3000;
  }

  /* Reload when budget files change on disk (sync, manual edits) — but never
     while there are unsaved edits in the view, and not for our own writes.

     "Never while dirty" means DEFER, not discard. Obsidian emits nothing
     further for a change it has already delivered, so every bare `return` on
     this path is permanent: the file changed, we declined to read it, and
     nothing will ever ask again. The view then sits on stale data until
     someone happens to hit Reload by hand. That was already understood for the
     mid-edit case, which has always rescheduled — but the dirty case dropped,
     and it is the one that lasts. `hasDirty()` covers an abandoned import
     review (S.pendingImport) and any unsaved draft, which can stay true for
     the rest of the session.

     Backing off rather than polling at a fixed interval for the same reason:
     the wait can be very long, and a 1.5s timer that never converges runs for
     as long as the app is open. Doubling to a half-minute ceiling costs
     nothing and still picks the change up promptly once the view goes clean. */
  const RELOAD_RETRY_MAX = 30000;
  let reloadTimer = null;
  function scheduleReload(delay) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      /* Another of OUR writes landed during the debounce. This one really is
         discarded rather than deferred: it is our own echo, the state already
         matches disk, and retrying would reload the vault and pop the toast
         after every single save. */
      if (Date.now() - ctx.lastWriteAt() < 2000) return;
      // Unsaved work in the view — come back for this change later.
      if (hasDirty()) return scheduleReload(Math.min(delay * 2, RELOAD_RETRY_MAX));
      // Mid-edit: come back later rather than dropping the change on the floor.
      if (isEditing()) return scheduleReload(1500);
      await connectVault();
      if (S.loaded) toast('Reloaded — files changed in the vault');
    }, delay);
  }
  const onFsChange = (file) => {
    const path = file?.path || '';
    const bp = ctx.basePath();
    if (path !== bp && !path.startsWith(bp + '/')) return;
    if (Date.now() - ctx.lastWriteAt() < 2000) return;
    /* No hasDirty() gate here — scheduleReload owns that decision now, so the
       change is remembered and retried instead of being dropped at the door. */
    scheduleReload(800);
  };
  view.registerEvent(vault.on('modify', onFsChange));
  view.registerEvent(vault.on('create', onFsChange));
  view.registerEvent(vault.on('delete', onFsChange));
  view.registerEvent(vault.on('rename', onFsChange));

  /* An account or category note renamed in Obsidian's OWN file explorer.
     Obsidian repairs every `[[wikilink]]` pointing at it, which covers the
     note_for key a budget note carries — but not note_subject, which is the
     key this plugin actually reads. Left alone, renaming "Cheque" to "Current
     account" would leave its notes looking correctly linked in the graph and
     attached to nothing at all in here.

     Only these two kinds: they are the ones whose identity IS a file, so a
     rename is an event there is something to observe. Debts, assets, services
     and owed entries are table rows, renamed by editing a cell in a markdown
     file the watcher cannot read intent from — those are caught after the fact
     by the "unmatched" badge on the Notes page instead. */
  view.registerEvent(vault.on('rename', async (file, oldPath) => {
    if (!S.loaded) return;
    const move = classifyRename(ctx.basePath(), oldPath, file?.path, S.categories);
    if (!move) return;
    let moved = 0;
    /* Reported rather than swallowed: a bare `return` here used to drop a
       failed re-point on the floor with nothing on screen to say a rename just
       silently orphaned a note's note_subject. The rename itself already
       happened in Obsidian — this is only the plugin's own follow-up write —
       so the early return still stands, just no longer silent about it. */
    try { moved = await ctx.repointNotes(move.kind, move.from, move.to); } catch (e) {
      return toast(`Could not re-point notes for the "${move.from}" → "${move.to}" rename (${e.message || e})`, true);
    }
    if (!moved) return;
    toast(`Re-pointed ${moved} note${moved === 1 ? '' : 's'} from "${move.from}" to "${move.to}"`);
    if (S.view === 'notes') ctx.renderNotes();
  }));

  view.registerEvent(app.workspace.on('css-change', applyTheme));

  /* ------------------------------- wiring -------------------------------- */
  /* Three controls open this plugin's own settings tab — the topbar gear, the
     avatar and the drawer link. One function so a change to how settings are
     reached (a different tab id, a guard, a close-the-drawer-first step) lands
     in one place rather than two of the three. */
  function openPluginSettings() {
    app.setting.open();
    app.setting.openTabById('budget-app');
  }

  /* A drop target and its hidden <input type="file">, wired as one unit: click
     the zone to open the picker, drag onto it to drop, and either way the file
     goes to `handle`. Written out twice before — for the statement importer and
     the tax-document uploader — with the input's value reset present in both
     but easy to lose, and without it re-picking the SAME file fires no change
     event at all, so the second attempt silently does nothing. */
  function wireDropZone(zoneSel, inputSel, handle) {
    const zone = $(zoneSel);
    const input = $(inputSel);
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', e => {
      if (e.target.files[0]) handle(e.target.files[0]);
      e.target.value = '';
    });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]);
    });
  }

  $('#openSettingsBtn').addEventListener('click', openPluginSettings);
  // Logo doubles as "home" — no-op until the vault has loaded, same guard the
  // drawer links use (there is no dashboard to show on the connect screen).
  $('#brandHome').addEventListener('click', () => { if (S.loaded) switchView('dashboard'); });
  $('#topbarAvatar').addEventListener('click', openPluginSettings);
  // One-tap import from any view: go to Import, then open the file picker in the
  // same gesture (iOS blocks a picker opened outside the user-gesture task).
  // A pending review is left alone — the user came back to finish it, not to
  // throw it away by picking a second file.
  $('#topbarImport').addEventListener('click', () => {
    if (!S.loaded) return;
    switchView('import');
    if (!S.pendingImport) $('#fileInput').click();
  });
  // Same navigate-only shape as the Transactions-toolbar Report button —
  // the Report page owns its own options, no dialog here either.
  $('#topbarReport').addEventListener('click', () => { if (S.loaded) switchView('report'); });
  $('#pluginSettingsLink').addEventListener('click', () => { closeDrawer(); openPluginSettings(); });
  // Switching period rebuilds the budget draft for the new period, discarding
  // any unsaved edits — so confirm first when the Budget view is dirty.
  async function changePeriod(next) {
    if (S.view === 'budgets' && ctx.budgetDirty()) {
      const go = await confirmModal(app, {
        title: 'Unsaved budget changes',
        message: 'Switching period will discard your unsaved budget edits. Continue?',
        confirmText: 'Discard & switch',
      });
      if (!go) return;
      ctx.invalidateBudgetDraft();
    }
    S.period = next;
    render();
  }
  $('#prevPeriod').addEventListener('click', () => changePeriod(ctx.shiftPeriod(S.period, -1)));
  $('#nextPeriod').addEventListener('click', () => changePeriod(ctx.shiftPeriod(S.period, 1)));
  $('#currentPeriod').addEventListener('click', () => changePeriod(ctx.currentPeriod()));
  $('#menuBtn').addEventListener('click', () => $('#appDrawer').classList.contains('open') ? closeDrawer() : openDrawer());
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerOverlay').addEventListener('click', closeDrawer);
  view.registerDomEvent(document, 'keydown', e => {
    if (e.key === 'Escape' && root.isConnected && $('#appDrawer')?.classList.contains('open')) closeDrawer();
  });
  for (const b of $$('.drawer-link[data-view]')) {
    b.addEventListener('click', () => { if (S.loaded) switchView(b.dataset.view); else closeDrawer(); });
  }
  $('#reloadLink').addEventListener('click', async () => {
    if (!S.loaded) return closeDrawer();
    // Same guard connectVault() already gives the FIRST read of the vault —
    // a rejected reload here used to be an unhandled rejection with the
    // drawer left open and nothing on screen explaining why nothing moved.
    try {
      await doReloadFromDisk();
    } catch (e) {
      // reloadFromDisk() mutates state (invalidateBudgetDraft, S.pendingImport
      // = null, #importReview hidden) BEFORE the awaited loadVault() that can
      // actually reject — and loadVault()'s own sections each reset their
      // array before their own read resolves, so a rejected reload can leave
      // some sections already emptied while later ones still hold pre-reload
      // data. render() is NOT a "known-good" screen here — it repaints from
      // whatever S holds right now, which this catch has just established may
      // be a genuine mix of fresh, stale and emptied sections. Painting that
      // is still better than leaving the screen drawn from before the resets
      // ran (out of step with S underneath it), but it is a best-effort
      // picture of an admittedly incomplete state, not a claim that the
      // picture is correct. Guarded because render() painting a half-reset
      // state is exactly the kind of render() that is more likely to throw,
      // and a throw here — inside a catch that is already reporting a failure
      // — must not become a second, unhandled one on top of the first.
      closeDrawer();
      toast(`Could not reload from disk (${e.message || e})`, true);
      try {
        render();
      } catch (renderErr) {
        console.error('Budget: render() failed while recovering from a failed reload', renderErr);
      }
      return;
    }
    closeDrawer(); render(); toast('Reloaded from disk');
  });
  $('#txSave').addEventListener('click', ctx.saveTransactions);
  $('#txAdd').addEventListener('click', ctx.addTransaction);
  $('#txExport').addEventListener('click', ctx.exportTransactions);
  // Navigates only — no dialog. The Report page owns its own options; see
  // views/report.js's header for why the brief moved it off a modal.
  $('#txReport').addEventListener('click', () => ctx.switchView('report'));
  $('#txDeleteFiltered').addEventListener('click', ctx.deleteFilteredTransactions);
  for (const id of ['txAccount', 'txCategory', 'txWholeHistory']) $('#' + id).addEventListener('change', ctx.renderTransactions);
  $('#txSearch').addEventListener('input', () => { clearTimeout(S._q); S._q = setTimeout(ctx.renderTransactions, 200); });
  $('#budSave').addEventListener('click', ctx.saveBudget);
  $('#budCopyPrev').addEventListener('click', ctx.copyPreviousBudget);
  $('#budAddCat').addEventListener('click', ctx.addNewCategory);
  /* Wrapped rather than passed by reference: addAccount now takes a defaults
     object, and a bare listener would hand it the MouseEvent. */
  $('#acctAdd').addEventListener('click', () => ctx.addAccount());
  /* Accounts' own filter controls. Debounced like the Transactions search, and
     for the same reason: each keystroke re-runs the whole page, reconciliation
     included. The state itself lives on S but its SHAPE belongs to accounts.js
     — hence going through ctx rather than writing S.acctView from here, which
     is how a half-built state object ends up bypassing the defaults. */
  $('#acctSearch').addEventListener('input', e => {
    const q = e.target.value;
    clearTimeout(S._acctQ);
    S._acctQ = setTimeout(() => ctx.acctSearch(q), 200);
  });
  $('#acctGroupToggle').addEventListener('click', () => ctx.acctToggleGroup());
  $('#savAdd').addEventListener('click', () => ctx.addAccount());
  /* Creating an account is reachable from Transactions and from the import
     review, not only from the two pages that list accounts — every path that
     asks the reader to PICK one has to offer making one, or an empty vault
     dead-ends on "add an account first" with no account page in sight.
     `checking` because both of those screens are about bank statements. */
  $('#txNewAccount').addEventListener('click', () => ctx.addAccount({ type: 'checking' }));
  $('#assetSave').addEventListener('click', ctx.saveAssets);
  $('#assetAdd').addEventListener('click', ctx.addAsset);
  $('#debtSave').addEventListener('click', ctx.saveDebts);
  $('#debtAdd').addEventListener('click', ctx.addDebt);
  // The planner's extra/method are a what-if, not saved state — recompute the
  // plan panels only, never the table the reader may be mid-edit in.
  $('#debtExtra').addEventListener('input', ctx.replan);
  $('#debtStrategy').addEventListener('change', ctx.replan);
  // The chart range IS saved state — unlike the two above it says nothing
  // about the household, only about how this reader likes to look at it.
  $('#debtRange').addEventListener('change', async e => {
    plugin.settings.chartDebtRange = e.target.value;
    /* Guarded like every other write in this file: a rejected saveSettings()
       used to be an unhandled rejection. The chart still redraws either way —
       the range picked is real in memory even if it did not reach data.json,
       and refusing to redraw over a persistence failure would make one problem
       look like two. */
    try {
      await plugin.saveSettings();
    } catch (err) {
      toast(`Could not save that setting (${err.message || err})`, true);
    }
    ctx.replan();
  });
  $('#noteAdd').addEventListener('click', () => ctx.addNote());
  $('#noteAbout').addEventListener('change', e => { S.noteFilter.about = e.target.value; ctx.renderNotes(); });
  // Debounced like the Transactions and Accounts searches, and for the same
  // reason: each keystroke rebuilds the whole list.
  $('#noteSearch').addEventListener('input', e => {
    const q = e.target.value;
    clearTimeout(S._noteQ);
    S._noteQ = setTimeout(() => { S.noteFilter.q = q; ctx.renderNotes(); }, 200);
  });
  $('#reportCreate').addEventListener('click', ctx.createReport);
  $('#reportCopyNow').addEventListener('click', ctx.copyReportNow);
  $('#reportOpen').addEventListener('click', ctx.openReport);
  $('#reportReveal').addEventListener('click', ctx.revealReportFolder);
  $('#reportCopy').addEventListener('click', ctx.copyReport);
  $('#reportCopyJson').addEventListener('click', ctx.copyReportJson);
  // 'change', not 'input' — fires on blur, same as tax.js's own text fields,
  // so the report page never rebuilds the field the reader is still typing
  // into (views/report.js's own header explains why the folder input is the
  // one static control on that page).
  $('#reportFolder').addEventListener('change', e => ctx.setReportFolder(e.target.value.trim()));
  $('#planSave').addEventListener('click', ctx.savePlan);
  $('#planNew').addEventListener('click', ctx.newPlan);
  $('#planDelete').addEventListener('click', ctx.deletePlan);
  $('#planStart').addEventListener('click', ctx.newPlan);
  $('#planAddSource').addEventListener('click', () => ctx.addSource());
  // Wrapped rather than passed bare: addEventListener hands the listener a
  // MouseEvent, and addEnvelope's second parameter is a suggested amount.
  $('#planAddEnvelope').addEventListener('click', () => ctx.addEnvelope());
  $('#owedSave').addEventListener('click', ctx.saveOwed);
  $('#owedAdd').addEventListener('click', ctx.addOwed);
  $('#svcSave').addEventListener('click', ctx.saveServices);
  $('#svcAdd').addEventListener('click', ctx.addService);
  $('#taxSave').addEventListener('click', ctx.saveTax);
  $('#taxAddStep').addEventListener('click', ctx.addTaxStep);
  $('#taxAddDoc').addEventListener('click', ctx.addTaxDoc);
  $('#taxAddFigure').addEventListener('click', ctx.addTaxFigure);
  $('#taxNewYear').addEventListener('click', ctx.newTaxYear);
  $('#taxDeleteYear').addEventListener('click', ctx.deleteTaxYear);
  $('#taxStart').addEventListener('click', ctx.startTax);
  $('#taxYearSel').addEventListener('change', e => ctx.changeTaxYear(e.target.value));
  wireDropZone('#taxDrop', '#taxFileInput', f => ctx.handleTaxFile(f));
  $('#impCommit').addEventListener('click', ctx.commitImport);
  $('#impRemap').addEventListener('click', ctx.remapImport);
  $('#impCancel').addEventListener('click', ctx.cancelImport);
  wireDropZone('#drop', '#fileInput', f => ctx.handleStatementFile(f));

  return {
    start: async () => {
      applyTheme();
      if (plugin.settings.privacyLock) { lockGate(); return; }
      await connectVault();
    },
    /* Called from BudgetView.onClose. These four timers are scheduled by hand
       rather than through Obsidian's register* helpers, so nothing unwinds them
       automatically — and a reload timer that fires after contentEl.empty()
       re-reads the whole vault into a dead view and then throws on the first
       null query result. */
    destroy: () => {
      clearTimeout(reloadTimer);
      clearTimeout(S._q);
      clearTimeout(S._acctQ);
      clearTimeout(S._noteQ);
      const t = $('#toast');
      if (t) clearTimeout(t._h);
    },
    // Dirty-aware reload used by settings changes (plugin.reloadViews): decline
    // rather than silently discard unsaved edits. The file watcher calls
    // connectVault directly (it already gates on hasDirty before scheduling).
    reload: async () => {
      if (hasDirty()) {
        new Notice('Budget: unsaved changes — reload skipped. Save (or "Reload from disk" to discard), then retry.', 7000);
        return;
      }
      await connectVault();
    },
    applyTheme,
    /* The shell is translated ONCE, at mount, by the applyDom() call up in
       mountApp. Changing the language therefore did nothing to a view that was
       already open: the setting was written, the live language moved, the data
       reloaded — and the drawer, top bar and page titles went on showing
       whatever language they were mounted in, until the view was closed and
       reopened. Which reads, entirely reasonably, as "I changed it and nothing
       happened".

       Re-running applyDom over the mounted root fixes that: every translated
       element still carries its data-i18n attribute (the pass reads them, it
       does not consume them), so the shell can be re-translated in place as
       many times as the language changes. Same shape as applyTheme and
       applyPrivacyLock above — a settings change that has to act on open views
       immediately rather than at the next mount. */
    /* Two halves, because the interface is built two different ways. The shell
       is static markup translated in place by applyDom; the view bodies are
       rebuilt from scratch by render(), which picks up the new language simply
       by running again. render() rather than reload(): the strings do not come
       from the vault, and reload() DECLINES when there are unsaved edits —
       which would leave someone who changed the language mid-edit looking at
       the old one with no idea why. */
    applyLanguage: () => { applyDom(root); render(); },
    /* Toggling the setting acts on open views immediately: switching it off
       lifts a gate the user is currently staring at (rather than stranding
       them behind it), switching it on covers the numbers right away. */
    applyPrivacyLock: () => {
      if (plugin.settings.privacyLock) lockGate();
      else unlockGate();
    },
    /* Housekeeping, reached from the command palette rather than a page: it is
       run once in a while and deliberately, and a button for it would sit on
       one of these screens forever explaining itself to users who never need
       it. Reads the loaded state, so it needs a view that has connected. */
    cleanupRules: () => ctx.cleanupRules(),
    /* The command palette's route to the import screen — see applyInputMode
       above for why manual mode has to leave one open.

       Parks the route rather than refusing when the vault has not finished
       loading. A command run from a cold start opens the view and arrives
       here microseconds later, long before connectVault() has read the
       folder; switching pages then would show an empty Import screen behind
       the connect gate. connectVault ends by switching to S.view, so setting
       it is enough — the reader lands on Import the moment the vault is up,
       which is what they asked for rather than a Notice telling them to try
       again. */
    showImport: () => {
      if (S.loaded) switchView('import');
      else S.view = 'import';
    },
    /* Same parking trick as showImport, for any view. The setup wizard uses it
       to land a brand-new CSV vault on Budgets rather than on a Dashboard with
       nothing in it: budgetDraft() seeds a zero row per category, so Budgets
       opens already listing every category the reader just chose — which is
       exactly what the wizard's closing sentence tells them to do first —
       while the Dashboard at that moment is four zeros and three empty states,
       and reads as a setup that did not take. */
    parkView: (v) => {
      if (S.loaded) switchView(v);
      else S.view = v;
    },
    hasDirty,
  };
}

module.exports = { mountApp, formatMoney, classifyRename, reloadFromDisk, applyInputMode };
