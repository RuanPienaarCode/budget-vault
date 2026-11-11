'use strict';
/* The Transactions page's note for rows filed under the wrong month's file.

   A reader who has seen an account's implied balance move comes to this page
   to find the row that moved it, and the row is not in the list: it is dated
   in one month and sits in another month's file, so no period reads it
   (src/misfiled.js has the rule and why the fast path that loses it is
   kept). This is where the app says so — it names each file and how many
   rows, and what to do — rather than moving a row the reader typed or
   quietly counting it.

   Its own module, and a plain function rather than a registered view: it
   publishes nothing and owns no page, so it needs no place in the wiring
   order (controller.js, and the two test harnesses that mirror it).
   views/transactions.js calls it once, beside its other top-of-page notices.

   WHERE IT IS DRAWN. Before `anchor` (the page's scope note), as a sibling of
   its own, built only while there is something to say and removed otherwise.
   Not a shell-defined hidden element: that would be an id the shell has to
   carry for a box that is absent on every healthy vault (tests/shell-contract
   covers ids the shell DEFINES, and a note it does not define must not be
   queried as if it did — the unreadable-files banner in controller.js is held
   by reference for the same reason). And not inside the scope note: that bar
   ends in a "Show them" button, which gives back rows a Dashboard
   drill-through hid and cannot give back these.

   It reuses the page's own notice bar (.tx-undo / .tx-undo-txt /
   .tx-undo-note), so it sits in the same column, with the same gutters, as
   the import-undo offer and the scope note above the table. role="status",
   like both of them. */

const { el } = require('../dom');
const i18n = require('../i18n');

/* How many files are named before the rest are counted. The unreadable-files
   banner names four for the same reason: the note has to be read, and a vault
   where a paste went wrong across a year of months would otherwise put
   twelve lines above the table it is explaining. */
const NAMED = 4;

/* anchor → the note drawn before it. Weak, so a closed view's nodes are not
   kept alive by a module that outlives every mount. */
const drawn = new WeakMap();

/* `period` is the period the page is showing, or null for the whole history.
   With a period the note covers the rows dated inside it (missing from this
   list) and the rows sitting in a file this period reads (the file the reader
   is looking at); for the whole history, every one in the vault — those rows
   ARE in that list, and are still in no period's totals. */
function renderMisfiledNote(ctx, anchor, period) {
  if (!anchor) return;
  const prior = drawn.get(anchor);
  if (prior) { prior.remove(); drawn.delete(anchor); }
  const host = anchor.parentElement;
  if (!host || typeof ctx.misfiledTx !== 'function') return;
  const found = ctx.misfiledTx(period, { withFiles: true });
  if (!found.count) return;
  const lines = found.files.slice(0, NAMED).map(f => el('div', {}, i18n.t('tx.misfiled.file', { count: f.count, file: f.rel })));
  const rest = found.files.length - NAMED;
  if (rest > 0) lines.push(el('div', {}, i18n.t('tx.misfiled.more', { count: rest })));
  const note = el('div', { class: 'tx-undo', role: 'status', 'data-note': 'misfiled' },
    el('div', { class: 'tx-undo-txt' }, lines,
      el('div', { class: 'tx-undo-note' }, i18n.t('tx.misfiled.why', { count: found.count }))));
  host.insertBefore(note, anchor);
  drawn.set(anchor, note);
}

module.exports = { renderMisfiledNote };
