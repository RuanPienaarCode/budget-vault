'use strict';
/* savedFromOutside() — the pairing rule, held to what its own header promises.

   The header above the predicate (savings-math.js, "THE OTHER LEG") states the
   rule in these words:

     "an equal and opposite row, in a DIFFERENT savings account, WITHIN A FEW
      DAYS. Matched legs cancel and neither counts... A sinking-fund purchase
      has no such counterpart — the money went to a shop, not to another
      account of yours — so it never matches and never reduces the rate."

   The code tested only the first two clauses. There was no date test at all,
   so "within a few days" was not enforced anywhere, and no counterparty test,
   so "the money went to a shop" was decided purely by whether some OTHER
   savings account happened to have an outflow of the same magnitude somewhere
   in the same period. On a household running sinking funds — which is the
   shape this whole rule was written to protect — that is not a rare
   coincidence, it is the normal month:

     1 Aug   Emergency fund   +5 000   (a real deposit from the cheque account)
     28 Aug  Baby fund        -5 000   (the pram, bought from the fund)

   Twenty-seven days apart, unrelated, opposite accounts, equal magnitude — so
   they paired, cancelled, and the period reported R0 saved. Change the pram to
   R4 999 and the same month reports R5 000. A rounding of the shop's price
   moved the household's savings rate by the whole deposit, which is the
   signature of a predicate matching on the wrong thing.

   This feeds the Score's savings-rate pillar through health-data.js, so the
   figure is not merely displayed — it is scored.

   WHAT THE FIX IS, AND WHY IT IS NOT A WINDOW. The obvious repair — "the two
   legs must fall within N days" — was written first and rejected, because
   tests/household-shapes.test.cjs pins the opposite with its own negative
   control and its own header explaining why: the savings rate must not move
   with how fast a bank settles. The shipped defect it guards was a score
   stepping 66 -> 76 because two legs of one transfer landed four days apart
   instead of three — "one number, two cliffs, both set by a bank" — and a
   symmetric window puts that cliff straight back at its far end.

   So the test is a DIRECTION: money cannot arrive before it leaves. An outflow
   dated AFTER the inflow it would cancel is a later decision, not that
   inflow's other leg. The pram fails that; a transfer never does, however
   slowly it settles, because settlement lag only ever pushes the arrival later
   and later is allowed without limit. The three-day allowance pinned in
   section 3 runs the OTHER way, and is not a settlement window at all: it
   absorbs two institutions value-dating one movement in the opposite order.

   Section 4 keeps the OLD predicate alive as a NEGATIVE CONTROL, the way
   tests/share-percent-label.test.cjs keeps its naive per-slice rounder: a test
   that only asserts the new answer goes green again the day someone
   "simplifies" the ordering test away.

   Section 7 pins what this rule still CANNOT see, so the limit is a recorded
   decision rather than a gap someone rediscovers.

     node tests/savings-paired-legs-window.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const { savedFromOutside } = require(path.join(SRC, 'savings-math.js'));

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The pool: two savings accounts, addressed by the transaction label their
   folders carry. saverLabels is the caller's answer to "what counts as the
   pool" — health-data.js and views/score.js each build one. */
const POOL = new Map([
  ['Emergency fund', { name: 'Emergency fund', type: 'savings' }],
  ['Baby fund', { name: 'Baby fund', type: 'savings' }],
  ['Car fund', { name: 'Car fund', type: 'savings' }],
]);

const tx = (date, label, amount) => ({ date, label, amount, cat: 'Saving' });

/* ---- 1. the measured bug: a sinking-fund purchase must not cancel a deposit ---- */
{
  const month = spend => [
    tx('2026-08-01', 'Emergency fund', 5000),
    tx('2026-08-28', 'Baby fund', spend),
  ];
  eq(savedFromOutside(month(-5000), POOL), 5000,
    'a pram bought 27 days later does not undo August\'s deposit');
  eq(savedFromOutside(month(-4999), POOL), 5000,
    'and the same month reads the same when the shop charges one rand less');
  /* The two answers agreeing is the whole point. Before the window existed
     they were 0 and 5 000 — a R1 difference in an unrelated purchase moving
     the scored figure by the entire deposit. */
  eq(savedFromOutside(month(-5000), POOL), savedFromOutside(month(-4999), POOL),
    'the answer cannot hinge on whether an unrelated purchase happens to match to the cent');
}

/* ---- 2. a genuine internal transfer still cancels, at any settlement lag ----
   This is what the pairing is FOR, and it must keep working: money moved from
   the baby fund into the emergency fund is not new saving, and counting it
   would restore the R1 250-a-month overstatement 1.23.0 shipped. */
{
  const sameDay = [
    tx('2026-08-10', 'Baby fund', -4270),
    tx('2026-08-10', 'Emergency fund', 4270),
  ];
  eq(savedFromOutside(sameDay, POOL), 0, 'a same-day move between two pool accounts is not saving');

  const nextDay = [
    tx('2026-08-10', 'Baby fund', -4270),
    tx('2026-08-11', 'Emergency fund', 4270),
  ];
  eq(savedFromOutside(nextDay, POOL), 0, 'an overnight clearing is still one movement');

  /* HOWEVER SLOWLY IT SETTLES. This is the property
     tests/household-shapes.test.cjs guards from the other side, restated here
     so a future change to this predicate fails in the file it belongs to
     rather than only in that one: forward lag is unbounded, so the answer
     cannot move with a bank's clearing speed. */
  const slow = days => {
    const d = String(10 + days).padStart(2, '0');
    return [tx('2026-08-10', 'Baby fund', -3000), tx(`2026-08-${d}`, 'Emergency fund', 3000)];
  };
  for (const lag of [0, 3, 4, 7, 11, 17]) {
    eq(savedFromOutside(slow(lag), POOL), 0,
      `a shuffle between two pots is not saving at ${lag} days' lag either`);
  }
}

/* ---- 3. the one allowance, and it runs backwards ----
   Two institutions occasionally value-date one movement in the opposite order,
   so the receiving leg can carry the earlier date. Three days covers that
   artefact; beyond it an outflow that follows an inflow is a later decision. */
{
  const backstamped = days => {
    const d = String(10 + days).padStart(2, '0');
    return [tx('2026-08-10', 'Emergency fund', 4270), tx(`2026-08-${d}`, 'Baby fund', -4270)];
  };
  eq(savedFromOutside(backstamped(3), POOL), 0,
    'a movement whose credit was stamped three days before its debit is still one movement');
  eq(savedFromOutside(backstamped(4), POOL), 4270,
    'four days the wrong way round is a purchase after a deposit, not a transfer');

  /* A leg nothing can date cannot be ordered against anything, so it does not
     cancel. Same reading reconcile.js takes of an unplaceable row: the app
     does not get to assume the convenient answer about a date it cannot read. */
  const undatable = [
    tx('2026-08-10', 'Baby fund', -1000),
    tx('2026-13-05', 'Emergency fund', 1000),
  ];
  eq(savedFromOutside(undatable, POOL), 1000,
    'a row nothing can date is not silently paired with one it can');
}

/* ---- 4. NEGATIVE CONTROL — the predicate that shipped ----
   Magnitude and a different account, with no date test. Kept runnable so the
   file fails the day the window is removed rather than quietly agreeing with
   whatever the module now does. */
{
  const naive = (rows, labels) => {
    const inflows = [], outflows = [];
    for (const r of rows) {
      const a = labels.get(r.label);
      if (!a || !r.amount) continue;
      (r.amount > 0 ? inflows : outflows).push({ acct: a, row: r });
    }
    const spent = new Set();
    let saved = 0;
    for (const { acct, row } of inflows) {
      const j = outflows.findIndex((o, i) => !spent.has(i)
        && o.acct !== acct
        && Math.abs(-o.row.amount - row.amount) < 0.005);
      if (j !== -1) { spent.add(j); continue; }
      saved += row.amount;
    }
    return saved;
  };

  const month = [tx('2026-08-01', 'Emergency fund', 5000), tx('2026-08-28', 'Baby fund', -5000)];
  eq(naive(month, POOL), 0, 'the old predicate cancelled the deposit against the pram');
  ok(savedFromOutside(month, POOL) !== naive(month, POOL),
    'the shipped rule and the old one MUST disagree on the case the fix exists for');

  // ...and agree on the case the pairing was written for, so the control is
  // measuring the date test alone and not a wholesale change of behaviour.
  const transfer = [tx('2026-08-10', 'Baby fund', -4270), tx('2026-08-10', 'Emergency fund', 4270)];
  eq(naive(transfer, POOL), savedFromOutside(transfer, POOL),
    'both agree that a same-day internal move is not saving');
}

/* ---- 5. one outflow can still only cancel one inflow ----
   Two genuine deposits are never swallowed by a single withdrawal, window or
   no window — the property the `spent` set exists for. */
{
  const rows = [
    tx('2026-08-10', 'Car fund', -2000),
    tx('2026-08-10', 'Emergency fund', 2000),
    tx('2026-08-11', 'Baby fund', 2000),
  ];
  eq(savedFromOutside(rows, POOL), 2000, 'one leg out cancels one leg in, not both');
}

/* ---- 6. money from OUTSIDE the pool is saving, whatever it is called ----
   The regression this rule replaced a category test to avoid: a household
   moving R10 000 from its cheque account into Investments labels it
   `Investing` — a savings-typed category naming the DESTINATION. The cheque
   account is not in `saverLabels`, so its leg never reaches the pairing. */
{
  const rows = [
    { date: '2026-08-25', label: 'Cheque', amount: -10000, cat: 'Investing' },
    tx('2026-08-25', 'Emergency fund', 10000),
  ];
  eq(savedFromOutside(rows, POOL), 10000, 'a leg outside the pool is not a leg');
}

/* ---- 7. THE LIMIT, now CLOSED — ISSUE 32 ----
   The mirror of the pram: a fund purchase EARLY in the month and an equal,
   unrelated deposit LATER. By dates alone it is indistinguishable from a slow
   transfer, which is why this section stood as a pinned limit rather than a
   fix. What settles it is the outflow's CATEGORY — a real expense, against the
   transfer- or savings-typed category a transfer leg carries — and
   savedFromOutside now takes an optional `catType` third argument to reach it.

   CONSULTED ONLY WHERE THE DATES HAVE RUN OUT, and that narrowing is the
   whole design. tests/health-data.test.cjs pins a household moving R5 000
   between two savings accounts every month and labelling it `Move`, a category
   it has typed `expense` — an internal move, mislabelled, with both legs on
   the SAME DAY. On category alone this fix would refuse to pair those and
   credit R5 000 a month of saving that never happened, which is the 1.23.0
   overstatement the pairing exists to end. Inside the settlement window the
   dates are evidence enough and the label adds nothing; weeks apart they have
   stopped being evidence, and the label is all that is left.

   Still no symmetric window: the cliff tests/household-shapes.test.cjs keeps
   shut stays shut, because nothing here widened what counts as "the same
   movement" — it narrowed what counts as a leg. */
{
  /* The pram carries a real expense category, because that IS the signal —
     `tx` above stamps every row `Saving`, which is the transfer-leg label and
     would leave this case exactly as unresolvable as it was. */
  const pram = { date: '2026-08-01', label: 'Baby fund', amount: -5000, cat: 'Groceries' };
  const mirrored = [pram, tx('2026-08-28', 'Emergency fund', 5000)];
  const catType = c => ({ Groceries: 'expense', Move: 'expense', Saving: 'savings', Transfer: 'transfer', Investing: 'investment' }[c] || null);

  eq(savedFromOutside(mirrored, POOL), 0,
    'without a category table the old answer is unchanged — every existing caller keeps the behaviour it had');
  eq(savedFromOutside(mirrored, POOL, catType), 5000,
    'ISSUE 32: with one, a pram bought from a fund can no longer be paired away against a later deposit');

  /* The three cases the narrowing exists to protect. */
  const sameDayMislabelled = [
    { date: '2026-08-15', label: 'Baby fund', amount: -5000, cat: 'Move' },
    { date: '2026-08-15', label: 'Emergency fund', amount: 5000, cat: 'Move' },
  ];
  eq(savedFromOutside(sameDayMislabelled, POOL, catType), 0,
    'an internal move labelled with an expense category still pairs while its legs are days apart — the dates are the evidence there, not the label');

  const slowTransfer = [
    tx('2026-08-01', 'Baby fund', -5000),
    tx('2026-08-04', 'Emergency fund', 5000),
  ];
  eq(savedFromOutside(slowTransfer, POOL, catType), 0,
    'and a genuinely slow settlement is untouched, whatever it is called');

  const unknownCat = [
    { date: '2026-08-01', label: 'Baby fund', amount: -5000, cat: 'Whatever' },
    { date: '2026-08-28', label: 'Emergency fund', amount: 5000, cat: 'Transfer' },
  ];
  eq(savedFromOutside(unknownCat, POOL, catType), 0,
    'a category no file answers to stays matchable — "unclassified" is not "definitely a purchase"');
}

console.log(`savings-paired-legs-window.test.cjs — ${checks} checks OK`);
