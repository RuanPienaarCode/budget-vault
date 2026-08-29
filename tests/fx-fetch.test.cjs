'use strict';
/* src/fx-fetch.js — the plugin's only network call, and the readable cache it
   writes.

   The README's promise is "The plugin makes zero network requests". This
   feature qualifies that sentence, so these assertions are as much about what
   is NOT sent and NOT assumed as about parsing:

     - the request carries a currency code and nothing else — no balances, no
       account names, no vault identity, no headers of ours;
     - a provider response with no readable date is REFUSED, rather than
       stamped with today's date, which would forge exactly the provenance
       this feature exists to provide;
     - every failure path returns null, so losing rates degrades to the
       un-converted behaviour that predates the feature rather than to a wrong
       figure or a thrown error;
     - the cache file round-trips, INCLUDING a rate a human corrected by hand
       in the markdown table.

     node tests/fx-fetch.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const ff = require('../src/fx-fetch');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* A real response shape from open.er-api.com, trimmed. */
const PAYLOAD = {
  result: 'success',
  base_code: 'IDR',
  time_last_update_utc: 'Sat, 29 Aug 2026 00:02:31 +0000',
  rates: { IDR: 1, CNY: 0.000379, ZAR: 0.000908 },
};

/* ---------------------------- the endpoint ------------------------------- */
{
  const url = ff.endpointFor('IDR');
  ok(url.startsWith('https://'), 'the rate endpoint is https');
  ok(/\/IDR$/.test(url), 'and its entire payload is the currency code');
  ok(!/balance|account|vault|token|key|uid/i.test(url),
    'nothing about the vault appears in the request — this is the sentence in the README that has to stay true');
}

/* ------------------------- parseProviderPayload -------------------------- */
{
  const t = ff.parseProviderPayload(PAYLOAD);
  ok(t, 'a good payload parses');
  eq(t.base, 'IDR', 'base code carried through');
  eq(t.date, '2026-08-29', "the provider's RFC-1123 stamp becomes an ISO day, so it can be compared with every other date in this app");
  eq(t.rates.CNY, 0.000379, 'and the rates survive intact');

  eq(ff.parseProviderPayload({ ...PAYLOAD, result: 'error' }), null, 'a failed result is null');
  eq(ff.parseProviderPayload({ ...PAYLOAD, time_last_update_utc: '' }), null,
    'a payload with NO readable date is refused whole — stamping today onto undated rates would forge the provenance this whole feature is built on');
  eq(ff.parseProviderPayload({ ...PAYLOAD, rates: null }), null, 'and one with no rates has nothing to offer');
  eq(ff.parseProviderPayload(undefined), null, 'no payload at all is null, not a throw');
}

/* --------------------- the cache file round-trips ------------------------ */
{
  const t = ff.parseProviderPayload(PAYLOAD);
  const md = ff.serializeRates(t);

  ok(md.startsWith('---\n'), 'the cache is a normal markdown note with frontmatter');
  ok(md.includes('2026-08-29'), 'that states the date its rates are for');
  ok(md.includes(ff.PROVIDER_NAME), 'and names where they came from, so the reader can check');
  ok(/\| CNY \|/.test(md), 'with a table a person can actually read');
  ok(/Delete it/.test(md), 'and it says what happens if you delete it — a cache the reader cannot reason about is a black box in their own vault');

  const back = ff.parseRatesFile(md);
  eq(back, t, 'and it reads back byte-for-byte equal to what was written');
}

/* -------------------- a hand-corrected rate is honoured ------------------ */
{
  const md = ff.serializeRates(ff.parseProviderPayload(PAYLOAD));
  const edited = md.replace('| CNY | 0.000379 |', '| CNY | 0.0004 |');
  ok(edited !== md, 'fixture sanity: the table row was actually rewritten');
  const back = ff.parseRatesFile(edited);
  eq(back.rates.CNY, 0.0004,
    'a rate a person corrected by hand in the table is the rate the app uses — a file the reader can edit but which is silently ignored is decoration, not a plain-files app');
}

/* ------------------------------ bad cache -------------------------------- */
{
  eq(ff.parseRatesFile(''), null, 'an empty cache file is null');
  eq(ff.parseRatesFile('no frontmatter here'), null, 'so is one with no frontmatter');
  eq(ff.parseRatesFile('---\nbase: "IDR"\n---\n\n| CNY | 0.1 |'), null,
    'and one with no DATE — the same refusal the provider payload gets, because a hand-edited file is no more trustworthy than a response');
}

/* --------------------------- fetchRates failure paths -------------------- */
(async () => {
  const io = {
    written: null,
    async writeFile(rel, body) { this.written = { rel, body }; },
    async readFile() { return null; },
  };

  // No network at all.
  global.__requestUrl = () => { throw new Error('offline'); };
  eq(await ff.fetchRates(io, 'IDR'), null, 'a dead network returns null rather than throwing at the caller');
  eq(io.written, null, 'and writes nothing, so a good cache is never clobbered by a failed refresh');

  // A provider outage that still returns 200 with a body we cannot use.
  global.__requestUrl = async () => ({ json: { result: 'error', 'error-type': 'unsupported-code' } });
  eq(await ff.fetchRates(io, 'IDR'), null, 'a provider error is null');
  eq(io.written, null, 'and still writes nothing');

  // The happy path.
  global.__requestUrl = async req => {
    ok(/open\.er-api\.com/.test(req.url), 'the request goes where this file says it does');
    eq(req.method, 'GET', 'and it is a GET — nothing is ever sent up');
    ok(!req.body, 'with no body');
    return { json: PAYLOAD };
  };
  const t = await ff.fetchRates(io, 'IDR');
  ok(t && t.rates.CNY === 0.000379, 'a good response becomes a table');
  ok(io.written && io.written.rel === ff.RATES_FILE, 'and is cached in the budget folder as a readable note');

  // A read-only vault must not cost the reader this session's rates.
  const brokenIo = { async writeFile() { throw new Error('read-only vault'); }, async readFile() { return null; } };
  const t2 = await ff.fetchRates(brokenIo, 'IDR');
  ok(t2 && t2.rates.CNY === 0.000379,
    'a failed CACHE WRITE still returns the rates — the fetch succeeded, and a sync conflict should not cost the reader their conversion');

  eq(await ff.fetchRates(io, 'not a code'), null, 'an unusable base code never reaches the network at all');

  delete global.__requestUrl;
  console.log(`PASS — fx fetch: one keyless GET, a readable cache, and every failure degrading to no-conversion (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
