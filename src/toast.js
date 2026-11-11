'use strict';
/* The toast: the one line every passing message is shown in.

   Lifted out of controller.js (which no bare-node test can mount) for the same
   reason as src/drawer.js: what is here is small, and it is the part a reader
   who cannot see the screen, or cannot read it quickly, depends on.

   TWO REGIONS, EACH WITH A FIXED ROLE. "Saved Debts.md" and "Could not save
   Debts.md (disk full)" used to go into the same `role="status"` element. A
   status region is announced POLITELY — after whatever the screen reader is
   already saying, or not at all if the reader moves on — so the one message
   that says an edit did NOT reach the disk was the easiest to miss (audit of
   11 Nov 2026, task 18). An error now goes into #toastAlert, which is
   `role="alert"` and announced at once. A second element rather than one whose
   role is switched per message: an element that becomes an alert in the same
   breath as it gains its text is not reliably announced as one, and the whole
   point is that this cannot be missed. Both are in the shell from the start
   and neither is ever display:none — a live region has to be in the
   accessibility tree BEFORE it is written to, which is the same rule the
   Transactions page's two status lines were breaking.

   Only one shows at a time. A success takes a standing error down, and the
   other way round, so the two can never contradict each other on screen.

   A TOAST THAT HAS GONE IS EMPTIED. It used to fade to opacity 0 with its
   text still in the tree, where a screen reader browsing the page found a
   "Saved" from ten minutes ago — and where the same error twice in a row
   wrote the same text over itself, which is no change and so no announcement.
   Emptied a moment AFTER it is hidden, not with it: the fade is a quarter of a
   second, and an empty pill fading out reads as a glitch.

   ONE TIMER HANDLE, ON #toast, whichever region is showing. controller.js's
   destroy() clears `$('#toast')._h` when the view closes; keeping the handle
   there means an error's timer is cleared by the same line, with no second
   place to remember. */

/* How long a toast stays, in milliseconds.

   A success: long enough to read. A flat 2.6 s suited "Saved"; it cut off the
   two-sentence toasts — the drift warning after a balance edit, the "counts as
   already inside that balance" note after Add transaction — before a reader
   reached the second sentence. 55 ms a character, with the old 2.6 s as the
   floor and a 9 s cap so a paragraph does not park over the page.

   An error: twice that, on every count. 55 ms a character is about 220 words
   a minute, an ordinary silent reading pace and well beyond a reader using a
   magnifier, reading in their second language, or looking up from the field
   they were typing in — and an error is the message they must not lose. So
   110 ms a character, a 6 s floor (noticing it is part of reading it) and a
   30 s cap. Not "until dismissed": that needs a button inside the alert, and
   a refused amount would then need a tap to clear before every retry. */
function toastMs(msg, bad = false) {
  const n = String(msg).length;
  return bad
    ? Math.min(30000, Math.max(6000, n * 110))
    : Math.min(9000, Math.max(2600, n * 55));
}

/* The fade is .25s (styles.css, #toast); the text goes just after it. */
const FADE_MS = 300;

function showToast($, msg, bad = false) {
  const status = $('#toast');
  if (!status) return;
  // A shell without the alert region still toasts, in the one it has.
  const alert = $('#toastAlert');
  const show = bad && alert ? alert : status;
  const other = show === status ? alert : status;
  clearTimeout(status._h);
  if (other) { other.classList.remove('show'); other.textContent = ''; }
  show.textContent = msg;
  show.className = bad ? 'bad' : 'good';
  show.classList.add('show');
  status._h = setTimeout(() => {
    show.classList.remove('show');
    status._h = setTimeout(() => { show.textContent = ''; }, FADE_MS);
  }, toastMs(msg, bad));
}

module.exports = { showToast, toastMs };
