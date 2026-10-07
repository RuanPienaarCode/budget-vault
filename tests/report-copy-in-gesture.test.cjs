'use strict';
/* Copying a report found on disk starts the clipboard write inside the tap.

   WebKit — every iPhone and iPad, whatever the Obsidian version — refuses a
   clipboard write made outside the user gesture that caused it: "A call to
   clipboard.write or clipboard.writeText outside the scope of a user gesture
   … will result in the immediate rejection of the promise" (webkit.org,
   blog post 10855). The Report page's Copy buttons read a report that was
   generated in an EARLIER session back from the vault first — `await
   readVaultFile(...)`, a round trip over the native bridge — and only then
   called navigator.clipboard.writeText. Desktop Chromium copies anyway; an
   iPhone gets "Could not copy the report".

   The fix is the shape WebKit documents for exactly this: start
   navigator.clipboard.write() synchronously, inside the tap, with a
   ClipboardItem whose text is a PROMISE that resolves once the read lands.
   Where ClipboardItem is missing, or the engine refuses a promised item, the
   old read-then-writeText path still runs (desktop Chromium accepts it).

   Bare node has no WebKit, so the gesture is modelled: `inTap` is true for
   exactly the synchronous part of the click handler and false from its first
   await on. A clipboard call made while it is false is one WebKit rejects.

     1. a report found on disk: clipboard.write is called inside the tap, and
        the item's text is the file's copy-ready body (frontmatter stripped);
     2. the JSON copy the same way, verbatim;
     3. a report created this session (text in memory): writeText inside the
        tap, as before;
     4. no ClipboardItem: falls back to read-then-writeText, text correct;
     5. a refused promised item: falls back the same way;
     6. a file that vanished before the tap: "could not copy", never
        "copied".

     node tests/report-copy-in-gesture.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor, createReport } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* The paths the 'current' selection names on TODAY (see filenameLabel in
   views/report.js): the period's month name, under the default Reports/. */
const MD = 'Reports/September 2026 Financial Report.md';
const JSON_PATH = 'Reports/September 2026 Financial Report.json';
const ON_DISK = '---\ngenerated: 2026-09-01 08:00\nperiod: "September 2026"\ndetail: summary\n---\n\n# Earlier report\n\nBody text.\n';
const ON_DISK_JSON = '{\n  "period": "September 2026"\n}\n';

/* ---- the modelled browser ------------------------------------------------ */
const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const realItem = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
let inTap = false;
let calls = [];
let refuseWrite = false;
function install({ withItem = true } = {}) {
  calls = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, writable: true,
    value: {
      language: 'en-US',
      clipboard: {
        writeText(t) { calls.push({ kind: 'writeText', inTap, text: t }); return Promise.resolve(); },
        /* As the spec has it: write() settles once every promised item has
           resolved, and rejects if one of them rejects. */
        write(items) {
          calls.push({ kind: 'write', inTap, items });
          if (refuseWrite) return Promise.reject(new Error('NotAllowedError'));
          return Promise.all(items.flatMap(i => Object.values(i.data))).then(() => undefined);
        },
      },
    },
  });
  if (withItem) {
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true, writable: true,
      value: class ClipboardItem { constructor(data) { this.data = data; this.types = Object.keys(data); } },
    });
  } else {
    delete globalThis.ClipboardItem;
  }
}
function restore() {
  if (realNav) Object.defineProperty(globalThis, 'navigator', realNav); else delete globalThis.navigator;
  if (realItem) Object.defineProperty(globalThis, 'ClipboardItem', realItem); else delete globalThis.ClipboardItem;
}
/* One tap: the handler's synchronous part runs with inTap true. */
async function tap(fn) {
  inTap = true;
  const p = fn();
  inTap = false;
  await p;
}
const blobText = async v => { const b = await v; return b && typeof b.text === 'function' ? b.text() : b; };

async function mount(extra = {}) {
  const M = await mountFor({ ...SEED, ...extra }, { period: PERIOD, budgetFolder: B });
  M.ctx.renderReport();
  return M;
}

(async () => {
  const unpin = pinClock(TODAY);
  try {
    const { copyBody } = require('../src/report');

    /* ---- 1. found on disk: write() inside the tap ----------------------- */
    {
      install();
      const M = await mount({ [MD]: ON_DISK, [JSON_PATH]: ON_DISK_JSON });
      ok(!M.nodes.get('#reportResultCard').classList.contains('hidden'), 'fixture: the earlier report is found on disk and offered');
      await tap(() => M.ctx.copyReport());
      ok(calls.length >= 1, 'the Copy tap reached the clipboard');
      eq(calls[0].inTap, true, 'the FIRST clipboard call happens inside the tap — not after the vault read');
      eq(calls[0].kind, 'write', 'and it is clipboard.write with a promised item, the shape WebKit accepts');
      const item = calls[0].items[0];
      ok(item && item.types.includes('text/plain'), 'one text/plain item');
      eq(await blobText(item.data['text/plain']), copyBody(ON_DISK), 'whose text is the file\'s copy-ready body');
      eq(calls.length, 1, 'one clipboard call, no second attempt');
      ok(M.ctx._toasts.some(t => /Copied/.test(t.msg) && !t.bad), 'and the reader is told it was copied');

      /* ---- 2. the JSON, verbatim ---------------------------------------- */
      install();
      await tap(() => M.ctx.copyReportJson());
      eq([calls[0].inTap, calls[0].kind], [true, 'write'], 'Copy JSON also starts inside the tap');
      eq(await blobText(calls[0].items[0].data['text/plain']), ON_DISK_JSON, 'with the file unchanged');
    }

    /* ---- 3. created this session: writeText inside the tap -------------- */
    {
      install();
      const M = await mountFor({ ...SEED }, { period: PERIOD, budgetFolder: B });
      const made = await createReport(M, { json: false });
      ok(made.md, 'fixture: a report was created this session');
      calls = [];
      await tap(() => M.ctx.copyReport());
      eq([calls[0].inTap, calls[0].kind], [true, 'writeText'], 'text already in memory is written inside the tap, as before');
      eq(calls[0].text, copyBody(made.md), 'and it is the report just made, frontmatter stripped');
    }

    /* ---- 4. no ClipboardItem: the old path ------------------------------ */
    {
      install({ withItem: false });
      const M = await mount({ [MD]: ON_DISK });
      await tap(() => M.ctx.copyReport());
      const w = calls.find(c => c.kind === 'writeText');
      ok(w, 'without ClipboardItem it falls back to writeText');
      eq(w.text, copyBody(ON_DISK), 'with the right text');
      ok(M.ctx._toasts.some(t => /Copied/.test(t.msg)), 'and says copied');
    }

    /* ---- 5. a refused promised item: the old path ----------------------- */
    {
      install();
      refuseWrite = true;
      try {
        const M = await mount({ [MD]: ON_DISK });
        await tap(() => M.ctx.copyReport());
        eq(calls[0].kind, 'write', 'the promised item is tried first');
        const w = calls.find(c => c.kind === 'writeText');
        ok(w && w.text === copyBody(ON_DISK), 'and when the engine refuses it, read-then-writeText runs with the right text');
        ok(M.ctx._toasts.some(t => /Copied/.test(t.msg) && !t.bad), 'and the copy is reported as done');
      } finally { refuseWrite = false; }
    }

    /* ---- 6. the file vanished before the tap ---------------------------- */
    {
      install();
      const M = await mount({ [MD]: ON_DISK });
      M.ctx.vault._store.delete(MD);
      await tap(() => M.ctx.copyReport());
      ok(M.ctx._toasts.some(t => t.bad && /Could not copy/.test(t.msg)), 'a report that is gone is "could not copy"');
      ok(!M.ctx._toasts.some(t => /Copied/.test(t.msg)), 'never "copied"');
    }
  } finally {
    unpin();
    restore();
  }
  console.log(`PASS report-copy-in-gesture (${checks} checks)`);
})().catch(e => { restore(); console.error(e); process.exit(1); });
