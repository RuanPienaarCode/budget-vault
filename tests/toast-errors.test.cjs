'use strict';
/* An error toast interrupts, and stays long enough to be read.

   Every message this app shows the reader in passing goes through one toast:
   "Saved Debts.md" and "Could not save Debts.md (disk full)" alike. Both went
   into the same `role="status"` region, which a screen reader announces
   POLITELY — after whatever it is already saying, or not at all if the reader
   moves on — and both faded on the same clock: 2.6 seconds for a short one,
   never more than nine. So the one message that says the reader's edit did
   NOT reach the disk was the easiest to miss, by ear and by eye (audit of
   11 Nov 2026, task 18).

   src/toast.js keeps the two apart:

     - an error goes into a second region that is `role="alert"`, announced at
       once. Two regions, each with a fixed role, rather than one whose role
       is switched as the text changes — an element that becomes an alert in
       the same breath as it gains its text is not reliably announced as one.
     - an error stays at least twice as long as a success of the same length,
       with a higher floor and a higher ceiling.
     - only one of the two is ever showing, so a success never sits beside a
       stale error.
     - a toast that has gone is EMPTIED. It used to fade to opacity 0 with its
       text still in the accessibility tree, where a screen reader browsing the
       page found a "Saved" from ten minutes ago; and the same error twice in a
       row wrote the same text into the region, which is no change and so no
       announcement.

   Pinned through the real module, over the real shell markup:

     node tests/toast-errors.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { FakeEl } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

let toast;
try { toast = require('../src/toast'); } catch (e) { toast = null; }
ok(toast && typeof toast.showToast === 'function' && typeof toast.toastMs === 'function',
  'src/toast.js exports showToast and toastMs');
const { showToast, toastMs } = toast;

/* ---- 1. the shell: two regions, each with a fixed role -------------------- */
{
  const { SHELL_HTML } = require('../src/shell');
  const tag = id => (new RegExp(`<div id="${id}"[^>]*>`).exec(SHELL_HTML) || [''])[0];
  ok(/role="status"/.test(tag('toast')), 'the shell keeps #toast as a polite status region');
  ok(/role="alert"/.test(tag('toastAlert')), 'and ships #toastAlert as an alert, for errors');
  ok(!/hidden/.test(tag('toast')) && !/hidden/.test(tag('toastAlert')),
    'neither is display:none at rest — a live region has to be in the tree BEFORE it is written to');
  const after = SHELL_HTML.slice(SHELL_HTML.indexOf('</main>'));
  ok(after.includes('id="toast"') && after.includes('id="toastAlert"'),
    'both sit outside the page, so no hidden view and no inert container can silence them');
}

/* ---- 2. how long -------------------------------------------------------- */
{
  eq(toastMs('Saved'), 2600, 'a short success keeps the 2.6 s it always had');
  eq(toastMs('x'.repeat(100)), 5500, 'a longer one still reads at 55 ms a character');
  eq(toastMs('x'.repeat(400)), 9000, 'and is capped at nine seconds');

  ok(toastMs('No', true) >= 6000, `the shortest error stays at least six seconds (${toastMs('No', true)} ms)`);
  for (const n of [10, 60, 120, 240, 600]) {
    const msg = 'x'.repeat(n);
    ok(toastMs(msg, true) >= 2 * toastMs(msg), `an error of ${n} characters stays at least twice as long as a success of the same length`);
  }
  ok(toastMs('x'.repeat(2000), true) <= 30000, 'an error is still capped: a paragraph does not park over the page for good');
  ok(toastMs('x'.repeat(200), true) > toastMs('x'.repeat(100), true), 'and a longer error stays longer than a shorter one');
}

/* ---- 3. which region, and what is left behind ---------------------------- */
{
  // The clock, captured: what was scheduled, and nothing left running in node.
  const timers = [];
  const realSet = global.setTimeout, realClear = global.clearTimeout;
  global.setTimeout = (fn, ms) => { const h = { fn, ms, live: true }; timers.push(h); return h; };
  global.clearTimeout = h => { if (h) h.live = false; };
  const fire = () => { const due = timers.filter(h => h.live); for (const h of due) { h.live = false; h.fn(); } return due.length; };
  try {
    const good = new FakeEl('div'), bad = new FakeEl('div');
    const $ = sel => ({ '#toast': good, '#toastAlert': bad }[sel] || null);
    const shown = n => n.classList.contains('show');

    showToast($, 'Saved Debts.md');
    eq([good.textContent, shown(good), good.classList.contains('good')], ['Saved Debts.md', true, true], 'a success shows in the status region');
    eq([bad.textContent, shown(bad)], ['', false], 'and the alert region is empty and not showing');
    eq(timers.filter(h => h.live).map(h => h.ms), [2600], 'on the success clock');
    ok(good._h && good._h.live, 'the timer handle is on #toast, where the controller\'s destroy() clears it');

    showToast($, 'Could not save Debts.md (disk full)', true);
    eq([bad.textContent, shown(bad), bad.classList.contains('bad')], ['Could not save Debts.md (disk full)', true, true],
      'an error shows in the alert region');
    eq([good.textContent, shown(good)], ['', false], 'and the success it replaced is gone, text and all');
    const live = timers.filter(h => h.live);
    eq(live.length, 1, 'one clock is running, not one per toast');
    ok(live[0].ms >= 6000, 'the error clock');
    ok(good._h === live[0], 'still held on #toast, so destroy() clears an error\'s timer too');

    // It runs out: hidden first, then emptied once the fade is over.
    eq(fire(), 1, 'the toast\'s time runs out');
    eq(shown(bad), false, 'it is hidden');
    eq(bad.textContent, 'Could not save Debts.md (disk full)', 'with its text still there while it fades');
    eq(fire(), 1, 'and once the fade is over');
    eq(bad.textContent, '', 'the region is emptied, so nothing stale is left in the tree');
    eq(fire(), 0, 'and nothing else is scheduled');

    // The same error twice is two announcements, because the region was empty between them.
    showToast($, 'Amount must be a number', true);
    fire(); fire();
    showToast($, 'Amount must be a number', true);
    eq([bad.textContent, shown(bad)], ['Amount must be a number', true], 'the same error again is written into an emptied region');

    // A success after an error takes the error down.
    showToast($, 'Saved');
    eq([bad.textContent, shown(bad)], ['', false], 'a success that follows an error clears the alert');
    eq([good.textContent, shown(good)], ['Saved', true], 'and shows in its own region');

    // A shell with no alert region (an older test harness) still toasts.
    const only = new FakeEl('div');
    showToast(sel => (sel === '#toast' ? only : null), 'Could not save', true);
    eq([only.textContent, only.classList.contains('bad')], ['Could not save', true], 'with no alert region the error still shows, in the one there is');
    showToast(() => null, 'nothing to show it in');
    ok(true, 'and with no toast element at all it is a quiet no-op');
  } finally {
    global.setTimeout = realSet; global.clearTimeout = realClear;
  }
}

console.log(`PASS toast-errors — an error is an alert that stays twice as long, and a toast that has gone leaves nothing behind (${checks} checks)`);
