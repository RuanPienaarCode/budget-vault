'use strict';
/* The dashboard's first-steps checklist (src/first-steps.js).

   The wizard used to end on a sentence of homework — "give your categories an
   amount, then import your bank's CSV" — and then go quiet. The checklist is
   that sentence turned into five things the reader can see ticking off. What
   makes it trustworthy is that no tick is ever STORED: each one is read off
   the same files every other figure in the app is read off, so a reader who
   types the budget in by hand, or turns the card on over an old vault, gets
   exactly the ticks the files have earned and no others.

   What this pins:
     1. a fresh vault is 0 of 5 and points at the budget first;
     2. a budget of zeros is not a budget;
     3. a CSV household is in after one row, a manual one after five, and a
        split's parts are not extra transactions;
     4. "sorted" waits for spending, is blocked by one blank category in the
        current period, and does not ask the reader to categorise a split
        parent whose parts already are (which rows the budget counts at all —
        transfers, non-budget accounts — is the CALLER's lens; the card test
        pins that over the real loader);
     5. the balance the WIZARD wrote does not count, but the reader checking
        an account — even the same day — does: compared by stamp, not date;
     6. the first month is finished the day AFTER it ends, not on its last day;
     7. `next` is the first undone step in order, and a full house is complete;
     8. each step names the page where it is done;
     9. the module is pure — no obsidian, no clock.

     node tests/first-steps.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { firstSteps, stepTarget, STEP_KEYS, firstStepsOn, balanceStamps } = require('../src/first-steps');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const SINCE = '2026-11-05';
const base = over => Object.assign({
  mode: 'csv', since: SINCE, today: SINCE, sincePeriodEnd: '2026-11-30',
  budgetRows: [], rows: [], periodRows: [], accounts: [{ name: 'Cheque', balance_updated: SINCE }],
}, over);
const doneOf = (r, k) => r.steps.find(s => s.key === k).done;
/* Keys are the LOADER's (table-schema.js): `desc` and `cat`, not description/category. */
const tx = (o = {}) => Object.assign({ date: '2026-11-04', desc: 'x', cat: 'Groceries', amount: -10, excluded: false, split: '' }, o);

/* 1 */
{
  const r = firstSteps(base());
  eq(r.steps.map(s => s.key), STEP_KEYS, 'five steps, in order');
  eq(STEP_KEYS, ['budget', 'spending', 'sorted', 'balance', 'month'], 'the five milestones');
  eq(r.done, 0, 'fresh vault: nothing done');
  eq(r.total, 5, 'out of five');
  eq(r.next, 'budget', 'the budget comes first');
  eq(r.complete, false, 'not complete');
}

/* 2 */
{
  eq(doneOf(firstSteps(base({ budgetRows: [{ category: 'Groceries', amount: 0 }] })), 'budget'), false, 'all-zero budget is not done');
  eq(doneOf(firstSteps(base({ budgetRows: [{ category: 'Groceries', amount: NaN }] })), 'budget'), false, 'an unreadable amount is not an amount');
  eq(doneOf(firstSteps(base({ budgetRows: [{ category: 'Groceries', amount: 0 }, { category: 'Salary', amount: 25000 }] })), 'budget'), true, 'one real line is a budget');
}

/* 3 */
{
  eq(doneOf(firstSteps(base({ rows: [tx()] })), 'spending'), true, 'CSV: one imported row is in');
  const four = [tx(), tx(), tx(), tx()];
  eq(doneOf(firstSteps(base({ mode: 'manual', rows: four })), 'spending'), false, 'manual: four is not five');
  eq(doneOf(firstSteps(base({ mode: 'manual', rows: [...four, tx()] })), 'spending'), true, 'manual: five is in');
  const splitThree = [tx({ excluded: true, split: 'parent' }), tx({ split: 'part' }), tx({ split: 'part' }), tx(), tx()];
  eq(doneOf(firstSteps(base({ mode: 'manual', rows: splitThree })), 'spending'), false,
    'a parent and its two parts are ONE transaction, so this is three, not five');
}

/* 4 */
{
  eq(doneOf(firstSteps(base()), 'sorted'), false, 'nothing to sort is not sorted — spending comes first');
  const rows = [tx()];
  eq(doneOf(firstSteps(base({ rows, periodRows: rows })), 'sorted'), true, 'every row categorised');
  const blank = [tx(), tx({ cat: '  ' })];
  eq(doneOf(firstSteps(base({ rows: blank, periodRows: blank })), 'sorted'), false, 'one blank category blocks it');
  const split = [tx({ cat: '', excluded: true, split: 'parent' }), tx({ split: 'part' }), tx({ split: 'part', cat: 'Clothing' })];
  eq(doneOf(firstSteps(base({ rows: split, periodRows: split })), 'sorted'), true,
    'a split parent is described by its parts — its own blank category is not the reader\'s job');
  eq(doneOf(firstSteps(base({ rows, periodRows: [] })), 'sorted'), true,
    'a new period with nothing in it yet has nothing left to sort');
}

/* 5 — the balance step compares each account against the STAMP setup left
   on it (balance and date together), not dates alone. Dates alone could not
   tell the wizard's own setup-day stamp from the reader checking the account
   that same afternoon — the very thing the card asks them to do — so the step
   was unfinishable on the day it was offered. */
{
  const wizard = { name: 'Cheque', balance: 100, balance_updated: SINCE };
  const stamps = balanceStamps([wizard]);
  eq(stamps, { Cheque: '100|' + SINCE }, 'a stamp is balance and date');
  eq(doneOf(firstSteps(base({ accounts: [wizard], stamps })), 'balance'), false,
    'the balance the wizard wrote is not a check');
  eq(doneOf(firstSteps(base({ accounts: [{ ...wizard, balance: 2500 }], stamps })), 'balance'), true,
    'the reader typing in their bank\'s figure the SAME day counts');
  eq(doneOf(firstSteps(base({ accounts: [{ ...wizard, balance_updated: '2026-11-12' }], stamps })), 'balance'), true,
    'the same figure confirmed on a later day counts');
  eq(doneOf(firstSteps(base({ accounts: [{ ...wizard, balance: 90, balance_updated: '2026-11-01' }], stamps })), 'balance'), true,
    'accepting the app\'s figure (stamped with the last row\'s date, before setup) counts');
  eq(doneOf(firstSteps(base({ accounts: [{ ...wizard, balance_updated: '12 Nov' }], stamps })), 'balance'), false,
    'an unreadable date proves nothing');
  eq(doneOf(firstSteps(base({ accounts: [wizard, { name: 'Card', balance: -300, balance_updated: SINCE }], stamps })), 'balance'), true,
    'an account added after setup, with a balance stated since, counts');
  eq(doneOf(firstSteps(base({ accounts: [{ name: 'Old', balance: 5, balance_updated: '2026-10-01' }], stamps })), 'balance'), false,
    'an account setup never saw, last stated before setup, does not');
  eq(doneOf(firstSteps(base({ accounts: [] , stamps })), 'balance'), false, 'no accounts');
  eq(doneOf(firstSteps(base({ accounts: [wizard], stamps: null })), 'balance'), false,
    'with no snapshot at all, setup day proves nothing (the card always passes one)');
  eq(doneOf(firstSteps(base({ accounts: [{ ...wizard, balance_updated: '2026-11-12' }], stamps: null })), 'balance'), true,
    'and a later date still does');
}

/* 6 */
{
  eq(doneOf(firstSteps(base({ today: '2026-11-30' })), 'month'), false, 'the last day is still inside the month');
  eq(doneOf(firstSteps(base({ today: '2026-12-01' })), 'month'), true, 'the day after it ends');
  eq(doneOf(firstSteps(base({ today: '2026-12-01', sincePeriodEnd: '' })), 'month'), false, 'no period end, no claim');
}

/* 7 */
{
  const rows = [tx()];
  const r = firstSteps(base({ budgetRows: [{ amount: 1 }], rows, periodRows: rows }));
  eq(r.done, 3, 'budget, spending, sorted');
  eq(r.next, 'balance', 'the first undone step');
  const r2 = firstSteps(base({ rows, periodRows: rows }));
  eq(r2.next, 'budget', 'order is fixed: an undone budget is next even with later steps done');
  const all = firstSteps(base({
    budgetRows: [{ amount: 1 }], rows, periodRows: rows,
    accounts: [{ balance_updated: '2026-11-20' }], today: '2026-12-02',
  }));
  eq(all.complete, true, 'full house');
  eq(all.next, null, 'nothing next');
  eq(all.done, 5, 'five of five');
}

/* 8 */
{
  eq(stepTarget('budget', 'csv'), 'budgets', 'budget → Budgets');
  eq(stepTarget('spending', 'csv'), 'import', 'CSV spending → Import');
  eq(stepTarget('spending', 'manual'), 'transactions', 'manual spending → Transactions');
  eq(stepTarget('sorted', 'csv'), 'transactions', 'sorting → Transactions');
  eq(stepTarget('balance', 'manual'), 'accounts', 'balance → Accounts');
  eq(stepTarget('month', 'csv'), null, 'the month finishes itself — no page to send anyone to');
  eq(firstStepsOn({ firstSteps: 'on' }), true, 'on');
  eq(firstStepsOn({ firstSteps: 'done' }), false, 'done stays gone');
  eq(firstStepsOn({}), false, 'absent is off: an upgraded vault does not grow a card overnight');
}

/* 9 */
{
  const src = fs.readFileSync(path.join(__dirname, '../src/first-steps.js'), 'utf8');
  ok(!/require\(['"]obsidian['"]\)/.test(src), 'no obsidian');
  ok(!/new Date\(|Date\.now\(/.test(src), 'no clock — today is injected');
}

console.log(`PASS first-steps (${checks} checks)`);
