'use strict';
/* ISSUE 39 — net worth ignores money owed to you.

   THE DEFECT, reproduced on 2026-09-02 against the `BudgetAudit` household
   (tests/_audit-seed.cjs): R2 000 lent to Thabo on 2026-06-01, still
   outstanding, and a Dashboard net worth of exactly

     R20 000 cheque + R15 000 emergency + R8 000 baby + R85 000 Polo − R8 000 card

   = R120 000, with the receivable nowhere in it. worth() summed account
   balances plus assets minus debts and took no `owed` argument at all, so
   there was no route by which it could have been counted.

   What makes this more than an omission is where the card said it. The
   position band computes owedSummary() four lines from its own worth() call
   and prints the receivable in its own tile — so ONE card read the Owed ledger
   twice and put it in only one of the two figures. The copy underneath net
   worth reads "owned · owed", where that "owed" is liabilities; the reader was
   left with no word for money owed TO them and no line that counted it. "Two
   figures derived by different rules" is this repository's most-repeated bug
   shape, and here both figures were on the same card.

   WHAT IS PINNED

     1. The pure rule: receivables are OWNED, they are net of what has come
        back, a settled row is history, and a foreign loan is held out and
        NAMED rather than converted — the same three rules the assets and
        debts ledgers beside it already follow.
     2. outstandingOf(), not a second subtraction. A part-recovered loan
        (R2 000 lent, R500 back) is R1 500 of receivable, and the Owed page
        and the balance sheet must not each work that out for themselves.
     3. The three-argument contract is untouched, so views/accounts.js's hero
        — the declared exception, which is about bank money and says so —
        still gets exactly the figure it always got.
     4. The whole household, end to end through the REAL loader: the audit
        vault's net worth is R122 000, not R120 000.

   The four SURFACES that must agree (Dashboard tile, Savings tile, Savings
   composition chart, Score) are pinned in tests/vocabulary.test.cjs's Net
   worth term, which asserts they share one expression — the right place for
   "nobody drifted", as opposed to this file's "the rule is right".

     node tests/net-worth-receivables.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { SEED, atAuditDate } = require('./_audit-seed.cjs');
const { worth, owedTotal } = require('../src/worth');
const { owedSummary, outstandingOf } = require('../src/owed-math');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ------------------------------ 1. the rule ------------------------------ */
const ACC = [{ balance: 20000 }];
const OUT = { person: 'Thabo', amount: 2000, repaid: 0, status: 'outstanding' };
const PART = { person: 'Sam', amount: 2000, repaid: 500, status: 'outstanding' };
const PAID = { person: 'Lee', amount: 3000, repaid: 3000, status: 'paid' };
const EURO = { person: 'Elena', amount: 500, status: 'outstanding', currency: '€' };

eq(owedTotal([OUT], 'R'), 2000, 'an outstanding loan is owned');
eq(owedTotal([PART], 'R'), 1500, 'net of what has come back — not the 2 000 lent');
eq(owedTotal([PAID], 'R'), 0, 'a settled row is history, the way a paid debt is');
eq(owedTotal([EURO], 'R'), 0, 'a foreign loan is held out of a rand total');
eq(owedTotal([OUT, EURO]), 2500,
  'and with NO household symbol it adds everything — every caller not yet taught about currencies is unchanged');

/* Not a second subtraction. If this file re-spelled `amount - repaid` it would
   be the very thing owed-math.js exists to stop, and would drift the day a
   hand-set `paid` status starts overriding the arithmetic differently. */
eq(owedTotal([PART], 'R'), outstandingOf(PART),
  'the receivable is outstandingOf(), never a second reading of the same row');

/* ---------------------- 2. it reaches the balance sheet ------------------ */
{
  const w = worth(ACC, null, null, 'R', [OUT, PART, PAID, EURO]);
  eq(w.ownedOwed, 3500, 'the receivables ledger is separable on the way out, like the other two');
  eq(w.assets, 23500, 'and owned counts it: R20 000 cash + R3 500 still out on loan');
  eq(w.net, 23500, 'so does net worth');
  eq(w.otherCurrencies.owed, [['€', 500]],
    'and what was held out is NAMED per ledger, so no page can drop it quietly');

  /* The three-argument contract, unchanged. accounts.js's hero is the declared
     exception — it is about bank money, calls itself "Net across your
     accounts", and must not silently acquire a receivable. */
  eq(worth(ACC, null, null, 'R').net, 20000,
    'a caller that passes no owed list gets exactly the figure it always got');
  eq(worth(ACC, null, null, 'R').ownedOwed, 0,
    'and is told so as a zero rather than an undefined a template would print');
}

/* -------------------- 3. the household, through the loader --------------- */
/* Every rendered assertion below runs on 2026-09-02, the day of the audit —
   see atAuditDate's own note for why the real clock would make this file
   stop testing anything in October. */
atAuditDate(async () => {
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);

  const o = owedSummary(S.owed, undefined, S.settings.currency);
  eq(o.outstanding, 2000, 'the audit vault really does have R2 000 out on loan');

  const before = worth(S.accounts, S.debts, S.assets, S.settings.currency);
  const after = worth(S.accounts, S.debts, S.assets, S.settings.currency, S.owed);
  eq(before.net, 120000, 'the figure the live audit saw: 20 + 15 + 8 + 85 − 8');
  eq(after.net, 122000, 'and the one that counts every ledger the household has');

  /* ISSUE 44 landed after this one and moved the ACCOUNTS half to implied
     balances: the R1 200 Checkers shop of 2 September takes cheque to
     R18 800. The receivable is unaffected by that — it is a different ledger —
     so the two fixes compose rather than overlap, which is what the score
     assertion below is really checking. */
  const asOfToday = worth(ctx.impliedAccounts(), S.debts, S.assets, S.settings.currency, S.owed);
  eq(asOfToday.net, 120800, 'as of today, with the receivable and the day\'s spending both counted');
  eq(asOfToday.ownedOwed, 2000, 'and the receivable is untouched by the as-of change');

  /* The identity that makes this a fix rather than a nudge: the tile that
     already printed the receivable and the total that ignored it are now one
     ledger read once. */
  eq(after.net - before.net, o.outstanding,
    'the whole of the difference is exactly what the Owed tile beside it already said');
  eq(after.ownedOwed, o.outstanding,
    'and the balance sheet and the Owed page cannot state different receivables');

  const snap = ctx.healthSnapshot();
  eq(snap.metrics.netWorth, asOfToday.net,
    'the Score reads the same net worth the Dashboard does — it divides this by income, so a missing ledger here is a wrong ratio, not just a wrong total');

  console.log(`PASS net-worth-receivables (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
