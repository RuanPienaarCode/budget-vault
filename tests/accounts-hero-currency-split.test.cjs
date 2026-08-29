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

   ISSUE 28 closes the other half. The Ring ("Where it sits") and the "Whose
   it is" owner split were originally left summing every currency together —
   a scoped decision that a reporter found from the outside: the donut's
   centre read "Rp 5 203 956" while the hero directly above it read
   "Rp 5 200 000", the same household, two figures, two rules. Both now use
   the hero's rule, and this file pins all four surfaces so none of them can
   drift back.

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

  /* ---- 3. ISSUE 28 — the Ring now follows the SAME rule as the hero ---- */
  {
    const summary = ctx.$('#acctSummary');
    const ring = descend(summary).find(n => n._cls && n._cls.has('acct-ring'));
    ok(ring, 'fixture sanity: the Ring card rendered');

    // The centre figure: the rand group alone. A blind sum would print
    // R6840 here while the hero, two lines up, printed R5000.
    const centre = descend(ring).find(n => n.tagName === 'TEXT');
    ok(centre, 'fixture sanity: the donut centre figure rendered');
    eq(centre.textContent, 'R 5000',
      'the donut centre is the primary-currency total — it agrees with the hero above it');

    // NEGATIVE CONTROLS: the old sentence and the old asterisk are both gone.
    ok(!/adds accounts held in more than one currency/.test(textOf(ring)),
      'the Ring no longer claims to have added mixed currencies together');
    ok(!descend(ring).some(n => n._cls && n._cls.has('acct-mixed')),
      'and the retired .acct-mixed asterisk is gone from the Ring and its legend');

    // The disclosure it carries instead is the hero's own sentence.
    ok(/Plus/.test(textOf(ring)) && /\$ 1200/.test(textOf(ring)) && /€ 640/.test(textOf(ring)),
      'the Ring names each other currency as its own side figure instead');

    /* The Savings group holds ONLY foreign money. It cannot be a wedge, but
       it must not vanish either — it is listed at 0% with its symbols. */
    const legendRows = descend(ring).filter(n => n.tagName === 'LI');
    const savingsLi = legendRows.find(n => /Savings/.test(n.textContent));
    ok(savingsLi, 'a group holding only foreign money is still listed in the legend, not dropped');
    ok(/0%/.test(savingsLi.textContent),
      'at 0% of the ring, because none of what it holds is in the currency the ring is drawn in');
    ok(/\$ 1200/.test(savingsLi.textContent) && /€ 640/.test(savingsLi.textContent),
      'with both of its foreign totals named beside it');
  }

  /* ---- 4. ISSUE 28 — the "Whose it is" owner rows, same rule again.
     Needs its own vault: the fixture above declares no owners, so the card
     does not render there at all. Alex holds R5 000; Sam holds nothing but
     euros. A blind sum gave Sam "R 640"; the row must say R0 and name the
     €640 beside it — and Sam must still HAVE a row. ---- */
  {
    const { ctx: c2 } = await mount({
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nowners: "Alex, Sam"\n---\n',
      [`${B}/Accounts/His Cheque.md`]: '---\ntype: checking\nowner: Alex\nbalance: 5000.00\nbalance_updated: 2026-07-01\n---\n',
      [`${B}/Accounts/Her Euro.md`]: '---\ntype: savings\nowner: Sam\ncurrency: "€"\nbalance: 640.00\nbalance_updated: 2026-07-01\n---\n',
    });
    c2.renderAccounts();

    const owners = descend(c2.$('#acctSummary')).filter(n => n._cls && n._cls.has('acct-owner-row'));
    eq(owners.length, 2, 'fixture sanity: both owners have a row');

    const sam = owners.find(n => /Sam/.test(n.textContent));
    ok(sam, 'the owner holding ONLY foreign money still has a row — not dropped');
    ok(/R 0\.00/.test(sam.textContent),
      "Sam's household-currency total is R0 — not the R640 a blind sum gave");
    ok(/€ 640/.test(sam.textContent), 'and the euro balance is named beside it, in euros');
    ok(!descend(sam).some(n => n._cls && n._cls.has('acct-mixed')),
      'the retired asterisk is gone from the owner rows too');

    const alex = owners.find(n => /Alex/.test(n.textContent));
    ok(/R 5000\.00/.test(alex.textContent),
      "Alex's row is pure rand, so it is unaffected by the fix");
  }

  console.log(`PASS — Accounts hero, table, Ring and owner split all sum one currency (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
