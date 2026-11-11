'use strict';
/* The navigation drawer's two states, and what each does to the rest of the
   app.

   Lifted out of controller.js, which no bare-node test can mount (mountApp
   needs a DOMParser shell), for the reason src/book-switcher.js gives for
   itself: what is left here is small, and it is exactly the part a keyboard or
   screen-reader user depends on, so it runs under a guard test against the
   stub DOM (tests/drawer-modal.test.cjs). controller.js keeps the wiring —
   which button opens it, that Escape closes it.

   THE OPEN DRAWER IS MODAL. It draws a full-page overlay over the app, and
   until the audit of 11 Nov 2026 (task 18) that overlay was only paint: the
   top bar, the page and the dock underneath it stayed in the tab order and in
   the accessibility tree. One Tab past the last drawer link and a keyboard
   reader was operating the table behind a sheet they could not see through;
   a screen reader walked out of the menu into the page. So everything the
   overlay covers is made inert while the drawer is open — through dom.js
   setInert, never the bare attribute: `inert` is Safari 15.5+ and this
   plugin's floor is iOS 15.0, where the attribute parses and does nothing.

   `.main-content`, not the `.bud-scroll` box around it. The privacy gate
   locks `.bud-scroll` (controller.js lockGate), and keeping the page's two
   locks on two different nodes means neither can lift the other's.

   A CLOSE RELEASES ONLY WHAT AN OPEN LOCKED. closeDrawer is called from a
   dozen places that are not "the reader closed the drawer" — every view
   switch, every reload, lockGate itself — and the gate locks the same top bar
   and dock. A close that released them unconditionally would put the balances
   behind a locked gate back in the tab order on the next vault change. The
   drawer cannot be open while the gate is up (lockGate closes it first, and
   the button that opens it is behind the gate), so "was it open" is the whole
   test, and it is the one the focus restore below already used. */

const { setInert } = require('./dom');

/* What the overlay covers, as the selectors controller.js's `$` resolves. */
const BEHIND = ['.topbar', '.main-content', '#bvDock'];

function openDrawer($) {
  const d = $('#appDrawer');
  d.classList.add('open');
  setInert(d, false);                         // re-enter the tab / AT order
  for (const sel of BEHIND) setInert($(sel), true);
  $('#drawerOverlay').classList.add('open');
  $('#menuBtn').setAttribute('aria-expanded', 'true');
  $('#drawerClose').focus();                  // move focus into the drawer
}

function closeDrawer($) {
  const d = $('#appDrawer');
  const wasOpen = d.classList.contains('open');
  d.classList.remove('open');
  setInert(d, true);                          // leave the tab / AT order
  /* Released before the focus below, which lands on a button INSIDE one of
     them: an inert control refuses focus. */
  if (wasOpen) for (const sel of BEHIND) setInert($(sel), false);
  $('#drawerOverlay').classList.remove('open');
  $('#menuBtn').setAttribute('aria-expanded', 'false');
  if (wasOpen) $('#menuBtn').focus();         // restore focus only on a real close
}

module.exports = { openDrawer, closeDrawer, BEHIND };
