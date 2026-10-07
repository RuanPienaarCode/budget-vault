'use strict';
/* The headless API and the privacy splash: app.plugins.plugins['budget-app'].api
   must hand a sibling plugin nothing the splash is hiding.

   settings.privacy.desc promises "Nothing is read from the vault until you
   tap", and wiz.finish.privacy "nothing is on show if someone glances at your
   vault". The Budget view kept both promises and the API kept neither. The
   2026-10-07 audit called api.currentPeriod() with privacyLock on and the gate
   never opened — no view, nobody had tapped anything — and got the hero's
   figure back (left, budgeted, spent, the over-budget categories) after every
   file in the budget folder had been read. That payload is what Vista's
   Budget card prints.

   Driven through the REAL plugin class (main.js onload builds the API) and the
   REAL api.js over the committed synthetic household. Obsidian's Plugin base
   is stood in for by the Component lifecycle as read in its 1.13.7 app.js:
   register() queues a callback, registerEvent()/registerDomEvent() queue their
   own undo, unload() runs the queue last-first.

   What this suite pins:
     1. locked at load: exactly { locked: true }, and ZERO file reads.
     2. NEGATIVE CONTROL: the same vault after the gate's own hook
        (setBudgetUnlocked(true)) answers the hero's figure, so (1) is the lock
        and not a broken fixture.
     3. lockGate's hook closes it again: { locked: true }, no new reads.
     4. Obsidian going to the background closes it with NO Budget view open
        (the API's own visibilitychange listener), as the splash's own copy
        promises ("again whenever Obsidian goes to the background").
     5. a read already in flight when the lock closes hands back the lock, not
        the figure it was halfway through computing.
     6. subscribers hear every change of lock state, and only changes.
     7. the splash setting: off → the figure whatever the session flag says;
        toggled through saveData() — Obsidian 1.13's settings path, which never
        calls saveSettings() — subscribers still hear it; switched back on →
        locked again rather than inheriting an earlier tap.
     8. a vault change while locked reads nothing and tells nobody.
     9. an unconfigured budget folder is still null (Vista's documented "fall
        back to your own reader"), lock or no lock — there is no budget to hide.
    10. the two gate hooks exist in controller.js. mountApp is not mountable in
        bare node (tests/reload-from-disk.test.cjs's header says why), so the
        calls are pinned by name instead.

     node tests/api-privacy-lock.test.cjs
*/
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const H = require('./helpers/harness.cjs');
H.stubObsidian();
const base = require('obsidian');
const { pinClock } = require('./helpers/figures.cjs');
const { SEED, B, TODAY } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const settle = ms => new Promise(r => setTimeout(r, ms));

/* ---- Obsidian, as far as main.js onload and api.js reach into it ---- */
class Plugin {
  constructor() { this._events = []; this.saved = []; this.stored = {}; }
  register(cb) { this._events.push(cb); }
  registerEvent(ref) { this.register(() => ref.e.offref(ref)); }
  registerDomEvent(target, type, fn) { target.addEventListener(type, fn); this.register(() => target.removeEventListener(type, fn)); }
  unload() { while (this._events.length) this._events.pop()(); }
  registerView() {}
  addRibbonIcon() {}
  addCommand() {}
  addSettingTab() {}
  async loadData() { return this.stored; }
  async saveData(d) { this.saved.push(JSON.parse(JSON.stringify(d))); }
}
const prevLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { ...base, Plugin };
  return prevLoad.call(this, req, ...rest);
};
const BudgetPlugin = require('../src/main');

/* The window the gate's own visibilitychange listener watches. */
const docListeners = {};
global.document = {
  hidden: false,
  addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
  removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter(f => f !== fn); },
};
function goToBackground() {
  document.hidden = true;
  (docListeners.visibilitychange || []).slice().forEach(fn => fn());
  document.hidden = false;
}

function makeApp(files) {
  const vault = H.makeVault(files);
  const counts = { reads: 0 };
  const rawCached = vault.cachedRead.bind(vault);
  const rawRead = vault.read.bind(vault);
  vault.cachedRead = async f => { counts.reads++; return rawCached(f); };
  vault.read = async f => { counts.reads++; return rawRead(f); };
  const handlers = {};
  vault.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return { e: vault, name, fn }; };
  vault.offref = ref => { handlers[ref.name] = (handlers[ref.name] || []).filter(f => f !== ref.fn); };
  vault.emit = (name, p) => (handlers[name] || []).slice().forEach(fn => fn({ path: p }));
  const workspace = { onLayoutReady: cb => cb(), getLeavesOfType: () => [], on: () => ({}) };
  return { app: { vault, workspace }, counts };
}

async function loadPlugin(files, settings = {}) {
  const { app, counts } = makeApp(files);
  const plugin = new BudgetPlugin();
  plugin.app = app;
  plugin.stored = { budgetFolder: B, onboarded: true, openOnStartup: false, ...settings };
  await plugin.onload();
  return { plugin, api: plugin.api, counts, vault: app.vault };
}

(async () => {
  const unpin = pinClock(TODAY);
  try {
    /* The hero's own reading of the same household — what an unlocked API must
       hand back (tests/api.test.cjs pins the full parity; this is the anchor
       for the negative control). */
    const ctx2 = H.makeCtx(SEED, { budgetFolder: B });
    await H.loadInto(ctx2);
    const F = ctx2.periodFigures(ctx2.currentPeriod());
    const hero = { budgeted: F.budget.spend, spent: F.used.spent, left: F.budget.spend - F.used.spent };

    const { plugin, api, counts, vault } = await loadPlugin(SEED);

    /* ---- 1. locked at load ---- */
    eq(plugin.settings.privacyLock, true, 'sanity: the splash setting is on by default (constants.js)');
    eq(plugin.budgetUnlocked, false, 'the session flag is closed at load');
    eq(await api.currentPeriod(), { locked: true },
      'splash on, gate never opened: exactly { locked: true } — no figure, no period, no label');
    eq(counts.reads, 0, 'and not one file was read to produce it');

    /* ---- 2. NEGATIVE CONTROL: open the gate, the figure comes back ---- */
    plugin.setBudgetUnlocked(true);
    eq(plugin.budgetUnlocked, true, 'the gate hook opens the session flag');
    const open = await api.currentPeriod();
    ok(open && open.locked === undefined, 'an opened gate answers the figure, not the lock');
    eq({ budgeted: open.budgeted, spent: open.spent, left: open.left }, hero,
      "and it is the hero's own figure — the lock in (1) was the lock, not an empty fixture");
    ok(counts.reads > 0, 'reading it reads the vault, as it always did');

    /* ---- 3. lockGate closes it again ---- */
    let reads = counts.reads;
    plugin.setBudgetUnlocked(false);
    eq(await api.currentPeriod(), { locked: true }, 'closed again by the gate hook');
    eq(counts.reads, reads, 'with no new reads');

    /* ---- 4. background closes it, with no Budget view open ---- */
    plugin.setBudgetUnlocked(true);
    ok((await api.currentPeriod()).locked === undefined, 'sanity: open before going to the background');
    goToBackground();
    eq(plugin.budgetUnlocked, false, 'going to the background closes the session flag with no view open');
    reads = counts.reads;
    eq(await api.currentPeriod(), { locked: true }, 'and the API is locked again until the next tap');
    eq(counts.reads, reads, 'reading nothing');

    /* ---- 5. the lock closes while a read is in flight ---- */
    {
      plugin.setBudgetUnlocked(true);
      let release;
      const held = new Promise(r => { release = r; });
      const realCached = vault.cachedRead;
      vault.cachedRead = async f => { await held; return realCached(f); };
      const pending = api.currentPeriod();
      await settle(0);
      plugin.setBudgetUnlocked(false);   // the splash closes mid-read
      release();
      eq(await pending, { locked: true },
        'a read in flight when the lock closes hands back { locked: true }, not the figure it was computing');
      vault.cachedRead = realCached;
    }

    /* ---- 6. subscribers hear changes of lock state, and only changes ---- */
    {
      let heard = 0;
      const off = api.onChange(() => { heard++; });
      plugin.setBudgetUnlocked(true);
      eq(heard, 1, 'opening the gate tells subscribers, so a card showing "locked" re-reads');
      plugin.setBudgetUnlocked(true);
      eq(heard, 1, 'opening an already open gate is not a change');
      plugin.setBudgetUnlocked(false);
      eq(heard, 2, 'closing it tells them too, so a card showing the figure re-reads and hides it');
      goToBackground();
      eq(heard, 2, 'going to the background while already locked is not a change');
      off();
      plugin.setBudgetUnlocked(true);
      eq(heard, 2, 'unsubscribed: no longer told');
      plugin.setBudgetUnlocked(false);
    }

    /* ---- 7. the splash setting itself ---- */
    {
      let heard = 0;
      const off = api.onChange(() => { heard++; });
      const savedBefore = plugin.saved.length;

      // Obsidian 1.13 renders this tab from getSettingDefinitions(), and its
      // PluginSettingTab.setControlValue writes with plugin.saveData(settings)
      // directly — saveSettings() is never called on that path.
      plugin.settings.privacyLock = false;
      await plugin.saveData(plugin.settings);
      eq(plugin.saved.length, savedBefore + 1, 'the write still reaches data.json (the override hands it on)');
      eq(heard, 1, 'switching the splash off through saveData() tells subscribers');
      reads = counts.reads;
      const unlockedBySetting = await api.currentPeriod();
      eq({ budgeted: unlockedBySetting.budgeted, spent: unlockedBySetting.spent, left: unlockedBySetting.left }, hero,
        'splash off: the figure, though the gate was never opened this session');
      ok(counts.reads > reads, 'splash off reads the vault, as before this change');

      // The display() path (pre-1.13 Obsidian) goes through saveSettings().
      plugin.settings.privacyLock = true;
      await plugin.saveSettings();
      eq(heard, 2, 'switching it back on through saveSettings() tells subscribers');
      eq(await api.currentPeriod(), { locked: true }, 'splash on again: locked');

      // An earlier tap does not survive the setting being switched off and on.
      plugin.setBudgetUnlocked(true);
      eq(heard, 3, 'sanity: tapped open');
      plugin.settings.privacyLock = false;
      await plugin.saveSettings();
      eq(heard, 3, 'switching the splash off while already open changes nothing a subscriber can see');
      plugin.settings.privacyLock = true;
      await plugin.saveSettings();
      eq(heard, 4, 'switching it back on is a change');
      eq(await api.currentPeriod(), { locked: true },
        'and it starts locked, like a freshly opened view, instead of inheriting the earlier tap');

      // Another setting being saved is not a change of lock state.
      plugin.settings.theme = 'dark';
      await plugin.saveSettings();
      eq(heard, 4, 'saving an unrelated setting tells nobody');
      off();
    }

    /* ---- 8. a vault change while locked ---- */
    {
      let heard = 0;
      const off = api.onChange(() => { heard++; });
      reads = counts.reads;
      vault.emit('modify', `${B}/Settings.md`);
      vault.emit('create', `${B}/Categories/New.md`);
      await settle(1000);
      eq(counts.reads, reads, 'a budget-folder change while locked reads nothing');
      eq(heard, 0, 'and tells nobody — there is nothing they could be shown');

      // Heard while open, then the splash closes inside the 800ms debounce —
      // a sync delivery landing just before Obsidian goes to the background.
      plugin.setBudgetUnlocked(true);
      eq(heard, 1, 'sanity: opening the gate was heard');
      vault.emit('modify', `${B}/Settings.md`);
      plugin.setBudgetUnlocked(false);
      eq(heard, 2, 'sanity: closing it was heard');
      reads = counts.reads;
      await settle(1000);
      eq(counts.reads, reads, 'a reload scheduled while open but due after the lock closed reads nothing');
      eq(heard, 2, 'and notifies nobody');
      off();
    }

    /* ---- 9. unconfigured stays null ---- */
    {
      const bare = await loadPlugin({});
      eq(bare.plugin.settings.privacyLock, true, 'sanity: the splash is on here too');
      eq(await bare.api.currentPeriod(), null,
        'no budget folder set up: null (Vista falls back to its own reader), not { locked: true }');
      eq(bare.counts.reads, 0, 'decided without reading a file');
    }

    /* ---- 10. the gate hooks in controller.js ---- */
    {
      const src = fs.readFileSync(path.join(__dirname, '../src/controller.js'), 'utf8');
      const body = name => {
        const m = src.match(new RegExp(`function ${name}\\(\\) \\{([\\s\\S]*?)\\n  \\}`));
        return m ? m[1] : '';
      };
      ok(body('lockGate').length > 0 && body('unlockGate').length > 0, 'sanity: both gate functions were found');
      ok(/plugin\.setBudgetUnlocked\(false\)/.test(body('lockGate')),
        'lockGate tells the plugin the budget is covered (the API answers { locked: true } from then on)');
      ok(/plugin\.setBudgetUnlocked\(true\)/.test(body('unlockGate')),
        'unlockGate tells the plugin the gate was opened (the API answers the figure again)');
    }

    plugin.unload();
    console.log(`PASS — api-privacy-lock: the headless API honours the privacy splash (${checks} checks).`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
