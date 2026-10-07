'use strict';
/* Debt — balances, interest cost, a payoff-strategy planner, and the link from
   each debt to the transactions actually paying it. Saved to Debts.md.

   The arithmetic lives in ../debt-math (pure, separately tested); this file is
   presentation and editing only. */

const { el, kpiTiles, keepScroll, icoEl, caveatChip } = require('../dom');
const { debtMonthly } = require('../committed');
const { normalizeAmount } = require('../amount');
const { SCHEMAS, mdTableFile } = require('../table-schema');
const { askFields } = require('../modal');
const { MONTHS } = require('../constants');
const { amortise, monthlyInterest, simulate, priorityOrder, addMonths, humanMonths, expectedBalance } = require('../debt-math');
/* typedBelowZero / flooredEntry / shownFigure: a negative typed into one of
   the four money cells is kept and shown while every total floors it — see
   worth.js, and editMoney below. */
const { activeDebts, cardOverlap, typedBelowZero, flooredEntry, shownFigure } = require('../worth');
/* The canonical "what does this month's interest cost" rule (see its own
   header): this file used to re-spell the aggregate inline and printed R0,00
   on a book where every Rate cell was blank, while the score withheld the
   same figure as unknown. */
const { debtInterestCoverage } = require('../health-math');
const { todayIso } = require('../dates');
const { symbolOf, isForeign } = require('../currency');
/* Namespace import, per the house rule — `t` is already taken as a local in
   several files, so every file in this app imports i18n the same way. */
const i18n = require('../i18n');
const {
  themeColors, createChart, scales, gridlines, axisLabels,
  linePath, areaPath, areaGradient, tip, RANGES, rangeFor,
} = require('../chart');

/* Debt kinds, in the order a household usually meets them. Stored verbatim in
   the Type column; an unknown value from a hand-edited file is kept as-is
   rather than coerced, the same way Services keeps a non-ISO billing date. */
const DEBT_TYPES = ['credit card', 'personal loan', 'vehicle', 'home loan', 'student', 'store account', 'overdraft', 'other'];

module.exports = function registerDebts(ctx) {
  const { S, $, root, app, plugin, money, toast, writeFile, txInPeriod, periodRange, ledger, tally, LENSES } = ctx;

  const { mark, clear: clearDirty } = ctx.dirtyFlag('debtsDirty', '#debtSave');

  /* The four money cells on a debt row route through normalizeAmount, the same
     way views/assets.js does — and for the same reason its comment gives.

     `parseFloat(e.target.value) || 0` reads an empty field as 0, and an empty
     field is what a plain number input reports when an SA-locale numeric keypad
     writes "15 000 000,00" into it. It also reads "R4 000" as 0 and
     "15 000 000,00" as 15. Paired with `<key>Raw = null` — which clears the
     verbatim text table-schema.js's money() preserved for a cell it could not
     read — that turned a balance of "1 234 567,89" into 0.00 on disk, with no
     toast and nothing to undo it. The reader had typed NOTHING.

     null from normalizeAmount means "no number in there": leave the stored
     figure alone, say so, and put it back in the field rather than leave the
     text the browser could not parse. A reader who genuinely means nought
     still types 0, and 0 parses. The "put it back" is explicit now: this used
     to call after() — refreshAll, which redraws the DERIVED cells and not the
     input — so the field stayed blank while the old figure was the one the
     next save wrote, and the page was marked unsaved for a change that never
     happened.

     Below zero is KEPT, not floored away. Math.max(0, v) used to save 0.00
     over a typed -250 — a credit balance on an overpaid card is a real thing
     to write down — with nothing on screen to say so while the field still
     showed "-250". flooredEntry() leaves the floored 0 in the field, so every
     total, projection and ratio on the page reads exactly what it always
     did, and keeps the typed text in `<key>Raw`, which the serializer writes
     back while the field still holds that 0. The row says it counts as 0. */
  const editMoney = (row, key, label, e, after) => {
    const v = normalizeAmount(e.target.value);
    if (v === null) { toast(`${label} must be a number`, true); e.target.value = String(shownFigure(row, key)); return; }
    const kept = flooredEntry(v, e.target.value);
    row[key] = kept.value; row[key + 'Raw'] = kept.raw; after();
  };

  /* The note beside a money field typed below zero. A Rate below zero is
     floored to 0, and a rate of 0 is no rate at all (rateUnknown, below), so
     it says that rather than "counts as 0". */
  const belowZeroText = key => (key === 'rate' ? 'counts as no rate' : 'counts as 0 in the totals');

  /* DEBT-1. A debt whose rate is unknown is not projected. Debts.md's Rate
     column reads a blank cell as 0 and the add dialog used to pre-fill '0',
     and health-math's Interest tile has read that 0 as UNKNOWN since 1.35.0
     ("covers 1 of 2 debts · 1 has no rate") — while every projection on this
     same page took it as a real 0% loan. A R900 000 bond with no rate showed
     "Interest still to pay R 0" and "Clear by Sep 2034", was ranked cheapest
     at 0.00% in the attack order, and set a Debt-free headline with no word
     that its cost had been assumed away; at any plausible rate the same
     payment takes about twice as long.

     The SAME rule as the tile, asked of one row — debtInterestCoverage over a
     one-debt list — rather than a second spelling of "rate > 0" that could
     drift from it. A paid debt is not active, so it is never "unknown"; it is
     not projected anyway. A genuine 0% deal reads as unknown too, as it
     already does on the tile: a projection the page cannot tell from a
     missing rate is not one it can make. */
  const rateUnknown = d => debtInterestCoverage([d]).missing > 0;

  /* A row's OWN figures in its OWN symbol (OWED-1) — views/assets.js's aMoney()
     on this page. Every cross-debt figure here is household-currency only by
     construction (active() below), but the TABLE lists every debt, and a euro
     bond's row read "Interest still to pay R 29 575" and "on this plan it
     would be R … by now" in the household's symbol. */
  const dMoney = (d, v, dp = 2) => (isForeign(d, S.settings.currency) && typeof ctx.moneyIn === 'function'
    ? ctx.moneyIn(symbolOf(d, S.settings.currency), v, dp)
    : money(v, dp));

  /* "Bond" / "Bond and Car" / "Bond, Car and Loan" — the debts a projection
     left out, named in a sentence. */
  const nameList = list => {
    const names = list.map(d => d.name);
    return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  };

  /* Copies, each stamped with a stable `key`, because two debts can share a
     name — "Credit card" once per bank is the normal case, not an edge one —
     and debt-math keys its payoff months by `key` for exactly that reason.
     Read-only everywhere it is used, so copying costs nothing and stops a view
     helper from writing through to the model by accident. */
  /* ISSUE 30. Debts.md gained a Currency column (ADR-0003 append), and every
     figure this page computes across debts — the payoff simulation, the
     avalanche/snowball ordering, the debt-to-income ratio, the total owed —
     is arithmetic that only means something inside ONE currency. A euro
     mortgage ordered against three rand cards by "highest rate first" is a
     schedule for a household that does not exist.

     So the working list is the household's own currency, and `activeForeign`
     is what that left out, stated on the page rather than dropped. The `key`
     is assigned over the FULL active list before filtering, because
     debt-math keys its payoff months positionally and a key that shifted
     when a foreign debt was added would silently repoint every projection. */
  /* `key` is the row's index in S.debts, which the editors need; which rows
     are ACTIVE is worth.js's rule (Phase 3 of ADR-0006). */
  const activeAll = () => activeDebts(S.debts.map((d, i) => ({ ...d, key: i })));
  const active = () => activeAll().filter(d => !isForeign(d, S.settings.currency));
  const activeForeign = () => activeAll().filter(d => isForeign(d, S.settings.currency));
  const committed = debtMonthly;   // one owner: committed.js (Phase 3 of ADR-0006)

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

  /* debt-math's addMonths requires a `from` Date rather than defaulting to
     `new Date()` internally — a clock read has no place in a pure module.
     Every caller below is this view, so the clock is read here instead, once,
     and built from todayIso() rather than `new Date(todayIso())` so it stays
     a LOCAL calendar date the way dates.js's own header insists on, not a
     fresh UTC-parse footgun. */
  const todayForMonths = () => {
    const [y, m, d] = todayIso().split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  /* ------------------------------- KPIs --------------------------------- */
  /* Split out so an edited balance can refresh the totals without rebuilding
     the row being typed into — on a phone `change` fires on blur, so a full
     rebuild lands between the tap leaving a field and the one arriving at the
     next, and the arriving tap hits whatever now occupies those pixels. */
  function renderDebtKpis() {
    /* A household tracking zero debts is the one this page should be
       congratulating, and until now it got four zeros ("Total debt R0,00 · 0
       active · 0 tracked", "Paying per month R0,00", "Interest this month
       R0,00") plus a "Debt-free —" tile captioned "no debt tracked" — the
       page's own worst-case wording, aimed at its best-case reader. One
       positive panel instead of four hollow ones; the "New debt" button
       already sits below the table for the reader who does have one to add. */
    if (!S.debts.length) {
      // Reuses the plain-paragraph shape renderDebtPlan already falls back to
      // below (no debt to plan for), rather than inventing a styled "card"
      // this file owns no CSS for — an unstyled custom class would render
      // with no layout at all rather than fail loudly.
      const box = $('#debtKpis'); box.empty();
      box.append(el('p', { style: 'margin:0;font-weight:600' }, 'No debt tracked — nothing owing here.'),
        el('p', { class: 'text-muted', style: 'margin:4px 0 0' },
          'Add a debt below if that changes, and this page will track the balance, the interest and a payoff plan for it.'));
      return;
    }
    /* The sibling case the comment above never covered: a household that HAS
       recorded debt but has paid every row of it off still has S.debts.length
       > 0, so the `!S.debts.length` gate above never fires for it — it fell
       through to the ordinary tile path and rendered "Total debt R0,00 · 0
       active · N tracked" plus a "Debt-free — no debt tracked" tile, the exact
       four-hollow-zero-tiles shape this function exists to eliminate, aimed at
       the one reader who most deserves the congratulation: the one who just
       finished paying. Gate on activeDebts (src/worth.js) — zero debts still
       COSTING anything — not on row count, and use different wording: "never
       recorded a debt" and "cleared everything recorded" are not the same
       sentence, and only the second is an achievement. */
    if (!activeDebts(S.debts).length) {
      const box = $('#debtKpis'); box.empty();
      box.append(el('p', { style: 'margin:0;font-weight:600' }, 'Debt-free — every debt you tracked has been paid off.'),
        el('p', { class: 'text-muted', style: 'margin:4px 0 0' },
          `${S.debts.length} debt${S.debts.length === 1 ? '' : 's'} paid in full. Add a new one below if that changes.`));
      return;
    }
    const list = active();
    const total = list.reduce((s, d) => s + d.balance, 0);
    const perMonth = list.reduce((s, d) => s + committed(d), 0);
    /* Through health-math.js's shared rule rather than a reduce of this
       file's own, because the two disagreed. `S.debts` plus the household
       symbol re-derives exactly `list` — activeDebts (status) narrowed by
       isForeign (currency) is the same pair of filters `activeAll()` and
       `active()` apply above, proven on a fixture in
       tests/debt-interest-coverage.test.cjs rather than assumed here. */
    const cover = debtInterestCoverage(S.debts, S.settings.currency);
    const interest = cover.monthly;
    const tile = kpiTiles($('#debtKpis'));
    // Neutral: owing money is an ordinary financial position, not a red state.
    /* What the figures on this page do NOT cover, said on the first tile the
       reader looks at. A foreign debt is still tracked, still listed and
       still counted in "tracked" — it is only held out of arithmetic that
       cannot span currencies. */
    const fx = activeForeign();
    const fxTag = fx.length
      ? ` · ${fx.length} in another currency, not in these figures`
      : '';
    tile('Total debt', money(total), '',
      `${list.length} active · ${S.debts.length} tracked${fxTag}`);
    tile('Paying per month', money(perMonth), '', perMonth ? `${money(perMonth * 12, 0)} a year` : 'nothing budgeted');
    // The single most actionable number here: what this month costs before a
    // cent of principal moves.
    /* Three states, because a blank Rate column is not a rate of zero. With
       NO rate stated anywhere the figure is unknown, and this tile withholds
       it — the same '—' placeholder the Debt-free tile below and the Savings
       growth tile already use for "no figure to give", captioned with the one
       thing that would make it knowable. Printing R0,00 instead told a
       household carrying a R900 000 bond that its debt was free.

       With SOME rates stated the sum is real but partial, so it prints WITH
       what it covers: a figure covering one debt of three, presented as the
       household's interest bill, is the same false claim wearing a true
       number. Fully rated is untouched, caption and all — the disclosure is
       additive, and a household that filled the column in should see no
       change at all. */
    if (interest === null) {
      tile('Interest this month', '—', '', i18n.t('debt.interest.noRates'));
    } else if (cover.missing > 0) {
      /* `count` alongside `missing`, carrying the same value. i18n.t() picks
         a plural form from `count` and from nothing else, and this sentence
         pluralises on the debts MISSING a rate — so passing `missing` alone
         selects every language's `other` form and renders "1 have no rate"
         in precisely the single-missing case the tile most often meets. Same
         shape as 'tx.showMore'; the reasoning is recorded above the key in
         src/lang/en.js, and the one-missing render is pinned in
         tests/debt-interest-coverage.test.cjs against the other-form render
         so an assertion that passed either way cannot creep back. */
      tile('Interest this month', money(interest), interest > 0 ? 'text-warning' : '',
        i18n.t('debt.interest.partial',
          { shown: cover.shown, total: cover.total, missing: cover.missing, count: cover.missing }));
    } else {
      tile('Interest this month', money(interest), interest > 0 ? 'text-warning' : '',
        perMonth > 0 ? `${Math.round((interest / perMonth) * 100)}% of your payments` : '');
    }
    /* ITEM 1 re-sourcing: this tile used to run the PLANNER's own simulate()
       call below — whatever `extra` sat in #debtExtra and whichever strategy
       was selected in #debtStrategy — so typing 3000 into a box moved the
       page's own headline promise 34 months earlier with nothing saved to
       Debts.md to show for it, and the number kept moving as the reader
       experimented. That coupling is now gone: the headline answers a
       narrower, unmoving question — debt-free on RECORDED reality alone, each
       debt's own contracted `payment` plus any standing `extra` already saved
       to the file. That is exactly debt-math's `strategy: 'minimum'` run (see
       simulate()'s own header): no pooled what-if extra, and no rollover of a
       cleared payment into the next — rollover is itself a strategy choice a
       household has to opt into, not a fact any file states. The planner's
       what-if still exists; it now lives ONLY in renderDebtPlan's own
       "With this extra/plan" line, which is free to move without dragging
       this tile with it. Recomputed here rather than shared with
       renderDebtPlan's own `base` — two cheap simulate() calls over a
       household's handful of debts costs nothing, and sharing one across two
       functions is exactly the kind of coupling this fix removes. */
    /* DEBT-1: over the debts whose rate is known (rateUnknown above), and the
       caption says what that leaves out — a date that silently treated a
       rate-less bond as interest-free was the headline promise of the page.
       A fully rated book takes neither branch and reads exactly as before. */
    const rated = list.filter(d => !rateUnknown(d));
    const unrated = list.length - rated.length;
    const ratedTotal = rated.reduce((s, d) => s + d.balance, 0);
    const base = simulate(rated, { strategy: 'minimum' });
    const dated = base.settled && base.months;
    const excludes = unrated ? ` · excludes ${unrated} debt${unrated === 1 ? '' : 's'} with no rate` : '';
    tile('Debt-free', dated ? monthLabel(addMonths(base.months, todayForMonths())) : (ratedTotal > 0 ? 'not at this payment' : '—'),
      dated ? 'grad-txt' : (ratedTotal > 0 ? 'text-danger' : ''),
      dated ? `${humanMonths(base.months)} — at your recorded payments and extras, no what-if${excludes}`
        : ratedTotal > 0 ? `not within 50 years at the payments entered${excludes}`
          : unrated ? 'add a rate to any debt to project a date'
            : 'no debt tracked');
  }

  /* ------------------------------ the plan -------------------------------
     Three runs side by side. "Minimum only" is the do-nothing baseline the
     other two are measured against — without it, "you'd pay R48k interest"
     is a number with nothing to compare to, and the whole card is just a
     bill. */
  function renderDebtPlan() {
    /* DEBT-1: the plan, the curve and the attack order run over the debts
       whose rate is known, and name the rest. A rate-less debt was listed
       at "0.00%" — ranked the cheapest debt in the book, so avalanche put it
       last in line for spare money — and cleared on a 0% schedule: an
       ordering of a household that does not exist. Its payment is not pooled
       either: a plan that cannot price the debt cannot say when its payment
       would come free. */
    const all = active();
    const list = all.filter(d => !rateUnknown(d));
    const unrated = all.filter(rateUnknown);
    const one = unrated.length === 1;
    const wrap = $('#debtPlan'); wrap.empty();
    const order = $('#debtOrder'); order.empty();

    if (!all.length) {
      $('#debtCurve').empty();
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        'Add a debt below and this becomes a payoff plan — how long each method takes, and what it saves.'));
      return;
    }
    if (!list.length) {
      $('#debtCurve').empty();
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        `Add the interest rate to ${one ? 'the debt' : 'each debt'} below and this becomes a payoff plan. `
        + `A debt with no rate cannot be projected, so ${nameList(unrated)} ${one ? 'is' : 'are'} not planned here.`));
      order.append(el('div', { class: 'text-muted', style: 'font-size:12.5px' },
        `Not ranked: ${nameList(unrated)} — no rate stated, so ${one ? 'its' : 'their'} cost cannot be compared.`));
      return;
    }

    const extra = planExtra();
    const chosen = planStrategy();
    const base = simulate(list, { strategy: 'minimum' });
    const runs = [
      { key: 'minimum', label: 'Minimum only', note: 'Just the payments you already make, nothing extra', res: base },
      { key: 'snowball', label: 'Snowball', note: 'Smallest balance first', res: simulate(list, { extra, strategy: 'snowball' }) },
      { key: 'avalanche', label: 'Avalanche', note: 'Highest rate first', res: simulate(list, { extra, strategy: 'avalanche' }) },
    ];
    // The chosen run, reused below both for this card's own headline and for
    // the attack-order list further down — planStrategy() only ever returns
    // one of the two non-minimum keys, so a second simulate() call would just
    // recompute a result already sitting in `runs`.
    const plan = runs.find(r => r.key === chosen).res;

    /* ITEM 1: the page KPI (renderDebtKpis) no longer carries this what-if —
       it now answers "recorded reality only". This line is where the what-if
       still lives: the SELECTED run's own projected debt-free date, following
       whatever sits in the two controls above (extra + strategy) right now.
       Typing into "Extra per month" or switching Snowball/Avalanche moves
       THIS line, and only this line — never the page's own headline tile. */
    const projLabel = extra > 0 ? 'With this extra' : 'With this plan';
    wrap.append(el('div', { class: 'debt-plan-projected' },
      plan.settled && plan.months
        ? el('div', { class: 'dpp-h' }, `${projLabel}: debt-free ${monthLabel(addMonths(plan.months, todayForMonths()))}`)
        : el('div', { class: 'dpp-h text-danger' }, `${projLabel}: not within 50 years`),
      el('div', { class: 'dpp-sub' },
        plan.settled && plan.months ? `${humanMonths(plan.months)} on ${chosen}` : `at this payment, on ${chosen}`,
        extra > 0 ? ` with ${money(extra, 0)}/mo extra` : '')));

    const grid = el('div', { class: 'debt-plans' });
    for (const r of runs) {
      const saved = base.settled && r.res.settled ? base.interest - r.res.interest : 0;
      const sooner = base.settled && r.res.settled ? base.months - r.res.months : 0;
      const card = el('div', { class: `debt-plan${r.key === chosen ? ' is-chosen' : ''}` },
        el('div', { class: 'dp-h' }, el('b', {}, r.label),
          r.key === chosen ? el('span', { class: 'dp-tag' }, 'selected') : ''),
        el('div', { class: 'dp-note' }, r.note),
        el('div', { class: 'dp-date num' }, r.res.settled && r.res.months ? monthLabel(addMonths(r.res.months, todayForMonths())) : 'not at this payment'),
        el('div', { class: 'dp-sub' }, r.res.settled && r.res.months ? humanMonths(r.res.months) : 'does not clear within 50 years'),
        el('div', { class: 'dp-row' }, el('span', {}, 'Total interest'),
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
    if (unrated.length) {
      wrap.append(el('p', { class: 'text-muted', style: 'margin:12px 0 0;font-size:12.5px' },
        `Not in this plan: ${nameList(unrated)} — no rate stated. Add the rate to include ${one ? 'it' : 'them'}.`));
    }

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
       in this list, so showing it is what makes the choice concrete. `plan` is
       the same chosen-run reference hoisted above, for this card's own
       headline. */
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
        el('span', { class: 'do-d' }, at ? `clear ${monthLabel(addMonths(at, todayForMonths()))}` : 'not clearing')));
    }
    order.append(ol);
    if (unrated.length) {
      order.append(el('div', { class: 'text-muted', style: 'margin-top:8px;font-size:12.5px' },
        `Not ranked: ${nameList(unrated)} — no rate stated, so ${one ? 'its' : 'their'} cost cannot be compared.`));
    }
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

    /* ISSUE 30. Two currency problems in one line, and the second is the one
       that has been here longest.

       CURRENCY: `Debts.md` has no currency column, so every debt figure —
       balance, payment, the `planned` totals below — is in the household's
       own currency by construction. The transactions matched against them
       were not: a rand debt paid from a dollar account read as ~94% short
       forever, and a payment made in another currency inflated the `paid`
       side of a bar drawn against a household-currency `planned`.

       BUDGET SCOPE: this path uses txInPeriod directly rather than
       summaryInRange, so unlike every other spend figure in the app it never
       dropped `budget: false` accounts either — an account explicitly opted
       OUT of budget totals still fed these payment bars. Both filters applied
       here, and what they exclude is counted so the note below can say so
       rather than leaving a bar quietly short. */
    /* Phase 3 of ADR-0006: what was PAID under a debt's category is the
       BUDGET lens's gross outgoing for that category — the same vetoes the
       Dashboard hero applies (this walk used to apply three of its five:
       excluded, non-budget and foreign, but neither the earmarked-fund nor
       the transfer veto). The foreign disclosure comes off the same tally. */
    const { start, end } = periodRange(S.period);
    const paidTally = tally(ledger(start, end), LENSES.BUDGET);
    const droppedForeign = new Set(paidTally.foreign.symbols);
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
        const paid = paidTally.grossOutByCat[cat] || 0;
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
    /* What the payment bars above left out, said rather than silently short.
       currency.js:14 is explicit that this app does not exclude — so where it
       must (a payment in another currency cannot be counted toward a
       household-currency plan), it names what it excluded. */
    if (droppedForeign.size) {
      note.append(el('div', { class: 'text-muted', style: 'margin-top:6px' },
        `Payments made from accounts in ${[...droppedForeign].join(' · ')} are not counted above — `
        + `there is no exchange rate here to measure them against a ${S.settings.currency} plan.`));
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

  /* worth.js's cardOverlap() — a credit card honestly tracked as BOTH an
     account and a debt-page row, which double-counts it in net worth — was
     already surfaced on the Dashboard and on the Savings worth chart, but not
     here, on one of the two pages that actively invites the double-entry: add
     a debt below and nothing stops it being the same Visa already sitting in
     Accounts. Read fresh on every render rather than cached, same as the
     other two call sites, since either ledger can change under it.

     No dedicated container exists in shell.js for this page (unlike the
     Dashboard's #dashPositionNote), so the note manages its own insertion
     point — found by its class and replaced whole on every render, the same
     idempotent redraw every other section of this file uses via `.empty()`
     on an id it owns. */
  function renderDebtOverlap() {
    const t = $('#debtTable');
    const tableWrap = t.closest('.table-responsive');
    const container = tableWrap && tableWrap.parentNode;
    if (!container) return;                        // shell without this card mounted
    const existing = container.querySelector('.debt-card-overlap');
    if (existing) existing.remove();

    const overlap = cardOverlap(S.accounts, S.debts);
    if (!overlap) return;

    const note = el('div', { class: 'kpi-caveat-txt' }, icoEl(['info', 'alert-circle']),
      `Credit-card accounts tracked: ${overlap.cardAccounts} · card debts tracked: ${overlap.cardDebts} — ` +
      'if the same card is on both, it is counted twice in net worth.');
    const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
      'aria-label': 'Review credit-card accounts on the Accounts page' }, 'Review accounts');
    btn.addEventListener('click', () => ctx.switchView('accounts'));

    container.insertBefore(
      el('div', { class: 'debt-card-overlap', style: 'margin-bottom:12px' }, note, btn), tableWrap);
  }

  /* ------------------------------ the table ------------------------------
     focusRow: index into S.debts whose status pill should get focus back after
     the rebuild. An index rather than a name — two debts can share one, and
     looking the row up by name put focus on the wrong pill. */
  function renderDebts(focusRow) {
    renderDebtKpis();
    renderDebtPlan();
    renderDebtPayments();
    renderDebtOverlap();

    const t = $('#debtTable');
    keepScroll(t, () => {
      t.empty();
      // A debt whose `original` still equals its `balance` never had a real
      // original amount entered — it's either brand new or was seeded from
      // the balance at creation because the field was left blank — so the
      // percentage under it is counting from today, not from the true start
      // of the loan. When that's true of every tracked debt, the header says
      // so; a mixed book keeps the plain label rather than mislabel the rows
      // that DO have a real original.
      const tracked = S.debts.filter(d => d.original > 0);
      const paidOffHeader = tracked.length && tracked.every(d => d.original === d.balance)
        ? 'Paid off (since you added it)' : 'Paid off';
      t.append(el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Debt'),
        el('th', { scope: 'col', class: 'num' }, 'Balance'),
        el('th', { scope: 'col', class: 'num' }, 'Rate %'),
        el('th', { scope: 'col', class: 'num' }, 'Payment'),
        el('th', { scope: 'col', class: 'num' }, 'Extra / month'),
        el('th', { scope: 'col' }, 'Category'),
        el('th', { scope: 'col' }, paidOffHeader),
        el('th', { scope: 'col' }, 'Clear by'),
        // "Interest left" on its own reads as ambiguous on a table already full
        // of adjacent money columns (Balance, Payment, Extra) — the caveat chip
        // names what it actually is: interest still to be paid, not interest
        // already paid or a balance figure. A tappable chip rather than a longer
        // visible label because the header row is already eleven columns wide on
        // a table that scrolls horizontally on a phone; every other header here
        // stays terse for the same reason (Payment, Extra / month, Clear by). A
        // bare `title` here used to be invisible on the phone this table scrolls
        // on in the first place — caveatChip (dom.js) is the fix.
        el('th', { scope: 'col', class: 'num' }, caveatChip('Interest still to pay',
          'Total interest still to be paid before this debt clears, at the balance, rate and payment as entered')),
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
        /* One note per money field, beside it, refreshed in place with the
           derived cells — empty unless that figure was typed below zero. */
        const belowZero = {};
        for (const k of ['balance', 'rate', 'payment', 'extra']) {
          belowZero[k] = el('div', { class: 'text-muted', style: 'font-size:11.5px' });
        }

        function refreshRow() {
          for (const k of Object.keys(belowZero)) {
            belowZero[k].textContent = typedBelowZero(d, k) !== null ? belowZeroText(k) : '';
          }
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
             ignore the line that matters.

             Not for a debt with no rate (DEBT-1): the schedule is worked
             forward at the rate, and at a missing one it was worked at 0% —
             "on this plan it would be R249 500 by now" for a bond that has
             been accruing interest all along. */
          if (d.status !== 'paid' && !rateUnknown(d)) {
            const exp = expectedBalance(d, todayIso());
            if (exp) {
              const gap = d.balance - exp.expected;
              const material = Math.abs(gap) > Math.max(50, d.original * 0.02);
              if (material) {
                // The short line stays visible on its own — no tooltip needed to
                // read THAT the schedule disagrees. The full derivation (the
                // inputs it ran from, and what could explain the gap) used to
                // live only in a `title`, invisible on a phone, which is half of
                // where this table is read — caveatChip (dom.js) makes it
                // reachable by tap there too.
                payoffCell.append(el('div', { class: 'debt-implied' }, caveatChip(
                  `on this plan it would be ${dMoney(d, exp.expected, 0)} by now`,
                  `From ${dMoney(d, d.original)} at ${d.rate}% paying ${dMoney(d, committed(d))} a month since ${d.start}, `
                    + `the schedule puts this at ${dMoney(d, exp.expected)} after ${exp.months} months. `
                    + `Your figure is ${dMoney(d, Math.abs(gap))} ${gap > 0 ? 'higher' : 'lower'} — a missed payment, a rate change or a fee would explain it, and so would a stale balance.`)));
              }
            }
          }

          clearCell.empty(); interestCell.empty();
          if (d.status === 'paid') {
            clearCell.append(el('span', { class: 'text-success' }, 'settled'));
            interestCell.append(el('span', { class: 'text-muted' }, '—'));
          } else if (rateUnknown(d)) {
            /* DEBT-1: no date and no interest figure for a debt whose rate is
               unknown — "Interest still to pay R 0" is the false claim the
               Interest tile above was taught not to make in 1.35.0. Said in
               the row, with the one thing that would make it knowable. */
            clearCell.append(el('span', { class: 'text-muted' }, 'rate unknown'),
              el('div', { class: 'text-muted', style: 'font-size:11.5px' }, 'add the rate to project this debt'));
            interestCell.append(el('span', { class: 'text-muted' }, '—'));
          } else {
            const a = amortise(d.balance, d.rate, committed(d));
            if (!a.settled) {
              /* Did not close inside the 600-month horizon amortise runs to. That
                 covers a payment genuinely below the interest AND one just above
                 it that simply takes decades, so this says what is known rather
                 than asserting the interest is winning. */
              clearCell.append(el('span', { class: 'text-danger' }, committed(d) > 0 ? 'not in 50 yrs' : 'no payment'));
              interestCell.append(el('span', { class: 'text-danger num' }, `+${dMoney(d, monthlyInterest(d.balance, d.rate), 0)}/mo`));
            } else {
              clearCell.append(el('span', {}, monthLabel(addMonths(a.months, todayForMonths()))),
                el('div', { class: 'text-muted', style: 'font-size:11.5px' }, humanMonths(a.months)));
              interestCell.append(dMoney(d, a.interest, 0));
            }
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
          /* All four money cells go through editMoney — see its comment for
             why the parse and the `<key>Raw` handling belong together — and
             draw through shownFigure, so a figure kept below zero is redrawn
             as itself rather than as the blank its floored 0 would give. */
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: shownFigure(d, 'balance'),
            style: 'width:120px', 'aria-label': `Balance owed on ${d.name}`,
            onchange: e => editMoney(d, 'balance', 'Balance', e, refreshAll) }), belowZero.balance),
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: shownFigure(d, 'rate'),
            style: 'width:84px', 'aria-label': `Annual interest rate on ${d.name}`,
            onchange: e => editMoney(d, 'rate', 'Rate', e, refreshAll) }), belowZero.rate),
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: shownFigure(d, 'payment'),
            style: 'width:110px', 'aria-label': `Monthly payment on ${d.name}`,
            onchange: e => editMoney(d, 'payment', 'Payment', e, refreshAll) }), belowZero.payment),
          el('td', { class: 'num' }, el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: shownFigure(d, 'extra'),
            style: 'width:100px', 'aria-label': `Extra paid each month on ${d.name}`,
            onchange: e => editMoney(d, 'extra', 'Extra', e, refreshAll) }), belowZero.extra),
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
      // ISSUE 67/69 — a paragraph above/below the table and a hand-added
      // column both survive a save now; see load.js's tableParts.
      leadRaw: S.debtsLead, trailRaw: S.debtsTrail, extraCols: S.debtsExtraCols,
    });
  }

  /* Guarded for the same reason as every save on this page's Save button:
     before this, a rejected write was an unhandled rejection — no try/catch
     meant no toast and no code path to run at all, so the dirty flag was left
     exactly as it was (clearDirty() sits AFTER the write and never ran on a
     rejection) with nothing on screen to say the save had failed. The button
     stayed lit and the flag stayed dirty by ACCIDENT, not by design; the only
     bug was the silence. Now the failure toasts and the same left-dirty state
     is kept on purpose, so the same click retries. */
  async function saveDebts() {
    try {
      await writeFile('Debts.md', serializeDebts());
    } catch (e) {
      return toast(`Could not save Debts.md (${e.message || e})`, true);
    }
    clearDirty();
    toast('Saved Debts.md');
  }

  async function addDebt() {
    const r = await askFields(app, 'New debt', [
      { key: 'name', label: 'What is it?', type: 'text' },
      { key: 'lender', label: 'Lender', type: 'text' },
      { key: 'type', label: 'Kind of debt', type: 'select', value: 'credit card', options: DEBT_TYPES },
      { key: 'balance', label: 'Balance still owed', type: 'number', value: '0' },
      /* Optional, and asked for up front rather than left to a hand-edit of
         Debts.md — which is what the ONLY previous route to a real "Paid off"
         figure required, with no field anywhere on the page to reach it. A
         household that had paid R300 000 down to R80 000 saw "0%" forever and
         had every reason to conclude the bar itself was broken. Left blank,
         `original` falls back to today's balance below, same as before: the
         bar still draws, it just starts counting from today rather than from
         the true original loan. */
      { key: 'original', label: 'What did you originally borrow?', type: 'number', value: '',
        desc: 'Optional — leave blank to start the "Paid off" progress bar from today\'s balance instead.' },
      /* Blank, not '0' (DEBT-1). A pre-filled 0 was saved by every reader who
         did not have the statement to hand, and a rate of 0 then read as a
         0% loan to every projection on this page. Blank is the honest
         default: it is stored as the 0 a blank cell reads as, which this page
         treats as UNKNOWN — and says so — rather than as interest-free. */
      { key: 'rate', label: 'Interest rate (% a year)', type: 'number', value: '',
        desc: 'Leave blank if you do not know it yet — the page then says the rate is unknown instead of projecting this debt as interest-free.' },
      { key: 'payment', label: 'Monthly payment', type: 'number', value: '0' },
      { key: 'category', label: 'Budget category (links its transactions)', type: 'select', options: ['', ...S.categories.map(c => c.name)], value: '' },
      /* ISSUE 30 — see views/assets.js. Blank means the household's currency,
         which is what every row already on disk says by saying nothing, so
         this is an option and never a question a single-currency household
         has to answer. */
      { key: 'currency', label: 'Currency', type: 'text', value: '',
        placeholder: S.settings.currency || 'R',
        desc: 'Leave blank if it is in your own currency. Set it if this one is not — the figure is then shown in its own currency and stated separately rather than added into your totals.' },
    ]);
    if (!r || !r.name.trim()) return;
    /* Deliberately NOT unique. Two debts called "Credit card", one per bank, is
       the normal case — debt-math keys its payoff months by a positional `key`
       and focus restores by row index, so nothing downstream needs the name to
       be distinct. */
    const name = r.name.trim();
    // A blank rate is an answer — "not known yet" (see the field above) — and
    // only typed, unparseable text is an error.
    const rateText = (r.rate || '').toString().trim();
    const balance = normalizeAmount(r.balance), rate = rateText ? normalizeAmount(rateText) : 0, payment = normalizeAmount(r.payment);
    if ([balance, rate, payment].some(v => v === null)) return toast('Balance, rate and payment must be numbers', true);
    // Blank is the expected case (see the field's `desc` above) — only a
    // typed, unparseable value is an error, not an empty box.
    const originalRaw = (r.original || '').toString().trim();
    const originalTyped = originalRaw ? normalizeAmount(originalRaw) : null;
    if (originalRaw && originalTyped === null) return toast('Original amount must be a number', true);
    /* Below zero is kept as typed, exactly as the table's own fields keep it
       (editMoney) — floored in the field, the text in `<key>Raw` — rather
       than silently zeroed. */
    const typed = {
      balance: flooredEntry(balance, r.balance), rate: flooredEntry(rate, rateText),
      payment: flooredEntry(payment, r.payment),
    };
    const raws = {};
    for (const [k, e] of Object.entries(typed)) if (e.raw !== null) raws[k + 'Raw'] = e.raw;
    const originalKept = originalTyped !== null ? flooredEntry(originalTyped, originalRaw) : null;
    if (originalKept && originalKept.raw !== null) raws.originalRaw = originalKept.raw;
    S.debts.push({
      // '' when it merely restates the household symbol — see usedColumns().
      currency: (r.currency || '').trim() === (S.settings.currency || '') ? '' : (r.currency || '').trim(),
      name, lender: (r.lender || '').trim(), type: r.type || 'other',
      balance: typed.balance.value,
      // The real original loan when given; otherwise seeded from the balance
      // so the "paid off" bar still has a baseline from day one — see
      // refreshRow(), which now also names that baseline on screen.
      original: originalKept ? originalKept.value : Math.max(0, balance),
      /* ISSUE 68's flag, set HERE as well as in load.js's post() step. A debt
         loaded from disk gets it there; one added through this form did not, so
         a blank Original — the expected case — seeded `original` from the
         balance and then wrote that derived figure into Debts.md as though the
         household had typed it. The next load read it back as stated and the
         distinction was gone for good. `false` is what makes the serializer
         write an empty cell instead of a claim nobody made. */
      originalStated: originalTyped !== null,
      rate: typed.rate.value, payment: typed.payment.value, extra: 0,
      ...raws,
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
    const chartToday = todayForMonths();   // one clock read for the whole chart, not one per strip
    for (let m = 0; m <= span; m += step) {
      const hit = add('rect', {
        x: s.x(m) - s.innerW / (span * 2), y: s.padT,
        width: s.innerW / span, height: s.innerH, fill: 'transparent',
      });
      tip(add, hit, `${monthLabel(addMonths(m, chartToday))} — ` +
        lines.map(l => `${l.label} ${money(at(l.series, m), 0)}`).join(' · '));
    }

    axisLabels(add, s, Array.from({ length: span + 1 }, (_, m) => monthLabel(addMonths(m, chartToday))), H);

    wrap.append(svg);
  }

  function replan() { renderDebtKpis(); renderDebtPlan(); }

  // serializeDebts is published so the vault round-trip test drives the real one.
  ctx.provide({ renderDebts, saveDebts, addDebt, serializeDebts, replan });
};
