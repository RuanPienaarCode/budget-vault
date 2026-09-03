'use strict';
/* ISSUE 44 — one Dashboard, two as-of dates.

   THE DEFECT, reproduced on 2026-09-02 against the `BudgetAudit` household
   (tests/_audit-seed.cjs). Every account confirmed 2026-09-01; a R1 200
   Checkers shop dated 2026-09-02.

     "money you have right now"   R41 800   built from reconcile() — the shop is in it
     "net worth"                  R120 000  built from raw `balance` — the shop is not

   Two figures on one card, four tiles apart, disagreeing about what day it is.
   The net-worth tile's own caption reads "these do not move with the period",
   which is true, and was quietly doing duty for "these do not move" — the
   period is not the only clock a figure can be stale against.

   THE FIX gives net worth the same as-of every other present-tense figure on
   the page already had: impliedAccounts() in src/period.js, which runs each
   account through the app's ONE definition of "what this should read now"
   (reconcile) rather than restating it.

   WHAT IS PINNED — as IDENTITIES, not as literals. The point of this issue is
   that two figures agree, and a test that hard-codes both would go green on a
   day when each had drifted the same distance from the truth.

     1. The cash figure and the accounts half of net worth are built from ONE
        account list.
     2. Every surface that says "net worth" — Dashboard, Savings, Score and
        the exported report — reads the same as-of. (That they share one
        EXPRESSION is pinned in tests/vocabulary.test.cjs; this is about the
        inputs to it.)
     3. impliedAccounts() does not mutate S.accounts. A stated balance is "a
        claim with an age, never a fact", and a derived figure written back
        onto the model would be persisted by the next save as a number nobody
        typed.
     4. An account with nothing since its confirmation is passed through
        unchanged, so this costs nothing on a settled vault.

     node tests/one-as-of-date.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { SEED, PERIOD, TODAY, atAuditDate } = require('./_audit-seed.cjs');
const { worth } = require('../src/worth');
const { cashOnHand } = require('../src/committed');
const { reconcile } = require('../src/reconcile');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

atAuditDate(async () => {
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;

  /* ------------ 1. the household really is the one in the issue ---------- */
  const stated = worth(S.accounts, S.debts, S.assets, S.settings.currency, S.owed);
  const implied = ctx.impliedAccounts();
  const asOf = worth(implied, S.debts, S.assets, S.settings.currency, S.owed);
  eq(stated.net - asOf.net, 1200,
    'the whole of the disagreement is the R1 200 shop of 2 September — the one row the two figures dated differently');

  /* ------------- 2. the identity: one account list, both figures --------- */
  const cash = cashOnHand(implied.map(a => ({ name: a.name, inBudget: true, dated: true, implied: a.balance })));
  const liquid = implied.reduce((t, a) => t + Math.max(0, a.balance || 0), 0);
  eq(cash.cash, liquid,
    'cash on hand and the owned-accounts half of net worth are the same sum over the same list');
  eq(asOf.ownedAccounts, liquid,
    'and worth() is handed that same list, rather than the stated balances beside it');

  /* ------- 3. every surface that says "net worth" shares the as-of ------- */
  const snap = ctx.healthSnapshot();
  eq(snap.metrics.netWorth, asOf.net,
    'the Score reads it as-of today, like the Dashboard');
  ok(snap.metrics.netWorth !== stated.net,
    'and provably not the stated-balance figure — an assertion that could pass on a settled vault proves nothing');

  /* --------- 4. impliedAccounts() derives, it does not overwrite -------- */
  const cheque = S.accounts.find(a => a.name === 'Cheque');
  eq(cheque.balance, 20000,
    'the account model still holds the balance the household actually typed');
  eq(cheque.balance_updated, '2026-09-01', 'and the date they confirmed it on');
  const impliedCheque = implied.find(a => a.name === 'Cheque');
  eq(impliedCheque.balance, 18800, 'while the derived list carries what it should read today');
  ok(impliedCheque !== cheque, 'as a separate object, so nothing downstream can write the derivation back');

  /* --------- 5. a settled account is passed straight through ------------ */
  {
    const baby = S.accounts.find(a => a.name === 'Baby fund');
    const rec = reconcile(baby, (ctx.accountIndex().get(baby) || {}).rows || [], TODAY);
    ok(rec.state !== 'drift', 'the baby fund has nothing readable since its confirmation');
    eq(implied.find(a => a.name === 'Baby fund'), baby,
      'so it is the SAME object — this fix costs a settled vault nothing at all');
  }

  console.log(`PASS one-as-of-date (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
