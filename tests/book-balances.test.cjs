'use strict';
/* One balance book, two bases named.

   On 1.41.1 the household's balances were summed by type in three places
   with two different bases and no word between them: the Savings KPIs and
   the Accounts page read STATED balances off S.accounts; the Dashboard's
   position tile, the Savings worth chart, the Score and the Report read
   IMPLIED ones off impliedAccounts(). On the vault this was built against
   the Savings page printed "Investments R 674 463,50" above a chart whose
   own Investments segment read R 691 357,55 — the R 16 894,05 between them
   was the reconcile drift, and the only surface that said so was a note on
   a different page.

   bookFigures().balances is the one place both bases are summed, and every
   page reads it. A page that prints the stated figure is handed the drift
   with it, the way periodSummary hands over `foreign`, so it can say so.

   Runs in bare node against the REAL loader, period, figures and views.
     node tests/book-balances.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); checks++; };

const B = 'Budget';
const TX = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r} |`).join('\n') + '\n';

/* The worked example. Stated on 1 August; rows dated after it move three of
   the four home accounts, so implied ≠ stated by a figure a reader can add
   up by hand:

     Emergency Fund  savings     20 000  +1 500 −500  → 21 000   (drift +1 000)
     Broker          investment  50 000  (no rows)    → 50 000
     Cheque          checking    10 000  −250         →  9 750   (drift −250)
     Card            credit_card  −3 000 (no rows)    → −3 000
     Euro Savings    savings     €800    (foreign: named, never summed)
     Wallet          cash        "about 300" (unreadable: held out of both) */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\nowners: "Ruan, Christine"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Categories/Saving.md`]: '---\ntype: savings\n---\n',
  [`${B}/Accounts/Emergency Fund.md`]:
    '---\ntype: Savings\nbalance: 20000.00\nbalance_updated: 2026-08-01\ntx_label: "Emergency Fund"\nowner: Ruan\n---\n',
  [`${B}/Accounts/Broker.md`]:
    '---\ntype: investment\nbalance: 50000.00\nbalance_updated: 2026-08-01\ntx_label: "Broker"\nowner: Christine\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\nbalance: 10000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  [`${B}/Accounts/Card.md`]:
    '---\ntype: credit_card\nbalance: -3000.00\nbalance_updated: 2026-08-01\ntx_label: "Card"\n---\n',
  [`${B}/Accounts/Euro Savings.md`]:
    '---\ntype: savings\nbalance: 800.00\nbalance_updated: 2026-08-01\ncurrency: "€"\ntx_label: "Euro Savings"\n---\n',
  [`${B}/Accounts/Wallet.md`]:
    '---\ntype: cash\nbalance: about 300\nbalance_updated: 2026-08-01\ntx_label: "Wallet"\n---\n',
  [`${B}/Transactions/Emergency Fund/2026-08.md`]: TX([
    '2026-08-05 | From cheque | Saving | 1500.00 | | | ',
    '2026-08-10 | Car repair | Groceries | -500.00 | | | ',
  ]),
  [`${B}/Transactions/Cheque/2026-08.md`]: TX([
    '2026-08-03 | Groceries | Groceries | -250.00 | | | ',
  ]),
};

async function mount(files = FILES) {
  const ctx = makeCtx(files, { budgetFolder: B });
  const S = await loadInto(ctx);
  S.period = '2026-08';
  return { ctx, S };
}

(async () => {
  const unpin = pinClock('2026-08-20');
  try {
    /* ---- 1. the seam: both bases, summed once, drift named ---------------- */
    {
      const { ctx } = await mount();
      const { balances: b } = ctx.bookFigures();
      ok(b && b.stated && b.implied, 'bookFigures() carries a balances book with both bases');

      eq(b.stated.byType, { savings: 20000, investment: 50000, checking: 10000, credit_card: -3000 },
        'stated: summed by case-folded type, home currency only, unreadable held out');
      eq(b.implied.byType, { savings: 21000, investment: 50000, checking: 9750, credit_card: -3000 },
        'implied: the same accounts rolled forward by the rows after their balance date');

      near(b.stated.net, 77000, 'stated net = 20 000 + 50 000 + 10 000 − 3 000');
      near(b.implied.net, 77750, 'implied net = 21 000 + 50 000 + 9 750 − 3 000');
      near(b.stated.positive, 80000, 'stated positive balances');
      near(b.stated.negative, 3000, 'stated negative balances, as a positive liability figure');
      near(b.implied.positive, 80750, 'implied positive balances');
      near(b.drift, 750, 'drift = implied net − stated net');
      eq(b.driftByType, { savings: 1000, checking: -250 }, 'drift per type, zero types omitted');

      eq(b.others, [['€', 800]], 'foreign accounts are named beside the book, never summed into it');
      eq(b.stated.accounts.map(a => a.name).sort(), ['Broker', 'Card', 'Cheque', 'Emergency Fund'],
        'the stated list is the home-currency, readable accounts');
      eq(b.implied.accounts.map(a => [a.name, a.balance]).sort(),
        [['Broker', 50000], ['Card', -3000], ['Cheque', 9750], ['Emergency Fund', 21000]],
        'the implied list carries the rolled-forward balances');

      const owners = Object.fromEntries(b.stated.byOwner.map(r => [r.key, r.net]));
      eq(owners, { ruan: 20000, christine: 50000, '': 7000 }, 'stated by owner — netByOwner\'s own keys, a blank owner under its own row');
      const ownersImplied = Object.fromEntries(b.implied.byOwner.map(r => [r.key, r.net]));
      eq(ownersImplied, { ruan: 21000, christine: 50000, '': 6750 }, 'implied by owner');
    }

    /* ---- 2. no rows after the balance date: the two bases agree ------------ */
    {
      const quiet = { ...FILES };
      delete quiet[`${B}/Transactions/Emergency Fund/2026-08.md`];
      delete quiet[`${B}/Transactions/Cheque/2026-08.md`];
      const { ctx } = await mount(quiet);
      const { balances: b } = ctx.bookFigures();
      near(b.drift, 0, 'no drift when nothing moved after the stated balances');
      eq(b.driftByType, {}, 'and no type drifts');
      eq(b.implied.byType, b.stated.byType, 'implied equals stated');
    }

    /* ---- 3. the Dashboard's position tile prints the IMPLIED book ---------- */
    async function mountView(files, view) {
      const ctx = makeCtx(files, { budgetFolder: B });
      const S = await loadInto(ctx);
      S.period = '2026-08';
      const { $, nodes } = makeDom();
      ctx.$ = $; ctx.$$ = () => [];
      ctx.root = $('#root');
      ctx.view = { containerEl: $('#root') };
      ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
      ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
      ctx.typeBadge = type => { const { el } = require('../src/dom'); return el('span', {}, type); };
      ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
      require('../src/categories')(ctx);
      require(`../src/views/${view}`)(ctx);
      return { ctx, S, nodes, text: id => (nodes.get(`#${id}`) || { textContent: '' }).textContent };
    }
    {
      const { ctx, text } = await mountView(FILES, 'dashboard');
      ctx.renderDashboard();
      const tile = text('dashPositionKpis');
      ok(tile.includes('R 71000'), `position tile: savings & investments = 21 000 + 50 000 implied (got: ${tile.slice(0, 200)})`);
      ok(tile.includes('R 21000'), 'position sub-line: savings implied');
      ok(tile.includes('R 50000'), 'position sub-line: invested');
    }

    /* ---- 4. the Savings KPIs print the STATED book and say what moved ------ */
    {
      const { ctx, text } = await mountView(FILES, 'savings');
      ctx.renderSavings();
      const kpis = text('savingsKpis');
      ok(kpis.includes('R 20000.00'), `Savings KPI: stated savings (got: ${kpis.slice(0, 300)})`);
      ok(kpis.includes('R 50000.00'), 'Investments KPI: stated investments');
      ok(/Transactions since then add up to R 1000 more/.test(kpis),
        'the Savings KPI names the rows that moved after its balance was stated — the same sentence the Dashboard\'s stale note uses');
      ok(!/R 250 less/.test(kpis), 'the checking drift belongs to no KPI on this page');
    }
    {
      const quiet = { ...FILES };
      delete quiet[`${B}/Transactions/Emergency Fund/2026-08.md`];
      delete quiet[`${B}/Transactions/Cheque/2026-08.md`];
      const { ctx, text } = await mountView(quiet, 'savings');
      ctx.renderSavings();
      ok(!/Transactions since then/.test(text('savingsKpis')), 'no drift, no sentence');
    }

    /* ---- 5. the gate: no page sums balances on its own ---------------------- */
    {
      const SRC = path.join(__dirname, '..', 'src');
      const files = [];
      (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'lang') walk(p); } else if (e.name.endsWith('.js')) files.push(p); } })(SRC);
      const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const OWNERS = new Set(['figures.js', 'period.js']);
      const RULES = [
        [/impliedAccounts\(\)/, 'a page rolling balances forward itself (figures.js owns bookFigures().balances)'],
        [/primaryTotal\(accountsOfType\(/, 'a page summing account types itself'],
        [/homeOnly\((savings|investments)\)/, 'a page summing account types itself'],
        [/S\.accounts\.filter\(a => !unreadableBalance\(a\)\)/, 'a page filtering readable balances itself'],
      ];
      const hits = [];
      for (const fp of files) {
        const rel = path.relative(SRC, fp);
        if (OWNERS.has(rel)) continue;
        code(fs.readFileSync(fp, 'utf8')).split('\n').forEach((line, i) => {
          for (const [re, why] of RULES) if (re.test(line)) hits.push(`${rel}:${i + 1} ${why}: ${line.trim()}`);
        });
      }
      eq(hits, [], 'every page reads the balance book');
    }

    console.log(`PASS — one balance book: stated and implied summed once, drift named (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
