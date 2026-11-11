'use strict';
/* The open drawer stays modal when the page behind it is redrawn.

   tests/drawer-modal.test.cjs pins the open and the close. This is what
   happens BETWEEN them, on the engines the fallback exists for.

   `inert` is Safari 15.5+. On iOS 15.0-15.4 — this plugin's floor — the
   attribute parses and does nothing, so src/dom.js setInert reproduces it by
   hand: tabindex="-1" on every focusable descendant, plus aria-hidden. But
   "every focusable descendant" means the ones that exist at the moment it is
   called. The drawer covers the top bar, the page and the dock on open, and
   the page does not stop redrawing because a menu is over it: a save that was
   in flight when the drawer opened finishes and rebuilds its table, a sync
   lands and the watcher re-renders, a debounced search fires. Every one of
   those builds NEW controls, none of which carry the tabindex — so one Tab
   past the last drawer link and a keyboard reader on an iPhone 13 that never
   took the 15.5 update was operating a table behind an overlay again, which
   is the defect the first fix closed (audit of 11 Nov 2026, task 18).

   Real `inert` covers whatever the subtree holds at any moment. The fallback
   now does too: while the drawer is open it watches the three things it
   covers and stamps what is added to them. Pinned here, through the real
   module, on the fallback path (node has no HTMLElement):

     1. controls drawn behind the open drawer leave the tab order — in the
        page, the top bar and the dock — and focus stays in the drawer.
     2. a close releases them all, leaves no bookkeeping, and puts back a
        tabindex a new control was BUILT with.
     3. after a close nothing is watched: a redraw is not made inert.
     4. a redraw and a close in the same task: the close wins, and the
        redraw's controls are never stamped afterwards.
     5. THE PRIVACY GATE. The gate locks the same top bar and dock, and the
        scroll box around the page, and closes the drawer first. The watch
        must be gone by the time the gate is up — it can only ever ADD a lock,
        but a watcher that outlived its drawer would be one more thing holding
        the page after the gate lifts. And a gate that is up is never lifted
        by a drawer that was never opened.
     6. on an engine WITH `inert` nothing is watched at all: the attribute
        already covers the redraw, and an observer would be work for nothing.
     7. a landing behind the overlay is refused. dom.js refocus restores focus
        after a rebuild; a tabindex of -1 keeps a control out of the Tab order
        and does NOT stop focus() — so on the fallback a handler finishing
        behind the drawer (or the gate) could have put focus on the control it
        had just redrawn. Real `inert` refuses that focus; refocus now passes
        over anything under an inert ancestor, on every engine.

   The stub DOM has no MutationObserver and its querySelectorAll reads one
   simple selector, so this file installs the two things the fallback needs:
   a selector list, and an observer that queues a record when a child is added
   under a watched node and delivers on a microtask, as a browser does —
   including that disconnect() drops what is queued.

     node tests/drawer-redraw.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { FakeEl, descend } = require('./helpers/dom-stub.cjs');
const { installFocus } = require('./helpers/focus-stub.cjs');
const focus = installFocus();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- a selector list, for setInert's two queries --------------------------
   'a[href],button,input,select,textarea,summary,[tabindex]' and
   '[data-bud-ti]'. Patched for this process only, like the focus model. */
{
  const one = (el, sel) => {
    const m = /^([a-z]*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(sel.trim());
    if (!m) return sel.startsWith('.') ? el._cls.has(sel.slice(1)) : sel.startsWith('#') ? el.attrs.id === sel.slice(1) : false;
    const [, tag, attr, value] = m;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    if (attr && !(attr in el.attrs)) return false;
    if (attr && value !== undefined && el.attrs[attr] !== value) return false;
    return !!(tag || attr);
  };
  FakeEl.prototype.querySelectorAll = function (sel) {
    const parts = String(sel).split(',');
    return descend(this).filter(e => parts.some(p => one(e, p)));
  };
  FakeEl.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
}

/* ---- MutationObserver, for the stub DOM ----------------------------------- */
const observers = new Set();
{
  const under = (root, node) => { for (let n = node; n; n = n._parent) if (n === root) return true; return false; };
  const notify = target => {
    for (const o of observers) {
      if (!o.targets.some(t => under(t, target))) continue;
      o.queue.push({ type: 'childList', target });
      if (!o.scheduled) {
        o.scheduled = true;
        Promise.resolve().then(() => {
          o.scheduled = false;
          const records = o.queue.splice(0);
          if (records.length) o.cb(records, o);
        });
      }
    }
  };
  global.MutationObserver = class {
    constructor(cb) { this.cb = cb; this.targets = []; this.queue = []; this.scheduled = false; }
    observe(target, opts) {
      assert.ok(opts && opts.childList && opts.subtree, 'the watch is on children, through the whole subtree');
      assert.ok(!opts.attributes, 'and NOT on attributes: the fallback writes tabindex itself, and would wake its own watcher for ever');
      this.targets.push(target);
      observers.add(this);
    }
    disconnect() { this.targets = []; this.queue = []; observers.delete(this); }
  };
  for (const name of ['append', 'replaceChildren', 'empty']) {
    const real = FakeEl.prototype[name];
    FakeEl.prototype[name] = function (...args) { const out = real.apply(this, args); notify(this); return out; };
  }
}
const tick = () => new Promise(r => setImmediate(r));

const { el, setInert, refocus } = require('../src/dom');
const drawer = require('../src/drawer');

/* The shell's own nesting (src/shell.js), as tests/drawer-modal.test.cjs has it. */
function shell() {
  const drawerClose = el('button', { id: 'drawerClose' }, 'x');
  const appDrawer = el('nav', { id: 'appDrawer', inert: '' }, drawerClose, el('button', { class: 'drawer-link' }, 'Dashboard'));
  const menuBtn = el('button', { id: 'menuBtn', 'aria-expanded': 'false' }, 'menu');
  const topbar = el('header', { class: 'topbar' }, menuBtn);
  const table = el('div', { id: 'txTable' }, el('button', {}, 'old row'));
  const main = el('main', { class: 'main-content' }, table);
  const scroll = el('div', { class: 'bud-scroll' }, main);
  const dock = el('nav', { id: 'bvDock' }, el('button', { class: 'dock-btn' }, 'Budget'));
  const overlay = el('div', { id: 'drawerOverlay' });
  const root = el('div', {}, overlay, appDrawer, topbar, scroll, dock);
  const map = { '#appDrawer': appDrawer, '#drawerClose': drawerClose, '#menuBtn': menuBtn, '#drawerOverlay': overlay,
    '.topbar': topbar, '.main-content': main, '.bud-scroll': scroll, '#bvDock': dock };
  return { $: sel => map[sel] || null, root, appDrawer, drawerClose, menuBtn, topbar, table, main, scroll, dock };
}
const ti = n => n.getAttribute('tabindex');
/* Remembered tabindexes still standing in what the overlay covers. The closed
   drawer is inert itself, so its own two buttons rightly carry one. */
const kept = s => [s.topbar, s.scroll, s.dock].reduce((n, e) => n + e.querySelectorAll('[data-bud-ti]').length, 0);
const inert = n => n.hasAttribute('inert');

(async () => {
  /* ---- 1. a redraw behind the open drawer -------------------------------- */
  {
    const s = shell();
    focus.on(s.menuBtn);
    drawer.openDrawer(s.$);
    eq(ti(s.table.children[0]), '-1', 'precondition: what was there on open is out of the tab order');

    // The page redraws its table; the top bar and the dock each gain a control.
    const row = el('button', {}, 'new row'), field = el('input', { type: 'text' }), link = el('a', { href: '#' }, 'link');
    s.table.empty();
    s.table.append(el('div', {}, row, field, link));
    const bell = el('button', {}, 'bell'), save = el('button', { class: 'dock-save' }, 'Save');
    s.topbar.append(bell);
    s.dock.append(save);
    eq([row, field, link, bell, save].map(ti), [null, null, null, null, null], 'precondition: a control just built carries no tabindex');
    await tick();
    eq([row, field, link].map(ti), ['-1', '-1', '-1'], 'controls drawn into the page behind the open drawer leave the tab order');
    eq([bell, save].map(ti), ['-1', '-1'], 'and so do ones drawn into the top bar and the dock');
    eq([s.topbar, s.main, s.dock].map(n => n.getAttribute('aria-hidden')), ['true', 'true', 'true'], 'the screen-reader half still stands');
    eq(focus.at(), s.drawerClose, 'and focus has stayed in the drawer');

    // A control BUILT with a tabindex, drawn behind the drawer.
    const roving = el('div', { tabindex: '0' }, 'tab stop');
    s.table.append(roving);
    await tick();
    eq(ti(roving), '-1', 'a control built with its own tabindex is taken out too');

    /* ---- 2. the close releases every one of them ------------------------- */
    drawer.closeDrawer(s.$);
    eq([row, field, link, bell, save].map(ti), [null, null, null, null, null], 'a close releases what was drawn behind the drawer');
    eq(ti(roving), '0', 'and puts back the tabindex a control was built with');
    eq(kept(s), 0, 'with no bookkeeping left behind');
    eq([s.topbar, s.main, s.dock].map(inert), [false, false, false], 'and the three it covered released');
    eq(focus.at(), s.menuBtn, 'focus back on the menu button');

    /* ---- 3. nothing is watched once it is closed ------------------------- */
    eq(observers.size, 0, 'the watch ends with the drawer');
    const later = el('button', {}, 'later');
    s.table.append(later);
    await tick();
    eq(ti(later), null, 'a redraw after the close is not made inert');
  }

  /* ---- 4. a redraw and a close in the same task ---------------------------- */
  {
    const s = shell();
    drawer.openDrawer(s.$);
    const row = el('button', {}, 'row');
    s.table.append(row);          // queued for the watcher…
    drawer.closeDrawer(s.$);      // …and dropped with it
    await tick();
    eq(ti(row), null, 'a control drawn in the same task as the close is never stamped afterwards');
    eq(inert(s.main), false, 'and the page is not left inert behind a closed drawer');

    // The drawer shut by something that never went through closeDrawer: the
    // watch asks before it locks, so it does not re-lock a page it should
    // not be holding.
    drawer.openDrawer(s.$);
    s.appDrawer.classList.remove('open');
    const stray = el('button', {}, 'stray');
    s.table.append(stray);
    await tick();
    eq(ti(stray), null, 'a watcher whose drawer is no longer open locks nothing');
    s.appDrawer.classList.add('open');
    drawer.closeDrawer(s.$);

    // Open, close, open again: one watcher, not two.
    drawer.openDrawer(s.$);
    drawer.openDrawer(s.$);
    eq(observers.size, 1, 'a repeated open leaves one watcher, not one per open');
    drawer.closeDrawer(s.$);
    eq(observers.size, 0, 'which the one close ends');
  }

  /* ---- 5. the privacy gate ------------------------------------------------- */
  {
    const s = shell();
    drawer.openDrawer(s.$);
    // controller.js lockGate: closeDrawer() first, then the gate's own lock.
    drawer.closeDrawer(s.$);
    const gate = [s.topbar, s.scroll, s.dock];
    for (const n of gate) setInert(n, true);
    eq(observers.size, 0, 'the drawer\'s watch is gone by the time the gate is up');
    const balances = el('button', {}, 'R 12 345');
    s.table.append(balances);
    await tick();
    // controller.js render(): the gate re-asserts its own lock after a redraw.
    setInert(s.scroll, true);
    eq(ti(balances), '-1', 'a redraw under the gate is locked by the gate\'s own re-assert, as before');

    // A close with nothing open — every view switch, every reload — lifts nothing.
    drawer.closeDrawer(s.$);
    await tick();
    eq(gate.map(inert), [true, true, true], 'a close that did not follow an open leaves the gate\'s lock alone');
    eq(ti(balances), '-1', 'and what is behind it out of the tab order');
    eq(ti(s.menuBtn), '-1', 'the menu button included');

    // The gate lifts: nothing the drawer did is still holding the page.
    for (const n of gate) setInert(n, false);
    eq(gate.map(inert), [false, false, false], 'the gate\'s own unlock releases everything');
    eq(kept(s), 0, 'with no bookkeeping left behind');
    eq(ti(balances), null, 'and the page back in the tab order');
  }

  /* ---- 7. a landing behind the overlay is refused -------------------------- */
  {
    const s = shell();
    drawer.openDrawer(s.$);
    const pill = el('button', { 'data-focus-key': 'pill:0' }, 'pill');
    s.table.empty();
    s.table.append(pill);
    await tick();
    // Focus lost (as after a tap that focused nothing), and a handler finishing
    // behind the drawer asks for its control back.
    focus.reset();
    eq(refocus(s.table, 'pill:0'), null, 'refocus does not land on a control under an inert ancestor');
    ok(focus.lost(), 'so focus is not put behind the overlay');
    drawer.closeDrawer(s.$);
    focus.reset();
    eq(refocus(s.table, 'pill:0'), pill, 'once the drawer is closed the same landing is taken');
  }

  /* ---- 6. an engine with `inert`: nothing to watch ------------------------- */
  {
    global.HTMLElement = function HTMLElement() {};
    global.HTMLElement.prototype = { inert: false };
    for (const f of ['../src/dom', '../src/drawer']) delete require.cache[require.resolve(f)];
    const modern = require('../src/drawer');
    const s = shell();
    modern.openDrawer(s.$);
    eq(observers.size, 0, 'where `inert` is real, the open drawer watches nothing');
    eq([s.topbar, s.main, s.dock].map(inert), [true, true, true], 'the attribute alone covers what is behind it');
    const row = el('button', {}, 'row');
    s.table.append(row);
    await tick();
    eq(ti(row), null, 'and no tabindex is written onto what the page draws');
    modern.closeDrawer(s.$);
    eq([s.topbar, s.main, s.dock].map(inert), [false, false, false], 'released as before');
    delete global.HTMLElement;
  }

  console.log(`PASS drawer-redraw — the open drawer stays modal through a redraw on the engines with no \`inert\`, and never touches the gate's lock (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
