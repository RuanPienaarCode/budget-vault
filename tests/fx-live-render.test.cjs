'use strict';
/* Conversion, on a screen.

   src/fx.js and src/fx-fetch.js shipped with tests before anything called
   them — so the engine was proven and the feature did nothing. This drives
   the Accounts hero with rates switched on, using the vault from issue #28.

   The two states that matter are BOTH pinned, because the off state is the
   default and the one nearly every reader is in:

     off -> the honest split, exactly as 1.29.1 shipped it
     on  -> one total, and never without the date its rates are for

     node tests/fx-live-render.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
// The reporter's own vault: Rp cash + Rp savings + an RMB Alipay balance.
const VAULT = settings => ({
  [`${B}/Settings.md`]: `---\nmonth_start_day: 1\ncurrency: "Rp"\ncountry: id\n${settings}---\n`,
  [`${B}/Accounts/Cash on hand.md`]: '---\ntype: cash\nbalance: 200000.00\nbalance_updated: 2026-08-27\n---\n',
  [`${B}/Accounts/BCA.md`]: '---\ntype: savings\nbalance: 5000000.00\nbalance_updated: 2026-08-27\n---\n',
  [`${B}/Accounts/Alipay.md`]: '---\ntype: savings\ncurrency: "RMB"\ncurrency_code: CNY\nbalance: 3956.00\nbalance_updated: 2026-08-27\n---\n',
});

/* A rates note already in the vault, so nothing here touches the network —
   the harness's requestUrl throws by default, which is itself the assertion
   that a render never reaches for one. */
const RATES = `---\nbase: "IDR"\ndate: "2026-08-27"\nsource: "exchangerate-api.com"\n---\n\n`
  + `# Exchange rates\n\nOne IDR buys:\n\n| Currency | Rate |\n|---|---:|\n| CNY | 0.000437 |\n| IDR | 1 |\n`;

async function heroOf(files, today) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  const fmt = (sym, v, dp) => `${sym} ${Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  ctx.money = (v, dp = 2) => fmt('Rp', v, dp);
  ctx.moneyIn = (sym, v, dp = 2) => fmt(sym, v, dp);
  const { el } = require('../src/dom');
  ctx.typeBadge = t => el('span', {}, t);
  ctx.switchView = () => {};
  require('../src/categories')(ctx);
  require('../src/fx-live')(ctx);
  if (today) { const d = require('../src/dates'); d.__today = today; }
  require('../src/views/accounts')(ctx);
  await (ctx.refreshRates ? ctx.refreshRates() : null);
  ctx.renderAccounts();
  const sum = ctx.$('#acctSummary');
  const hero = descend(sum).find(n => n._cls && n._cls.has('acct-hero'));
  const conv = descend(hero).find(n => n._cls && n._cls.has('acct-hero-converted'));
  return {
    num: descend(hero).find(n => n._cls && n._cls.has('hero-num')).textContent,
    sub: descend(hero).find(n => n._cls && n._cls.has('hero-sub')).textContent,
    /* ISSUE 31: the converted total is a labelled line of its own now, not the
       headline. Absent (empty string) whenever nothing converted. */
    conv: conv ? conv.textContent : '',
  };
}

(async () => {
  /* ---- OFF (the default, and every vault written before this existed) ---- */
  {
    const h = await heroOf(VAULT(''));
    eq(h.num, 'Rp 5,200,000.00',
      'with rates off the headline is the rupiah accounts alone — unchanged from 1.29.1');
    ok(/Plus RMB 3,956 held in other currencies, not converted/.test(h.sub),
      'and the RMB balance is named beside it, exactly as before');
    ok(!/converted at rates/.test(h.sub), 'nothing claims to have converted anything');
  }

  /* ---- ON, but with no rates file yet: must NOT convert ---- */
  {
    const h = await heroOf(VAULT('exchange_rates: on\ncurrency_code: IDR\n'));
    eq(h.num, 'Rp 5,200,000.00',
      'the toggle alone converts nothing — with no usable table the page falls back to the honest split rather than to a made-up figure');
    ok(/not converted/.test(h.sub), 'and says so');
  }

  /* ---- ON, with rates in the vault ---- */
  {
    const files = VAULT('exchange_rates: on\ncurrency_code: IDR\n');
    files[`${B}/Exchange Rates.md`] = RATES;
    const h = await heroOf(files);

    /* ISSUE 31. The HEADLINE is the split — home currency summed, every other
       symbol named beside it — because that is the one rule currency.js and
       ADR-0004 state and every other surface in the app follows. It was the
       converted figure until now, which made this page's own subtitle
       (worth(), home-currency only) describe a different number from the one
       above it, and made Accounts disagree with the Dashboard and the Savings
       page in the same session.

       The conversion is not lost and is not demoted to a footnote: it is a
       line of its own, saying what it is. */
    eq(h.num, 'Rp 5,200,000.00',
      'the headline is the household-currency split, the same rule every other page uses');
    // ¥3 956 / 0.000437 ≈ Rp 9 052 632, on top of Rp 5 200 000.
    ok(/^Rp 14,2/.test(h.conv.replace(/[^\d,.RpA-Za-z ]/g, '').replace(/^\D*/, 'Rp ')) || /14,2/.test(h.conv),
      `and the converted total is stated separately, labelled as converted — got ${h.conv}`);
    ok(/CNY 3,956/.test(h.sub), 'the ORIGINAL amount is still stated, in its own currency');
    ok(/2026-08-27/.test(h.sub),
      'and never without the date its rates are for — currency.js refused conversion because a rate is a fact about a DAY, so the day travels with the number');
  }

  console.log(`PASS — conversion reaches a screen, and never without its provenance (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
