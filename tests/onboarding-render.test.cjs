'use strict';
/* The setup wizard's SCREENS, as opposed to its period maths.

   onboarding-period.test.cjs drives the wizard's arithmetic and never touches
   a DOM, so every render_* method in the file was unguarded: a typo in a step
   that only a fresh install reaches throws inside Obsidian's modal, leaves a
   blank pane with no error the user can act on, and the whole build stays
   green. Nothing else in the suite opens the wizard either, and the browser
   preview harness does not mount it.

   So this walks BOTH paths — create and connect — one step at a time, and
   pins the things a new user's understanding actually rests on:

     1. every step renders, in both modes, without throwing,
     2. every step past the welcome screen is NAMED, not just numbered, and
        the counter's total matches the mode really being walked,
     3. bad input fails INLINE inside the modal rather than as a corner
        Notice that can be missed or land behind it,
     4. the payday step shows the convention worked out with the user's own
        day — a payday period is named after the month it ENDS in, which is
        underivable from a number field labelled "Payday",
     5. choosing a country actually updates the currency control the user is
        looking at, rather than only the value behind it,
     6. Cancel is not sitting between Back and Next,
     7. closing on the WELCOME screen does not retire the wizard for good,
        while closing past it does,
     8. the whole create path applies and writes the files the loader expects.

   Runs in bare node with a minimal DOM stub, same as inert-fallback.test.cjs.
   Wired into ./build.sh via the tests/*.test.cjs glob.
     node tests/onboarding-render.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* --------------------------------- DOM ---------------------------------- */
class FakeText {
  constructor(t) { this.textContent = String(t); this.children = []; }
}
class FakeEl {
  constructor(tag, o = {}) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this._cls = new Set();
    this._text = '';
    this._listeners = {};
    this.checked = false;
    this.value = '';
    if (o.text != null) this._text = String(o.text);
    if (o.cls) for (const c of [].concat(o.cls)) String(c).split(/\s+/).filter(Boolean).forEach(x => this._cls.add(x));
    if (o.type) { this.type = o.type; this.attrs.type = o.type; }
    if (o.attr) Object.assign(this.attrs, o.attr);
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  setText(v) { this.textContent = v; }
  appendText(v) { this.children.push(new FakeText(v)); return this; }
  empty() { this.children = []; this._text = ''; }
  createEl(tag, o = {}) { const n = new FakeEl(tag, o); this.children.push(n); return n; }
  createDiv(o) { return this.createEl('div', typeof o === 'string' ? { cls: o } : (o || {})); }
  createSpan(o) { return this.createEl('span', typeof o === 'string' ? { cls: o } : (o || {})); }
  appendChild(n) { this.children.push(n); return n; }
  addClass(...c) { c.forEach(x => this._cls.add(x)); }
  removeClass(...c) { c.forEach(x => this._cls.delete(x)); }
  hasClass(c) { return this._cls.has(c); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
  fire(ev) { for (const fn of this._listeners[ev] || []) fn({}); }
}
global.document = { createElement: tag => new FakeEl(tag) };

/* Depth-first walk, so assertions can look for a class anywhere in the step. */
function all(el, pred, out = []) {
  for (const c of el.children) {
    if (c instanceof FakeEl) { if (pred(c)) out.push(c); all(c, pred, out); }
  }
  return out;
}
const byClass = (el, cls) => all(el, e => e.hasClass(cls));
const textOf = (el, cls) => byClass(el, cls).map(e => e.textContent).join(' | ');

/* ------------------------------ obsidian -------------------------------- */
const NOTICES = [];
class Notice { constructor(m) { NOTICES.push(String(m)); } }
class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = new FakeEl('div');
    this.titleEl = new FakeEl('div');
  }
  open() { this.onOpen(); }
  close() { this.onClose(); }
}
class Setting {
  constructor(container) {
    this.settingEl = new FakeEl('div', { cls: 'setting-item' });
    this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    container.appendChild(this.settingEl);
  }
  setName(v) { this.infoEl.createDiv({ cls: 'setting-item-name', text: v }); return this; }
  setDesc(v) { this.infoEl.createDiv({ cls: 'setting-item-description', text: v }); return this; }
  addText(cb) {
    const el = this.controlEl.createEl('input');
    const c = {
      inputEl: el,
      setPlaceholder(v) { el.attrs.placeholder = v; return c; },
      setValue(v) { el.value = v == null ? '' : String(v); return c; },
      onChange(fn) { el._onChange = fn; return c; },
    };
    cb(c); return this;
  }
  addDropdown(cb) {
    const el = this.controlEl.createEl('select');
    el._options = [];
    const c = {
      selectEl: el,
      addOption(v, l) { el._options.push([String(v), l]); return c; },
      setValue(v) { el.value = String(v); return c; },
      onChange(fn) { el._onChange = fn; return c; },
    };
    cb(c); return this;
  }
  addButton(cb) {
    const el = this.controlEl.createEl('button');
    const c = {
      buttonEl: el,
      setButtonText(t) { el.textContent = t; return c; },
      setCta() { el.addClass('mod-cta'); return c; },
      setWarning() { return c; },
      setDisabled() { return c; },
      onClick(fn) { el._onClick = fn; return c; },
    };
    cb(c); return this;
  }
}
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') {
    return {
      setIcon() {},
      normalizePath: p => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').normalize('NFC'),
      Notice, Modal, Setting,
      TFile: class {}, TFolder: class {},
      PluginSettingTab: class {},
    };
  }
  return origLoad.call(this, req, ...rest);
};

const { OnboardingWizard, STARTER_CATEGORIES } = require('../src/onboarding');
const { MONTHS } = require('../src/constants');   // pins the payday step's worked example

/* ------------------------------- fixtures -------------------------------- */
function makeApp(files = {}, folders = []) {
  const dirs = new Set(folders);
  for (const p of Object.keys(files)) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return {
    vault: {
      getFileByPath: p => (p in files ? { path: p, _c: files[p] } : null),
      getFolderByPath: p => (dirs.has(p) ? { path: p } : null),
      getAbstractFileByPath: p => (p in files ? { path: p } : (dirs.has(p) ? { path: p } : null)),
      cachedRead: async f => f._c,
      create: async (p, c) => { files[p] = c; },
      createFolder: async p => { dirs.add(p); },
    },
    _files: files,
    _dirs: dirs,
  };
}
function makePlugin() {
  return {
    settings: { budgetFolder: 'Finances/Budget', onboarded: false },
    _written: {},
    saveSettings: async () => {},
    updateBudgetSettingsMd: async function (k, v) { this._written[k] = v; },
    reloadViews: () => {},
    activateView: async () => {},
  };
}
const open = (app, plugin) => { const w = new OnboardingWizard(app, plugin); w.open(); return w; };

/* ---- 1+2: every step renders, is named, and the counter total is honest ---- */
{
  const w = open(makeApp(), makePlugin());
  const steps = w.steps();
  eq(steps[0], 'welcome', 'the wizard still opens on the welcome screen');
  ok(!textOf(w.contentEl, 'budget-onb-step'), 'the welcome screen carries no step counter');

  for (let i = 1; i < steps.length; i++) {
    w.stepIdx = i;
    w.renderStep();
    const title = textOf(w.contentEl, 'budget-onb-title');
    ok(title.length > 0, `step "${steps[i]}" renders a title, not just a number`);
    eq(textOf(w.contentEl, 'budget-onb-step'), `Step ${i} of ${steps.length - 1}`,
      `step "${steps[i]}" numbers itself against the path actually being walked`);
  }
  // The finish screen is the last step, not one past it.
  eq(textOf(w.contentEl, 'budget-onb-step'), `Step ${steps.length - 1} of ${steps.length - 1}`,
    'the create path ends on "Step N of N"');
}

/* ---- 3: validation is inline, inside the modal, not a corner Notice ---- */
(async () => {
  NOTICES.length = 0;
  const w = open(makeApp(), makePlugin());

  w.stepIdx = 1; w.renderStep();          // folder
  w.data.folder = '   ';
  await w.next();
  eq(w.stepIdx, 1, 'an empty folder does not advance the wizard');
  ok(textOf(w.contentEl, 'budget-onb-error').includes('folder path'),
    'the empty-folder message is rendered inside the modal');
  eq(NOTICES.length, 0, 'and is NOT a corner Notice — that is the bug this replaced');

  // The message is one-shot: any re-render clears it, so it can never outlive
  // the mistake and confuse the next step.
  w.renderStep();
  eq(textOf(w.contentEl, 'budget-onb-error'), '', 'the inline error clears on the next render');

  w.data.folder = 'Finances/Budget';
  await w.next();
  eq(w.stepIdx, 2, 'a real folder advances');

  // Payday out of band.
  w.stepIdx = w.steps().indexOf('period'); w.renderStep();
  w.data.periodDays = 0; w.data.payday = '31';
  await w.next();
  eq(w.stepIdx, w.steps().indexOf('period'), 'an out-of-band payday does not advance');
  const err = textOf(w.contentEl, 'budget-onb-error');
  ok(err.includes('1 to 28'), 'the payday error states the range');
  ok(/last day/i.test(err), 'and says what to do when you are paid on the last day of the month');
  eq(NOTICES.length, 0, 'still no corner Notices anywhere in validation');

  // A cycle with no anchor is the silent-monthly trap — it must be caught.
  w.data.periodDays = 14; w.data.periodAnchor = '';
  await w.next();
  eq(w.stepIdx, w.steps().indexOf('period'), 'a cycle with no anchor does not advance');
  ok(/monthly/i.test(textOf(w.contentEl, 'budget-onb-error')),
    'and the message names the consequence, not just the missing field');

  /* ---- 4: the payday step shows the convention worked out ---- */
  w.data.periodDays = 0; w.data.payday = 25;
  w.renderStep();
  const hint = textOf(w.contentEl, 'budget-onb-hint');
  ok(hint.includes('25th') && hint.includes('24th'),
    `the payday hint works the period out with the user's own day, got "${hint}"`);
  ok(/named after the month it ends in/i.test(hint),
    'and states the naming convention explicitly — this is the part nobody derives');
  ok(MONTHS.some(m => hint.includes(m)), 'and names the period the user is in right now');

  // Day 1 is a calendar month by another name; say so rather than describing
  // a period running from the 1st to the 0th.
  w.data.payday = 1; w.renderStep();
  ok(/calendar month/i.test(textOf(w.contentEl, 'budget-onb-hint')),
    'day 1 is explained as a calendar month, not as "the 1st to the 0th"');

  /* The period step asks TWO questions — shape then phase — mirroring the two
     keys Settings.md holds. It must NOT re-grow a calendar|payday|cycle mode:
     a calendar month is a monthly period starting on the 1st, and offering it
     as its own option gave two controls that ran identical code and wrote an
     identical file, while the settings tab offered neither. */
  {
    const shape = () => all(w.contentEl, e => e.tagName === 'SELECT')[0];
    const fields = () => all(w.contentEl, e => e.tagName === 'INPUT');

    w.data.periodDays = 0; w.renderStep();
    eq(all(w.contentEl, e => e.tagName === 'SELECT').length, 1,
      'one shape control on the period step, not a mode picker plus a length picker');
    eq(shape()._options.map(o => o[0]), ['0', '7', '14', '28'],
      'and its options are the storage-level lengths, monthly first');
    eq(fields().map(i => i.attrs.type || i.type), ['number'],
      'monthly asks for a day of the month');
    ok(/start/i.test(textOf(w.contentEl, 'setting-item-name')),
      'named for what it is — the day the budget month starts, not "Payday"');

    shape()._onChange('14');
    eq(w.data.periodDays, 14, 'switching the shape stores the day count');
    eq(fields().map(i => i.attrs.type || i.type), ['date'],
      'and the follow-up becomes a date, not a day-of-month');

    shape()._onChange('0');
    eq(w.data.periodDays, 0, '"Monthly" is periodDays 0 — the same key, not a separate mode');

    // A length hand-set in Settings.md must survive a re-run of the wizard AND
    // be shown truthfully, rather than displaying a preset over a kept value.
    w.data.periodDays = 10; w.renderStep();
    ok(shape()._options.some(o => o[0] === '10'),
      'an out-of-preset length from Settings.md appears in the list');
    eq(shape().value, '10', 'and is the selected option, not a preset shown over it');
  }
  w.data.periodDays = 0; w.data.payday = 25;

  /* ---- 5: country changes update the currency control, not just the value -- */
  w.stepIdx = w.steps().indexOf('country'); w.renderStep();
  const selects = all(w.contentEl, e => e.tagName === 'SELECT');
  eq(selects.length, 2, 'country and currency share one step');
  const before = selects[1].value;
  selects[0]._onChange('uk');
  const after = all(w.contentEl, e => e.tagName === 'SELECT')[1].value;
  eq(w.data.currency, '£', 'choosing the UK sets the currency behind the scenes');
  eq(after, '£', 'AND the control the user is looking at now shows it');
  ok(before !== after, 'the two controls cannot silently disagree');

  /* ---- 6: Cancel is not wedged between Back and Next ---- */
  w.stepIdx = 3; w.renderStep();
  const navs = byClass(w.contentEl, 'budget-onb-nav');
  eq(navs.length, 1, 'the nav row is tagged for the stylesheet that pushes Cancel left');
  const labels = all(navs[0], e => e.tagName === 'BUTTON').map(b => b.textContent);
  eq(labels, ['Cancel', 'Back', 'Next'], 'Cancel is first, so Back and Next stay adjacent');
  ok(all(navs[0], e => e.tagName === 'BUTTON').pop().hasClass('mod-cta'),
    'and the primary action is still the CTA');

  /* ---- category step: grouped, countable, clearable ---- */
  w.stepIdx = w.steps().indexOf('categories'); w.renderStep();
  const groups = byClass(w.contentEl, 'budget-onb-cat-group');
  ok(groups.length >= 5, `the starter pack is grouped by type, got ${groups.length} groups`);
  ok(byClass(w.contentEl, 'budget-onb-swatch').length === STARTER_CATEGORIES.length,
    'every category previews the colour it will actually use');
  ok(textOf(w.contentEl, 'budget-onb-catcount').startsWith(`${STARTER_CATEGORIES.length} of`),
    'the count starts at everything selected');
  const [selAll, selNone] = all(w.contentEl, e => e.tagName === 'BUTTON')
    .filter(b => /Select/.test(b.textContent));
  selNone.fire('click');
  eq(w.data.cats.size, 0, '"Select none" clears the set');
  ok(textOf(w.contentEl, 'budget-onb-catcount').startsWith('0 of'), 'and the count follows');
  selAll.fire('click');
  eq(w.data.cats.size, STARTER_CATEGORIES.length, '"Select all" restores it');

  console.log(`  ok   create path renders, validates inline and explains itself`);
})().then(runConnect).catch(e => { console.error(e); process.exit(1); });

/* ---- connect mode: fewer steps, callout instead of a blank screen ---- */
async function runConnect() {
  const app = makeApp({
    'Existing/Budget/Settings.md': '---\nmonth_start_day: 15\ncurrency: "£"\ncountry: uk\nhousehold: The Smiths\n---\n',
  }, ['Existing/Budget', 'Existing/Budget/Categories']);
  const w = open(app, makePlugin());

  w.stepIdx = 1; w.renderStep();
  w.data.folder = 'Existing/Budget';
  await w.next();

  eq(w.mode, 'connect', 'an existing budget folder switches the wizard to connect mode');
  ok(w.steps().length < 8, 'connect mode is a shorter path — nothing to scaffold');
  ok(!w.steps().includes('existing'), 'and no longer spends a whole screen on one sentence');

  const callout = textOf(w.contentEl, 'budget-onb-callout');
  ok(callout.includes('Existing/Budget'), 'the callout names the folder that was found');
  ok(/categories, accounts and transactions are left exactly as they are/i.test(callout),
    'and is honest about what connecting does NOT touch');
  ok(!/nothing else is touched/i.test(callout),
    'the old overclaim is gone — connect mode does rewrite Settings.md');

  eq(w.data.payday, 15, 'the existing settings are prefilled, not re-asked from scratch');
  eq(w.data.currency, '£', 'including the currency');
  eq(w.data.name, 'The Smiths', 'and the household name');

  for (let i = 1; i < w.steps().length; i++) { w.stepIdx = i; w.renderStep(); }
  ok(textOf(w.contentEl, 'budget-onb-title').length > 0, 'every connect step is named too');

  console.log('  ok   connect path detects, prefills and explains itself');
  await runClose();
}

/* ---- 7: closing on the welcome screen must not retire the wizard ---- */
async function runClose() {
  {
    const p = makePlugin();
    const w = open(makeApp(), p);
    w.close();                              // Escape / tap-outside on the welcome screen
    eq(p.settings.onboarded, false,
      'closing on the welcome screen leaves the wizard to ask again — no decision was made');
  }
  {
    const p = makePlugin();
    const w = open(makeApp(), p);
    w.stepIdx = 2; w.renderStep();
    NOTICES.length = 0;
    w.close();                              // a real "not now"
    eq(p.settings.onboarded, true, 'closing partway through IS a decision, and is honoured');
    ok(NOTICES.some(n => /Settings/.test(n) && /setup wizard/i.test(n)),
      'and the skip Notice points at the settings button, not only the command palette');
  }
  await runApply();
}

/* ---- 8: the whole create path applies ---- */
async function runApply() {
  const app = makeApp();
  const p = makePlugin();
  const w = open(app, p);
  w.data.folder = 'Money/Budget';
  w.data.name = 'Alex';
  w.data.periodDays = 0;
  w.data.payday = 25;
  w.data.acctName = 'Cheque account';
  w.data.acctBalance = '1234.50';
  w.stepIdx = w.steps().indexOf('finish');
  w.renderStep();

  const finish = w.contentEl.textContent;
  ok(/What to do next/i.test(finish), 'the finish screen names the first move in the app');
  ok(/Budgets page/i.test(finish) && /Transactions page/i.test(finish),
    'and points at the two pages the welcome screen promised');
  ok(/privacy/i.test(finish),
    'and warns about the splash gate — otherwise setup ends on an unexplained lock screen');

  NOTICES.length = 0;
  await w.next();                            // === apply()
  ok(w.finished, 'the create path completes');
  eq(p.settings.onboarded, true, 'and marks the plugin onboarded');
  ok(!NOTICES.some(n => /Setup failed/.test(n)), `apply() threw: ${NOTICES.join(' | ')}`);

  const files = Object.keys(app._files);
  for (const f of ['Money/Budget/Settings.md', 'Money/Budget/Budgets/2026-08.md'.replace('2026-08', w.firstPeriod()),
    'Money/Budget/Accounts/Cheque account.md', 'Money/Budget/Owed Money.md', 'Money/Budget/Debts.md',
    'Money/Budget/Services.md', 'Money/Budget/Data/Categorisation Rules.csv']) {
    ok(files.includes(f), `apply() wrote ${f}`);
  }
  eq(files.filter(f => f.startsWith('Money/Budget/Categories/')).length, STARTER_CATEGORIES.length,
    'every ticked starter category became a file');
  ok(app._files['Money/Budget/Settings.md'].includes('household: "Alex"'),
    'the name reaches Settings.md');

  console.log(`PASS — setup wizard screens: both paths render, validate inline and apply (${checks} assertions).`);
}
