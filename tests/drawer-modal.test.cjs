'use strict';
/* The open drawer is modal: nothing behind it can be reached.

   Opening the drawer drew a full-page overlay over the app, moved focus onto
   the drawer's close button, and stopped there. Everything under the overlay
   stayed in the tab order and in the accessibility tree: one Tab past the last
   drawer link and a keyboard reader was operating the Transactions table
   through a sheet they could not see past, and a screen reader walked straight
   out of the menu into the page behind it (audit of 11 Nov 2026, task 18).
   Closing was already right — the drawer goes inert and focus returns to the
   menu button.

   src/drawer.js now takes the three things the overlay covers out of reach
   while the drawer is open — the top bar, the page, the dock — with
   src/dom.js setInert, which carries the iOS 15.0–15.4 fallback (`inert` is
   Safari 15.5+; on the floor the attribute parses and does nothing). Node has
   no HTMLElement, so this suite runs the FALLBACK path: the one no developer's
   own browser exercises.

   Pinned, through the real module:

     1. open: the drawer is reachable, the three behind it are not, and focus
        is on the drawer's close button.
     2. close: the three are released, the drawer is inert again, and focus is
        back on the menu button — which must be released BEFORE it is focused,
        or the focus is refused.
     3. a close that did not follow an open releases NOTHING. The privacy gate
        locks the same top bar and dock, and closeDrawer() is called from a
        dozen places (every view switch, every reload). If each of those
        released what the gate had locked, the balances behind a locked gate
        would be back in the tab order. That is the regression this fix must
        not buy.
     4. open twice, close once: still fully released (no leftover lock).

     node tests/drawer-modal.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { installFocus } = require('./helpers/focus-stub.cjs');
const focus = installFocus();
const { el, setInert } = require('../src/dom');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

let drawer;
try { drawer = require('../src/drawer'); } catch (e) { drawer = null; }
ok(drawer && typeof drawer.openDrawer === 'function' && typeof drawer.closeDrawer === 'function',
  'src/drawer.js exports openDrawer and closeDrawer');

/* The shell's own nesting (src/shell.js): overlay, drawer, top bar, the scroll
   box around the page, and the dock, all siblings under the root. */
function shell() {
  const drawerClose = el('button', { id: 'drawerClose' }, 'x');
  const appDrawer = el('nav', { id: 'appDrawer', inert: '' }, drawerClose, el('button', { class: 'drawer-link' }, 'Dashboard'));
  const menuBtn = el('button', { id: 'menuBtn', 'aria-expanded': 'false' }, 'menu');
  const topbar = el('header', { class: 'topbar' }, menuBtn, el('button', { id: 'brandHome' }, 'home'));
  const main = el('main', { class: 'main-content' }, el('button', { id: 'txSave' }, 'Save'));
  const scroll = el('div', { class: 'bud-scroll' }, main);
  const dock = el('nav', { id: 'bvDock' }, el('button', { class: 'dock-btn' }, 'Budget'));
  const overlay = el('div', { id: 'drawerOverlay' });
  const root = el('div', {}, overlay, appDrawer, topbar, scroll, dock);
  const map = { '#appDrawer': appDrawer, '#drawerClose': drawerClose, '#menuBtn': menuBtn, '#drawerOverlay': overlay,
    '.topbar': topbar, '.main-content': main, '.bud-scroll': scroll, '#bvDock': dock };
  return { $: sel => map[sel] || null, root, appDrawer, drawerClose, menuBtn, topbar, main, scroll, dock, overlay };
}
const inert = n => n.hasAttribute('inert');
const behind = s => [s.topbar, s.main, s.dock];

/* ---- 1. open --------------------------------------------------------------- */
{
  const s = shell();
  focus.on(s.menuBtn);
  drawer.openDrawer(s.$);
  eq(inert(s.appDrawer), false, 'open: the drawer is reachable');
  ok(s.appDrawer.classList.contains('open') && s.overlay.classList.contains('open'), 'open: the drawer and its overlay are shown');
  eq(behind(s).map(inert), [true, true, true], 'open: the top bar, the page and the dock are inert');
  eq(behind(s).map(n => n.getAttribute('aria-hidden')), ['true', 'true', 'true'],
    'open: and hidden from a screen reader on the engines with no `inert` (the fallback path)');
  eq(s.menuBtn.getAttribute('aria-expanded'), 'true', 'open: the menu button says the drawer is expanded');
  eq(focus.at(), s.drawerClose, 'open: focus is on the drawer\'s close button');

  /* ---- 2. close ------------------------------------------------------------ */
  let releasedFirst = null;
  const realFocus = s.menuBtn.focus;
  s.menuBtn.focus = function () { releasedFirst = !inert(s.topbar); return realFocus.call(this); };
  drawer.closeDrawer(s.$);
  eq(inert(s.appDrawer), true, 'close: the drawer leaves the tab order again');
  ok(!s.appDrawer.classList.contains('open') && !s.overlay.classList.contains('open'), 'close: the drawer and overlay are hidden');
  eq(behind(s).map(inert), [false, false, false], 'close: the top bar, the page and the dock are released');
  eq(behind(s).map(n => n.getAttribute('aria-hidden')), [null, null, null], 'close: with no aria-hidden left behind');
  eq(s.menuBtn.getAttribute('aria-expanded'), 'false', 'close: the menu button says collapsed');
  eq(focus.at(), s.menuBtn, 'close: focus is back on the menu button');
  eq(releasedFirst, true, 'close: the top bar was released BEFORE its menu button was focused');
}

/* ---- 3. a close with nothing open leaves the gate's lock alone -------------- */
{
  const s = shell();
  // What lockGate does (controller.js): the same top bar and dock, and the
  // scroll box around the page.
  for (const n of [s.topbar, s.scroll, s.dock]) setInert(n, true);
  focus.reset();
  drawer.closeDrawer(s.$);
  eq([s.topbar, s.scroll, s.dock].map(inert), [true, true, true],
    'a close that did not follow an open does not release what the privacy gate locked');
  eq([s.topbar, s.dock].map(n => n.getAttribute('aria-hidden')), ['true', 'true'], 'nor its screen-reader half');
  ok(focus.lost(), 'and it does not move focus onto a menu button behind the gate');
}

/* ---- 4. open twice, close once ---------------------------------------------- */
{
  const s = shell();
  drawer.openDrawer(s.$);
  drawer.openDrawer(s.$);
  drawer.closeDrawer(s.$);
  eq(behind(s).map(inert), [false, false, false], 'a repeated open is released by one close');
  drawer.closeDrawer(s.$);
  eq(behind(s).map(inert), [false, false, false], 'and a repeated close changes nothing');
}

console.log(`PASS drawer-modal — the open drawer inerts what its overlay covers, and a close releases only what an open locked (${checks} checks)`);
