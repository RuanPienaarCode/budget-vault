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
   60px bar. So at 600px and under, and on any .is-phone body whatever the
   orientation, the stylesheet hides the topbar copy and shows a second one
   as the first row of the app drawer, where a long client name has the
   drawer's whole width. Two selects rather than one element moved between
   parents: moving it would need a resize listener to agree with the CSS
   breakpoint, and would leave whichever place it was not in empty for a
   frame. Instead renderBookSwitchers fills every copy from the SAME
   bookChoices model in one call, so they show the same books and the same
   open book by construction, and controller.js routes every copy's change
   through pickBook. */
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

module.exports = { renderBookSwitcher, renderBookSwitchers, pickBook };
