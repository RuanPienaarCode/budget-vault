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
const { PALETTE_PRESETS, DEFAULT_PALETTE } = require('./constants');

const registerIo = require('./io');
const registerPeriod = require('./period');
const registerLoad = require('./load');
const registerCategories = require('./categories');
const registerDashboard = require('./views/dashboard');
const registerTransactions = require('./views/transactions');
const registerBudgets = require('./views/budgets');
const registerAccounts = require('./views/accounts');
const registerSavings = require('./views/savings');
const registerAssets = require('./views/assets');
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
  const S = {
    loaded: false,
    settings: { month_start_day: 23, currency: 'R', country: 'za', language: 'en', period_days: 0, period_anchor: '' },
    categories: [],            // {name, type, color}
    accounts: [],              // account frontmatter + body
    budgets: {},               // 'YYYY-MM' -> [{category, type, amount, notes}]
    budgetMeta: {},
    txFiles: {},               // 'label/YYYY-MM' -> {label, month, rows, dirty}
    rules: [],                 // {pattern, category}
    assets: [],                // {name, type, value, valued, notes} — owned, but not an account
    assetsDirty: false,
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
  registerCategories(ctx);  // catSelect, lazyCatSelect, promptCreateCategory
  registerDashboard(ctx);
  registerTransactions(ctx);
  registerBudgets(ctx);
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
    disableSaveButtons();
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
    await reloadFromDisk(); closeDrawer(); render(); toast('Reloaded from disk');
  });
  $('#txSave').addEventListener('click', ctx.saveTransactions);
  $('#txAdd').addEventListener('click', ctx.addTransaction);
  $('#txExport').addEventListener('click', ctx.exportTransactions);
  for (const id of ['txAccount', 'txCategory', 'txWholeHistory']) $('#' + id).addEventListener('change', ctx.renderTransactions);
  $('#txSearch').addEventListener('input', () => { clearTimeout(S._q); S._q = setTimeout(ctx.renderTransactions, 200); });
  $('#budSave').addEventListener('click', ctx.saveBudget);
  $('#budCopyPrev').addEventListener('click', ctx.copyPreviousBudget);
  $('#budAddCat').addEventListener('click', ctx.addNewCategory);
  /* Wrapped rather than passed by reference: addAccount now takes a defaults
     object, and a bare listener would hand it the MouseEvent. */
  $('#acctAdd').addEventListener('click', () => ctx.addAccount());
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
    await plugin.saveSettings();
    ctx.replan();
  });
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
  wireDropZone('#taxDrop', '#taxFileInput', f => ctx.handleTaxFile(f));
  $('#impCommit').addEventListener('click', ctx.commitImport);
  $('#impRemap').addEventListener('click', ctx.remapImport);
  wireDropZone('#drop', '#fileInput', f => ctx.handleStatementFile(f));

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
    hasDirty,
  };
}

module.exports = { mountApp };
