'use strict';
/* A broken or hostile rate provider cannot make money disappear.

   The provider controls the JSON, and it can always lie with a plausible
   number — nothing here can catch a rate that is wrong by a few percent. What
   CAN be refused is a rate no currency has ever had. The 2026-10-07 audit fed
   the real fetch → normalizeTable → convertAccounts → formatAmount chain two
   such answers, and both got through:
     - CNY: 5e-324, the smallest double there is. Finite and above zero, so
       normalizeTable kept it; one yuan then bought Infinity rand, the
       converted household total was Infinity, and formatAmount printed it as
       "R 0,00" on the Accounts hero.
     - CNY: 1e300. One yuan bought 1e-300 rand, so ¥3 956 "converted" to R 0
       and the total came out as the rand accounts alone — fx.js's own promise,
       "no money went missing quietly", broken without a word.
   Both were then written to the cache file and read back on every launch.

   The rules this suite pins:
     1. normalizeTable refuses a table whose rates imply an absurd cross-rate
        — wider than a trillion to one between any two of its currencies —
        WHOLE, so a provider answering garbage for one code is not trusted for
        the rest. The boundary is pinned on both sides; a table as wide as any
        provider lists today is still accepted.
     2. rateBetween and convert refuse a non-finite or absurd answer even for a
        table that never went through normalizeTable.
     3. convertAccounts names a balance that is not zero but converts to zero
        as unconvertible, never as "converted at R 0".
     4. through the REAL fetch and cache: the hostile answer is refused, the
        cache is not written, a hostile cache already on disk is refused on
        read, and the Accounts hero shows the honest split — not R 0,00.
   Network STUBBED (global.__requestUrl). Clock pinned.

     node tests/fx-hostile-rates.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const fx = require('../src/fx');
const ff = require('../src/fx-fetch');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const TODAY = '2026-10-07';
const table = rates => fx.normalizeTable({ base: 'ZAR', date: TODAY, rates: { ZAR: 1, ...rates } });
const HOUSEHOLD = { code: 'ZAR', symbol: 'R' };
const ACCOUNTS = [
  { name: 'Cheque', balance: 10000 },
  { name: 'Yuan wallet', currency: '¥', currency_code: 'CNY', balance: 3956 },
];

/* ---- 1. the boundary: absurd cross-rates refuse the table, whole ---- */
{
  eq(table({ CNY: 5e-324 }), null, 'a denormal rate is refused — one yuan would buy Infinity rand');
  eq(table({ CNY: 1e300 }), null, 'a rate of 1e300 is refused — ¥3 956 would convert to R 0');
  eq(table({ CNY: 1e-300 }), null, 'and its reciprocal');
  eq(table({ CNY: 0.39, USD: 1e-7, XTS: 1e6 }), null,
    'two rates each within reach of the base, a trillion to one apart from each other: the cross-rate is what is refused, and the good CNY rate goes with it');
  ok(table({ XTS: 1e12 }), 'exactly a trillion to one is accepted — the boundary, pinned on both sides');
  eq(table({ XTS: 1.000001e12 }), null, 'and the first step past it is not');
  ok(table({ XTS: 1e-12 }), 'the same boundary on the small side is accepted');
  eq(table({ XTS: 0.999999e-12 }), null, 'and the step past it is refused');
  ok(fx.normalizeTable({ base: 'KWD', date: TODAY, rates: { KWD: 1, IRR: 300000, USD: 3.3, LBP: 300000 } }),
    'a table as wide as any provider lists today — a dinar against the rial, a few hundred thousand to one — is still a table');
  const kept = table({ CNY: 0.39, JUNK: 'x', BAD: -1, NUL: 0 });
  eq(kept && kept.rates, { ZAR: 1, CNY: 0.39 },
    'unchanged: a value that is not a rate at all (zero, negative, text) is still dropped on its own, and the rest kept');
}

/* ---- 2. the arithmetic refuses what the boundary would have ---- */
{
  const raw = rates => ({ base: 'ZAR', date: TODAY, rates: { ZAR: 1, ...rates } });   // never normalised
  eq(fx.rateBetween('CNY', 'ZAR', raw({ CNY: 5e-324 })), null, 'rateBetween: Infinity is not a rate');
  eq(fx.rateBetween('CNY', 'ZAR', raw({ CNY: 1e300 })), null, 'nor is 1e-300');
  eq(fx.rateBetween('ZAR', 'CNY', raw({ CNY: 0 })), null, 'nor is zero, in either direction');
  ok(Math.abs(fx.rateBetween('CNY', 'ZAR', raw({ CNY: 0.4 })) - 2.5) < 1e-12, 'an ordinary cross-rate is untouched');
  eq(fx.convert(3956, 'CNY', 'ZAR', raw({ CNY: 5e-324 })), null, 'convert: no Infinity reaches a total');
  eq(fx.convert(1e300, 'XTS', 'ZAR', raw({ XTS: 1e-9 })), null,
    'and a product that overflows is null, not Infinity — even at a believable rate');
  eq(fx.convert(3956, 'CNY', 'ZAR', raw({ CNY: 0.4 })), 9890, 'an ordinary conversion is untouched');
}

/* ---- 3. a balance that converts to nothing is named, not counted at R 0 ---- */
{
  const tiny = table({ CNY: 1e11 });     // within the boundary, so the table stands
  ok(tiny, 'sanity: this table is accepted — the cross-rate is under a trillion to one');
  const r = fx.convertAccounts(ACCOUNTS, HOUSEHOLD, tiny, TODAY);
  eq(r.converted, [], '¥3 956 at 1e-11 rand a yuan is not shown as converted');
  eq(r.unconvertible.map(u => u.account.name), ['Yuan wallet'], 'it is named, for the caller to say "not converted"');
  eq(r.total, 10000, 'and the total says what it holds: the rand accounts, with the yuan beside it rather than inside it as R 0');

  const zero = fx.convertAccounts([...ACCOUNTS.slice(0, 1), { ...ACCOUNTS[1], balance: 0 }], HOUSEHOLD, tiny, TODAY);
  eq(zero.unconvertible, [], 'an EMPTY yuan account converts to zero honestly — nothing is missing');

  const normal = fx.convertAccounts(ACCOUNTS, HOUSEHOLD, table({ CNY: 0.39 }), TODAY);
  eq(normal.unconvertible, [], 'sanity: at an ordinary rate nothing is unconvertible');
  ok(normal.converted[0].inHome > 10000, `and ¥3 956 converts to real rand (${normal.converted[0].inHome})`);
}

/* ---- 4. the real fetch, the real cache, the real Accounts hero ---- */
const payload = rates => ({
  result: 'success', base_code: 'ZAR', time_last_update_utc: 'Wed, 07 Oct 2026 00:02:31 +0000', rates: { ZAR: 1, ...rates },
});
const B = 'Budget';
const VAULT = extra => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nexchange_rates: on\ncurrency_code: ZAR\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 10000.00\nbalance_updated: 2026-10-01\n---\n',
  [`${B}/Accounts/Yuan wallet.md`]: '---\ntype: savings\ncurrency: "¥"\ncurrency_code: CNY\nbalance: 3956.00\nbalance_updated: 2026-10-01\n---\n',
  ...extra,
});

async function accountsHero(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-10';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  const { formatAmount } = require('../src/currency');
  const { localeFor } = require('../src/locale');
  ctx.moneyIn = (sym, v, dp = 2) => formatAmount(sym, v, dp, localeFor('za'));
  ctx.money = (v, dp = 2) => ctx.moneyIn('R', v, dp);
  const { el } = require('../src/dom');
  ctx.typeBadge = t => el('span', {}, t);
  ctx.switchView = () => {};
  require('../src/categories')(ctx);
  require('../src/fx-live')(ctx);
  require('../src/views/accounts')(ctx);
  await ctx.refreshRates();
  ctx.renderAccounts();
  const hero = descend(ctx.$('#acctSummary')).find(n => n._cls && n._cls.has('acct-hero'));
  const conv = descend(hero).find(n => n._cls && n._cls.has('acct-hero-converted'));
  return {
    table: ctx.fxTable(), converted: ctx.fxConvert(S.accounts),
    sub: descend(hero).find(n => n._cls && n._cls.has('hero-sub')).textContent,
    conv: conv ? conv.textContent : '',
  };
}

(async () => {
  const unpin = pinClock(TODAY);
  try {
    for (const [name, rates] of [['denormal 5e-324', { CNY: 5e-324 }], ['1e300', { CNY: 1e300 }]]) {
      let sent = 0;
      global.__requestUrl = async () => { sent++; return { status: 200, json: payload(rates) }; };
      const written = {};
      const got = await ff.fetchRates({ writeFile: async (p, t) => { written[p] = t; } }, 'ZAR');
      eq(sent, 1, `${name}: sanity — the request was made (stubbed)`);
      eq(got, null, `${name}: the provider's answer is refused`);
      eq(written, {}, `${name}: and NOTHING is written — the cache file is never poisoned`);
    }

    /* A hostile cache already on disk (written by a build before this fix, or
       edited by hand): refused on read, so the app converts nothing rather
       than something absurd. Dated today, so no refresh is due and the
       network stub below is never reached. */
    global.__requestUrl = async () => { throw new Error('the network must not be needed here'); };
    const hostile = ff.serializeRates({ base: 'ZAR', date: TODAY, rates: { ZAR: 1, CNY: 5e-324 } });
    eq(ff.parseRatesFile(hostile), null, 'a cache file holding a denormal rate is refused when read back');
    const h = await accountsHero(VAULT({ [`${B}/Exchange Rates.md`]: hostile }));
    eq(h.table, null, 'so the live table is empty');
    eq(h.converted, null, 'and nothing is converted');
    eq(h.conv, '', 'the Accounts hero prints no converted total — where it printed "R 0,00"');
    ok(/¥ 3 956/.test(h.sub) && /not converted/.test(h.sub),
      `it names the yuan beside the rand total instead — got "${h.sub}"`);

    /* Sanity, the other way: an ordinary cache converts, so the empty hero
       above is the refusal and not a broken fixture. */
    const fine = await accountsHero(VAULT({
      [`${B}/Exchange Rates.md`]: ff.serializeRates({ base: 'ZAR', date: TODAY, rates: { ZAR: 1, CNY: 0.39 } }),
    }));
    ok(fine.table && fine.converted && fine.converted.converted.length === 1, 'an ordinary cache still converts');
    ok(/R 20 143/.test(fine.conv), `and the hero prints the converted total — got "${fine.conv}"`);
  } finally { unpin(); delete global.__requestUrl; }

  console.log(`PASS — fx-hostile-rates: an absurd rate is refused at the boundary and no money converts to nothing (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
