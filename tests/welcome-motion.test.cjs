'use strict';
/* The setup wizard's welcome animation (src/welcome-motion.js).

   Five scenes — the vault door opening, the setup questions, a statement
   import, a budget and a plan — cycled by one timer while CSS keyframes play
   everything inside the scene that is on. What this pins is the part CSS
   cannot be trusted with:

     1. it builds five scenes with exactly one on, the picture hidden from
        screen readers and the controls labelled;
     2. its words come from the translation table and its figures from the
        formatter the wizard hands it, so they follow the reader's language,
        currency and country;
     3. the timer moves one scene at a time and loops;
     4. pause stops the timer and resume starts it again; a dot jumps;
     5. reduced motion means no timer and no pause button, and the dots
        still step through the scenes;
     6. it never animates something nobody can see: no timer until the root is
        in a live document, and none at all in bare node;
     7. destroy() takes the timer, the resize observer and the media listener
        down, twice over without complaint.

     node tests/welcome-motion.test.cjs */
const assert = require('assert');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* --------------------------------- DOM ---------------------------------- */
class FakeText { constructor(t) { this.textContent = String(t); this.children = []; } }
class FakeEl {
  constructor(tag, o = {}, live = false) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this._cls = new Set();
    this._text = '';
    this._listeners = {};
    this._live = live;
    this.parent = null;
    if (o.text != null) this._text = String(o.text);
    if (o.cls) for (const c of [].concat(o.cls)) String(c).split(/\s+/).filter(Boolean).forEach(x => this._cls.add(x));
    if (o.attr) for (const [k, v] of Object.entries(o.attr)) this.attrs[k] = String(v);
  }
  get isConnected() { return this.parent ? this.parent.isConnected : this._live; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setText(v) { this._text = String(v); this.children = []; }
  createEl(tag, o = {}) { const n = new FakeEl(tag, o); n.parent = this; this.children.push(n); return n; }
  createDiv(o) { return this.createEl('div', typeof o === 'string' ? { cls: o } : (o || {})); }
  createSpan(o) { return this.createEl('span', typeof o === 'string' ? { cls: o } : (o || {})); }
  addClass(...c) { c.forEach(x => this._cls.add(x)); }
  removeClass(...c) { c.forEach(x => this._cls.delete(x)); }
  toggleClass(c, on) { if (on) this._cls.add(c); else this._cls.delete(c); }
  hasClass(c) { return this._cls.has(c); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
  click() { for (const fn of this._listeners.click || []) fn({ preventDefault() {} }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
}
function all(el, pred, out = []) {
  for (const c of el.children) if (c instanceof FakeEl) { if (pred(c)) out.push(c); all(c, pred, out); }
  return out;
}
const byClass = (el, cls) => all(el, e => e.hasClass(cls));

/* A window whose timers only fire when the test says so. */
function fakeWindow({ reduced = false, observer = true } = {}) {
  const w = { timers: new Map(), next: 1, mediaListeners: [], observers: [], clock: 0 };
  w.performance = { now: () => w.clock };
  w.setTimeout = (fn, ms) => { const id = w.next++; w.timers.set(id, { fn, ms }); return id; };
  w.clearTimeout = id => { w.timers.delete(id); };
  w.fire = () => { const [id, t] = [...w.timers][0]; w.timers.delete(id); t.fn(); return t.ms; };
  w.matchMedia = q => ({
    matches: reduced && /reduce/.test(q),
    addEventListener: (ev, fn) => w.mediaListeners.push(fn),
    removeEventListener: (ev, fn) => { w.mediaListeners = w.mediaListeners.filter(f => f !== fn); },
  });
  if (observer) {
    w.ResizeObserver = class {
      constructor(cb) { this.cb = cb; this.live = false; w.observers.push(this); }
      observe() { this.live = true; }
      disconnect() { this.live = false; }
    };
  }
  return w;
}

/* ----------------------------- the module ------------------------------- */
const { buildWelcomeMotion, SCENE_MS } = require('../src/welcome-motion.js');
const i18n = require('../src/i18n');
i18n.setLanguage('en');
const t = (k, p) => i18n.t(k, p);
// Recognisable on sight, so a figure that skipped the formatter cannot pass.
const money = (v, d) => `¤${Number(v).toFixed(d)}`;
const signed = (v, d) => (v < 0 ? '−' : '+') + money(Math.abs(v), d);

const mount = (opts = {}) => {
  const host = new FakeEl('div', {}, opts.live !== false);
  const win = opts.win === undefined ? fakeWindow(opts) : opts.win;
  const m = buildWelcomeMotion(host, { t, money, signed, win });
  return { host, win, m };
};
const onIndex = root => byClass(root, 'bvm-scene').findIndex(s => s.hasClass('is-on'));

/* ---- 1. five scenes, one on, hidden picture, labelled controls ---- */
{
  const { host, m } = mount();
  ok(m.root && host.children.includes(m.root), 'the animation mounts inside the element it was given');
  ok(m.root.hasClass('budget-onb-motion'), 'its root carries the class the stylesheet styles');
  const scenes = byClass(m.root, 'bvm-scene');
  eq(scenes.length, 5, 'five scenes: welcome, settings, import, budget, plan');
  eq(scenes.filter(s => s.hasClass('is-on')).length, 1, 'exactly one scene is on');
  eq(onIndex(m.root), 0, 'and it opens on the welcome scene');
  eq(SCENE_MS.length, 5, 'one duration per scene');
  ok(SCENE_MS.every(ms => ms >= 4000 && ms <= 9000), 'every scene holds long enough to read and not so long it stalls');
  const frame = byClass(m.root, 'bvm-frame')[0];
  eq(frame.getAttribute('aria-hidden'), 'true',
    'the picture is hidden from screen readers — the welcome text under it already says all of it');
  const dots = byClass(m.root, 'bvm-dot');
  eq(dots.length, 5, 'one dot per scene');
  ok(dots.every(d => d.tagName === 'BUTTON' && d.getAttribute('aria-label')), 'every dot is a labelled button');
  eq(dots.map(d => d.getAttribute('aria-current')), ['true', 'false', 'false', 'false', 'false'],
    'the dot of the scene on screen says so');
  const toggle = byClass(m.root, 'bvm-toggle')[0];
  ok(toggle && toggle.tagName === 'BUTTON', 'there is a pause button');
  eq(toggle.getAttribute('aria-label'), t('wiz.motion.pause'), 'and it says what it does');
  m.destroy();
}

/* ---- 2. words from the table, figures from the wizard's formatter ---- */
{
  const { m } = mount();
  const text = m.root.textContent;
  for (const key of ['wiz.title', 'wiz.step.name', 'wiz.step.period', 'wiz.step.how', 'wiz.how.csv.title',
    'nav.import', 'nav.budgets', 'bud.total.income', 'bud.total.budgeted', 'bud.total.left',
    'nav.plan', 'plan.hero.leftToPlace', 'plan.split.spokenFor', 'plan.split.notSpokenFor',
    'wiz.type.income', 'wiz.type.food', 'wiz.type.savings']) {
    ok(text.includes(t(key)), `the scenes say "${t(key)}" (${key}) from the translation table`);
  }
  ok(text.includes(t('wiz.stepOf', { n: 1, total: 7 })), 'the settings card counts its step the wizard\'s way');
  ok(text.includes(t('plan.hero.ofPot', { pot: money(8400, 0) })), 'the plan names its pot through the formatter');
  ok(text.includes(t('bud.remaining.over', { amount: money(60, 0) })), 'an overspent category says so, in the reader\'s money');
  for (const fig of [money(28500, 0), money(4200, 0), money(0, 0), signed(-842.1, 2), signed(28500, 2)]) {
    ok(text.includes(fig), `the figure ${fig} came through the wizard's formatter`);
  }
  ok(!/R\s?\d/.test(text), 'no rand figure is hard-coded: a reader in euros sees euros');
  ok(text.includes('Budget Vault'), 'the welcome scene carries the name');
  m.destroy();

  i18n.setLanguage('de');
  const de = mount();
  ok(de.m.root.textContent.includes(i18n.t('plan.hero.leftToPlace')), 'and in German it speaks German');
  ok(!de.m.root.textContent.includes('Left to place'), 'with no English left behind');
  de.m.destroy();
  i18n.setLanguage('en');
}

/* ---- 3. the timer moves one scene at a time and loops ---- */
{
  const { m, win } = mount();
  eq(win.timers.size, 1, 'one timer runs while the animation plays');
  const seen = [];
  for (let k = 0; k < 5; k++) {
    const ms = win.fire();
    eq(ms, SCENE_MS[k], `scene ${k + 1} holds for its own duration`);
    seen.push(onIndex(m.root));
    eq(win.timers.size, 1, 'and exactly one timer is waiting after each move');
  }
  eq(seen, [1, 2, 3, 4, 0], 'one scene at a time, back to the welcome after the plan');
  eq(byClass(m.root, 'bvm-scene').filter(s => s.hasClass('is-on')).length, 1, 'never two scenes on at once');
  m.destroy();
}

/* ---- 4. pause, resume and the dots ---- */
{
  const { m, win } = mount();
  const toggle = byClass(m.root, 'bvm-toggle')[0];
  toggle.click();
  ok(m.root.hasClass('is-paused'), 'pausing marks the root, which freezes the keyframes');
  eq(win.timers.size, 0, 'and stops the timer');
  eq(toggle.getAttribute('aria-label'), t('wiz.motion.play'), 'the button now offers to play');
  toggle.click();
  ok(!m.root.hasClass('is-paused'), 'playing again unfreezes them');
  eq(win.timers.size, 1, 'and starts the timer again');
  eq(onIndex(m.root), 0, 'on the scene it was paused on');

  /* The keyframes carry on from where they froze, so the timer must too: a
     scene paused 2 s in has the rest of its time left, not all of it again. */
  win.clock += 2000;
  toggle.click();
  win.clock += 60000;                       // however long the reader leaves it paused
  toggle.click();
  eq([...win.timers.values()][0].ms, SCENE_MS[0] - 2000, 'resuming waits out only what was left of the scene');

  byClass(m.root, 'bvm-dot')[3].click();
  eq(onIndex(m.root), 3, 'a dot jumps straight to its scene');
  eq(win.timers.size, 1, 'with one fresh timer, not a second one');
  eq([...win.timers.values()][0].ms, SCENE_MS[3], 'holding that scene for its full duration');
  eq(byClass(m.root, 'bvm-dot').map(d => d.getAttribute('aria-current')), ['false', 'false', 'false', 'true', 'false'],
    'and the dots follow');

  toggle.click();
  byClass(m.root, 'bvm-dot')[1].click();
  eq(onIndex(m.root), 1, 'a dot works while paused too');
  eq(win.timers.size, 0, 'without quietly un-pausing');
  m.destroy();
}

/* ---- 5. reduced motion ---- */
{
  const { m, win } = mount({ reduced: true });
  ok(m.root.hasClass('is-still'), 'reduced motion marks the root still, which shows every scene settled');
  eq(win.timers.size, 0, 'no timer: nothing moves on its own');
  const hidden = byClass(m.root, 'bvm-toggle')[0];
  ok(hidden && hidden.hasClass('bvm-gone'), 'and the pause button is hidden, since there is nothing to pause');
  byClass(m.root, 'bvm-dot')[4].click();
  eq(onIndex(m.root), 4, 'the dots still step through the scenes');
  eq(win.timers.size, 0, 'without starting anything');
  /* Turned OFF while the screen is open: the scenes start moving, so the
     button that can stop them has to come back with them. */
  win.mediaListeners[0]({ matches: false });
  ok(!m.root.hasClass('is-still'), 'turning reduced motion off lets it move again');
  ok(!hidden.hasClass('bvm-gone'), 'and brings the pause button back with it');
  eq(win.timers.size, 1, 'with the timer running');
  m.destroy();

  // Turned on while the screen is open: the timer stops at once.
  const live = mount();
  eq(live.win.mediaListeners.length, 1, 'the preference is listened to, not read once');
  live.win.mediaListeners[0]({ matches: true });
  ok(live.m.root.hasClass('is-still'), 'turning reduced motion on mid-way stills it');
  eq(live.win.timers.size, 0, 'and stops the timer');
  live.m.destroy();
}

/* ---- 6. nothing animates unseen ---- */
{
  const detached = mount({ live: false });
  eq(detached.win.timers.size, 0, 'a root that is not in a live document starts no timer');
  ok(byClass(detached.m.root, 'bvm-scene').length === 5, 'though it still builds every scene');
  detached.m.destroy();

  const bare = mount({ win: null });
  eq(byClass(bare.m.root, 'bvm-scene').length, 5, 'in bare node (no window at all) it builds without throwing');
  bare.m.destroy();

  const noObserver = mount({ observer: false });
  eq(onIndex(noObserver.m.root), 0, 'a WebView without ResizeObserver still gets the animation, unscaled');
  noObserver.m.destroy();
}

/* ---- 7. destroy takes everything down ---- */
{
  const { m, win } = mount();
  const obs = win.observers[0];
  ok(obs && obs.live, 'the stage is observed so it can scale to the dialog\'s width');
  m.destroy();
  eq(win.timers.size, 0, 'destroy clears the timer');
  ok(!obs.live, 'disconnects the resize observer');
  eq(win.mediaListeners.length, 0, 'and stops listening for the motion preference');
  m.destroy();
  ok(true, 'and a second destroy is harmless');
}

console.log(`PASS — welcome animation: five scenes, translated, one timer, pausable, still under reduced motion (${checks} checks).`);
