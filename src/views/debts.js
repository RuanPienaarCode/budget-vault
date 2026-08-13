'use strict';
/* Debt — balances, interest cost, a payoff-strategy planner, and the link from
   each debt to the transactions actually paying it. Saved to Debts.md.

   The arithmetic lives in ../debt-math (pure, separately tested); this file is
   presentation and editing only. */

const { el, kpiTiles, keepScroll, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { SCHEMAS, mdTableFile } = require('../table-schema');
const { askFields } = require('../modal');
const { MONTHS } = require('../constants');
const { amortise, monthlyInterest, simulate, priorityOrder, addMonths, humanMonths, expectedBalance } = require('../debt-math');
const { todayIso } = require('../dates');
const {
  themeColors, createChart, scales, gridlines, axisLabels,
  linePath, areaPath, areaGradient, tip, RANGES, rangeFor,
} = require('../chart');

/* Debt kinds, in the order a household usually meets them. Stored verbatim in
   the Type column; an unknown value from a hand-edited file is kept as-is
   rather than coerced, the same way Services keeps a non-ISO billing date. */
const DEBT_TYPES = ['credit card', 'personal loan', 'vehicle', 'home loan', 'student', 'store account', 'overdraft', 'other'];

module.exports = function registerDebts(ctx) {
  const { S, $, root, app, plugin, money, toast, writeFile, txInPeriod } = ctx;

  const { mark, clear: clearDirty } = ctx.dirtyFlag('debtsDirty', '#debtSave');

  /* Copies, each stamped with a stable `key`, because two debts can share a
     name — "Credit card" once per bank is the normal case, not an edge one —
     and debt-math keys its payoff months by `key` for exactly that reason.
     Read-only everywhere it is used, so copying costs nothing and stops a view
     helper from writing through to the model by accident. */
  const active = () => S.debts.filter(d => d.status !== 'paid').map((d, i) => ({ ...d, key: i }));
  const committed = d => (d.payment || 0) + (d.extra || 0);

  /* The planner's two inputs live in the DOM rather than in S: they are a
     what-if, not household data, and persisting them would put a number in
     Debts.md that no file on disk is the source of truth for. */
  const planExtra = () => Math.max(0, parseFloat($('#debtExtra').value) || 0);
  const planStrategy = () => ($('#debtStrategy').value === 'snowball' ? 'snowball' : 'avalanche');

  /* "Aug 2029" from the 'YYYY-MM' debt-math returns. */
  function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }

  /* ------------------------------- KPIs --------------------------------- */
  /* Split out so an edited balance can refresh the totals without rebuilding
     the row being typed into — on a phone `change` fires on blur, so a full
     rebuild lands between the tap leaving a field and the one arriving at the
     next, and the arriving tap hits whatever now occupies those pixels. */
  function renderDebtKpis() {
    const list = active();
    const total = list.reduce((s, d) => s + d.balance, 0);
    const perMonth = list.reduce((s, d) => s + committed(d), 0);
    const interest = list.reduce((s, d) => s + monthlyInterest(d.balance, d.rate), 0);
    /* Read ONCE and named here. The caption below used to reach for a bare
       `extra`, which is declared in renderDebtPlan — a different function — so
       this threw ReferenceError the moment the page drew its tiles, and took
       the whole Debts view down with it. It shipped in 1.13.0 because this file
       has no render test: every guard suite was green while the page was dead.
       Same value the simulation runs on, so the caption cannot describe a
       different plan from the one above it. */
    const extra = planExtra();
    const plan = simulate(list, { extra, strategy: planStrategy() });

    const tile = kpiTiles($('#debtKpis'));
    // Neutral: owing money is an ordinary financial position, not a red state.
    tile('Total debt', money(total), '',
      `${list.length} active · ${S.debts.length} tracked`);
    tile('Paying per month', money(perMonth), '', perMonth ? `${money(perMonth * 12, 0)} a year` : 'nothing budgeted');
    // The single most actionable number here: what this month costs before a
    // cent of principal moves.
    tile('Interest this month', money(interest), interest > 0 ? 'text-warning' : '',
      perMonth > 0 ? `${Math.round((interest / perMonth) * 100)}% of your payments` : '');
    /* The tile silently folded in BOTH the what-if extra typed into the planner
       below it and the rollover of each cleared payment into the next — so
       typing 3000 into a box moved the page's headline promise 34 months
       earlier with nothing saying so. The projection is fine; the caption is
       what was missing. 'never' likewise became a verdict on the reader rather
       than a statement about the inputs. */
    const planAssumes = extra > 0
      ? `assumes ${money(extra, 0)}/mo extra and each cleared payment rolling into the next`
      : 'assumes each cleared payment rolls into the next';
    tile('Debt-free', plan.settled && plan.months ? monthLabel(addMonths(plan.months)) : (total > 0 ? 'not at this payment' : '—'),
      plan.settled && plan.months ? 'grad-txt' : (total > 0 ? 'text-danger' : ''),
      plan.settled && plan.months ? `${humanMonths(plan.months)} — ${planAssumes}` : (total > 0 ? 'not within 50 years at the payments entered' : 'no debt tracked'));
  }

  /* ------------------------------ the plan -------------------------------
     Three runs side by side. "Minimum only" is the do-nothing baseline the
     other two are measured against — without it, "you'd pay R48k interest"
     is a number with nothing to compare to, and the whole card is just a
     bill. */
  function renderDebtPlan() {
    const list = active();
    const wrap = $('#debtPlan'); wrap.empty();
    const order = $('#debtOrder'); order.empty();

    if (!list.length) {
      $('#debtCurve').empty();
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        'Add a debt below and this becomes a payoff plan — how long each method takes, and what it saves.'));
      return;
    }

    const extra = planExtra();
    const chosen = planStrategy();
    const base = simulate(list, { strategy: 'minimum' });
    const runs = [
      { key: 'minimum', label: 'Minimum only', note: 'Contracted payments, nothing extra', res: base },
      { key: 'snowball', label: 'Snowball', note: 'Smallest balance first', res: simulate(list, { extra, strategy: 'snowball' }) },
      { key: 'avalanche', label: 'Avalanche', note: 'Highest rate first', res: simulate(list, { extra, strategy: 'avalanche' }) },
    ];

    const grid = el('div', { class: 'debt-plans' });
    for (const r of runs) {
      const saved = base.settled && r.res.settled ? base.interest - r.res.interest : 0;
      const sooner = base.settled && r.res.settled ? base.months - r.res.months : 0;
      const card = el('div', { class: `debt-plan${r.key === chosen ? ' is-chosen' : ''}` },
        el('div', { class: 'dp-h' }, el('b', {}, r.label),
          r.key === chosen ? el('span', { class: 'dp-tag' }, 'selected') : ''),
        el('div', { class: 'dp-note' }, r.note),
        el('div', { class: 'dp-date num' }, r.res.settled && r.res.months ? monthLabel(addMonths(r.res.months)) : 'not at this payment'),
        el('div', { class: 'dp-sub' }, r.res.settled && r.res.months ? humanMonths(r.res.months) : 'does not clear within 50 years'),
        el('div', { class: 'dp-row' }, el('span', {}, 'Interest'),
          el('b', { class: 'num' }, r.res.settled ? money(r.res.interest, 0) : '—')));
      if (r.key !== 'minimum' && saved > 1) {
        card.append(el('div', { class: 'dp-save num' },
          `Saves ${money(saved, 0)}${sooner > 0 ? ` · ${humanMonths(sooner)} sooner` : ''}`));
        /* Say whose money that is. The run includes the reader's own extra
           while the baseline does not, so crediting the METHOD for the whole
           saving overstates what picking snowball or avalanche actually buys
           — and the green number is the line people read. */
        if (extra > 0) card.append(el('div', { class: 'dp-src' }, `includes your ${money(extra, 0)}/mo extra`));
      }
      grid.append(card);
    }
    wrap.append(grid);

    /* The page had NO disclaimer at all while projecting payoff dates fifty
       years out, quoting total interest in the hundreds of thousands, ranking
       the reader's debts and rendering the result in the celebratory gradient
       style. The Loan Calculators view has carried one since 1.0.14; this is
       the same sentence, plus the assumption set — which appeared nowhere the
       reader could see it, though every date on the page depends on it.

       Deliberately a local const and English-only, matching views/loans.js and
       views/tax.js as they stand today. Promoting all three to a shared
       i18n-backed module, and adding the test that fails when one is deleted,
       is its own change. */
    wrap.append(el('p', { class: 'text-muted', style: 'margin:16px 0 0;font-size:12px;line-height:1.5' },
      'Projections assume the rate, the payment and any extra all stay exactly as entered, with nothing '
      + 'new borrowed and no fees. A rate change or one missed payment moves every date here. '
      + 'Estimates only — this is not financial advice. Confirm anything important with your lender '
      + 'or a qualified adviser.'));
    renderDebtCurve(runs);

    if (!base.settled) {
      wrap.append(el('p', { class: 'text-danger', style: 'margin:14px 0 0;font-size:12.5px' },
        /* "never clears — the interest is at or above the payment" was stated as
           fact for anything that had not closed within the 600-month cap, which
           includes debts that DO clear, just slowly: R500 000 at 11% paying
           R4 600 covers its R4 583 of monthly interest and closes in 616 months.
           Three separate strings asserted the interest was winning when it was
           not. This one says what is actually known — it did not clear inside
           the horizon the projection runs to. */
        `On the contracted payments alone, ${base.stalled.join(', ')} does not clear within 50 years. ` +
        'Raising the payment, or adding extra above, shortens it.'));
    }

    /* Attack order for the selected method. Snowball and avalanche only differ
       in this list, so showing it is what makes the choice concrete.

       The chosen run is reused from `runs` above rather than simulated again —
       planStrategy() only ever returns one of those two keys, so the extra run
       was computing a result already sitting in the array. */
    const plan = runs.find(r => r.key === chosen).res;
    const seq = priorityOrder(list.map(d => ({ ...d })), chosen);
    /* "Put every spare rand at these in order" until now — an instruction, and
       the most advice-shaped sentence in the app. The order is arithmetic and
       stays; telling the reader what to do with their money is not. */
    order.append(el('div', { class: 'sub', style: 'margin-bottom:10px' },
      `The plan below aims spare money in this order${extra ? ` — ${money(extra, 0)} extra a month` : ''}. ` +
      'As each one closes, its payment rolls into the next.'));
    const ol = el('ol', { class: 'debt-order' });
    for (const d of seq) {
      const at = plan.payoff[d.key];
      ol.append(el('li', {},
        el('span', { class: 'do-n' }, d.name),
        el('span', { class: 'do-m num' }, `${(d.rate || 0).toFixed(2)}% · ${money(d.balance, 0)}`),
        el('span', { class: 'do-d' }, at ? `clear ${monthLabel(addMonths(at))}` : 'not clearing')));
    }
    order.append(ol);
  }

  /* --------------------- payments seen in transactions -------------------
     A debt with a category linked reads its own payments straight out of the
     period's transactions, so "what I said I'd pay" and "what actually left
     the account" sit next to each other. Without this the page is a wish
     list. */
  function renderDebtPayments() {
    const wrap = $('#debtPayments'); wrap.empty();
    const list = active();
    if (!list.length) return;

    const tx = txInPeriod(S.period).filter(t => !t.excluded);
    const linked = list.filter(d => d.category);
    const unlinked = list.filter(d => !d.category);

    /* Every active debt, categorised or not. The ratio below is about what the
       household actually owes each month, so it must not depend on which debts
       happen to be linked to a category: summing only the LINKED ones meant
       unlinking one category moved the ratio from 14.6% to 2.6% without a cent
       changing hands, and always in the direction that looks safer. */
    const committedAll = list.reduce((s, d) => s + committed(d), 0);

    let linkedPlanned = 0, linkedPaid = 0;
    if (!linked.length) {
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        'Set a category on a debt below and its real payments show up here, read straight from your transactions.'));
    } else {
      /* Grouped BY CATEGORY, not per debt. Households routinely file every
         instalment under one "Debt Repayments" category, and matching per debt
         would then credit the same transactions to each of them — three debts
         sharing a category would each report the full amount and the totals
         would triple. One row per category is the finest split the transaction
         data actually supports. */
      const byCat = Object.create(null);   // null-proto: a "__proto__" category can't crash the view
      for (const d of linked) (byCat[d.category] ??= []).push(d);

      const rows = el('div', { class: 'goals' });
      for (const cat of Object.keys(byCat).sort()) {
        const group = byCat[cat];
        // Money out only: a refund or a drawdown on the same category is not a
        // payment toward the balance, and counting it would flatter the row.
        const paid = tx.filter(t => t.cat === cat && t.amount < 0).reduce((s, t) => s - t.amount, 0);
        const planned = group.reduce((s, d) => s + committed(d), 0);
        linkedPlanned += planned; linkedPaid += paid;
        const pct = planned > 0 ? Math.min(100, (paid / planned) * 100) : (paid > 0 ? 100 : 0);
        const short = planned - paid;
        rows.append(el('div', {},
          el('div', { class: 'goal-h' },
            el('div', { class: 'gn' }, cat,
              el('span', { class: 'text-muted', style: 'font-weight:400' }, ` · ${group.map(d => d.name).join(', ')}`)),
            el('div', { class: 'gv' }, el('b', {}, money(paid)), ' / ', money(planned))),
          el('div', { class: 'cat-bar' }, el('i', { class: `cat-bar-fill${paid >= planned && planned > 0 ? '' : ' bg-warning'}`, style: `width:${pct}%` })),
          el('div', { class: 'goal-pct' },
            planned <= 0 ? 'No payment budgeted against this category'
              : short > 0.5 ? `${money(short)} short this period`
                : `Paid in full${paid - planned > 0.5 ? ` · ${money(paid - planned)} extra` : ''}`)));
      }
      wrap.append(rows);
    }

    /* Debt-to-income for the period. Uses the same income figure the dashboard
       does, so the two pages can never disagree.

       A ratio is scale-invariant, so this can be fixed from either side — but
       this page is monthly throughout (a debt's payment is a monthly
       instalment, and the fallback line below says so), which makes income the
       one figure that doesn't match. Scaling it UP to a month leaves every
       other number on the page alone; scaling the payments DOWN would make the
       ratio disagree with the table directly above it. Left unscaled, a
       fortnightly household at a healthy 20% was shown ~43% in red, under a
       threshold that only means anything monthly.

       monthlyIncome() owns that conversion, and averages over a window of a
       few months rather than scaling one period up — on a weekly cycle a
       monthly salary lands in one period out of four, and scaling left three
       weeks with no ratio at all and made the fourth read 4.35 paycheques. */
    const iv = ctx.intervalDays();
    const { income, months: nMonths, complete } = ctx.monthlyIncome(S.period);
    /* Not `window` — that shadows the browser global inside this whole function.
       "complete" distinguishes a settled average from the one case that still
       leans on a period in progress (a vault with no finished history yet), so
       the line doesn't present a part-week figure as a months-long average. */
    /* Months, not periods: the window is three CALENDAR months now, because no
       count of periods holds a stable number of monthly paydays — see
       monthlyIncome in period.js. The phrase has to name what was actually
       measured, or the page describes a window the figure did not come from. */
    const avgWindow = !complete ? 'this period so far'
      : nMonths === 1 ? 'the last complete month'
      : `the last ${nMonths} complete months`;
    const scaleNote = iv ? ` monthly income, averaged over ${avgWindow},` : ' income';
    const note = el('div', { class: 'debt-dti' });
    if (income > 0) {
      const ratio = (committedAll / income) * 100;
      /* Neutral, deliberately. This used to render red above 36%, amber above
         20% and green below, under the sentence "Lenders treat above 36% as
         stretched" — a US mortgage-underwriting rule of thumb, unattributed,
         shown identically in all eight country profiles. South African
         affordability under the NCA is a disposable-income calculation against
         a prescribed expense table, not a ratio at all.

         A calculator says what share of your income goes to debt. Grading that
         share, and citing "lenders" to back the grade, is an assessment of the
         reader's finances rather than arithmetic on their numbers — and it is
         the clearest verdict-shaped output in the app. The number is the useful
         part and it stays; the colour and the claim do not. */
      note.append(el('b', { class: 'num' }, `${ratio.toFixed(1)}%`),
        ` of your${scaleNote} goes to debt payments — ${money(committedAll)} across ` +
        `${list.length} debt${list.length === 1 ? '' : 's'}.`);
    } else {
      note.append(el('span', { class: 'text-muted' },
        `${money(committedAll)} a month across ${list.length} debt${list.length === 1 ? '' : 's'}. ` +
        `No income recorded in ${iv ? avgWindow : 'this period'}, so there is no ratio to show yet.`));
    }
    /* The reconciliation line stays scoped to what is actually traceable —
       mixing an all-debts "planned" with a linked-only "paid" is what produced
       "R6,300 paid of R1,150 planned", a card claiming a 5× overpayment. */
    if (linked.length) {
      note.append(el('div', { class: 'text-muted', style: 'margin-top:4px' },
        `${money(linkedPaid)} paid of the ${money(linkedPlanned)} you track by category this period.`));
    }
    if (unlinked.length) {
      const off = unlinked.reduce((s, d) => s + committed(d), 0);
      const one = unlinked.length === 1;
      note.append(el('div', { class: 'text-muted', style: 'margin-top:4px' },
        `${unlinked.length} debt${one ? '' : 's'} (${money(off)} a month) ` +
        `${one ? 'has' : 'have'} no category linked, so ${one ? 'its' : 'their'} payments are not tracked above.`));
    }
    wrap.append(note);
  }

  /* ------------------------------ the table ------------------------------
     focusRow: index into S.debts whose status pill should get focus back after
     the rebuild. An index rather than a name — two debts can share one, and
     looking the row up by name put focus on the wrong pill. */
  function renderDebts(focusRow) {
    renderDebtKpis();
    renderDebtPlan();
    renderDebtPayments();

    const t = $('#debtTable');
    keepScroll(t, () => {
      t.empty();
      t.append(el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Debt'),
        el('th', { scope: 'col', class: 'num' }, 'Balance'),
        el('th', { scope: 'col', class: 'num' }, 'Rate %'),
        el('th', { scope: 'col', class: 'num' }, 'Payment'),
        el('th', { scope: 'col', class: 'num' }, 'Extra'),
        el('th', { scope: 'col' }, 'Category'),
        el('th', { scope: 'col' }, 'Paid off'),
        el('th', { scope: 'col' }, 'Clear by'),
        el('th', { scope: 'col', class: 'num' }, 'Interest left'),
        el('th', { scope: 'col' }, 'Status'),
        el('th', { scope: 'col' }, ''))));
      const body = el('tbody', {});

      for (const d of S.debts) {
        // Derived cells are updated in place by refreshRow() so editing an
        // amount never rebuilds the row the field lives in (see renderDebtKpis).
        const payoffCell = el('td', { class: 'num' });
        const clearCell = el('td', {});
        const interestCell = el('td', { class: 'num' });
        const barFill = el('i', { class: 'cat-bar-fill' });

        function refreshRow() {
          const paidOff = d.original > 0 ? Math.min(100, Math.max(0, ((d.original - d.balance) / d.original) * 100)) : 0;
          barFill.style.width = `${paidOff}%`;
          payoffCell.empty();
          const prog = d.original > 0
            ? el('div', { class: 'debt-prog' }, el('div', { class: 'cat-bar' }, barFill),
              el('span', { class: 'num' }, `${Math.round(paidOff)}%`))
            : el('span', { class: 'text-muted' }, '—');
          payoffCell.append(prog);

          /* Where the schedule says this debt should be today. A hand-typed
             debt balance goes out of date faster than any other figure in the
             app — the lender moves it every month — and nothing here ever
             questioned it. Only shown when it MATERIALLY disagrees: a schedule
             is an estimate (a missed payment, a rate change, a fee), so small
             differences are noise and flagging them would train the reader to
             ignore the line that matters. */
          if (d.status !== 'paid') {
            const exp = expectedBalance(d, todayIso());
            if (exp) {
              const gap = d.balance - exp.expected;
              const material = Math.abs(gap) > Math.max(50, d.original * 0.02);
              if (material) {
                // The date it projects from is in the visible text, not only the
                // title — a hover tooltip is invisible on a phone, which is half
                // of where this table is read.
                payoffCell.append(el('div', { class: 'debt-implied',
                  title: `From ${money(d.original)} at ${d.rate}% paying ${money(committed(d))} a month since ${d.start}, `
                    + `the schedule puts this at ${money(exp.expected)} after ${exp.months} months. `
                    + `Your figure is ${money(Math.abs(gap))} ${gap > 0 ? 'higher' : 'lower'} — a missed payment, a rate change or a fee would explain it, and so would a stale balance.` },
                `schedule says ${money(exp.expected, 0)} since ${d.start}`));
              }
            }
          }

          const a = amortise(d.balance, d.rate, committed(d));
          clearCell.empty(); interestCell.empty();
          if (d.status === 'paid') {
            clearCell.append(el('span', { class: 'text-success' }, 'settled'));
            interestCell.append(el('span', { class: 'text-muted' }, '—'));
          } else if (!a.settled) {
            /* Did not close inside the 600-month horizon amortise runs to. That
               covers a payment genuinely below the interest AND one just above
               it that simply takes decades, so this says what is known rather
               than asserting the interest is winning. */
            clearCell.append(el('span', { class: 'text-danger' }, committed(d) > 0 ? 'not in 50 yrs' : 'no payment'));
            interestCell.append(el('span', { class: 'text-danger num' }, `+${money(monthlyInterest(d.balance, d.rate), 0)}/mo`));
          } else {
            clearCell.append(el('span', {}, monthLabel(addMonths(a.months))),
              el('div', { class: 'text-muted', style: 'font-size:11.5px' }, humanMonths(a.months)));
            interestCell.append(money(a.interest, 0));
          }
        }

        const paidPill = d.status === 'paid';
        const pill = el('button', { class: `status-pill status-${paidPill ? 'paid' : 'outstanding'}`,
          'aria-label': `${d.name}: ${paidPill ? 'Settled' : 'Active'} — click to change` },
          icoEl(paidPill ? ['circle-check', 'check-circle'] : ['hourglass']), paidPill ? 'Settled' : 'Active');
        pill.addEventListener('click', () => {
          const row = S.debts.indexOf(d);
          d.status = paidPill ? 'active' : 'paid';
          mark(); renderDebts(row);
        });

        // A settled debt leaves the totals and the plan but stays on the page —
        // the history is the encouraging part.
        /* renderDebtPayments is in here because a payment or extra edit changes
           what that panel calls "planned". Leaving it out put two contradictory
           figures on screen at once — the KPI read R9,550 while the panel below
           still read R6,550. It holds no inputs, so re-rendering it cannot eat
           a tap the way rebuilding this row would. */
        const refreshAll = () => { mark(); refreshRow(); renderDebtKpis(); renderDebtPlan(); renderDebtPayments(); };

        body.append(el('tr', { class: paidPill ? 'debt-settled' : '' },
          el('td', {}, el('div', { style: 'font-weight:600' }, d.name, ctx.noteButton('debt', d.name)),
            el('div', { class: 'text-muted', style: 'font-size:11.5px' },
              [d.lender, d.type].filter(Boolean).join(' · ') || '—')),
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: d.balance || '',
            style: 'width:120px', 'aria-label': `Balance owed on ${d.name}`,
            onchange: e => { d.balance = Math.max(0, parseFloat(e.target.value) || 0); refreshAll(); } })),
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: d.rate || '',
            style: 'width:84px', 'aria-label': `Annual interest rate on ${d.name}`,
            onchange: e => { d.rate = Math.max(0, parseFloat(e.target.value) || 0); refreshAll(); } })),
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: d.payment || '',
            style: 'width:110px', 'aria-label': `Monthly payment on ${d.name}`,
            onchange: e => { d.payment = Math.max(0, parseFloat(e.target.value) || 0); refreshAll(); } })),
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: d.extra || '',
            style: 'width:100px', 'aria-label': `Extra paid each month on ${d.name}`,
            onchange: e => { d.extra = Math.max(0, parseFloat(e.target.value) || 0); refreshAll(); } })),
          // A category that no longer exists in Categories/ (renamed, or a
          // hand-edited Debts.md) still gets an option of its own. Without it
          // the select falls back to "— none —" and shows a link that IS on
          // disk as absent — the reader then "fixes" it and loses the value.
          el('td', {}, el('select', { class: 'form-select form-select-sm', 'aria-label': `Budget category for ${d.name}`,
            onchange: e => { d.category = e.target.value; mark(); renderDebtPayments(); } },
            el('option', { value: '', ...(d.category ? {} : { selected: '' }) }, '— none —'),
            ...(d.category && !S.categories.some(c => c.name === d.category)
              ? [el('option', { value: d.category, selected: '' }, `${d.category} (missing)`)] : []),
            ...S.categories.map(c => el('option', { value: c.name, ...(c.name === d.category ? { selected: '' } : {}) }, c.name)))),
          payoffCell, clearCell, interestCell,
          el('td', {}, pill),
          el('td', {}, el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Remove ${d.name}`,
            onclick: () => { S.debts.splice(S.debts.indexOf(d), 1); mark(); renderDebts(); } }, '✕'))));

        refreshRow();
      }

      if (!S.debts.length) {
        body.append(el('tr', {}, el('td', { colspan: '11', class: 'text-muted' },
          'No debts tracked. Add one above — you only need the balance, the rate and what you pay each month.')));
      }
      t.append(body);
    });

    // Cycling a status is the main keyboard interaction here; rebuilding the
    // table drops focus to <body>, which ejects the reader to the top of the
    // page on every click. Same fix as Owed Money.
    if (focusRow !== undefined && focusRow >= 0) {
      const pill = t.querySelectorAll('.status-pill')[focusRow];
      if (pill) pill.focus();
    }
  }

  /* ------------------------------ persistence ---------------------------- */
  /* Columns, escaping and number formatting come from the same declaration
     the loader reads with (table-schema.js, ADR-0003); only the prose is
     this view's own. */
  function serializeDebts() {
    return mdTableFile({
      fm: S.debtsFm, fallback: 'kind: debts', title: 'Debts',
      prose: [
        'Money the household owes. `rate` is the annual interest rate as a percentage,',
        '`payment` the contracted monthly amount and `extra` anything paid on top of it.',
        '`status` is `active` or `paid`.',
      ],
      schema: SCHEMAS.debts, rows: S.debts,
    });
  }

  async function saveDebts() {
    await writeFile('Debts.md', serializeDebts());
    clearDirty();
    toast('Saved Debts.md');
  }

  async function addDebt() {
    const r = await askFields(app, 'New debt', [
      { key: 'name', label: 'What is it?', type: 'text' },
      { key: 'lender', label: 'Lender', type: 'text' },
      { key: 'type', label: 'Kind of debt', type: 'select', value: 'credit card', options: DEBT_TYPES },
      { key: 'balance', label: 'Balance still owed', type: 'number', value: '0' },
      { key: 'rate', label: 'Interest rate (% a year)', type: 'number', value: '0' },
      { key: 'payment', label: 'Monthly payment', type: 'number', value: '0' },
      { key: 'category', label: 'Budget category (links its transactions)', type: 'select', options: ['', ...S.categories.map(c => c.name)], value: '' },
    ]);
    if (!r || !r.name.trim()) return;
    /* Deliberately NOT unique. Two debts called "Credit card", one per bank, is
       the normal case — debt-math keys its payoff months by a positional `key`
       and focus restores by row index, so nothing downstream needs the name to
       be distinct. */
    const name = r.name.trim();
    const balance = normalizeAmount(r.balance), rate = normalizeAmount(r.rate), payment = normalizeAmount(r.payment);
    if ([balance, rate, payment].some(v => v === null)) return toast('Balance, rate and payment must be numbers', true);
    S.debts.push({
      name, lender: (r.lender || '').trim(), type: r.type || 'other',
      balance: Math.max(0, balance),
      // Seeded from the balance so the "paid off" bar has a baseline from day
      // one; edit it in Debts.md to the real original amount for a true figure.
      original: Math.max(0, balance),
      rate: Math.max(0, rate), payment: Math.max(0, payment), extra: 0,
      start: todayIso(),
      category: (r.category || '').trim(), status: 'active', notes: '',
    });
    mark(); renderDebts();
  }

  // The three planner controls all recompute the same two panels.
  /* --------------------------- payoff curve -----------------------------
     Total owed, month by month, under all three plans at once. The three
     summary cards below already give each plan's debt-free DATE; what a date
     cannot show is the SHAPE — that the minimum-only line barely bends for
     years while the rollover lines fall away from it, and how far apart they
     have drifted by the time the first one lands on zero.

     Every line is the `series` the same simulate() call produced for the card
     beside it, so the curve and the date can never tell different stories.

     Unlike the spending trend this range is projected forward out of the
     repayment schedule rather than read back out of imported history, so the
     long options are honest here: a 10-year home loan genuinely has 120 months
     of computed points behind it. */
  const PLAN_LINES = [
    { key: 'minimum', label: 'Minimum only', dash: '5 6' },
    { key: 'snowball', label: 'Snowball' },
    { key: 'avalanche', label: 'Avalanche' },
  ];

  const debtRange = () => rangeFor(plugin.settings.chartDebtRange) || rangeFor('5y');

  function syncRangeSelect() {
    const sel = $('#debtRange');
    if (sel.options.length !== RANGES.length) {
      sel.empty();
      for (const r of RANGES) sel.append(el('option', { value: r.key }, `${r.label} view`));
    }
    sel.value = debtRange().key;
  }

  function renderDebtCurve(runs) {
    const wrap = $('#debtCurve'); wrap.empty();
    syncRangeSelect();

    const months = debtRange().months;
    const chosen = planStrategy();
    const c = themeColors(root);
    const colorFor = key => (key === 'minimum' ? c.muted : key === chosen ? c.success : c.info);

    const lines = PLAN_LINES
      .map(l => ({ ...l, series: (runs.find(r => r.key === l.key) || {}).res?.series || [] }))
      .filter(l => l.series.length > 1);
    if (!lines.length) return;

    /* Clip to the range, but never past the point every plan has cleared —
       trailing flat zero is dead width that squeezes the part worth reading. */
    const longest = Math.max(...lines.map(l => l.series.length - 1));
    const span = Math.max(2, Math.min(months, longest));

    const W = 1000, H = 260;
    const at = (series, m) => series[Math.min(m, series.length - 1)] ?? 0;
    /* Scaled to the tallest point actually PLOTTED, not to the opening balance.

       Every plan that clears starts at its highest point, so series[0] looked
       like the maximum — but a plan whose payment sits at or below the monthly
       interest GROWS, which is exactly the `stalled` case debt-math.js exists to
       report honestly. Those lines ran off the top of a chart scaled to the
       opening figure and simply vanished: s.y() has no ceiling, so the path was
       drawn hundreds of thousands of units above the viewBox. R10 000 at 30%
       against R100 a month reaches R16.3 BILLION inside the 600-month cap. The
       card beside it says in words that the debt never clears; the chart showed
       a missing line, which reads as a broken chart rather than a diverging
       plan. Measured across the visible span only, so a long tail beyond the
       range cannot flatten the part being looked at. */
    const peak = Math.max(...lines.flatMap(l =>
      Array.from({ length: span + 1 }, (_, m) => at(l.series, m))));
    const max = Math.max(1, peak) * 1.08;
    const s = scales({ w: W, h: H, count: span + 1, max, padB: 34 });
    const { svg, add } = createChart({
      w: W, h: H,
      label: `Total owed over the next ${humanMonths(span)} under each payoff plan`,
    });

    const fill = areaGradient(add, 'debtCurveArea', colorFor(chosen), 0.18);
    gridlines(add, s, W);

    const pts = l => Array.from({ length: span + 1 }, (_, m) => [s.x(m), s.y(at(l.series, m))]);

    // The selected plan gets the fill, so the eye lands on the one in force.
    const sel = lines.find(l => l.key === chosen);
    if (sel) add('path', { d: areaPath(pts(sel), s.baseline), fill });

    for (const l of lines) {
      add('path', {
        d: linePath(pts(l)),
        fill: 'none', stroke: colorFor(l.key),
        'stroke-opacity': l.key === chosen ? '1' : '0.7',
        'stroke-width': l.key === chosen ? '2.75' : '1.75',
        'stroke-dasharray': l.dash || null,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      });
    }

    /* A year's worth of months is 12 hit strips; ten years is 120, which is
       both useless to aim at and 120 nodes to build. Sample to at most 24. */
    const step = Math.max(1, Math.ceil(span / 24));
    for (let m = 0; m <= span; m += step) {
      const hit = add('rect', {
        x: s.x(m) - s.innerW / (span * 2), y: s.padT,
        width: s.innerW / span, height: s.innerH, fill: 'transparent',
      });
      tip(add, hit, `${monthLabel(addMonths(m))} — ` +
        lines.map(l => `${l.label} ${money(at(l.series, m), 0)}`).join(' · '));
    }

    axisLabels(add, s, Array.from({ length: span + 1 }, (_, m) => monthLabel(addMonths(m))), H);

    wrap.append(svg);
  }

  function replan() { renderDebtKpis(); renderDebtPlan(); }

  // serializeDebts is published so the vault round-trip test drives the real one.
  ctx.provide({ renderDebts, saveDebts, addDebt, serializeDebts, replan, DEBT_TYPES });
};
