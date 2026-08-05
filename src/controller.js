'use strict';
/* App controller — mounts the shell into the view, assembles the shared ctx,
   registers every module onto it, and owns the app shell: view switching,
   drawer, theme, dirty tracking, vault-change watcher and event wiring. */

const { Notice } = require('obsidian');
const { el, setIco, setInert } = require('./util');
const { SHELL_HTML } = require('./shell');
const { confirmModal } = require('./modal');
const { localeFor } = require('./locale');

const registerIo = require('./io');
const registerPeriod = require('./period');
const registerLoad = require('./load');
const registerCategories = require('./categories');
const registerDashboard = require('./views/dashboard');
const registerTransactions = require('./views/transactions');
const registerBudgets = require('./views/budgets');
const registerAccounts = require('./views/accounts');
const registerSavings = require('./views/savings');
const registerDebts = require('./views/debts');
const registerOwed = require('./views/owed');
const registerServices = require('./views/services');
const registerTax = require('./views/tax');
const registerLoans = require('./views/loans');
const registerImport = require('./views/import');

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
  root.querySelectorAll('span[data-ico]').forEach(sp => setIco(sp, sp.getAttribute('data-ico').split('|')));

  const $ = s => root.querySelector(s);
  const $$ = s => root.querySelectorAll(s);

  /* ------------------------------- state -------------------------------- */
  const S = {
    loaded: false,
    settings: { month_start_day: 23, currency: 'R', country: 'za', period_type: 'monthly', period_anchor: '' },
    categories: [],            // {name, type, color}
    accounts: [],              // account frontmatter + body
    budgets: {},               // 'YYYY-MM' -> [{category, type, amount, notes}]
    budgetMeta: {},
    txFiles: {},               // 'label/YYYY-MM' -> {label, month, rows, dirty}
    rules: [],                 // {pattern, category}
    debts: [],                 // {name, lender, type, balance, original, rate, payment, extra, start, category, status, notes}
    debtsDirty: false,
    owed: [],                  // {person, amount, description, due, status}
    owedDirty: false,
    services: [],              // {name, provider, amount, cycle, next, category, active, notes}
    servicesDirty: false,
    tax: {},                   // 'YYYY' -> {fmRaw, taxpayer_type, assessment, deadlines, steps, docs}
    taxYear: null,
    taxDirty: false,
    period: null,
    view: 'dashboard',
    pendingImport: null,
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
  function money(v, decimals = 2) {
    const loc = locale();
    const sign = v < 0 ? '-' : '';
    const parts = Math.abs(v).toFixed(decimals).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, loc.thousands);
    return `${S.settings.currency} ${sign}${parts[0]}${decimals > 0 ? loc.decimal + parts[1] : ''}`;
  }
  const typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);

  /* --------------------------- assemble ctx ----------------------------- */
  const ctx = { plugin, app, vault, view, root, $, $$, S, toast, money, typeBadge, locale };

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
  registerCategories(ctx);  // catSelect, lazyCatSelect, promptCreateCategory
  registerDashboard(ctx);
  registerTransactions(ctx);
  registerBudgets(ctx);
  registerAccounts(ctx);
  registerSavings(ctx);
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
    ({ dashboard: ctx.renderDashboard, transactions: ctx.renderTransactions, budgets: ctx.renderBudgets,
       savings: ctx.renderSavings, accounts: ctx.renderAccounts, debts: ctx.renderDebts, owed: ctx.renderOwed,
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
    if (S.loaded && S.view === 'dashboard') ctx.renderTrend();
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
  /* The ONLY sanctioned way to re-read the vault. loadVault() is a whole-state
     reset — it replaces S.budgets, S.owed, S.services and S.tax and clears
     their dirty flags — so everything holding a pre-reload draft or snapshot
     has to be dropped in the same breath or it gets saved over the fresh data
     later. Three callers used to do this cleanup by hand, and the tax-year
     switch forgot, which silently discarded Owed/Services edits and left a
     stale budget draft armed behind an enabled Save button. */
  async function reloadFromDisk() {
    ctx.invalidateBudgetDraft();
    // The import review's dedup snapshot was taken against the pre-reload
    // transactions; keeping it would re-import every row as "new".
    S.pendingImport = null;
    $('#importReview').classList.add('hidden');
    await ctx.loadVault();
    for (const id of ['#budSave', '#debtSave', '#owedSave', '#svcSave', '#taxSave']) {
      const b = $(id);
      if (b) b.disabled = true;
    }
  }
  ctx.reloadFromDisk = reloadFromDisk;

  async function connectVault() {
    try {
      await reloadFromDisk();
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
     while there are unsaved edits in the view, and not for our own writes. */
  let reloadTimer = null;
  function scheduleReload(delay) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      // Re-check at fire time: an edit (or another of our own writes) may have
      // landed during the debounce — don't clobber it.
      if (Date.now() - ctx.lastWriteAt() < 2000) return;
      if (hasDirty()) return;
      // Mid-edit: come back later rather than dropping the change on the floor.
      // Returning here would strand the view on stale data indefinitely, since
      // no further event will be emitted for a change already delivered.
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
    if (hasDirty()) return;
    scheduleReload(800);
  };
  view.registerEvent(vault.on('modify', onFsChange));
  view.registerEvent(vault.on('create', onFsChange));
  view.registerEvent(vault.on('delete', onFsChange));
  view.registerEvent(vault.on('rename', onFsChange));
  view.registerEvent(app.workspace.on('css-change', applyTheme));

  /* ------------------------------- wiring -------------------------------- */
  $('#openSettingsBtn').addEventListener('click', () => {
    app.setting.open();
    app.setting.openTabById('budget-app');
  });
  // Logo doubles as "home" — no-op until the vault has loaded, same guard the
  // drawer links use (there is no dashboard to show on the connect screen).
  $('#brandHome').addEventListener('click', () => { if (S.loaded) switchView('dashboard'); });
  $('#topbarAvatar').addEventListener('click', () => {
    app.setting.open();
    app.setting.openTabById('budget-app');
  });
  // One-tap import from any view: go to Import, then open the file picker in the
  // same gesture (iOS blocks a picker opened outside the user-gesture task).
  // A pending review is left alone — the user came back to finish it, not to
  // throw it away by picking a second file.
  $('#topbarImport').addEventListener('click', () => {
    if (!S.loaded) return;
    switchView('import');
    if (!S.pendingImport) $('#fileInput').click();
  });
  $('#pluginSettingsLink').addEventListener('click', () => {
    closeDrawer();
    app.setting.open();
    app.setting.openTabById('budget-app');
  });
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
    await reloadFromDisk(); closeDrawer(); render(); toast('Reloaded from disk');
  });
  $('#txSave').addEventListener('click', ctx.saveTransactions);
  $('#txAdd').addEventListener('click', ctx.addTransaction);
  for (const id of ['txAccount', 'txCategory', 'txWholeHistory']) $('#' + id).addEventListener('change', ctx.renderTransactions);
  $('#txSearch').addEventListener('input', () => { clearTimeout(S._q); S._q = setTimeout(ctx.renderTransactions, 200); });
  $('#budSave').addEventListener('click', ctx.saveBudget);
  $('#budCopyPrev').addEventListener('click', ctx.copyPreviousBudget);
  $('#budAddCat').addEventListener('click', ctx.addNewCategory);
  $('#acctAdd').addEventListener('click', ctx.addAccount);
  $('#savAdd').addEventListener('click', ctx.addAccount);
  $('#debtSave').addEventListener('click', ctx.saveDebts);
  $('#debtAdd').addEventListener('click', ctx.addDebt);
  // The planner's extra/method are a what-if, not saved state — recompute the
  // plan panels only, never the table the reader may be mid-edit in.
  $('#debtExtra').addEventListener('input', ctx.replan);
  $('#debtStrategy').addEventListener('change', ctx.replan);
  $('#owedSave').addEventListener('click', ctx.saveOwed);
  $('#owedAdd').addEventListener('click', ctx.addOwed);
  $('#svcSave').addEventListener('click', ctx.saveServices);
  $('#svcAdd').addEventListener('click', ctx.addService);
  $('#taxSave').addEventListener('click', ctx.saveTax);
  $('#taxAddStep').addEventListener('click', ctx.addTaxStep);
  $('#taxAddDoc').addEventListener('click', ctx.addTaxDoc);
  $('#taxAddFigure').addEventListener('click', ctx.addTaxFigure);
  $('#taxNewYear').addEventListener('click', ctx.newTaxYear);
  $('#taxStart').addEventListener('click', ctx.startTax);
  $('#taxYearSel').addEventListener('change', e => ctx.changeTaxYear(e.target.value));
  const taxDrop = $('#taxDrop');
  taxDrop.addEventListener('click', () => $('#taxFileInput').click());
  $('#taxFileInput').addEventListener('change', e => { if (e.target.files[0]) ctx.handleTaxFile(e.target.files[0]); e.target.value = ''; });
  taxDrop.addEventListener('dragover', e => { e.preventDefault(); taxDrop.classList.add('dragover'); });
  taxDrop.addEventListener('dragleave', () => taxDrop.classList.remove('dragover'));
  taxDrop.addEventListener('drop', e => {
    e.preventDefault(); taxDrop.classList.remove('dragover');
    if (e.dataTransfer.files[0]) ctx.handleTaxFile(e.dataTransfer.files[0]);
  });
  $('#impCommit').addEventListener('click', ctx.commitImport);
  $('#impRemap').addEventListener('click', ctx.remapImport);
  const drop = $('#drop');
  drop.addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => { if (e.target.files[0]) ctx.handleCsvFile(e.target.files[0]); e.target.value = ''; });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('dragover');
    if (e.dataTransfer.files[0]) ctx.handleCsvFile(e.dataTransfer.files[0]);
  });

  return {
    start: async () => {
      applyTheme();
      if (plugin.settings.privacyLock) { lockGate(); return; }
      await connectVault();
    },
    /* Called from BudgetView.onClose. These three timers are scheduled by hand
       rather than through Obsidian's register* helpers, so nothing unwinds them
       automatically — and a reload timer that fires after contentEl.empty()
       re-reads the whole vault into a dead view and then throws on the first
       null query result. */
    destroy: () => {
      clearTimeout(reloadTimer);
      clearTimeout(S._q);
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
    /* Toggling the setting acts on open views immediately: switching it off
       lifts a gate the user is currently staring at (rather than stranding
       them behind it), switching it on covers the numbers right away. */
    applyPrivacyLock: () => {
      if (plugin.settings.privacyLock) lockGate();
      else unlockGate();
    },
    hasDirty,
  };
}

module.exports = { mountApp };
