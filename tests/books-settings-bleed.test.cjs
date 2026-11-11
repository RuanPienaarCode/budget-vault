'use strict';
/* Each book's settings are its own Settings.md — never the previous book's
   (ADR 0009 §4, the review of #166–#169, finding 2).

   doLoadVault() patched S.settings key by key off Settings.md's frontmatter,
   and several keys only `if (fm.key)`. With one budget folder that was the
   right shape: the defaults were in S from mount, and a hand-made Settings.md
   that left out `currency` simply kept the default "R". With books, S.settings
   is whatever the PREVIOUS book left there. On the reviewer's repro a client
   book whose hand-made Settings.md names only its country opened with the
   household's 25th-of-the-month payday, its 14-day cycle and its "$"; a book
   with no Settings.md at all opened as the household outright — household
   name, country and all — while a fresh mount straight onto the same folder
   showed the defaults. Isolation that depends on which book you came from is
   not isolation.

   Pinned over the REAL loader, against an oracle that cannot bleed: a fresh
   mount straight onto each book. After a switch from a fully-configured book,
   S.settings is deep-equal to that fresh mount's —
     - for a book whose Settings.md leaves keys out (each one read or defaulted),
     - for a book with no Settings.md at all (every key defaulted, and the
       interface language back to the default rather than the last book's);
   the same holds for the headless API's own ctx; and a SAME-book reload leaves
   S.settings exactly as it was (the golden and reconcile gates cover the
   figures; this covers the settings object itself).

     node tests/books-settings-bleed.test.cjs */

const assert = require('assert');
const H = require('./helpers/harness.cjs');
H.stubObsidian();
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const HOME = 'Budget', ACME = 'Clients/Acme', ZETA = 'Clients/Zeta';
const LIST = [{ folder: HOME, label: 'Home' }, { folder: ACME, label: 'Acme' }, { folder: ZETA, label: 'Zeta' }];
const FILES = {
  [`${HOME}/Settings.md`]: '---\nmonth_start_day: 25\nperiod_days: 14\nperiod_anchor: 2026-01-02\ncurrency: "$"\ncurrency_code: USD\n'
    + 'exchange_rates: on\ncountry: us\nhousehold: Home\nlanguage: de\noverspend_lag: 3\nemergency_target_months: 9\nmiles_rate: 0.5\n'
    + 'input_mode: manual\nowners: Alex, Sam\n---\n',
  [`${HOME}/Categories/HomeFood.md`]: '---\ntype: needs\n---\n',
  // Hand-made: no currency, no month_start_day, no language.
  [`${ACME}/Settings.md`]: '---\ncountry: za\nhousehold: Acme\n---\n',
  [`${ACME}/Categories/AcmeRent.md`]: '---\ntype: needs\n---\n',
  // No Settings.md at all.
  [`${ZETA}/Categories/ZetaRent.md`]: '---\ntype: needs\n---\n',
};

function device(open = null) {
  const ctx = H.makeCtx(FILES, { budgetFolder: HOME });
  const store = {};
  ctx.plugin.app = { vault: ctx.vault, loadLocalStorage: k => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { store[k] = v; } };
  ctx.plugin.settings.books = LIST.map(b => ({ ...b }));
  if (open) ctx.plugin.setOpenBookLocal(open);
  return ctx;
}
const settingsOf = S => JSON.parse(JSON.stringify(S.settings));

(async () => {
  const startLang = i18n.getLanguage ? i18n.getLanguage() : null;
  /* The oracle: a fresh mount straight onto each book, with the interface
     language put back first so the mount starts from where a cold start does. */
  const fresh = {};
  const freshLang = {};
  for (const b of [HOME, ACME, ZETA]) {
    i18n.setLanguage(i18n.defaultLanguage());
    const c = device(b === HOME ? null : b);
    await H.loadInto(c);
    fresh[b] = settingsOf(c.S);
    freshLang[b] = i18n.t('books.homeFallback');
  }
  eq(fresh[HOME].currency, '$', 'fixture: the household reads "$"');
  eq(fresh[HOME].month_start_day, 25, 'fixture: … payday the 25th');
  eq(fresh[ACME].currency, 'R', 'fixture: a fresh mount on Acme defaults its unstated currency to "R"');
  eq(fresh[ZETA].household, undefined, 'fixture: a fresh mount on Zeta (no Settings.md) has no household name');

  /* Home → Acme, Home → Zeta, on one device. */
  i18n.setLanguage(i18n.defaultLanguage());
  const d = device();
  await H.loadInto(d);
  eq(settingsOf(d.S), fresh[HOME], 'the household, loaded first, matches its fresh mount');
  eq(i18n.t('books.homeFallback'), i18n.TABLES.de['books.homeFallback'], 'fixture: the household switches the interface to German');
  ok(i18n.TABLES.de['books.homeFallback'] !== freshLang[ZETA], 'fixture: … which reads differently from the default language');

  d.plugin.setOpenBookLocal(ACME);
  await d.loadVault();
  eq(settingsOf(d.S), fresh[ACME],
    'Home → Acme: Acme\'s settings are exactly a fresh mount\'s — each key Acme states is read, each it leaves out is DEFAULTED, none is the household\'s');
  eq([d.S.settings.month_start_day, d.S.settings.period_days, d.S.settings.currency, d.S.settings.overspend_lag],
    [23, 0, 'R', 1], '… spelled out: no 25th payday, no 14-day cycle, no "$", no lag of 3 carried over');
  eq(d.S.settings.exchange_rates, false, '… and exchange rates are off (the household\'s "on" does not follow it)');

  d.plugin.setOpenBookLocal(null);
  await d.loadVault();
  eq(settingsOf(d.S), fresh[HOME], 'back to the household: its own settings, whole');

  d.plugin.setOpenBookLocal(ZETA);
  await d.loadVault();
  eq(settingsOf(d.S), fresh[ZETA], 'Home → Zeta (no Settings.md at all): every key is the default, exactly as a fresh mount');
  eq(d.S.settings.household, undefined, '… no household name borrowed from the book before');
  eq(d.S.settings.country, 'za', '… the default country, not the household\'s "us"');
  eq(i18n.t('books.homeFallback'), freshLang[ZETA], '… and the interface language is the default again, not the household\'s German');
  ok(d.S.unreadableFiles.some(u => u.rel === 'Settings.md' && u.why === 'missing'), 'the missing Settings.md is still disclosed');

  /* A same-book reload is unchanged by the reset. */
  d.plugin.setOpenBookLocal(null);
  await d.loadVault();
  const once = settingsOf(d.S);
  await d.loadVault();
  eq(settingsOf(d.S), once, 'a same-book reload leaves S.settings exactly as it was');
  eq(once, fresh[HOME], '… which is the household\'s own');

  /* The headless API's ctx — a separate S, the same loader. */
  {
    const { buildApi } = require('../src/api');
    const vault = H.makeVault(FILES);
    const store = {};
    const plugin = H.bookSeam({
      settings: { budgetFolder: HOME, books: LIST.map(b => ({ ...b })) },
      app: { vault, loadLocalStorage: k => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { store[k] = v; } },
    });
    const api = buildApi(plugin);
    const a = await api.currentPeriod();
    eq(a.currency, { symbol: '$', code: 'USD' }, 'API: the household\'s figure is in "$" (USD)');
    plugin.setOpenBookLocal(ZETA);
    api._syncLock();
    const z = await api.currentPeriod();
    eq(z.currency, { symbol: 'R' }, 'API: after a switch to Zeta the figure is in the DEFAULT currency — not the household\'s "$" or its USD code');
    plugin.setOpenBookLocal(ACME);
    api._syncLock();
    const ac = await api.currentPeriod();
    eq(ac.currency, { symbol: 'R' }, 'API: Acme (no currency line) likewise');
  }

  i18n.setLanguage(startLang || i18n.defaultLanguage());
  console.log(`PASS books-settings-bleed — every book's settings are read or defaulted from its own Settings.md, never inherited from the book before (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
