'use strict';
/* One snapshot per render pass. 2026-11-11 audit, task 9(b).

   WHAT WAS MEASURED. On a five-year household (60 months x 300 rows, three
   accounts) one Dashboard paint asked period.js for a stamped ledger 107
   times, over 10 distinct date windows, and built bookFigures() four times.
   Every one of those re-walked the transaction files. The answers within a
   paint are the same answers: nothing can change the vault state in the
   middle of one synchronous render.

   WHY THIS IS NOT A CACHE. The audit suggested computing bookFigures "once
   per load and day"; wave 1 measured that and refused it, rightly. A figure
   has to move on an edit that never reloads — an unsaved row edit on
   Transactions, accounts.js pushing into the SAME S.accounts array — and
   nothing can tell a memo that such an edit happened (period.js folderSets
   carries the same warning: "rebuilt per call and never kept"). Anything kept
   ACROSS two moments at which the reader could have edited is stale by
   construction.

   So nothing here is kept across such a moment. A snapshot exists only while
   a pass is open, and a pass is the synchronous extent of one function call:

     run(fn)   opens a pass, calls fn, and drops everything in `finally` —
               before run() returns, on a throw as much as on a return.
     memo(key, compute)
               INSIDE a pass: computes once per key and hands the same value
               back until the pass ends.
               OUTSIDE a pass: calls compute() and keeps nothing. This is the
               whole of the headless API's story (src/api.js has no render):
               it never opens a pass, so every figure it returns is computed
               at the moment it is asked for, exactly as before this existed.

   JavaScript runs one synchronous call to completion before any event, timer
   or promise continuation, so no click, keystroke, vault event or `await`
   can land between a pass opening and closing. An async renderer's pass ends
   when its synchronous prefix returns its promise; whatever runs after the
   first `await` is outside it and computes fresh.

   The one thing that CAN happen inside a pass is the render code itself
   changing state and drawing again — a renderer that dispatches an event
   whose handler edits a row and re-renders. That is why passes do not nest
   into one: opening a pass inside a pass starts from nothing, and when the
   inner one ends the outer continues from nothing too. A snapshot is never
   shared across a re-render, only within one.

   THE BOUNDARY THAT REMAINS, stated rather than hoped away. An event the
   DOM itself fires synchronously while a page is being redrawn runs its
   handler inside that page's pass — a focused field removed by the redraw
   can fire blur and change in Chromium. If that handler edits state and does
   NOT redraw, figures asked for later in the SAME paint still come from
   before its edit; the paint after it is right, and the row is marked dirty
   meanwhile. Before the pass existed such a paint was half one state and half
   the other. No handler today is in that position (the pages whose fields
   edit rows in place read no memoised figure after clearing them), and
   tests/render-pass.test.cjs pins the behaviour in words so that a change to
   it is a decision.

   WHAT MAY BE MEMOISED. Only a value that is a pure function of the vault
   state in memory and the clock, and that its readers do not write to — the
   readers share one object for the length of a pass. period.js ledger() and
   figures.js bookFigures() are the two. tests/render-pass.test.cjs checks
   the second condition rather than trusting it: `onHit` below lets it
   recompute on EVERY hit, across every page of the three committed
   households, and compare the fresh value with the kept one. A reader that
   wrote to a shared snapshot, or a renderer that changed state mid-pass,
   fails there.

   Pure: no DOM, no obsidian, no clock. One instance per ctx (period.js makes
   it), so two mounted views never share a pass. */

function makeRenderPass() {
  /* null outside a pass. A Map inside one — replaced, never cleared, so a
     snapshot handed out before a nested pass cannot be reached again. */
  let kept = null;
  let depth = 0;
  const pass = {
    /* Test seam, null in the app: called on every memo hit with the key, the
       kept value and the compute function. See the header. */
    onHit: null,
    active: () => kept !== null,
    run(fn) {
      depth++;
      kept = new Map();
      try { return fn(); }
      finally {
        depth--;
        kept = depth > 0 ? new Map() : null;
      }
    },
    memo(key, compute) {
      if (kept === null) return compute();
      if (kept.has(key)) {
        const value = kept.get(key);
        if (pass.onHit) pass.onHit(key, value, compute);
        return value;
      }
      /* Read the Map again after compute(): a pass opened and closed inside
         it has replaced `kept`, and a value computed across that boundary
         belongs to no single pass, so it is returned and not kept. */
      const mine = kept;
      const value = compute();
      if (kept === mine) kept.set(key, value);
      return value;
    },
  };
  return pass;
}

/* The last module in src/wiring.js: every page renderer already published on
   ctx is made to run inside one pass.

   Wrapped ON ctx rather than at the controller's dispatch, on purpose. The
   controller reads `ctx.renderDashboard` off the ctx each time it draws, and
   so do the reconciliation gate and both golden ledgers
   (tests/helpers/figures.cjs harvestView). Wrapping here means all three run
   the same function — a pass opened only in controller.js render() would be
   one the gate never exercised, on the single change in this file's history
   that most needs it to.

   By name, `render` + a capital: the convention every page and sub-page
   renderer in src/views/ follows, and tests/render-pass.test.cjs asserts that
   every view the controller dispatches to is among them. A renderer a view
   calls on itself through a local binding is not wrapped and does not need to
   be: called inside a page's pass it shares that pass, and called from an
   event handler it runs outside any pass and computes fresh. */
module.exports = function registerRenderPass(ctx) {
  for (const key of Object.keys(ctx)) {
    if (!/^render[A-Z]/.test(key) || typeof ctx[key] !== 'function') continue;
    const draw = ctx[key];
    ctx[key] = function (...args) {
      return ctx.figuresPass(() => draw.apply(this, args));
    };
  }
};
module.exports.makeRenderPass = makeRenderPass;
