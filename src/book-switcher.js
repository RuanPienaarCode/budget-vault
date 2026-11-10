'use strict';
/* The top-bar book switcher: the two halves of it that are not the rule.

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
   difference at all. */
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

module.exports = { renderBookSwitcher, pickBook };
