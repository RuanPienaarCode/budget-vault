'use strict';
/* Dashboard — hero card, spending-trend SVG, category split, budget-vs-actual. */

const { el, icoEl } = require('../dom');
const { safeSeg } = require('../vault-path');
const { typeOrder, typeRank } = require('../groups');
/* Namespace import: this file binds `t` as a local (`const t = $('#dashBudget')`). */
const i18n = require('../i18n');
const { stalenessSummary, reconcile, isStale } = require('../reconcile');
const { whatsLeft, isSettleCard } = require('../committed');
const { scoreBand } = require('../health-math');
const { todayIso } = require('../dates');
const { allocatedShare, incomeBaseFor } = require('../money-flow');
const { worth, cardOverlap, otherCurrencyNet } = require('../worth');
const { owedSummary } = require('../owed-math');
const { currenciesIn, symbolOf, isForeign, splitByCurrency, primaryTotal } = require('../currency');
const {
  themeColors, createChart, scales, gridlines, axisLabels,
  linePath, areaPath, areaGradient, arcPath, tip, trackPoints, distinctColors,
  historicalRanges, rangeFor, rangePills,
} = require('../chart');

/* Shared with views/accounts.js — see share-percents.js for why a donut's
   percentage column is allocated by largest remainder, never rounded per
   slice. Re-exported at the bottom of this file so the donut test keeps
   reading each view's own door. */
const { sharePercents, largestRemainder, sharePercentLabel } = require('../share-percents');
/* The ONE rule for what an assume-spent category's Actual reads. Declared and
   exported by views/budgets.js — the page the flag belongs to — and taken from
   there rather than restated here, because restating it is exactly what went
   wrong: this file's own copy read `assumed ? budgeted : 0` and then SKIPPED
   the transaction pass for the row, DISCARDING real spend. So one Carry
   category budgeted R2 500 against a real R4 000 payment read R4 000 and over
   on the Budget page, and R2 500 and "on budget" in the table below,
   in views/report.js and in both exports — three of the four surfaces telling
   a reader who is R1 500 over that they are fine, because budgetVsActualRows
   is the single source all three read. Required as a MODULE rather than taken
   off ctx, so neither view depends on the other's registration order. */
const { assumedActual } = require('../money-flow');

module.exports = function registerDashboard(ctx) {
  const { S, $, app, root, plugin, money, toast, fileAt, periodSummary, budgetTotals, budgetUsed, periodTitle, periodMonthName, periodShortLabel, dayLabel, periodRange, shiftPeriod, currentPeriod, txInPeriod, nonBudgetLabels, catType, catAssumeSpent, accountIndex, impliedAccounts, movedToFunds, accountForLabel, periodsForMonths, trendPeriods, historySpan, elapsedDays, periodSpend, compareTotals, healthSnapshot, locale } = ctx;

  /* ------------------------------ card guards ---------------------------
     Each card draws behind its own try/catch. Before this the four sections
     were four bare calls in a row, with no catch anywhere between here and
     controller.js's render(): a throw while building the trend took the donut
     and the budget table down with it. Crucially they did not go BLANK — both
     had already been drawn once, so they froze on the previous period's
     picture while the hero above them, built first, updated normally. A chart
     that is frozen but plausible is worse than one that is missing: it reads
     as "the graph doesn't update", so it gets reported as a staleness bug and
     the actual exception is never looked for.

     The message is deliberately on screen and not only in the console. Most of
     this plugin's users are on a phone, where there is no console to open. */
  function guard(sel, label, fn) {
    try {
      fn();
    } catch (e) {
      console.error(`Budget: the ${label} card failed to render`, e);
      /* The recovery gets its own catch. Whatever threw upstairs may well have
         been a DOM call, in which case the same call here throws again — out
         of the catch block, past render(), and the guard that was supposed to
         contain one broken card takes down all four instead. The console line
         above is already away by this point, so the diagnosis survives even
         when nothing can be painted. */
      try {
        const box = $(sel);
        if (!box) return;
        box.empty();
        const msg = i18n.t('dash.err.render', { label, error: e?.message || e });
        // A <p> dropped straight into a <table> is not rendered by any engine,
        // so the one table target gets a row instead.
        box.append(box.tagName === 'TABLE'
          ? el('tbody', {}, el('tr', {}, el('td', { class: 'text-danger', colspan: '5' }, msg)))
          : el('p', { class: 'text-danger', style: 'margin:0' }, msg));
      } catch (inner) {
        console.error(`Budget: the ${label} card could not report its own failure`, inner);
      }
    }
  }
  /* Guarded at the boundary rather than at each call site, because these two
     are also called straight from applyTheme() on a theme flip — where the
     same throw would freeze the same two cards. */
  const guardedTrend = () => guard('#trendChart', 'spending trend', renderTrend);
  const guardedSplit = () => guard('#dashSplit', 'spending split', renderSplit);

  function renderDashboard() {
    guard('#heroCard', 'summary', renderHero);
    guard('#healthBody', 'financial health', renderHealth);
    guard('#leftBody', "what's left", renderLeft);
    guardedTrend();
    guardedSplit();
    guard('#dashBudget', 'budget table', renderBudgetTable);
    /* Position last, and in this order: the tiles decide whether the card is
       shown at all, so they run before the caveats that live inside it. Both
       caveats keep their own guard — a throw computing net worth must not cost
       the reader the sentence explaining that the balances are months old. */
    guard('#dashPositionKpis', 'position summary', renderPosition);
    guard('#dashPositionNote', 'double-count note', renderOverlapNote);
    guard('#dashStale', 'balance staleness', renderStale);
  }

  /* ------------------------- financial health ---------------------------
     The hero is this period's budget and What's left is this period's money;
     this card is the household's years — emergency cover, the savings rate,
     the interest bill, and the composite score. All arithmetic lives in
     src/health-math.js; this function only assembles the raw material from
     the ctx helpers that already exist and renders what comes back.

     ANCHORED AT THE CURRENT PERIOD, whatever period is on screen. Every input
     is present tense — the fund is today's balances, the debts are today's
     book, and the averages trail back from now — so paging to March must not
     rewrite the household's readiness. The same reasoning renderLeft applies,
     resolved the opposite way: that card goes inert off the current period
     because its inputs would lie; this one stays live because its inputs
     never consulted the period on screen in the first place.

     TRAILING COMPLETED PERIODS ONLY, deliberately excluding the running one.
     A part-month's income against a whole month's savings target is the
     part-period trap elapsedDays() documents; completed periods are whole
     figures that no longer move. periodsForMonths(6) turns "six months" into
     however many periods that is on this vault's pay cycle. */
  function renderHealth() {
    const card = $('#healthCard');
    const body = $('#healthBody'); body.empty();

    /* One assembly, shared with the Score page — see health-data.js for why
       this is not gathered here. */
    const snap = healthSnapshot();
    const { metrics: H, earmarks, target, debtInterest } = snap;

    const nothing = snap.empty;
    if (card) card.classList.toggle('hidden', nothing);
    if (nothing) return;

    const sub = $('#healthSub');
    if (sub) {
      sub.textContent = H.countedPeriods
        ? i18n.t('dash.health.sub', { count: H.countedPeriods })
        : i18n.t('dash.health.subNone');
    }

    /* A tile with a `to` becomes a real <button> that routes there. These
       four figures are summaries of pages that argue them in full, and a
       reader who wants more from one of them wants that page — not a popup
       restating it on the page they are already on. No aria-label: the
       button's own text ("58 financial score steady") already reads as the
       thing being activated, and a label would talk over it. */
    const fig = (cls, value, label, meta, to) => {
      const kids = [
        el('div', { class: 'lv num' }, value),
        el('div', { class: 'll' }, label),
        meta ? el('div', { class: 'lm' }, meta) : ''];
      return to
        ? el('div', { class: `health-fig ${cls} is-link` },
          el('button', { type: 'button', class: 'health-fig-btn', onclick: () => ctx.switchView(to) }, ...kids))
        : el('div', { class: `health-fig ${cls}` }, ...kids);
    };
    /* sharePercentLabel, not a bare Math.round — ISSUE 37. The debt tile's own
       meta line prints the rand figure this share is OF ("R 148 a month"), so a
       share that rounds to "0%" puts two opposite claims on one tile. The same
       helper the budget tiles below already use for the 100% boundary. */
    const pct = r => `${sharePercentLabel(r, locale().decimal)}%`;

    /* Emergency cover. The meter fills toward the target and re-tones at the
       halfway mark — under half a fund is a different fact from nearly-there,
       and colour is how this dashboard says so elsewhere (hero, cat-bars). */
    /* The unit rides WITH the figure rather than only in the label below it.
       "3.9" alone is the one tile whose number means nothing on sight — the
       other three are a percentage or a score, which read as themselves — so a
       reader meeting the card for the first time had to look down a line to
       learn what 3.9 counted. Set smaller and lighter, the way the hero already
       carries its currency symbol. */
    /* Audit finding #4: with debt and score both routing and emergency/saving
       not, a grid of four tiles read as two buttons and two dead ends —
       inconsistent enough to look broken rather than intentional. Emergency
       cover is set and tracked on the Accounts page (`emergency_fund:` on an
       account's frontmatter, health-math.js's own comment on resolveEarmarks);
       the saving rate is read off contributions into savings/investment
       accounts, which is also where a household actually goes to act on it —
       see score.js's own GAP_DESTS, which sends its `saving` gap to the same
       page for the same reason. */
    const emergency = H.months !== null
      ? fig(H.months >= target ? 'is-good' : H.months >= target / 2 ? 'is-fair' : 'is-poor',
        /* A REAL space, not only the margin below it: the tile's accessible
           name is its text content, and "3.9months" is what a screen reader
           would have said.

           The separator between the whole and fractional digit comes from
           the country profile (locale().decimal), not from toFixed()'s own
           output — toFixed(1) always writes a literal '.', which is correct
           for en-US but wrong for the default za profile (","), and every
           OTHER number on this card is money, run through money() which
           already makes this same substitution. Left as toFixed()'s raw
           string, this was the one figure on the card reading "3.9" beside
           "R 1 234,50" and "13%". */
        [H.months.toFixed(1).replace('.', locale().decimal), ' ', el('small', {}, i18n.t('dash.health.monthsUnit'))],
        i18n.t('dash.health.months'),
        i18n.t('dash.health.monthsMeta', { count: target, amount: money(earmarks.total, 0) }), 'accounts')
      /* `months` (health-math.js) goes null in two different situations that
         `needHistory` used to say the same thing about: no counted trailing
         period at all (H.countedPeriods === 0 — genuinely no income history
         yet, needHistory is right), OR six real periods counted with essential
         spend of EXACTLY ZERO in every one of them (H.monthlyEssential === 0 —
         every category this household spent from is typed something other than
         essential). The second case is not a history problem; more months would
         not fix it. Distinguished on H.countedPeriods rather than re-deriving
         "was every period essential-free" here, because health-math.js already
         computed and named that condition once (avg.essential === 0). */
      : fig('', '—', i18n.t('dash.health.months'),
        !earmarks.any ? i18n.t('dash.health.setup')
          : H.countedPeriods > 0 && H.monthlyEssential === 0 ? i18n.t('dash.health.noEssential')
            : i18n.t('dash.health.needHistory'), 'accounts');
    if (H.months !== null) {
      const fill = Math.min(100, (H.months / target) * 100);
      /* The same bar component the budget table fills, and the same three
         tones: emerald at the target, amber past halfway, red below it. */
      const tone = H.months >= target ? '' : H.months >= target / 2 ? ' bg-warning' : ' bg-danger';
      /* What the bar is a picture OF: the money set aside against the money the
         goal actually asks for. The tile above says the goal in months, which
         is the unit to plan in, but not what it costs — and the bar's own
         fullness is the one place that figure belongs.

         A native `title` rather than a styled tooltip, per the rule in
         views/savings.js: it works under a touch-and-hold on a phone and is
         read by a screen reader, which a CSS-only tooltip is not. So the bar
         stops being decorative — it now carries the only copy of this figure,
         and `aria-hidden` would hide exactly that. role="img" plus the same
         text as its label is what createChart already does for a chart. */
      const goalAmount = target * H.monthlyEssential;
      const meterTip = i18n.t('dash.health.meterTip', {
        count: target,
        earmarked: money(earmarks.total, 0),
        goal: money(goalAmount, 0),
      });
      emergency.append(el('div', {
        class: 'cat-bar health-meter', role: 'img', title: meterTip, 'aria-label': meterTip,
      }, el('i', { class: `cat-bar-fill${tone}`, style: `width:${fill.toFixed(1)}%` })));
    }
    /* The over-claim, argued rather than corrected: the figure above already
       capped at what the account holds, so the claim itself must stay visible
       or the reader has no way to know their instruction was not followed. */
    if (earmarks.over.length) {
      emergency.append(el('div', { class: 'lm text-danger' },
        i18n.t('dash.health.over', { name: earmarks.over[0].name })));
    }

    /* A window where more came out of savings than went in is a real thing to
       report, but not as a negative SHARE — "-19% of income saved" cannot be
       true of anybody. The tile shows 0% (nothing was saved, which is the
       honest reading) and the sub-line says which way the money actually went.
       Same rule as the Score page's own saving line; see its comment. */
    const drawingDown = H.savingsRate !== null && H.monthlySavings < 0;
    const savingsTile = H.savingsRate !== null
      ? fig(drawingDown ? 'is-poor'
        : H.savingsRate >= 0.2 ? 'is-good' : H.savingsRate >= 0.1 ? 'is-fair' : 'is-poor',
      pct(drawingDown ? 0 : H.savingsRate),
      i18n.t('dash.health.savings'),
      drawingDown
        ? i18n.t('dash.health.savingDown', { amount: money(Math.abs(H.monthlySavings), 0) })
        : i18n.t('dash.health.perMonth', { amount: money(H.monthlySavings, 0) }), 'savings')
      : fig('', '—', i18n.t('dash.health.savings'), i18n.t('dash.health.needHistory'), 'savings');

    /* Zero interest with an income to measure against is a fact worth its own
       word — "debt-free" reads as an achievement where "0%" reads as a rounding
       error. The share being null (no income history) still shows the monthly
       cost when there is one: the rand figure is real even when the ratio
       cannot be. */
    /* "Debt-free" is a claim about the household; "none recorded" is a claim
       about the vault. Saying the first when only the second is known is the
       one place this tile could mislead, and it costs a word to be right. */
    /* A THIRD state sits between those two: debts are recorded but not one of
       them states a rate, so what they cost is unknown rather than nothing.
       Without this branch a null interest fell straight through to "debt-free"
       and the tile congratulated a household carrying R250 000. */
    const debtMeta = debtInterest > 0 ? i18n.t('dash.health.perMonth', { amount: money(debtInterest, 0) })
      : debtInterest === null ? i18n.t('dash.health.debtNoRate')
        : snap.debtsRecorded ? i18n.t('dash.health.debtFree')
          : i18n.t('dash.health.debtNone');
    const debtTile = H.interestShare !== null
      ? fig(H.interestShare <= 0 ? 'is-good' : H.interestShare < 0.05 ? 'is-fair' : 'is-poor',
        pct(H.interestShare),
        i18n.t('dash.health.debt'),
        debtMeta, 'debts') : fig('', '—', i18n.t('dash.health.debt'), debtMeta, 'debts');

    /* One band lookup for the colour AND the word — health-math owns the
       thresholds now, so the tile and the popup explaining it cannot disagree
       about whether 79 is steady. */
    const BAND_TONE = { strong: 'is-good', steady: 'is-fair', attention: 'is-poor' };
    const band = H.score ? scoreBand(H.score.value) : null;
    /* Routes to the Score page rather than opening the explainer popup it
       used to carry. That popup held a heading, three scored rows and an
       instruction — the whole of which the Score page now says better, in the
       ring's own legend, since the standalone "How the score is built" card
       was folded into it. Two surfaces explaining one number is how they come
       to disagree about it; the tile states the figure and hands off. */
    const scoreTile = H.score
      ? fig(`${BAND_TONE[band]} is-score`, String(H.score.value),
        i18n.t('dash.health.score'), i18n.t(`dash.health.${band}`), 'score')
      : fig('is-score', '—', i18n.t('dash.health.score'), i18n.t('dash.health.needHistory'), 'score');

    /* The conclusion leads, then the three figures it is drawn from. */
    body.append(el('div', { class: 'health-grid' }, scoreTile, emergency, savingsTile, debtTile));
  }


  /* ROWS THIS PAGE COULD NOT PLACE, said out loud wherever an implied balance
     is printed.

     reconcile() (src/reconcile.js) counts every row whose date names no day —
     `2026-13-05` is the ordinary day/month-swap typo, `2026-02-30` a
     month-length slip, "end of June" what a person types into a column
     nothing validated — and reports the count as `unreadable` on every
     row-walking verdict. It cannot PLACE those rows: putting them in `since`
     would fold money of unknown date into an offer the reader can accept in
     one tap, and putting them in `ahead` is the bug that made this class of
     row invisible in the first place. So they are counted and handed back.

     Counted is not disclosed. Both implied-balance surfaces on this page —
     the "what's left" cash chain and the position tile's drift note — were
     still printing figures those rows are absent from, with nothing beside
     either saying so. currency.js:14 forbids the identical omission for a
     foreign account, and CLAUDE.md states the general rule: the app argues,
     it never silently corrects. src/acct-status.js already enforces the
     refusal on the Accounts page; this is the same refusal on the page a
     reader actually lands on.

     THE SENTENCE ITSELF IS NOT MINE TO WRITE, AND THIS IS THE SEAM.
     `acct.deck.why.unreadable` is the Accounts page's own wording for this
     state, written for its decision deck and carried in all twelve tables in
     src/lang/. It is BORROWED rather than reworded here, and the choice
     between it and the drawer's `acct.drawer.recon.unreadable` came down to
     the count: this caveat's whole job is to say HOW MANY rows a figure is
     missing, and the drawer's sentence ("this figure cannot be checked
     against your transactions yet") deliberately does not carry one, because
     the drawer is already showing the reader the account those rows are in.
     The Dashboard is not. Two sentences for one state would also be the
     shape this repo keeps tripping on, one register up from the arithmetic.

     IT PRINTS NOTHING RATHER THAN A RAW KEY when no table carries the
     sentence. That is not hypothetical caution: a translation lookup returns
     the KEY ITSELF for a miss — deliberately, so a gap is greppable in a bug
     report rather than blank — and a key present in one language renders its
     own dotted name on screen in the other eleven, which is what
     tests/i18n-render.test.cjs's first assertion exists to stop. A missing
     caveat is a known gap; a visible `acct.deck.why.unreadable` in the middle
     of a card is a defect in every language including English. Both branches
     are driven in tests/dash-unreadable-dates-disclosed.test.cjs, which also
     asserts the English table actually carries the key today — so a rename in
     the Accounts lane turns up as a red suite rather than as a caveat that
     quietly stopped appearing.

     The key is held in a const rather than written inline because
     tests/i18n.test.cjs's invariant 6 scans src/ for a translation call whose
     first argument is a string LITERAL and requires every key it finds to
     exist in lang/en.js. That check is right for a call site that must have
     its key; here the whole contract is that the call site survives the key
     being absent, so it is the test above that owns the guarantee instead.
     The scan is a regex over the file's raw TEXT, incidentally, so writing
     the literal pattern out even inside this comment tripped it once already.
     Params: { count }, plural entry (one/other).

     Published on ctx so the Report can reach the same sentence if it ever
     starts printing an implied balance — today it prints only STATED
     balances (views/report.js builds its Net Worth section from worth(),
     which reads `a.balance` and never calls reconcile()), so there is nothing
     to qualify there. */
  const UNREADABLE_KEY = 'acct.deck.why.unreadable';
  function unreadableNote(count) {
    if (!count) return '';
    const s = i18n.t(UNREADABLE_KEY, { count });
    return s === UNREADABLE_KEY ? '' : s;
  }

  /* --------------------------- what's left ------------------------------
     The hero above says how much BUDGET is left. This says how much MONEY is —
     what the accounts hold, less the charges already scheduled against them
     before the period ends. See src/committed.js for the six rules that decide
     whether the middle figure can be trusted; this function only renders them.

     The card hides itself when there is nothing honest to show. A vault with no
     confirmed balance and no recurring charges would otherwise get three zeroes
     and a per-day rate of nothing, which reads as a broken card rather than an
     empty one.

     THE RUNNING PERIOD ONLY. Every input here except the window is present
     tense: cash is what the accounts hold NOW, staleness is measured against
     today, and committed.js starts its window at today rather than at the
     period start. Point that at another period and both directions lie, each
     in its own way.

     BACKWARDS the card goes inert. `from` (today) sits after `to` (that period's
     end), so `due < from` drops every service and debt and the middle figure
     falls to zero — while cash, which never consulted the period at all, keeps
     reporting today's balance. Every past month therefore showed the same cash,
     nothing committed, and all of it free. That is not a picture of how that
     month went; it is today's picture wearing that month's date.

     FORWARDS is worse, because it looks right. `from` becomes the period start,
     so next month's debit orders ARE found and subtracted — from TODAY's cash,
     with the rest of THIS period's claims never counted. The number comes out
     bigger than the truth on a card whose whole job is to say what is safe to
     spend. `days` compounds it, spanning from today to the far period's end, so
     the per-day rate is diluted across two periods at once.

     So: one period, the one we are standing in. The card stays on screen and
     says why rather than vanishing — a card that disappears as you page through
     months reads as the bug, and takes the layout with it on the way out. */
  function renderLeft() {
    const card = $('#leftCard');
    const body = $('#leftBody'); body.empty();
    const { start, end } = periodRange(S.period);

    if (card) card.classList.remove('hidden');
    if (S.period !== currentPeriod()) {
      const sub = $('#leftSub');
      if (sub) sub.textContent = i18n.t('dash.left.nowSub');
      body.append(el('p', { class: 'text-muted', style: 'margin:0' },
        i18n.t('dash.left.notNow', { period: periodMonthName(currentPeriod()) })));
      return;
    }

    /* Implied balances, not stated ones — reconcile() is what turns a claim
       with an age into what the account should read right now. `dated` is what
       separates "this account holds nothing" from "nobody has said". */
    const idx = accountIndex();
    /* Rows reconcile() could not place, tallied PER CURRENCY GROUP, because
       that is how the figures below are printed: the household chain states
       one cash figure and each foreign band states its own, so a rupiah row
       nobody can date does not qualify the rand number.

       The budget test is the only filter needed. An account the reader has
       opted out contributes to no figure on this card, so a caveat drawn from
       it would qualify a total it cannot have affected — the same mistake the
       cash-currency sentence below was corrected for. The other two states
       that reach no figure need no test at all: `unreadable` is only ever set
       by the verdicts that actually WALKED the rows, so 'no-date' and 'no-tx'
       carry no count to add (undefined, which is falsy) and an undated
       account is disclosed by its own `dash.left.undated` fragment instead.

       See unreadableNote() above for why the sentence may still come out
       empty even when this count is not. */
    const unplacedBy = new Map();
    /* ISSUE 45. The same shape, one row along: activity dated ON an account's
       own confirmation day, which reconcile() treats as already inside the
       stated balance (correctly — see its own note) and which nothing on this
       card admitted to.

       Measured on the `BudgetAudit` household on 2026-09-02: three cheque rows
       dated 2026-09-01, the day every balance was confirmed, netting +R29 500
       with a R35 000 salary among them. "Money you have right now" read
       R41 800 with payday nowhere in it, and the reader had no way to tell
       whether the app had missed the salary or the balance had already
       absorbed it. Those are opposite conclusions and only one of them is a
       reason to act.

       Same per-currency keying and same in-budget test as `unplacedBy`, for
       the identical reason: an account the reader opted out of contributes to
       no figure here, so a caveat drawn from it would qualify a total it
       cannot have affected. */
    const confirmDayBy = new Map();
    const accounts = S.accounts.map(a => {
      const rows = (idx.get(a) || {}).rows || [];
      const rec = reconcile(a, rows);
      if (rec.unreadable && a.in_budget !== false) {
        const sym = symbolOf(a, S.settings.currency);
        unplacedBy.set(sym, (unplacedBy.get(sym) || 0) + rec.unreadable);
      }
      if (rec.sameDay && rec.sameDay.count && a.in_budget !== false) {
        const sym = symbolOf(a, S.settings.currency);
        const at = confirmDayBy.get(sym) || { count: 0, net: 0 };
        confirmDayBy.set(sym, { count: at.count + rec.sameDay.count, net: at.net + rec.sameDay.net });
      }
      return {
        name: a.name,
        inBudget: a.in_budget !== false,
        dated: rec.state !== 'no-date',
        implied: rec.state === 'drift' ? rec.implied : a.balance,
        /* Rule 7 and the owed line are decided inside committed.js, not here —
           this only hands over what they need to decide with. */
        type: a.type,
        settleMonthly: !!a.settle_monthly,
        /* ISSUE 48. The household's own two declarations that this money is
           spoken for — the earmark flag and the account's type. Passed as data
           the way `type` and `settleDay` already are, so committed.js decides
           what they mean and this view only hands over what it reads off the
           file. `emergency_fund` is `true` or a NUMBER; both survive the
           handover unconverted because both mean different things. */
        emergencyFund: a.emergency_fund,
        /* Whether the household ANSWERED the budget question — committed.js
           needs it to honour `budget: true` the way period.js already does. */
        budgetStated: !!a.in_budget_stated,
        settleDay: a.settle_day || 0,
        institution: a.institution || '',
        /* ISSUE 30. One field, added at the one place this list is built.
           Everything downstream — cashOnHand, cardsOwed, cardCommitments,
           settlesMonthly — is currency-agnostic arithmetic that is correct
           the moment its input is homogeneous, so the fix is to give the list
           the dimension it should always have had and then group on it,
           rather than to teach committed.js a new rule. */
        currency: symbolOf(a, S.settings.currency),
      };
    });

    /* ISSUE 30, second pass. These three transaction lists carry the SAME
       dimension the accounts are grouped on below, and they were the half of
       the partition that got missed: ONE `rows`, one `incomeRows` and one
       `cardRows` were built across every folder in the vault and handed
       unchanged to BOTH whatsLeft calls.

       Measured on a two-currency vault: a rand settle-card spending R1 000 and
       a euro settle-card spending €500 printed "R 1 500 on the card this
       cycle" — a euro added to a rand inside the one figure that answers "did
       this cycle pay for itself". The euro band below the chain then read
       "still committed € 1 000 · actually free € 5 000" out of € 6 000 of
       cash: its own three terms did not balance, because the RAND salary in
       the shared incomeRows formed a settlement cycle for the euro group, and
       a group inside a cycle drops cardDue from `free` while the band still
       prints it as committed. In the other direction a €2 000 recurring credit
       into a euro account was announced on the household chain as "R 2 000
       lands on 2026-08-20".

       committed.js needs no change for any of it. Everything downstream is
       currency-agnostic arithmetic that is correct the moment its input is
       homogeneous — which is precisely the argument the accounts half of this
       partition already makes, applied to the other half.

       A folder no account claims keeps the household symbol (symbolOf falls
       back to it), the same reading period.js's foreignLabels() takes: an
       orphan folder's rows are household money until an account says
       otherwise, and inventing a currency for them would be a guess. */
    const home = S.settings.currency;
    const txByCurrency = new Map();
    const txGroup = sym => {
      if (!txByCurrency.has(sym)) txByCurrency.set(sym, { rows: [], incomeRows: [], cardRows: [] });
      return txByCurrency.get(sym);
    };
    /* Frozen and shared, for a symbol with no transaction folders of its own —
       a euro subscription in a vault with no euro account is exactly that, and
       it must reach whatsLeft with three EMPTY lists rather than borrowing the
       household's. */
    const NO_TX = Object.freeze({ rows: [], incomeRows: [], cardRows: [] });
    const txOf = sym => txByCurrency.get(sym) || NO_TX;
    /* A second list, in-budget accounts only, for the repeating-credit search.
       A fund's monthly debit order is a CREDIT on that fund's own statement, and
       predicting it as household income would announce money arriving when it is
       only moving between the reader's own pockets. */
    const skipLabels = nonBudgetLabels();
    /* And a third, for the settle-monthly cards only: their spending this cycle
       is what gets measured against the income that clears it. Each folder is
       resolved to its account through accountForLabel — the SAME three-way
       rule (tx_label, name, safeSeg(name)) accountIndex and reconcile use.
       A raw `tx_label || name` comparison here missed any card whose name
       carries a filesystem-illegal character ("Visa/Gold" → folder
       "Visa-Gold"): its rows were counted by every other consumer but never
       joined cardRows, so cardSpend read 0, no cycle formed, and `free`
       subtracted the full card balance — the same card, two different free
       figures, depending on whether its name survives safeSeg. The card test
       itself is isSettleCard, the one definition committed.js exports. */
    const cardAccounts = new Set(S.accounts.filter(isSettleCard));
    for (const f of Object.values(S.txFiles)) {
      const owner = accountForLabel(f.label);
      const isCardFolder = owner ? cardAccounts.has(owner) : false;
      const g = txGroup(symbolOf(owner, home));
      for (const r of f.rows) {
        g.rows.push(r);
        if (!skipLabels.has(f.label)) g.incomeRows.push(r);
        if (isCardFolder) g.cardRows.push(r);
      }
    }

    /* ISSUE 30 — one card per currency, computed by the same code.

       "What's left" was the worst figure on the page: cash, committed, card
       due and free were four terms of one equation, all four summed across
       currencies, and only the FIRST carried a disclosure. Measured on a
       two-currency vault it read "R 5 017 000 − R 0 − R 4 500 000 =
       R 517 000 actually free · R 24 619 a day" where the truth was R 17 000
       free and R 809 a day — over by a factor of thirty, on the one number
       that answers "how much is safe to spend".

       Both obvious repairs are defects. Summing gives the figure above.
       FILTERING foreign accounts out before cashOnHand() looks right and is
       worse: the same shaped list feeds cardsOwed(), cardCommitments() and
       settlesMonthly, so a foreign credit card would vanish from all four at
       once — and `owedElse`, the disclosure written to catch exactly that
       state, is derived by subtracting claimed items from the same filtered
       list, so both sides go to zero together and it cannot fire.
       committed.js:390-398 names that as "the exact silent state this
       disclosure exists to end", and currency.js:14 forbids it outright.

       So: partition, and run the UNCHANGED whatsLeft once per currency.
       Services and debts belong to the household group — Services.md and
       Debts.md carry no currency column, so their amounts are in the
       household's currency by construction. Foreign groups get their own
       accounts and no service/debt commitments, which is exactly right: a
       euro card's settlement is a euro obligation, and a rand debit order is
       not. Each renders as its own compact band beneath the headline chain,
       in its own symbol, never converted and never summed across. */
    const homeish = list => (list || []).filter(x => !isForeign(x, home));
    const fxOf = (list, sym) => (list || []).filter(x => symbolOf(x, home) === sym);
    const byCurrency = new Map();
    for (const a of accounts) {
      const key = a.currency || home;
      if (!byCurrency.has(key)) byCurrency.set(key, []);
      byCurrency.get(key).push(a);
    }
    /* The set of currencies in play is the UNION of what the accounts, the
       services and the debts state — not just the accounts. A euro
       subscription in a vault with no euro account still has to land
       somewhere, and keying the groups off accounts alone would have dropped
       it out of every figure and every sentence, which is the silent
       exclusion this whole partition exists to avoid. */
    const foreignSyms = [...new Set([
      ...[...byCurrency.keys()],
      ...S.services.map(x => symbolOf(x, home)),
      ...S.debts.filter(d => d.status !== 'paid').map(x => symbolOf(x, home)),
    ])].filter(sym => sym && sym !== home);

    const foreignGroups = foreignSyms
      .map(sym => ({
        sym,
        L: whatsLeft({
          accounts: byCurrency.get(sym) || [],
          services: fxOf(S.services, sym),
          debts: fxOf(S.debts.filter(d => d.status !== 'paid'), sym),
          ...txOf(sym),
          periodStart: start, periodEnd: end, today: todayIso(),
        }),
      }))
      .filter(g => g.L.cashKnown || g.L.items.length || g.L.owed);

    /* ISSUE 30. Services.md and Debts.md can state a currency now, so
       "they carry no currency column and are therefore household money" no
       longer holds unconditionally — it holds for the ones that say nothing,
       which is still nearly all of them. A euro subscription belongs to the
       euro band, not the household chain that subtracts it from rand cash. */
    const L = whatsLeft({
      accounts: byCurrency.get(home) || [],
      services: homeish(S.services), debts: homeish(S.debts),
      ...txOf(home),
      periodStart: start, periodEnd: end, today: todayIso(),
    });

    /* Nothing to say: no confirmed cash AND nothing scheduled. classList, not
       Obsidian's addClass/removeClass — those are host extensions to
       HTMLElement, and every other card here toggles the plain way. */
    const nothing = !L.cashKnown && !L.items.length && !L.owed && !foreignGroups.length;
    if (card) card.classList.toggle('hidden', nothing);
    if (nothing) return;

    const sub = $('#leftSub');
    if (sub) sub.textContent = i18n.t('dash.left.sub', { date: dayLabel(end) });

    const fig = (cls, value, label, meta) => el('div', { class: `left-fig ${cls}` },
      el('div', { class: 'lv num' }, value),
      el('div', { class: 'll' }, label),
      meta ? el('div', { class: 'lm' }, meta) : '');

    /* Four independent facts about the cash figure, each only shown when it
       has something to say: how many accounts it counted, how many of those
       carry a balance nobody has confirmed lately, how many could not be
       counted at all because their balance has no date to measure from, and
       how many transaction rows the implied balances behind it could not
       place because their own dates name no day. */
    const staleCount = S.accounts.filter(a => a.in_budget !== false && isStale(a.balance_updated)).length;
    const cashParts = [];
    /* whatsLeft's own count, not a second one computed here. The old local
       recount said "in budget AND dated" while the figure above it summed only
       what was positive, so the two disagreed on exactly the account that
       contributed nothing — which is the class of drift the reconcile() sharing
       further down this file exists to stop. */
    cashParts.push(i18n.t('dash.left.counted', { count: L.countedAccounts }));
    if (staleCount) cashParts.push(i18n.t('dash.left.unconfirmed', { count: staleCount }));
    if (L.unknownAccounts.length) cashParts.push(i18n.t('dash.left.undated', { count: L.unknownAccounts.length }));
    /* The rows behind the figure, not the accounts in front of it. Every term
       of this chain is built out of IMPLIED balances (see the reconcile() call
       above), and an implied balance is the stated one plus everything dated
       after it — so a row nothing can date is money the figure does not
       contain. Home group only, matching the arithmetic `L` was handed.
       Silent when the sentence has no translation yet; see unreadableNote(). */
    const cashUnplaced = unreadableNote(unplacedBy.get(home) || 0);
    if (cashUnplaced) cashParts.push(cashUnplaced);
    /* ISSUE 45. Home group only, matching the arithmetic `L` was handed —
       each foreign band carries its own below. `count` is passed as well as
       `amount` because i18n.t() selects the plural form off `count` alone. */
    const cashConfirmDay = confirmDayBy.get(home);
    if (cashConfirmDay && cashConfirmDay.count) {
      cashParts.push(i18n.t('dash.left.confirmDay', {
        count: cashConfirmDay.count, amount: money(cashConfirmDay.net, 0),
      }));
    }
    /* NO "adds more than one currency" caveat on this figure, deliberately.

       One was printed here until 2026-09-02. It was written when cashOnHand()
       added every in-budget balance whatever its own `currency:`, and it was
       the right disclosure for that arithmetic. The ISSUE 30 partition above
       ended that arithmetic — `L` is byCurrency.get(home) alone, keyed on
       symbolOf(), so the printed cash figure is household money and nothing
       else — and the sentence went on firing off S.accounts, telling a reader
       that a total which had just stopped mixing currencies still did. A
       caveat that describes arithmetic the card no longer performs is worse
       than none: the reader who acts on it (opts the euro account out with
       `budget: false`) changes nothing, because it was never in the figure.

       The first fix re-measured currenciesIn() over the home group as a
       "tripwire for the partition" — but that group is BUILT from symbolOf(),
       so measuring it can only ever find one symbol; a tripwire that cannot
       trip is a comment pretending to be code. The foreign groups have their
       own bands below, and the accounts that partition cannot place at all
       are named in `cashUnplaced` above. Nothing here is silent. */

    const comParts = [];
    if (L.counts.service) comParts.push(i18n.t('dash.left.orders', { count: L.counts.service }));
    if (L.counts.debt) comParts.push(i18n.t('dash.left.instalments', { count: L.counts.debt }));

    const freeParts = [];
    if (L.days !== null) freeParts.push(i18n.t('dash.left.days', { count: L.days }));
    if (L.perDay) freeParts.push(i18n.t('dash.left.perDay', { amount: money(L.perDay, 0) }));

    /* FOUR terms only where the card really is a claim on this cash.

       A card SETTLED MONTHLY is not. Its balance is this cycle's spending
       waiting for the salary that clears it, and that salary lands on day one of
       the NEXT period — so subtracting it from the cheque account's leftover
       cash produced "R16 958 short" at the same point in every cycle, a warning
       that fires monthly and is therefore read by nobody. That card moves out of
       this chain entirely and into its own band below, measured against the
       income that actually settles it.

       A card NOT settled monthly stays here: a revolving balance genuinely is a
       claim, and `cycle` is null for it. So the fourth term appears exactly when
       the subtraction is true. */
    const showCardTerm = L.cardDue > 0 && !L.cycle;
    /* The strip prints a literal equation with a rendered '−' and '=' between
       the terms, so it has to actually BALANCE at whatever precision it is
       printed at. Each of the four money(…, 0) calls used to round its own
       term independently — cash, committed and card do not generally round
       to whole rand in a way that keeps summing once each is truncated on
       its own, so "R 12 000 − R 1 501 = R 10 500" printed beside terms whose
       displayed values actually summed to R 10 499. Rounded ONCE here and
       the result term DERIVED from the same rounded integers — committed.js's
       own identity (cash − committedOther − cardDue = free outside a cycle,
       cash − committedOther = free inside one; see the comment on
       `committedOther` there) — so the printed equation is exact by
       construction rather than four independent roundings that usually, but
       not always, happen to agree. */
    const dCash = L.cashKnown ? Math.round(L.cash) : null;
    const dCommitted = Math.round(L.committedOther);
    const dCard = showCardTerm ? Math.round(L.cardDue) : 0;
    /* ISSUE 48. A TERM in the strip, not a subtraction hidden inside `free`.

       This chain is the one place on the page whose arithmetic has to survive
       being re-added by eye — that is why dFree is rebuilt from the ROUNDED
       terms rather than taken from L.free. An earmark deducted silently would
       have broken that in the same edit that fixed the figure: the reader
       would have seen R41 800 − R500 = R18 300 and been right to distrust the
       card. Shown only when there IS one, so a household with no declared
       funds sees the same three-term strip it always did. */
    const showEarmark = (L.earmarked || 0) >= 1;
    const dEarmarked = showEarmark ? Math.round(L.earmarked) : 0;
    const dFree = dCash === null ? null : dCash - dEarmarked - dCommitted - dCard;
    const op = () => el('div', { class: 'left-op', 'aria-hidden': 'true' }, '−');
    /* ISSUE 48. The strip can now hold three, four or five terms — cash, an
       optional earmark, committed, an optional card settlement, free — so the
       column count is derived rather than named after whichever optional term
       happened to exist first. `left-grid--card` is kept alongside it: it is
       still true (there IS a card term) and something may yet key off it, but
       the WIDTH now comes from the count. */
    const terms = 3 + (showEarmark ? 1 : 0) + (showCardTerm ? 1 : 0);
    const grid = el('div', {
      class: `left-grid left-grid--n${terms}${showCardTerm ? ' left-grid--card' : ''}`,
    },
      fig('is-cash', dCash !== null ? money(dCash, 0) : '—',
        i18n.t('dash.left.cash'), cashParts.join(' · ')));
    if (showEarmark) {
      /* Named down to the accounts in the sub-line: "R23 000 is spoken for"
         with no way to see where invites the reader to assume it is wrong,
         and the whole point of this term is that they should be able to
         disagree with it. */
      grid.append(op(), fig('is-earmarked', money(dEarmarked, 0),
        i18n.t('dash.left.earmarked'),
        (L.earmarkedFrom || []).length <= 2
          ? (L.earmarkedFrom || []).map(e => e.name).join(' · ')
          : i18n.t('dash.left.earmarkedFrom', { count: L.earmarkedFrom.length })));
    }
    grid.append(op(),
      fig('is-committed', money(dCommitted, 0),
        i18n.t('dash.left.committed'), comParts.join(' · ') || i18n.t('dash.left.none')));
    if (showCardTerm) {
      grid.append(op(), fig('is-card', money(dCard, 0),
        i18n.t('dash.left.cardDue'),
        L.counts.card === 1 ? L.owedCards[0] || '' : i18n.t('dash.left.cards', { count: L.counts.card })));
    }
    /* With the settled card out of the chain, `free` comes out of it too —
       committed.js already accounts for that (see the settlement-cycle
       comment there). L.short still decides the WORD and the colour: it is
       committed.js's own cent-precise verdict, immune to the float quirk its
       own comment documents (freeCents) — a rand-rounded dFree of exactly 0
       cannot be trusted to say which side of zero a near-exact break-even
       actually sits on. Only the printed NUMBER now comes from dFree, so the
       equation above it holds; the per-day rate and the bar below still read
       L.free, for the same reason they always have — this strip is the one
       place the printed arithmetic has to survive being re-added by eye. */
    grid.append(el('div', { class: 'left-op', 'aria-hidden': 'true' }, '='),
      /* "Short", never a negative amount of free money — a minus sign in front
         of a figure labelled "actually free" is a sentence that means nothing. */
      fig(L.short ? 'is-short' : 'is-free', money(Math.abs(dFree ?? L.free), 0),
        i18n.t(L.short ? 'dash.left.short' : 'dash.left.free'), freeParts.join(' · ')));
    body.append(grid);

    /* One compact band per other currency, under the headline chain. Its own
       cash, its own commitments, its own free figure — the same three terms,
       computed by the same function, printed in that currency's own symbol.
       Never converted, never added to the figures above, and never dropped:
       a reader holding a euro card can see what it owes without this card
       pretending a euro is a rand. */
    for (const g of foreignGroups) {
      const gm = (v) => (typeof ctx.moneyIn === 'function' ? ctx.moneyIn(g.sym, v, 0) : `${g.sym} ${Math.round(v)}`);
      const parts = [
        g.L.cashKnown ? i18n.t('dash.left.cash') + ' ' + gm(g.L.cash) : null,
        g.L.committedOther || g.L.cardDue
          ? i18n.t('dash.left.committed') + ' ' + gm(g.L.committedOther + g.L.cardDue) : null,
        g.L.cashKnown
          ? i18n.t(g.L.short ? 'dash.left.short' : 'dash.left.free') + ' ' + gm(Math.abs(g.L.free)) : null,
        /* This band's own cash is an implied balance too, so the same caveat
           belongs to it — and its OWN count, not the household's. A euro row
           nobody can date qualifies the euro figure and nothing else, which is
           the whole reason unplacedBy is keyed by symbol. */
        unreadableNote(unplacedBy.get(g.sym) || 0) || null,
        /* ISSUE 45, per foreign band — same reason the line above is keyed by
           symbol: this band states its own cash figure, so it must state its
           own confirmation-day caveat rather than borrow the household's. */
        (confirmDayBy.get(g.sym) && confirmDayBy.get(g.sym).count)
          ? i18n.t('dash.left.confirmDay', {
            count: confirmDayBy.get(g.sym).count,
            amount: ctx.moneyIn(g.sym, confirmDayBy.get(g.sym).net, 0),
          }) : null,
      ].filter(Boolean);
      body.append(el('div', { class: 'left-fx' },
        el('span', { class: 'left-fx-sym' }, g.sym),
        el('span', { class: 'left-fx-txt' }, parts.join(' · '))));
    }

    /* The settlement cycle: what went on the card this period against the income
       that clears it. This is the figure that carries a verdict — under 100% the
       pattern is working, over it the cycle genuinely did not pay for itself,
       which is the one case worth colouring red. */
    if (L.cycle) {
      const c = L.cycle;
      const pct = Math.round(c.ratio * 100);
      body.append(el('div', { class: `left-cycle${c.over ? ' is-over' : ''}` },
        el('div', { class: 'lc-head' },
          el('span', { class: 'lc-t' }, i18n.t('dash.left.cycle', {
            spend: money(c.spend, 0), settling: money(c.settling, 0),
          })),
          el('span', { class: 'lc-p num' }, `${pct}%`)),
        el('div', { class: 'lc-bar', role: 'img',
          'aria-label': i18n.t('dash.left.cycleAria', {
            spend: money(c.spend), settling: money(c.settling), pct,
          }) },
        el('i', { style: `width:${Math.min(100, pct).toFixed(1)}%` })),
        el('div', { class: 'lc-s' }, i18n.t(
          c.over ? 'dash.left.cycleOver' : 'dash.left.cycleUnder',
          { amount: money(Math.abs(c.headroom), 0), date: c.date }))));
    }

    /* What is coming IN, when the rows can prove it — and nothing at all when
       they cannot. Without this the card reads as a crisis at the same point in
       every cycle, and a warning that fires every month is one nobody reads.
       With it, the card answers the question actually being asked: not "am I
       short" but "am I short until payday". */
    if (L.incoming) {
      /* Read, never recomputed: inside a settlement cycle this credit is
         already spoken for by the card band, and adding it to `free` here
         counted it twice. whatsLeft owns that netting — see afterIncoming. */
      const after = L.afterIncoming;
      body.append(el('div', { class: 'left-incoming' },
        icoEl(['arrow-down-circle', 'circle-arrow-down', 'arrow-down']),
        el('div', {},
          el('div', { class: 'li-t' }, i18n.t('dash.left.incoming', {
            amount: money(L.incoming.amount, 0), date: L.incoming.next,
          })),
          el('div', { class: 'li-s' }, i18n.t(
            after >= 0 ? 'dash.left.incomingCovers' : 'dash.left.incomingShort',
            { amount: money(Math.abs(after), 0), count: L.incoming.count },
          )))));
    }

    /* The bar only means something when there is cash to divide.

       It must divide the cash the SAME WAY the chain above it did, or it
       contradicts the figures it sits under. Under a settlement cycle the card
       moves out of the chain and `free` is cash − committedOther (see the
       settlement-cycle comment in committed.js), so a bar built on `committed`
       — which still carries cardDue — drew a committed segment larger than the
       one the reader had just been shown and a free segment visibly smaller
       than the "actually free" figure directly above it. The aria-label was
       worse than the bar: it announced a cash, a committed and a free that no
       longer summed, so a screen-reader user got three numbers and no way to
       reconcile them.

       So the bar is derived FROM `free` rather than from a second guess at
       which terms went into it: whatever the chain subtracted is exactly
       cash − free, under a cycle and outside one alike. Written as the
       subtraction rather than as `L.cycle ? L.committedOther : L.committed`
       so that a future change to what `free` excludes cannot pull the bar out
       of step with it a second time — the condition lives in ONE place, in
       committed.js, which is the same reason `free` itself is computed there
       and only read here. Short reads correctly too: cash − free then exceeds
       cash, the clamp fills the bar, and fully-committed is the truth.

       THE LABEL SPLITS WHERE THE BAR DOES. Once commitments exceed the cash the
       neutral sentence has no true reading left: it would announce "{free} is
       free" for money that is not there. A sighted reader is covered — the bar
       is fully amber and the figure above it is labelled "short" — and a screen
       reader is not, which is exactly the asymmetry an aria-label exists to
       close. `L.short` is committed.js's own cent-rounded verdict, the same one
       that chose the word "short" above, so the two can never disagree about
       which side of zero this vault is on.

       Math.abs survives on the covered branch on purpose: `short` is false at
       exactly zero cents, and the float that rounds there can still be a hair
       under it (see the freeCents comment in committed.js), which would
       otherwise announce "R -0,00 is free". */
    if (L.cashKnown && L.cash > 0) {
      const barCommitted = L.cash - L.free;
      const comPct = Math.min(100, (barCommitted / L.cash) * 100);
      body.append(el('div', {
        class: 'left-bar', role: 'img',
        'aria-label': L.short
          ? i18n.t('dash.left.barAriaShort', {
            cash: money(L.cash), committed: money(barCommitted), short: money(Math.abs(L.free)),
          })
          : L.earmarked > 0
            /* ISSUE 65. `barCommitted` is cash − free, which since ISSUE 48
               silently means committed PLUS earmarked. The bar's geometry is
               right to derive it that way — it cannot then drift from the
               chain — but the LABEL inherited a word that no longer covers
               what it names: a screen-reader user heard "R 24 500 is
               committed", a figure on no screen, of which R 23 000 was the
               emergency and baby funds. The sighted reader gets three terms;
               so does this now. */
            ? i18n.t('dash.left.barAriaSetAside', {
              cash: money(L.cash), earmarked: money(L.earmarked),
              committed: money(Math.max(0, barCommitted - L.earmarked)),
              free: money(Math.abs(L.free)),
            })
            : i18n.t('dash.left.barAria', {
              cash: money(L.cash), committed: money(barCommitted), free: money(Math.abs(L.free)),
            }),
      },
      el('i', { class: 'b-com', style: `width:${comPct.toFixed(2)}%` }),
      el('i', { class: 'b-free', style: `width:${(100 - comPct).toFixed(2)}%` })));
    }

    /* What is owed on cards, stated beside the figures rather than inside them.
       Every number above this line is unchanged by it — that is the point. A
       reader who spends on a card and settles it later was being shown what the
       cheque account holds with no mention of what is already claimed against
       it, which is how "actually free" came to sit beside five figures of card
       balance and say nothing. */
    /* Only for cards NOT already in the chain — per card, not all-or-nothing.
       A card marked `settle_monthly` is subtracted above as its own term, and
       repeating that figure here as "not taken off any figure above" would
       flatly contradict the column that just took it off. But the old gate
       (`owed > 0 && cardDue === 0`) suppressed the WHOLE sentence the moment
       any one card was claimed, so in a mixed household the second, revolving
       card's balance appeared in no figure and no sentence. whatsLeft now
       derives `owedElse` — the unclaimed remainder — from the very items the
       chain claimed, and the sentence fires for exactly that remainder. */
    if (L.owedElse > 0) {
      const line = L.owedElseCards.length === 1
        ? i18n.t('dash.left.owedCard', { amount: money(L.owedElse, 0), name: L.owedElseCards[0] })
        : i18n.t('dash.left.owedCards', { amount: money(L.owedElse, 0), count: L.owedElseCards.length });
      body.append(el('div', { class: 'kpi-caveat-txt left-owed' },
        icoEl(['info', 'alert-circle']), line));
    }

    /* The disclosure is part of the feature, not a courtesy. A card asserting a
       committed figure with no way to check it is the Services page again — a
       number nobody could audit, on a page that quietly died of it. */
    if (L.items.length) {
      const list = el('table', { class: 'left-disc' });
      for (const it of L.items) {
        /* ISSUE 46. "expected 1 Sep" printed on the 2nd is the app telling
           the reader to wait for something that has already not happened. An
           instalment whose day has gone with no payment against it is still
           claimed — that is the fix — so the row has to SAY that rather than
           quietly mis-tense it. `missed` is stamped in committed.js where the
           comparison is made, so the claim and the sentence explaining it come
           from one reading of the date. */
        const when = it.due
          ? i18n.t(it.missed ? 'dash.left.overdue' : 'dash.left.expected', { date: it.due })
          : i18n.t('dash.left.thisPeriod');
        /* ISSUE 47. A weekly service commits several charges in one period, so
           the row states the CADENCE — "4 × R250" — rather than a single
           R1 000 debit nobody will ever find on a statement. `dash.left
           .lastCharged` names what the merchant last took, and for a
           multi-occurrence item that is `unit`, never the total. */
        const many = (it.occurrences || 1) > 1;
        const each = it.unit != null ? it.unit : it.amount;
        const src = many ? i18n.t('dash.left.times', { count: it.occurrences, amount: money(each, 0) })
          : it.basis === 'charged' ? i18n.t('dash.left.lastCharged', { amount: money(it.amount, 0) })
          : it.basis === 'stated' ? i18n.t('dash.left.asListed')
            : it.basis === 'settled' ? i18n.t('dash.left.settledInFull')
              : i18n.t('dash.left.contracted');
        list.append(el('tr', {},
          el('td', {}, el('div', { class: 'dn' }, it.name),
            el('div', { class: 'dd' }, [it.detail, when, src].filter(Boolean).join(' · '))),
          /* ISSUE 30. This table exists because "a card asserting a committed
             figure with no way to check it is the Services page again" — and
             it was printing a foreign card's commitment under the household
             symbol, so the disclosure written to make a figure checkable was
             itself unreadable. `it.currency` is stamped on the item where it
             is built (committed.js); absent means household. */
          el('td', { class: 'da num' }, it.currency && it.currency !== S.settings.currency
            && typeof ctx.moneyIn === 'function'
            ? ctx.moneyIn(it.currency, it.amount, 0)
            : money(it.amount, 0))));
      }
      const det = el('details', { class: 'left-open' },
        el('summary', {}, i18n.t('dash.left.whatsCounted')), list,
        el('p', { class: 'left-src' }, i18n.t('dash.left.source')));
      body.append(det);
    }
  }

  /* ------------------------- where you stand ----------------------------
     Position, not flow. Every other card on this page answers "what happened
     in this period"; these four answer "what is true today", and they are the
     only things here that do NOT move when the period changes.

     That difference is the whole reason the band is labelled and sits below
     the period cards rather than being sprinkled among them. A tile that holds
     still while the control above it moves is indistinguishable from one that
     has stopped updating — the same reading failure the card guards at the top
     of this file were written for, arriving by a different route.

     Every figure here is deliberately borrowed rather than recomputed:
     worth() for the balance-sheet halves and owedSummary() for the lending
     ledger, the same functions the Savings, Debt and Owed pages call. A tile
     that disagrees with the page it links to is worse than no tile. */
  /* Case-folded and trimmed against the account's own type, not compared raw.
     `load.js` only defaults `type` when the key is ABSENT, so `type: Savings`,
     `type: TFSA` or `type: ' savings '` all reach here exactly as written in
     the file — and worth() beside this tile splits every account by SIGN, not
     by type, so it counts that same balance while this filter silently
     dropped it. worth.js:122-141 documents the identical trap costing the
     Savings composition chart R80 000 in an account of an unrecognised type;
     it was never applied here, so a household holding R85 000 saw this tile
     read R5 000 while net worth beside it counted the full amount. */
  const accountsOfType = type => S.accounts.filter(a => String(a.type || '').trim().toLowerCase() === type);
  const balanceOf = type => accountsOfType(type).reduce((t, a) => t + (a.balance || 0), 0);

  /* A tile whose value is a button into the page that owns it. kpiTiles() is
     not used here because its tiles are inert by design — these are summaries
     of pages, and the summary has to be the way in. The aria-label carries the
     whole sentence: read as-is a screen reader gets "Debt R124 000", then a
     sub-line it has no way to connect back. */
  function posTile(grid, { label, value, cls, sub, view, say }) {
    const btn = el('button', {
      type: 'button', class: `v num ${cls || ''}`,
      'aria-label': say, onclick: () => ctx.switchView(view),
    }, value);
    const t = el('div', { class: 'mini' }, el('div', { class: 'l' }, label), btn);
    if (sub) t.append(el('div', { class: 's' }, sub));
    grid.append(t);
    return t;
  }

  function renderPosition() {
    const grid = $('#dashPositionKpis'); grid.empty();
    const card = $('#dashPositionCard');

    /* ISSUE 28 (2026-08-29 audit). These tiles used to ADD every balance
       whatever its own `currency:` and disclose the mix with a sentence — the
       very sentence the Accounts page retired when it stopped doing the
       arithmetic that sentence described. The result was two answers to one
       question on two screens this tile links to: Dashboard "Net worth"
       R 2 020 000 against the Accounts hero's R 20 000 + Rp 2 000 000, for
       the same files in the same session.

       Same rule as the Accounts hero and the Savings page now: split first,
       sum the household's own currency, name every other symbol beside it. */
    /* ISSUE 44. IMPLIED balances, not stated ones — the same figures the
       "money you have right now" card is built from. Two as-of dates on one
       Dashboard printed R41 800 of cash (a 2 September Checkers shop inside
       it) beside a R120 000 net worth built on a cash pile still reading as
       of 1 September. Net worth genuinely does not move with the PERIOD, and
       its caption says so; that was never a reason for it not to move with
       the DAY. */
    const { primary: homeAccounts, others: worthOthers } = splitByCurrency(impliedAccounts(), S.settings.currency);
    /* The same sentence the Accounts hero carries, from the same key — so the
       two screens cannot word the same fact differently. */
    const otherLine = others => (others.length
      ? i18n.t('acct.hero.otherCurrencies', {
        list: others.map(([sym, v]) => ctx.moneyIn(sym, v, 0)).join(' · '),
      }) : '');
    /* The household symbol, passed at last. worth() has computed a
       `currencies` disclosure for its caller since it was written, and every
       caller dropped it — and, called with three arguments, computed it
       against a fallback household of "R", so an Rp vault got a list naming a
       currency it has never held. */
    /* ISSUE 39. S.owed passed: this card already computed owedSummary() a
       few lines down and printed the receivable in its own tile, so before
       this the balance sheet and the tile beside it read the same ledger and
       only one of them counted it. */
    const w = worth(homeAccounts, S.debts, S.assets, S.settings.currency, S.owed);
    /* The NET-WORTH tile's disclosure is the accounts' `others` merged with
       the two ledgers worth() reads directly — see otherCurrencyNet's own
       header in worth.js. Before this it named the accounts alone, so a
       €200 000 flat and a €100 000 bond were absent from the figure AND from
       the sentence beside it: the silent exclusion currency.js:14 forbids, on
       the one tile that claims to state the whole position.

       Deliberately only this tile. The Savings tile below keeps the
       accounts-only `savingsOthers`, because its figure is built from savings
       and investment ACCOUNTS — a Lisbon flat is not money in a savings
       account, and listing it there would qualify a figure it was never part
       of. */
    const worthOtherNet = otherCurrencyNet(w, worthOthers);
    const owed = owedSummary(S.owed, undefined, S.settings.currency);
    const savingsAccounts = [...accountsOfType('savings'), ...accountsOfType('investment')];
    const { others: savingsOthers } = splitByCurrency(savingsAccounts, S.settings.currency);
    const savings = primaryTotal(accountsOfType('savings'), S.settings.currency);
    const invest = primaryTotal(accountsOfType('investment'), S.settings.currency);

    /* A vault that has none of this yet gets no band at all. Four tiles reading
       R0.00 is not an empty state, it is a balance sheet asserting that the
       reader owns nothing — which on a fresh install is a statement about the
       import being incomplete, not about their finances.

       The card still appears for a vault with only stale balances and no
       totals, because the caveat inside it is then the only thing on the page
       telling them why every figure is zero. */
    const hasLedger = w.assets > 0 || w.liabilities > 0 || owed.entries > 0 || savings > 0 || invest > 0;
    const hasCaveat = stalenessSummary(S.accounts).stale > 0;
    if (card) card.classList.toggle('hidden', !hasLedger && !hasCaveat);
    $('#dashPositionSub').textContent = hasLedger
      ? i18n.t('dash.pos.sub')
      : '';
    if (!hasLedger) return;

    posTile(grid, {
      label: i18n.t('dash.pos.netWorth'), value: money(w.net, 0),
      cls: w.net >= 0 ? 'grad-txt' : 'text-danger',
      sub: i18n.t('dash.pos.netWorthSub', { owned: money(w.assets, 0), owed: money(w.liabilities, 0) })
        + otherLine(worthOtherNet),
      view: 'savings',
      /* The disclosure goes into the aria-label too. The sub-line beside it is
         a sibling and still reachable, but a screen reader following the tile
         is handed the FIGURE and its caveat together or not at all — the same
         asymmetry this file already closes deliberately for the bar below. */
      say: i18n.t('dash.pos.netWorthSay', { net: money(w.net), owned: money(w.assets), owed: money(w.liabilities) })
        + otherLine(worthOtherNet),
    });

    /* Negated for display — owed money reads as a positive figure, the same
       convention the Savings composition chart uses for its liability slices
       (the Savings Debt tile that shared it is gone; savings.js says why).
       Split by ledger for the same reason: an overdrawn cheque account and a
       home loan are both "owed" and live in different files, so a single total
       with no breakdown sends the reader to the wrong page to find it.

       Deliberately NOT a debt-free date. That figure depends on the extra
       payment and strategy the reader sets on the Debt page, which are inputs
       to a form and not saved anywhere this card can read — so a copy here
       would compute a different, later date and put two debt-free dates in one
       app. The tile links there instead. */
    /* Which ledger the figure above actually came from. The old test asked only
       whether BOTH were in play and otherwise fell through to a count of
       debt-page rows — so a vault whose only liability is an overdrawn account
       printed the account's balance under the words "0 active", a tile stating
       a debt and denying it in the same breath. That is this vault: R8 874 on a
       credit-card account, nothing on the Debt page at all. Each ledger now
       gets its own sentence, and the count quoted is always a count of the
       thing the figure was built from. */
    const owedAccounts = S.accounts.filter(a => (a.balance || 0) < 0).length;
    /* ISSUE 30. `w.active` is every active debt-page row, foreign ones
       included — worth() keeps it whole on purpose, so a foreign debt holds
       its positional key and the payoff projections do not repoint (ADR-0004).
       The FIGURE above, though, is home-only: worth() filters foreign debts
       out of `fromDebts`. Quoting the whole list under it put a rand total
       under the words "2 active" on a household with one rand bond and one
       euro one — the same "count what the figure was built from" rule the
       owedAccounts line above already follows, missed one line further down. */
    const homeActive = w.active.filter(d => !isForeign(d, S.settings.currency)).length;
    posTile(grid, {
      label: i18n.t('dash.pos.debt'), value: money(-w.liabilities, 0),
      cls: w.liabilities > 0 ? 'text-danger' : '',
      sub: w.fromDebts && w.fromAccounts
        ? i18n.t('dash.pos.debtSplit', { accounts: money(w.fromAccounts, 0), debts: money(w.fromDebts, 0) })
        : w.fromDebts > 0 ? i18n.t('dash.pos.debtActive', { count: homeActive })
          : w.fromAccounts > 0 ? i18n.t('dash.pos.debtAccounts', { count: owedAccounts })
            : i18n.t('dash.pos.debtNone'),
      view: 'debts',
      say: w.liabilities > 0
        ? i18n.t('dash.pos.debtSay', { amount: money(w.liabilities) })
        : i18n.t('dash.pos.debtSayNone'),
    });

    /* The one figure on this card that is money coming TOWARDS the household,
       so it is never red — outstanding is a warning at most. Age rather than a
       due date, for the reason owed-math.js sets out. */
    posTile(grid, {
      label: i18n.t('dash.pos.owed'), value: money(owed.outstanding, 0),
      cls: owed.outstanding > 0 ? 'text-warning' : '',
      sub: owed.outstanding > 0
        ? i18n.t('dash.pos.owedOpen', { count: owed.open })
          + (owed.oldestDays !== null ? i18n.t('dash.pos.owedOldest', { days: owed.oldestDays, count: owed.oldestDays }) : '')
        : (owed.entries ? i18n.t('dash.pos.owedRecovered', { amount: money(owed.recovered, 0) }) : i18n.t('dash.pos.owedNone')),
      view: 'owed',
      say: owed.outstanding > 0
        ? i18n.t('dash.pos.owedSay', { amount: money(owed.outstanding), count: owed.open })
        : i18n.t('dash.pos.owedSayNone'),
    });

    /* Uncoloured, deliberately. The Savings page leaves its Savings and
       Investments tiles plain and spends its colour on the two figures that
       carry a verdict — net worth and debt — and this band has to read the same
       way. Given green it becomes a second green number beside the gradient one,
       and the eye stops being able to tell which of the four is the headline. */
    posTile(grid, {
      label: i18n.t('dash.pos.savings'), value: money(savings + invest, 0),
      sub: i18n.t('dash.pos.savingsSub', { savings: money(savings, 0), invested: money(invest, 0) })
        + otherLine(savingsOthers),
      view: 'savings',
      say: i18n.t('dash.pos.savingsSay', { amount: money(savings + invest) })
        + otherLine(savingsOthers),
    });
  }

  /* A credit card can honestly be tracked as an account OR as a Debt-page row,
     and nothing stops someone doing both — at which point the net worth printed
     above counts it twice. The Savings page already discloses this; stating the
     same total here without the same sentence would put two net-worth figures in
     the app, one qualified and one not, and the unqualified one first. */
  function renderOverlapNote() {
    const wrap = $('#dashPositionNote'); wrap.empty();
    const o = cardOverlap(S.accounts, S.debts);
    if (!o) return;
    wrap.append(el('div', { class: 'kpi-caveat-txt' }, icoEl(['info', 'alert-circle']),
      i18n.t('dash.overlap', { accounts: o.cardAccounts, debts: o.cardDebts })));
    const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
      'aria-label': i18n.t('dash.overlap.aria') }, i18n.t('dash.overlap.btn'));
    btn.addEventListener('click', () => ctx.switchView('debts'));
    wrap.append(btn);
  }

  /* Balances nobody has confirmed in a while.

     The Accounts page has computed this per card for a long time, but you have
     to already be on that page to learn it — so on the vault this was built
     against, fourteen of sixteen balances sat four months stale while the app
     said nothing anywhere the reader actually looks. This is the one line that
     closes the loop, and it is deliberately the quietest thing on the page:
     it reports the AGE of a figure, not a problem with it.

     It used to sit under the hero, where it qualified four cards built entirely
     out of TRANSACTIONS — which do not go stale and never depended on it. It
     now sits inside the position band, under the net-worth figure those very
     balances are summed into. Same sentence, finally next to the number it is
     about, and phrased like the Savings page's copy for the same reason: this
     is the provenance of the total above, not a notice about a different page. */
  function renderStale() {
    const wrap = $('#dashStale'); wrap.empty();
    const s = stalenessSummary(S.accounts);
    if (!s.stale) return;
    const age = s.oldestDays === null ? i18n.t('dash.stale.noDate') : i18n.t('dash.stale.oldest', { days: s.oldestDays, count: s.oldestDays });
    const all = s.stale === s.total;
    const line = all
      ? i18n.t('dash.stale.all', { count: s.total })
      : i18n.t('dash.stale.some', { stale: s.stale, total: s.total });
    /* How far the transactions have ALREADY moved those balances.
       Saying a figure is old leaves the reader no way to judge whether that
       matters by a rand or by twenty thousand — on the vault this was written
       against it was twenty thousand, sitting under a net worth stated to the
       cent. The tiles keep quoting what the files SAY, deliberately: they have
       to agree with the Savings and Debt pages, which state the same figures,
       and a tile that silently reconciles itself is a third answer. So the
       correction is disclosed rather than applied.

       Summing reconcile()'s own delta, not a private recount, so this cannot
       drift from the "what's left" card that reconciles the same accounts. It
       is the exact move in NET worth because worth() splits accounts by sign
       and nets them straight back: the owned and owed halves both shift, and
       what survives is the sum of the deltas. */
    /* ISSUE 30. reconcile() itself is correct — `a.balance + delta` is
       single-account arithmetic in that account's own currency — but summing
       the deltas across accounts is not, and the comment above claims this is
       "the exact move in NET worth". That stops being true the moment two
       accounts differ in currency: on a two-currency vault this printed
       "moved them down by R 1 503 000" where the rand move was R 3 000.

       Home-currency accounts only, and the count of what that leaves out
       travels with it — the sentence below states both. */
    const idx = accountIndex();
    let drift = 0, driftForeign = 0, driftUnplaced = 0;
    for (const a of S.accounts) {
      const rec = reconcile(a, (idx.get(a) || {}).rows || []);
      /* COUNTED BEFORE THE STATE TEST, on purpose, and this is the whole
         reason `unreadable` is a count on every verdict rather than a sixth
         state. An account holding nothing but undatable rows comes back
         'clean' — reconcile's own doc says 'clean' now means "nothing
         READABLE has moved" — so a tally taken after `state !== 'drift'`
         would report zero unplaced rows on exactly the account whose entire
         movement went unplaced. `rec.unreadable` is undefined on the two
         verdicts that never walked the rows ('no-date', 'no-tx'), which is
         falsy and adds nothing.

         Foreign accounts are skipped here as they are for the drift sum
         itself: this sentence qualifies a rand figure, and a rupiah row
         nobody can date did not move it. Their own count is disclosed on
         their own band in renderLeft. */
      if (!isForeign(a, S.settings.currency)) driftUnplaced += rec.unreadable || 0;
      if (rec.state !== 'drift') continue;
      if (isForeign(a, S.settings.currency)) { driftForeign++; continue; }
      drift += rec.delta;
    }
    /* Below a whole currency unit there is nothing to report but rounding. */
    const driftNote = Math.abs(drift) >= 1
      ? i18n.t(drift > 0 ? 'dash.stale.driftUp' : 'dash.stale.driftDown', { amount: money(Math.abs(drift), 0) })
      : '';
    /* Reuses the hero's own key rather than a second sentence for the same
       fact — the drift figure above covers the household's currency only, and
       this is the app's one wording for "these accounts are not in it". */
    const driftForeignNote = driftForeign
      ? ' ' + i18n.t('dash.foreignExcluded', {
        count: driftForeign,
        symbols: [...new Set(S.accounts.filter(a => isForeign(a, S.settings.currency))
          .map(a => symbolOf(a, S.settings.currency)))].join(' · '),
      })
      : '';
    /* And what the drift figure could not measure at all. The two sentences
       are complementary, not alternatives: `driftForeignNote` names accounts
       held out of the sum because they are stated in another currency, this
       names ROWS held out of every account's own implied balance because
       their dates name no day. Both are exclusions from the same figure, and
       currency.js:14's rule that neither may be silent covers them equally.
       Empty until the twelve language tables carry the sentence — see
       unreadableNote(). */
    const unplacedSentence = unreadableNote(driftUnplaced);
    const driftUnplacedNote = unplacedSentence ? ' ' + unplacedSentence : '';
    wrap.append(el('div', { class: 'kpi-caveat-txt' }, icoEl(['info', 'alert-circle']),
      i18n.t('dash.stale.line', { line, age }) + driftNote + driftForeignNote + driftUnplacedNote));
    const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
      'aria-label': i18n.t('dash.stale.aria') }, i18n.t('dash.stale.btn'));
    btn.addEventListener('click', () => ctx.switchView('accounts'));
    wrap.append(btn);
  }

  /* Each section recomputes its own totals rather than sharing one snapshot
     from renderDashboard. periodSummary is a sub-millisecond pass over the
     period's rows, and computing it inside the guard means a throw in there
     costs one card instead of all four. */
  function renderHero() {
    const sum = periodSummary(S.period);
    const bud = budgetTotals(S.period);
    /* ISSUE 40. SPEND against SPEND. `bud.spend` no longer holds the
       savings/investment envelopes and `spent` no longer holds the outgoings
       that fill them — both halves moved together, because a remaining figure
       built from a narrowed budget and an unnarrowed actual would be a new
       version of the same defect rather than a fix for it.

       The audit household: R14 500 budgeted against R11 590 spent left R2 910
       under a hero reading "Budget remaining this period". That R2 910 was
       R4 000 of unfilled savings envelopes less R1 090 of grocery overspend —
       two facts that had cancelled into a number that looked like headroom.
       Measured on spend alone the same household has R800 left and a grocery
       envelope already over, which is the thing worth knowing. */
    /* ADR-0005: the one "budget used" reading. `spent` here is what the Score
       chip, the Score ring's numerator and the Budget page's tile all print. */
    const used = budgetUsed(S.period);
    const spent = used.spent;
    const available = bud.spend - spent;
    const heroNegative = available < 0;
    const meterMax = Math.max(spent, bud.spend, 1);
    const fillPct = Math.min(100, (spent / meterMax) * 100).toFixed(2);
    const markPct = bud.spend > 0 ? ((bud.spend / meterMax) * 100).toFixed(2) : null;
    /* Against the income the BUDGET states, not the income that happens to
       have landed so far — see incomeBaseFor() in money-flow.js, which now
       owns this rule for both cards that ask it. It lived here alone until the
       Score page's "Allocated of income" was found answering the same question
       off actual income and printing 102% where this line printed 100%.

       Five of this vault's eight budget files carry no income row, so the
       no-percentage branch is the normal one here, not the corner. */
    /* Both envelopes here, deliberately, where the remaining figure above takes
       only one. "How much of my income have I allocated" is a question about
       the whole plan — a rand into the emergency fund is every bit as
       allocated as a rand of groceries — and answering it off the spend
       envelopes alone would report a household that saves a fifth of its
       income as having planned for nothing. */
    const allocated = allocatedShare({
      budgeted: bud.spend + (bud.setAside || 0), budgetIncome: bud.income, actualIncome: sum.income,
      /* ISSUE 73: BEFORE today's period, not merely different from it — a
         future period has not finished, and treating it as finished let
         incomeBaseFor fall back to income that has not arrived. */
      periodFinished: S.period < currentPeriod(),
    });
    /* sharePercentLabel, not a bare Math.round: 100.24% allocated rounding to
       "100%" sat beside the Budget page's red "over-budgeted R 97,80" tile,
       and the rounding ate the only fact the two figures disagreed on — which
       side of the line the plan is on. Same rule for "used", where 100% is
       the same kind of boundary. */
    const budgetedPct = allocated === null ? null : sharePercentLabel(allocated, locale().decimal);
    /* ISSUE 36. WHICH income that percentage is of, when it is not the one
       printed six inches to the left.

       The denominator choice is deliberate and stays: "of income budgeted"
       measures the plan against the income the plan was built on, which is
       why incomeBaseFor prefers `budgetIncome`. What was wrong was that the
       hero states BOTH numbers and named neither. On the `BudgetAudit`
       household on 2026-09-02 the income line read R40 000 — a R35 000 salary
       plus a R5 000 family gift — and the line under "Budgeted" read "41% of
       income budgeted", which is 14 500 / 35 000. One card, one word "income",
       two figures, and no way for a reader to work out that the two were
       answering different questions.

       Named only when the two actually differ. On the common vault, where the
       budget's income row and the period's income agree, the extra clause
       would be noise qualifying nothing. */
    const incomeBase = incomeBaseFor({
      budgetIncome: bud.income, actualIncome: sum.income,
      /* ISSUE 73: BEFORE today's period, not merely different from it — a
         future period has not finished, and treating it as finished let
         incomeBaseFor fall back to income that has not arrived. */
      periodFinished: S.period < currentPeriod(),
    });
    const baseDiffers = allocated !== null && Math.round((incomeBase - sum.income) * 100) !== 0;
    const usedPct = used.used === null ? null : sharePercentLabel(used.used, locale().decimal);
    /* ISSUE 40. The stat column states the WHOLE plan (R14 500) while the hero
       above it now measures against the spend envelopes alone (R10 500). Both
       are right for their own question and the card must not leave a reader to
       discover the R4 000 gap by subtraction — that is the shape this whole
       audit keeps finding. Named only when there IS a set-aside envelope. */
    /* ISSUE 43. Budgeted BESIDE moved. The envelopes' own actuals are R0 and
       will stay R0 while the funding rows are categorised Transfer — there is
       no link from a transfer row to a budget category, and this repo does not
       guess at free text (worth.js's cardOverlap says why). What can be
       answered honestly is the aggregate, so the reader compares two totals
       instead of being shown a per-envelope zero that is not true.

       movedToFunds() pairs the legs, so money shuffled between two funds is
       not counted as fresh saving — the same reading the score's own saving
       rate takes, from the same function. */
    const moved = (bud.setAside || 0) > 0 ? movedToFunds(S.period) : 0;
    const setAsideNote = (bud.setAside || 0) > 0
      ? i18n.t('dash.stat.setAsideMoved', {
        amount: money(bud.setAside, 0), moved: money(moved, 0),
      })
      : '';

    const hero = $('#heroCard'); hero.empty();
    const cur = S.settings.currency;
    const heroNum = el('div', { class: `hero-num${heroNegative ? ' hero-num--negative' : ''}` },
      el('small', {}, cur), money(Math.abs(available), 0).slice(cur.length + 1));
    const meter = el('div', { class: `hero-meter${heroNegative ? ' over' : ''}` },
      el('i', { style: `width:${fillPct}%` }));
    if (markPct !== null) meter.append(el('span', { class: 'hero-mark', style: `left:${markPct}%`, 'aria-hidden': 'true' }));
    /* Money that ARRIVED but is not in the Income figure: deposits nobody has
       categorised, plus deposits under a category name no file answers to.

       Not counted as income on purpose — an uncategorised deposit may be a
       transfer in from savings, and guessing would inflate every ratio built on
       income. But the tile is read as "what came in this period", and on the
       vault this was found in, one period was quietly, materially short of
       that. So it says so, the way the donut below already discloses its own
       gap.
       Refunds are deliberately NOT in here: they are money back inside a
       category, already netted off that category's own actual, and calling
       them uncounted income would be the noise that stops people reading the
       line at all. Silent under a currency unit, where only rounding lives. */
    const fromFunds = sum.fundedFromSavings || { spend: 0, count: 0 };
    const sched = sum.scheduled || { income: 0, spend: 0 };
    const scheduledAhead = (sched.income || 0) + (sched.spend || 0);
    const inUncounted = (sum.uncatIncome || 0) + ((sum.unknown && sum.unknown.income) || 0);
    /* ISSUE 28. Every figure on this hero — available, income, budgeted, spent
       and the meter — is built from periodSummary, which now holds foreign
       accounts OUT because a rand total cannot include rupiah. Held out is
       fine; held out SILENTLY is not, and this is the most-read card in the
       app, so the sentence goes here rather than only on the page where the
       accounts live. */
    const foreignNote = sum.foreign && sum.foreign.count
      ? i18n.t('dash.foreignExcluded', {
        count: sum.foreign.count, symbols: sum.foreign.symbols.join(' · '),
      })
      : '';
    const statCol = el('div', { class: 'stat-col' },
      el('div', { class: 'stat' },
        el('div', {}, el('div', { class: 'sl' }, i18n.t('dash.stat.income'))),
        el('div', {}, el('div', { class: 'sv grad-txt' }, money(sum.income)),
          inUncounted >= 1 ? el('div', { class: 'st' }, i18n.t('dash.stat.notIncome', { amount: money(inUncounted) })) : '')),
      el('div', { class: 'stat' },
        el('div', {}, el('div', { class: 'sl' }, i18n.t('dash.stat.budgeted'))),
        el('div', {}, el('div', { class: 'sv' }, money(bud.spend + (bud.setAside || 0))),
          (budgetedPct !== null || setAsideNote)
            ? el('div', { class: 'st' }, [
              budgetedPct === null ? '' : baseDiffers
                ? i18n.t('dash.stat.allocatedOf', { pct: budgetedPct, amount: money(incomeBase, 0) })
                : i18n.t('dash.stat.allocated', { pct: budgetedPct }),
              setAsideNote,
            ].filter(Boolean).join(' · '))
            : '')),
      el('div', { class: 'stat' },
        el('div', {}, el('div', { class: 'sl' }, i18n.t('dash.stat.spent'))),
        el('div', {}, el('div', { class: 'sv' }, money(sum.spend)),
          usedPct !== null ? el('div', { class: 'st' }, el('span', { class: 'tag warn' }, i18n.t('dash.stat.used', { pct: usedPct }))) : '')));
    if (foreignNote) statCol.append(el('div', { class: 'stat stat-note' }, el('div', { class: 'st' }, foreignNote)));
    /* A real <button>, not a plain <div> — this is the app's clearest
       statement of outstanding work and, until now, the one figure on the
       whole hero a reader could not act on or even reach from a keyboard.
       class="stat" rather than a new component: the global button reset in
       styles.css (".budget-app-root button") already neutralises Obsidian's
       and the browser's native chrome, and .stat's own rules (cascade order
       puts them after the reset) still decide the flex row, the baseline
       alignment and the border — so a <button class="stat"> lays out exactly
       like the <div> it replaces. openUncategorised() below is the same
       drill-through openCategory() already does, pointed at the '__none__'
       sentinel shell.js's static "Uncategorised" option and transactions.js's
       own filter both already understand.

       No new aria-label, and no new i18n key for one: the button's own text
       — "Uncategorised", the count, "Review" — already reads as the thing
       being activated, the same call the health card's fig() makes just
       above in this file for exactly the same reason. */
    if (sum.uncategorised > 0) statCol.append(
      el('button', { type: 'button', class: 'stat', onclick: openUncategorised },
        el('div', {}, el('div', { class: 'sl' }, i18n.t('dash.stat.uncategorised'))),
        el('div', {}, el('div', { class: 'sv text-warning' }, String(sum.uncategorised)),
          el('div', { class: 'st' }, i18n.t('dash.stat.review')))));
    /* A category name no category file answers to — its OWN state, not a
       flavour of uncategorised, and the reason this tile exists at all.

       Deleting a category leaves the name on its rows by design, and there is
       no rename UI, so renaming one means editing the file and orphaning every
       row that used it. Nothing said so: `catType` answered null, which reads
       downstream as "not income", so an orphaned DEPOSIT was counted by
       nothing, and an orphaned TRANSFER category silently turned every past
       transfer into real spending. The count is of CATEGORIES, since that is
       what the reader has to go and fix.

       The names used to ride ONLY on a hover title — a pointer with no wall of
       text on a phone, the comment used to say, except a phone has no hover:
       touch never fires it, so the one thing a reader needs to actually go and
       fix (WHICH categories) was unreachable on the platform this plugin
       explicitly targets. They are visible text on the tile now, truncated to
       MISSING_NAMES_SHOWN with a "+N more" tail so a vault with many orphaned
       names still fits the card; the title stays too, as a full-list fallback
       where hover does exist. */
    if (sum.unknown && sum.unknown.count > 0) {
      const MISSING_NAMES_SHOWN = 3;
      const names = sum.unknown.names;
      const shown = names.slice(0, MISSING_NAMES_SHOWN).join(', ');
      const restCount = names.length - MISSING_NAMES_SHOWN;
      const namesLine = restCount > 0
        ? i18n.t('dash.stat.missingNames', { names: shown, count: restCount })
        : shown;
      /* Audit finding #5: dash.stat.missingSub says "{count} transactions —
         recategorise" as plain text on a tile that did nothing when tapped —
         copy naming an action the element could not perform, right beside the
         Uncategorised tile a few lines above that already IS a button
         (openUncategorised). A real <button>, same "stat" pattern as that
         sibling — the global button reset plus .stat's own rules already lay
         it out identically to the <div> it replaces (see the comment on the
         uncategorised button below for why no new CSS is needed).
         Reuses openCategory(), the SAME drill-through the donut and the
         budget table already use, rather than a bespoke handler — it is
         already guarded for a category the #txCategory select has no option
         for (`.some(o => o.value === cat)`), which an ORPHANED name always
         is (transactions.js:197 builds the select only from S.categories).
         So this cannot pre-filter to just the offending rows — there is no
         filter vocabulary for "category name matches no known category" on
         the Transactions page (that page is a teammate's file, not touched
         here) — but it still clears the other filters and lands the reader
         on Transactions with every orphaned name visible right there on
         this tile to search for by eye, which is a real step forward from a
         tap that did nothing at all. */
      statCol.append(
        el('button', { type: 'button', class: 'stat', onclick: () => openCategory(names[0]) },
          el('div', {}, el('div', { class: 'sl' }, i18n.t('dash.stat.missing'))),
          el('div', {}, el('div', { class: 'sv text-warning' }, String(names.length)),
            el('div', { class: 'st' }, i18n.t('dash.stat.missingSub', { count: sum.unknown.count })),
            el('div', { class: 'st', title: names.join(', ') }, namesLine))));
    }
    const hour = new Date().getHours();
    const greeting = i18n.t(hour < 5 ? 'dash.greet.evening' : hour < 12 ? 'dash.greet.morning' : hour < 18 ? 'dash.greet.afternoon' : 'dash.greet.evening');
    hero.append(el('div', { class: 'hero-grid' },
      el('div', {},
        S.settings.household ? el('div', { class: 'hero-greet' }, i18n.t('dash.greet.line', { greeting, name: S.settings.household })) : '',
        el('div', { class: 'hero-lbl' }, i18n.t(heroNegative ? 'dash.hero.overspent' : 'dash.hero.remaining')),
        heroNum,
        el('div', { class: 'hero-sub' }, i18n.t('dash.hero.sub', { spent: money(sum.spend), budgeted: money(bud.spend) })),
        /* ISSUE 35. The window this card's figures stop at, and what is on the
           other side of it.

           periodSummary now closes at today rather than at the month's end,
           because a gift dated the 28th and three gym charges dated the 10th,
           17th and 24th were being counted on the 2nd as money that had moved.
           Narrowing a figure is an exclusion like any other, so it is named:
           the rows are still in the ledger, still in the period, and still
           coming. `income + spend`, as one gross figure — the reader is being
           told how much of the month is not yet in these numbers, not asked to
           reconcile a second net. Silent on a finished period, where there is
           no other side. */
        scheduledAhead > 0
          ? el('div', { class: 'hero-sub hero-sub--ahead' },
            i18n.t('dash.scheduledAhead', { amount: money(scheduledAhead, 0) }))
          : '',
        /* ISSUE 41. Money that left an earmarked fund. Held out of the budget
           comparison above — a pram bought from the baby fund is not the
           grocery envelope being blown — and therefore said out loud, because
           a figure this card stopped counting is an exclusion like any other.
           `count` is passed as well as `amount`: i18n.t() picks its plural off
           `count` alone. */
        fromFunds.count > 0
          ? el('div', { class: 'hero-sub hero-sub--ahead' },
            i18n.t('dash.fundedFromSavings', {
              amount: money(fromFunds.spend, 0), count: fromFunds.count,
            }))
          : '',
        meter),
      statCol));
  }

  /* The category rows behind the Budget-vs-Actual table — and, since ADR
     "the report reads what the view reads" (see views/report.js), the ONLY
     place that computes them. Pulled out of renderBudgetTable so the report
     page can show the exact same Budget/Actual/Remaining figures the
     Dashboard shows for the same period, rather than a second copy of this
     assumed-spend/orphaned-category logic drifting from this one the way
     income and saving-rate already have twice in this codebase. Pure of the
     DOM: returns data, renderBudgetTable (and now report.js) draw it. */
  function budgetVsActualRows(p) {
    const sum = periodSummary(p);
    const budget = S.budgets[p] || [];
    const rows = new Map();
    /* An assume-spent row starts AT its own assumption — the money left in an
       earlier period, which no transaction here is expected to match. Seeded
       before the transaction pass so the bar, the remaining figure and the red
       are computed off that amount rather than off a zero nothing will fill.
       The transaction pass below may raise it; it can never lower it. See the
       flag's comment in src/load.js, and assumedActual() for the rule itself. */
    for (const b of budget) {
      /* The LIVE type, through period.js's one reading of it — not `b.type`,
         the cell the budget file stores and never heals. Read raw, a category
         retyped from expense to income sat in this table (and the Report and
         both exports, which carry `type` from here) as an expense with its
         full amount "remaining", while budgetTotals() one call away counted
         the same row as income. */
      const type = ctx.budgetRowType(b);
      const assumed = type !== 'income' && type !== 'transfer' && catAssumeSpent(b.category);
      rows.set(b.category, { budget: b.amount, type, actual: assumed ? assumedActual(b.amount, 0) : 0, notes: b.notes, assumed });
    }
    for (const [cat, amt] of Object.entries(sum.byCat)) {
      if (!cat) continue;
      const type = catType(cat);
      if (type === 'transfer') continue;
      /* An assume-spent row REPLACES rather than accumulates: seeded above at
         the assumption, it must not have this period's transactions piled on
         top of it — that doubled both Spent and the red "over budget" it
         produced while the Budget page, reading the same category, stayed on
         budget.

         Replacing is not the same as ignoring, and that is where this line was
         wrong. It skipped the row outright, citing views/budgets.js's older
         `assumed ? d.amount : …` — which had since become a max(), because a
         reader can and does pay an assumed bill from a tracked account anyway.
         So a Carry category budgeted R2 500 against a real R4 000 payment read
         R4 000 and over on the Budget page and R2 500 and "on budget" here,
         in the Report and in both exports, all four off one vault. The rule
         now comes from ONE function, in the view that owns it. */
      const existing = rows.get(cat);
      if (existing && existing.assumed) {
        // -amt because sum.byCat is signed: an expense nets negative, and a
        // category refunded past its spending nets positive, which
        // assumedActual reads as "nothing really moved" and leaves at the
        // assumption rather than below it.
        existing.actual = assumedActual(existing.budget, -amt);
        continue;
      }
      /* An ORPHANED category — catType(cat) === null, either a name no
         category file has ever answered to, or one whose file has since
         been deleted (catKnown/catType in period.js draw that line) — has no
         reliable sign to guess. `type || 'expense'` used to fall straight to
         the else branch and sign-flip a positive DEPOSIT into a negative
         "Spent" figure, the same wrong-bucket trap period.js's own comment on
         `net` warns about, just re-introduced one file downstream of the fix.

         A row that already carries a budget entry (this category is still
         IN the budget file, only its category note is gone) keeps signing by
         its OWN recorded type — read off the budget row itself, not off the
         missing category file — so a still-budgeted category is unaffected.
         A row with no budget entry at all has no type from anywhere and is
         left out of this table entirely, same as periodSummary's own
         `unknown` bucket and what renderHero already discloses by name
         instead of guessing a sign for it. */
      if (type === null && !existing) continue;
      const r = existing || rows.set(cat, { budget: 0, type: type || 'expense', actual: 0, notes: '' }).get(cat);
      const signType = type === null ? r.type : type;
      r.actual += signType === 'income' ? amt : -amt;
    }
    const order = typeOrder(S.settings.groups);
    return [...rows.entries()]
      .sort((a, b) => typeRank(a[1].type, order) - typeRank(b[1].type, order) || a[0].localeCompare(b[0]))
      .map(([cat, r]) => ({ cat, ...r }));
  }

  function renderBudgetTable() {
    const t = $('#dashBudget'); t.empty();
    $('#dashBudgetSub').textContent = `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, i18n.t('dash.col.category')), el('th', { scope: 'col', class: 'num' }, i18n.t('dash.col.budget')), el('th', { scope: 'col', class: 'num' }, i18n.t('dash.col.spent')),
      el('th', { scope: 'col', style: 'width:26%' }, ''), el('th', { scope: 'col', class: 'num' }, i18n.t('dash.col.remaining')))));
    const body = el('tbody', {});
    const sorted = budgetVsActualRows(S.period);
    let lastType = null;
    for (const r of sorted) {
      const cat = r.cat;
      if (r.type !== lastType) {
        lastType = r.type;
        body.append(el('tr', { class: 'type-row' }, el('td', { colspan: '5' }, r.type)));
      }
      const pct = r.budget > 0 ? Math.min(100, (r.actual / r.budget) * 100) : (r.actual > 0 ? 100 : 0);
      const over = r.budget > 0 && r.actual > r.budget;
      /* Spending in a category nobody budgeted for is over budget by the whole
         amount, and it used to be the one kind of overspend this table said
         nothing about: the Remaining cell was left blank whenever there was no
         budget to subtract from. Three such rows on this vault came to R995,
         which is why the column did not add up to the figure in the hero. A
         blank cell reads as "nothing to report" — the opposite of the truth. */
      // An assume-spent row is on budget by construction, and a zero-budget one
      // has nothing to be over — neither is the unbudgeted-spending case.
      const unbudgeted = r.type !== 'income' && !r.budget && r.actual > 0 && !r.assumed;
      const near = !over && r.budget > 0 && r.actual / r.budget >= 0.85;
      const barCls = r.type === 'income' ? '' : (over || unbudgeted) ? ' bg-danger' : near ? ' bg-warning' : '';
      const remaining = r.budget - r.actual;
      const bar = el('div', { class: 'cat-bar' }, el('i', { class: `cat-bar-fill${barCls}`, style: `width:${pct}%` }));
      body.append(el('tr', {},
        el('td', {}, cat, r.notes ? el('div', { class: 'text-muted', style: 'font-size:11.5px;margin-top:2px' }, r.notes.split('\n')[0]) : ''),
        el('td', { class: 'num' }, r.budget ? money(r.budget) : '—'),
        el('td', { class: 'num' }, money(r.actual)),
        el('td', {}, bar),
        el('td', { class: `num${over || unbudgeted ? ' text-danger' : ''}` },
          (r.budget || unbudgeted) ? money(remaining) : '')));
    }
    if (!sorted.length) body.append(el('tr', {}, el('td', { colspan: '5', class: 'text-muted' }, i18n.t('dash.table.empty'))));
    t.append(body);
  }

  /* ---------------------------- trend chart -----------------------------
     periodsForMonths / trendPeriods / historySpan (and the comparison maths
     further down) live in trend-math.js now — pure period arithmetic,
     testable in bare node. This file draws what they compute. */
  const trendRanges = () => historicalRanges(historySpan(), i18n.t('dash.range.all'));

  /* The saved range is only honoured while it is still on offer. A vault that
     had five years and then had its oldest statements removed must not sit on a
     5Y pill that is no longer drawn — the chart would keep the old span with no
     control showing which one is active. */
  const trendRange = (ranges = trendRanges()) =>
    ranges.find(r => r.key === plugin.settings.chartTrendRange)
    || ranges.find(r => r.key === '6m')
    || ranges[0]
    || rangeFor('6m');

  function renderTrend() {
    const wrap = $('#trendChart'); wrap.empty();

    const ranges = trendRanges();
    const range = trendRange(ranges);
    /* "All" asks for everything and lets trendPeriods stop itself at the
       earliest imported month, so it is given a couple of periods of headroom:
       a pay cycle that is not a calendar month rounds its month count short,
       and the oldest period would otherwise be the one that falls off. */
    const want = periodsForMonths(range.months) + (range.key === 'all' ? 2 : 0);
    const periods = trendPeriods(want);
    const data = periods.map(p => {
      const sum = periodSummary(p);
      return {
        p, spent: sum.spend, income: sum.income, budget: budgetTotals(p).spend, label: periodShortLabel(p),
        /* Whether the vault covers this period AT ALL — periodSpend's own
           count, uncapped, the same test compareTotals already relies on to
           keep a never-imported month out of its own baseline. A period that
           fails this is not "spent nothing", it is a gap nothing was ever
           imported into, and drawing it as a real zero is the spend/income
           lines doing exactly what the budget line's comment below (see
           flushBudgetRun) already refuses to do for the budget line. */
        covered: periodSpend(p, null).count > 0,
        /* The period on screen right now, mid-cycle. Always the LAST point —
           trendPeriods builds backwards from S.period and reverses — and
           whatever days of it have posted so far are real, but the point
           reads as a complete period same as every other, which on day 3 of
           a month reads as a collapse in spending nobody caused. */
        running: p === currentPeriod(),
      };
    });

    /* The pills live in the header, but they are rebuilt here so the active
       one can never disagree with the series actually drawn below. */
    const pills = $('#trendRange'); pills.empty();
    pills.append(rangePills({
      ranges,
      value: range.key,
      label: i18n.t('dash.trend.range'),
      onPick: async key => {
        plugin.settings.chartTrendRange = key;
        // Guarded like every other write in this app: a rejected
        // saveSettings() used to be an unhandled rejection. The chart still
        // redraws either way — the range picked is real in memory even if it
        // did not reach data.json, and refusing to redraw over a persistence
        // failure would make one problem look like two.
        try {
          await plugin.saveSettings();
        } catch (e) {
          toast(i18n.t('settings.err.save', { error: e.message || e }), true);
        }
        renderTrend();
      },
    }));

    /* Say when the range was cut short, rather than letting a "1Y" pill sit
       above six months of chart with nothing to explain the difference. "All"
       is exempt: it asked for exactly what it got, and a note explaining that
       the history stops where the history stops explains nothing. */
    const clamped = range.key !== 'all' && periods.length < want;
    $('#trendSub').textContent = i18n.t('dash.trend.sub', { count: periods.length })
      + (clamped ? i18n.t('dash.trend.clamped') : '');

    if (data.length < 2) {
      /* The nudge has to name a move the reader can actually make. Told to
         "import a second period" a manual household would go looking for an
         Import page that manual mode does not put in front of them — a first
         run that ends by pointing at a door it just closed. Chosen at render
         time rather than at load, so flipping the setting is enough. */
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        i18n.t(S.settings.input_mode === 'manual' ? 'dash.trend.empty.manual' : 'dash.trend.empty')));
      return;
    }

    const W = 1000, H = 300;
    const c = themeColors(root);
    const max = Math.max(1, ...data.flatMap(d => [d.spent, d.budget, d.income])) * 1.12;
    const s = scales({ w: W, h: H, count: data.length, max });
    const over = d => d.budget > 0 && d.spent > d.budget;
    const { svg, add } = createChart({
      w: W, h: H,
      label: i18n.t('dash.trend.aria', { count: data.length }),
    });

    const fill = areaGradient(add, 'trendSpentArea', c.success);
    gridlines(add, s, W);

    /* One area fill per unbroken run of COVERED periods, never one continuous
       shape across the whole width — the same reasoning as flushBudgetRun
       just below, applied to the fill under the spend line rather than the
       budget line drawn on top of it. A gap the vault never imported has no
       real zero to fill down to, and a single areaPath spanning the whole
       chart drew exactly that V across it. */
    let spentAreaRun = [];
    const flushSpentArea = () => {
      if (spentAreaRun.length > 1) add('path', { d: areaPath(spentAreaRun, s.baseline), fill });
      spentAreaRun = [];
    };
    data.forEach((d, i) => {
      if (d.covered) spentAreaRun.push([s.x(i), s.y(d.spent)]);
      else flushSpentArea();
    });
    flushSpentArea();

    /* One dashed run per unbroken stretch of BUDGETED periods, never a single
       line across the lot.

       A period with no budget file returns 0 from budgetTotals, and drawing
       that lands the line on the baseline — which reads as "you budgeted
       nothing", when what happened is that nothing was budgeted. On this vault
       a 1Y range covers four such months and the line visibly collapsed into
       the floor across them. The focus dot below already refuses to mark those
       points (see budgetMark) and the readout already hides the budget row for
       them; the line was the last thing still asserting the zero. Breaking the
       run also stops a straight leg being drawn ACROSS the gap, which would
       invent a budget for every month it passed over. */
    const budgetLine = { stroke: 'currentColor', 'stroke-opacity': '0.28', 'stroke-width': '1.5' };
    let run = [];
    const flushBudgetRun = () => {
      if (run.length > 1) {
        add('polyline', {
          points: run.map(pt => pt.join(',')).join(' '), fill: 'none',
          ...budgetLine, 'stroke-dasharray': '5 6', 'stroke-linecap': 'round',
        });
      } else if (run.length === 1) {
        /* A budgeted period sitting alone between two unbudgeted ones has no
           leg to be drawn as. It still gets a mark, or the one month someone
           did set a budget for would be the only one the chart never mentions. */
        add('circle', { cx: run[0][0], cy: run[0][1], r: '2', fill: 'currentColor', 'fill-opacity': '0.28' });
      }
      run = [];
    };
    data.forEach((d, i) => {
      if (d.budget > 0) run.push([s.x(i), s.y(d.budget)]);
      else flushBudgetRun();
    });
    flushBudgetRun();

    /* Income sits above spend in a healthy period, so it is drawn before the
       spend line and thinner — it is context for the spend line, not a rival
       to it.

       Broken into runs of COVERED periods for the same reason as the spend
       area above it: one continuous path across a never-imported gap draws
       income falling to zero for a month nobody's statement ever reached. */
    let incomeRun = [];
    const flushIncome = () => {
      if (incomeRun.length > 1) {
        add('path', {
          d: linePath(incomeRun),
          fill: 'none', stroke: c.info, 'stroke-opacity': '0.85',
          'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        });
      } else if (incomeRun.length === 1) {
        add('circle', { cx: incomeRun[0][0], cy: incomeRun[0][1], r: '2', fill: c.info, 'fill-opacity': '0.85' });
      }
      incomeRun = [];
    };
    data.forEach((d, i) => {
      if (d.covered) incomeRun.push([s.x(i), s.y(d.income)]);
      else flushIncome();
    });
    flushIncome();

    /* Segment by segment rather than one polyline, so a period that broke its
       budget colours only the legs touching it. Kept in a list so the two legs
       touching a focused point can thicken without the rest of the line
       moving — see focusAt below.

       Still ONE entry pushed per pair, covered or not — focusAt indexes this
       array by data index (k === i - 1 || k === i), so dropping an entry for
       a gap pair would shift every later index out from under that lookup.
       A gap leg is drawn at opacity 0 instead: present for the indexing,
       invisible on screen, and .is-on only ever changes stroke-width (see
       styles.css), so a focused gap leg cannot be highlighted back into view. */
    const segs = [];
    for (let i = 1; i < data.length; i++) {
      const gap = !data[i - 1].covered || !data[i].covered;
      /* The leg leading INTO the running period is real data, drawn with a
         dash rather than hidden — that period is not a gap, it is simply not
         finished yet, and the dash is the disclosure (see the note appended
         below the chart). */
      const dashed = !gap && data[i].running;
      segs.push(add('line', {
        class: 'trend-seg',
        x1: s.x(i - 1), y1: s.y(data[i - 1].spent), x2: s.x(i), y2: s.y(data[i].spent),
        stroke: over(data[i - 1]) || over(data[i]) ? c.danger : c.success,
        'stroke-width': '2.5', 'stroke-linecap': 'round',
        opacity: gap ? '0' : '1',
        ...(dashed ? { 'stroke-dasharray': '5 5' } : {}),
      }));
    }

    /* Past a dozen points the dots merge into a bead chain and stop being
       readable — a year of weekly periods is 52 of them. The line carries the
       shape on its own from there, and the focus marks below still land on
       every period whether or not it wears a dot.

       Nothing drawn at all for an uncovered period — there is no real figure
       under it to mark. The running period keeps its dot but draws it
       hollow (no fill) so it reads as still-open rather than a settled
       reading like every other point on the line. */
    if (data.length <= 12) {
      data.forEach((d, i) => {
        if (!d.covered) return;
        add('circle', {
          cx: s.x(i), cy: s.y(d.spent), r: '5',
          fill: d.running ? 'none' : c.hole, stroke: over(d) ? c.danger : c.success, 'stroke-width': '2.5',
        });
      });
    }

    /* ------------------------- the focused period -------------------------
       Built ONCE and moved, never rebuilt: a pointermove fires many times a
       second, and adding and removing five nodes each time is the difference
       between a chart that tracks the finger and one that lags behind it.
       Inert to the pointer, or the marks would sit between the finger and the
       chart they are marking. Hidden at rest by CSS, on .is-focus. */
    const focusG = add('g', { class: 'trend-focus', 'pointer-events': 'none' });
    const cross = add('line', {
      y1: s.padT, y2: s.baseline, stroke: 'currentColor', 'stroke-opacity': '0.28',
      'stroke-width': '1.5', 'stroke-dasharray': '3 4',
    }, focusG);
    const halo = add('circle', { r: '11', 'fill-opacity': '0.18' }, focusG);
    const budgetMark = add('circle', { r: '3.5', fill: 'currentColor', 'fill-opacity': '0.5' }, focusG);
    const incomeMark = add('circle', { r: '4', fill: c.info }, focusG);
    const spentMark = add('circle', { r: '6', fill: c.hole, 'stroke-width': '3' }, focusG);

    /* The readout is HTML rather than SVG text: the chart is drawn into a fixed
       1000-unit viewBox and scaled by CSS, so SVG text at font-size 13 renders
       at about 4px once the card is phone-width. HTML sits outside that scaling
       and stays legible at any size. */
    const tipBox = el('div', { class: 'trend-tip', role: 'status' });
    const tipHead = el('div', { class: 'trend-tip-head' });
    const tipRow = (cls, name) => {
      const swatch = el('i', { class: `trend-tip-dot ${cls}` });
      const val = el('span', { class: 'trend-tip-val num' });
      return {
        node: el('div', { class: 'trend-tip-row' },
          swatch, el('span', { class: 'trend-tip-name' }, name), val),
        swatch, val,
      };
    };
    /* The legend above the chart names these three series. Reusing its keys is
       not laziness — a readout that called them anything else would be a
       second, subtly different vocabulary for the same three lines. */
    const rSpent = tipRow('is-spent', i18n.t('shell.legend.spent'));
    const rBudget = tipRow('is-budget', i18n.t('shell.legend.budget'));
    const rIncome = tipRow('is-income', i18n.t('shell.legend.income'));
    const tipDelta = el('div', { class: 'trend-tip-delta' });
    tipBox.append(tipHead, rSpent.node, rBudget.node, rIncome.node, tipDelta);

    function focusAt(i) {
      const d = data[i];
      const x = s.x(i), y = s.y(d.spent);
      const bad = over(d);
      const key = bad ? c.danger : c.success;

      cross.setAttribute('x1', x); cross.setAttribute('x2', x);
      halo.setAttribute('cx', x); halo.setAttribute('cy', y); halo.setAttribute('fill', key);
      /* No mark and no rows for a period the vault never covers — see
         `covered` above the run-breaking logic. Hidden by opacity, the same
         device budgetMark already uses just below, so the node stays in
         place and only the drawing of it turns off. */
      halo.setAttribute('opacity', d.covered ? '1' : '0');
      spentMark.setAttribute('cx', x); spentMark.setAttribute('cy', y);
      spentMark.setAttribute('stroke', key);
      spentMark.setAttribute('opacity', d.covered ? '1' : '0');
      incomeMark.setAttribute('cx', x); incomeMark.setAttribute('cy', s.y(d.income));
      incomeMark.setAttribute('opacity', d.covered ? '1' : '0');
      /* A period with no budget set has no budget point to mark — s.y(0) would
         park a dot on the baseline that reads as "budgeted nothing" rather than
         "nothing budgeted". */
      budgetMark.setAttribute('cx', x); budgetMark.setAttribute('cy', s.y(d.budget));
      budgetMark.setAttribute('opacity', d.budget > 0 ? '1' : '0');

      svg.classList.add('is-focus');
      /* Only the legs TOUCHING the point thicken. Brightening the whole line
         would say "this series", when what is being pointed at is one period. */
      segs.forEach((n, k) => n.classList.toggle('is-on', k === i - 1 || k === i));

      tipHead.textContent = d.label;
      /* Spent and income are hidden together, never shown half-true: a gap
         period has neither figure, so a reader focusing it gets the period
         label and nothing under it rather than two zeroes that look like a
         reading. TODO(i18n): dash.trend.tip.noImport — "Not imported — no
         transactions land in this period." */
      rSpent.node.classList.toggle('hidden', !d.covered);
      rIncome.node.classList.toggle('hidden', !d.covered);
      rSpent.val.textContent = money(d.spent);
      rSpent.swatch.classList.toggle('is-over', bad);
      rIncome.val.textContent = money(d.income);
      rBudget.val.textContent = money(d.budget);
      rBudget.node.classList.toggle('hidden', !(d.budget > 0));
      const gap = d.budget - d.spent;
      /* The running period's figures are not final, so a claim like "R400
         under budget" would be read as the month's result rather than a
         moving target — the same trap compareBaseline's own note exists to
         close for the comparison column. TODO(i18n):
         dash.trend.tip.inProgress — "Still in progress — not the final
         figure for this period." */
      tipDelta.textContent = !d.covered ? ''
        : d.running ? i18n.t('dash.trend.tip.inProgress')
          : d.budget > 0 ? i18n.t(bad ? 'dash.trend.tip.over' : 'dash.trend.tip.under', { amount: money(Math.abs(gap)) })
            : '';
      tipDelta.classList.toggle('is-over', bad && d.covered && !d.running);

      /* Placed in PERCENT of the wrap rather than in pixels, which is what lets
         this skip a second measurement: the svg is width:100% height:auto over
         a fixed viewBox, so a point's x is exactly x/W of the wrap's width
         however wide the card happens to be.

         Both edges get their own anchoring. Centred on the first point the box
         hangs off the left of the card, and on the last point off the right —
         on a phone that is most of the readout gone. It stops being centred on
         the point there; the crosshair is what says which period this is. */
      const px = (x / W) * 100;
      const low = y < H * 0.42;              // near the top: flip below the point
      tipBox.style.left = `${px}%`;
      tipBox.style.top = `${(y / H) * 100}%`;
      tipBox.style.transform =
        `translate(${px < 16 ? '0%' : px > 84 ? '-100%' : '-50%'}, ${low ? '0' : '-100%'})`;
      tipBox.classList.toggle('is-below', low);
      tipBox.classList.add('is-on');
    }

    function clearFocus() {
      svg.classList.remove('is-focus');
      for (const n of segs) n.classList.remove('is-on');
      tipBox.classList.remove('is-on');
    }

    const wired = trackPoints({
      svg, w: W, xs: data.map((d, i) => s.x(i)), onFocus: focusAt, onClear: clearFocus,
    });

    /* Only where the readout could not be wired at all. An engine with no
       PointerEvent gets what it always got: a native <title> per period, on an
       invisible full-height strip so there is something to hold that is bigger
       than a dot. Assembled from the same three legend labels as the readout
       rather than from a sentence of its own — this used to be hardcoded
       English, which no amount of switching the interface language fixed. */
    if (!wired) {
      data.forEach((d, i) => {
        const hit = add('rect', {
          x: s.x(i) - s.innerW / (data.length * 2), y: s.padT,
          width: s.innerW / data.length, height: s.innerH, fill: 'transparent',
        });
        /* Same gap the HTML readout hides: nothing to report for a period the
           vault never covers, and a native title carrying two zeroes is as
           misleading as the dot it stands in for. */
        tip(add, hit, d.covered
          ? `${d.label} — `
            + `${i18n.t('shell.legend.spent')} ${money(d.spent)}`
            + ` · ${i18n.t('shell.legend.budget')} ${money(d.budget)}`
            + ` · ${i18n.t('shell.legend.income')} ${money(d.income)}`
          : d.label);
      });
    }

    axisLabels(add, s, data.map(d => d.label), H);
    wrap.append(svg, tipBox);

    /* Said once, out loud, rather than only on hover — a phone user swiping
       through this card may never focus the last point at all, and the shape
       of the line (see the dashed leg and hollow dot above) is not itself
       readable as "not final" to someone who has not been told the code. The
       tooltip's own shorter version (dash.trend.tip.inProgress) covers the
       reader who does focus it; this covers everyone else.
       TODO(i18n): dash.trend.inProgress — "The current period is still in
       progress — its point on the chart will keep moving until it ends." */
    if (data.length && data[data.length - 1].running) {
      /* Not `donut-note` — that class's `flex: 1 1 100%` assumes the donut's
         own flex wrap (.donut-wrap), which #trendChart is not. Same look,
         written locally rather than borrowing a rule tied to a layout this
         card does not have. */
      wrap.append(el('p', { class: 'text-muted', style: 'margin:10px 0 0;font-size:11.5px;line-height:1.5' },
        i18n.t('dash.trend.inProgress')));
    }
  }

  /* --------------------------- category split ---------------------------
     A donut of where the period's money actually went. Deliberately NOT a
     second ranked list: the table below already ranks categories against their
     budgets, and what that cannot show is proportion of the whole. */
  const SPLIT_SLICES = 8;

  function catColor(name) {
    return S.categories.find(c => c.name === name)?.color || '#888';
  }

  /* Ranges offered by "Where it went". A LOCAL list, deliberately not
     historicalRanges() from chart.js: that table feeds the trend chart too, and
     adding a 1-month entry to it would put a 1M pill on a chart that plots one
     point per period and cannot usefully draw a single one.

     The long end is earned exactly as the trend's is, and for the same reason:
     on three years of statements a five-year average and an all-time average
     are the same column printed twice, and a reader switching between them
     learns only that the control does nothing. So All appears past a year of
     history and 5Y only past five.

     `periods` really is periods here, not months — this card averages PAY
     CYCLES, and the count that goes into compareTotals() has to be a count of
     THOSE, never a count of calendar months. That is not the same as the
     fixed entries staying LITERAL counts, which they used to: "3M" read as 3
     periods flat, so on a fortnightly vault it averaged the three fortnights
     before this one — six weeks — under a pill that also sits, unqualified,
     beside the trend chart's own "3M", which genuinely means three months
     there (periodsForMonths() converts it). One label, two spans, on one
     screen. So the fixed entries are converted through periodsForMonths()
     exactly as the trend's are: "3M" now means the periods a fortnightly
     vault would actually see across three calendar months (six or seven of
     them), same as it always meant on a monthly vault, where a month is a
     period and the conversion is a no-op. Only "Last month" stays a literal
     1 — it names the single period immediately before this one, not a span
     of months to convert. */
  const splitRanges = () => {
    const span = historySpan();
    const out = [
      { key: '1m', label: i18n.t('dash.split.r1m'), periods: 1 },
      { key: '3m', label: '3M', periods: periodsForMonths(3) },
      { key: '6m', label: '6M', periods: periodsForMonths(6) },
      { key: '1y', label: '1Y', periods: periodsForMonths(12) },
    ];
    if (span > 60) out.push({ key: '5y', label: '5Y', periods: periodsForMonths(60) });
    if (span > 12) out.push({ key: 'all', label: i18n.t('dash.range.all'), periods: periodsForMonths(span) + 2 });
    return out;
  };

  /* Same rule as the trend's: a saved range is honoured only while it is still
     on offer, so a vault whose oldest statements are removed cannot sit on an
     All baseline with no pill lit to say so. */
  const splitRange = (ranges = splitRanges()) =>
    ranges.find(r => r.key === plugin.settings.splitCompareRange)
    || ranges.find(r => r.key === '3m')
    || ranges[0];

  /* The comparison baseline: arithmetic from trend-math (compareTotals,
     elapsedDays — see there for the part-period trap this exists to avoid),
     presentation decided here. */
  function compareBaseline() {
    const r = splitRange();
    const days = elapsedDays();
    const core = compareTotals(r.periods, days);
    if (!core) return null;
    /* Below this a move gets no colour whatever proportion it works out to: a
       R40 swing inside a R40 000 month is noise, and colouring noise teaches
       the reader that the colour carries no information — which is what costs
       the R2 000 row its impact. Taken from the period rather than hardcoded,
       so it means the same thing in every currency the plugin formats. */
    const floor = periodSummary(S.period).spend * 0.0025;
    /* The column header is the pill's own wording, not a count derived from it.
       Deriving it printed "12M" above a pill reading "1Y" — the same range
       named two ways a few pixels apart — and there is no wording of "60M" or
       "all of it" that a derived count could have got right at all. */
    return {
      ...core, floor, days,
      label: r.key === '1m' ? i18n.t('dash.split.rPrev') : r.label,
    };
  }

  /* One category's change against the baseline, in RANDS — the same unit as
     every other figure on this card.

     It used to print a percentage above a size threshold and rands below it,
     which put two units in one column with an invisible rule choosing between
     them. The rule was relative to the period's own total, so a category could
     switch unit between months without changing its own behaviour, no row could
     be read against the one above it, and a reader who wanted to know what
     "−39%" cost them had to do the arithmetic themselves. The percentage is not
     lost: the baseline sits in the column immediately to the left, which is
     where the proportion can be seen without being asserted. */
  function compareCell(cat, now, base) {
    /* Nothing in this category anywhere in the window — genuinely new.
       Deliberately NOT the same test as a baseline of zero: a category that
       normally bills on the 20th has a zero baseline on the 9th, and comparing
       against it is a real comparison ("you have spent this already, and you
       usually haven't yet"), not a missing one. */
    if (!(base.full[cat] > 0)) {
      return { baseText: '—', text: i18n.t('dash.split.new'), cls: 'is-new' };
    }
    const avg = (base.totals[cat] || 0) / base.counted;
    /* Both sides rounded BEFORE subtracting, so the change really is the
       difference between the two figures printed beside it. Rounding after
       instead is what let a row read R915 against R636 and call it +R278. */
    const r = v => Number(v.toFixed(0));
    const diff = r(now) - r(avg);
    /* DEADBAND, both ways. A move earns a colour only when it is worth noticing
       as a proportion of what this category usually costs AND worth noticing as
       money. Either test alone mislabels: 3% of a large category is a real sum,
       and 40% of a tiny one is not. */
    const cls = Math.abs(diff) < base.floor || Math.abs(diff) < r(avg) * 0.03
      ? 'is-flat'
      : (diff > 0 ? 'is-up' : 'is-down');
    const text = diff === 0
      ? money(0, 0)
      : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff), 0)}`;
    return { baseText: money(avg, 0), text, cls };
  }

  /* The category-spend rows behind the "Where it went" donut — and, since
     views/report.js reads it too, the ONE place that decides what counts as
     "spend by category" for a period. Same filter the donut has always used
     (income and transfer types dropped, a category that netted positive this
     period is not spending), minus the donut's own colour/slice-collapsing
     concerns, which are display, not arithmetic. Pure of the DOM. */
  function categorySpendRows(p) {
    const sum = periodSummary(p);
    const spend = [];
    for (const [cat, amt] of Object.entries(sum.byCat)) {
      const type = catType(cat);
      if (!cat || type === 'income' || type === 'transfer') continue;
      if (amt >= 0) continue;
      spend.push({ cat, amount: -amt });
    }
    spend.sort((a, b) => b.amount - a.amount);
    return spend;
  }

  function renderSplit() {
    const wrap = $('#dashSplit'); wrap.empty();
    const sum = periodSummary(S.period);

    /* Rebuilt here rather than once at registration, so the active pill follows
       a language change, a range picked on another render, and a vault that has
       just grown past a year of history. */
    const pills = $('#splitRange');
    const ranges = splitRanges();
    if (pills) { pills.empty(); pills.append(rangePills({
      ranges,
      value: splitRange(ranges).key,
      label: i18n.t('dash.split.rangeAria'),
      onPick: async k => {
        plugin.settings.splitCompareRange = k;
        // Same guard as the trend range pills above.
        try {
          await plugin.saveSettings();
        } catch (e) {
          toast(i18n.t('settings.err.save', { error: e.message || e }), true);
        }
        guardedSplit();
      },
    })); }

    /* byCat holds signed amounts and every type. Spending is the negative side
       of the non-income, non-transfer categories — a refund inside a category
       nets off rather than counting as spend, which is what the table does too. */
    const spend = categorySpendRows(S.period).map(x => ({ ...x, color: catColor(x.cat) }));

    const total = spend.reduce((t, x) => t + x.amount, 0);

    /* ------------------ what this donut does NOT show --------------------
       The hero's "Total Spent" counts every outgoing row gross. This donut
       leaves uncategorised rows out entirely — a gap in the data is not a
       place the money went, and it has no colour, no budget and nothing to
       drill into — and it NETS a refund off inside its category, because a
       slice is where money ended up. Both are the right call for a donut and
       both make it smaller than the figure above it, so both have to be said
       out loud or the two disagree with nothing on screen to say why. A reader
       who then categorises nothing watches the number above move on every
       import while the donut below sits still, which is indistinguishable from
       a chart that has stopped updating — and gets reported as one.

       Measured against `spend` rather than derived independently, so the note
       accounts for the WHOLE difference by construction and cannot fall behind
       a change to either figure. It used to state the uncategorised half only,
       and to state it NET: a period holding more uncategorised deposits than
       uncategorised payments nets positive, so the note said nothing at all
       while the two figures sat materially apart. Rounding is the only thing
       left under a currency unit, so that is where it goes quiet. */
    const notShown = Math.max(0, sum.spend - total);
    const uncat = Math.min(sum.uncatSpend || 0, notShown);
    const netted = notShown - uncat;
    const parts = [];
    if (uncat >= 1) parts.push(i18n.t('dash.split.uncatNote', { amount: money(uncat) }));
    if (netted >= 1) parts.push(i18n.t('dash.split.nettedNote', { amount: money(netted) }));
    const gapNote = parts.join('');

    // Was hand-built English plural surgery on the word "category" (an 'y'
    // vs 'ies' suffix chosen by a ternary on spend.length), inside a view
    // that IS translated — every other language rendered the English noun
    // regardless of language setting. dash.split.summary carries the whole
    // sentence per plural form instead.
    $('#dashSplitSub').textContent = (total > 0
      ? i18n.t('dash.split.summary', { amount: money(total), count: spend.length, month: periodMonthName(S.period) })
      : periodMonthName(S.period)) + gapNote;

    if (!total) {
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        uncat > 0
          ? i18n.t('dash.split.onlyUncat', { amount: money(uncat) })
          : i18n.t('dash.split.empty')));
      return;
    }

    /* Everything past the top slices collapses into one wedge. Twenty legend
       rows on a phone is a wall of text, and the tail slivers are too thin to
       point at anyway. */
    const shown = spend.slice(0, SPLIT_SLICES);
    const rest = spend.slice(SPLIT_SLICES);

    /* Category colours are chosen per category with nothing stopping two
       categories sharing one, so the drawn set has to be de-collided before it
       reaches the chart — see distinctColors() in chart.js. `spend` is already
       sorted biggest-first, which is the order that function wants: the largest
       wedge keeps the colour its category file asks for.

       Other's muted grey is RESERVED rather than assigned. It is the one colour
       here that carries a meaning — "this is a bucket, not a category" — so
       nothing may be given a colour near it, and it is never reassigned. */
    const otherColor = themeColors(root).muted;
    const resolved = distinctColors(shown.map(x => x.color), { reserved: [otherColor] });
    shown.forEach((x, i) => { x.color = resolved[i]; });

    if (rest.length) {
      shown.push({
        cat: `Other (${rest.length})`,
        amount: rest.reduce((t, x) => t + x.amount, 0),
        color: otherColor,
        other: true,
      });
    }

    /* Computed ONCE and indexed everywhere below — the aria-label, each
       wedge's tooltip and the legend's % column all read the same array, so
       the three can never disagree with each other the way three independent
       Math.round() calls on the same slice occasionally did. */
    const shares = sharePercents(shown.map(x => x.amount));
    /* The legend's money column, allocated the same way as its percentage
       column just above rather than left to `money(x.amount, 0)` rounding
       each row alone. Independent rounding is exactly the trap sharePercents
       exists to close for the % column — six equal sixths, three equal
       thirds, [50,25,12.5,12.5] — and it is just as real in rand: four rows
       rounding up by 50c apiece is R2 sitting in the legend that the centre
       total (money(total, 0), a single rounding of the true sum) does not
       carry. `shown` amounts already sum to `total` exactly (the trailing
       "Other" bucket is `rest`'s own sum), so floor(each) can never exceed
       Math.round(total) — the contract largestRemainder's other two callers
       (money-flow.js, health-math.js) already rely on. */
    const rowMoney = largestRemainder(shown.map(x => x.amount), Math.round(total));

    const W = 320, H = 320, cx = W / 2, cy = H / 2, rOut = 140, rIn = 88;
    const { svg, add } = createChart({
      w: W, h: H, cls: 'donut',
      label: i18n.t('dash.split.aria', { month: periodMonthName(S.period) }) +
        shown.map((x, i) => `${x.cat} ${shares[i]}%`).join(', '),
    });

    let a = -Math.PI / 2;                      // 12 o'clock, so the largest slice starts at the top
    shown.forEach((x, i) => {
      const sweep = (x.amount / total) * Math.PI * 2;
      const seg = add('path', {
        d: arcPath(cx, cy, rOut, rIn, a, a + sweep),
        fill: x.color, stroke: themeColors(root).hole, 'stroke-width': '2',
        class: x.other ? null : 'donut-slice',
      });
      tip(add, seg, `${x.cat}: ${money(x.amount)} · ${shares[i]}%`);
      /* Pointer only, deliberately: the <svg> is role="img", which takes its
         whole subtree out of the accessibility tree, so a focusable wedge would
         be a tab stop no screen reader can announce. The legend below carries
         the same two actions as real buttons — that is the keyboard and AT
         path, and the wedge is the convenience one for a mouse or thumb. */
      if (!x.other) seg.addEventListener('click', () => openCategory(x.cat));
      a += sweep;
    });

    /* NOT "Total spent" — that is the hero tile's gross figure, on the same
       screen. This number is categorised spend with refunds netted off inside
       their category (the subtitle above already discloses that gap exactly;
       see `gapNote`), which is a materially smaller and different figure. */
    add('text', {
      x: cx, y: cy - 6, 'text-anchor': 'middle', 'font-size': '13',
      fill: 'currentColor', 'fill-opacity': '0.5', 'font-family': 'inherit',
    }).textContent = i18n.t('dash.split.centerLabel');
    add('text', {
      x: cx, y: cy + 22, 'text-anchor': 'middle', 'font-size': '26', 'font-weight': '700',
      fill: 'currentColor', 'font-family': 'inherit',
    }).textContent = money(total, 0);

    /* What this period is measured AGAINST. Averaged over COMPLETED periods
       only — folding the running period into its own baseline makes every
       category read green for the first three weeks of every period, because a
       part-period is being compared with full ones. That figure would be
       reassuring, wrong, and wrong in the direction that stops people looking. */
    const base = compareBaseline();

    /* The figure the compare column reads for THIS period, windowed to match
       the baseline exactly — the baseline (compareTotals, in trend-math.js)
       already caps each earlier period at `elapsedDays()` of itself, but this
       side was still reading `x.amount`, the WHOLE period's spend including
       rows dated ahead of today. reconcile.js documents statements routinely
       carrying such rows. Two windows on one comparison is not like-for-like
       even though the column is labelled that way (see dash.split.likeForLike
       below): an Insurance debit dated the 28th, viewed on the 24th, was
       counted on the "now" side and excluded from every earlier period it was
       measured against, so the legend reported a swing that had not happened
       in either period.

       Only while the period is running (`base.days !== null`) — a finished
       period has no "ahead of today" rows left to over-count, and periodSpend
       with a null cap is exactly x.amount again, so nothing changes there. */
    const nowByCat = base && base.days !== null ? periodSpend(S.period, base.days).part : null;

    const legend = el('ul', { class: 'donut-legend donut-legend--linked' });
    if (base) legend.append(el('li', { class: 'donut-legend-head' },
      el('i', { style: 'background:transparent' }),
      el('span', { class: 'dl-name' }, i18n.t('dash.split.colCat')),
      el('span', { class: 'dl-val' }, i18n.t('dash.split.colSpent')),
      el('span', { class: 'dl-pct' }, '%'),
      el('span', { class: 'dl-base' }, base.label),
      el('span', { class: 'dl-delta' }, i18n.t('dash.split.colChange'))));
    shown.forEach((x, i) => {
      const pct = shares[i];
      /* Rebuilt per row rather than shared: these are appended into either a
         plain <li> or a <button>, and a node can only live in one of them. */
      /* "Other" gets no comparison: it is a bucket whose membership changes
         between periods, so its average measures a different set of categories
         each time. A change figure there would be arithmetic without meaning —
         the same reason the row has no drill-through. */
      const cmp = base && !x.other
        ? compareCell(x.cat, nowByCat ? (nowByCat[x.cat] || 0) : x.amount, base)
        : null;
      const face = () => [
        el('i', { style: `background:${x.color}` }),
        el('span', { class: 'dl-name' }, x.cat),
        el('span', { class: 'dl-val num' }, money(rowMoney[i], 0)),
        el('span', { class: 'dl-pct num' }, `${pct}%`),
        ...(base ? [
          el('span', { class: 'dl-base num' }, cmp ? cmp.baseText : '—'),
          el('span', { class: `dl-delta num ${cmp ? cmp.cls : 'is-flat'}` }, cmp ? cmp.text : '—'),
        ] : []),
      ];
      /* "Other" is a bucket of categories, so neither action has a single
         target to point at — it stays an inert row. */
      if (x.other) { legend.append(el('li', {}, face())); return; }
      legend.append(el('li', {},
        /* aria-label rather than the row's own text: read as-is a screen
           reader gets "Groceries 4 200 32", three unlabelled fragments. */
        el('button', {
          type: 'button', class: 'dl-link',
          'aria-label': i18n.t('dash.split.sliceAria', { cat: x.cat, amount: money(x.amount), pct }),
          onclick: () => openCategory(x.cat),
        }, face()),
        el('button', {
          type: 'button', class: 'dl-note',
          'aria-label': i18n.t('dash.split.noteAria', { cat: x.cat }),
          title: 'Open category note',
          onclick: () => openCategoryFile(x.cat),
          /* An ARRAY, not the 'a|b' string the shell's data-ico attributes
             use — icoEl walks a list, and only controller.js splits on the
             pipe. Passed as a string the whole thing is treated as one icon
             name, setIcon silently draws nothing, and the button ships empty. */
        }, icoEl(['file-text', 'file']))));
    });
    wrap.append(svg, legend);

    /* Say out loud that the baseline is a part-month, because the column no
       longer reads as a typical one and a reader who assumed it did would think
       their spending had collapsed. Only while the period is running: once it
       is complete the two columns compare whole periods and there is nothing
       left to explain. */
    if (base && base.days !== null) {
      wrap.append(el('p', { class: 'donut-note' },
        i18n.t('dash.split.likeForLike', { count: base.days, range: base.label })));
    }
  }

  /* ---------------------- category drill-through ------------------------
     Jump to Transactions filtered to this category. switchView renders the
     view first, which is what rebuilds the category <select>'s options — so
     the name is on the list by the time it is selected. Mirrors the Accounts
     page's openTransactions(), for the same reasons.

     The other filters are cleared because a search or account left over from
     an earlier visit would land the reader on "0 rows" with nothing visible to
     explain it. `whole history` goes too, and that one matters more here than
     it does on Accounts: this donut is explicitly one period's spending, and
     leaving the box ticked answers a question the reader did not ask. */
  function openCategory(cat) {
    ctx.switchView('transactions');
    const sel = $('#txCategory');
    if ([...sel.options].some(o => o.value === cat)) sel.value = cat;
    $('#txAccount').value = '';
    $('#txSearch').value = '';
    $('#txWholeHistory').checked = false;
    ctx.renderTransactions();
  }

  /* The hero's uncategorised-count drill-through — same shape as
     openCategory() just above, with the '__none__' sentinel value
     shell.js's static "Uncategorised" <option> and transactions.js's own
     filter (`cat === '__none__' ? !t.cat : t.cat === cat`) already both
     understand, so no new filter vocabulary is introduced here. Unlike
     openCategory this option always exists — it ships in the shell's static
     markup rather than being rebuilt per category — so there is no list to
     check membership against first. */
  function openUncategorised() {
    ctx.switchView('transactions');
    $('#txCategory').value = '__none__';
    $('#txAccount').value = '';
    $('#txSearch').value = '';
    $('#txWholeHistory').checked = false;
    ctx.renderTransactions();
  }

  /* Open the category's own note — where its colour, type and notes live.
     The filename is the sanitised name (safeSeg), but files made by hand or by
     an older build may sit under the raw name, so both are tried before giving
     up. A new tab, not this one: the budget view is a workspace leaf like any
     other, and opening in place would close the app the reader is using. */
  async function openCategoryFile(cat) {
    const file = fileAt(`Categories/${safeSeg(cat)}.md`) || fileAt(`Categories/${cat}.md`);
    if (!file) return toast(i18n.t('dash.split.noteMissing', { cat }), true);
    await app.workspace.getLeaf('tab').openFile(file);
  }

  /* The guarded wrappers, not the raw ones: applyTheme() calls both of these
     directly on a theme flip, and an unguarded throw there freezes the same
     two cards this module just took care to isolate. */
  /* budgetVsActualRows / categorySpendRows: published so views/report.js can
     build its Budget-vs-Actual and Where-it-went sections off the exact same
     per-category arithmetic this page draws — never a second copy of either
     filter. */
  /* `unreadableNote` is published for the same reason budgetVsActualRows is:
     it is a RULE, not a rendering, and the next surface that prints an
     implied balance must reach the one sentence rather than mint a second.
     views/report.js is the obvious candidate and does not need it today —
     its Net Worth section is built from worth(), which reads stated balances
     and never calls reconcile(). */
  ctx.provide({ renderDashboard, renderTrend: guardedTrend, renderSplit: guardedSplit, budgetVsActualRows, categorySpendRows, unreadableNote });
};

/* Exposed for a direct, DOM-free unit test of the rounding algorithm itself —
   the six-equal / three-equal / exact-tie / single-slice / zero-slice cases
   in tests/donut-percentages.test.cjs. The full render is covered separately
   (aria-label and legend text) so a wiring bug that stops the view from
   USING this function is caught even if the function itself is correct. */
module.exports.sharePercents = sharePercents;
