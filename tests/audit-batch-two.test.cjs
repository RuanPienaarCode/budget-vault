'use strict';
/* THE SECOND AUDIT BATCH — #55, #59, #63, #64, #68, #75.

   Six defects with one family resemblance: a rule that was right for the case
   it was written against, applied to a case it was never asked about.

     #55  Rule 2 ("has this debt instalment already been paid?") searched to
          the PERIOD END, so a payment dated later this period — an imported
          scheduled debit order — counted as proof of payment while the money
          was still in the account. Services got this as-of filter in #47.
     #59  Tax and Plan money cells turned an unreadable value into a stated
          0.00, the defect table-schema.js fixed for every other table.
     #63  Their status columns coerced the household's own word AND wrote the
          coercion back — the Services `weekly` incident, four columns over.
     #64  Three collision probes asked Obsidian's exact-key index a question
          only the case-insensitive filesystem can answer.
     #68  A blank `Original` on Debts.md was written back as the derived
          fallback, putting the household on record for a figure they never
          typed.
     #75  One typo'd transaction date became the cadence anchor, because a
          string sort puts a bad date last — and the Services page offered to
          write the resulting impossible date into Services.md.

     node tests/audit-batch-two.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { debtCommitments } = require('../src/committed');
const { chargeStats, nextExpected, chargeStatus } = require('../src/recurring');
const { SCHEMAS, mdTableFile } = require('../src/table-schema');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const SETTINGS = { [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' };

/* ============ #55 — a future-dated payment is not proof of payment ======= */
{
  const CARD = { name: 'FNB card', lender: 'FNB', balance: 8000, payment: 500, extra: 0,
    start: '2025-01-01', category: 'Debt', status: 'active' };
  const run = (rows, today) => debtCommitments({
    debts: [CARD], rows, from: today, to: '2026-09-30',
    periodStart: '2026-09-01', periodDays: 30, today,
  });
  eq(run([], '2026-09-02').length, 1, 'an unpaid instalment is committed');
  eq(run([{ date: '2026-09-01', cat: 'Debt', amount: -500 }], '2026-09-02'), [],
    'a payment already taken clears it');
  eq(run([{ date: '2026-09-20', cat: 'Debt', amount: -500 }], '2026-09-02').length, 1,
    'a payment dated LATER has not happened — reconcile leaves that money in cash, so the commitment stands');
  eq(run([{ date: '2026-09-20', cat: 'Debt', amount: -500 }], '2026-09-29'), [],
    'and clears the moment the day arrives');
  /* A past period must not read its own rows as "not yet taken" — the guard
     that stops this fix breaking every closed month. */
  eq(run([{ date: '2026-09-20', cat: 'Debt', amount: -500 }], '2026-10-15'), [],
    'a period already over reads its payments as payments');
}

/* ============ #75 — one bad date cannot become the anchor =============== */
{
  const clean = ['2026-05-03', '2026-06-03', '2026-07-03', '2026-08-03']
    .map(date => ({ date, amount: -250 }));
  const base = chargeStats(clean);
  eq(base.last, '2026-08-03', 'a clean history anchors on its last charge');
  eq(nextExpected(base, 'monthly'), '2026-09-03', 'and predicts the next one');

  for (const bad of ['2026-13-05', 'end of June', '', '2026-02-30']) {
    const st = chargeStats([...clean, { date: bad, amount: -250 }]);
    eq(st.last, '2026-08-03', `"${bad}" does not become the anchor — a string sort puts it last, which is the trap`);
    eq(nextExpected(st, 'monthly'), '2026-09-03', `and the prediction is unmoved by "${bad}"`);
    eq(st.count, 5, 'while the charge itself still counts toward the price — it happened, it just cannot say when');
  }

  const none = chargeStats([{ date: 'end of June', amount: -250 }]);
  eq(nextExpected(none, 'monthly'), null,
    'a history with no datable charge predicts NOTHING rather than "NaN-NaN-NaN" — views/services.js offers to write this into the vault');
  eq(chargeStatus(none, 'monthly', '2026-09-02').daysSince, null,
    'and reports no age rather than NaN');
}

/* ============ #68 — a blank Original stays blank ======================== */
(async () => {
  {
    const DEBTS = '---\nkind: debts\n---\n\n'
      + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
      + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n'
      + '| Bond | ABSA | home loan | 480000.00 |  | 9.50 | 5000.00 | 0.00 | 2020-01-01 |  | active |  |  |\n'
      + '| Car | WB | vehicle | 100000.00 | 164000.00 | 11.00 | 3200.00 | 0.00 | 2022-01-01 |  | active |  |  |\n';
    const ctx = makeCtx({ ...SETTINGS, [`${B}/Debts.md`]: DEBTS }, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);

    eq(S.debts[0].original, 480000,
      'in MEMORY the fallback still stands — the payoff bar divides by this and must not divide by null');
    eq(S.debts[0].originalStated, false, 'flagged as derived rather than typed');
    eq(S.debts[1].originalStated, true, 'and a stated one says so');

    const out = mdTableFile({ fm: S.debtsFm, fallback: 'kind: debts', title: 'Debts', prose: [], schema: SCHEMAS.debts, rows: S.debts });
    const bond = out.split('\n').find(l => l.startsWith('| Bond'));
    const car = out.split('\n').find(l => l.startsWith('| Car'));
    eq(bond.split('|')[5].trim(), '',
      'ON DISK the blank cell stays blank — the household is not put on record for a figure they never typed');
    eq(car.split('|')[5].trim(), '164000.00', 'while a stated Original round-trips untouched');
  }

  /* ============ #59 / #63 — tax and plan keep the words you typed ======== */
  {
    const TAX = '---\nkind: tax\n---\n\n## progress\n\n'
      + '| Step | Status | Due | Notes |\n|---|---|---|---|\n| Gather documents | waiting on bank |  |  |\n\n'
      + '## documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | posted |  |  |\n\n'
      + '## figures\n\n| Code | Description | Source | Amount |\n|---|---|---|---:|\n| 4006 | RA | Sanlam | 12 000 R |\n| 4023 | Medical | Discovery | 8000.00 |\n';
    const PLAN = '---\nkind: plan\n---\n\n# Baby\n\n## money in\n\n'
      + '| Source | Kind | Amount | Date | Status | Notes |\n|---|---|---:|---|---|---|\n| Bonus | Work | 50000.00 |  | pending |  |\n\n'
      + '## items\n\n| Item | Envelope | Amount | Spent | Status | Category | Notes |\n|---|---|---:|---:|---|---|---|\n| Cot | Nursery | 8000 - 12000 | 0.00 | ordered |  |  |\n';
    const ctx = makeCtx({ ...SETTINGS, [`${B}/Tax/2026.md`]: TAX, [`${B}/Plans/Baby.md`]: PLAN },
      { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);
    const t = S.tax['2026'], p = S.plans.Baby;

    /* The COERCION still happens — every consumer downstream needs a value
       from the known set. What changed is that the word survives beside it. */
    eq(t.steps[0].status, 'todo', 'an unrecognised step word still resolves to a usable value');
    eq(t.steps[0].statusRaw, 'waiting on bank', 'and the household\'s own word is kept');
    eq(t.docs[0].statusRaw, 'posted', 'same for a document status');
    eq(t.figures[0].amountRaw, '12 000 R', 'and for an unreadable figure');
    eq(t.figures[1].amountRaw, undefined, 'a readable one keeps no raw — there is nothing to preserve');
    eq(p.sources[0].statusRaw, 'pending',
      '"pending" is not "received" — that coercion flipped a plan source from expected to money-in-hand');
    eq(p.items[0].amountRaw, '8000 - 12000', 'and an estimate range is not 0.00');

    /* And the serializers put them back. */
    const taxOut = ctx.serializeTax ? ctx.serializeTax('2026') : null;
    if (taxOut) {
      ok(taxOut.includes('waiting on bank'), 'the tax file keeps the step word it was given');
      ok(taxOut.includes('12 000 R'), 'and the figure cell it could not read');
      ok(!/\|\s*0\.00\s*\|\s*$/m.test(taxOut.split('## Figures')[1] || ''),
        'never a fabricated 0.00 in its place');
    }
  }

  /* ============ #64 — the collision probe folds case ===================== */
  {
    const ctx = makeCtx({ ...SETTINGS,
      [`${B}/Categories/Kids-School.md`]: '---\ntype: expense\n---\n',
      [`${B}/Tax/2026/IRP5.pdf`]: 'x',
    }, { settings: { month_start_day: 1 } });
    await loadInto(ctx);

    eq(ctx.pathTaken('Categories/Kids-School.md'), true, 'the exact path is taken');
    eq(ctx.pathTaken('Categories/kids-school.md'), true,
      'and so is the same name in another case — one file on disk, two keys in the index');
    eq(ctx.pathTaken('Categories/KIDS-SCHOOL.md'), true, 'in any case');
    eq(ctx.pathTaken('Categories/Something Else.md'), false, 'a genuinely free path is free');
    eq(ctx.pathTaken('Tax/2026/irp5.pdf'), true,
      'and it works on binaries too — the certificate upload promises never to overwrite an earlier one');
    eq(ctx.pathTaken('Tax/2026/other.pdf'), false, 'without blocking a new certificate');
  }

  console.log(`PASS audit-batch-two (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
