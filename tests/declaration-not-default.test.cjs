'use strict';
/* TWO REGRESSIONS SHIPPED IN 1.36.0, found by a red-team pass over that
   release and reproduced before either was touched. Both have one cause:

     A DEFAULT WAS READ AS A DECLARATION.

   1.36.0 added two rules that treat a piece of frontmatter as the household
   SAYING something. In both cases the field also has a value when the
   household has said nothing at all, and the rules could not tell the
   difference.

   ---- A. An untyped category counted an internal shuffle as saving --------

   ISSUE 32 taught savedFromOutside that an outflow under a non-internal
   category type cannot be the leg of an internal move — a purchase leaves
   under a real expense category, and a shop is not another one of your
   accounts. True, IF the household typed the category.

   `src/load.js` defaults a category with no `type:` key to `expense`. So a
   `Move` category note carrying only a colour — the ordinary state of a
   category somebody made quickly — was indistinguishable from one deliberately
   typed `expense`. Measured: R5 000 out of a baby fund and R5 000 into an
   emergency fund four days later (an ordinary EFT clearing delay), one
   household, one shuffle:

     savedFromOutside(rows, pool)              -> 0      correct: nothing saved
     savedFromOutside(rows, pool, catType)     -> 5000   1.36.0

   That is the 1.23.0 overstatement — a rand moved between two of your own
   accounts counted as fresh saving — arriving through the door ISSUE 32's own
   fix opened, and it inflates the score's savings-rate pillar.

   ---- B. A savings-typed account stopped the budget measuring anything -----

   ISSUE 41 vetoed outgoings from savings/investment accounts out of budget
   spend. That veto removes the row from `byCat` as well as from the total, so
   it reaches the per-category Budget table too — the thing a reader checks
   before buying something specific.

   `type: savings` is a classification of what kind of account it is, not a
   statement that its money is spoken for. A high-interest transactional
   account is a real and ordinary South African product and carries that word.
   Measured on a household whose ONLY account is one, with a R35 000 salary in
   and R4 250 of real spending out:

     periodSummary().spend    -> 0        (R4 250 had gone)
     byCat                    -> { Salary: 35000 }
     hero "budget remaining"  -> R7 000   the whole budget, untouched

   The budget stopped measuring anything, silently, off one frontmatter word —
   worse than the defect the veto was added to fix.

   ---- THE RULE THIS FILE PINS ----

   The strength of the response matches the strength of the declaration.
   `type_stated` and an account-level goal are the household SAYING something;
   a loader default is not. Where they have not said, the app keeps the
   behaviour it had before it asked.

     node tests/declaration-not-default.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { savedFromOutside } = require('../src/savings-math');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const tx = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |  |\n`).join('');

const RealDate = Date;
const at = (iso, fn) => {
  const [y, m, d] = iso.split('-').map(Number);
  class F extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(new RealDate(y, m - 1, d, 12).getTime()); }
    static now() { return new RealDate(y, m - 1, d, 12).getTime(); }
  }
  global.Date = F;
  return Promise.resolve().then(fn).finally(() => { global.Date = RealDate; });
};

at('2026-09-15', async () => {
  /* ---------- A. the untyped category ---------- */
  {
    const FILES = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Categories/Move.md`]: '---\ncolor: "#888888"\n---\n',          // NO type: key
      [`${B}/Categories/Shop.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',  // stated
      [`${B}/Accounts/Baby fund.md`]: '---\ntype: savings\ntx_label: "Baby fund"\ngoal_amount: 20000\nbalance: 10000\nbalance_updated: 2026-09-01\n---\n',
      [`${B}/Accounts/Emergency fund.md`]: '---\ntype: savings\ntx_label: "Emergency fund"\nemergency_fund: true\nbalance: 10000\nbalance_updated: 2026-09-01\n---\n',
      [`${B}/Transactions/Baby fund/2026-09.md`]: tx([['2026-09-01', 'To emergency', 'Move', -5000]]),
      [`${B}/Transactions/Emergency fund/2026-09.md`]: tx([['2026-09-05', 'From baby fund', 'Move', 5000]]),
    };
    const ctx = makeCtx(FILES, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);
    S.period = '2026-09';

    eq(ctx.catType('Move'), 'expense',
      'the loader still defaults an untyped category to expense — every consumer that BUCKETS a row needs that');
    eq(ctx.declaredCatType('Move'), null,
      'but the household never said so, and the one consumer reading the type as INTENT is told that');
    eq(ctx.declaredCatType('Shop'), 'expense',
      'while a category they did type reports what they typed');
    eq(ctx.declaredCatType('NoSuchCategory'), null, 'and a name with no file at all is unknown, as it always was');

    const rows = [];
    for (const f of Object.values(S.txFiles)) for (const r of f.rows) rows.push({ ...r, label: f.label });
    const pool = new Map([['Baby fund', 'Baby fund'], ['Emergency fund', 'Emergency fund']]);

    eq(savedFromOutside(rows, pool, ctx.declaredCatType), 0,
      'a shuffle between two of the household\'s own funds is not saving — whatever the loader defaulted its category to');
    eq(savedFromOutside(rows, pool, ctx.catType), 5000,
      'and the 1.36.0 behaviour is pinned here as the DEFECT, so a revert to catType goes red rather than quiet');
    eq(savedFromOutside(rows, pool), 0, 'the no-argument contract is unchanged');
  }

  /* ---------- B. the savings-typed everyday account ---------- */
  {
    const base = acct => ({
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
      [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
      [`${B}/Categories/Gym.md`]: '---\ntype: expense\n---\n',
      [`${B}/Accounts/MyMoney.md`]: acct,
      [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
        + '| Groceries | expense | 6000.00 |  |\n| Gym | expense | 1000.00 |  |\n',
      [`${B}/Transactions/MyMoney/2026-09.md`]: tx([
        ['2026-09-01', 'Salary', 'Salary', 35000],
        ['2026-09-03', 'Checkers', 'Groceries', -4000],
        ['2026-09-05', 'Virgin', 'Gym', -250],
      ]),
    });
    const load = async files => {
      const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
      const S = await loadInto(ctx); S.period = '2026-09';
      return ctx;
    };

    /* A high-interest transactional account: typed savings, no goal, no flag. */
    const plain = await load(base('---\ntype: savings\ntx_label: "MyMoney"\nbalance: 20000\nbalance_updated: 2026-09-01\n---\n'));
    const ps = plain.periodSummary('2026-09');
    eq(ps.spend, 4250, 'the household really did spend R4 250, and the budget counts it');
    eq(ps.byCat.Groceries, -4000, 'the Groceries envelope shows the groceries');
    eq(ps.byCat.Gym, -250, 'and the gym shows the gym — this is the per-category table a reader checks');
    eq(plain.budgetTotals('2026-09').spend - ps.spend, 2750, 'so "budget remaining" is R2 750, not the whole R7 000');
    eq(plain.earmarkedLabels().size, 0, 'a bare type: savings is a classification, not a declaration');

    /* The same account once the household states a GOAL — a real baby fund. */
    const goal = await load(base('---\ntype: savings\ntx_label: "MyMoney"\ngoal_amount: 50000\nbalance: 20000\nbalance_updated: 2026-09-01\n---\n'));
    eq(goal.earmarkedLabels().has('MyMoney'), true, 'a savings account with a goal IS declared as a fund');
    eq(goal.periodSummary('2026-09').fundedFromSavings.spend, 4250,
      'so its outgoings leave the budget — and are named, never dropped');

    /* And the explicit flag, which never needed a goal. */
    const flagged = await load(base('---\ntype: savings\ntx_label: "MyMoney"\nemergency_fund: true\nbalance: 20000\nbalance_updated: 2026-09-01\n---\n'));
    eq(flagged.earmarkedLabels().has('MyMoney'), true, 'emergency_fund alone is a declaration');

    /* budget: true still overrides everything — an answer beats a default. */
    const optedIn = await load(base('---\ntype: savings\ntx_label: "MyMoney"\ngoal_amount: 50000\nbudget: true\nbalance: 20000\nbalance_updated: 2026-09-01\n---\n'));
    eq(optedIn.earmarkedLabels().size, 0,
      'a household that says it budgets from this account is believed, goal or no goal');
  }

  console.log(`PASS declaration-not-default (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
