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
const { opWriterOf } = require('./io');
const { todayIso } = require('./dates');

module.exports = function registerFxLive(ctx) {
  const { S } = ctx;

  /* Held in memory for the session. Not on S: it is not vault data, it is a
     cache of something the vault happens to store a copy of, and putting it
     on S would put it in reach of every save path.

     ONE RECORD PER BOOK (ADR 0009; 2026-11-11 audit, task 4). Every book
     keeps its own Exchange Rates.md, for its own household currency. This used
     to be one table, one `loaded` flag and one set of request stamps in the
     closure, reset in a single case — rates being switched off — so a book
     switch kept the previous book's: the new book's file was never read, its
     foreign accounts were converted at the other household's rates and base
     currency, and a request it was due was held back because the other book
     had asked today. The only derived figure the audit found to survive a
     switch.

     Keyed by the folder the state in memory was read from (load.js
     loadedBook()) — the book whose accounts a view is about to convert. A
     refresh works on the record of the book it was started for and no other,
     so nothing about one book can be written into another's by any
     interleaving, and a book returned to still has what it knew: its table,
     the request it already made today, the back-off it is serving. Each field:

       table, loaded   the rates, and whether the cache file has been read
       inFlight        the refresh a same-book caller joins
       lastSuccessAt, lastFailureAt, failures
                       when this app last ASKED, for fx.requestAllowed (the
                       gate's rules are there). lastSuccessAt starts from the
                       cache file's `fetched:` stamp, so a re-opened view, a
                       restarted app or the other device sharing the vault is
                       held to the request already made; the two failure
                       fields live only here — a failed request writes no
                       file, and a back-off that outlived the session would
                       only delay the next honest try. Epoch milliseconds. */
  const byBook = new Map();
  const recordOf = folder => {
    let r = byBook.get(folder);
    if (!r) {
      r = { table: null, loaded: false, inFlight: null, lastSuccessAt: null, lastFailureAt: null, failures: 0 };
      byBook.set(folder, r);
    }
    return r;
  };
  const stateBook = () => {
    const lb = typeof ctx.loadedBook === 'function' ? ctx.loadedBook() : null;
    if (lb && typeof lb.folder === 'string') return lb.folder;
    return typeof ctx.basePath === 'function' ? ctx.basePath() : '';
  };

  const enabled = () => !!(S.settings && S.settings.exchange_rates
    && fx.normalizeCode(S.settings.currency_code));

  const cadence = () => fx.normalizeCadence(S.settings && S.settings.rate_refresh);

  const household = () => ({
    code: fx.normalizeCode(S.settings && S.settings.currency_code),
    symbol: (S.settings && S.settings.currency) || '',
  });

  /* The table of the book IN MEMORY, or null. A book whose rates have not been
     read yet has no record, so the first paint after a switch to it is the
     un-converted split — never the last book's rates over this book's
     accounts. */
  function fxTable() {
    if (!enabled()) return null;
    const r = byBook.get(stateBook());
    return r ? r.table : null;
  }

  /* Read the cache, then refresh from the network if the cached rates are
     stale (or absent). Returns whether anything CHANGED, so the caller can
     redraw only when there is something new to draw.

     Never throws and never rejects: fetchRates already degrades every failure
     to null, and a rate lookup that went wrong must cost the reader nothing
     more than the un-converted view they had a moment ago. */
  async function refreshRates() {
    const here = stateBook();
    if (!enabled()) {
      /* Off costs nothing and keeps nothing: what this book knew is forgotten.
         Its record only outlives that while a request is still out, so that
         switching rates back on before the answer arrives joins that request
         rather than sending a second one. */
      const r = byBook.get(here);
      if (r) {
        r.table = null; r.loaded = false;
        r.lastSuccessAt = null; r.lastFailureAt = null; r.failures = 0;
        if (!r.inFlight) byBook.delete(here);
      }
      return false;
    }
    const r = recordOf(here);
    /* Single-flight per book, as load.js is per folder: a refresh still out
       for the book that WAS open is not this book's answer to wait on — and
       coming back to that book while it is still out joins it rather than
       asking the provider a second time. */
    if (r.inFlight) return r.inFlight;
    /* Is the state in memory still this book's, with rates still on? Asked
       after each await: S.settings is read below for the cadence and the
       currency code, and after a switch those are another household's. */
    const still = () => stateBook() === here && enabled();
    /* The cache is read from the book the STATE was read from, pinned
       (io.js readersAt), never from whichever book is open at this instant:
       in the window between a switch and its reload those are two folders. */
    const cacheOf = typeof ctx.readersAt === 'function' ? ctx.readersAt(here) : ctx;
    const run = (async () => {
      const before = r.table && r.table.date;
      if (!r.loaded) {
        const cache = await readCache(cacheOf);
        r.table = cache.table;
        /* The stamp counts only beside a table that is usable: a cache this
           app cannot read is no evidence that asking today got anything. */
        if (r.table && cache.fetchedAt !== null && !(r.lastSuccessAt > cache.fetchedAt)) r.lastSuccessAt = cache.fetchedAt;
        r.loaded = true;
      }
      /* The book moved on while its cache was being read. What was read is
         this book's and stays in its record; nothing is asked on its behalf
         under another household's settings, and the page now on screen has
         nothing new to draw. */
      if (!still()) return false;
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
      if (fx.refreshDue(r.table, todayIso(), cadence())
        && fx.requestAllowed(r, now, cadence())) {
        /* The table is fetched for THIS book's currency code and written into
           its Exchange Rates.md after a network round trip — bound to the load
           it was asked under (io.js opWriter), so a book switched in the
           meantime does not get this book's table written over its own. A
           refused write is swallowed by fetchRates like any other. Both
           arguments are taken here, before the await: whatever is in memory
           when the answer arrives, it was asked for this book and is kept in
           this book's record. */
        const fetched = await fetchRates(opWriterOf(ctx), household().code);
        if (fetched) {
          r.table = fetched;
          r.lastSuccessAt = now; r.lastFailureAt = null; r.failures = 0;
        } else {
          /* Offline, refused, or an answer that failed validation — all one
             failure to the back-off, so a provider sending garbage cannot set
             off a request a reload either. */
          r.lastFailureAt = now; r.failures++;
        }
      }
      /* A change is something for the page ON SCREEN to redraw: an answer
         that arrived after its book left memory changes that book's record
         and nothing anyone is looking at. */
      return stateBook() === here && !!(r.table && r.table.date !== before);
    })();
    r.inFlight = run;
    try { return await run; } finally { r.inFlight = null; }
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
