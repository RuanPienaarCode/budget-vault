'use strict';
/* ITEM 5 — the Accounts hero (and the table's own group subtotals) stop
   summing mixed currencies.

   Before this fix, the hero's net figure and the table's per-group totals
   ADDED every account's balance regardless of its own `currency:` and
   disclosed the mix with a sentence ("adds accounts... without converting
   them") or an asterisk. That is arithmetic a household set to "R" cannot
   actually stand behind — a euro is not a rand, and no rate is stored to make
   it one (currency.js's own header). The fix re-sources the two totals to sum
   ONLY the household's own currency, and states each other currency present
   as its own side figure, in its own symbol — never converted, never folded
   in silently.

   The Ring ("Where it sits") and the "Whose it is" owner split are
   DELIBERATELY left summing every currency together, unchanged — that is a
   scoped decision (views/accounts.js's own ITEM 5 comments explain why), not
   an oversight, so this file pins BOTH halves: the hero/table's new
   behaviour, and the ring's old behaviour still standing. A future change
   that quietly "fixes" the ring to match, or accidentally narrows the hero
   back to matching the ring, should be caught either way.

   Runs in bare node against the real view, same harness as
   tests/accounts-lane-review.test.cjs.
     node tests/accounts-hero-currency-split.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const textOf = root => descend(root).map(n => n.textContent || '').join(' | ');

async function mount(files) {
  const ctx = makeCtx({
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    ...files,
  });
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.switchView = () => {};
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  return { ctx, S, $ };
}

/* Rand 5000 (primary), euro 640, dollar 1200 — all in one group ("Bank
   accounts" — checking/savings/cash) except the two foreign ones, so the
   Bank group is pure-primary and the Savings group is pure-foreign; between
   them that covers "the group's total is unaffected" and "the group's total
   drops to 0 plus two side figures" in one fixture. */
const FILES = {
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 5000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Euro.md`]: '---\ntype: savings\ncurrency: "€"\nbalance: 640.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Dollar.md`]: '---\ntype: savings\ncurrency: "$"\nbalance: 1200.00\nbalance_updated: 2026-07-01\n---\n',
};

(async () => {
  const { ctx } = await mount(FILES);
  ctx.renderAccounts();

  /* ---- 1. the hero: total equals ONLY the primary-currency sum ---- */
  {
    const hero = ctx.$('#acctSummary');
    const heroNum = descend(hero).find(n => n._cls && n._cls.has('hero-num'));
    ok(heroNum, 'fixture sanity: the hero number rendered');
    eq(heroNum.textContent, 'R 5000.00',
      'the hero net is the RAND account alone — the euro and dollar balances are not folded in');

    const sub = descend(hero).find(n => n._cls && n._cls.has('hero-sub'));
    ok(/Plus/.test(sub.textContent) && /\$ 1200/.test(sub.textContent) && /€ 640/.test(sub.textContent),
      'and the sub-line names each OTHER currency as its own side figure');
    ok(/not converted/.test(sub.textContent), 'stating plainly that nothing was converted');

    // NEGATIVE CONTROL: the OLD sentence must not appear on the hero any
    // more — it is retired from this element (still lives on the ring below).
    ok(!/adds accounts held in more than one currency/.test(sub.textContent),
      'the hero no longer claims to have added mixed currencies together — it did not');
  }

  /* ---- 2. the table: a group with NO primary-currency account totals R0,
     plus both side figures ---- */
  {
    const table = ctx.$('#acctTable');
    const rows = descend(table).filter(n => n._cls && n._cls.has('type-row'));
    const savingsRow = rows.find(r => /Savings/.test(r.textContent));
    ok(savingsRow, 'fixture sanity: the Savings group subtotal row rendered');
    eq(/R 0\.00/.test(savingsRow.textContent), true,
      'the Savings group has no rand account in it, so its own total is R0 — not the R1840 a blind sum would give');
    ok(/plus/.test(savingsRow.textContent) && /\$ 1200/.test(savingsRow.textContent) && /€ 640/.test(savingsRow.textContent),
      'and it names both foreign currencies present in that group as side figures');

    // NEGATIVE CONTROL: the old asterisk mark is gone from THIS row — the
    // figure now discloses itself outright instead of hiding behind a title.
    ok(!descend(savingsRow).some(n => n._cls && n._cls.has('acct-mixed')),
      'the retired .acct-mixed marker does not appear on a group row any more');

    const bankRow = rows.find(r => /Bank accounts/.test(r.textContent));
    ok(bankRow, 'fixture sanity: the Bank accounts group subtotal row rendered');
    ok(/R 5000\.00/.test(bankRow.textContent),
      'the Bank accounts group is pure rand, so its own total is unaffected by the fix');
  }

  /* ---- 3. the Ring: DELIBERATELY unchanged — still sums every currency and
     still uses the OLD mixed-currency sentence. This is the scoped half of
     the fix, pinned so a future change cannot silently narrow it (or widen
     the hero back to match it) without this test noticing. ---- */
  {
    const ring = ctx.$('#acctSummary');
    const ringSub = descend(ring).find(n => n._cls && n._cls.has('sub') && /adds accounts held in more than one currency/.test(n.textContent));
    ok(ringSub, 'the Ring card still carries the OLD "adds accounts... without converting them" sentence');
    ok(descend(ring).some(n => n._cls && n._cls.has('acct-mixed')),
      'and the Ring/legend still uses the retired .acct-mixed asterisk mark — unchanged, on purpose');
  }

  console.log(`PASS — Accounts hero + table currency split, Ring intentionally unchanged (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
