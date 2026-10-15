'use strict';
/* The two pieces of controller.js that mountApp's closure used to hide from
   bare node (2026-10-14 audit, lane S1: L3-02 and L8-03).

   makeReloadScheduler — the vault watcher's debounce.
     Before, the timer's callback began with "if any of our own writes landed in
     the last 2 s, return" — a bare return, so the change that scheduled it was
     forgotten for good. A phone edit arriving just after a Save was therefore
     never loaded, and the next Save (built from the old state) deleted it. Our
     own echoes no longer reach the scheduler (io.observeChange recognises them
     by content), so the callback has one job: reload when the page is quiet,
     and otherwise try again later. Nothing is dropped.

   unreadableSummary — the one sentence the shell banner prints for the files
     the loader found but could not read (S.unreadableFiles). '' means no
     banner. Read defensively: the loader owns the field.

     node tests/controller-reload-scheduler-and-banner.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { makeReloadScheduler, makeRefusalHandler, unreadableSummary } = require('../src/controller');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* A clock we drive by hand: timers are queued, run in due order. */
function fakeClock() {
  let now = 0, id = 0; const q = [];
  return {
    set(fn, ms) { const t = { id: ++id, at: now + ms, fn }; q.push(t); return t.id; },
    clear(i) { const k = q.findIndex(t => t.id === i); if (k >= 0) q.splice(k, 1); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at);
        if (!q.length || q[0].at > end) break;
        const t = q.shift(); now = t.at; await t.fn();
      }
      now = end;
    },
  };
}

(async () => {
  /* ---- the scheduler ---- */
  {
    const clk = fakeClock(); let reloads = 0, dirty = false, editing = false;
    const s = makeReloadScheduler({ hasDirty: () => dirty, isEditing: () => editing, reload: async () => { reloads++; }, set: clk.set, clear: clk.clear });
    s.schedule(800);
    // An own write happens during the debounce: the scheduler knows nothing of it and must not drop the change.
    await clk.advance(800);
    eq(reloads, 1, 'L3-02: a scheduled reload runs when the page is quiet — nothing else can discard it');

    s.schedule(800); s.schedule(800);
    await clk.advance(800);
    eq(reloads, 2, 'a burst of events is one reload (the later schedule replaces the earlier)');

    dirty = true; s.schedule(800);
    await clk.advance(800);
    eq(reloads, 2, 'a dirty page defers…');
    await clk.advance(1600 + 3200);
    eq(reloads, 2, '…and keeps backing off while it stays dirty');
    dirty = false;
    await clk.advance(30000);
    eq(reloads, 3, '…and the change is still there to load once the page goes clean (deferred, not dropped)');

    editing = true; s.schedule(800);
    await clk.advance(800 + 1500);
    eq(reloads, 3, 'mid-edit defers');
    editing = false;
    await clk.advance(1500);
    eq(reloads, 4, 'and loads after the edit ends');

    s.schedule(800); s.cancel(); await clk.advance(5000);
    eq(reloads, 4, 'cancel() unwinds a pending reload (view closed)');
  }
  {
    // The back-off ceiling.
    const clk = fakeClock(); let reloads = 0;
    const s = makeReloadScheduler({ hasDirty: () => true, isEditing: () => false, reload: async () => { reloads++; }, set: clk.set, clear: clk.clear });
    s.schedule(800);
    await clk.advance(10 * 60 * 1000);
    ok(reloads === 0, 'never reloads over a dirty page');
  }

  /* ---- a refused save: told once, reloaded once, and ready again ---- */
  {
    const said = []; let reloads = 0, cancels = 0;
    const h = makeRefusalHandler({ tell: rel => said.push(rel), cancel: () => { cancels++; }, reload: async () => { reloads++; } });
    h({ rel: 'A.md' }); h({ rel: 'B.md' }); h({ rel: 'C.md' });          // a save loop hitting three stale files
    await new Promise(r => setTimeout(r, 5));
    eq(said, ['A.md'], 'the reader is told once for a burst of refusals');
    eq([reloads, cancels], [1, 1], '…the page reloads once, superseding the debounced reload');
    h({ rel: 'D.md' });
    await new Promise(r => setTimeout(r, 5));
    eq(said, ['A.md', 'D.md'], 'and is told again for the next, separate refusal');
    const failing = makeRefusalHandler({ tell() {}, cancel() {}, reload: async () => { throw new Error('x'); } });
    failing({ rel: 'E.md' });
    await new Promise(r => setTimeout(r, 5));
    ok(true, 'a reload that fails does not escape as an unhandled rejection');
  }

  /* ---- the banner sentence ---- */
  {
    eq(unreadableSummary(undefined), '', 'no field, no banner');
    eq(unreadableSummary([]), '', 'an empty list, no banner');
    eq(unreadableSummary([{ nothing: 1 }, null]), '', 'junk entries are ignored');
    i18n.setLanguage('en');
    const one = unreadableSummary([{ rel: 'Settings.md', why: 'frontmatter' }]);
    ok(/Settings\.md/.test(one) && /could not be read/i.test(one), 'names the file and says it could not be read');
    ok(/default/i.test(one), 'and says what the figures assume');
    ok(!/[{}]/.test(one), 'no unfilled placeholder');
    const three = unreadableSummary([{ rel: 'Settings.md', why: 'missing' }, { rel: 'Assets.md', why: 'table' }, { rel: 'Accounts/Cash.md', why: 'frontmatter' }]);
    ok(/Settings\.md/.test(three) && /Assets\.md/.test(three) && /Accounts\/Cash\.md/.test(three), 'several files are one sentence naming each');
    eq((three.match(/could not be read/g) || []).length, 1, 'ONE banner, not one per file');
    const many = unreadableSummary(Array.from({ length: 9 }, (_, i) => ({ rel: `Accounts/A${i}.md`, why: 'table' })));
    ok(/A0\.md/.test(many) && !/A8\.md/.test(many) && many.includes('…'), 'a long list is cut and says so');
    ok(!/[{}]/.test(unreadableSummary([{ rel: 'X.md', why: 'something-new' }])), 'an unknown reason still reads');
    i18n.setLanguage('af');
    ok(/Settings\.md/.test(unreadableSummary([{ rel: 'Settings.md', why: 'missing' }])) && !/could not be read/.test(unreadableSummary([{ rel: 'Settings.md', why: 'missing' }])),
      'translated through the language table');
    i18n.setLanguage('en');
  }

  /* ---- wiring (mountApp needs a DOM shell) ---- */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
    ok(/renderUnreadableBanner\(\);/.test(src) && /unreadableBannerText\(S\.unreadableFiles, plugin\.settings\.onboarded\)/.test(src), 'render() prints the banner from S.unreadableFiles');
    ok(/new Notice\(i18n\.t\('io\.stale\.notice'/.test(src), 'a refused save is surfaced once as a Notice');
  }

  console.log(`PASS controller-reload-scheduler-and-banner (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
