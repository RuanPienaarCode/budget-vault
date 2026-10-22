'use strict';
/* Two Budget tabs open on one vault: a Save in one is somebody else's edit to
   the other.

   Every view builds its own io over the ONE plugin object, and the write
   ledger lives on the plugin (io.js explains why: main.js's Settings.md
   updater and the setup wizard must be recognised as this app). So when tab A
   saved a plan, tab B's watcher looked the change up, found A's hash in the
   shared "own" record, and called it its own echo: no reload, nothing marked
   stale. B went on showing the plan as it was before A's edit, and B's next
   Save of that plan passed the freshness check and wrote the old copy back
   over A's — while A had said "Saved". Reported 22 Oct 2026 as "Plan: I edit
   an item, press Save plan, it says Saved, and the change is gone later".

   Pinned over the real io.js and an evented in-memory vault that announces
   every write to every open view, the way Obsidian's vault events do:

     1. A's write is A's echo, and foreign to B.
     2. B's Save of the plan it loaded before A's write refuses (STALE), and
        A's bytes survive.
     3. B's observation does not make A's own NEXT save refuse: the stale
        record belongs to the view that saw the change.
     4. A refusal in B is told to B's listener only, so only B reloads.
     5. A write by an io that belongs to no view (main.js's Settings.md
        updater, the wizard) is still every view's own echo — the reason the
        ledger is shared at all.

     node tests/two-views-one-ledger.test.cjs */

const assert = require('assert');
const { stubObsidian, makeVault } = require('./helpers/harness.cjs');
stubObsidian();
const { makeIo } = require('../src/io');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const PLAN = 'Plans/Windfall.md';
const planText = spent => [
  '---', 'kind: plan', 'plan: "Windfall"', '---', '', '## Items', '',
  '| Item | Envelope | Amount | Spent | Status | Category | Notes |',
  '|------|----------|-------:|------:|--------|----------|-------|',
  `| Dinner | Fun | 300.00 | ${spent} | planned |  |  |`, '',
].join('\n');

/* One vault, one plugin, any number of ios. Every write the vault performs is
   announced to every io registered as watching (the open views); `settle` lets
   those judgements finish. */
function rig() {
  const vault = makeVault({
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\n---\n',
    [`${B}/${PLAN}`]: planText('0.00'),
  });
  const plugin = { settings: { budgetFolder: B }, _lastWrite: 0 };
  const watching = [];
  const inflight = [];
  const tell = (kind, f) => { for (const io of watching) inflight.push(io.observeChange(f, undefined, kind)); };
  const m = vault.modify, c = vault.create;
  vault.modify = async (f, x) => { await m(f, x); tell('modify', f); };
  vault.create = async (p, x) => { const f = await c(p, x); tell('create', f); return f; };
  const view = () => { const io = makeIo({ vault, plugin }, { view: true }); watching.push(io); return io; };
  const settle = async () => { await Promise.all(inflight.splice(0)); };
  return { vault, plugin, view, settle, text: rel => vault._store.get(`${B}/${rel}`) };
}

(async () => {
  /* ---- 1-2. A saves; B's stale copy may not overwrite it ---- */
  {
    const r = rig();
    const A = r.view(), Bv = r.view();
    const seen = [];
    const judged = [];
    const origA = A.observeChange, origB = Bv.observeChange;
    A.observeChange = (...a) => { const p = origA(...a); judged.push(p.then(x => ['A', x.own])); return p; };
    Bv.observeChange = (...a) => { const p = origB(...a); judged.push(p.then(x => ['B', x.own])); return p; };

    await A.writeFile(PLAN, planText('300.00'));
    await r.settle();
    seen.push(...await Promise.all(judged));
    eq(seen.find(s => s[0] === 'A'), ['A', true], '1: the tab that saved hears its own echo');
    eq(seen.find(s => s[0] === 'B'), ['B', false],
      '1: the OTHER tab hears somebody else\'s edit — it must reload, not ignore it');

    let err = null;
    try { await Bv.writeFile(PLAN, planText('0.00')); } catch (e) { err = e; }
    ok(err && err.code === 'STALE', '2: B\'s Save of the plan it loaded before A\'s edit refuses');
    eq(r.text(PLAN), planText('300.00'), '2: and A\'s saved edit is still on disk');
  }

  /* ---- 3-4. stale and refusals belong to the view that saw the change ---- */
  {
    const r = rig();
    const A = r.view(), Bv = r.view();
    const heardA = [], heardB = [];
    A.onStaleWrite(x => heardA.push(x.rel));
    Bv.onStaleWrite(x => heardB.push(x.rel));

    await A.writeFile(PLAN, planText('100.00'));
    await r.settle();
    eq(Bv.isStaleFile(PLAN), true, '3: B knows the plan changed under it');
    eq(A.isStaleFile(PLAN), false, '3: A does not — it wrote those bytes');
    await A.writeFile(PLAN, planText('200.00'));
    await r.settle();
    eq(r.text(PLAN), planText('200.00'), '3: so A\'s next Save of its own plan goes through');

    try { await Bv.writeFile(PLAN, planText('0.00')); } catch (e) { /* refused */ }
    eq(heardB, [PLAN], '4: B\'s refusal is told to B, which reloads');
    eq(heardA, [], '4: and not to A, whose copy is current');

    /* A reload in B (readFile, then staleClear) clears B's record only. */
    await Bv.readFile(PLAN);
    eq(Bv.isStaleFile(PLAN), false, '4: B re-reading the file lifts its refusal');
  }

  /* ---- 5. a write by no view is every view's own ---- */
  {
    const r = rig();
    const A = r.view(), Bv = r.view();
    const settingsIo = makeIo({ vault: r.vault, plugin: r.plugin });   // main.js's updater
    const results = [];
    const wrap = (io, k) => { const o = io.observeChange; io.observeChange = (...a) => { const p = o(...a); p.then(x => results.push([k, x.own])); return p; }; };
    wrap(A, 'A'); wrap(Bv, 'B');
    await settingsIo.writeFile('Settings.md', '---\nmonth_start_day: 22\n---\n');
    await r.settle();
    await new Promise(res => setImmediate(res));
    eq(results.sort(), [['A', true], ['B', true]],
      '5: the Settings.md updater\'s write is no view\'s foreign edit — no reload in either tab');
  }

  console.log(`PASS two-views-one-ledger (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
