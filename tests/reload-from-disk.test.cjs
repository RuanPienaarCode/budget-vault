'use strict';
/* reloadFromDisk — a rejection mid-load must never leave a lit Save button
   over an emptied array.

   Reported: load.js's per-section reads reset an array and its dirty flag
   TOGETHER before their own read resolves (S.owed = []; S.owedDirty = false;
   then `await readFile(...)`). Before this fix, reloadFromDisk called
   disableSaveButtons() as a plain statement AFTER `await ctx.loadVault()` —
   so a rejection anywhere in loadVault skipped it entirely. A Save button
   already enabled from edits made before the reload stayed enabled, sitting
   over a section that load.js may have already reset to []. One click on
   that button writes the emptied array over the user's real file, no
   vault-trash copy.

   Pinned here against the REAL reloadFromDisk (extracted from controller.js
   specifically so this seam is reachable without a full DOMParser mount —
   mountApp() itself is not exercised by any bare-node test), not a
   hand-written mirror of its control flow.

   FakeButton mimics the one piece of real DOM semantics this guard depends
   on: a disabled button's click listener does not fire. That is what makes
   "Save buttons disabled" actually mean "a subsequent save click cannot
   fire", not just "some boolean flipped".

     node tests/reload-from-disk.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { reloadFromDisk } = require('../src/controller');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ------------------------------- fixtures -------------------------------- */
class FakeButton {
  constructor() {
    this.disabled = false;
    this._listeners = [];
    this.fired = 0;
  }
  addEventListener(_ev, fn) { this._listeners.push(fn); }
  // Mirrors the real DOM: a disabled button's listeners do not run.
  click() {
    if (this.disabled) return;
    this.fired++;
    for (const fn of this._listeners) fn();
  }
}
class FakeEl {
  constructor() { this.classList = { add() {}, remove() {} }; }
}

function makeHarness({ loadVault }) {
  const owedSave = new FakeButton();
  owedSave.addEventListener('click', () => { /* would call writeFile(...) */ });
  // Pre-reload: the user has unsaved owed-money edits, so the button is lit —
  // exactly the state the reload starts from in the reported bug.
  owedSave.disabled = false;

  const importReview = new FakeEl();
  const S = { pendingImport: { some: 'snapshot' } };
  let invalidated = 0;
  const ctx = {
    invalidateBudgetDraft: () => { invalidated++; },
    loadVault,
  };
  const $ = sel => (sel === '#importReview' ? importReview : null);
  const saveButtons = [owedSave];
  const disableSaveButtons = () => { for (const b of saveButtons) b.disabled = true; };

  return { S, ctx, $, disableSaveButtons, owedSave, invalidated: () => invalidated };
}

async function main() {
  /* -------------------------------------------- happy path, unchanged */
  {
    const h = makeHarness({ loadVault: async () => {} });
    await reloadFromDisk(h.ctx, h.S, h.$, h.disableSaveButtons);
    eq(h.invalidated(), 1, 'invalidateBudgetDraft runs on a successful reload');
    eq(h.S.pendingImport, null, 'the pending-import snapshot is dropped');
    eq(h.owedSave.disabled, true, 'a successful reload still disables Save buttons');
  }

  /* ----------------------------------- the guard: mid-load rejection */
  {
    const h = makeHarness({ loadVault: async () => { throw new Error('iCloud file not materialised'); } });

    let threw = null;
    try {
      await reloadFromDisk(h.ctx, h.S, h.$, h.disableSaveButtons);
    } catch (e) {
      threw = e;
    }
    ok(threw, 'the rejection still propagates — callers (connectVault, the reload link) still see it and toast it');

    ok(h.owedSave.disabled, 'the Save button lit from before the reload is disabled after a mid-load rejection');
    h.owedSave.click();
    eq(h.owedSave.fired, 0, 'a click on the now-disabled button cannot fire — the write that would overwrite the real file never runs');
  }

  console.log(`reload-from-disk.test.cjs — ${checks} checks OK`);
}

main().catch(e => { console.error(e); process.exit(1); });
