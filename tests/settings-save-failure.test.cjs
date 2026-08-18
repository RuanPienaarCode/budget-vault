'use strict';
/* plugin.saveSettings() outside the register* pipeline — the settings tab's
   five onChange handlers and main.js's own first-run "adopt silently" path.

   Companion to tests/save-failure.test.cjs (which drives the dashboard pills
   and the export-folder setting over the shared ctx harness). Neither of
   those two surfaces goes through registerLoad/ctx, so they need their own
   minimal stand-ins here instead:

     - BudgetSettingTab is a plain Obsidian PluginSettingTab. It is driven
       against a hand-rolled Setting stub (addText/addDropdown/addToggle),
       the same shape tests/onboarding-render.test.cjs already uses for the
       wizard's own Setting-builder calls.
     - BudgetPlugin.onload()'s onLayoutReady callback is never awaited by
       Obsidian, so this calls the captured callback directly to get a
       promise worth asserting on — same "fire and forget" reasoning as the
       click-driven cases in save-failure.test.cjs.

   Before this suite, all six call sites called `await …saveSettings()` (or,
   in main.js's case, `await this.saveSettings()`) with no try/catch: a
   rejected write was an unhandled promise rejection with nothing on screen,
   and — for the settings tab — the reload/theme-refresh that was supposed to
   follow never ran either, since the throw skipped straight past it.

     node tests/settings-save-failure.test.cjs */

const assert = require('assert');
const Module = require('module');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* --------------------------------- DOM ---------------------------------- */
/* Just enough of Obsidian's Setting builder to capture each control's
   onChange — nothing here renders visibly, since no assertion below reads
   text off the page. */
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.disabled = false;
    this.value = '';
    this.checked = false;
  }
  createDiv() { const n = new FakeEl('div'); this.children.push(n); return n; }
  createEl(tag) { const n = new FakeEl(tag); this.children.push(n); return n; }
  appendChild(n) { this.children.push(n); return n; }
  empty() { this.children = []; }
}
global.document = { createElement: tag => new FakeEl(tag) };

/* ------------------------------ obsidian -------------------------------- */
const NOTICES = [];
class Notice { constructor(m, d) { NOTICES.push({ msg: String(m), duration: d }); } }
class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new FakeEl('div'); }
}
class Setting {
  constructor(container) {
    this.containerEl = new FakeEl('div');
    container.appendChild(this.containerEl);
  }
  setName() { return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addText(cb) {
    const el = new FakeEl('input');
    this.containerEl.appendChild(el);
    const c = {
      inputEl: el,
      setPlaceholder(v) { el.attrs.placeholder = v; return c; },
      setValue(v) { el.value = v == null ? '' : String(v); return c; },
      onChange(fn) { el._onChange = fn; return c; },
    };
    cb(c);
    return this;
  }
  addDropdown(cb) {
    const el = new FakeEl('select');
    this.containerEl.appendChild(el);
    const c = {
      selectEl: el,
      addOption(v, l) { (el._options || (el._options = [])).push([String(v), l]); return c; },
      setValue(v) { el.value = String(v); return c; },
      onChange(fn) { el._onChange = fn; return c; },
    };
    cb(c);
    return this;
  }
  addToggle(cb) {
    const el = new FakeEl('input');
    this.containerEl.appendChild(el);
    const c = {
      toggleEl: el,
      setValue(v) { el.checked = !!v; return c; },
      onChange(fn) { el._onChange = fn; return c; },
    };
    cb(c);
    return this;
  }
  addButton(cb) {
    const el = new FakeEl('button');
    this.containerEl.appendChild(el);
    const c = {
      buttonEl: el,
      setButtonText() { return c; },
      setCta() { return c; },
      setWarning() { return c; },
      onClick(fn) { el._onClick = fn; return c; },
    };
    cb(c);
    return this;
  }
}
class Plugin {
  registerView() {}
  addRibbonIcon() {}
  addCommand() {}
  addSettingTab() {}
}

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') {
    return {
      setIcon() {},
      normalizePath: p => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').normalize('NFC'),
      Notice, Modal: class {}, Setting, PluginSettingTab, Plugin,
      ItemView: class {}, TFile: class {}, TFolder: class {},
    };
  }
  return origLoad.call(this, req, ...rest);
};

const { BudgetSettingTab } = require('../src/settings-tab');
const BudgetPlugin = require('../src/main.js');
const { DEFAULT_SETTINGS } = require('../src/constants');

/* ------------------------------- fixtures -------------------------------- */
/* A plugin object real enough for display() to run without throwing:
   readBudgetSettingsMd() resolves emptily (renderMdSettings is fired but
   never awaited by display(), so this only needs to not reject), and every
   other method display() calls is a plain recorder. */
function makePlugin(overrides = {}) {
  return {
    app: {},
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
    reloadViews: () => {},
    forEachView: () => {},
    readBudgetSettingsMd: async () => ({}),
    updateBudgetSettingsMd: async () => {},
    ...overrides,
  };
}

/* Finds the onChange-bearing control by walking the tab's containerEl tree in
   render order and returning the Nth text/dropdown/toggle control — brittle
   to reordering display(), which is exactly what should fail this test if
   display() is ever restructured without updating it. */
function controls(tab) {
  const out = [];
  const walk = el => {
    for (const c of el.children) {
      if (c._onChange) out.push(c);
      walk(c);
    }
  };
  walk(tab.containerEl);
  return out;
}

(async () => {
  /* ---- 1-5: the settings tab's five plugin-data onChange handlers ---- */
  const CASES = [
    {
      name: 'Budget folder', index: 0, value: 'Money/Budget',
      after: p => ok(p.settings.budgetFolder === 'Money/Budget', 'Budget folder: the typed value is still real in memory'),
      sideEffect: 'reloadViews',
    },
    {
      name: 'Theme', index: 1, value: 'dark',
      after: p => ok(p.settings.theme === 'dark', 'Theme: the picked value is still real in memory'),
      sideEffect: 'forEachView',
    },
    {
      name: 'Colour palette', index: 2, value: 'vault-green-dark',
      after: p => ok(p.settings.palette === 'vault-green-dark', 'Palette: the picked value is still real in memory'),
      sideEffect: 'forEachView',
    },
    {
      name: 'Open on startup', index: 3, value: true,
      after: p => ok(p.settings.openOnStartup === true, 'Open on startup: the toggled value is still real in memory'),
      sideEffect: null,
    },
    {
      name: 'Privacy splash screen', index: 4, value: true,
      after: p => ok(p.settings.privacyLock === true, 'Privacy splash screen: the toggled value is still real in memory'),
      sideEffect: 'forEachView',
    },
  ];

  for (const c of CASES) {
    let sideEffectRan = false;
    const plugin = makePlugin({
      saveSettings: async () => { throw new Error('simulated disk error'); },
      reloadViews: () => { if (c.sideEffect === 'reloadViews') sideEffectRan = true; },
      forEachView: () => { if (c.sideEffect === 'forEachView') sideEffectRan = true; },
    });
    const tab = new BudgetSettingTab(plugin.app, plugin);
    tab.display();
    const ctl = controls(tab)[c.index];
    ok(!!ctl, `${c.name}: display() renders a control with an onChange handler at index ${c.index}`);

    NOTICES.length = 0;
    await assert.doesNotReject(() => ctl._onChange(c.value),
      `${c.name}: a rejected saveSettings() must not escape as an unhandled rejection`);
    checks++;
    c.after(plugin);
    ok(NOTICES.some(n => n.msg === i18n.t('settings.err.save', { error: 'simulated disk error' })),
      `${c.name}: a failed save reports the shared settings-save error Notice, got ${JSON.stringify(NOTICES)}`);
    if (c.sideEffect) ok(sideEffectRan, `${c.name}: ${c.sideEffect}() still runs after a failed save`);

    // Retry: let the write through.
    NOTICES.length = 0;
    plugin.saveSettings = async () => {};
    await ctl._onChange(c.value);
    ok(!NOTICES.length, `${c.name}: a retried save that succeeds reports no error Notice`);
  }

  /* ---- 6: main.js's silent-adopt path (onLayoutReady, no i18n import in
     that file — see the raw string this asserts against). onload() never
     awaits the callback it hands to onLayoutReady, so this captures it and
     calls it directly. hasBudgetData() is forced true via getFileByPath so
     the guarded branch (not the "open the wizard" branch) is the one under
     test. ---- */
  {
    const layoutCallbacks = [];
    const app = {
      workspace: {
        onLayoutReady: cb => layoutCallbacks.push(cb),
        getLeavesOfType: () => [],
        on: () => {},
      },
      vault: {
        getFileByPath: () => ({ path: 'Budget/Settings.md' }),
        getFolderByPath: () => null,
      },
    };
    let stored = { onboarded: false, openOnStartup: false };
    const plugin = new BudgetPlugin();
    plugin.app = app;
    plugin.registerView = () => {};
    plugin.addRibbonIcon = () => {};
    plugin.addCommand = () => {};
    plugin.addSettingTab = () => {};
    plugin.loadData = async () => stored;
    plugin.saveData = async () => { throw new Error('simulated disk error'); };

    await plugin.onload();
    eq(layoutCallbacks.length, 1, 'main.js: exactly one onLayoutReady callback registered (openOnStartup is false)');

    NOTICES.length = 0;
    await assert.doesNotReject(() => layoutCallbacks[0](),
      'main.js: a rejected saveSettings() in the silent-adopt path must not escape as an unhandled rejection');
    checks++;
    ok(plugin.settings.onboarded === true, 'main.js: onboarded is still set in memory even though the write failed');
    ok(NOTICES.some(n => n.msg === `Budget: could not save that setting (simulated disk error)`),
      `main.js: a failed save reports its own Notice (no i18n import in this file), got ${JSON.stringify(NOTICES)}`);

    // Retry: let the write through.
    NOTICES.length = 0;
    plugin.saveData = async d => { stored = d; };
    await layoutCallbacks[0]();
    ok(!NOTICES.length, 'main.js: a retried save that succeeds reports no error Notice');
    ok(stored.onboarded === true, 'main.js: a retried save actually lands in data.json');
  }

  console.log(`PASS — plugin.saveSettings() fails out loud outside the register* pipeline (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
