'use strict';
/* The headless API's vault watcher: reload for a subscriber, never for nobody,
   and never after the plugin has gone.

   api.js used to register its four vault handlers in onload, on every
   install, whether or not any sibling plugin ever subscribed. One change under
   the budget folder (an iCloud delivery, a save in the Budget view) then
   re-read the whole folder 800ms later for no listener at all — 21 reads on
   the synthetic household, hundreds on a real vault the 2026-10-07 audit
   measured — with the privacy lock on and no view open. Registered in onload, its
   'create' handler also heard Obsidian's vault-load burst, one event per
   existing file, at every launch. And nothing unwound the debounce timer at
   unload: a reload scheduled just before the plugin was disabled or updated
   still ran 800ms later and called into the dead instance's subscribers, and
   an async subscriber that rejected escaped as an unhandled rejection.

   Obsidian's Plugin base is stood in for by its Component lifecycle as read in
   the 1.13.7 app.js: register() queues a callback, registerEvent() queues the
   event's own offref, unload() runs the queue last-first. Workspace
   onLayoutReady() runs its callback at once when the layout is ready and
   queues it until then otherwise — also as read there.

   What this suite pins:
     1. no subscriber: no handler is registered at all, and a budget-folder
        change reads nothing.
     2. the first subscriber registers the watcher, but only once the layout
        is ready — so the vault-load 'create' burst before that is heard by
        nobody — and further subscribers do not register it again.
     3. with a subscriber, a change is reloaded once and notified (the old
        behaviour, kept); once the last subscriber leaves, changes read nothing.
     4. unload with a reload pending: zero reads and zero subscriber calls after
        unload, zero handlers left, and a subscriber added after unload is
        never registered.
     5. an async subscriber that rejects is contained: no unhandled rejection,
        and the other subscribers are still told.
     6. unload before the layout was ready: the deferred registration never
        happens.

     node tests/api-watcher.test.cjs
*/
const assert = require('assert');
const { stubObsidian, makeVault } = require('./helpers/harness.cjs');
stubObsidian();
const { SEED, B } = require('./figures/household.cjs');
const { buildApi } = require('../src/api');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const settle = ms => new Promise(r => setTimeout(r, ms));
const unhandled = [];
process.on('unhandledRejection', e => { unhandled.push(String((e && e.message) || e)); });

function makeHost({ layoutReady = true } = {}) {
  const vault = makeVault(SEED);
  const counts = { reads: 0 };
  const rawCached = vault.cachedRead.bind(vault);
  vault.cachedRead = async f => { counts.reads++; return rawCached(f); };
  const handlers = {};
  vault.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return { e: vault, name, fn }; };
  vault.offref = ref => { handlers[ref.name] = (handlers[ref.name] || []).filter(f => f !== ref.fn); };
  const emit = (name, p) => (handlers[name] || []).slice().forEach(fn => fn({ path: p }));
  const handlerCount = () => Object.values(handlers).reduce((n, a) => n + a.length, 0);

  let ready = layoutReady;
  const queued = [];
  const workspace = { onLayoutReady: cb => { if (ready) cb(); else queued.push(cb); } };
  const layoutBecomesReady = () => { ready = true; while (queued.length) queued.shift()(); };

  const events = [];
  const plugin = {
    settings: { budgetFolder: B }, app: { vault, workspace }, _lastWrite: 0,
    register(cb) { events.push(cb); },
    registerEvent(ref) { this.register(() => ref.e.offref(ref)); },
  };
  const unload = () => { while (events.length) events.pop()(); };
  return { plugin, counts, emit, handlerCount, layoutBecomesReady, unload };
}

/* ---- 1. no subscriber ---- */
async function noSubscriber() {
  const h = makeHost();
  buildApi(h.plugin);                          // what main.js onload does, on every install
  eq(h.handlerCount(), 0, 'no subscriber: not one vault handler is registered');
  h.emit('modify', `${B}/Transactions/Cheque/2026-09.md`);
  h.emit('create', `${B}/Categories/New.md`);
  await settle(1000);
  eq(h.counts.reads, 0, 'and a budget-folder change reads nothing');
}

/* ---- 2 + 3. lazily, after layout-ready, once; then a real reload ---- */
async function lazyAndDeferred() {
  const h = makeHost({ layoutReady: false });
  const api = buildApi(h.plugin);
  let heard = 0;
  const off = api.onChange(() => { heard++; });
  eq(h.handlerCount(), 0, 'subscribed before the layout is ready: registration waits for onLayoutReady');
  for (const p of Object.keys(SEED)) h.emit('create', p);   // Obsidian's vault-load burst
  h.layoutBecomesReady();
  eq(h.handlerCount(), 4, 'layout ready: modify, create, delete and rename are registered');
  const off2 = api.onChange(() => {});
  eq(h.handlerCount(), 4, 'a second subscriber does not register the watcher again');
  await settle(1000);
  eq(h.counts.reads, 0, 'the vault-load create burst before layout-ready reached nobody');
  eq(heard, 0, 'and notified nobody');

  h.emit('modify', `${B}/Settings.md`);
  h.emit('modify', `${B}/Transactions/Cheque/2026-09.md`);
  await settle(1000);
  ok(h.counts.reads > 0, 'with a subscriber, a budget-folder change is reloaded');
  eq(heard, 1, 'and notified once for the burst');

  h.emit('modify', 'Journal/2026-09-02.md');
  await settle(1000);
  eq(heard, 1, 'a change outside the budget folder is not a change to the budget');

  off(); off2();
  eq(h.handlerCount(), 4, 'the handlers stay registered after the last subscriber leaves');
  const reads = h.counts.reads;
  /* Not just no read — no timer either. The spy only wraps this synchronous
     emit, so the other scenarios running alongside cannot reach it. */
  const realSetTimeout = global.setTimeout;
  let scheduled = 0;
  global.setTimeout = (fn, ms, ...rest) => { if (ms === 800) scheduled++; return realSetTimeout(fn, ms, ...rest); };
  try { h.emit('modify', `${B}/Settings.md`); } finally { global.setTimeout = realSetTimeout; }
  eq(scheduled, 0, 'every subscriber gone: a change schedules no reload at all');
  await settle(1000);
  eq(h.counts.reads, reads, 'and reads nothing');
}

/* ---- 4. unload with a reload pending ---- */
async function unloadPending() {
  const h = makeHost();
  const api = buildApi(h.plugin);
  let heard = 0;
  api.onChange(() => { heard++; });
  h.emit('modify', `${B}/Settings.md`);          // a sync event lands...
  await settle(100);
  h.unload();                                    // ...and the plugin is disabled or updated
  const reads = h.counts.reads;
  await settle(1100);
  eq(h.counts.reads - reads, 0, 'unloaded with a reload pending: zero reads after unload');
  eq(heard, 0, 'and zero calls into the unloaded instance\'s subscribers');
  eq(h.handlerCount(), 0, 'and no vault handler left behind');

  const late = api.onChange(() => { heard++; });
  eq(typeof late, 'function', 'subscribing after unload still hands back an unsubscribe');
  eq(h.handlerCount(), 0, 'but registers nothing on the unloaded plugin');
  eq(await api._reload(), undefined, 'and a direct reload after unload does nothing');
  eq(heard, 0, 'nobody is called');
}

/* ---- 5. an async subscriber that rejects ---- */
async function rejectingSubscriber() {
  const h = makeHost();
  const api = buildApi(h.plugin);
  let heard = 0;
  api.onChange(async () => { throw new Error('async subscriber rejected'); });
  api.onChange(() => { throw new Error('sync subscriber threw'); });
  api.onChange(() => { heard++; });
  h.emit('modify', `${B}/Settings.md`);
  await settle(1000);
  eq(heard, 1, 'a rejecting and a throwing subscriber do not silence the one after them');
}

/* ---- 6. unload before the layout was ready ---- */
async function unloadBeforeLayout() {
  const h = makeHost({ layoutReady: false });
  const api = buildApi(h.plugin);
  api.onChange(() => {});
  h.unload();
  h.layoutBecomesReady();
  eq(h.handlerCount(), 0, 'unloaded before the layout was ready: the deferred registration never happens');
}

(async () => {
  await Promise.all([noSubscriber(), lazyAndDeferred(), unloadPending(), rejectingSubscriber(), unloadBeforeLayout()]);
  await settle(50);
  eq(unhandled, [], 'no unhandled rejection anywhere above');
  console.log(`PASS — api-watcher: reloads for a subscriber, never for nobody, never after unload (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
