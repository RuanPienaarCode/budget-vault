'use strict';
/* Headless read API — app.plugins.plugins['budget-app'].api.

   Built for a SIBLING plugin (Vista's dashboard card today) that wants the
   Dashboard hero's own "left to spend" figure without re-deriving it from the
   vault files itself. A second reader of Settings.md/Categories/Budgets/
   Transactions is exactly the defect this repo keeps finding under a new
   name — "two figures derived by different rules" — so this module builds NO
   arithmetic of its own beyond the two lines the Dashboard hero itself does
   (views/dashboard.js's renderHero: `available = bud.spend - used.spent`).
   Everything else is periodFigures(p) (figures.js), read here exactly as the
   hero reads it.

   No view required. mountApp() in controller.js parses a DOM shell and wires
   every page's render/save handlers onto it — necessary for the UI, useless
   weight for a read-only figure. What periodFigures needs is five modules
   that touch no DOM at all: io (vault access), period (period maths +
   periodSummary/budgetTotals), load (loadVault), trend-math (periodFigures'
   own `trend` field reads periodSpend) and figures itself. Their registration
   order below is the same one controller.js uses, for the reason its own
   comment gives: "reordering these silently produces 'x is not a function' a
   whole screen away from the cause." */

const registerIo = require('./io');
const registerPeriod = require('./period');
const registerLoad = require('./load');
const registerTrendMath = require('./trend-math');
const registerFigures = require('./figures');
const i18n = require('./i18n');

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

/* The caveats the hero itself prints beside this figure. Today that is
   exactly one: periodSummary (and everything built from it, including the
   figure this API hands back) holds foreign-currency accounts OUT, because a
   rand total cannot include a currency it was never told how to convert
   (currency.js's rule, dashboard.js's dash.foreignExcluded). Read through
   i18n.t so the sentence is the household's own — the same string the Dashboard
   is showing on screen right now, not a second English-only copy of it. */
function heroNotes(summary) {
  const notes = [];
  if (summary.foreign && summary.foreign.count) {
    notes.push(i18n.t('dash.foreignExcluded', {
      count: summary.foreign.count, symbols: summary.foreign.symbols.join(' · '),
    }));
  }
  return notes;
}

function buildApi(plugin) {
  let ctx = null;
  const subscribers = new Set();
  const ensureCtx = () => { if (!ctx) ctx = buildCtx(plugin); return ctx; };

  /* The one place onChange fires: after a reload this module itself decided
     to run (the vault watcher below, or a direct call in tests). currentPeriod()
     below also reloads on every call — always-fresh over cached-and-maybe-stale —
     but does not notify: a subscriber asking "did anything change" would
     otherwise hear about its own read. */
  async function reloadAndNotify() {
    await ensureCtx().loadVault();
    for (const cb of subscribers) {
      try { cb(); } catch (e) { /* one bad listener must not silence the rest */ }
    }
  }

  /* Real vault, real watcher — guarded so a harness vault with no `.on` (bare
     node tests, and any future non-Obsidian host) skips registration rather
     than throwing at construction. Scoped to the budget folder and debounced
     800ms, the same window controller.js's own watcher uses for the same
     reason: a sync client delivers a folder's files as a burst of individual
     events, not one. There is deliberately NO ctx.lastWriteAt() guard here:
     controller.js skips the view's own saves because the view already holds
     that state, but this ctx is a separate one that has not seen the write —
     a subscriber must hear about a save made in the Budget view. */
  if (typeof plugin.app.vault.on === 'function' && typeof plugin.registerEvent === 'function') {
    let timer = null;
    const scheduleReload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { reloadAndNotify().catch(() => {}); }, 800);
    };
    const onFsChange = file => {
      const path = (file && file.path) || '';
      const c = ensureCtx();
      const bp = c.basePath();
      if (path !== bp && !path.startsWith(bp + '/')) return;
      scheduleReload();
    };
    plugin.registerEvent(plugin.app.vault.on('modify', onFsChange));
    plugin.registerEvent(plugin.app.vault.on('create', onFsChange));
    plugin.registerEvent(plugin.app.vault.on('delete', onFsChange));
    plugin.registerEvent(plugin.app.vault.on('rename', onFsChange));
  }

  async function currentPeriod() {
    const c = ensureCtx();
    if (!configured(c)) return null;
    await c.loadVault();
    const p = c.currentPeriod();
    const F = c.periodFigures(p);
    /* views/dashboard.js's renderHero, verbatim: bud = F.budget (budgetTotals,
       which excludes set-aside envelopes — ISSUE 40), spent = F.used.spent
       (budgetUsed, which already carries the assume-spent provision). */
    const budgeted = F.budget.spend;
    const spent = F.used.spent;
    const symbol = c.S.settings.currency;
    const code = c.S.settings.currency_code;
    return {
      start: F.range.start, end: F.range.end, asOf: F.summary.asOf, label: c.periodTitle(p),
      budgeted, spent, left: budgeted - spent,
      over: overCategories(F.rows),
      currency: code ? { symbol, code } : { symbol },
      notes: heroNotes(F.summary),
    };
  }

  return {
    apiVersion: 1,
    currentPeriod,
    onChange(cb) { subscribers.add(cb); return () => subscribers.delete(cb); },
    /* Internal: the exact function the vault watcher above calls. Exposed so
       a host with no live `vault.on` (bare-node tests, and any future
       non-Obsidian embedding) can still exercise "a reload happened" without
       faking a filesystem event bus. Not part of the apiVersion 1 contract. */
    _reload: reloadAndNotify,
  };
}

module.exports = { buildApi, DEFAULT_STATE_SETTINGS };
