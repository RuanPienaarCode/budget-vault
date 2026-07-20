'use strict';
/* App controller — mounts the shell into the view, assembles the shared ctx,
   registers every module onto it, and owns the app shell: view switching,
   drawer, theme, dirty tracking, vault-change watcher and event wiring. */

const { Notice } = require('obsidian');
const { el, setIco } = require('./util');
const { SHELL_HTML } = require('./shell');
const { confirmModal } = require('./modal');

const registerIo = require('./io');
const registerPeriod = require('./period');
const registerLoad = require('./load');
const registerCategories = require('./categories');
const registerDashboard = require('./views/dashboard');
const registerTransactions = require('./views/transactions');
const registerBudgets = require('./views/budgets');
const registerAccounts = require('./views/accounts');
const registerSavings = require('./views/savings');
const registerOwed = require('./views/owed');
const registerServices = require('./views/services');
const registerTax = require('./views/tax');
const registerImport = require('./views/import');

function mountApp(view) {
  const plugin = view.plugin;
  const app = view.app;
  const vault = app.vault;
  const root = view.contentEl;

  root.classList.add('budget-app-root');
  root.innerHTML = SHELL_HTML;
  root.querySelectorAll('span[data-ico]').forEach(sp => setIco(sp, sp.getAttribute('data-ico').split('|')));

  const $ = s => root.querySelector(s);
  const $$ = s => root.querySelectorAll(s);

  /* ------------------------------- state -------------------------------- */
  const S = {
    loaded: false,
    settings: { month_start_day: 23, currency: 'R' },
    categories: [],            // {name, type, color}
    accounts: [],              // account frontmatter + body
    budgets: {},               // 'YYYY-MM' -> [{category, type, amount, notes}]
    budgetMeta: {},
    txFiles: {},               // 'label/YYYY-MM' -> {label, month, rows, dirty}
    rules: [],                 // {pattern, category}
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

  /* South African Rand formatting — space thousands separator, comma decimals.
     The symbol comes from Settings.md (`currency`). */
  function money(v, decimals = 2) {
    const sign = v < 0 ? '-' : '';
    const parts = Math.abs(v).toFixed(decimals).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${S.settings.currency} ${sign}${parts[0]}${decimals > 0 ? ',' + parts[1] : ''}`;
  }
  const typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);

  /* --------------------------- assemble ctx ----------------------------- */
  const ctx = { plugin, app, vault, view, root, $, $$, S, toast, money, typeBadge };
  registerIo(ctx);          // basePath, readFile, writeFile, mdFilesIn, …
  registerPeriod(ctx);      // periodRange, currentPeriod, periodSummary, …
  registerLoad(ctx);        // loadVault
  registerCategories(ctx);  // catSelect, lazyCatSelect, promptCreateCategory
  registerDashboard(ctx);
  registerTransactions(ctx);
  registerBudgets(ctx);
  registerAccounts(ctx);
  registerSavings(ctx);
  registerOwed(ctx);
  registerServices(ctx);
  registerTax(ctx);
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
  }
  function render() {
    if (!S.loaded) return;
    $('#periodLabel').textContent = ctx.periodTitle(S.period);
    ({ dashboard: ctx.renderDashboard, transactions: ctx.renderTransactions, budgets: ctx.renderBudgets,
       savings: ctx.renderSavings, accounts: ctx.renderAccounts, owed: ctx.renderOwed, services: ctx.renderServices,
       tax: ctx.renderTax, import: () => {}, connect: () => {} })[S.view]();
  }
  ctx.switchView = switchView;
  ctx.render = render;

  /* ---------------------- drawer + theme (app shell) --------------------- */
  function openDrawer() {
    const d = $('#appDrawer');
    d.classList.add('open');
    d.removeAttribute('inert');                 // re-enter the tab / AT order
    $('#drawerOverlay').classList.add('open');
    $('#menuBtn').setAttribute('aria-expanded', 'true');
    $('#drawerClose').focus();                  // move focus into the drawer
  }
  function closeDrawer() {
    const d = $('#appDrawer');
    const wasOpen = d.classList.contains('open');
    d.classList.remove('open');
    d.setAttribute('inert', '');                // leave the tab / AT order
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
      : 'SB';
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

  /* --------------------------- dirty tracking ---------------------------- */
  function hasDirty() {
    return Object.values(S.txFiles).some(f => f.dirty) ||
      ($('#budSave') && !$('#budSave').disabled) ||
      S.owedDirty || S.servicesDirty || S.taxDirty || !!S.pendingImport;
  }

  /* ------------------------------ bootstrap ------------------------------ */
  async function connectVault() {
    // Every reload rebuilds S from disk; drop the per-period budget draft so a
    // stale pre-reload draft can never be saved over freshly-loaded data.
    ctx.invalidateBudgetDraft();
    try {
      await ctx.loadVault();
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
      $('#connectPathNote').innerHTML = '';
      $('#connectPathNote').append(
        'Looked in ', el('code', {}, ctx.basePath()),
        ' but found no Categories/ or Transactions/ inside it. Point the plugin at the Budget folder itself.');
      return;
    }
    S.loaded = true;
    applyIdentity();
    $('#view-connect').classList.add('hidden');
    $('#periodPill').classList.remove('hidden');
    switchView(S.view === 'connect' ? 'dashboard' : S.view);
    toast(`Loaded ${Object.values(S.txFiles).reduce((a, f) => a + f.rows.length, 0)} transactions`);
  }

  /* Reload when budget files change on disk (sync, manual edits) — but never
     while there are unsaved edits in the view, and not for our own writes. */
  let reloadTimer = null;
  const onFsChange = (file) => {
    const path = file?.path || '';
    const bp = ctx.basePath();
    if (path !== bp && !path.startsWith(bp + '/')) return;
    if (Date.now() - ctx.lastWriteAt() < 2000) return;
    if (hasDirty()) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      // Re-check at fire time: an edit (or another of our own writes) may have
      // landed during the 800ms debounce — don't clobber it.
      if (hasDirty() || Date.now() - ctx.lastWriteAt() < 2000) return;
      await connectVault();
      if (S.loaded) toast('Reloaded — files changed in the vault');
    }, 800);
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
  $('#topbarAvatar').addEventListener('click', () => {
    app.setting.open();
    app.setting.openTabById('budget-app');
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
    ctx.invalidateBudgetDraft();
    await ctx.loadVault(); closeDrawer(); render(); toast('Reloaded from disk');
  });
  $('#txSave').addEventListener('click', ctx.saveTransactions);
  for (const id of ['txAccount', 'txCategory', 'txWholeHistory']) $('#' + id).addEventListener('change', ctx.renderTransactions);
  $('#txSearch').addEventListener('input', () => { clearTimeout(S._q); S._q = setTimeout(ctx.renderTransactions, 200); });
  $('#budSave').addEventListener('click', ctx.saveBudget);
  $('#budCopyPrev').addEventListener('click', ctx.copyPreviousBudget);
  $('#budAddCat').addEventListener('click', ctx.addNewCategory);
  $('#owedSave').addEventListener('click', ctx.saveOwed);
  $('#owedAdd').addEventListener('click', ctx.addOwed);
  $('#svcSave').addEventListener('click', ctx.saveServices);
  $('#svcAdd').addEventListener('click', ctx.addService);
  $('#taxSave').addEventListener('click', ctx.saveTax);
  $('#taxAddStep').addEventListener('click', ctx.addTaxStep);
  $('#taxAddDoc').addEventListener('click', ctx.addTaxDoc);
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
    start: async () => { applyTheme(); await connectVault(); },
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
    hasDirty,
  };
}

module.exports = { mountApp };
