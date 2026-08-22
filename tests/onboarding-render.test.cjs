'use strict';
/* The setup wizard's SCREENS, as opposed to its period maths.

   onboarding-period.test.cjs drives the wizard's arithmetic and never touches
   a DOM, so every render_* method in the file was unguarded: a typo in a step
   that only a fresh install reaches throws inside Obsidian's modal, leaves a
   blank pane with no error the user can act on, and the whole build stays
   green. Nothing else in the suite opens the wizard either, and the browser
   preview harness does not mount it.

   So this walks all THREE paths — CSV create, manual create and connect — one
   step at a time, and pins the things a new user's understanding rests on.

   The wizard asks ONE QUESTION PER SCREEN (name, when you are paid, how you
   will add your spending) and that is a rule, not an accident: a screen with
   four controls on it reads as a form to be endured. Several assertions below
   exist only to keep it that way, by counting the controls on each screen.

     1. every step renders, in every path, without throwing,
     2. every step past the welcome screen is NAMED, not just numbered, and
        the counter's total matches the path really being walked — including
        after the radio that changes which path that is,
     3. bad input fails INLINE inside the modal rather than as a corner
        Notice that can be missed or land behind it,
     4. the payday hint shows the convention worked out with the user's own
        day — a payday period is named after the month it ENDS in, which is
        underivable from a number field labelled "Payday",
     5. choosing a country actually updates the currency control the user is
        looking at, rather than only the value behind it,
     6. Cancel is not sitting between Back and Next,
     7. editing the folder on the finish screen into one that already holds a
        budget switches to connect, adopts that vault's settings, and leaves
        the reader on the finish screen rather than back among the tick-boxes,
     8. closing on the WELCOME screen does not retire the wizard for good,
        while closing past it does,
     9. the CSV create path applies and writes the files the loader expects,
    10. the MANUAL create path writes a real first budget — read back through
        the REAL loader, not a mirror of it — creates an account for those
        transactions to land in, records input_mode, and ends on a celebration
        rather than on an import screen it deliberately hid.

   Runs in bare node with a minimal DOM stub, same as inert-fallback.test.cjs.
   Wired into ./build.sh via the tests/*.test.cjs glob.
     node tests/onboarding-render.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const Module = require('module');
const i18n = require('../src/i18n');
/* The shared harness's obsidian stub goes in FIRST, and this file's richer one
   (below) supersedes it — but the two must hand out the SAME TFile/TFolder
   classes. The manual path's assertions read the budget the wizard wrote back
   through the real loadVault, and io.js's mdFilesIn() tests `instanceof TFile`
   against whichever class it was given at require time. Two stubs meant two
   classes, every instanceof came back false, and the loader reported an empty
   vault while the files sat right there in it. */
const harness = require('./helpers/harness.cjs');
const { TFile, TFolder } = harness.stubObsidian();

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
/* Present, and reporting no preference — the confetti asks for reduced motion
   live rather than caching it, and the reduced-motion case is rehearsed by
   swapping this out below. */
global.window = {
  matchMedia: () => ({ matches: false }),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
};

/* Depth-first walk, so assertions can look for a class anywhere in the step. */
function all(el, pred, out = []) {
  for (const c of el.children) {
    if (c instanceof FakeEl) { if (pred(c)) out.push(c); all(c, pred, out); }
  }
  return out;
}
const byClass = (el, cls) => all(el, e => e.hasClass(cls));
const textOf = (el, cls) => byClass(el, cls).map(e => e.textContent).join(' | ');
const inputs = el => all(el, e => e.tagName === 'INPUT');
const selects = el => all(el, e => e.tagName === 'SELECT');
const buttons = el => all(el, e => e.tagName === 'BUTTON');

/* ------------------------------ obsidian -------------------------------- */
const NOTICES = [];
class Notice { constructor(m) { NOTICES.push(String(m)); } }
class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = new FakeEl('div');
    this.titleEl = new FakeEl('div');
    this.closed = false;
  }
  open() { this.onOpen(); }
  close() { this.closed = true; this.onClose(); }
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
      TFile, TFolder,
      PluginSettingTab: class {}, ItemView: class {}, Plugin: class {},
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
    _activated: 0,
    _reloaded: 0,
    saveSettings: async () => {},
    updateBudgetSettingsMd: async function (k, v) { this._written[k] = v; },
    reloadViews: function () { this._reloaded++; },
    activateView: async function () { this._activated++; },
  };
}
const open = (app, plugin) => { const w = new OnboardingWizard(app, plugin); w.open(); return w; };
/* The wizard applies the language it is given, globally — so a test that
   rehearses a reader choosing Afrikaans has to put it back, or every English
   string asserted after it comes back translated. */
const setLanguageBack = () => i18n.setLanguage('en');
/* The vault the connect assertions run against — an existing budget somewhere
   the wizard would never have guessed, so it can only be reached by editing
   the folder field on the finish screen. */
const EXISTING = () => makeApp({
  'Existing/Budget/Settings.md': '---\nmonth_start_day: 15\ncurrency: "£"\ncountry: uk\nhousehold: The Smiths\n---\n',
}, ['Existing/Budget', 'Existing/Budget/Categories']);

/* Walks a whole path, asserting each step is named and honestly numbered. */
function walkPath(w, expected, label) {
  eq(w.steps(), expected, `${label}: the step list is what the design says it is`);
  for (let i = 1; i < expected.length; i++) {
    w.stepIdx = i;
    w.renderStep();
    ok(textOf(w.contentEl, 'budget-onb-title').length > 0,
      `${label}: step "${expected[i]}" renders a title, not just a number`);
    eq(textOf(w.contentEl, 'budget-onb-step'), `Step ${i} of ${expected.length - 1}`,
      `${label}: step "${expected[i]}" numbers itself against the path actually being walked`);
  }
}

(async () => {
  /* ---- 1+2: the three paths, each named and honestly numbered ---- */
  {
    const w = open(makeApp(), makePlugin());
    eq(w.steps()[0], 'welcome', 'the wizard still opens on the welcome screen');
    ok(!textOf(w.contentEl, 'budget-onb-step'), 'the welcome screen carries no step counter');
    /* The welcome screen promises a plan, and it must never promise MORE
       screens than the wizard walks — it used to promise five while the wizard
       asked seven, and the reader counts screens against it. Measured against
       the SHORTEST path, so the promise holds on every one of them. */
    const planned = byClass(w.contentEl, 'budget-onb-journey')[0].children.length;
    ok(planned >= 3, `the plan actually lists the questions (found ${planned})`);
    ok(planned <= 4,
      `the plan must not promise more screens than the shortest path walks (promises ${planned})`);

    walkPath(w, ['welcome', 'name', 'period', 'how', 'categories', 'account', 'finish'], 'csv create');

    w.data.inputMode = 'manual';
    walkPath(w, ['welcome', 'name', 'period', 'how', 'firstBudget', 'finish'], 'manual create');

    w.data.inputMode = 'csv';
    w.mode = 'connect';
    walkPath(w, ['welcome', 'name', 'period', 'how', 'finish'], 'connect');
    w.mode = 'create';

    /* One question per screen, counted. The three question screens carry, in
       order: a name field plus the three locale dropdowns; the period shape
       plus its one follow-up; and the two input-mode radios and nothing else.
       Pinned because the drift is always the same direction — a control gets
       added to the screen that is already open rather than to one of its own,
       and the wizard is back to being a form. */
    const controlsOn = step => {
      w.mode = 'create'; w.data.inputMode = 'csv';
      w.stepIdx = w.steps().indexOf(step); w.renderStep();
      return { selects: selects(w.contentEl).length, inputs: inputs(w.contentEl).length };
    };
    eq(controlsOn('name'), { selects: 3, inputs: 1 },
      'the name screen asks for a name, with language/country/currency riding along');
    eq(controlsOn('period'), { selects: 1, inputs: 1 },
      'the period screen asks how often, then the one follow-up that shape needs');
    eq(controlsOn('how'), { selects: 0, inputs: 2 },
      'the how screen is two radios and nothing else');
  }

  /* ---- 2b: the radio that changes the path also changes the counter ---- */
  {
    const w = open(makeApp(), makePlugin());
    w.stepIdx = w.steps().indexOf('how'); w.renderStep();
    eq(textOf(w.contentEl, 'budget-onb-step'), 'Step 3 of 6',
      'the CSV path is six steps past the welcome screen');
    const cards = byClass(w.contentEl, 'budget-onb-choice');
    eq(cards.length, 2, 'the input-mode question is two cards, each with room for a sentence');
    ok(textOf(w.contentEl, 'budget-onb-choice-desc').length > 60,
      'and each card carries the sentence a dropdown option could not');
    const radios = inputs(w.contentEl).filter(i => (i.attrs.type || i.type) === 'radio');
    eq(radios.map(r => r.attrs.value), ['csv', 'manual'], 'CSV is offered first, and is the default');
    eq(radios[0].checked, true, 'the default answer leaves every existing vault behaving as it always did');

    radios[1].fire('change');
    eq(w.data.inputMode, 'manual', 'choosing the manual card stores the answer');
    eq(textOf(w.contentEl, 'budget-onb-step'), 'Step 3 of 5',
      'AND the counter re-renders against the shorter path — a wizard that still ' +
      'promised "of 6" would be contradicting itself on the screen where trust is cheapest to lose');
    ok(byClass(w.contentEl, 'budget-onb-choice')[1].hasClass('is-on'),
      'and the chosen card is the one that looks chosen');
  }

  /* ---- 3: validation is inline, inside the modal, not a corner Notice ---- */
  {
    NOTICES.length = 0;
    const w = open(makeApp(), makePlugin());
    const PERIOD = w.steps().indexOf('period');
    w.stepIdx = PERIOD; w.renderStep();

    w.data.periodDays = 0; w.data.payday = '31';
    await w.next();
    eq(w.stepIdx, PERIOD, 'an out-of-band payday does not advance the wizard');
    const err = textOf(w.contentEl, 'budget-onb-error');
    ok(err.includes('1 to 28'), 'the payday error states the range');
    ok(/last day/i.test(err), 'and says what to do when you are paid on the last day of the month');
    eq(NOTICES.length, 0, 'and is NOT a corner Notice — that is the bug this replaced');

    // The message is one-shot: any re-render clears it, so it can never outlive
    // the mistake and confuse the next step.
    w.renderStep();
    eq(textOf(w.contentEl, 'budget-onb-error'), '', 'the inline error clears on the next render');

    // A cycle with no anchor is the silent-monthly trap — it must be caught.
    w.data.periodDays = 14; w.data.periodAnchor = '';
    await w.next();
    eq(w.stepIdx, PERIOD, 'a cycle with no anchor does not advance');
    ok(/monthly/i.test(textOf(w.contentEl, 'budget-onb-error')),
      'and the message names the consequence, not just the missing field');

    /* The currency is caught on the NAME screen, where the control is — not
       three screens later, where the reader would have to work out which
       field the message meant. */
    const NAME = w.steps().indexOf('name');
    w.stepIdx = NAME; w.renderStep();
    w.data.currency = '__custom__'; w.data.customCurrency = '';
    await w.next();
    eq(w.stepIdx, NAME, 'a custom currency with no symbol does not advance');
    ok(textOf(w.contentEl, 'budget-onb-error').includes('currency symbol'),
      'and says which field it means');

    w.data.currency = 'R';
    await w.next();
    eq(w.stepIdx, NAME + 1, 'a screen with every answer in order advances');

    w.data.periodDays = 0; w.data.payday = 25;
    await w.next();
    eq(w.stepIdx, PERIOD + 1, 'and so does a period with a real start day');
    eq(NOTICES.length, 0, 'still no corner Notices anywhere in validation');

    /* ---- 4: the payday hint shows the convention worked out ---- */
    w.stepIdx = PERIOD; w.renderStep();
    const hint = textOf(w.contentEl, 'budget-onb-hint');
    ok(hint.includes('25th') && hint.includes('24th'),
      `the payday hint works the period out with the user's own day, got "${hint}"`);
    ok(/named after the month it ends in/i.test(hint),
      'and states the naming convention explicitly — this is the part nobody derives');
    ok(MONTHS.some(m => hint.includes(m)), 'and names the period the user is in right now');

    w.data.payday = 1; w.renderStep();
    ok(/calendar month/i.test(textOf(w.contentEl, 'budget-onb-hint')),
      'day 1 is explained as a calendar month, not as "the 1st to the 0th"');

    /* The period question keeps its two-control shape — shape then phase,
       mirroring the two keys Settings.md holds. It must NOT re-grow a
       calendar|payday|cycle mode: a calendar month is a monthly period
       starting on the 1st, and offering it as its own option gave two controls
       that ran identical code and wrote an identical file, while the settings
       tab offered neither. */
    {
      const shape = () => selects(w.contentEl)[0];
      const dated = () => inputs(w.contentEl).filter(i => ['number', 'date'].includes(i.attrs.type || i.type));

      w.data.periodDays = 0; w.renderStep();
      eq(shape()._options.map(o => o[0]), ['0', '7', '14', '28'],
        'the shape control offers the storage-level lengths, monthly first');
      eq(dated().map(i => i.attrs.type || i.type), ['number'],
        'monthly asks for a day of the month');

      shape()._onChange('14');
      eq(w.data.periodDays, 14, 'switching the shape stores the day count');
      eq(dated().map(i => i.attrs.type || i.type), ['date'],
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
    w.stepIdx = NAME; w.renderStep();
    const sel = selects(w.contentEl);
    eq(sel.length, 3, 'the name screen carries language, country and currency and nothing else');
    const LANG = 0, COUNTRY = 1, CURRENCY = 2;
    const before = sel[CURRENCY].value;
    const langBefore = sel[LANG].value;
    sel[COUNTRY]._onChange('uk');
    const now = selects(w.contentEl);
    eq(w.data.currency, '£', 'choosing the UK sets the currency behind the scenes');
    eq(now[CURRENCY].value, '£', 'AND the control the user is looking at now shows it');
    ok(before !== now[CURRENCY].value, 'the two controls cannot silently disagree');

    /* Country and language are separate axes (see the header of src/i18n.js).
       The currency control above is DELIBERATELY dragged by the country; the
       language control deliberately is not. Pinned because the obvious
       "helpful" change — defaulting language from the country — is exactly the
       behaviour Ruan ruled out: someone in Germany may still want English. */
    eq(now[LANG].value, langBefore, 'choosing a country does not change the language');
    eq(w.data.language, langBefore, 'and does not change it behind the scenes either');

    /* The locale group sits BELOW the name: it is the group most likely to be
       right already, and the old wizard opened setup with it. */
    const groups = byClass(w.contentEl, 'budget-onb-group');
    eq(groups.length, 1, 'the locale controls sit under one heading');
    const kids = w.contentEl.children;
    ok(kids.indexOf(groups[0]) > kids.indexOf(byClass(w.contentEl, 'setting-item')[0]),
      'and that heading comes after the name field, not before it');

    /* ---- 6: Cancel is not wedged between Back and Next ---- */
    const navs = byClass(w.contentEl, 'budget-onb-nav');
    eq(navs.length, 1, 'the nav row is tagged for the stylesheet that pushes Cancel left');
    eq(buttons(navs[0]).map(b => b.textContent), ['Cancel', 'Back', 'Next'],
      'Cancel is first, so Back and Next stay adjacent');
    ok(buttons(navs[0]).pop().hasClass('mod-cta'), 'and the primary action is still the CTA');
  }

  /* ---- category step: grouped, countable, clearable ---- */
  {
    const w = open(makeApp(), makePlugin());
    w.stepIdx = w.steps().indexOf('categories'); w.renderStep();
    ok(byClass(w.contentEl, 'budget-onb-cat-group').length >= 5,
      'the starter pack is grouped by type');
    eq(byClass(w.contentEl, 'budget-onb-swatch').length, STARTER_CATEGORIES.length,
      'every category previews the colour it will actually use');
    ok(textOf(w.contentEl, 'budget-onb-catcount').startsWith(`${STARTER_CATEGORIES.length} of`),
      'the count starts at everything selected');
    const [selAll, selNone] = buttons(w.contentEl).filter(b => /Select/.test(b.textContent));
    selNone.fire('click');
    eq(w.data.cats.size, 0, '"Select none" clears the set');
    selAll.fire('click');
    eq(w.data.cats.size, STARTER_CATEGORIES.length, '"Select all" restores it');
  }

  /* ---- the first-budget step: five lines, one reader for the arithmetic ---- */
  {
    NOTICES.length = 0;
    const w = open(makeApp(), makePlugin());
    w.data.inputMode = 'manual';
    w.stepIdx = w.steps().indexOf('firstBudget'); w.renderStep();

    eq(selects(w.contentEl).length, 5, 'five lines, each with a category picker');
    eq(inputs(w.contentEl).length, 5, 'and five amounts');
    for (const t of inputs(w.contentEl)) {
      eq(t.attrs.type || t.type, 'text',
        'amounts are TEXT — a number input silently discards "1 234,56", which the loader reads perfectly');
    }
    ok(/blank/i.test(textOf(w.contentEl, 'budget-onb-hint') + w.contentEl.textContent),
      'and the screen says a blank line is a legitimate answer');

    /* Two controls on one row is the only place in the wizard that happens,
       and on a phone Obsidian's own `.modal .setting-item-control select,
       input { width: 100% }` squeezes the pair into half a field each.
       mod-vertical is the host's own stacking class — a counter-rule of ours
       would have to be re-won against every app.css revision. */
    eq(byClass(w.contentEl, 'setting-item-control').filter(e => e.hasClass('mod-vertical')).length, 5,
      'every first-budget row stacks its category and amount rather than sharing one line');

    /* Five blanks is not a first budget. Celebrating one would be the app's
       first statement to this household, and false. */
    await w.next();
    eq(w.stepIdx, w.steps().indexOf('firstBudget'), 'an entirely blank first budget does not advance');
    ok(/at least one amount/i.test(textOf(w.contentEl, 'budget-onb-error')),
      'and the message names the way out as well as the problem');

    // A category the reader can't read back is worse than no default.
    for (const s of selects(w.contentEl)) {
      ok(s._options.some(o => o[0] === s.value),
        `the "${s.value}" default is actually one of the options offered`);
    }

    const amounts = inputs(w.contentEl);
    amounts[0]._onChange('not a number');
    await w.next();
    eq(w.stepIdx, w.steps().indexOf('firstBudget'), 'an unreadable amount does not advance');
    ok(textOf(w.contentEl, 'budget-onb-error').length > 0, 'and says so inline');
    eq(NOTICES.length, 0, 'not as a corner Notice');

    inputs(w.contentEl)[0]._onChange('-50');
    await w.next();
    eq(w.stepIdx, w.steps().indexOf('firstBudget'), 'a negative amount does not advance either');

    /* ONE reader for the arithmetic: the live hint, the finish summary and the
       writer all go through firstBudgetRows(). The wizard has been bitten by
       exactly this before — the opening balance was parsed one way for the
       confirmation screen and another for the file. */
    inputs(w.contentEl)[0]._onChange('10 000,00');
    inputs(w.contentEl)[1]._onChange('4000');
    const totals = w.firstBudgetTotals();
    eq(totals.income, 10000, 'a grouped, comma-decimal income is read the way the loader reads it');
    eq(totals.spend, 4000, 'and the planned spend is everything that is not income');
    eq(totals.left, 6000, 'so what is left over is one subtraction, not a second derivation');
    w.renderStep();
    const hint = textOf(w.contentEl, 'budget-onb-hint');
    ok(hint.includes('10000.00') && hint.includes('6000.00'),
      `the live hint shows the same figures the writer will use, got "${hint}"`);
    await w.next();
    eq(w.stepIdx, w.steps().indexOf('finish'), 'readable amounts advance to the summary');
  }

  /* ---- 7: the folder field on the finish screen ---- */
  {
    const app = EXISTING();
    const w = open(app, makePlugin());
    w.stepIdx = w.steps().indexOf('finish'); w.renderStep();
    eq(w.mode, 'create', 'a default folder with nothing in it is a create');
    eq(w.stepIdx, 6, 'the CSV create path ends on step 6');

    const folderField = inputs(w.contentEl)[0];
    eq(folderField.value, 'Finances/Budget', 'the folder field is first, prefilled with the default');
    ok(/create/i.test(textOf(w.contentEl, 'budget-onb-hint')),
      'and the live hint says the folder will be created');

    await folderField._onChange('Existing/Budget');
    eq(w.mode, 'connect', 'a folder that already holds a budget switches the wizard to connect');
    eq(w.steps(), ['welcome', 'name', 'period', 'how', 'finish'],
      'and drops the two scaffolding screens');
    eq(w.stepIdx, 4,
      'the reader stays on the finish screen — index arithmetic would have dropped them into "categories"');
    eq(textOf(w.contentEl, 'budget-onb-step'), 'Step 4 of 4', 'and the counter re-reads honestly');

    const callout = textOf(w.contentEl, 'budget-onb-callout');
    ok(callout.includes('Existing/Budget'), 'the callout names the folder that was found');
    ok(/categories, accounts and transactions are left exactly as they are/i.test(callout),
      'and is honest about what connecting does NOT touch');
    ok(!/nothing else is touched/i.test(callout),
      'the old overclaim is gone — connect mode does rewrite Settings.md');

    eq(w.data.payday, 15, 'the existing settings are adopted, not overwritten with the wizard defaults');
    eq(w.data.currency, '£', 'including the currency');
    eq(w.data.name, 'The Smiths', 'and the household name');

    /* ---- 7b: adopting must never un-answer a question the reader answered --
       This runs on a KEYSTROKE in the folder field, three screens after the
       questions. The first version filled every field from the matched
       Settings.md, so a reader who had typed their name, set their payday and
       picked a currency watched all three change under them — and the modal
       switch language — the moment the path they were typing happened to
       match. The mode flip is the useful half. */
    {
      const w2 = open(EXISTING(), makePlugin());
      w2.stepIdx = w2.steps().indexOf('name'); w2.renderStep();
      inputs(w2.contentEl)[0]._onChange('Robin');                 // the name field
      const lang = selects(w2.contentEl)[0];
      lang._onChange('af');
      selects(w2.contentEl)[1]._onChange('us');                   // country -> $
      w2.stepIdx = w2.steps().indexOf('period'); w2.renderStep();
      inputs(w2.contentEl)[0]._onChange('7');                     // start day

      w2.stepIdx = w2.steps().indexOf('finish'); w2.renderStep();
      await inputs(w2.contentEl)[0]._onChange('Existing/Budget');

      eq(w2.mode, 'connect', 'the mode still flips — that half was never in doubt');
      eq(w2.data.name, 'Robin', 'a name the reader typed survives the adoption');
      eq(w2.data.payday, '7', 'and so does a start day they chose');
      eq(w2.data.currency, '$', 'and the currency that came with the country they picked');
      eq(i18n.resolveLanguage(w2.data.language), 'af',
        'and the language — re-rendering the modal in another language mid-sentence is the worst of these');
      ok(textOf(w2.contentEl, 'budget-onb-callout').includes('Existing/Budget'),
        'while the callout still explains what connecting will and will not touch');
      setLanguageBack();
    }
    eq(buttons(w.contentEl).pop().textContent, i18n.t('wiz.connectBtn'),
      'and the button now offers to connect rather than to create');

    // Back must land somewhere that exists on the SHORTER list.
    w.stepIdx--; w.renderStep();
    eq(w.steps()[w.stepIdx], 'how', 'Back from a connect finish lands on the last question asked');

    // And pointing it back at an empty folder returns the create path.
    w.stepIdx = w.steps().indexOf('finish'); w.renderStep();
    await inputs(w.contentEl)[0]._onChange('Somewhere/Else');
    eq(w.mode, 'create', 'a folder with no budget in it goes back to create');
    eq(w.steps().length, 7, 'and the scaffolding screens come back');
    eq(w.steps()[w.stepIdx], 'finish', 'with the reader still on the finish screen');
  }

  /* ---- 8: closing on the welcome screen must not retire the wizard ---- */
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
  /* A rejected saveSettings() on close must not be an unhandled rejection.
     Modal.close() fires onClose() without awaiting it, same as Obsidian's real
     Modal — so this calls onClose() directly to get a promise worth asserting
     on. onboarded is already true in memory the moment it is assigned, ahead
     of the guarded save, so the wizard still will not reopen this session even
     though the write failed; only the toast differs. */
  {
    const p = makePlugin();
    p.saveSettings = async () => { throw new Error('simulated disk error'); };
    const w = open(makeApp(), p);
    w.stepIdx = 2; w.renderStep();
    NOTICES.length = 0;

    await assert.doesNotReject(() => w.onClose(),
      'onClose: a rejected saveSettings() must not escape as an unhandled rejection');
    checks++;
    eq(p.settings.onboarded, true, 'onClose: a failed save does not undo the in-memory decision to skip');
    ok(NOTICES.some(n => n === i18n.t('settings.err.save', { error: 'simulated disk error' })),
      `onClose: a failed save reports the shared settings-save error Notice, got ${JSON.stringify(NOTICES)}`);
  }

  await runCsvApply();
  await runManualApply();
  await runBudgetAlreadyThere();
})().catch(e => { console.error(e); process.exit(1); });

/* ---- 9: the CSV create path applies ---- */
async function runCsvApply() {
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
  ok(/CSV/.test(finish), 'the CSV path still ends by pointing at the import');
  ok(/privacy/i.test(finish),
    'and warns about the splash gate — otherwise setup ends on an unexplained lock screen');

  NOTICES.length = 0;
  await w.next();                            // === apply()
  ok(w.finished, 'the create path completes');
  eq(p.settings.onboarded, true, 'and marks the plugin onboarded');
  ok(!NOTICES.some(n => /Setup failed/.test(n)), `apply() threw: ${NOTICES.join(' | ')}`);
  ok(w.closed, 'the CSV path closes the modal onto the app, as it always did');
  eq(p._activated, 1, 'and opens the view itself');

  const files = Object.keys(app._files);
  for (const f of ['Money/Budget/Settings.md', `Money/Budget/Budgets/${w.firstPeriod()}.md`,
    'Money/Budget/Accounts/Cheque account.md', 'Money/Budget/Owed Money.md', 'Money/Budget/Debts.md',
    'Money/Budget/Services.md', 'Money/Budget/Data/Categorisation Rules.csv']) {
    ok(files.includes(f), `apply() wrote ${f}`);
  }
  eq(files.filter(f => f.startsWith('Money/Budget/Categories/')).length, STARTER_CATEGORIES.length,
    'every ticked starter category became a file');
  ok(app._files['Money/Budget/Settings.md'].includes('household: "Alex"'),
    'the name reaches Settings.md');
  ok(app._files['Money/Budget/Settings.md'].includes('input_mode: csv'),
    'and the input mode is STATED rather than left absent — a reader of Settings.md can see it');

  console.log('  ok   csv create path renders, validates inline and applies');
}

/* ---- 10: the manual create path ends on a budget, not on homework ---- */
async function runManualApply() {
  const app = makeApp();
  const p = makePlugin();
  const w = open(app, p);
  w.data.inputMode = 'manual';
  w.data.folder = 'Manual/Budget';
  w.data.name = 'Sam';
  w.data.periodDays = 0;
  w.data.payday = 25;
  /* Everything below this line is state left behind by a visit to the CSV
     path that the reader then backed out of. None of it may reach disk: the
     tick-boxes are not on the manual path, so honouring them would create a
     budget whose rows point at categories that were never written; and the
     account form is not on the manual path either, so an institution and an
     opening balance would appear from nowhere on an account the reader never
     filled a form in for. */
  w.data.cats.clear();
  w.data.cats.add('Salary');
  w.data.acctInstitution = 'Some Bank';
  w.data.acctBalance = '9999.99';
  /* Two lines pointed at ONE category. load.js reads a budget file straight
     into a list, so a duplicate would show up twice on the Budget page and be
     counted twice in every total derived from it — the merge is correctness,
     not tidiness. */
  w.data.firstBudget.income = { category: 'Salary', amount: '42 000,00' };
  w.data.firstBudget.housing = { category: 'Other expenses', amount: '1200' };
  w.data.firstBudget.food = { category: 'Other expenses', amount: '800' };
  w.data.firstBudget.services = { category: 'Electricity & water', amount: '1500.50' };
  w.data.firstBudget.savings = { category: 'Savings', amount: '' };   // blank: not written

  w.stepIdx = w.steps().indexOf('finish');
  w.renderStep();
  const finish = w.contentEl.textContent;
  ok(!/CSV/.test(finish),
    'the manual finish screen never mentions a CSV — it would be pointing at a door this path closed');
  ok(/My account/.test(finish),
    'the account created on the reader\'s behalf is DECLARED, not silently conjured');
  ok(/3 lines/.test(finish),
    `the summary counts the merged rows, not the five questions, got "${finish}"`);
  ok(new RegExp(`${STARTER_CATEGORIES.length} starter categories`).test(finish),
    'and the summary promises the whole starter pack, not the tick-boxes from a path not walked');
  ok(!/9999/.test(finish),
    'the abandoned CSV opening balance is not offered as this account\'s either');

  NOTICES.length = 0;
  await w.next();                            // === apply()
  ok(!NOTICES.some(n => /Setup failed/.test(n)), `apply() threw: ${NOTICES.join(' | ')}`);
  ok(w.finished, 'the manual path completes');
  ok(!w.closed, 'and does NOT close — it stays open on the celebration screen');
  eq(p._activated, 0, 'the view is opened by the reader\'s own button press, not underneath them');
  eq(p._reloaded, 1, 'though the vault is re-read straight away, so the button opens a loaded app');

  const files = Object.keys(app._files);
  ok(app._files['Manual/Budget/Settings.md'].includes('input_mode: manual'),
    'Settings.md records the mode, so the drawer link and the empty states follow it on every device');
  eq(files.filter(f => f.startsWith('Manual/Budget/Categories/')).length, STARTER_CATEGORIES.length,
    'the whole starter pack is created — "which of these thirty" is not a day-one question');
  ok(files.includes('Manual/Budget/Accounts/My account.md'),
    'an account exists for manual transactions to land in');
  ok(app._dirs.has('Manual/Budget/Transactions/My account'),
    'and so does its transactions folder — tx.add.noAccount on day one is the wall this path exists to avoid');
  ok(app._files['Manual/Budget/Accounts/My account.md'].includes('balance: 0.00'),
    'with a zero balance rather than a figure the wizard never asked for');
  ok(!app._files['Manual/Budget/Accounts/My account.md'].includes('institution:'),
    'and no institution — manual mode claims nothing about a bank it never asked about');
  ok(files.includes('Manual/Budget/Categories/Groceries.md'),
    'a category the reader unticked on a path they abandoned is still created — ' +
    'the first budget draws from the whole pack, so anything less leaves rows pointing at nothing');

  /* ---- read the first budget back through the REAL loader ---- */
  {
    const ctx = harness.makeCtx({ ...app._files }, { budgetFolder: 'Manual/Budget' });
    const S = await harness.loadInto(ctx);
    const period = w.firstPeriod();
    const rows = S.budgets[period];
    ok(!!rows, `the wizard's Budgets/${period}.md is a budget file the loader recognises`);
    eq(rows.map(r => r.category), ['Salary', 'Electricity & water', 'Other expenses'],
      'the rows come back in the vault type order — income, utilities, then the catch-all expense');
    eq(rows.map(r => r.type), ['income', 'utilities', 'expense'],
      'each row wears the type of the category it was pointed at');
    eq(rows.map(r => r.amount), [42000, 1500.5, 2000],
      'the merged pair is ONE row summing both lines, and the grouped income is read as the loader reads it');
    eq(rows.every(r => r.amountRaw === null), true,
      'every amount was written in a form the strict parser accepts');
    ok(!rows.some(r => r.category === 'Savings'),
      'a blank line is not written — "I have not decided" and "nothing" produce the same file');
  }

  /* ---- the celebration screen ---- */
  {
    const hero = byClass(w.contentEl, 'budget-onb-celebrate');
    eq(hero.length, 1, 'apply() left the reader on a celebration rather than an empty dashboard');
    ok(!textOf(w.contentEl, 'budget-onb-step'), 'which is not a step, and carries no counter');
    ok(w.contentEl.textContent.includes(w.periodLabel()),
      'the sentence names the period the budget was saved for');
    const cta = buttons(w.contentEl);
    eq(cta.length, 1, 'one CTA, and no Back/Cancel — there is nothing left to go back to');
    eq(cta[0].textContent, i18n.t('wiz.celebrate.cta'), 'and it offers the dashboard');
    await cta[0]._onClick();
    ok(w.closed, 'pressing it closes the modal');
    eq(p._activated, 1, 'and opens the view');
    eq(NOTICES.filter(n => /skipped/i.test(n)).length, 0,
      'closing from the celebration must never toast "setup skipped" — setup is done');
  }

  /* ---- confetti: deterministic, decorative, and declinable ---- */
  {
    w.renderCelebrate();
    const bits = byClass(w.contentEl, 'budget-onb-confetti-bit');
    eq(bits.length, 28, 'the burst is a fixed number of pieces');
    eq(byClass(w.contentEl, 'budget-onb-confetti')[0].getAttribute('aria-hidden'), 'true',
      'and is hidden from assistive technology — it says nothing a reader needs');
    const first = bits.map(b => b.getAttribute('style'));
    w.renderCelebrate();
    eq(byClass(w.contentEl, 'budget-onb-confetti-bit').map(b => b.getAttribute('style')), first,
      'pieces are derived from the index, not drawn at random — a shower that reshuffles reads as a glitch');

    const realWindow = global.window;
    global.window = { matchMedia: () => ({ matches: true }), setTimeout: realWindow.setTimeout };
    w.renderCelebrate();
    eq(byClass(w.contentEl, 'budget-onb-confetti').length, 0,
      'reduced motion means no burst at all — asked live, so turning it on takes effect now');
    ok(byClass(w.contentEl, 'budget-onb-celebrate-title').length === 1,
      'and the screen itself still renders — the celebration is the words, not the confetti');
    global.window = realWindow;
  }

  console.log('  ok   manual create path writes a real budget and celebrates it');
}

/* ---- 11: a budget that was already there is not written over, and the ----
   celebration says so.

   The reader can point the wizard at a folder that holds a period file
   already: a half-scaffolded budget, a vault restored from a backup, a second
   run of the wizard. writeIfAbsent correctly declines, and for eleven versions
   the wizard threw that answer away — so the celebration screen told the
   household their budget was saved over a file it had deliberately left alone.
   The app argues; it does not quietly claim. */
async function runBudgetAlreadyThere() {
  const probe = new OnboardingWizard(makeApp(), makePlugin());
  probe.data.payday = 25;
  const period = probe.firstPeriod();

  /* Only the period file exists — NOT Settings.md or Categories/, so
     detectExisting() still says "create" and the manual path runs in full.
     That is the case worth pinning: connect mode would never have written a
     budget at all. */
  const app = makeApp({ [`Kept/Budget/Budgets/${period}.md`]: '---\n---\n\n# Budget — kept\n' });
  const p = makePlugin();
  const w = open(app, p);
  w.data.inputMode = 'manual';
  w.data.folder = 'Kept/Budget';
  w.data.payday = 25;
  w.data.firstBudget.income = { category: 'Salary', amount: '1000' };
  w.stepIdx = w.steps().indexOf('finish');
  w.renderStep();
  eq(w.mode, 'create', 'a lone period file is not an existing budget — there is nothing to connect to');

  NOTICES.length = 0;
  await w.next();
  ok(!NOTICES.some(n => /Setup failed/.test(n)), `apply() threw: ${NOTICES.join(' | ')}`);
  eq(w.budgetWritten, false, 'apply() captures that the period file was left alone');
  eq(app._files[`Kept/Budget/Budgets/${period}.md`], '---\n---\n\n# Budget — kept\n',
    'and the file on disk is byte-for-byte the one that was already there');

  const body = textOf(w.contentEl, 'budget-onb-celebrate-body');
  ok(/already/i.test(body) && /not written over/i.test(body),
    `the celebration says what actually happened, got "${body}"`);
  ok(/Budgets page/i.test(body), 'and points at where the reader can go and look');
  ok(!/is saved/i.test(body), 'and does NOT claim a save that did not happen');

  console.log(`PASS — setup wizard screens: three paths render, validate inline and apply (${checks} assertions).`);
}
