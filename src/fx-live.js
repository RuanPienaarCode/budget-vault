'use strict';
/* The live rate table, on ctx — the one bridge between the pure engine
   (src/fx.js), the network call (src/fx-fetch.js) and the views.

   Everything here is arranged so that the OFF state costs nothing and reaches
   nothing. `exchange_rates` is off by default and off in every vault written
   before it existed, and while it is off this module never reads a file,
   never touches the network, and every figure in the app behaves exactly as
   it did before conversion existed.

   Switched on, the contract the views rely on is:

     fxTable()   the current table or null, SYNCHRONOUSLY — a render never
                 waits on a network call, because a page that blocked on a
                 rate lookup would be a page that goes blank when the wifi
                 does. First render after load shows the un-converted split;
                 refreshRates() then fills the cache and asks for a redraw.
     fxState()   { on, table, stale, date, age } — everything a view needs to
                 decide what to print AND what to say about it, in one call,
                 so no view can print a converted figure while forgetting its
                 provenance. */

const fx = require('./fx');
const { fetchRates, readCachedRates } = require('./fx-fetch');
const { todayIso } = require('./dates');

module.exports = function registerFxLive(ctx) {
  const { S } = ctx;

  /* Held in memory for the session. Not on S: it is not vault data, it is a
     cache of something the vault happens to store a copy of, and putting it
     on S would put it in reach of every save path. */
  let table = null;
  let loaded = false;
  let inFlight = null;

  const enabled = () => !!(S.settings && S.settings.exchange_rates
    && fx.normalizeCode(S.settings.currency_code));

  const household = () => ({
    code: fx.normalizeCode(S.settings && S.settings.currency_code),
    symbol: (S.settings && S.settings.currency) || '',
  });

  function fxTable() { return enabled() ? table : null; }

  function fxState() {
    const t = fxTable();
    const { age, stale } = fx.stalenessOf(t, todayIso());
    return { on: !!t, table: t, stale, age, date: (t && t.date) || '' };
  }

  /* Read the cache, then refresh from the network if the cached rates are
     stale (or absent). Returns whether anything CHANGED, so the caller can
     redraw only when there is something new to draw.

     Never throws and never rejects: fetchRates already degrades every failure
     to null, and a rate lookup that went wrong must cost the reader nothing
     more than the un-converted view they had a moment ago. */
  async function refreshRates() {
    if (!enabled()) { table = null; loaded = false; return false; }
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const before = table && table.date;
      if (!loaded) { table = await readCachedRates(ctx); loaded = true; }
      const { stale } = fx.stalenessOf(table, todayIso());
      /* Only when the cache cannot answer. A fresh cached table means no
         request at all — the promise is one lookup a day, not one a render. */
      if (stale) {
        const fetched = await fetchRates(ctx, household().code);
        if (fetched) table = fetched;
      }
      return !!(table && table.date !== before);
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }

  /* The whole answer for a set of accounts, or null when conversion is off or
     cannot run. null is the signal to fall back to the un-converted split —
     which is the behaviour this feature is opt-in ON TOP OF, so a view's
     no-conversion path is its normal path and stays exercised. */
  function fxConvert(accounts) {
    const t = fxTable();
    if (!fx.canConvert(S.settings, t)) return null;
    return fx.convertAccounts(accounts, household(), t, todayIso());
  }

  ctx.provide({ fxTable, fxState, refreshRates, fxConvert });
};
