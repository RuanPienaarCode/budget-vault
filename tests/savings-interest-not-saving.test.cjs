'use strict';
/* MONEY A POOL GENERATES FOR ITSELF IS NOT MONEY THE HOUSEHOLD SAVED.

   savedFromOutside() answers "how much did you save" for the score's
   savings-rate pillar, health-data's six-period average, and — through
   period.js's movedToFunds() — the Dashboard hero's "R X set aside, R Y moved
   so far" note. Its own stated definition is that saving is what crossed into
   the pool FROM OUTSIDE it. Interest credited INSIDE a pool crossed no
   boundary: the fund earned it where it already sat.

   Reproduced before it was touched, on a household whose emergency fund
   received one row — 2026-09-03, "Interest Earned at 7.20%", R632.63, under a
   category typed `income` and flagged `interest: true`:

     ctx.declaredCatType('Interest income') -> 'income'   (not pool-aware)
     savedFromOutside(rows, pool, declared)  -> 632.63
     ctx.movedToFunds('2026-09')             -> 632.63

   The hero then reads "R 4 079 set aside, R 633 moved so far" — 15% funded —
   off money nobody moved.

   THE RULE THIS FILE PINS, and the narrow shape of it:

     An INFLOW into a pool account whose DECLARED category type folds to
     'interest' is growth, not saving. It is not a leg of any movement either,
     so it can never cancel an outflow.

   'interest' comes from ONE fold, poolCatType's — `type: income` AND
   `interest: true` in the category's own frontmatter, the opt-in flag load.js
   already reads and splitFlows already treats as growth. Nothing else reads as
   interest: not a category NAME, not a fees-typed row, not `excluded`. The
   household says it, or it is not said. That keeps this narrowing inside the
   existing "nothing is skipped on the strength of a row's own flags" decision
   rather than re-opening it — a declared flag is a statement; a flag the
   loader set is not.

     node tests/savings-interest-not-saving.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { savedFromOutside, poolCatType } = require('../src/savings-math');

let checks = 0;
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

/* ---- 1. END TO END, through the real loader and the real ctx -------------

   The wiring is half the fix: savedFromOutside can only apply this rule if the
   `catType` its callers inject can ANSWER 'interest', and declaredCatType
   could not — it read the raw `type` and reported 'income'. Driving it through
   makeCtx is what would have caught that, so it is pinned here rather than in
   a unit test with a hand-written category table. */
at('2026-09-15', async () => {
  const FILES = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    /* Two income-typed categories, ONE of them flagged. That pair is the whole
       point: `type` alone cannot tell a fund's own interest from a UIF payment
       landing in the same account, which is why the flag exists. */
    [`${B}/Categories/Interest income.md`]: '---\ntype: income\ninterest: true\n---\n',
    [`${B}/Categories/UIF.md`]: '---\ntype: income\n---\n',
    [`${B}/Categories/Bank charges & fees.md`]: '---\ntype: expense\n---\n',
    [`${B}/Accounts/Emergency fund.md`]: '---\ntype: savings\ntx_label: "Emergency fund"\nemergency_fund: true\nbalance: 50000\nbalance_updated: 2026-09-01\n---\n',
    [`${B}/Transactions/Emergency fund/2026-09.md`]: tx([
      ['2026-09-03', 'Interest Earned at 7.20%', 'Interest income', 632.63],
      ['2026-09-10', 'UIF payout', 'UIF', 40000],
    ]),
  };
  const ctx = makeCtx(FILES, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = '2026-09';

  eq(poolCatType(S.categories, 'Interest income'), 'interest',
    'the fold that already exists is the one this rule reads — a flagged income category is interest');
  eq(ctx.declaredCatType('Interest income'), 'interest',
    'and declaredCatType now carries that fold through, or savedFromOutside can never see the flag');
  eq(ctx.declaredCatType('UIF'), 'income',
    'an income category the household did NOT flag still reports income — the flag is opt-in');
  eq(ctx.declaredCatType('Bank charges & fees'), 'expense',
    'and an ordinary typed category is untouched');

  const rows = [];
  for (const f of Object.values(S.txFiles)) for (const r of f.rows) rows.push({ ...r, label: f.label });
  const pool = new Map([['Emergency fund', 'Emergency fund']]);

  eq(savedFromOutside(rows, pool, ctx.declaredCatType), 40000,
    'the R40 000 UIF paid straight into the fund is still saving; the R632.63 the fund earned itself is not');
  eq(ctx.movedToFunds('2026-09', '2026-09-15'), 40000,
    'and the Dashboard hero\'s "moved so far" reads the same figure — interest never moved anywhere');

  console.log(`savings-interest-not-saving.test.cjs — ${checks} checks OK`);
});

/* ---- 2. the unit rule, and the three things it must NOT do -------------- */
{
  const POOL = new Map([['Emergency fund', 'Emergency fund'], ['Baby fund', 'Baby fund']]);
  /* The shape poolCatType produces: 'interest' for the flagged category, the
     raw type for everything else. */
  const catType = c => ({
    'Interest income': 'interest', UIF: 'income', Groceries: 'expense',
    'Bank charges & fees': 'expense', Saving: 'savings', Transfer: 'transfer',
  }[c] || null);

  const interestOnly = [{ date: '2026-08-31', label: 'Emergency fund', amount: 632.63, cat: 'Interest income' }];
  eq(savedFromOutside(interestOnly, POOL, catType), 0,
    'interest credited inside the pool is growth the pool made for itself, not saving');

  eq(savedFromOutside(interestOnly, POOL), 632.63,
    'without a category table the old answer is unchanged — a caller that has not been taught keeps what it had');

  /* An interest credit has no other leg, so it must not enter the pairing at
     all — merely not COUNTING it would leave it free to absorb an equal
     outflow that some other inflow is the real partner of, and each outflow
     cancels only one inflow. Measured on the shape that shows it: an ordinary
     movement out of the baby fund into the emergency fund, with interest
     credited the same day.

     Without this, the interest row consumed the -R5 000 leg and the R5 000
     that arrived from the baby fund was counted as fresh saving — the 1.23.0
     overstatement, arriving through a row nobody moved. The invariant is the
     honest way to say it: an interest credit changes NOTHING. */
  const move = [
    { date: '2026-08-31', label: 'Baby fund', amount: -5000, cat: 'Saving' },
    { date: '2026-08-31', label: 'Emergency fund', amount: 5000, cat: 'Saving' },
  ];
  const withInterest = [...move, { date: '2026-08-31', label: 'Emergency fund', amount: 5000, cat: 'Interest income' }];
  eq(savedFromOutside(move, POOL, catType), 0,
    'the movement on its own is not saving — both legs are inside the pool');
  eq(savedFromOutside(withInterest, POOL, catType), savedFromOutside(move, POOL, catType),
    'and adding an interest credit changes nothing: it is not saving, and it is not a leg either');

  /* The outflow side is deliberately untouched: `catType` still reaches it only
     through looksLikeSpending, and 'interest' is outside INTERNAL_LEG_TYPES
     exactly as 'income' was, so the ISSUE 32 reading is unchanged. */
  const mirrored = [
    { date: '2026-08-01', label: 'Baby fund', amount: -5000, cat: 'Groceries' },
    { date: '2026-08-28', label: 'Emergency fund', amount: 5000, cat: 'Saving' },
  ];
  eq(savedFromOutside(mirrored, POOL, catType), 5000,
    'ISSUE 32 is untouched — a pram bought from a fund still cannot be paired away against a later deposit');

  const slowTransfer = [
    { date: '2026-08-01', label: 'Baby fund', amount: -5000, cat: 'Saving' },
    { date: '2026-08-04', label: 'Emergency fund', amount: 5000, cat: 'Saving' },
  ];
  eq(savedFromOutside(slowTransfer, POOL, catType), 0,
    'and a genuinely slow settlement still pairs');
}

/* ---- 3. THE RULE IS NOT WIDENED TO CATCH A MISCATEGORISED ROW ------------

   On the vault that prompted this, the R632.63 interest row is filed under
   "Bank charges & fees" — an expense-typed category. That is a
   miscategorisation on the household's side, and the fix for it is to move the
   row, not to teach the app that a fees-typed CREDIT is interest. Keying on a
   name ("Interest Earned at 7.20%") or on a fee type would guess at free text
   the way worth.js's cardOverlap refuses to, and would silently drop a real
   fee REFUND out of the saving. So this case is pinned as still counted, on
   purpose, so that widening the rule goes red rather than quiet. */
{
  const POOL = new Map([['Emergency fund', 'Emergency fund']]);
  const catType = c => ({ 'Bank charges & fees': 'expense', 'Interest income': 'interest' }[c] || null);
  const misfiled = [{ date: '2026-08-31', label: 'Emergency fund', amount: 632.63, cat: 'Bank charges & fees' }];
  eq(savedFromOutside(misfiled, POOL, catType), 632.63,
    'a fees-typed credit is NOT read as interest — the household recategorises the row; the app does not guess');
}
/* The summary prints inside the dated block above — it is a microtask, so it
   runs after these synchronous sections and counts them. */
