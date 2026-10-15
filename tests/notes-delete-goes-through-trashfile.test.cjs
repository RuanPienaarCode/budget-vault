'use strict';
/* Deleting a note goes through io.trashFile, not a bare vault.trash.

   views/notes.js resolved the TFile before the confirm dialog (rightly — a
   TFile survives a rename and a path does not) and then called
   `vault.trash(f, false)` directly. io.trashFile now re-checks that file AFTER
   the dialog (2026-10-14 audit, L3-13): a file that is gone returns false, one
   that was deleted and replaced by a different file at the same path throws
   code STALE, and a change another device made since the last read is refused.
   Notes was the one remaining caller that bypassed it, so a sync landing a
   different note under the same name while the confirm was open trashed the
   NEW note, and a note already gone was announced as "Note deleted".

   Pinned over the real loader, the real io and the real Notes page, with the
   confirm dialog answered from a hook that can change the vault while it is
   "open" — which is the whole bug.

     node tests/notes-delete-goes-through-trashfile.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
let whileOpen = async () => {};
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null,
      confirmModal: async () => { await whileOpen(); return true; },
      askSplit: async () => null, askRulesCleanup: async () => false, askBudgetReslice: async () => false,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { NOTES_DIR } = require('../src/note-file');

const B = 'Budget';
const REL = `${NOTES_DIR}/2026-10-01 Fees query.md`;
const ABS = `${B}/${REL}`;
const NOTE = body => '---\nnote_kind: general\nnote_subject: ""\ncreated: 2026-10-01\n---\n\n# Fees query\n\n' + body + '\n';
const FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [ABS]: NOTE('Asked about the termly levy.'),
});

const all = (n, pred, out = []) => {
  for (const c of (n && n.children) || []) { if (c.nodeType === 1) { if (pred(c)) out.push(c); all(c, pred, out); } }
  return out;
};
const deleteButton = M => all(M.nodes.get('#notesList'), n => n.attrs && n.attrs['aria-label'] === 'Delete Fees query')[0];
const last = M => M.ctx._toasts[M.ctx._toasts.length - 1] || {};

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. the ordinary delete still works ---- */
    {
      whileOpen = async () => {};
      const M = await mountFor(FILES(), { period: '2026-10', budgetFolder: B });
      M.ctx.renderNotes();
      ok(deleteButton(M), 'the note card has its Delete button');
      await deleteButton(M)._fire('click');
      await new Promise(r => setTimeout(r, 20));
      eq(M.ctx.vault.getFileByPath(ABS), null, 'the note file is moved to the trash');
      eq(last(M), { msg: 'Note deleted', bad: undefined }, 'and the reader is told');
    }

    /* ---- 2. a DIFFERENT file at the same path after the confirm ---- */
    {
      const M = await mountFor(FILES(), { period: '2026-10', budgetFolder: B });
      const { vault } = M.ctx;
      /* The harness vault has no stat; a real one does, and io.trashFile tells
         "the same file" from "another file at the same path" by ctime. */
      vault.getFileByPath(ABS).stat = { ctime: 1 };
      whileOpen = async () => {
        await vault.trash(vault.getFileByPath(ABS));
        await vault.create(ABS, NOTE('A different note, synced in while the dialog was open.'));
        vault.getFileByPath(ABS).stat = { ctime: 2 };
      };
      M.ctx.renderNotes();
      await deleteButton(M)._fire('click');
      await new Promise(r => setTimeout(r, 20));
      ok(vault.getFileByPath(ABS), 'the replacement file is NOT trashed');
      ok(/different note/.test(await vault.cachedRead(vault.getFileByPath(ABS))), 'and its text is untouched');
      ok(last(M).bad === true && /Could not delete that note/.test(last(M).msg),
        `the reader is told it was refused — "${last(M).msg}"`);
    }

    /* ---- 3. the note is gone by the time the dialog closes ---- */
    {
      const M = await mountFor(FILES(), { period: '2026-10', budgetFolder: B });
      const { vault } = M.ctx;
      whileOpen = async () => { await vault.trash(vault.getFileByPath(ABS)); };
      M.ctx.renderNotes();
      await deleteButton(M)._fire('click');
      await new Promise(r => setTimeout(r, 20));
      ok(last(M).bad === true && /no longer in the vault/.test(last(M).msg),
        `a note that is already gone is not announced as deleted — "${last(M).msg}"`);
      ok(!M.ctx._toasts.some(t => t.msg === 'Note deleted'), 'no "Note deleted" was shown at any point');
    }

    console.log(`PASS notes-delete-goes-through-trashfile (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
