'use strict';
/* Each book converts with its OWN exchange-rate table (2026-11-11 audit,
   task 4 — Low, found independently by two lanes).

   fx-live.js kept the rate table for the session in its mount closure —
   `table`, `loaded`, and the stamps that gate the next request — and reset
   them in exactly one case: exchange rates being switched off. A book switch
   reloads the state and left the closure alone, so after it:

     - `loaded` was still true: book B's own Exchange Rates.md was never read;
     - `table` was still book A's: B's foreign accounts were converted at A's
       rates, against A's base currency, under A's date;
     - the stamps were still A's: a request B was due was held back because A
       had asked today.

   A missing currency shows as "unconvertible", so this was a wrong RATE on
   screen rather than a silently wrong total — and the audit found it to be the
   only derived figure that survived a switch at all.

   The state is now one record per book. Pinned over the real io, loader and
   fx-live on one ctx, with two books whose households keep different
   currencies:

     1. after a switch and its reload, and BEFORE any refresh has run, a book
        whose rates have not been read serves no table — the first paint is
        the un-converted split, never the previous book's rates over this
        book's accounts;
     2. the refresh then reads THIS book's Exchange Rates.md, reports a change
        (so the page redraws), and makes no request while that cache is fresh;
        a book returned to serves its own table at once;
     3. the request stamps are the book's: a book whose table is due asks,
        whatever the book before it did today — and what it gets is written
        into its own folder, not the previous book's;
     4. a refresh still in flight for the book that was open cannot install its
        answer as the new book's table, nor write it there — and coming BACK
        to that book while its request is still out joins it instead of asking
        twice (the pre-merge review's A→B→A);
     5. a failed request's back-off survives a round trip through another book
        (the review's second finding): leaving and returning is not a reason
        to ask again;
     6. what a refresh learns stays with the book it was started for, in
        every window the review probed: the key written but the reload not
        yet run (the table and the cache read are the book's IN MEMORY, not
        the open folder's); an answer, or a failure, arriving after the
        switch (its stamp does not hold back the other book's request); and
        the book moving on while the cache file is still being read (no
        request is made on its behalf under the other household's settings);
     7. controls — on one book, a second refresh neither re-reads nor re-asks;
        switching rates off forgets that book's table; off and on again while
        a request is out joins it.

     node tests/fx-book-switch.test.cjs */

const assert = require('assert');
const H = require('./helpers/harness.cjs');
H.stubObsidian();
const ff = require('../src/fx-fetch');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const HOME = 'Budget', ACME = 'Clients/Acme';
const LIST = [{ folder: HOME, label: 'Home' }, { folder: ACME, label: 'Acme' }];
/* The clock is pinned, as tests/fx-refresh-cadence.test.cjs pins it: "is this
   table due" compares the table's date with today's, and a suite that read
   the real clock would ask the provider whenever it happened to run across
   midnight. Timers are untouched — only what Date says. */
const RealDate = Date;
const NOW = new RealDate('2026-10-07T10:00:00Z').getTime();
function Pinned(...a) {
  if (!(this instanceof Pinned)) return new RealDate(NOW).toString();
  return a.length ? new RealDate(...a) : new RealDate(NOW);
}
Pinned.prototype = RealDate.prototype; Pinned.now = () => NOW; Pinned.parse = RealDate.parse; Pinned.UTC = RealDate.UTC;
const HAD_TZ = 'TZ' in process.env, OLD_TZ = process.env.TZ;
process.env.TZ = 'Africa/Johannesburg';
global.Date = Pinned;
const unpin = () => { global.Date = RealDate; if (HAD_TZ) process.env.TZ = OLD_TZ; else delete process.env.TZ; };
const TODAY = '2026-10-07';
const RATES = (base, rates) => ff.serializeRates({ base, date: TODAY, rates }, Date.now());
const HOME_RATES = { ZAR: 1, USD: 0.055, EUR: 0.05 };
const ACME_RATES = { USD: 1, ZAR: 18, EUR: 0.9 };

const settings = (symbol, code) => `---\nmonth_start_day: 1\ncurrency: "${symbol}"\ncurrency_code: ${code}\nexchange_rates: on\n---\n`;
const FILES = ({ homeRates = true, acmeRates = true } = {}) => ({
  [`${HOME}/Settings.md`]: settings('R', 'ZAR'),
  [`${HOME}/Categories/Food.md`]: '---\ntype: expense\n---\n',
  [`${HOME}/Accounts/Euro wallet.md`]: '---\ntype: cash\ncurrency: "€"\ncurrency_code: EUR\nbalance: 100.00\n---\n',
  ...(homeRates ? { [`${HOME}/Exchange Rates.md`]: RATES('ZAR', HOME_RATES) } : {}),
  [`${ACME}/Settings.md`]: settings('$', 'USD'),
  [`${ACME}/Categories/Software.md`]: '---\ntype: expense\n---\n',
  [`${ACME}/Accounts/Euro float.md`]: '---\ntype: cash\ncurrency: "€"\ncurrency_code: EUR\nbalance: 100.00\n---\n',
  ...(acmeRates ? { [`${ACME}/Exchange Rates.md`]: RATES('USD', ACME_RATES) } : {}),
});

/* One device on a vault with two books: the real io, period, loader and notes
   (harness loadInto), then fx-live, as controller.js mounts them. `go(folder)`
   is a switch as the app performs it — the per-device key, then the reload —
   and deliberately NOT the refresh that follows, so a test can look at the
   paint in between. */
async function device(files) {
  const ctx = H.makeCtx(files, { budgetFolder: HOME });
  const store = {};
  ctx.plugin.app = { vault: ctx.vault, loadLocalStorage: k => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { if (v === null) delete store[k]; else store[k] = v; } };
  ctx.plugin.settings.books = LIST.map(b => ({ ...b }));
  await H.loadInto(ctx);
  require('../src/fx-live')(ctx);
  /* A macrotask passes first, as it always does in the app (a switch is a tap,
     and the reload after it is real I/O): io.js treats writes inside ONE
     macrotask burst as one operation and refuses the rest of a burst that
     began under another book, which an in-memory vault would otherwise trip. */
  const go = async folder => {
    await new Promise(r => setTimeout(r, 0));
    ctx.plugin.setOpenBookLocal(folder === HOME ? null : folder);
    await ctx.loadVault();
  };
  return { ctx, go, text: p => ctx.vault._store.get(p) };
}

/* The network. Counted, and answered per base currency: the URL's last
   segment is the code asked for, which is the whole of what is sent. */
let sent = [];
let answers = {};
global.__requestUrl = async ({ url }) => {
  const base = decodeURIComponent(String(url).split('/').pop());
  sent.push(base);
  const a = answers[base];
  if (!a) throw new Error('net::ERR_INTERNET_DISCONNECTED');
  return a();
};
const stampFor = () => new Date(`${TODAY}T00:02:31Z`).toUTCString();
const answer = (base, rates) => async () => ({ status: 200, json: { result: 'success', base_code: base, time_last_update_utc: stampFor(), rates } });

(async () => {
  /* ---- 1 + 2. the table follows the book ---- */
  {
    sent = []; answers = {};
    const d = await device(FILES());
    eq(await d.ctx.refreshRates(), true, 'the home book reads its cached rates');
    eq(d.ctx.fxTable().base, 'ZAR', '…a ZAR table');
    eq(d.ctx.fxTable().rates.EUR, 0.05, '…with the household\'s own EUR rate');

    await d.go(ACME);
    eq(d.ctx.S.settings.currency_code, 'USD', 'the client\'s book is in memory');
    eq(d.ctx.fxTable(), null, 'T4: before the client\'s rates are read, NO table is served — not the household\'s');
    eq(d.ctx.fxConvert(d.ctx.S.accounts), null, 'T4: so the first paint is the un-converted split, not EUR at the household\'s rate');

    eq(await d.ctx.refreshRates(), true, 'T4: the refresh reports a change, so the page redraws');
    eq(d.ctx.fxTable().base, 'USD', 'T4: and the table is the client\'s own — read from ITS Exchange Rates.md');
    eq(d.ctx.fxTable().rates.EUR, 0.9, 'T4: with the client\'s EUR rate');
    const conv = d.ctx.fxConvert(d.ctx.S.accounts);
    ok(conv, 'the client\'s accounts convert');

    await d.go(HOME);
    eq([d.ctx.fxTable().base, d.ctx.fxTable().rates.EUR], ['ZAR', 0.05],
      'T4: switching back, the household\'s OWN table is served at once — it was never the client\'s to replace');
    eq(await d.ctx.refreshRates(), false, 'and there is nothing new to draw');
    await d.go(ACME);
    eq([d.ctx.fxTable().base, d.ctx.fxTable().rates.EUR], ['USD', 0.9], 'T4: and the client\'s, its own');
    eq(sent, [], 'both caches were fresh: no request at any point');
  }

  /* ---- 3. the request stamps are the book's ---- */
  {
    sent = []; answers = { ZAR: answer('ZAR', HOME_RATES), USD: answer('USD', ACME_RATES) };
    const d = await device(FILES({ homeRates: false, acmeRates: false }));
    await d.ctx.refreshRates();
    eq(sent, ['ZAR'], 'the household, with no cache, asks once');
    ok(/base: "ZAR"/.test(d.text(`${HOME}/Exchange Rates.md`)), '…and keeps the answer in its own folder');

    await d.go(ACME);
    await d.ctx.refreshRates();
    eq(sent, ['ZAR', 'USD'], 'T4: the client, with no cache of its own, asks too — the household having asked today is not ITS answer');
    eq(d.ctx.fxTable().base, 'USD', 'T4: and converts with what it got');
    ok(/base: "USD"/.test(d.text(`${ACME}/Exchange Rates.md`)), 'T4: written into the client\'s folder');
    ok(/base: "ZAR"/.test(d.text(`${HOME}/Exchange Rates.md`)), 'T4: the household\'s cache is not overwritten with it');

    await d.go(HOME);
    await d.ctx.refreshRates();
    await d.go(ACME);
    await d.ctx.refreshRates();
    eq(sent, ['ZAR', 'USD'], 'back and forth: each book reads the cache its own request left — one lookup per interval per book');
  }

  /* ---- 4. a refresh in flight across the switch ---- */
  {
    sent = [];
    let releaseZar;
    const held = new Promise(r => { releaseZar = r; });
    answers = {
      ZAR: async () => { await held; return answer('ZAR', HOME_RATES)(); },
      USD: answer('USD', ACME_RATES),
    };
    const d = await device(FILES({ homeRates: false, acmeRates: false }));
    const forHome = d.ctx.refreshRates();                 // asks for ZAR; the answer has not arrived
    await new Promise(r => setTimeout(r, 5));
    eq(sent, ['ZAR'], 'the household\'s request is out');
    await d.go(ACME);
    eq(await d.ctx.refreshRates(), true, 'T4: the client\'s refresh is its own — it does not join the household\'s');
    eq(d.ctx.fxTable().base, 'USD', 'the client has its table');
    releaseZar();
    eq(await forHome, false, 'T4: the household\'s late answer reports no change for the page now on screen');
    eq(d.ctx.fxTable().base, 'USD', 'T4: and does not replace the client\'s table');
    ok(/base: "USD"/.test(d.text(`${ACME}/Exchange Rates.md`)), 'T4: nor the client\'s cache file');
    ok(!/base: "ZAR"/.test(d.text(`${ACME}/Exchange Rates.md`) || ''), 'T4: (no ZAR table anywhere in the client\'s folder)');
    await d.go(HOME);
    eq(d.ctx.fxTable() && d.ctx.fxTable().base, 'ZAR', 'the answer it did get was the household\'s, and is there when the household is opened again');
    await d.ctx.refreshRates();
    eq(sent, ['ZAR', 'USD'], '…with no second request for it');
  }
  {
    /* A → B → A while A's request is still out: one request, joined. */
    sent = [];
    let releaseZar;
    const held = new Promise(r => { releaseZar = r; });
    answers = {
      ZAR: async () => { await held; return answer('ZAR', HOME_RATES)(); },
      USD: answer('USD', ACME_RATES),
    };
    const d = await device(FILES({ homeRates: false, acmeRates: false }));
    const first = d.ctx.refreshRates();
    await new Promise(r => setTimeout(r, 5));
    await d.go(ACME);
    await d.ctx.refreshRates();
    await d.go(HOME);
    const again = d.ctx.refreshRates();                  // back on the household, its request still out
    await new Promise(r => setTimeout(r, 5));
    eq(sent, ['ZAR', 'USD'], 'T4: returning to a book whose request is still out does not ask the provider a second time');
    releaseZar();
    await Promise.all([first, again]);
    eq(sent, ['ZAR', 'USD'], 'T4: one request per book, however the switches fall');
    eq(d.ctx.fxTable().base, 'ZAR', 'and the household converts with the answer');
  }

  /* ---- 5. a back-off is the book's, and survives a round trip ---- */
  {
    sent = []; answers = { USD: answer('USD', ACME_RATES) };       // ZAR: offline
    const d = await device(FILES({ homeRates: false, acmeRates: false }));
    await d.ctx.refreshRates();
    await d.ctx.refreshRates();
    eq(sent, ['ZAR'], 'offline: the household asks once, then backs off');
    await d.go(ACME);
    await d.ctx.refreshRates();
    eq(sent, ['ZAR', 'USD'], 'the client\'s own first request is not held back by it');
    await d.go(HOME);
    await d.ctx.refreshRates();
    await d.go(ACME);
    await d.ctx.refreshRates();
    await d.go(HOME);
    await d.ctx.refreshRates();
    eq(sent, ['ZAR', 'USD'], 'T4: leaving a book and coming back is not a reason to ask again — the back-off it was serving still holds');
    eq(d.ctx.fxTable(), null, 'and with no table, the household is simply not converted');
  }

  /* ---- 6. what a refresh learns stays with its own book ---- */
  {
    /* The per-device key is written and the reload has NOT run: the state in
       memory is still the household's, so the household's table is the one
       served, and a refresh in that window reads the household's cache file —
       not the folder that happens to be open. */
    sent = []; answers = {};
    const d = await device(FILES());
    d.ctx.plugin.setOpenBookLocal(ACME);
    eq(d.ctx.basePath(), ACME, 'the open folder has moved');
    eq(d.ctx.loadedBook().folder, HOME, '…the state in memory has not');
    eq(await d.ctx.refreshRates(), true, 'a refresh in that window');
    eq(d.ctx.fxTable().base, 'ZAR', 'T4: reads the cache of the book IN MEMORY, and serves it for that book\'s accounts');
    await d.ctx.loadVault();
    eq(d.ctx.fxTable(), null, 'T4: once the client\'s state commits, the household\'s table is no longer served');
    await d.ctx.refreshRates();
    eq(d.ctx.fxTable().base, 'USD', 'and the client reads its own');
  }
  for (const [what, zar] of [['an answer', () => answer('ZAR', HOME_RATES)()], ['a failure', () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); }]]) {
    /* The household's request is out; the book is switched; THEN the provider
       answers (or fails). Whatever that teaches is the household's — it must
       not count as the client having asked. */
    sent = [];
    let release;
    const held = new Promise(r => { release = r; });
    answers = { ZAR: async () => { await held; return zar(); }, USD: answer('USD', ACME_RATES) };
    const d = await device(FILES({ homeRates: false, acmeRates: false }));
    const forHome = d.ctx.refreshRates();
    await new Promise(r => setTimeout(r, 5));
    await d.go(ACME);
    release();
    eq(await forHome, false, `${what} for the household arrives after the switch: nothing for the page on screen`);
    eq(d.ctx.fxTable(), null, `T4: ${what} for the household is not the client's table`);
    await d.ctx.refreshRates();
    eq(sent, ['ZAR', 'USD'], `T4: and ${what} for the household does not hold back the client's own request`);
    eq(d.ctx.fxTable().base, 'USD', 'the client converts with its own answer');
  }
  {
    /* The book moves on while its cache file is still being read. A request
       made now would be sent under the client's currency code and cadence —
       and filed as the household's. None is made. */
    sent = []; answers = { ZAR: answer('ZAR', HOME_RATES), USD: answer('USD', ACME_RATES) };
    const stale = ff.serializeRates({ base: 'ZAR', date: '2026-01-01', rates: HOME_RATES });   // due: a request would follow
    const d = await device({ ...FILES({ homeRates: false }), [`${HOME}/Exchange Rates.md`]: stale });
    let release, reached;
    const gate = new Promise(r => { release = r; });
    const reading = new Promise(r => { reached = r; });
    const real = d.ctx.vault.cachedRead.bind(d.ctx.vault);
    let parked = false;
    d.ctx.vault.cachedRead = async f => {
      const t = await real(f);
      if (f.path === `${HOME}/Exchange Rates.md` && !parked) { parked = true; reached(); await gate; }
      return t;
    };
    const forHome = d.ctx.refreshRates();
    await reading;
    await d.go(ACME);
    release();
    eq(await forHome, false, 'the household\'s refresh outlived its book');
    eq(sent, [], 'T4: and asks nothing on its behalf once another household\'s settings are in memory');
    await d.ctx.refreshRates();
    eq(d.ctx.fxTable().base, 'USD', 'the client, whose cache is fresh, converts from it');
    eq(sent, [], '…with no request of its own either');
    await d.go(HOME);
    await d.ctx.refreshRates();
    eq(sent, ['ZAR'], 'T4: back on the household, its due request is made — for ZAR');
    eq(d.ctx.fxTable().base, 'ZAR', 'and it converts with a ZAR table');
  }

  /* ---- 7. controls: one book ---- */
  {
    sent = []; answers = {};
    const d = await device(FILES());
    let reads = 0;
    const real = d.ctx.vault.cachedRead.bind(d.ctx.vault);
    d.ctx.vault.cachedRead = async f => { if (f.path === `${HOME}/Exchange Rates.md`) reads++; return real(f); };
    eq(await d.ctx.refreshRates(), true, 'first refresh: the cache is read');
    eq(await d.ctx.refreshRates(), false, 'second: nothing changed');
    await d.ctx.loadVault();                               // a same-book reload
    eq(await d.ctx.refreshRates(), false, 'a same-book reload is not a switch — the table stands');
    eq(d.ctx.fxTable().base, 'ZAR', 'and is still served');
    eq(reads, 1, 'the cache file is read once per session, as before');
    eq(sent, [], 'and no request is made');

    d.ctx.S.settings.exchange_rates = false;               // switched off in Settings
    eq(d.ctx.fxTable(), null, 'rates off: no table');
    eq(await d.ctx.refreshRates(), false, 'and the refresh does nothing');
    d.ctx.S.settings.exchange_rates = true;
    eq(d.ctx.fxTable(), null, 'switched back on: nothing is remembered from before');
    eq(await d.ctx.refreshRates(), true, 'the cache is read afresh');
    eq(reads, 2, '…from the file');
  }
  {
    /* Off and on again while a request is out: one request, joined. */
    sent = [];
    let release;
    const held = new Promise(r => { release = r; });
    answers = { ZAR: async () => { await held; return answer('ZAR', HOME_RATES)(); } };
    const d = await device(FILES({ homeRates: false }));
    const first = d.ctx.refreshRates();
    await new Promise(r => setTimeout(r, 5));
    d.ctx.S.settings.exchange_rates = false;
    eq(await d.ctx.refreshRates(), false, 'rates switched off mid-request');
    d.ctx.S.settings.exchange_rates = true;
    const again = d.ctx.refreshRates();
    await new Promise(r => setTimeout(r, 5));
    eq(sent, ['ZAR'], 'T4: switched back on before the answer arrived: the request already out is joined, not repeated');
    release();
    await Promise.all([first, again]);
    eq(sent, ['ZAR'], 'one request in all');
    eq(d.ctx.fxTable().base, 'ZAR', 'and its answer is used');
  }

  delete global.__requestUrl;
  unpin();
  console.log(`PASS fx-book-switch (${checks} checks)`);
})().catch(e => { unpin(); console.error(e); process.exit(1); });
