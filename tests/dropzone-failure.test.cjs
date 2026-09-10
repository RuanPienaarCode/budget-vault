'use strict';
/* A file dropped on a drop zone fails OUT LOUD — the guard for the seam
   src/controller.js's wireDropZone puts between the two drop targets (the
   statement importer's #drop and the tax uploader's #taxDrop) and the async
   handlers behind them.

   Before this suite, wireDropZone fired `handle(file)` bare from a `change`
   listener and a `drop` listener. Both are DOM listeners: they await nothing
   and return nowhere, so a throw ANYWHERE inside ctx.handleStatementFile or
   ctx.handleTaxFile became a rejected promise with no owner — an unhandled
   rejection, invisible on iOS, invisible on desktop unless the console happens
   to be open, and indistinguishable from a drop zone that simply does nothing.
   This is the same shape views/report.js's createReport documents at length and
   tests/save-failure.test.cjs pins for the nine Save paths, arriving through a
   different door.

   The importer made it worse than a Save button does. runImport puts a progress
   bar up past 1500 rows and takes it down on its LAST line, so a throw after
   that point froze the bar on screen: the reproduction for this fix printed
   "Preparing review… 95%" over an import that had already given up, with no
   toast and no console line. A hung screen, not a failed one.

   Six cases, in two halves:

     1-4  the seam itself, driven through the REAL wireDropZone with a handler
          made to fail — both entry points (drop and picker), a rejected
          promise and a synchronous throw, plus a healthy handler as the
          negative control so the guard cannot pass by toasting everything.
     5-6  the real statement importer over 1600 rows, where the review render
          throws after the bar reached 95% — and the same file with a healthy
          render, so case 5's "the bar came down" cannot pass merely because
          nothing ever put it up.

   wireDropZone is exported from controller.js rather than living as a closure
   inside mountApp for the same reason applyInputMode is: as a closure the only
   way to reach it would be a full DOMParser shell mount, which no bare-node
   suite performs.

     node tests/dropzone-failure.test.cjs */

const assert = require('assert');
require('./helpers/harness.cjs').stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { wireDropZone } = require('../src/controller');
const registerImport = require('../src/views/import');
const { PROFILES } = require('../src/locale');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* Anything that escapes the seam lands here. Asserted empty in every case:
   an unhandled rejection IS the defect, not a side effect of it. */
const escaped = [];
process.on('unhandledRejection', e => escaped.push((e && e.message) || String(e)));

/* The guard logs as well as toasts (`console.error('Budget: …', e)`, the shape
   report.js and transactions.js already use). Captured rather than printed —
   a stack trace per case would bury this file's own PASS line — and asserted,
   because a developer opening the console after a silent drop zone is the
   other half of what was missing. */
const logged = [];
const realError = console.error;
console.error = (...a) => logged.push(a.map(String).join(' '));

/* runImport yields to a timer once per 250-row chunk and once more at the 95%
   mark, so a 1600-row file needs several macrotask ticks before it reaches the
   review render. Fired-and-forgotten listeners hand their promise back to
   nobody (see save-failure.test.cjs's own flush()), so ticks are the only way
   to wait for one. */
const settle = async () => { for (let i = 0; i < 50; i++) await new Promise(r => setTimeout(r, 0)); };

const fakeFile = (name, bytes) => ({ name, async arrayBuffer() { return bytes || new ArrayBuffer(0); } });

/* A ctx just wide enough to run the REAL registerImport. `render` is the only
   knob: pass a throwing deferredCatSelect to make renderImportReview fail the
   way a view helper reaching for the wrong binding does — the bug shape
   helpers/dom-stub.cjs's own header describes, and the one that fires AFTER
   the progress bar is up. */
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

// Comfortably over runImport's own 1500-row threshold for showing the bar.
function bigCsvBytes(rows = 1600) {
  let csv = 'Date,Description,Amount\n';
  for (let i = 0; i < rows; i++) {
    csv += `2026-01-${String((i % 28) + 1).padStart(2, '0')},Shop ${i},-${(i % 90) + 10}.00\n`;
  }
  return new TextEncoder().encode(csv).buffer;
}

(async () => {
  /* ---- 1: the drop path — a handler whose promise rejects ---- */
  {
    const { $ } = makeDom();
    const toasts = [];
    escaped.length = 0; logged.length = 0;
    wireDropZone($, (msg, bad) => toasts.push({ msg, bad }), '#drop', '#fileInput',
      async () => { throw new Error('simulated handler failure'); });

    $('#drop')._fire('dragover');
    $('#drop')._fire('drop', { dataTransfer: { files: [fakeFile('statement.csv')] } });
    await settle();

    eq(escaped.length, 0, 'drop: a rejecting handler must not escape the seam as an unhandled rejection');
    eq(toasts.length, 1, 'drop: exactly one toast — the failure, reported once');
    ok(toasts[0].bad === true, 'drop: and it is flagged as an error');
    ok(/statement\.csv/.test(toasts[0].msg), 'drop: the toast names the file the reader actually dropped');
    ok(/simulated handler failure/.test(toasts[0].msg), 'drop: and carries the underlying reason, not just "something failed"');
    ok(logged.some(l => /drop-zone handler failed/.test(l)), 'drop: the failure is on the console too, for a developer reading it after the fact');
    ok(!$('#drop').classList.contains('dragover'), 'drop: the zone is not left highlighted mid-drag over a failed handler');
  }

  /* ---- 2: the file-picker path — the SAME guard, because the picker and the
     drop are two listeners that used to each carry their own copy of the
     hand-off (the input-value reset below is this file\'s own cautionary tale
     about exactly that). ---- */
  {
    const { $ } = makeDom();
    const toasts = [];
    escaped.length = 0; logged.length = 0;
    wireDropZone($, (msg, bad) => toasts.push({ msg, bad }), '#drop', '#fileInput',
      async () => { throw new Error('simulated handler failure'); });

    const input = $('#fileInput');
    input.value = 'C:\\fakepath\\statement.csv';
    input.files = [fakeFile('statement.csv')];
    input._fire('change', { target: input });
    await settle();

    eq(escaped.length, 0, 'picker: a rejecting handler must not escape the seam as an unhandled rejection');
    eq(toasts.length, 1, 'picker: the failure is reported here too, not only on the drop path');
    ok(toasts[0].bad === true, 'picker: and it is flagged as an error');
    eq(input.value, '', 'picker: the input is still reset, so re-picking the SAME file after a failure fires a fresh change event');
  }

  /* ---- 3: a SYNCHRONOUS throw — a handler that blows up before its first
     await returns nothing to reject, so a guard written as `.catch()` on the
     return value would sail straight past it. ---- */
  {
    const { $ } = makeDom();
    const toasts = [];
    escaped.length = 0;
    wireDropZone($, (msg, bad) => toasts.push({ msg, bad }), '#drop', '#fileInput',
      () => { throw new Error('thrown before the first await'); });

    $('#drop')._fire('drop', { dataTransfer: { files: [fakeFile('statement.csv')] } });
    await settle();

    eq(toasts.length, 1, 'sync throw: reported the same way a rejected promise is');
    ok(/thrown before the first await/.test(toasts[0].msg), 'sync throw: and carries its own reason');
    eq(escaped.length, 0, 'sync throw: nothing escapes the listener');
  }

  /* ---- 4: NEGATIVE CONTROL — a handler that succeeds says nothing. A guard
     that toasted unconditionally would pass every case above. ---- */
  {
    const { $ } = makeDom();
    const toasts = [];
    escaped.length = 0;
    let handled = null;
    wireDropZone($, (msg, bad) => toasts.push({ msg, bad }), '#drop', '#fileInput',
      async f => { handled = f.name; });

    $('#drop')._fire('drop', { dataTransfer: { files: [fakeFile('statement.csv')] } });
    await settle();

    eq(handled, 'statement.csv', 'healthy handler: the file still reaches it');
    eq(toasts.length, 0, 'healthy handler: a successful drop reports nothing');
    eq(escaped.length, 0, 'healthy handler: and nothing escapes');
  }

  /* ---- 5: the REAL importer — 1600 rows, review render throws after 95%.
     This is the reproduction the fix was written against: the toast is the
     seam's job, taking the progress bar down is views/import.js's. ---- */
  {
    const { $ } = makeDom();
    const toasts = [];
    escaped.length = 0; logged.length = 0;
    const ctx = importCtx($, (msg, bad) => toasts.push({ msg, bad }),
      () => { throw new Error('simulated render failure'); });
    wireDropZone($, (msg, bad) => toasts.push({ msg, bad }), '#drop', '#fileInput',
      f => ctx.handleStatementFile(f));

    $('#drop')._fire('drop', { dataTransfer: { files: [fakeFile('statement.csv', bigCsvBytes())] } });
    await settle();

    eq(escaped.length, 0, 'importer: a throw inside runImport must not escape as an unhandled rejection');
    ok(toasts.some(t => t.bad === true && /simulated render failure/.test(t.msg)),
      `importer: the failure is reported to the reader, got ${JSON.stringify(toasts)}`);
    ok($('#importProgress').classList.contains('hidden'),
      'importer: the progress bar comes DOWN — a failed import must not leave "Preparing review… 95%" frozen on screen');
    // The precondition, pinned: if the injected throw ever stops firing after
    // the bar goes up, the assertion above would pass over a bar that was
    // simply never shown. 95% is the mark runImport sets just before the
    // review render — proof the failure happened where this case says it does.
    eq($('#ipBar').style.width, '95%',
      'importer: the bar really had reached the 95% mark before the failure — otherwise this case proves nothing');
  }

  /* ---- 6: NEGATIVE CONTROL for case 5 — the same 1600 rows with a healthy
     render. Proves the teardown is not simply hiding a bar that never went
     up, and that the guard has not broken the ordinary import. ---- */
  {
    const { $ } = makeDom();
    const toasts = [];
    escaped.length = 0;
    const ctx = importCtx($, (msg, bad) => toasts.push({ msg, bad }), () => $('#x'));
    wireDropZone($, (msg, bad) => toasts.push({ msg, bad }), '#drop', '#fileInput',
      f => ctx.handleStatementFile(f));

    $('#drop')._fire('drop', { dataTransfer: { files: [fakeFile('statement.csv', bigCsvBytes())] } });
    await settle();

    eq(escaped.length, 0, 'healthy import: nothing escapes');
    eq(toasts.filter(t => t.bad).length, 0, `healthy import: no error toast, got ${JSON.stringify(toasts)}`);
    ok(ctx.S.pendingImport && ctx.S.pendingImport.items.length > 1000,
      'healthy import: 1600 rows still reach the review screen');
    ok($('#importProgress').classList.contains('hidden'),
      'healthy import: and the bar comes down on the success path exactly as before');
  }

  console.error = realError;
  console.log(`PASS — drop zones fail out loud (${checks} assertions).`);
})().catch(e => { console.error = realError; console.error(e); process.exit(1); });
