'use strict';
/* Headless read API — app.plugins.plugins['budget-app'].api.

   Built for a SIBLING plugin (Vista's dashboard card today) that wants the
   Dashboard hero's own "left to spend" figure without re-deriving it from the
   vault files itself. A second reader of Settings.md/Categories/Budgets/
   Transactions is exactly the defect this repo keeps finding under a new
   name — "two figures derived by different rules" — so this module builds NO
   arithmetic of its own beyond the lines the Dashboard hero itself does
   (views/dashboard.js's renderHero): `available = bud.spend - used.spent`,
   and its no-budget test `noBudget = !(S.budgets[S.period] || []).length`.
   Everything else is periodFigures(p) (figures.js), read here exactly as the
   hero reads it. Those two lines are RE-SPELLED here, not shared — renderHero
   computes both inline — so a change to either in the hero (#85 included)
   has to be made here as well. tests/api.test.cjs holds the subtraction to
   periodFigures; tests/api-no-budget.test.cjs holds the no-budget test to the
   rendered hero, so a hero that moves without this file goes red there.

   THE CONTRACT (apiVersion 1)
     currentPeriod() resolves to exactly one of:
       null              the budget folder is not set up (no Settings.md and no
                         Categories/ — main.js's hasBudgetData()). Decided by
                         two path lookups; no file is read. A consumer does
                         whatever it would do without this plugin.
       { locked: true }  the privacy splash is on and has not been opened this
                         session. Nothing else, and NOTHING is read from the
                         vault to produce it (THE PRIVACY LOCK, below). A
                         consumer says it is locked; it must NOT fall back to
                         reading the budget files itself, or the lock hides
                         nothing.
       the figure        { start, end, asOf, label, budgeted, spent, left,
                           noBudget, over, currency, notes }
                         noBudget is true when the period has no budget rows —
                         the hero then reads "New period — nothing budgeted
                         yet" over what was spent — and `left` is null (there
                         is no budget for anything to be left of), while
                         budgeted (0) and spent still say what is known. Up to
                         1.49 there was no noBudget and left was −spent, which
                         Vista printed as "Over budget R X".
                         notes are the qualifier lines the hero prints beside
                         this figure — strings, one per printed line, in the
                         hero's order, in the household's language (HERO
                         NOTES, below).
     onChange(cb) → unsubscribe. cb() takes no arguments; re-read with
       currentPeriod(). Called after a change under the budget folder has been
       reloaded, and whenever the lock opens or closes. Never for a read the
       consumer made itself, never for a file change while locked (there is
       nothing it could be shown), never after this plugin has unloaded.

   THE PRIVACY LOCK
     settings.privacy.desc promises "Nothing is read from the vault until you
     tap", and wiz.finish.privacy "nothing is on show if someone glances at
     your vault". The Budget view kept both. This API kept neither until the
     2026-10-07 audit: with the splash on and the gate never opened it read
     every file in the budget folder and handed Vista's card left, budgeted,
     spent and the over-budget categories. The gate's own state is per view
     (controller.js's `locked`), and there may be no view at all, so the API
     reads a PLUGIN-level session flag instead:
       plugin.budgetUnlocked — false at load (main.js onload). True once a gate
         is opened (controller.js unlockGate → main.js setBudgetUnlocked).
         False again when a gate closes (lockGate — which is also what a newly
         opened view and the setting being switched on run); the moment
         Obsidian goes to the background, even with no Budget view open (the
         listener in buildApi — the splash's copy says "again whenever Obsidian
         goes to the background", and closing the view is not leaving the
         app); and whenever the splash setting is off, so switching it back on
         starts locked, as a freshly opened view does, rather than inheriting
         a tap from before.
     locked = settings.privacyLock && !plugin.budgetUnlocked. Every change of
     it notifies subscribers, so a figure already on a consumer's screen is
     re-read and replaced. A read in flight when the lock closes hands back
     { locked: true }, not the figure it was computing. The setting reaches
     this module through main.js saveData(), the one writer both of
     Obsidian's settings paths share (1.13's declarative tab never calls
     saveSettings()).

   HERO NOTES
     The hero prints up to six qualifiers beside its figure: set-aside, the
     assume-spent provision and netted refunds on one line, then what is dated
     later this period, what left an earmarked fund, and the foreign accounts
     held out. This file used to build `notes` from its own copy of the last
     one only, under a comment reading "Today that is exactly one" — so on the
     committed synthetic household the hero said "R 2 000 for savings ·
     includes R 500 already spent" and "R 1 500 more went out of your funds
     (1 transaction), which this budget does not count", and the API said
     nothing at all (2026-10-07 audit): Vista's "spent" carried a R 500
     provision with no word about it. Now both read ONE builder,
     heroQualifiers() in views/dashboard.js, and this file only groups its
     list into lines the way renderHero does — the parts of one line joined
     with ' · ' (renderHero's subLine, and its foreign note). That grouping is
     the third re-spelled line; tests/api-hero-caveats.test.cjs holds the
     notes to the hero as RENDERED over every committed fixture, so a hero
     that regroups its lines without this file goes red there.

   No view required. mountApp() in controller.js parses a DOM shell and wires
   every page's render/save handlers onto it — necessary for the UI, useless
   weight for a read-only figure. What periodFigures needs is five modules
   that touch no DOM at all: io (vault access), period (period maths +
   periodSummary/budgetTotals), load (loadVault), trend-math (periodFigures'
   own `trend` field reads periodSpend) and figures itself. Their registration
   order below is the same one controller.js uses, for the reason its own
   comment gives: "reordering these silently produces 'x is not a function' a
   whole screen away from the cause."

   views/dashboard.js is required for heroQualifiers alone — a pure export,
   not registerDashboard, which is never called here. Requiring it costs
   nothing in the plugin: main.js requires view.js (→ controller.js → every
   view) before this file, so the module is already evaluated by the time
   this line runs. Its module scope touches no DOM — tests/api.test.cjs
   requires this file in bare node, with no `document` at all. */

const registerIo = require('./io');
const registerPeriod = require('./period');
const registerLoad = require('./load');
const registerTrendMath = require('./trend-math');
const registerFigures = require('./figures');
const { heroQualifiers } = require('./views/dashboard');
const { formatAmount } = require('./currency');
const { localeFor } = require('./locale');

/* The S.settings defaults doLoadVault() relies on already being there before
   it starts patching individual keys off Settings.md's frontmatter — most
   keys are assigned unconditionally, but a few (month_start_day, currency)
   are only overwritten `if (fm.xxx)`, so a state that starts without a
   default disagrees with controller.js's mount the moment a hand-edited or
   pre-upgrade Settings.md omits one. Byte-identical to the literal inside
   controller.js's `const S = {…}` — tests/api-state-settings-parity.test.cjs
   holds the two together so this copy cannot drift from that one. */
const DEFAULT_STATE_SETTINGS = {
  month_start_day: 23, currency: 'R', country: 'za', language: 'en', input_mode: 'csv',
  period_days: 0, period_anchor: '', overspend_lag: 1, emergency_target_months: 6,
  owners: [], groups: [], nonessential_groups: [],
};

/* A headless ctx: the same four register* modules controller.js mounts,
   assembled onto a bare object with no DOM and no view. `ctx.provide`
   mirrors controller.js's collision guard — two modules publishing the same
   name is a wiring bug worth throwing on here too, not a reason to drop it
   just because there is no shell to have wired wrong. */
function buildCtx(plugin) {
  const ctx = {
    plugin, app: plugin.app, vault: plugin.app.vault,
    S: { settings: { ...DEFAULT_STATE_SETTINGS } },
  };
  ctx.provide = obj => {
    for (const k of Object.keys(obj)) {
      if (k in ctx) throw new Error(`Budget API: ctx.${k} is already defined — two modules are publishing the same name.`);
    }
    Object.assign(ctx, obj);
  };
  registerIo(ctx);         // basePath, readFile, mdFilesUnder, subfoldersUnder, lastWriteAt, …
  registerPeriod(ctx);     // currentPeriod, periodTitle, periodSummary, budgetTotals, …
  registerLoad(ctx);       // loadVault — same slot controller.js gives it, before trend-math/figures
  registerTrendMath(ctx);  // periodSpend — periodFigures' own `trend` field reads it
  registerFigures(ctx);    // periodFigures
  return ctx;
}

/* True once Settings.md or a Categories/ folder exists under the configured
   budget folder — main.js's own `hasBudgetData()`, re-derived off the ctx
   rather than called on the plugin directly so this module has no dependency
   on main.js's shape, only on the io seam every writer already goes through. */
function configured(ctx) {
  return !!ctx.vault.getFileByPath(ctx.relPath('Settings.md'))
    || !!ctx.vault.getFolderByPath(ctx.relPath('Categories'));
}

/* Categories over budget for the period, most over first. One rule
   (money-flow.js's budgetRowStatus, read through figures.js's
   budgetVsActualRows) — not a second "is this row over" test. */
function overCategories(rows) {
  return rows.filter(r => r.over)
    .map(r => ({ category: r.cat, budgeted: r.budget, spent: r.actual }))
    .sort((a, b) => (b.spent - b.budgeted) - (a.spent - a.budgeted));
}

/* The hero's own formatter, for a ctx that has no view. controller.js's
   money() is formatMoney(S.settings.currency, v, decimals,
   localeFor(S.settings.country)); currency.js's formatAmount is its
   byte-for-byte twin (tests/controller-money.test.cjs holds the two
   together), so a figure inside a note reads exactly as it does on screen —
   "R 2 000", not "R2000" or "R 2,000". */
function moneyFor(ctx) {
  return (v, decimals = 2) => formatAmount(ctx.S.settings.currency, v, decimals, localeFor(ctx.S.settings.country));
}

/* The caveats the hero prints beside this figure, as the lines it prints
   them on (HERO NOTES, in the header). heroQualifiers() hands back the
   qualifiers in print order, each tagged with its `line`; the parts of one
   line are joined with ' · ', as renderHero joins them, and lines keep the
   order they first appear in. Through i18n, inside the builder, so every
   sentence is the household's own — the string the Dashboard is showing on
   screen, not a second English-only copy of it. */
function heroNotes(F, money) {
  const order = [];
  const parts = new Map();
  for (const q of heroQualifiers(F, money)) {
    if (!parts.has(q.line)) { parts.set(q.line, []); order.push(q.line); }
    parts.get(q.line).push(q.text);
  }
  return order.map(line => parts.get(line).join(' · '));
}

function buildApi(plugin) {
  let ctx = null;
  const subscribers = new Set();
  const ensureCtx = () => { if (!ctx) ctx = buildCtx(plugin); return ctx; };
  /* Set by the plugin's own unload (registered further down). Everything that
     could still run afterwards — a debounced reload, a deferred registration,
     a late subscriber, a lock change — checks it, so the unloaded instance
     reads nothing and calls nobody. */
  let unloaded = false;

  /* ---- one read per change ----
     A subscriber is told "re-read with currentPeriod()" by reloadAndNotify,
     right after that function has read the whole budget folder — and
     currentPeriod() then read the whole folder again, so every change cost
     two full reads (2026-10-07 audit, follow-up; hundreds of files a read on
     a real vault). So currentPeriod() reuses the reload that has just
     finished, and only while nothing can have made it out of date:
       - no change under the budget folder since that read BEGAN — a change
         arriving mid-read means the read may have missed it, so it is never
         reused at all;
       - no write of the session flag or of data.json since (syncLock) — the
         lock may have moved, or a setting the figure depends on, and nothing
         read before a lock change is served after it;
       - not unloaded;
       - and not for long: FRESH_MS of ELAPSED time (performance.now, which a
         changed device clock cannot move, and which a test's pinned Date does
         not freeze). Long enough for a subscriber that re-reads the moment it
         is told — Vista's card calls currentPeriod() synchronously inside its
         onChange callback — and short enough that a reader coming back later
         reads the folder, as every reader did before.
     `generation` counts the events that make a completed read out of date;
     `fresh` is { at, generation } for the reload that set it. Locked, nothing
     is read either way: a lock change has already cleared `fresh`, and
     currentPeriod() answers the lock before it would look. */
  const FRESH_MS = 1000;
  const elapsedMs = () => ((typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? performance.now() : Date.now());
  let generation = 0;
  let fresh = null;
  function outOfDate() { generation++; fresh = null; }
  const reusable = () => !!fresh && fresh.generation === generation && elapsedMs() - fresh.at <= FRESH_MS;

  /* ---- the privacy lock (the header has the contract) ---- */
  const lockSetting = () => !!(plugin.settings && plugin.settings.privacyLock);
  const isLocked = () => lockSetting() && plugin.budgetUnlocked !== true;
  let lockedSeen = isLocked();

  /* Every subscriber, each on its own: a throwing one must not silence the
     rest, and an ASYNC one that rejects must not escape as an unhandled
     rejection — the try/catch this replaced only ever saw the promise, never
     its rejection (the audit's repro: one `async () => { throw … }`
     subscriber, one unhandled rejection per reload). Over a copy, so a
     callback that unsubscribes mid-loop changes nothing for the others. */
  function notify() {
    for (const cb of [...subscribers]) {
      try { Promise.resolve(cb()).catch(() => {}); } catch (e) { /* one bad listener must not silence the rest */ }
    }
  }

  /* Re-reads the lock and tells subscribers when it moved. Runs after every
     write of the session flag and of data.json (main.js saveData), so it has
     to be cheap and silent when nothing changed: saving the theme is not a
     lock event. With the splash setting off there is no gate session left to
     remember, so the flag is cleared — switching the setting back on then
     starts locked, as a freshly opened view does, instead of inheriting a tap
     from before it was switched off. */
  function syncLock() {
    /* Every write of the flag or of data.json, whether or not the lock moved:
       a settings change (the budget folder itself among them) can make a
       completed read out of date, and nothing read before a lock change is
       served after it (ONE READ PER CHANGE, below). */
    outOfDate();
    if (!lockSetting()) plugin.budgetUnlocked = false;
    const now = isLocked();
    if (now === lockedSeen) return;
    lockedSeen = now;
    if (!unloaded) notify();
  }
  function setUnlocked(open) {
    plugin.budgetUnlocked = open === true;
    syncLock();
  }

  /* Obsidian going to the background closes the session even when no Budget
     view is open to close its own gate: the view's listener (controller.js,
     the same `document.hidden && privacyLock` condition) only exists while a
     view does, so without this a gate opened, then a view closed, left the
     figure on Vista's card through every later trip to the background.
     Guarded like the watcher below — a bare-node host has no document and no
     registerDomEvent. */
  if (typeof document !== 'undefined' && typeof plugin.registerDomEvent === 'function') {
    plugin.registerDomEvent(document, 'visibilitychange', () => {
      if (document.hidden && lockSetting()) setUnlocked(false);
    });
  }

  /* One of the two places onChange fires (the other is a change of lock,
     syncLock above): after a reload this module itself decided to run (the
     vault watcher below, or a direct call in tests). currentPeriod() below
     reads the folder on every call too — always-fresh over cached-and-maybe-
     stale — except straight after this reload, which it reuses (ONE READ PER
     CHANGE, above); it never notifies: a subscriber asking "did anything
     change" would otherwise hear about its own read. Nobody listening,
     locked, or unloaded: nothing is read, because nothing could be shown. */
  async function reloadAndNotify() {
    if (unloaded || !subscribers.size || isLocked()) return;
    const started = generation;
    fresh = null;   // the state is about to be rebuilt; nothing is served from it mid-read
    await ensureCtx().loadVault();
    if (unloaded || isLocked()) return;   // unloaded or locked while reading: nothing to tell
    if (generation === started) fresh = { at: elapsedMs(), generation };
    notify();
  }

  /* ---- the vault watcher ----
     Real vault, real watcher — guarded so a harness vault with no `.on` (bare
     node tests, and any future non-Obsidian host) skips registration rather
     than throwing. Scoped to the budget folder and debounced 800ms, the same
     window controller.js's own watcher uses for the same reason: a sync
     client delivers a folder's files as a burst of individual events, not
     one. There is deliberately NO ctx.lastWriteAt() guard here: controller.js
     skips the view's own saves because the view already holds that state, but
     this ctx is a separate one that has not seen the write — a subscriber must
     hear about a save made in the Budget view.

     Registered on the FIRST subscriber, not in onload. In onload it ran on
     every install whether or not anything ever subscribed, and one change
     under the budget folder re-read the whole folder 800ms later for no
     listener at all (the 2026-10-07 audit: every file in the budget folder,
     hundreds of reads on a real vault, with the lock on and no view open). And registered inside onLayoutReady, because
     Obsidian's own typings for Vault.on('create') say it also fires for every
     existing file while the vault first loads, unless the handler is
     registered inside Workspace.onLayoutReady — a full re-read per launch.
     registerEvent after onload is still undone at unload: Component.register
     only queues the undo (Obsidian 1.13.7 app.js). With every subscriber gone
     the handlers stay registered but schedule nothing. */
  let timer = null;
  let watching = false;
  function scheduleReload() {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; reloadAndNotify().catch(() => {}); }, 800);
  }
  /* Is this path the budget folder or under it? Both ends of a rename are
     asked: Obsidian's 'rename' hands over the file at its NEW path and the
     path it HAD, and only the new one was checked here — so an account file
     moved out to an archive folder, or a month file dragged away, left the
     budget without anything hearing it, and a sibling's card kept a figure
     that file had been part of (2026-10-07 audit, follow-up). */
  function underBudget(path) {
    if (typeof path !== 'string' || !path) return false;
    const bp = ensureCtx().basePath();
    return path === bp || path.startsWith(bp + '/');
  }
  function onFsChange(file, oldPath) {
    if (unloaded) return;
    if (!underBudget(file && file.path) && !underBudget(oldPath)) return;
    /* Before the subscriber and lock checks: whatever happens next, a read
       that began before this change is no longer the vault, and must not be
       handed to a reader who calls currentPeriod() directly. */
    outOfDate();
    if (!subscribers.size || isLocked()) return;
    scheduleReload();
  }
  function watch() {
    if (watching || unloaded) return;
    const vault = plugin.app.vault;
    if (typeof vault.on !== 'function' || typeof plugin.registerEvent !== 'function') return;
    watching = true;
    const attach = () => {
      if (unloaded) return;   // the plugin went before the layout was ready
      /* The old path is read off 'rename' alone: modify/create/delete hand
         over the file and nothing else, and a second argument there must
         never be mistaken for one. */
      plugin.registerEvent(vault.on('modify', file => onFsChange(file)));
      plugin.registerEvent(vault.on('create', file => onFsChange(file)));
      plugin.registerEvent(vault.on('delete', file => onFsChange(file)));
      plugin.registerEvent(vault.on('rename', (file, oldPath) => onFsChange(file, oldPath)));
    };
    const ws = plugin.app.workspace;
    if (ws && typeof ws.onLayoutReady === 'function') ws.onLayoutReady(attach);
    else attach();
  }

  /* Unload: Obsidian detaches every registerEvent handler itself, but this
     timer is a bare setTimeout and the subscriber set is this module's own.
     Without this, a reload scheduled just before the plugin was disabled or
     updated still ran 800ms later — a full read of the budget folder — and
     called into the unloaded instance's subscribers (the audit's repro: 21
     reads and a subscriber call after unload). */
  if (typeof plugin.register === 'function') {
    plugin.register(() => {
      unloaded = true;
      clearTimeout(timer);
      timer = null;
      subscribers.clear();
      outOfDate();
    });
  }

  async function currentPeriod() {
    const c = ensureCtx();
    if (!configured(c)) return null;
    if (isLocked()) return { locked: true };
    if (!reusable()) await c.loadVault();
    /* Locked while reading: the splash closed (Obsidian went to the
       background, a gate closed) after this read began. What a consumer is
       handed is decided at hand-over, not at request — the figure computed
       for a reader who is no longer there stays here. */
    if (isLocked()) return { locked: true };
    const p = c.currentPeriod();
    const F = c.periodFigures(p);
    /* views/dashboard.js's renderHero, verbatim: bud = F.budget (budgetTotals,
       which excludes set-aside envelopes — ISSUE 40), spent = F.used.spent
       (budgetUsed, which already carries the assume-spent provision). */
    const budgeted = F.budget.spend;
    const spent = F.used.spent;
    /* renderHero's no-budget test, verbatim: the period's budget ROWS, the
       Budget page's own test (renderShapeNote), so a budget file whose table
       is empty is no budget either. `left` is null then rather than −spent:
       "Over budget R X" against a budget of nothing is the claim the hero
       stopped making on 2026-09-29, and a consumer that printed every
       negative `left` as over budget made it for the hero. `over` needs no
       such guard — budgetRowStatus never calls a row over a budget of 0. */
    const noBudget = !(c.S.budgets[p] || []).length;
    const symbol = c.S.settings.currency;
    const code = c.S.settings.currency_code;
    return {
      start: F.range.start, end: F.range.end, asOf: F.summary.asOf, label: c.periodTitle(p),
      budgeted, spent, left: noBudget ? null : budgeted - spent, noBudget,
      over: overCategories(F.rows),
      currency: code ? { symbol, code } : { symbol },
      notes: heroNotes(F, moneyFor(c)),
    };
  }

  return {
    apiVersion: 1,
    currentPeriod,
    onChange(cb) {
      // An unloaded instance will never notify again; registering a watcher
      // on it would only leak handlers onto a plugin Obsidian has let go of.
      if (unloaded) return () => false;
      subscribers.add(cb);
      watch();
      return () => subscribers.delete(cb);
    },
    /* Internal: the exact function the vault watcher above calls. Exposed so
       a host with no live `vault.on` (bare-node tests, and any future
       non-Obsidian embedding) can still exercise "a reload happened" without
       faking a filesystem event bus. Not part of the apiVersion 1 contract. */
    _reload: reloadAndNotify,
    /* Internal, for main.js only: the session flag's writer (the gate, through
       setBudgetUnlocked) and data.json's (saveData, where a toggled
       privacyLock arrives). Not part of the apiVersion 1 contract. */
    _setUnlocked: setUnlocked,
    _syncLock: syncLock,
  };
}

module.exports = { buildApi, DEFAULT_STATE_SETTINGS };
