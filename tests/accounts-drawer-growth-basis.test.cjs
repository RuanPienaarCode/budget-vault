'use strict';
/* The Accounts drawer's growth figures add up, on one basis, to a balance it
   names.

   The drawer printed "Total invested" — the frontmatter `total_invested`, a
   figure typed once and never kept in step — directly above "Growth", which
   totalReturn() measures against the capital the TRANSACTIONS add up to. On the
   vault the audit ran against (7 Oct 2026) the two plus each other overshot the
   balance beside them by thousands, with no caption saying they were measured
   on different things.

   Now, for a measured account: "Put in" (the capital growth is measured
   against) and "Growth" sum to the balance growth was measured ON — and when
   that is the implied balance rather than the one typed, the drawer says so on
   its own line. The file's own `total_invested` stays visible, captioned as
   the file's, rather than standing in for the capital it is not. A 'stated'
   account (no transactions) keeps "Total invested", because there it IS the
   capital, and the pair adds up to the balance as typed.

   Same rule as the Savings card for the same account, so the two pages cannot
   disagree about what an account earned on what.

     node tests/accounts-drawer-growth-basis.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TX = rows => '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n'
  + `|---|---|---|---:|---|---|\n${rows.map(r => `| ${r[0]} | ${r[1]} |  | ${r[2].toFixed(2)} | yes |  |`).join('\n')}\n`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  // Measured, drifting: stated R40 000 on 12 Aug, R1 500 debit order since.
  [`${B}/Accounts/Fund.md`]: '---\ntype: investment\nbalance: 40000.00\nbalance_updated: 2026-08-12\n'
    + 'starting_amount: 30000.00\ninception_date: 2025-02-15\ntotal_invested: 33000.00\n---\n',
  [`${B}/Transactions/Fund/2025-03.md`]: TX([['2025-03-01', 'Transfer in', 5000]]),
  [`${B}/Transactions/Fund/2026-09.md`]: TX([['2026-09-03', 'Debit order', 1500]]),
  // Measured, confirmed after its last row: nothing to roll forward.
  [`${B}/Accounts/Steady.md`]: '---\ntype: investment\nbalance: 12000.00\nbalance_updated: 2026-10-01\n'
    + 'starting_amount: 10000.00\ninception_date: 2026-01-10\n---\n',
  [`${B}/Transactions/Steady/2026-02.md`]: TX([['2026-02-01', 'Transfer in', 1000]]),
  // Stated: no transactions, the file's total_invested is the baseline.
  [`${B}/Accounts/Wrapper.md`]: '---\ntype: investment\nbalance: 25000.00\nbalance_updated: 2026-10-01\n'
    + 'total_invested: 20000.00\n---\n',
};

async function mount() {
  const ctx = makeCtx({ ...FILES });
  const S = await loadInto(ctx);
  S.period = '2026-10';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.switchView = () => {};
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  return { ctx, S, $ };
}

/* label → value of every field in the open drawer. */
function drawerFields($) {
  const out = {};
  for (const f of descend($('#acctTable')).filter(n => n._cls.has('acct-drawer-f'))) {
    out[String(f.children[0].textContent)] = String(f.children[1].textContent);
  }
  return out;
}
const num = t => Number(String(t).replace(/[^\d.-]/g, ''));

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    const L = {
      putIn: i18n.t('acct.drawer.putIn'), growth: i18n.t('acct.drawer.growth'),
      measuredOn: i18n.t('acct.drawer.measuredOn'), invested: i18n.t('acct.drawer.invested'),
      investedFile: i18n.t('acct.drawer.investedFile'),
    };

    /* ---- 1. measured and drifting ---- */
    {
      const { ctx, S, $ } = await mount();
      S.acctView = { open: 'Fund' };
      ctx.renderAccounts();
      const d = drawerFields($);
      eq(d[L.putIn], 'R 36500.00', 'Put in is the capital growth is measured against');
      eq(d[L.growth], 'R 5000.00', 'Growth is measured on today\'s implied balance');
      eq(d[L.measuredOn], 'R 41500.00', 'and the drawer names that balance, since it is not the one typed');
      eq(num(d[L.putIn]) + num(d[L.growth]), num(d[L.measuredOn]), 'Put in + Growth = the balance it was measured on');
      eq(d[L.investedFile], 'R 33000.00', 'the file\'s own total_invested stays visible, captioned as the file\'s');
      ok(!(L.invested in d), 'and no bare "Total invested" stands in for the capital it is not');

      const row = descend($('#acctTable')).find(n => n._cls.has('acct-goal'));
      ok(row && String(row.textContent).includes(i18n.t('acct.growthOn', { pct: '+14', amount: 'R 36500' })),
        `the goal cell reads the same return on the same capital (got "${row && row.textContent}")`);
    }

    /* ---- 2. measured, confirmed: the typed balance is the measure ---- */
    {
      const { ctx, S, $ } = await mount();
      S.acctView = { open: 'Steady' };
      ctx.renderAccounts();
      const d = drawerFields($);
      eq(num(d[L.putIn]) + num(d[L.growth]), 12000, 'Put in + Growth = the balance in the drawer heading');
      ok(!(L.measuredOn in d), 'nothing rolled forward, so no extra line');
      ok(!(L.investedFile in d), 'and no file figure to caption on an account that carries none');
    }

    /* ---- 3. stated: Total invested IS the capital ---- */
    {
      const { ctx, S, $ } = await mount();
      S.acctView = { open: 'Wrapper' };
      ctx.renderAccounts();
      const d = drawerFields($);
      eq(d[L.invested], 'R 20000.00', 'a stated account keeps Total invested — it is the baseline');
      eq(num(d[L.invested]) + num(d[L.growth]), 25000, 'and it plus Growth is the balance as typed');
      ok(!(L.putIn in d), 'no second "in" figure beside it');
    }

    /* ---- 4. the words, once en.js carries them ---- */
    eq([L.putIn, L.measuredOn, L.investedFile], ['Put in', 'Growth is measured on', 'Total invested (account file)'],
      'the drawer labels read as English, not as their key names');
  } finally { unpin(); }
  console.log(`PASS — the Accounts drawer's growth adds up on one basis, and says which (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
