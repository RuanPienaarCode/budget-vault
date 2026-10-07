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
     fxConvert() bundles the provenance a view needs to print alongside a
                 converted figure ({ stale, date, age, ... }) into the same
                 call that does the conversion, so no view can print one
                 without the other. */

const fx = require('./fx');
const { fetchRates, readCache } = require('./fx-fetch');
const { todayIso } = require('./dates');

module.exports = function registerFxLive(ctx) {
  const { S } = ctx;

  /* Held in memory for the session. Not on S: it is not vault data, it is a
     cache of something the vault happens to store a copy of, and putting it
     on S would put it in reach of every save path. */
  let table = null;
  let loaded = false;
  let inFlight = null;

  /* When this app last ASKED, for fx.requestAllowed (the gate's rules are
     there). lastSuccessAt starts from the cache file's `fetched:` stamp, so a
     re-opened view, a restarted app or the other device sharing the vault is
     held to the request already made; the two failure fields live only here —
     a failed request writes no file, and a back-off that outlived the session
     would only delay the next honest try. Epoch milliseconds. */
  let lastSuccessAt = null;
  let lastFailureAt = null;
  let failures = 0;

  const enabled = () => !!(S.settings && S.settings.exchange_rates
    && fx.normalizeCode(S.settings.currency_code));

  const cadence = () => fx.normalizeCadence(S.settings && S.settings.rate_refresh);

  const household = () => ({
    code: fx.normalizeCode(S.settings && S.settings.currency_code),
    symbol: (S.settings && S.settings.currency) || '',
  });

  function fxTable() { return enabled() ? table : null; }

  /* Read the cache, then refresh from the network if the cached rates are
     stale (or absent). Returns whether anything CHANGED, so the caller can
     redraw only when there is something new to draw.

     Never throws and never rejects: fetchRates already degrades every failure
     to null, and a rate lookup that went wrong must cost the reader nothing
     more than the un-converted view they had a moment ago. */
  async function refreshRates() {
    if (!enabled()) {
      table = null; loaded = false;
      lastSuccessAt = null; lastFailureAt = null; failures = 0;
      return false;
    }
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const before = table && table.date;
      if (!loaded) {
        const cache = await readCache(ctx);
        table = cache.table;
        /* The stamp counts only beside a table that is usable: a cache this
           app cannot read is no evidence that asking today got anything. */
        if (table && cache.fetchedAt !== null && !(lastSuccessAt > cache.fetchedAt)) lastSuccessAt = cache.fetchedAt;
        loaded = true;
      }
      /* Only when the cache cannot answer AT THIS VAULT'S CADENCE. A cached
         table younger than that means no request at all — the promise is one
         lookup per interval, not one a render.

         Note this is fx.refreshDue, NOT fx.stalenessOf: the age that earns a
         "this rate is old" badge and the age that earns a network request are
         two different questions, and sharing one constant for both is the bug
         this replaces — the refresh fired at exactly the age the badge would
         have appeared, so online readers effectively never saw it.

         And refreshDue alone was not that promise. It compares the
         PROVIDER'S date with today's, so whenever the answer that just
         arrived is itself due — east of Greenwich before the provider's
         daily update, a provider stuck or dated in the future, or no
         network — every reload asked again: 5 requests over 5 reloads in the
         2026-10-07 audit, since controller.js runs this after every reload.
         fx.requestAllowed is the half that remembers asking. */
      const now = Date.now();
      if (fx.refreshDue(table, todayIso(), cadence())
        && fx.requestAllowed({ lastSuccessAt, lastFailureAt, failures }, now, cadence())) {
        const fetched = await fetchRates(ctx, household().code);
        if (fetched) {
          table = fetched;
          lastSuccessAt = now; lastFailureAt = null; failures = 0;
        } else {
          /* Offline, refused, or an answer that failed validation — all one
             failure to the back-off, so a provider sending garbage cannot set
             off a request a reload either. */
          lastFailureAt = now; failures++;
        }
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

  ctx.provide({ fxTable, refreshRates, fxConvert });
};
