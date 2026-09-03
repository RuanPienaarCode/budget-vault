'use strict';
/* ISSUES 33 and 47 — a weekly debit order the app could neither record nor
   count.

   #33 IS THE MISSING VOCABULARY. `Services.md`'s Cycle column was declared
   `vocab('cycle', 'Cycle', 'annual', 'monthly')`, whose reader coerces
   anything that is not `annual` to `monthly`. A household typing `weekly` did
   not get a bad answer; it got no way to say the thing at all, and every
   figure built on the cycle then described a bill that does not exist.

   #47 IS WHAT THAT COST. Reproduced on 2026-09-02 against the `BudgetAudit`
   household (tests/_audit-seed.cjs): Virgin Active, R250 a week, charges dated
   the 3rd, 10th, 17th and 24th of September already in the ledger.

     serviceCommitments -> []           the card read "nothing scheduled"
     still committed     -> R0          over R1 000 yet to leave the account

   TWO lines did it. `landed` asked whether ANY charge fell inside the period
   and dropped the whole service if one did — right for a monthly bill, whose
   money has gone, once — and `nextExpected` could only step a month, so a
   weekly cadence produced no leftover dates to find. And the item pushed
   carried one date and one amount, where a weekly service in a monthly period
   owes roughly four.

   That figure is the one telling a reader how much is safe to spend, so the
   error was in the only direction this card must never be wrong in.

   WHAT IS PINNED

     1. The vocabulary: four cycles, `monthly` still the fallback, and an
        unrecognised word still preserved verbatim (widening is not opening).
     2. The cadence arithmetic, per cycle.
     3. The reshape: how many charges remain in the window and what they
        total, not "the next one, if it has not landed".
     4. Charges count as gone when they are dated ON OR BEFORE today. The
        audit household had all four gym rows in the ledger already, dated
        ahead — read as evidence of payment they suppressed the very
        commitment they describe.
     5. MONTHLY AND ANNUAL ARE UNTOUCHED on the "at most one per period"
        path. Six years of correct behaviour must not be put at risk to fix a
        case it never had.
     6. The row says "4 × R250", never a R1 000 debit no statement will show.

     node tests/weekly-cycles.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');
const { SEED, PERIOD, TODAY, atAuditDate } = require('./_audit-seed.cjs');
const { CYCLES, SCHEMAS } = require('../src/table-schema');
const { nextExpected } = require('../src/recurring');
const { serviceCommitments } = require('../src/committed');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const cycleCol = SCHEMAS.services.columns.find(c => c.key === 'cycle');
const readCycle = cell => cycleCol.read(cell);

/* ----------------------- 1. the vocabulary ----------------------------- */
eq(CYCLES, ['weekly', 'fortnightly', 'monthly', 'annual'], 'four cycles, shortest first');
for (const c of CYCLES) {
  eq(readCycle(c), { cycle: c }, `${c} reads as itself`);
  eq(readCycle(c.toUpperCase()), { cycle: c }, `and case-folds, the way ANNUAL always did`);
}
eq(readCycle(''), { cycle: 'monthly' }, 'a blank cell is still monthly — every file on disk means what it meant');
eq(readCycle(undefined), { cycle: 'monthly' }, 'and so is an absent one');
eq(readCycle('quarterly'), { cycle: 'monthly', cycleRaw: 'quarterly' },
  'a cycle still outside the set is coerced for consumers AND preserved for disk — widening is not opening');

/* ----------------------- 2. the cadence -------------------------------- */
eq(nextExpected({ last: '2026-09-24' }, 'weekly'), '2026-10-01', 'weekly steps seven days, across a month end');
eq(nextExpected({ last: '2026-09-24' }, 'fortnightly'), '2026-10-08', 'fortnightly steps fourteen');
eq(nextExpected({ last: '2026-09-24' }, 'monthly'), '2026-10-24', 'monthly is unchanged');
eq(nextExpected({ last: '2026-09-24' }, 'annual'), '2027-09-24', 'and so is annual');
eq(nextExpected({ last: '2026-02-25' }, 'weekly'), '2026-03-04', 'and a short month is just days, so February needs no special case');

/* ------------- 3-5. the reshape, over one window ------------------------ */
const WINDOW = { from: '2026-09-02', to: '2026-09-30', periodStart: '2026-09-01' };
const svc = (cycle, next) => [{
  name: 'Virgin Active', provider: 'Virgin', amount: 250, cycle, next, active: true, category: 'Gym',
}];
/* `desc`, which is the field matchCharges reads — a row keyed `description`
   matches nothing and every case below would silently fall back to the typed
   Next billing date instead of the charge history. */
const charge = date => ({ date, desc: 'Virgin Active', amount: -250, label: 'Cheque' });

{
  /* Nothing charged yet, anchored on the stated next-billing date. */
  const got = serviceCommitments({ services: svc('weekly', '2026-09-03'), rows: [], ...WINDOW });
  eq(got.length, 1, 'a weekly service commits');
  eq(got[0].occurrences, 4, 'four charges remain in the window: the 3rd, 10th, 17th and 24th');
  eq(got[0].amount, 1000, 'totalling R1 000 — what the window still owes this merchant');
  eq(got[0].unit, 250, 'while the unit stays the R250 a statement will actually show');
  eq(got[0].due, '2026-09-03', 'and the date shown is the first one still to come');
}
{
  /* The audit's own state: every charge already in the ledger, all dated
     AHEAD of today. Read as evidence of payment they suppressed themselves. */
  const rows = ['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24'].map(charge);
  const got = serviceCommitments({ services: svc('weekly', '2026-09-03'), rows, ...WINDOW });
  eq(got.length, 1, 'a pre-recorded future charge is not a paid one');
  eq(got[0].occurrences, 4, 'so all four still commit');
}
{
  /* Two genuinely gone, two to come. */
  const rows = [charge('2026-08-27'), charge('2026-09-01')];
  const got = serviceCommitments({ services: svc('weekly', '2026-09-01'), rows, ...WINDOW });
  eq(got[0].occurrences, 4, 'the 1st is behind the window; the 8th, 15th, 22nd and 29th remain');
  eq(got[0].due, '2026-09-08', 'starting from the first one still ahead');
}
{
  /* THE ANCHOR IS THE LAST REAL CHARGE, not the typed date — the same
     "derived first, typed second" preference the amount takes, and for the
     reason the module records: on the reference vault every hand-typed Next
     billing was months in the past. Read on the 17th with the debit posted on
     the 16th, the cadence continues from the 16th. So a bank that posts a day
     early moves the whole series with it rather than producing a phantom
     charge, which is the outcome the ±3-day matcher exists to guarantee and
     this anchoring reaches first. */
  const late = { from: '2026-09-17', to: '2026-09-30', periodStart: '2026-09-01' };
  const got = serviceCommitments({
    services: svc('weekly', '2026-09-03'), rows: [charge('2026-09-16')], ...late,
  });
  eq(got[0].occurrences, 2, 'two charges left in the window, counted once each');
  eq(got[0].due, '2026-09-23', 'stepping from the charge that actually happened');
}
{
  const got = serviceCommitments({ services: svc('fortnightly', '2026-09-03'), rows: [], ...WINDOW });
  eq(got[0].occurrences, 2, 'fortnightly: the 3rd and the 17th');
  eq(got[0].amount, 500, 'so R500');
}
{
  /* THE PATH THAT MUST NOT MOVE. */
  const monthly = serviceCommitments({ services: svc('monthly', '2026-09-05'), rows: [], ...WINDOW });
  eq(monthly.length, 1, 'a monthly service still commits once');
  eq(monthly[0].amount, 250, 'for one charge');
  eq(monthly[0].occurrences, 1, 'stated as one occurrence, so the view has one rule to read');

  const paid = serviceCommitments({
    services: svc('monthly', '2026-09-05'), rows: [charge('2026-09-01')], ...WINDOW,
  });
  eq(paid, [], 'and is dropped once its charge has actually gone — unchanged since 1.20');

  const later = serviceCommitments({
    services: svc('monthly', '2026-09-05'), rows: [charge('2026-09-28')], ...WINDOW,
  });
  eq(later.length, 1, 'while a charge dated LATER this period no longer suppresses it');
}

/* ------------------ 6. the household, and the card --------------------- */
const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
  'healthCard', 'healthBody', 'healthSub', 'leftCard', 'leftBody', 'leftSub',
  'dashSplit', 'dashSplitSub', 'splitRange', 'dashBudget', 'dashBudgetSub',
  'dashPositionCard', 'dashPositionKpis', 'dashPositionSub', 'dashPositionNote'];

atAuditDate(async () => {
  const { FakeEl } = makeDom();
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;
  eq(S.services[0].cycle, 'weekly',
    'the household can finally record a weekly gym — this was `monthly` with a discarded raw');

  const nodes = new Map(IDS.map(id => [id, new FakeEl(id === 'dashBudget' ? 'table' : 'div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/dashboard')(ctx);
  ctx.renderDashboard();

  const left = nodes.get('leftBody').textContent;
  ok(!left.includes(i18n.t('dash.left.none')),
    `the card no longer reads "nothing scheduled" over R1 000 still to go — got: ${left}`);
  ok(left.includes(i18n.t('dash.left.times', { count: 4, amount: 'R 250' })),
    `and states the cadence rather than a R1 000 debit no statement will show — got: ${left}`);
  ok(left.includes('R 1500'), `with R1 500 committed: four gym charges and the instalment — got: ${left}`);

  console.log(`PASS weekly-cycles (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
