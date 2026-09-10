'use strict';
/* ISSUE 91 (2). The manual column mapper's "Use these columns" fails OUT LOUD.

   `$('#impMapApply').onclick = async () => {…}` is the same shape
   tests/dropzone-failure.test.cjs pins for the two drop zones, reached through
   a BUTTON instead of a drop — and so it never went through
   src/controller.js's wireDropZone, the seam that awaits and catches. `onclick`
   is a DOM property: it awaits nothing and returns nowhere, so a throw inside
   runImport became a rejected promise with no owner. The audit-criticals branch
   gave this entry the `finally` that takes the progress bar down but
   deliberately left the catch for its own decision, so the observed state was a
   bar that came down over a screen that then said nothing at all.

   The decision, matching wireDropZone's: REPORT, DO NOT REPAIR. runImport
   hides #importMap before it renders, so a mid-render failure leaves the screen
   half-changed and nothing here can know how far it got; S.pendingImport is
   left exactly as the failure left it — the same rule save-failure.test.cjs
   holds for the nine Save paths, where a failure the reader can see is a
   failure the reader can retry. The one thing the guard must NOT do is fall
   through to the "That mapping produced no transactions — check the Date
   column especially" sentence: a confident wrong diagnosis of a render throw.

   Four cases:

     1  the real mapper over 1600 rows with the review render throwing after
        the bar reached 95% — nothing escapes, one error toast naming the file
        and the reason, a console line, the bar down, and NOT the
        wrong-columns sentence.
     2  RETRY — pressing it again with a healthy render still imports, which is
        what "reports without repairing" is for.
     3  NEGATIVE CONTROL — a healthy press reports nothing, so the guard cannot
        pass by toasting unconditionally.
     4  the two in-band refusals (same column twice, no amount column) still
        answer in #impMapWarn and still say nothing to the toast or the
        console — the guard must not have swallowed them into the error path.

     node tests/import-mapper-apply-failure.test.cjs */

const assert = require('assert');
require('./helpers/harness.cjs').stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const registerImport = require('../src/views/import');
const { PROFILES } = require('../src/locale');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* Anything that escapes the handler lands here. Asserted empty in every case:
   the unhandled rejection IS the defect, not a side effect of it. */
const escaped = [];
process.on('unhandledRejection', e => escaped.push((e && e.message) || String(e)));

/* Captured rather than printed — a stack trace per case would bury this file's
   own PASS line — and asserted, because a developer opening the console after a
   button that did nothing is the other half of what was missing. */
const logged = [];
const realError = console.error;
console.error = (...a) => logged.push(a.map(String).join(' '));

/* runImport yields to a timer once per 250-row chunk and once more at the 95%
   mark. A fired-and-forgotten `onclick` hands its promise to nobody, so ticks
   are the only way to wait for one — the same reason dropzone-failure.test.cjs
   settles this way. */
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(r => setTimeout(r, 0)); };
const fakeFile = (name, bytes) => ({ name, async arrayBuffer() { return bytes; } });

// Comfortably over runImport's own 1500-row threshold for showing the bar.
function bigCsvBytes(rows = 1600) {
  let csv = 'Date,Description,Amount\n';
  for (let i = 0; i < rows; i++) {
    csv += `2026-01-${String((i % 28) + 1).padStart(2, '0')},Shop ${i},-${(i % 90) + 10}.00\n`;
  }
  return new TextEncoder().encode(csv).buffer;
}

function importCtx($, toast, deferredCatSelect) {
  const ctx = {
    S: { accounts: [], txFiles: {}, rules: [], pendingImport: null, settings: {} },
    $, app: {}, money: v => String(v), toast,
    writeFile: async () => {},
    currentPeriod: () => '2026-01',
    periodRange: () => ({ start: '2026-01-01', end: '2026-01-31' }),
    periodTitle: () => 'January 2026',
    serializeTxFile: () => '',
    learnRules: () => {},
    locale: () => PROFILES.za,
    txSegment: s => s,
    accountForLabel: () => null,
    deferredCatSelect,
    provide(o) { Object.assign(ctx, o); },
  };
  registerImport(ctx);
  return ctx;
}

/* The mapper is a closure inside registerImport; "Columns wrong?" (remapImport)
   is its published door, and the one a reader who mistrusts the auto-detection
   actually takes. `boom` lets the FIRST read succeed so there is a pending
   import to reopen, then makes the re-read fail the way a view helper reaching
   for the wrong binding does — the bug shape dom-stub.cjs's header describes,
   and the one that fires after the progress bar is already up. */
async function openMapper($, toast, boom) {
  const ctx = importCtx($, toast, () => {
    if (boom.on) throw new Error('simulated render failure');
    return $('#x');
  });
  await ctx.handleStatementFile(fakeFile('statement.csv', bigCsvBytes()));
  await settle();
  ok(ctx.S.pendingImport && ctx.S.pendingImport.items.length > 1000,
    'precondition: the file imports cleanly first, so there is something to remap');
  ctx.remapImport();
  ok(!$('#importMap').classList.contains('hidden'), 'precondition: the mapper is on screen');
  return ctx;
}

(async () => {
  /* ---- 1 + 2: the failure, then the retry ---- */
  {
    const { $ } = makeDom();
    const toasts = [];
    const boom = { on: false };
    const ctx = await openMapper($, (msg, bad) => toasts.push({ msg, bad }), boom);

    boom.on = true;
    escaped.length = 0; logged.length = 0; toasts.length = 0;
    // Exactly how a browser calls it: the returned promise handed to nobody.
    $('#impMapApply').onclick();
    await settle();

    eq(escaped.length, 0, 'apply: a throw inside runImport must not escape as an unhandled rejection');
    eq(toasts.filter(t => t.bad).length, 1, `apply: exactly one error toast — the failure, reported once, got ${JSON.stringify(toasts)}`);
    ok(/statement\.csv/.test(toasts.find(t => t.bad).msg), 'apply: the toast names the file the reader was mapping');
    ok(/simulated render failure/.test(toasts.find(t => t.bad).msg),
      'apply: and carries the underlying reason, not just "something failed"');
    ok(logged.some(l => /Apply handler failed/.test(l)),
      'apply: the failure is on the console too, for a developer reading it after the fact');
    ok($('#importProgress').classList.contains('hidden'),
      'apply: the progress bar still comes down — the `finally` this entry already had');
    eq($('#ipBar').style.width, '95%',
      'apply: the bar really had reached 95% before the failure — otherwise this case proves nothing');
    eq($('#impMapWarn').textContent, '',
      'apply: NOT "check the Date column" — the columns were fine, the render threw, and a wrong diagnosis is worse than none');
    ok(ctx.S.pendingImport,
      'apply: reports without repairing — nothing is rolled back or cleared behind the reader');

    /* ---- 2: the retry the report exists to make possible ---- */
    boom.on = false;
    escaped.length = 0; toasts.length = 0;
    $('#impMapApply').onclick();
    await settle();

    eq(escaped.length, 0, 'retry: nothing escapes');
    eq(toasts.filter(t => t.bad).length, 0, `retry: no error toast the second time, got ${JSON.stringify(toasts)}`);
    ok(ctx.S.pendingImport && ctx.S.pendingImport.items.length > 1000,
      'retry: pressing the same button again imports the file — a failure the reader can see is one they can retry');
  }

  /* ---- 3: NEGATIVE CONTROL — a healthy press says nothing ---- */
  {
    const { $ } = makeDom();
    const toasts = [];
    const boom = { on: false };
    const ctx = await openMapper($, (msg, bad) => toasts.push({ msg, bad }), boom);

    escaped.length = 0; logged.length = 0; toasts.length = 0;
    $('#impMapApply').onclick();
    await settle();

    eq(escaped.length, 0, 'healthy apply: nothing escapes');
    eq(toasts.filter(t => t.bad).length, 0, `healthy apply: a successful mapping reports nothing, got ${JSON.stringify(toasts)}`);
    eq(logged.length, 0, 'healthy apply: and nothing reaches the console');
    ok(ctx.S.pendingImport && ctx.S.pendingImport.items.length > 1000, 'healthy apply: the rows reach the review screen');
    ok($('#importProgress').classList.contains('hidden'), 'healthy apply: the bar comes down on the success path exactly as before');
  }

  /* ---- 4: the in-band refusals are not error-path material ---- */
  {
    const { $ } = makeDom();
    const toasts = [];
    const boom = { on: false };
    await openMapper($, (msg, bad) => toasts.push({ msg, bad }), boom);

    /* The selects live IN the mapper's field list, not in the `$` registry —
       dom-stub's `$` is a flat id map that auto-creates, so asking it for
       #impMap_iDate would hand back a detached element the handler never
       reads. Reached the way the reader reaches them: through the container. */
    const sel = id => $('#impMapFields').querySelector(`#impMap_${id}`);

    escaped.length = 0; logged.length = 0; toasts.length = 0;
    sel('iDesc').value = sel('iDate').value;
    $('#impMapApply').onclick();
    await settle();
    ok(/same column/.test($('#impMapWarn').textContent),
      'same column twice: still answered on the mapper itself, in the sentence that names the fix');
    eq(toasts.length, 0, 'same column twice: a refusal is not a failure — no toast');
    eq(logged.length, 0, 'same column twice: and nothing on the console');

    sel('iDesc').value = String(Number(sel('iDate').value) + 1);
    sel('iAmount').value = '-1';
    sel('iDebit').value = '-1';
    sel('iCredit').value = '-1';
    $('#impMapApply').onclick();
    await settle();
    ok(/Amount column/.test($('#impMapWarn').textContent), 'no amount column: same, its own sentence');
    eq(toasts.length, 0, 'no amount column: still not an error toast');
    eq(escaped.length, 0, 'neither refusal escapes as a rejection');
  }

  console.error = realError;
  console.log(`PASS — the column mapper's Apply button fails out loud (${checks} assertions).`);
})().catch(e => { console.error = realError; console.error(e); process.exit(1); });
