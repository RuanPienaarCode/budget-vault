'use strict';
/* The book switcher (the top bar's, or the drawer's on a phone): the two
   halves of it that are not the rule.

   The rule — which books there are, what they are called, whether a switch is
   allowed — is src/books.js (bookChoices, switchDecision), pure, and main.js
   switchBook() acts on it. What is left is small and is kept here, rather than
   inline in controller.js (which no bare-node test can mount), so that both
   halves run under a guard test against the real fake-DOM: that a single-book
   vault gets no visible control, and that a refusal is SAID instead of being
   swallowed.

   THE CONTROL IS A NATIVE <select>. On a phone that is the OS's own picker —
   thumb-sized rows, VoiceOver and TalkBack for free, nothing to dismiss — and
   a custom popover over a top bar that already carries a drawer, a period pill
   and an avatar would be a fifth thing competing for 360 px. The icon beside it
   is decoration (aria-hidden); the select carries the accessible name.

   HIDDEN, NOT ABSENT, in single-book mode. The wrapper is part of the static
   shell (src/shell.js) so the id contract (tests/shell-contract.test.cjs) has
   something to hold, and render() puts `hidden` on it and leaves it EMPTY — no
   options, so even a screen reader walking a display:none subtree finds
   nothing to announce, and a vault that never adds a second book sees no
   difference at all.

   TWO COPIES, ONE MODEL. A phone's top bar is menu | period pill | avatar,
   and the pill's label is the flexible part: with a switcher beside the
   avatar it was left about 0px at 375px wide (18px at 393px, 55px at 430px),
   so "Oct 22 – Nov 21, 2026" broke one word per line and spilled out of the
   60px bar. So at 900px and under, and on any .is-phone body whatever the
   orientation, the stylesheet hides the topbar copy and shows a second one
   as the first row of the app drawer, where a long client name has the
   drawer's whole width. (900px, the width at which the top bar itself goes to
   its narrow layout — src/styles.css, beside `.drawer-book`. This said 600px
   until the audit of 11 Nov 2026 noticed the stylesheet had never agreed.) Two selects rather than one element moved between
   parents: moving it would need a resize listener to agree with the CSS
   breakpoint, and would leave whichever place it was not in empty for a
   frame. Instead renderBookSwitchers fills every copy from the SAME
   bookChoices model in one call, so they show the same books and the same
   open book by construction, and controller.js routes every copy's change
   through settleBookSelect and then pickBook.

   A PICK IS NOT EVERY `change`. See settleBookSelect: on Windows and Linux
   the arrow keys step a closed select and fire `change` on each step, so
   switching on `change` opened every book a keyboard reader passed on the way
   to the one they wanted. */
const { el } = require('./dom');

/* Fill `select` from `model` (books.bookChoices) and show or hide `wrap`.
   Rebuilt every time: it is a handful of rows, and a diffing version would be
   a second place for the list to go stale after a settings change. */
function renderBookSwitcher(wrap, select, model) {
  const visible = !!(model && model.visible);
  wrap.classList.toggle('hidden', !visible);
  select.empty();
  if (!visible) return;
  for (const it of model.items) select.append(el('option', { value: it.folder }, it.label));
  /* An open folder that no book names (a hand-edited list) selects nothing
     rather than the first row, which would say a book is open that is not. */
  select.value = model.active ? model.active.folder : '';
}

/* Every copy of the switcher from one model: `pairs` is [[wrap, select], …]
   (the topbar copy and the drawer copy). One call, not one per copy, so no
   caller can redraw one and forget the other — after a switch, after a
   settings write (main.js refreshBookSwitchers -> applyBooks), and with the
   privacy splash up (model null: every copy hidden and emptied). */
function renderBookSwitchers(pairs, model) {
  for (const [wrap, select] of pairs) renderBookSwitcher(wrap, select, model);
}

/* Decide when a change of the select is the reader's ANSWER, and call
   `commit(folder)` then — once.

   The switch used to hang off `change` directly. For a mouse and for a
   phone's picker that is exactly right: `change` means "I chose this". For a
   keyboard on Windows and Linux it is not. The arrow keys there step a CLOSED
   select and fire `change` on every step, so a reader with five books who
   wanted the fourth reloaded the whole plugin three times on the way — three
   full vault reads, and three chances to be stopped by the unsaved-changes
   refusal at a book they were only passing (audit of 11 Nov 2026, task 18).
   Type-ahead does the same: a letter jumps to a book and fires `change`.

   So a change that comes from STEPPING is held, and settled by the two things
   that mean "this one": Enter, or leaving the control. Everything else
   commits at once, as it always did:

     - no key behind it — a mouse on the open list, a phone's picker. One
       step, unchanged. (The drawer copy on a phone never sees a key at all.)
     - Enter just before it — the reader chose from the OPEN list with Enter;
       the list closes and the change arrives after the key.
     - a key long before it — a list opened by key and picked from later. On
       macOS the open list is a native menu whose own keys never reach the
       page, so the only key the page saw is the one that opened it. Holding
       that pick until a second Enter would be a regression for every Mac
       keyboard user, to fix a platform they are not on.

   Which is why "stepping" is defined by TIME, not by "a key was pressed at
   some point": a step's change is fired by the keydown itself, in the same
   breath, and a pick from an open list comes hundreds of milliseconds after
   whatever key opened it. STEP_MS is a keystroke's worth of slack around
   zero, not a tuned figure.

   A step that returns to where it started switches nothing (down one, up
   one: the open book is still open). Escape drops a pending step and calls
   `cancel`, which controller.js answers by redrawing the select to the open
   book — otherwise it would go on showing a book that is not open.

   `now` is injected so the guard test owns the clock. Listeners are added
   straight onto the select, which lives and dies with the view's shell. */
const STEP_MS = 120;
const NOT_A_STEP = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
function settleBookSelect(select, commit, cancel, { now = Date.now } = {}) {
  let pending = false;        // a step is waiting to be settled
  let origin = null;          // the select's value before the first step of this run
  let lastStep = -Infinity;   // when a stepping key was last pressed
  let lastEnter = -Infinity;  // when Enter was last pressed with nothing pending
  const settle = () => {
    if (!pending) return;
    pending = false;
    if (select.value !== origin) commit(select.value);
  };
  select.addEventListener('keydown', e => {
    const key = e && e.key;
    if (key === 'Enter') { if (pending) settle(); else lastEnter = now(); return; }
    if (key === 'Escape') { if (pending) { pending = false; cancel(); } return; }
    if (NOT_A_STEP.has(key)) return;
    if (!pending) origin = select.value;
    lastStep = now();
  });
  select.addEventListener('change', () => {
    const at = now();
    if (at - lastEnter > STEP_MS && at - lastStep <= STEP_MS) { pending = true; return; }
    pending = false;
    commit(select.value);
  });
  select.addEventListener('blur', settle);
}

/* Ask the plugin to switch, and say why when it refuses. The reason is one of
   switchBook's three, each with its own sentence (books.switch.<reason>):
   a refusal that only logged would leave the select showing the book the
   reader just asked for while the screen kept the old one. `notify` is the
   Notice constructor's wrapper and `t` the i18n lookup, injected so this runs
   without Obsidian. Resolves to switchBook's own answer. */
async function pickBook(plugin, folder, { notify, t }) {
  let r;
  try {
    r = await plugin.switchBook(folder);
  } catch (e) {
    /* switchBook does not throw for its three reasons; anything else is a
       fault, and the control must not be left lying about which book is open. */
    console.error('Budget: switching books failed', e);
    r = { ok: false, reason: 'unknown' };
  }
  if (!r.ok) notify(t(`books.switch.${r.reason}`));
  return r;
}

module.exports = { renderBookSwitcher, renderBookSwitchers, settleBookSelect, pickBook };
