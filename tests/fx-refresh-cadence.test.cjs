'use strict';
/* Exchange rates: one request per refresh interval, not one per reload.

   refreshRates() runs after every vault reload (controller.js: the unlock,
   and every external change a sync client delivers), and it asked the
   provider whenever fx.refreshDue() said the table was due — a comparison of
   the PROVIDER'S date with the device's LOCAL date. Whenever the answer that
   had just arrived was itself due, the next reload asked again, and the next:
   in a zone east of Greenwich before the provider's 00:02 UTC update (01:30
   in Johannesburg, 12:30 in Auckland), with a provider stuck on an old date
   or one dated in the future, or simply offline. The 2026-10-07 audit counted
   5 requests over 5 reloads in each of those, under fx-live.js's own promise
   of "one lookup per interval, not one a render".

   The gate now remembers when it last asked:
     - after a request that SUCCEEDED, no other request until the refresh
       interval has passed, counted in the household's LOCAL days — the unit
       refreshDue and the cadence setting are counted in. The instant is kept
       in memory and stamped into the cache file's frontmatter (`fetched:`),
       so a re-opened view, a restarted app or the other device sharing the
       vault are held to it too;
     - after a request that FAILED, a back-off: fifteen minutes, doubling with
       each failure in a row, never longer than the interval;
     - a stamp from the future (a wrong clock elsewhere, a hand edit) is not
       believed, the same way a rate dated in the future is not.
   The date-based question — is the table due at all — is unchanged and still
   asked first.

   Network STUBBED (global.__requestUrl); a real instant and a real time zone
   pinned per case (tests/helpers/figures.cjs pinClock forces UTC noon, which
   cannot express "01:30 in Johannesburg").

     node tests/fx-refresh-cadence.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();
const fx = require('../src/fx');
const ff = require('../src/fx-fetch');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const RealDate = Date;
let unpinNow = null;
function at(isoInstant, tz) {
  if (unpinNow) unpinNow();
  const fixed = new RealDate(isoInstant).getTime();
  function P(...a) { if (!(this instanceof P)) return new RealDate(fixed).toString(); return a.length ? new RealDate(...a) : new RealDate(fixed); }
  P.prototype = RealDate.prototype; P.now = () => fixed; P.parse = RealDate.parse; P.UTC = RealDate.UTC;
  global.Date = P;
  const had = 'TZ' in process.env, old = process.env.TZ;
  process.env.TZ = tz;
  unpinNow = () => { global.Date = RealDate; if (had) process.env.TZ = old; else delete process.env.TZ; unpinNow = null; };
  return fixed;
}
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

let sent = 0;
let provider = () => { throw new Error('no provider set'); };
global.__requestUrl = async () => { sent++; return provider(); };
const answer = stamp => () => ({ status: 200, json: { result: 'success', base_code: 'ZAR', time_last_update_utc: stamp, rates: { ZAR: 1, CNY: 0.39 } } });
const offline = () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); };

const SETTINGS = { exchange_rates: true, currency_code: 'ZAR' };
function mount(files = {}, settings = SETTINGS) {
  const ctx = makeCtx(files, { budgetFolder: 'Budget', settings });
  require('../src/io')(ctx);
  require('../src/fx-live')(ctx);
  return ctx;
}
async function reloads(ctx, n) {
  const before = sent;
  for (let i = 0; i < n; i++) await ctx.refreshRates();   // one per vault reload
  return sent - before;
}

(async () => {
  try {
    /* ---- 1. the gate itself (pure) ---- */
    {
      const now = at('2026-10-07T10:00:00Z', 'Africa/Johannesburg');
      eq(fx.requestAllowed({}, now, 'daily'), true, 'never asked: allowed');
      eq(fx.requestAllowed({ lastSuccessAt: now - 3 * 60 * MIN }, now, 'daily'), false,
        'asked successfully earlier today: not again today at a daily cadence');
      eq(fx.requestAllowed({ lastSuccessAt: now - 11 * 60 * MIN }, now, 'daily'), false,
        'asked at 01:00 local — still the 6th in UTC — is asked TODAY: the day is the household\'s, not Greenwich\'s');
      eq(fx.requestAllowed({ lastSuccessAt: now - 13 * 60 * MIN }, now, 'daily'), true,
        'asked at 23:00 local the day before, thirteen hours ago: a new local day, so allowed');
      eq(fx.requestAllowed({ lastSuccessAt: now - 6 * DAY }, now, 'weekly'), false, 'weekly: six local days on, not yet');
      eq(fx.requestAllowed({ lastSuccessAt: now - 7 * DAY }, now, 'weekly'), true, 'weekly: seven, allowed — the boundary pinned on both sides');
      eq(fx.requestAllowed({ lastSuccessAt: now + DAY }, now, 'daily'), true,
        'a success stamped in the FUTURE is not believed — a wrong clock elsewhere must not stop this device asking');

      eq(fx.requestAllowed({ failures: 1, lastFailureAt: now - 14 * MIN }, now, 'daily'), false, 'one failure: wait fifteen minutes');
      eq(fx.requestAllowed({ failures: 1, lastFailureAt: now - 15 * MIN }, now, 'daily'), true, 'and at fifteen, try again');
      eq(fx.requestAllowed({ failures: 2, lastFailureAt: now - 29 * MIN }, now, 'daily'), false, 'two in a row: thirty');
      eq(fx.requestAllowed({ failures: 3, lastFailureAt: now - 59 * MIN }, now, 'daily'), false, 'three: an hour');
      eq(fx.requestAllowed({ failures: 3, lastFailureAt: now - 60 * MIN }, now, 'daily'), true, 'and no longer');
      eq(fx.requestAllowed({ failures: 40, lastFailureAt: now - DAY + MIN }, now, 'daily'), false, 'many failures: still waiting just under a day');
      eq(fx.requestAllowed({ failures: 40, lastFailureAt: now - DAY }, now, 'daily'), true,
        'but never longer than the interval — a long outage still gets its daily try');
      eq(fx.requestAllowed({ failures: 2, lastFailureAt: now + 5 * MIN }, now, 'daily'), true, 'a failure stamped in the future is not believed either');
    }

    /* ---- 2. the audit's cases: five reloads, one request ---- */
    {
      at('2026-10-06T23:30:00Z', 'Africa/Johannesburg');   // 01:30 on 7 Oct, before the provider's 00:02 UTC update
      provider = answer('Tue, 06 Oct 2026 00:02:31 +0000');
      const sast = mount();
      eq(await reloads(sast, 5), 1, '01:30 SAST, the provider still on yesterday\'s table: one request over five reloads');
      ok(sast.fxTable() && sast.fxTable().date === '2026-10-06', 'and the table it got is used');

      at('2026-10-06T23:30:00Z', 'Pacific/Auckland');       // 12:30 on 7 Oct in Auckland
      eq(await reloads(mount(), 5), 1, '12:30 NZDT, the same table: one request');

      at('2026-10-07T10:00:00Z', 'Africa/Johannesburg');
      provider = answer('Sat, 04 Oct 2026 00:02:31 +0000');
      eq(await reloads(mount(), 5), 1, 'a provider stuck three days: one request');
      provider = answer('Fri, 01 Jan 2100 00:00:00 +0000');
      eq(await reloads(mount(), 5), 1, 'a provider dated in the future: one request');
      provider = offline;
      eq(await reloads(mount(), 5), 1, 'offline: one request, then the back-off');

      provider = answer('Wed, 07 Oct 2026 00:02:31 +0000');
      eq(await reloads(mount(), 5), 1, 'unchanged: an up-to-date answer is one request, and then the table is simply not due');
    }

    /* ---- 3. a stuck provider: one request per LOCAL day ---- */
    {
      provider = answer('Sat, 04 Oct 2026 00:02:31 +0000');
      at('2026-10-07T06:00:00Z', 'Africa/Johannesburg');
      const ctx = mount();
      let n = await reloads(ctx, 3);
      at('2026-10-07T20:00:00Z', 'Africa/Johannesburg');   // 22:00 the same local day
      n += await reloads(ctx, 3);
      eq(n, 1, 'the whole of 7 October: one request');
      at('2026-10-07T22:30:00Z', 'Africa/Johannesburg');   // 00:30 on 8 October, local
      eq(await reloads(ctx, 3), 1, 'the next local day — though still the 7th in UTC — one more');
    }

    /* ---- 4. failures back off, then recover ---- */
    {
      provider = offline;
      const t0 = at('2026-10-07T08:00:00Z', 'Africa/Johannesburg');
      const ctx = mount();
      eq(await reloads(ctx, 4), 1, 'offline: the first reload asks');
      at(new RealDate(t0 + 10 * MIN).toISOString(), 'Africa/Johannesburg');
      eq(await reloads(ctx, 4), 0, 'ten minutes on, nothing');
      at(new RealDate(t0 + 15 * MIN).toISOString(), 'Africa/Johannesburg');
      eq(await reloads(ctx, 4), 1, 'fifteen: one more try');
      at(new RealDate(t0 + 40 * MIN).toISOString(), 'Africa/Johannesburg');
      eq(await reloads(ctx, 4), 0, 'twenty-five minutes after the second failure: still waiting (thirty)');
      provider = answer('Wed, 07 Oct 2026 00:02:31 +0000');
      at(new RealDate(t0 + 46 * MIN).toISOString(), 'Africa/Johannesburg');
      eq(await reloads(ctx, 4), 1, 'thirty-one: online again, one request');
      ok(ctx.fxTable() && ctx.fxTable().date === '2026-10-07', 'and the rates arrive');
    }

    /* ---- 5. the stamp in the cache holds a re-opened view to it ---- */
    {
      provider = answer('Tue, 06 Oct 2026 00:02:31 +0000');
      const now = at('2026-10-06T23:30:00Z', 'Africa/Johannesburg');
      const first = mount();
      eq(await reloads(first, 1), 1, 'sanity: the first view asks');
      const cache = first.vault._store.get('Budget/Exchange Rates.md');
      ok(typeof cache === 'string', 'and writes the cache');
      ok(/^fetched: "2026-10-06T23:30:00\.000Z"$/m.test(cache), `stamped with the instant it asked — got ${JSON.stringify((cache.match(/^fetched:.*$/m) || [''])[0])}`);
      eq(ff.parseRatesFile(cache), fx.normalizeTable({ base: 'ZAR', date: '2026-10-06', rates: { ZAR: 1, CNY: 0.39 } }),
        'the table still reads back exactly as before — the stamp is provenance beside it, not part of it');
      eq((await ff.readCache({ readFile: async () => cache })).fetchedAt, now, 'and the stamp reads back as the same instant');

      const reopened = mount({ 'Budget/Exchange Rates.md': cache });
      eq(await reloads(reopened, 5), 0, 'a view opened later the same day, over the same vault: no request — the table is due, but it was asked for today');

      at('2026-10-07T07:00:00Z', 'Africa/Johannesburg');   // 09:00 on the 7th: the stamp's own local day
      provider = answer('Wed, 07 Oct 2026 00:02:31 +0000');
      eq(await reloads(mount({ 'Budget/Exchange Rates.md': cache }), 5), 0,
        'later that same local day, though the provider has moved on: still no request — one per interval');
      at('2026-10-08T07:00:00Z', 'Africa/Johannesburg');
      eq(await reloads(mount({ 'Budget/Exchange Rates.md': cache }), 5), 1, 'the next local day it asks again');

      at('2026-10-06T23:30:00Z', 'Africa/Johannesburg');
      const future = cache.replace(/^fetched: .*$/m, 'fetched: "2100-01-01T00:00:00.000Z"');
      provider = answer('Tue, 06 Oct 2026 00:02:31 +0000');
      eq(await reloads(mount({ 'Budget/Exchange Rates.md': future }), 3), 1,
        'a stamp from the future is not believed — this device still asks once');
      const garbage = cache.replace(/^fetched: .*$/m, 'fetched: "soon"');
      eq((await ff.readCache({ readFile: async () => garbage })).fetchedAt, null, 'an unreadable stamp is no stamp');
      eq(await reloads(mount({ 'Budget/Exchange Rates.md': garbage }), 3), 1, 'and asks once, as a cache from before the stamp existed does');
    }

    /* ---- 6. switched off: nothing at all ---- */
    {
      at('2026-10-07T10:00:00Z', 'Africa/Johannesburg');
      provider = answer('Wed, 07 Oct 2026 00:02:31 +0000');
      eq(await reloads(mount({}, { exchange_rates: false, currency_code: 'ZAR' }), 5), 0, 'exchange rates off: no request, ever');
    }

    console.log(`PASS — fx-refresh-cadence: one request per refresh interval, a back-off after failures, and the gate survives a re-mount (${checks} checks).`);
  } finally {
    if (unpinNow) unpinNow();
    delete global.__requestUrl;
  }
})().catch(e => { if (unpinNow) unpinNow(); console.error(e); process.exit(1); });
