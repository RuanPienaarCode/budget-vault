'use strict';
/* The checks that catch a figure which is internally consistent and still WRONG.

   Every other suite in this repo asks whether a number is derived the same way
   in two places. None of them asks whether the DEFINITION is right — and that
   is the gap the 1.23.x releases fell into three times running:

     · the savings rate netted a sinking fund's own spending against it, so a
       household that had saved for a pram and then bought one was told it
       saved nothing. 105 suites passed.
     · the emergency divisor counted a credit-card settlement as an essential
       bill, so money already counted once was counted again. 105 suites passed.
     · shares of income were built from two different row populations at once —
       a household numerator over a budget denominator. 105 suites passed.

   What every one of them broke was a RELATIONSHIP that has to hold whatever the
   data is. Those relationships are below. They are cheap, they are blunt, and
   any one of them would have gone red on the day.

   NEGATIVE-CONTROLLED, and honestly reported. Reverting the mixed-view fix
   makes invariant 1 fire ("essential (27000) must not exceed consumption
   (23500)"); reverting the savings rule to net every outflow makes invariant 4
   fire ("got 500" against the R3 000 that actually came in).

   WHAT IT DOES NOT CATCH, said out loud rather than left to be discovered: the
   third bug — an excluded pass-through inflating the essential divisor — does
   NOT fire here, because both legs of that pair carry the SAME category and
   the per-category netting cancels them arithmetically before any of this can
   see it. It only bites when the two legs are categorised differently, which
   is a shape this fixture does not hold. tests/health-data.test.cjs pins that
   case directly; this file would pass a vault carrying it, and a reader should
   not mistake a green run here for cover it does not give.

     node tests/sanity-invariants.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const table = rows => `---\nkind: transactions\n---\n\n${HEAD}${rows.join('\n')}\n`;
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];

/* A household shaped like a real one rather than like a fixture: it pays bills
   from more than one account, settles a credit card, moves money between its
   own savings, and marks the second leg of each of those `excluded` — which is
   exactly the shape that broke all three releases. */
function vault() {
  const FILES = {
    [`${B}/Settings.md`]: SETTINGS,
    [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
    [`${B}/Categories/Rent.md`]: '---\ntype: expense\nfixed: true\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
    [`${B}/Categories/Luxuries.md`]: '---\ntype: luxuries\n---\n',
    [`${B}/Categories/Medical.md`]: '---\ntype: health\n---\n',
    [`${B}/Categories/Settle Card.md`]: '---\ntype: transfer\n---\n',
    [`${B}/Categories/To Savings.md`]: '---\ntype: savings\n---\n',
    [`${B}/Accounts/Cheque.md`]:
      '---\ntype: checking\nbalance: 40000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
    [`${B}/Accounts/Card.md`]:
      '---\ntype: credit_card\nbalance: -5000.00\nbalance_updated: 2026-08-01\ntx_label: "Card"\n---\n',
    [`${B}/Accounts/Fund.md`]:
      '---\ntype: savings\nbalance: 90000.00\nemergency_fund: true\nbalance_updated: 2026-08-01\ntx_label: "Fund"\n---\n',
  };
  for (const m of MONTHS) {
    FILES[`${B}/Transactions/Cheque/${m}.md`] = table([
      `| ${m}-01 | Salary | Salary | 40000.00 | | | |`,
      `| ${m}-02 | Rent | Rent | -12000.00 | | | |`,
      `| ${m}-05 | Groceries | Groceries | -6000.00 | | | |`,
      `| ${m}-06 | Treat | Luxuries | -1500.00 | | | |`,
      /* An essential bill marked excluded for an unrelated reason (reimbursed,
         say) with NO matching leg anywhere. This row is what makes invariant 1
         bite: it is real household spending that a budget-scoped reading drops
         and a household reading keeps, so the moment `essential` and
         `consumption` are built from different populations, essential
         overtakes consumption and the check fires. Without it the fixture's
         only excluded rows are transfer-typed, which both readings drop, and
         the invariant would sit there passing on a vault that could not
         reproduce the bug. */
      `| ${m}-15 | Doctor | Medical | -5000.00 | yes | | |`,
      // Settling the card: the second leg of money already spent ON the card.
      `| ${m}-27 | Settling up | Settle Card | -4000.00 | yes | | |`,
      // Into savings: real saving, from outside the pool.
      `| ${m}-28 | To savings | To Savings | -3000.00 | | | |`,
    ]);
    FILES[`${B}/Transactions/Card/${m}.md`] = table([
      `| ${m}-10 | Groceries on card | Groceries | -4000.00 | | | |`,
      `| ${m}-27 | Settling up | Settle Card | 4000.00 | yes | | |`,
    ]);
    FILES[`${B}/Transactions/Fund/${m}.md`] = table([
      `| ${m}-28 | From cheque | To Savings | 3000.00 | | | |`,
      /* The fund spending ITSELF on the thing it was built for. Without this
         row nothing in the fixture can distinguish "counts money in" from
         "nets everything", and the 1.23.1 bug — a sinking fund reported as
         dis-saving — would sail straight through. */
      `| ${m}-20 | Car service | Groceries | -2500.00 | | | |`,
    ]);
  }
  return FILES;
}

(async () => {
  const ctx = makeCtx(vault(), { budgetFolder: B });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  const snap = ctx.healthSnapshot();
  const M = snap.metrics;

  /* ---- 1. essential is a SUBSET of consumption, so it cannot exceed it ----
     essential drops luxuries and giving on top of the savings/investment
     consumption already drops, over the same rows. Bigger means the two are
     being measured over different populations — which is precisely what a
     household numerator over a budget denominator looks like from outside. */
  ok(M.monthlyEssential <= M.monthlyConsumption + 0.01,
    `essential (${M.monthlyEssential}) must not exceed consumption (${M.monthlyConsumption}) — `
    + 'it excludes strictly more category types, so a larger figure means the two are '
    + 'being built from different row sets');

  /* ---- 2. fixed is a subset of consumption too ---- */
  ok(M.monthlyFixed <= M.monthlyConsumption + 0.01,
    'fixed bills are part of consumption, so they cannot exceed it');

  /* ---- 3. every share is a real number, and none is negative ----
     A share of income that comes back NaN, Infinity or below zero has had its
     denominator or its sign go wrong; "-19% of income saved" shipped once. */
  for (const [name, v] of Object.entries({
    savingsRate: M.savingsRate, fixedShare: M.fixedShare,
    consumptionShare: M.consumptionShare, budgetUsed: M.budgetUsed,
    interestShare: M.interestShare,
  })) {
    ok(v === null || Number.isFinite(v), `${name} is a real number or null, never NaN/Infinity`);
    ok(v === null || v >= 0, `${name} is never negative — a share of income cannot be`);
  }

  /* ---- 4. a sinking fund spending itself is NOT dis-saving ----
     This vault pays R3 000 a month into savings from a cheque account and never
     takes it out. Anything that nets outflows against that would report zero. */
  ok(Math.abs(M.monthlySavings - 3000) < 1,
    'saving is the R3 000 that came IN from outside the pool — the fund also spends '
    + `R2 500 a month on what it was built for, and that is not dis-saving (got ${M.monthlySavings})`);

  /* ---- 5. an internal transfer is not new saving ----
     The R3 000 appears in BOTH accounts. Counted once, the rate is 3000/40000
     = 7.5%; counted twice it would read 15%. */
  ok(M.savingsRate < 0.12,
    `the transfer's two legs are counted once, not twice (got ${(M.savingsRate * 100).toFixed(1)}%)`);

  /* ---- 6. a settled credit card is not an essential bill ----
     R4 000 of groceries went on the card and R4 000 later settled it. The
     groceries are real spending; the settlement is the same rand moving again.
     Essential spend here is rent 12000 + groceries 6000 + groceries-on-card
     4000 = 22000, plus the excluded R5 000 doctor with no matching leg and the
     R2 500 the fund spends on itself = 29500. Counting the R4 000 settlement
     on top would put it at 33500. */
  ok(M.monthlyEssential < 32000,
    `a card settlement is not a second essential bill (essential came to ${M.monthlyEssential})`);

  /* ---- 7. the pillars still add up to the number in the ring ---- */
  const b = snap.breakdown;
  if (b) {
    const pts = b.pillars.reduce((s, p) => s + p.shownPoints, 0);
    const max = b.pillars.reduce((s, p) => s + p.shownMax, 0);
    ok(Math.abs(pts - b.total) <= 0.5, 'the pillar points sum to the headline score');
    ok(Math.abs(max - 100) <= 0.5, 'the pillar maxima sum to 100');
    for (const p of b.pillars) {
      ok(p.shownPoints <= p.shownMax, `${p.key} cannot earn more than its own maximum`);
    }
  }

  console.log(`PASS — sanity invariants: the relationships that hold whatever the data is (${checks} checks).`);
})().catch(e => { console.error(e.message); process.exit(1); });
