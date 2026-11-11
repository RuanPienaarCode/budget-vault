'use strict';
/* Arrowing through the book switcher does not open every book on the way.

   The switcher is a native <select>, and a pick opened the picked book at
   once, on `change`. That is right for a mouse and for a phone's picker, where
   `change` means "I chose this". It is wrong for a keyboard on Windows and
   Linux, where the arrow keys step a CLOSED select and fire `change` on every
   step: a reader with five books who wanted the fourth reloaded the whole
   plugin three times on the way to it — each one a full vault read, and each
   one a chance to be stopped by the "unsaved changes" refusal at a book they
   were only passing (audit of 11 Nov 2026, task 18).

   src/book-switcher.js settleBookSelect() now sits between the select and the
   switch. A change that comes from stepping by key is held until the reader
   settles — Enter, or leaving the control — and everything else commits at
   once, exactly as before:

     1. a mouse pick or a phone's picker: one change, one switch, no key.
     2. arrow, arrow, arrow: no switch; leaving the select makes exactly one,
        for the book it ended on.
     3. Enter makes it too — and leaving afterwards does not make a second.
     4. stepping away and back to the open book switches nothing at all.
     5. type-ahead (a letter jumps to a book) is stepping, and is held.
     6. choosing from the OPEN list with Enter commits at once: Enter is the
        reader saying which one.
     7. a list opened by key and picked from later (macOS, where the list is a
        native menu and its keys never reach the page) commits at once. Only a
        change that follows its key within a keystroke's time is a step.
     8. Escape with a step pending drops it and asks for the select to be put
        back; leaving afterwards switches nothing.
     9. the controller routes BOTH copies through it, and no longer switches on
        a bare `change`.

     node tests/book-switcher-commit.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { installDom, FakeEl } = require('./helpers/dom-stub.cjs');
installDom();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { settleBookSelect } = require('../src/book-switcher');
eq(typeof settleBookSelect, 'function', 'src/book-switcher.js exports settleBookSelect');

/* A select, a clock, and a record of what it asked for. */
function rig(open = 'Home') {
  const select = new FakeEl('select');
  select.value = open;
  let t = 1000;
  const commits = [], cancels = [];
  settleBookSelect(select, v => commits.push(v), () => cancels.push(select.value), { now: () => t });
  return {
    select, commits, cancels,
    wait: ms => { t += ms; },
    key: k => select._fire('keydown', { key: k }),
    // What the browser does on a closed select: the key, then the change it caused.
    step: (k, value) => { select._fire('keydown', { key: k }); select.value = value; select._fire('change'); },
    pick: value => { select.value = value; select._fire('change'); },
    blur: () => select._fire('blur'),
  };
}

/* ---- 1. mouse and touch: one step, as before ------------------------------- */
{
  const r = rig();
  r.pick('Client A');
  eq(r.commits, ['Client A'], 'a pick with no key behind it switches at once');
  r.blur();
  eq(r.commits, ['Client A'], 'and leaving the select afterwards does not switch again');
}

/* ---- 2. stepping by key is held until the reader leaves -------------------- */
{
  const r = rig();
  r.step('ArrowDown', 'Client A'); r.wait(180);
  r.step('ArrowDown', 'Client B'); r.wait(180);
  r.step('ArrowDown', 'Client C');
  eq(r.commits, [], 'three arrows past three books open none of them');
  r.wait(900);
  r.blur();
  eq(r.commits, ['Client C'], 'leaving the select opens the one it ended on, once');
  r.blur();
  eq(r.commits, ['Client C'], 'and only once');
}

/* ---- 3. Enter settles it ----------------------------------------------------- */
{
  const r = rig();
  r.step('ArrowDown', 'Client A'); r.wait(200);
  r.step('ArrowDown', 'Client B'); r.wait(400);
  r.key('Enter');
  eq(r.commits, ['Client B'], 'Enter opens the book the select is on');
  r.blur();
  eq(r.commits, ['Client B'], 'and leaving afterwards does not open it a second time');
}

/* ---- 4. there and back again -------------------------------------------------- */
{
  const r = rig('Home');
  r.step('ArrowDown', 'Client A'); r.wait(200);
  r.step('ArrowUp', 'Home'); r.wait(300);
  r.blur();
  eq(r.commits, [], 'stepping away and back to the open book switches nothing');
  r.step('End', 'Client C'); r.wait(200);
  r.step('Home', 'Home'); r.wait(200);
  r.key('Enter');
  eq(r.commits, [], 'by Enter either');
}

/* ---- 5. type-ahead is stepping too -------------------------------------------- */
{
  const r = rig();
  r.step('c', 'Client A');
  eq(r.commits, [], 'a letter that jumps to a book is held like an arrow');
  r.wait(500); r.blur();
  eq(r.commits, ['Client A'], 'and settles on leaving');
}

/* ---- 6. Enter on the open list ----------------------------------------------- */
{
  const r = rig();
  r.key('ArrowDown'); r.wait(600);         // moving through the open list changes nothing yet
  r.key('ArrowDown'); r.wait(600);
  r.key('Enter');                          // …Enter closes it, and THEN the change arrives
  eq(r.commits, [], 'Enter with nothing stepped yet switches nothing by itself');
  r.pick('Client B');
  eq(r.commits, ['Client B'], 'the change that Enter produced switches at once');
}

/* ---- 7. a list opened by key, picked from later ------------------------------ */
{
  const r = rig();
  r.key('ArrowDown');                      // opens the native menu; its own keys never reach the page
  r.wait(1400);
  r.pick('Client C');
  eq(r.commits, ['Client C'], 'a change long after the key that opened the list is a pick, and switches at once');
}

/* ---- 8. Escape drops a pending step ------------------------------------------- */
{
  const r = rig();
  r.step('ArrowDown', 'Client A'); r.wait(200);
  r.key('Escape');
  eq([r.commits, r.cancels.length], [[], 1], 'Escape switches nothing and asks for the select to be put back');
  r.blur();
  eq(r.commits, [], 'and leaving afterwards switches nothing');
  r.key('Escape');
  eq(r.cancels.length, 1, 'Escape with nothing pending is left alone (it still closes the drawer)');
}

/* ---- 9. the wiring -------------------------------------------------------------- */
{
  const ctl = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
  ok(/for \(const select of \[\$\('#bookSelect'\), \$\('#drawerBookSelect'\)\]\) \{\s*settleBookSelect\(select, \(\) => onBookPicked\(select\)/.test(ctl),
    'controller.js routes both copies of the switcher through settleBookSelect');
  ok(!/addEventListener\('change', onBookPicked\)/.test(ctl), 'and neither copy switches on a bare change any more');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'book-switcher.js'), 'utf8');
  ok(/900px and under/.test(src) && !/at 600px and under/.test(src),
    'the module header gives the breakpoint the stylesheet uses (900px), not the 600px it used to say');
}

console.log(`PASS book-switcher-commit — a keyboard steps through the books without opening them; a mouse and a phone still switch in one (${checks} checks)`);
