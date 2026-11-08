'use strict';
/* What the Accounts inspector shows, decided without a DOM.

   The Accounts page used to be a table of eight columns whose State cell held a
   pill, a why-sentence and up to three buttons, and a drawer that opened under
   the row. On a real ~760px Obsidian pane a flagged row measured ~270px tall
   and its buttons were clipped. The page is now a quiet list (name, balance,
   one status word) and ONE inspector for the account the reader is looking at.
   Four questions that used to be answered inline, row by row, are answered
   here once:

     - which account does the inspector show when the reader has not picked one
     - what are the lines of the reconciliation, as numbers
     - which actions does THIS account get
     - how is a sentence fragment that carries its own leading " · " shown on a
       line of its own

   They live in a pure module for the reason reconcile.js and acct-status.js do:
   each is arithmetic or a rule over data the view already holds, and left in
   views/accounts.js none of it could be checked without rendering a page.

   Nothing here formats money or touches a language table. The view owns the
   words and the symbol; this module hands back figures and names. */

const { wantsALook, WARNINGS } = require('./acct-status');

/* The account to inspect.

   `shown` is the rows in the order the LIST draws them (grouped, or grouped by
   reason under "Needs a look"), not the order the sorter left them in — the
   reader's idea of "the first one" is the top of what they can see. `openName`
   is the reader's own choice, kept in S.acctView.open.

   Order of preference:
     1. the one they chose, if the current filter still shows it. A choice made
        under a filter that has since hidden the row is not a choice about
        anything on screen, so it is ignored rather than followed off-screen.
     2. the first account that wants a look. The page's whole job is the
        decision queue, so a reader who has chosen nothing is handed the first
        decision rather than the first balance.
     3. the first row, so the inspector is never empty while the list is not.
        An all-clear vault still has a first account worth showing.

   The default is recomputed on every render and never written back to
   S.acctView.open: once the flagged account is confirmed the default must move
   on to the next one, which a stored default would hold on the first. */
function pickSelection(shown, openName) {
  if (!shown || !shown.length) return null;
  if (openName) {
    const chosen = shown.find(r => r.a.name === openName);
    if (chosen) return chosen;
  }
  return shown.find(wantsALook) || shown[0];
}

/* The reconciliation as three figures, or null when there is no argument to
   make.

     stated   the balance the reader typed (a claim with an age)
     count    transactions dated after it
     delta    what those transactions add up to, IMPLIED − STATED in cents
     implied  what the account holds if every one of them is complete

   `delta` is derived from the two figures printed beside it rather than copied
   from reconcile()'s own `delta`: that one is rounded on its own and the stated
   figure can carry more than two decimals (a hand-typed 1000.005), so printing
   it would put three figures on screen that do not add up. Derived this way,
   stated + delta = implied to the cent on every row the page can draw.

   Only a DRIFT has lines. A clean account has nothing to argue about, and for
   every other state the honest answer is a sentence ("nothing imports into
   this account") that the view already words. `unreadable` is the caller's
   answer to "could the loader read the balance cell at all": an unreadable
   cell parses to a fabricated 0, and a "Stated on 1 Sep: R 0,00" line would
   print a number nobody typed. */
function reconSteps(r, unreadable) {
  const rec = r && r.rec;
  if (!rec || rec.state !== 'drift' || unreadable) return null;
  const stated = r.a.balance;
  const implied = rec.implied;
  return {
    stated,
    count: rec.count,
    delta: Math.round((implied - stated) * 100) / 100 || 0,
    implied,
  };
}

/* The buttons the inspector offers this account, as names the view maps onto
   its own handlers.

   A flagged account is a decision: the one-tap answer first (deckAction), the
   rows that explain it, and Ignore — the third answer — only for a state that
   is a judgement (WARNINGS). `unreadable` is a typo with one correct answer and
   is never offered Ignore, the same rule mutedWarnings applies to a
   hand-written key.

   An account that wants nothing is offered the two things a reader does to a
   quiet account: look at its rows, or correct its balance. A MUTED account is
   in this branch on purpose — the reader asked for the nagging to stop, so it
   gets no decision buttons — even though its state is not `ok`.

   `hasTransactions` is whether the account has a folder to open rows from.
   "See transactions" on an account nothing has imported into would open an
   empty list, so it is withheld rather than offered as a dead end.

   `primary` is 'answer' (the view's deckAction) or null; `secondary` sits
   beside it; `tools` is the row of smaller controls (edit balance, edit,
   include, open note, delete) the drawer used to carry. Edit balance is a tool
   only while a decision is on screen — for a quiet account it is already a
   main button, and printing it twice would be two controls for one dialog. */
function inspectorActions(r, { hasTransactions }) {
  if (wantsALook(r)) {
    const secondary = [];
    if (hasTransactions) secondary.push('transactions');
    if (WARNINGS.includes(r.state)) secondary.push('ignore');
    return { primary: 'answer', secondary, tools: ['editBalance', 'edit', 'budget', 'note', 'delete'] };
  }
  const secondary = [];
  if (hasTransactions) secondary.push('transactions');
  secondary.push('editBalance');
  return { primary: null, secondary, tools: ['edit', 'budget', 'note', 'delete'] };
}

/* acct.recon.pending and acct.recon.undatable are written to be glued onto the
   end of a sentence, so each carries its own leading " · " — the separator
   belongs to the fragment, so a language that wants a different join says so in
   its own table. On a line of their own that separator is a stray bullet, so
   it is trimmed here, in one place, rather than at each call site. */
const leadTrim = s => String(s || '').replace(/^[\s·]+/, '');

module.exports = { pickSelection, reconSteps, inspectorActions, leadTrim };
