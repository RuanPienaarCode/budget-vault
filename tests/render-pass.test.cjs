'use strict';
/* One figures snapshot per render pass, and never a stale one.
   2026-11-11 audit, task 9(b).

   A Dashboard paint on a five-year household asked for a stamped ledger 107
   times over 10 distinct windows and built bookFigures() four times. Inside
   one paint those are the same answers, so src/render-pass.js keeps each for
   the length of ONE synchronous render and drops it when the render returns.

   The audit's own suggestion — "once per load and day" — was measured by wave 1
   and refused: a figure has to move on an edit that never reloads, and nothing
   can tell a memo that such an edit happened. So what this suite has to prove
   is not that something is kept. It is that nothing is kept across a moment at
   which the reader could have changed anything:

     1. the pass itself: computes once per key inside, keeps nothing outside,
        drops everything on return AND on a throw, never shares a snapshot
        across a nested pass, and ends at an async renderer's first await;
     2. every page the controller dispatches to paints inside a pass, and the
        gate's mount runs the same wrapped function the app does;
     3. within a pass a snapshot is exactly what recomputing would give — on
        EVERY hit, on every page of the three committed households. This is
        what makes sharing one object between readers safe: a reader that wrote
        to it, or a renderer that changed state mid-paint, fails here. Shown
        failing on a planted write;
     4. AN EDIT BETWEEN TWO RENDERS CHANGES THE FIGURE: a row amount edited in
        memory, a balance typed into S.accounts in place, a row and an account
        pushed in — each repaint equals a first paint of a vault that held the
        edit all along;
     5. an edit INSIDE a pass, followed by a nested render, is drawn — and the
        one boundary that remains (an edit inside a paint with NO redraw) is
        pinned in words;
     6. the headless API (src/api.js has no render) never opens a pass and
        never gets a kept value;
     7. the count the change was made for: a ledger stamped once per distinct
        window per Dashboard paint.

     node tests/render-pass.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeVault, bookSeam } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, harvestView, dispatchedViews, pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const HOUSEHOLDS = [
  ['household', require('./figures/household.cjs')],
  ['household2', require('./figures/household2.cjs')],
  ['household-fx', require('./figures/household-fx.cjs')],
];

(async () => {
  /* ---- 1. the pass ------------------------------------------------------- */
  {
    const { makeRenderPass } = require('../src/render-pass');
    const pass = makeRenderPass();
    let n = 0;
    const next = () => ++n;

    eq([pass.memo('k', next), pass.memo('k', next), pass.active()], [1, 2, false],
      'outside a pass every ask computes, and nothing is kept — the headless case');

    pass.run(() => {
      ok(pass.active(), 'inside run() a pass is open');
      eq([pass.memo('k', next), pass.memo('k', next), pass.memo('other', next), pass.memo('k', next)], [3, 3, 4, 3],
        'inside a pass a key is computed once and handed back; another key is its own');
    });
    eq([pass.active(), pass.memo('k', next)], [false, 5], 'when run() returns the snapshot is gone: the next ask computes');

    assert.throws(() => pass.run(() => { pass.memo('k', next); throw new Error('a renderer threw'); }), /a renderer threw/);
    checks++;
    eq([pass.active(), pass.memo('k', next)], [false, 7], 'and it is gone after a THROW as well — a page that failed to draw leaves no snapshot behind');

    /* Passes do not nest into one. A renderer that re-renders inside its own
       paint (an event dispatched during render, whose handler edits and draws)
       must not be served the outer paint's figures — and when it returns, the
       outer paint must not go back to figures from before the edit. */
    pass.run(() => {
      const outer = pass.memo('k', next);
      const inner = pass.run(() => pass.memo('k', next));
      const after = pass.memo('k', next);
      eq([inner === outer, after === outer, after === inner], [false, false, false],
        'a nested pass starts from nothing, and the outer one continues from nothing when it ends');
      eq(pass.memo('k', next), after, 'the outer pass still keeps what it computes afterwards');
    });

    /* A value computed ACROSS a nested pass belongs to neither. */
    pass.run(() => {
      const v = pass.memo('across', () => { pass.run(() => {}); return next(); });
      ok(pass.memo('across', next) !== v, 'a value whose computation opened a pass of its own is returned but not kept');
    });

    /* An async renderer: the pass is its synchronous prefix. */
    let resumed = null;
    const drawn = pass.run(async () => {
      const first = pass.memo('k', next);
      await null;
      resumed = [pass.active(), pass.memo('k', next) !== first];
    });
    eq(pass.active(), false, 'run() has returned the promise, so the pass is closed before any continuation runs');
    await drawn;
    eq(resumed, [false, true], 'after the first await the renderer is outside the pass and computes afresh');

    const other = makeRenderPass();
    other.run(() => { eq(pass.active(), false, 'two instances never share a pass — one per mounted ctx'); });
  }

  /* ---- 2. every page paints inside a pass -------------------------------- */
  {
    const H = HOUSEHOLDS[0][1];
    const unpin = pinClock(H.TODAY);
    try {
      const M = await mountFor(H.SEED, { period: H.PERIOD, budgetFolder: H.B });
      const { ctx } = M;
      let opened = 0;
      const run = ctx.figuresPass;
      ctx.figuresPass = fn => { opened++; return run(fn); };
      for (const { view, fn } of dispatchedViews()) {
        const before = opened;
        ctx[fn]();
        ok(opened > before, `${view}: ctx.${fn} — the function controller.js dispatches to and the gate harvests — opens a pass`);
        eq(ctx.renderPassState.active(), false, `${view}: and it is closed again when the page has drawn`);
      }
      ctx.figuresPass = run;
      M.restore();
    } finally { unpin(); }

    const wiring = require('../src/wiring').WIRING.map(m => m.id);
    eq(wiring[wiring.length - 1], 'render-pass', 'render-pass is the LAST wired module: registered before a view it would find nothing of that view\'s to wrap');
    const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
    ok(/\(\{\s*dashboard: ctx\.renderDashboard/.test(controller),
      'controller.js still reads each renderer off ctx when it draws, which is what makes the wrapped function the one it calls');
  }

  /* ---- 3. a kept value is what recomputing would give, on every hit ------- */
  {
    let hits = 0;
    const perHousehold = {};
    for (const [name, H] of HOUSEHOLDS) {
      const unpin = pinClock(H.TODAY);
      try {
        const before = hits;
        for (const v of dispatchedViews()) {
          const M = await mountFor(H.SEED, { period: H.PERIOD, budgetFolder: H.B });
          M.ctx.renderPassState.onHit = (key, kept, compute) => {
            hits++;
            assert.deepStrictEqual(kept, compute(),
              `${name} / ${v.view}: the snapshot kept for "${key}" is no longer what computing it now gives — `
              + 'a reader wrote to the shared object, or the page changed state in the middle of its own paint');
          };
          M.ctx[v.fn]();
          M.ctx[v.fn]();            // and a repaint over the page it just drew
          M.restore();
        }
        perHousehold[name] = hits - before;
      } finally { unpin(); }
    }
    checks += hits;
    for (const [name] of HOUSEHOLDS) ok(perHousehold[name] > 50, `${name}: the pages really did read kept snapshots (${perHousehold[name]} hits, each recomputed and compared)`);

    /* The check above can fail. A reader that writes to the shared ledger is
       exactly what it exists to catch. */
    const H = HOUSEHOLDS[0][1];
    const unpin = pinClock(H.TODAY);
    try {
      const M = await mountFor(H.SEED, { period: H.PERIOD, budgetFolder: H.B });
      const { ctx } = M;
      const { start, end } = ctx.periodRange(H.PERIOD);
      ctx.renderPassState.onHit = (key, kept, compute) => assert.deepStrictEqual(kept, compute());
      assert.throws(() => ctx.figuresPass(() => { ctx.ledger(start, end).pop(); ctx.ledger(start, end); }), assert.AssertionError,
        'a reader that drops a row from the shared ledger is caught on the next hit');
      checks++;
      assert.throws(() => ctx.figuresPass(() => { ctx.bookFigures().balances.implied.accounts.reverse(); ctx.bookFigures(); }), assert.AssertionError,
        'and so is one that reorders the shared balance book');
      checks++;
      M.restore();
    } finally { unpin(); }
  }

  /* ---- 4. an edit between two renders changes the figure ------------------ */
  {
    const H = HOUSEHOLDS[0][1];
    const B = H.B;
    const cheque = `${B}/Transactions/Cheque/2026-09.md`;
    const chequeAcct = `${B}/Accounts/Cheque.md`;
    ok(H.SEED[cheque].includes('| 2026-09-02 | Checkers | Groceries | -2000.00 |'), 'the fixture still holds the row this section edits');
    ok(H.SEED[chequeAcct].includes('balance: 20000.00'), 'and the balance it retypes');

    /* Each case: the edit made IN MEMORY on a mounted app that has already
       painted, and the same edit made to the FILES of a vault mounted fresh.
       The repaint must equal the fresh paint, figure for figure. */
    const EDITS = [
      ['a row amount edited in memory (an unsaved edit on Transactions)',
        S => { S.txFiles[Object.keys(S.txFiles).find(k => S.txFiles[k].label === 'Cheque' && S.txFiles[k].month === '2026-09')]
          .rows.find(r => r.desc === 'Checkers').amount = -2500; },
        f => ({ ...f, [cheque]: f[cheque].replace('| Checkers | Groceries | -2000.00 |', '| Checkers | Groceries | -2500.00 |') })],
      ['a balance typed into S.accounts in place (accounts.js)',
        S => { S.accounts.find(a => a.name === 'Cheque').balance = 25000; },
        f => ({ ...f, [chequeAcct]: f[chequeAcct].replace('balance: 20000.00', 'balance: 25000.00') })],
      ['a row pushed into a month file (Add transaction)',
        S => { const f = S.txFiles[Object.keys(S.txFiles).find(k => S.txFiles[k].label === 'Cheque' && S.txFiles[k].month === '2026-09')];
          f.rows.push({ ...f.rows.find(r => r.desc === 'Checkers'), desc: 'Woolworths', amount: -750 }); },
        f => ({ ...f, [cheque]: f[cheque] + '| 2026-09-02 | Woolworths | Groceries | -750.00 |  |  |  |\n' })],
    ];
    const VIEWS = dispatchedViews().filter(v => ['dashboard', 'score', 'savings', 'accounts', 'budgets', 'transactions'].includes(v.view));
    eq(VIEWS.length, 6, 'the six pages that print period and balance figures were found');
    const line = f => `${f.address}\t${f.kind}\t${f.text}\t${f.raw}`;
    const unpin = pinClock(H.TODAY);
    try {
      for (const [what, inMemory, onDisk] of EDITS) {
        let movedSomewhere = 0;
        for (const v of VIEWS) {
          const live = await mountFor(H.SEED, { period: H.PERIOD, budgetFolder: B });
          const first = harvestView(live.ctx, live.nodes, live.raws, v).figures.map(line);
          inMemory(live.S);
          const repaint = harvestView(live.ctx, live.nodes, live.raws, v);
          live.restore();

          const fresh = await mountFor(onDisk(H.SEED), { period: H.PERIOD, budgetFolder: B });
          fresh.ctx[v.fn]();
          const want = harvestView(fresh.ctx, fresh.nodes, fresh.raws, v);
          fresh.restore();

          eq([repaint.error, want.error], [null, null], `${what} / ${v.view}: both paints drew`);
          eq(repaint.figures.map(line), want.figures.map(line),
            `${what} / ${v.view}: the repaint after the edit prints exactly what a vault that always held the edit prints — nothing from before the edit survived`);
          if (repaint.figures.map(line).join('\n') !== first.join('\n')) movedSomewhere++;
        }
        ok(movedSomewhere >= 2, `${what}: and the edit really did move figures (${movedSomewhere} of ${VIEWS.length} pages changed), so the equality above is not two unchanged pages`);
      }
    } finally { unpin(); }
  }

  /* ---- 5. an edit inside a pass, then a nested render --------------------- */
  {
    const H = HOUSEHOLDS[0][1];
    const unpin = pinClock(H.TODAY);
    try {
      const M = await mountFor(H.SEED, { period: H.PERIOD, budgetFolder: H.B });
      const { ctx, S } = M;
      const accountsView = dispatchedViews().find(v => v.view === 'accounts');
      const heroOf = figs => figs.find(f => /^acctSummary\/div\.card\[0\]\/div\.hero-num/.test(f.address)).raw;
      ctx.figuresPass(() => {
        const before = ctx.bookFigures();
        eq(ctx.bookFigures(), before, 'inside one pass bookFigures() is one object');
        ok(ctx.bookFigures() === before, 'the very same one');
        S.accounts.find(a => a.name === 'Cheque').balance += 1000;
        /* The page drawn from here is a pass of its own. */
        const drawn = harvestView(ctx, M.nodes, M.raws, accountsView);
        eq(heroOf(drawn.figures), before.balances.implied.net + 1000, 'a page rendered after an edit made INSIDE a pass prints the edited figure');
        ok(ctx.bookFigures() !== before, 'and the outer pass does not go back to the snapshot from before it');
        eq(ctx.bookFigures().balances.implied.net, before.balances.implied.net + 1000, 'it computes again, and sees the edit');
      });

      /* The boundary src/render-pass.js states in its header, in words. A
         handler the DOM runs synchronously INSIDE a paint (a focused field
         removed by the redraw can fire blur/change) that edits state and does
         not redraw: the rest of that one paint keeps its snapshot, and the
         next ask outside it is right. Pinned so that changing it is a
         decision, not a side effect. */
      const { start, end } = ctx.periodRange(H.PERIOD);
      const row = ctx.ledger(start, end).find(s => s.row.desc === 'Checkers').row._row;
      let inside = null;
      ctx.figuresPass(() => {
        const kept = ctx.ledger(start, end);
        row.amount -= 50;                       // the handler's edit; no redraw follows
        inside = ctx.ledger(start, end) === kept;
      });
      eq(inside, true, 'an edit made inside a paint with no redraw: the rest of THAT paint still reads its snapshot');
      eq(ctx.ledger(start, end).find(s => s.row.desc === 'Checkers').amount, row.amount, 'and the very next ask, outside it, reads the edit');
      row.amount += 50;
      M.restore();
    } finally { unpin(); }
  }

  /* ---- 6. the headless API never opens a pass ----------------------------- */
  {
    /* Counted at the module, because the API builds a ctx of its own that no
       test can reach: every pass instance made while the API answers is
       recorded, with whether it was ever opened and whether it ever handed
       back a kept value. */
    const srcDir = path.join(__dirname, '..', 'src') + path.sep;
    for (const k of Object.keys(require.cache)) if (k.startsWith(srcDir)) delete require.cache[k];
    const rp = require('../src/render-pass');
    const real = rp.makeRenderPass;
    const made = [];
    rp.makeRenderPass = () => {
      const p = real();
      const rec = { opened: 0, asks: 0, hits: 0 };
      const run = p.run, memo = p.memo;
      p.run = fn => { rec.opened++; return run(fn); };
      p.memo = (key, compute) => { rec.asks++; let computed = false; const v = memo(key, () => { computed = true; return compute(); }); if (!computed) rec.hits++; return v; };
      made.push(rec);
      return p;
    };
    const H = HOUSEHOLDS[0][1];
    const unpin = pinClock(H.TODAY);
    try {
      const { buildApi } = require('../src/api');
      const api = buildApi(bookSeam({ settings: { budgetFolder: H.B }, app: { vault: makeVault({ ...H.SEED }) }, _lastWrite: 0 }));
      const got = await api.currentPeriod();
      ok(got && typeof got === 'object', 'the API answered');
      ok(made.length >= 1, `and it built its own pass instance through period.js (${made.length})`);
      const asks = made.reduce((t, r) => t + r.asks, 0);
      ok(asks > 0, `its figures went through the same ledger() the pages use (${asks} asks)`);
      eq(made.map(r => [r.opened, r.hits]), made.map(() => [0, 0]),
        'no pass was opened and no kept value was handed back: every figure the API returned was computed when it was asked for');
    } finally { unpin(); rp.makeRenderPass = real; for (const k of Object.keys(require.cache)) if (k.startsWith(srcDir)) delete require.cache[k]; }

    const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'api.js'), 'utf8');
    for (const word of ['figuresPass', 'render-pass', 'renderPassState']) {
      eq(api.includes(word), false, `src/api.js does not reach for ${word} — a headless caller has no render to bound a snapshot by`);
    }
  }

  /* ---- 7. once per window per paint --------------------------------------- */
  {
    const H = HOUSEHOLDS[0][1];
    const unpin = pinClock(H.TODAY);
    try {
      const M = await mountFor(H.SEED, { period: H.PERIOD, budgetFolder: H.B });
      const { ctx } = M;
      const computed = [];
      let asks = 0;
      const pass = ctx.renderPassState, memo = pass.memo;
      /* period.js reads `memo` off the instance on each call, so this sees
         every ledger() ask; bookFigures goes through ctx.passMemo, bound
         earlier, and is counted by tests/figure-pipeline-hot-spot.test.cjs. */
      pass.memo = (key, compute) => { asks++; return memo(key, () => { computed.push(key); return compute(); }); };
      ctx.renderDashboard();
      pass.memo = memo;
      ok(asks > computed.length * 2, `a Dashboard paint asks for a ledger far more often than there are windows (${asks} asks)`);
      eq(new Set(computed).size, computed.length, `and stamps each distinct window exactly once (${computed.length} windows) — it was once per ask`);
      M.restore();
    } finally { unpin(); }
  }

  console.log(`PASS render-pass — one snapshot per render, dropped when it ends; an edit between two renders moves every figure (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
