'use strict';
/* refocus(): after a rebuild, focus goes back where the reader was.

   Almost every page here redraws by emptying a container and building it
   again. When the control that asked for the redraw lived inside that
   container — a row's delete, a status pill, "Show more", a chart's range
   pill — it is destroyed with everything else, and a browser parks focus on
   <body>. For a keyboard reader that is the top of the page after every
   single press; for a screen reader it is silence. Four views had each
   written their own restore (tax, debts, owed, assets); the other handlers
   had none (audit of 11 Nov 2026, task 16).

   src/dom.js refocus(root, keys) is the one helper they now share. A control
   that should be findable again after a rebuild carries `data-focus-key`, and
   the handler names the key — or a list of them, first match wins, so "the row
   that took this one's place, else the one above, else the Add button" is one
   call. This pins the helper itself; the views are pinned in
   tests/refocus-views.test.cjs.

     1. the keyed element takes focus when the rebuild lost it.
     2. a list falls through to the first key that exists.
     3. an entry may be an element (a control outside the rebuilt root).
     4. a candidate that cannot take focus — hidden, disabled — is passed over
        rather than counted as a landing.
     5. focus that is somewhere REAL is left alone: the control survived the
        rebuild, or the reader moved on while a save was in flight. Stealing it
        would be a second defect, not a fix. A focused control that has been
        HIDDEN is not somewhere real — the browser drops it a frame later.
     6. nothing to find, or no root, is a quiet no-op.

     node tests/dom-refocus.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
const { installFocus } = require('./helpers/focus-stub.cjs');

stubObsidian();
const focus = installFocus();
const { el, refocus } = require('../src/dom');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

eq(typeof refocus, 'function', 'src/dom.js exports refocus');

const row = i => el('tr', {},
  el('td', {}, el('button', { 'data-focus-key': `pill:${i}` }, 'pill')),
  el('td', {}, el('button', { 'data-focus-key': `del:${i}` }, 'x')));
const build = (root, n) => { root.empty(); for (let i = 0; i < n; i++) root.append(row(i)); };
const find = (root, key) => root.querySelector(`[data-focus-key="${key}"]`);

/* ---- 1. the plain case: same key, new element ---------------------------- */
{
  const t = el('tbody', {});
  build(t, 3);
  const before = focus.on(find(t, 'pill:1'));
  build(t, 3);
  ok(focus.lost(), 'the rebuild destroyed the focused control: focus is on <body>');
  const hit = refocus(t, 'pill:1');
  ok(hit && hit !== before, 'refocus returns the NEW element carrying the key');
  eq(focus.at(), hit, 'and focus is on it');
}

/* ---- 2. a list: first key that exists ------------------------------------ */
{
  const t = el('tbody', {});
  build(t, 3);
  focus.on(find(t, 'del:2'));
  build(t, 2);                                    // the last row was deleted
  refocus(t, ['del:2', 'del:1', 'del:0']);
  eq(focus.key(), 'del:1', 'the row above takes focus when the one below is gone');

  focus.on(find(t, 'del:0'));
  build(t, 1);
  refocus(t, ['del:0', 'del:-1']);
  eq(focus.key(), 'del:0', 'the row that moved up into the deleted one\'s place is preferred');
}

/* ---- 3. an element as the last resort ------------------------------------ */
{
  const t = el('tbody', {});
  const add = el('button', { id: 'add' }, 'Add');
  build(t, 1);
  focus.on(find(t, 'del:0'));
  build(t, 0);                                    // the only row went
  const hit = refocus(t, ['del:0', 'del:-1', add]);
  eq(hit, add, 'with no keyed row left, the element named last is the landing');
  eq(focus.at(), add, 'and it has focus');
}

/* ---- 4. a candidate that cannot take focus is passed over ---------------- */
{
  const t = el('tbody', {});
  build(t, 2);
  focus.on(find(t, 'del:1'));
  build(t, 2);
  find(t, 'del:1').disabled = true;
  refocus(t, ['del:1', 'del:0']);
  eq(focus.key(), 'del:0', 'a disabled control is skipped');

  focus.reset();
  const bar = el('div', { class: 'hidden' }, el('button', { 'data-focus-key': 'undo' }, 'Undo'));
  const page = el('div', {}, bar, el('button', { 'data-focus-key': 'next' }, 'Next'));
  refocus(page, ['undo', 'next']);
  eq(focus.key(), 'next', 'a control inside a hidden bar is skipped too');
}

/* ---- 5. focus that is somewhere real stays there ------------------------- */
{
  const t = el('tbody', {});
  const search = el('input', { type: 'search' });
  build(t, 2);
  focus.on(search);
  build(t, 2);
  eq(refocus(t, 'pill:0'), null, 'refocus declines when focus is on a live control');
  eq(focus.at(), search, 'and the search box keeps it');

  // The control survived (only its siblings were rebuilt): nothing to restore.
  const keep = find(t, 'pill:0');
  focus.on(keep);
  refocus(t, 'del:0');
  eq(focus.at(), keep, 'a control that survived the rebuild is not robbed either');
}

/* ---- 5b. ...but a focused control that was HIDDEN is not "somewhere real" --
   The card it sits in gained `hidden`; the browser still reports it as the
   active element until the next frame, and then drops focus to <body>. */
{
  const card = el('div', {}, el('button', { 'data-focus-key': 'start' }, 'Start'));
  const page = el('div', {}, card, el('select', { 'data-focus-key': 'year' }));
  const start = focus.on(find(page, 'start'));
  card.classList.add('hidden');
  eq(focus.at(), start, 'precondition: the hidden button is still the active element');
  refocus(page, 'year');
  eq(focus.key(), 'year', 'focus on a control that is no longer displayed counts as lost, and is restored');
}

/* ---- 6. quiet no-ops ------------------------------------------------------ */
{
  focus.reset();
  const t = el('tbody', {});
  build(t, 1);
  eq(refocus(t, 'nothing:9'), null, 'a key nobody carries is a no-op');
  eq(refocus(t, [null, undefined, '']), null, 'so is a list of nothing');
  eq(refocus(null, 'pill:0'), null, 'and a missing root');
  ok(focus.lost(), 'none of which moved focus');
}

console.log(`PASS dom-refocus — refocus() lands on the keyed control after a rebuild, and leaves live focus alone (${checks} checks)`);
