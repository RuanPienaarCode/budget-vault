'use strict';
/* The exchange-rate provider is named where the reader decides (2026-10-14
   audit, L7-01 = L4b-05).

   Obsidian's developer policies ask a plugin's README to say which remote
   services it uses and why. The README disclosed that an opt-in fetch exists
   and what it sends, but never named the host — and the provider (the free
   open.er-api.com endpoint, run by ExchangeRate-API) asks for the attribution
   "Rates By Exchange Rate API" linking to its site. The saved rates note
   already credited the provider; the README, the Exchange rates setting and the
   wizard's rates step did not.

   Pinned:
     1. README names the host and the provider, says what is sent (a three-letter
        currency code, plus the IP address any request reveals), why, and carries
        the attribution link;
     2. the host the README names is the host fx-fetch.js really calls;
     3. both settings paths (display() and getSettingDefinitions()) carry the
        attribution row, built with the DOM helpers (no innerHTML) and opened
        the way the tab opens its other external links (window.open);
     4. the wizard's rates step carries it too, OUTSIDE the radio cards (a link
        inside a <label> would also select the card);
     5. the two descriptions that explain the fetch name the provider in every
        language instead of "a public exchange-rate service".

     node tests/exchange-rate-provider-disclosed.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readme = read('README.md');
const fxFetch = read('src/fx-fetch.js');
const tab = read('src/settings-tab.js');
const wizard = read('src/onboarding.js');

/* ---- 1. README ---- */
ok(/open\.er-api\.com/.test(readme), 'README names the host the fetch calls (open.er-api.com)');
ok(/ExchangeRate-API/.test(readme), 'README names the provider (ExchangeRate-API)');
ok(/Rates By Exchange Rate API/.test(readme) && /\(https:\/\/www\.exchangerate-api\.com\/?\)/.test(readme),
  'README carries the provider\'s attribution, linked');
ok(/three-letter currency code/i.test(readme), 'README says a three-letter currency code is what is sent');
ok(/IP address/i.test(readme), 'README says the request reveals the reader\'s IP address');
ok(/off by default/i.test(readme), 'README still says the fetch is off by default');

/* ---- 2. the README's host is the real one ---- */
{
  const m = fxFetch.match(/https:\/\/([a-z.-]+)\/v6\/latest/);
  ok(m, 'fx-fetch.js still builds its endpoint from a literal host');
  ok(readme.includes(m[1]), `README names ${m[1]}, the host fx-fetch.js really calls`);
}

/* ---- 3. settings: the helper, and both paths ---- */
const { appendRatesAttribution } = require('../src/onboarding');
{
  const made = [];
  const fake = {
    createEl(tag, opts) {
      const a = { tag, opts, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; } };
      made.push(a); return a;
    },
  };
  const opened = [];
  global.window = { open: (u, w) => opened.push([u, w]) };
  appendRatesAttribution(fake);
  eq(made.length, 1, 'the helper builds exactly one element');
  eq(made[0].tag, 'a', '…an anchor');
  eq(made[0].opts.text, 'Rates By Exchange Rate API', '…carrying the provider\'s attribution text');
  eq(made[0].opts.href, 'https://www.exchangerate-api.com', '…linking to the provider');
  let prevented = false;
  made[0].handlers.click({ preventDefault() { prevented = true; } });
  eq(opened, [['https://www.exchangerate-api.com', '_blank']], '…opened with window.open, like the tab\'s feedback and support links');
  ok(prevented, '…and the click does not also navigate the Obsidian window');
  delete global.window;
}
{
  const split = tab.indexOf('\n  getSettingDefinitions() {');
  const imperative = tab.slice(0, split);
  const declarative = tab.slice(split);
  ok(/\.setName\(i18n\.t\('settings\.exchangeRates\.source'\)\)/.test(imperative), 'display() carries the exchange-rate source row');
  ok(/name:\s*i18n\.t\('settings\.exchangeRates\.source'\)/.test(declarative), 'getSettingDefinitions() carries the same row');
  ok(/appendRatesAttribution\(/.test(imperative) && /appendRatesAttribution\(/.test(declarative), 'both paths build the link with the shared helper');
  ok(!/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(/.test(tab + wizard), 'no HTML string assignment in the tab or the wizard');
}

/* ---- 4. wizard ---- */
{
  const rates = wizard.slice(wizard.indexOf('render_rates(c) {'), wizard.indexOf('localeGroup(c) {'));
  ok(rates.includes('appendRatesAttribution('), 'the rates step shows the attribution');
  const afterCards = rates.indexOf('appendRatesAttribution(');
  ok(afterCards > rates.indexOf("for (const mode of ['off', 'on'])") && rates.indexOf('label.createDiv') < afterCards,
    'the link is built after the radio cards, outside any <label>');
}

/* ---- 5. descriptions name the provider in every language ---- */
for (const lang of ['en', 'af', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'pt', 'xh', 'zh', 'zu']) {
  const text = read(`src/lang/${lang}.js`);
  for (const key of ['settings.exchangeRates.desc', 'wiz.rates.on.desc', 'settings.exchangeRates.sourceDesc']) {
    const line = text.split('\n').find(l => l.startsWith(`  '${key}':`));
    ok(line && /exchangerate-api\.com/.test(line), `${lang}: ${key} names exchangerate-api.com`);
  }
  const en = lang === 'en';
  if (en) ok(!/public exchange-rate service/.test(text), 'en: no "a public exchange-rate service" is left');
}

console.log(`PASS exchange-rate-provider-disclosed — README, Settings and the wizard name the provider and carry its attribution (${checks} checks)`);
