'use strict';
/* The one place this plugin touches the network.

   Until this file existed, the README's claim was unqualified: "The plugin
   makes zero network requests, so your financial history can't be uploaded,
   analysed or sold." Two of those three clauses are still true without
   qualification and must stay that way, which is what shapes everything below:

     - NOTHING ABOUT THE VAULT IS SENT. The request is a GET to a public
       endpoint whose entire payload is a three-letter currency code. No
       balances, no account names, no vault id, no telemetry, no headers we
       add. The provider learns that somebody, somewhere, wants rupiah rates.
     - IT ONLY RUNS WHEN ASKED. `exchange_rates: no` is the default, and no
       code path reaches this file until a reader turns it on — in the wizard,
       which asks outright, or in Settings.
     - NO API KEY. Deliberate: a community plugin cannot ship a secret, and a
       key-holding provider would tie every user's rate lookups to one
       identity. open.er-api.com is keyless, covers 166 currencies (the ones
       this app's readers actually hold — IDR, CNY, ZAR, EUR, USD), and
       publishes the date its rates are for, which is the field this whole
       feature is built around.

   The result is written to a plain markdown file in the budget folder, like
   everything else this app stores. It is a cache, but it is a READABLE cache:
   the reader can open it, see the rates and the date, and hand-edit or delete
   it. A binary blob in plugin data would have been less code and more of the
   thing this app exists not to be.

   requestUrl, not fetch: Obsidian's own client works on mobile and is not
   subject to the CORS rules a bare fetch inside the app shell is. */

const { requestUrl } = require('obsidian');
const { normalizeTable, normalizeCode } = require('./fx');
const { yamlStr } = require('./markdown');

/* Where the cache lives, budget-folder-relative — io.readFile/writeFile are
   rooted there (see io.js's own header on its two root conventions). */
const RATES_FILE = 'Exchange Rates.md';

const PROVIDER_NAME = 'exchangerate-api.com';
const PROVIDER_TERMS = 'https://www.exchangerate-api.com/terms';
const endpointFor = base => `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;

/* The provider's payload, reduced to the three fields this app trusts.

   Its `time_last_update_utc` is an RFC-1123 string ("Sat, 29 Aug 2026
   00:02:31 +0000"). Parsed to an ISO DATE in UTC rather than kept as-is,
   because every date in this app is an ISO day and a second format would
   drift the moment something compared them. If the provider's date cannot be
   read, the response is refused whole — an undated rate table is precisely
   what src/currency.js refused to store, and a fetch that quietly stamped
   "today" on undated rates would be forging the provenance this feature
   promises. */
function parseProviderPayload(json) {
  if (!json || json.result !== 'success') return null;
  const stamp = Date.parse(String(json.time_last_update_utc || ''));
  if (!Number.isFinite(stamp)) return null;
  return normalizeTable({
    base: json.base_code,
    date: new Date(stamp).toISOString().slice(0, 10),
    rates: json.rates,
  });
}

/* The cache file, as markdown. Frontmatter for the provenance a machine reads
   back; a table underneath for the human who opens it wondering where a number
   on their Accounts page came from. Both are generated together so they can
   never disagree — the file is rewritten whole on every refresh, never
   patched. */
function serializeRates(table) {
  const codes = Object.keys(table.rates).sort();
  const rows = codes.map(c => `| ${c} | ${table.rates[c]} |`).join('\n');
  return `---
base: ${yamlStr(table.base)}
date: ${yamlStr(table.date)}
source: ${yamlStr(PROVIDER_NAME)}
---

# Exchange rates

Fetched from [${PROVIDER_NAME}](${PROVIDER_TERMS}). These are the rates the
Budget plugin uses to convert foreign-currency accounts into ${table.base}.
They are for **${table.date}** — every converted figure in the app is printed
with that date beside it, so an old rate can never pass as a current one.

This file is a cache. Delete it and the app stops converting and goes back to
listing each currency separately; it will be fetched again on the next refresh
if exchange rates are switched on in Settings.

One ${table.base} buys:

| Currency | Rate |
|---|---:|
${rows}
`;
}

/* Read the cache back. Deliberately parses the FRONTMATTER and the TABLE, not
   one or the other: the table is what a person edits when they want to pin a
   rate by hand, and a reader who corrects a number in the table and finds the
   app ignoring it would rightly conclude the file is decoration. */
function parseRatesFile(text) {
  if (!text) return null;
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!fm) return null;
  const field = name => {
    const m = new RegExp(`^${name}:\\s*"?([^"\\n]*)"?\\s*$`, 'm').exec(fm[1]);
    return m ? m[1].trim() : '';
  };
  const rates = {};
  /* Rows after the header separator. The `---|---:` line and the header row
     both fail normalizeCode's three-letter test, so they need no special case
     — they simply contribute nothing. */
  for (const line of text.split('\n')) {
    const m = /^\|\s*([A-Za-z]{3})\s*\|\s*([0-9.eE+-]+)\s*\|$/.exec(line.trim());
    if (m) rates[m[1]] = Number(m[2]);
  }
  return normalizeTable({ base: field('base'), date: field('date'), rates });
}

/* Fetch, validate, write, return. Returns null on ANY failure — no network, a
   provider outage, a malformed payload — and never throws at the caller. A
   null here means the app keeps whatever cached table it already had, and if
   it had none it simply does not convert. Losing rates must degrade to the
   un-converted split that predates this feature, never to a blank page or a
   figure built on a half-read response. */
async function fetchRates(io, baseCode) {
  const base = normalizeCode(baseCode);
  if (!base) return null;
  let json = null;
  try {
    const res = await requestUrl({ url: endpointFor(base), method: 'GET' });
    json = res && res.json;
  } catch (e) {
    return null;
  }
  const table = parseProviderPayload(json);
  if (!table) return null;
  try {
    await io.writeFile(RATES_FILE, serializeRates(table));
  } catch (e) {
    /* The rates are good even if the write failed — a read-only vault or a
       sync conflict should not cost the reader this session's conversion. */
  }
  return table;
}

async function readCachedRates(io) {
  try {
    return parseRatesFile(await io.readFile(RATES_FILE));
  } catch (e) {
    return null;
  }
}

module.exports = {
  RATES_FILE, PROVIDER_NAME, PROVIDER_TERMS, endpointFor,
  parseProviderPayload, serializeRates, parseRatesFile, fetchRates, readCachedRates,
};
