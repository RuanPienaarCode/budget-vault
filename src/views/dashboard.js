'use strict';
/* Dashboard — hero card, spending-trend SVG, category split, budget-vs-actual. */

const { el, icoEl } = require('../dom');
const { safeSeg } = require('../vault-path');
const { TYPE_ORDER } = require('../constants');
/* Namespace import: this file binds `t` as a local (`const t = $('#dashBudget')`). */
const i18n = require('../i18n');
const { stalenessSummary, reconcile, isStale } = require('../reconcile');
const { whatsLeft } = require('../committed');
const { todayIso, isoDayNumber, isoFromDayNumber } = require('../dates');
const { worth, cardOverlap } = require('../worth');
const { owedSummary } = require('../owed-math');
const {
  themeColors, createChart, scales, gridlines, axisLabels,
  linePath, areaPath, areaGradient, arcPath, tip, trackPoints, distinctColors,
  historicalRanges, rangeFor, rangePills,
} = require('../chart');

/* Largest-remainder (Hare quota) allocation for a column of percentages that
   must sum to exactly 100 — independent `Math.round()` per slice does not: six
   equal sixths print 17 six times (102%), three equal thirds print 33 three
   times (99%), and [50,25,12.5,12.5] prints 50,25,13,13 (101%). The same
   rounded set is what gets concatenated into the donut's aria-label, so for a
   screen-reader user the gap is not cosmetic — it is the only reading of the
   chart they get.

   Each slice keeps its floor and the leftover whole points go to the slices
   with the largest fractional remainder, biggest first. Ties are broken by
   ORIGINAL INDEX rather than by trusting `Array.prototype.sort` to stay
   stable across a future refactor, so two equal slices resolve the same way
   on every render — a screen reader announcing the same chart twice must
   hear the same numbers twice. */
function sharePercents(amounts) {
  const total = amounts.reduce((s, v) => s + v, 0);
  if (total <= 0) return amounts.map(() => 0);
  const floors = amounts.map(v => Math.floor((v / total) * 100));
  const remainders = amounts
    .map((v, i) => ({ i, frac: (v / total) * 100 - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let left = 100 - floors.reduce((s, v) => s + v, 0);
  const pct = floors.slice();
  for (let k = 0; k < remainders.length && left > 0; k++, left--) pct[remainders[k].i]++;
  return pct;
}

module.exports = function registerDashboard(ctx) {
  const { S, $, app, root, plugin, money, toast, fileAt, periodSummary, budgetTotals, periodTitle, periodMonthName, periodShortLabel, dayLabel, periodRange, shiftPeriod, currentPeriod, txInPeriod, nonBudgetLabels, catType, accountIndex } = ctx;

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
    const accounts = S.accounts.map(a => {
      const rows = (idx.get(a) || {}).rows || [];
      const rec = reconcile(a, rows);
      return {
        name: a.name,
        inBudget: a.in_budget !== false,
        dated: rec.state !== 'no-date',
        implied: rec.state === 'drift' ? rec.implied : a.balance,
        /* Rule 7 and the owed line are decided inside committed.js, not here —
           this only hands over what they need to decide with. */
        type: a.type,
        settleMonthly: !!a.settle_monthly,
        settleDay: a.settle_day || 0,
        institution: a.institution || '',
      };
    });

    const rows = [];
    /* A second list, in-budget accounts only, for the repeating-credit search.
       A fund's monthly debit order is a CREDIT on that fund's own statement, and
       predicting it as household income would announce money arriving when it is
       only moving between the reader's own pockets. */
    const skipLabels = nonBudgetLabels();
    /* And a third, for the settle-monthly cards only: their spending this cycle
       is what gets measured against the income that clears it. Resolved by
       LABEL because rows carry no account of their own. */
    const cardLabels = new Set(S.accounts
      .filter(a => a.settle_monthly && String(a.type || '').trim().toLowerCase() === 'credit_card')
      .map(a => a.tx_label || a.name));
    const incomeRows = [], cardRows = [];
    for (const f of Object.values(S.txFiles)) {
      for (const r of f.rows) {
        rows.push(r);
        if (!skipLabels.has(f.label)) incomeRows.push(r);
        if (cardLabels.has(f.label)) cardRows.push(r);
      }
    }

    const L = whatsLeft({
      accounts, services: S.services, debts: S.debts, rows, incomeRows, cardRows,
      periodStart: start, periodEnd: end, today: todayIso(),
    });

    /* Nothing to say: no confirmed cash AND nothing scheduled. classList, not
       Obsidian's addClass/removeClass — those are host extensions to
       HTMLElement, and every other card here toggles the plain way. */
    const nothing = !L.cashKnown && !L.items.length && !L.owed;
    if (card) card.classList.toggle('hidden', nothing);
    if (nothing) return;

    const sub = $('#leftSub');
    if (sub) sub.textContent = i18n.t('dash.left.sub', { date: dayLabel(end) });

    const fig = (cls, value, label, meta) => el('div', { class: `left-fig ${cls}` },
      el('div', { class: 'lv num' }, value),
      el('div', { class: 'll' }, label),
      meta ? el('div', { class: 'lm' }, meta) : '');

    /* Three independent facts about the cash figure, each only shown when it
       has something to say: how many accounts it counted, how many of those
       carry a balance nobody has confirmed lately, and how many could not be
       counted at all because their balance has no date to measure from. */
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
    const op = () => el('div', { class: 'left-op', 'aria-hidden': 'true' }, '−');
    const grid = el('div', { class: `left-grid${showCardTerm ? ' left-grid--card' : ''}` },
      fig('is-cash', L.cashKnown ? money(L.cash, 0) : '—',
        i18n.t('dash.left.cash'), cashParts.join(' · ')),
      op(),
      fig('is-committed', money(L.committedOther, 0),
        i18n.t('dash.left.committed'), comParts.join(' · ') || i18n.t('dash.left.none')));
    if (showCardTerm) {
      grid.append(op(), fig('is-card', money(L.cardDue, 0),
        i18n.t('dash.left.cardDue'),
        L.counts.card === 1 ? L.owedCards[0] || '' : i18n.t('dash.left.cards', { count: L.counts.card })));
    }
    /* With the settled card out of the chain, `free` comes out of it too —
       committed.js already accounts for that (see the settlement-cycle
       comment there), so this reads straight off L.free/L.short rather than
       recomputing a second figure the view could drift out of step with. The
       per-day rate, the "short/covered" sentence below and the bar's
       aria-label all read the SAME L.free for exactly that reason. */
    grid.append(el('div', { class: 'left-op', 'aria-hidden': 'true' }, '='),
      /* "Short", never a negative amount of free money — a minus sign in front
         of a figure labelled "actually free" is a sentence that means nothing. */
      fig(L.short ? 'is-short' : 'is-free', money(Math.abs(L.free), 0),
        i18n.t(L.short ? 'dash.left.short' : 'dash.left.free'), freeParts.join(' · ')));
    body.append(grid);

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
      const after = L.free + L.incoming.amount;
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

    /* The bar only means something when there is cash to divide. */
    if (L.cashKnown && L.cash > 0) {
      const comPct = Math.min(100, (L.committed / L.cash) * 100);
      body.append(el('div', {
        class: 'left-bar', role: 'img',
        'aria-label': i18n.t('dash.left.barAria', {
          cash: money(L.cash), committed: money(L.committed), free: money(Math.abs(L.free)),
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
    /* Only for a card NOT already in the chain. A card marked `settle_monthly`
       is subtracted above as its own term, and repeating the same figure here
       as "not taken off any figure above" would flatly contradict the column
       that just took it off. The sentence exists for the other case — a card
       whose balance cannot be placed in this period, so it is disclosed rather
       than claimed. */
    if (L.owed > 0 && L.cardDue === 0) {
      const line = L.owedCards.length === 1
        ? i18n.t('dash.left.owedCard', { amount: money(L.owed, 0), name: L.owedCards[0] })
        : i18n.t('dash.left.owedCards', { amount: money(L.owed, 0), count: L.owedCards.length });
      body.append(el('div', { class: 'kpi-caveat-txt left-owed' },
        icoEl(['info', 'alert-circle']), line));
    }

    /* The disclosure is part of the feature, not a courtesy. A card asserting a
       committed figure with no way to check it is the Services page again — a
       number nobody could audit, on a page that quietly died of it. */
    if (L.items.length) {
      const list = el('table', { class: 'left-disc' });
      for (const it of L.items) {
        const when = it.due
          ? i18n.t('dash.left.expected', { date: it.due })
          : i18n.t('dash.left.thisPeriod');
        const src = it.basis === 'charged' ? i18n.t('dash.left.lastCharged', { amount: money(it.amount, 0) })
          : it.basis === 'stated' ? i18n.t('dash.left.asListed')
            : it.basis === 'settled' ? i18n.t('dash.left.settledInFull')
              : i18n.t('dash.left.contracted');
        list.append(el('tr', {},
          el('td', {}, el('div', { class: 'dn' }, it.name),
            el('div', { class: 'dd' }, [it.detail, when, src].filter(Boolean).join(' · '))),
          el('td', { class: 'da num' }, money(it.amount, 0))));
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
  const balanceOf = type => S.accounts.filter(a => a.type === type)
    .reduce((t, a) => t + (a.balance || 0), 0);

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

    const w = worth(S.accounts, S.debts, S.assets);
    const owed = owedSummary(S.owed);
    const savings = balanceOf('savings');
    const invest = balanceOf('investment');

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
      sub: i18n.t('dash.pos.netWorthSub', { owned: money(w.assets, 0), owed: money(w.liabilities, 0) }),
      view: 'savings',
      say: i18n.t('dash.pos.netWorthSay', { net: money(w.net), owned: money(w.assets), owed: money(w.liabilities) }),
    });

    /* Negated for display, like the Savings page's Debt tile, and split by
       ledger for the same reason it is there: an overdrawn cheque account and a
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
    posTile(grid, {
      label: i18n.t('dash.pos.debt'), value: money(-w.liabilities, 0),
      cls: w.liabilities > 0 ? 'text-danger' : '',
      sub: w.fromDebts && w.fromAccounts
        ? i18n.t('dash.pos.debtSplit', { accounts: money(w.fromAccounts, 0), debts: money(w.fromDebts, 0) })
        : w.fromDebts > 0 ? i18n.t('dash.pos.debtActive', { count: w.active.length })
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
      sub: i18n.t('dash.pos.savingsSub', { savings: money(savings, 0), invested: money(invest, 0) }),
      view: 'savings',
      say: i18n.t('dash.pos.savingsSay', { amount: money(savings + invest) }),
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
    const idx = accountIndex();
    let drift = 0;
    for (const a of S.accounts) {
      const rec = reconcile(a, (idx.get(a) || {}).rows || []);
      if (rec.state === 'drift') drift += rec.delta;
    }
    /* Below a whole currency unit there is nothing to report but rounding. */
    const driftNote = Math.abs(drift) >= 1
      ? i18n.t(drift > 0 ? 'dash.stale.driftUp' : 'dash.stale.driftDown', { amount: money(Math.abs(drift), 0) })
      : '';
    wrap.append(el('div', { class: 'kpi-caveat-txt' }, icoEl(['info', 'alert-circle']),
      i18n.t('dash.stale.line', { line, age }) + driftNote));
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
    const available = bud.spend - sum.spend;
    const heroNegative = available < 0;
    const meterMax = Math.max(sum.spend, bud.spend, 1);
    const fillPct = Math.min(100, (sum.spend / meterMax) * 100).toFixed(2);
    const markPct = bud.spend > 0 ? ((bud.spend / meterMax) * 100).toFixed(2) : null;
    /* Against the income the BUDGET states, not the income that happens to have
       landed so far.

       A running period's actual income is a part-month figure, so dividing a
       whole period's budget by it says nothing about the budget and everything
       about today's date. On this vault a R255 invoice arriving before the
       salary would have printed "19252% allocated" — and it read as a settled
       fact, because nothing in the line says which day it was measured on. The
       budgeted figure is the same on day 1 as on day 31, which is what a
       percentage of an intention should be.

       Actual income stands in only where the budget names none AND the period
       is FINISHED, where it is a whole figure and no longer moves. A running
       period with no income budgeted has no honest denominator at all, so it
       gets no percentage — the same choice perDay makes on the last day of a
       period, and budgetMark makes for a period nobody budgeted for. Five of
       this vault's eight budget files carry no income row, so this branch is
       the normal one, not the corner. */
    const incomeBase = bud.income > 0 ? bud.income
      : (S.period === currentPeriod() ? 0 : sum.income);
    const budgetedPct = incomeBase > 0 ? Math.round((bud.spend / incomeBase) * 100) : null;
    const usedPct = bud.spend > 0 ? Math.round((sum.spend / bud.spend) * 100) : null;

    const hero = $('#heroCard'); hero.empty();
    const cur = S.settings.currency;
    const heroNum = el('div', { class: `hero-num${heroNegative ? ' hero-num--negative' : ''}` },
      el('small', {}, cur), money(Math.abs(available), 0).slice(cur.length + 1));
    const meter = el('div', { class: `hero-meter${heroNegative ? ' over' : ''}` },
      el('i', { style: `width:${fillPct}%` }));
    if (markPct !== null) meter.append(el('span', { class: 'hero-mark', style: `left:${markPct}%`, 'aria-hidden': 'true' }));
    const statCol = el('div', { class: 'stat-col' },
      el('div', { class: 'stat' },
        el('div', {}, el('div', { class: 'sl' }, i18n.t('dash.stat.income'))),
        el('div', {}, el('div', { class: 'sv grad-txt' }, money(sum.income)))),
      el('div', { class: 'stat' },
        el('div', {}, el('div', { class: 'sl' }, i18n.t('dash.stat.budgeted'))),
        el('div', {}, el('div', { class: 'sv' }, money(bud.spend)),
          budgetedPct !== null ? el('div', { class: 'st' }, i18n.t('dash.stat.allocated', { pct: budgetedPct })) : '')),
      el('div', { class: 'stat' },
        el('div', {}, el('div', { class: 'sl' }, i18n.t('dash.stat.spent'))),
        el('div', {}, el('div', { class: 'sv' }, money(sum.spend)),
          usedPct !== null ? el('div', { class: 'st' }, el('span', { class: 'tag warn' }, i18n.t('dash.stat.used', { pct: usedPct }))) : '')));
    if (sum.uncategorised > 0) statCol.append(
      el('div', { class: 'stat' },
        el('div', {}, el('div', { class: 'sl' }, i18n.t('dash.stat.uncategorised'))),
        el('div', {}, el('div', { class: 'sv', style: 'color: var(--color-warning)' }, String(sum.uncategorised)),
          el('div', { class: 'st' }, i18n.t('dash.stat.review')))));
    const hour = new Date().getHours();
    const greeting = i18n.t(hour < 5 ? 'dash.greet.evening' : hour < 12 ? 'dash.greet.morning' : hour < 18 ? 'dash.greet.afternoon' : 'dash.greet.evening');
    hero.append(el('div', { class: 'hero-grid' },
      el('div', {},
        S.settings.household ? el('div', { class: 'hero-greet' }, i18n.t('dash.greet.line', { greeting, name: S.settings.household })) : '',
        el('div', { class: 'hero-lbl' }, i18n.t(heroNegative ? 'dash.hero.overspent' : 'dash.hero.remaining')),
        heroNum,
        el('div', { class: 'hero-sub' }, i18n.t('dash.hero.sub', { spent: money(sum.spend), budgeted: money(bud.spend) })),
        meter),
      statCol));
  }

  function renderBudgetTable() {
    const sum = periodSummary(S.period);
    const t = $('#dashBudget'); t.empty();
    $('#dashBudgetSub').textContent = `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, i18n.t('dash.col.category')), el('th', { scope: 'col', class: 'num' }, i18n.t('dash.col.budget')), el('th', { scope: 'col', class: 'num' }, i18n.t('dash.col.spent')),
      el('th', { scope: 'col', style: 'width:26%' }, ''), el('th', { scope: 'col', class: 'num' }, i18n.t('dash.col.remaining')))));
    const body = el('tbody', {});
    const budget = S.budgets[S.period] || [];
    const rows = new Map();
    for (const b of budget) rows.set(b.category, { budget: b.amount, type: b.type, actual: 0, notes: b.notes });
    for (const [cat, amt] of Object.entries(sum.byCat)) {
      if (!cat) continue;
      const type = catType(cat);
      if (type === 'transfer') continue;
      const r = rows.get(cat) || rows.set(cat, { budget: 0, type: type || 'expense', actual: 0, notes: '' }).get(cat);
      r.actual += type === 'income' ? amt : -amt;
    }
    const sorted = [...rows.entries()].sort((a, b) =>
      TYPE_ORDER.indexOf(a[1].type) - TYPE_ORDER.indexOf(b[1].type) || a[0].localeCompare(b[0]));
    let lastType = null;
    for (const [cat, r] of sorted) {
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
      const unbudgeted = r.type !== 'income' && !r.budget && r.actual > 0;
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
     How many periods a calendar-month range covers. A period is a pay cycle,
     which may be a week or a fortnight, so "6M" is 6 points on a monthly cycle
     and ~26 on a weekly one — the range names a span of time, not a count of
     columns. */
  function periodsForMonths(months) {
    const days = Number(S.settings.period_days) || 0;
    if (!days) return months;
    return Math.max(2, Math.round((months * 30.44) / days));
  }

  /* The earliest month any transaction actually lands in. The trend can only
     honestly reach back this far: periods before it are not "months you spent
     nothing", they are months that were never imported, and drawing them as
     zeroes invents a history of frugality that did not happen. */
  function earliestDataMonth() {
    let min = null;
    for (const f of Object.values(S.txFiles)) {
      if (!f.rows || !f.rows.length) continue;
      if (min === null || f.month < min) min = f.month;
    }
    return min;
  }

  /* Periods to plot, oldest first — `want` of them at most, fewer if the data
     runs out. The current period is always included even when it is empty,
     because a chart that silently drops "now" reads as broken. */
  function trendPeriods(want) {
    const earliest = earliestDataMonth();
    const out = [];
    for (let i = 0; i < want; i++) {
      const p = shiftPeriod(S.period, -i);
      if (earliest && i > 0 && periodRange(p).end.slice(0, 7) < earliest) break;
      out.push(p);
    }
    return out.reverse();
  }

  /* Calendar months of history the vault actually holds, counting the month on
     screen. This is what decides whether a long range is worth offering at all:
     the pills describe the data, not a fixed menu the data has to live up to. */
  function historySpan() {
    const earliest = earliestDataMonth();
    if (!earliest) return 0;
    const now = periodRange(S.period).end.slice(0, 7);
    if (now < earliest) return 0;
    const [ey, em] = earliest.split('-').map(Number);
    const [ny, nm] = now.split('-').map(Number);
    return (ny - ey) * 12 + (nm - em) + 1;
  }

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
      return { p, spent: sum.spend, income: sum.income, budget: budgetTotals(p).spend, label: periodShortLabel(p) };
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
        await plugin.saveSettings();
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
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        i18n.t('dash.trend.empty')));
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

    const spentPts = data.map((d, i) => [s.x(i), s.y(d.spent)]);
    add('path', { d: areaPath(spentPts, s.baseline), fill });

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
       to it. */
    add('path', {
      d: linePath(data.map((d, i) => [s.x(i), s.y(d.income)])),
      fill: 'none', stroke: c.info, 'stroke-opacity': '0.85',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });

    /* Segment by segment rather than one polyline, so a period that broke its
       budget colours only the legs touching it. Kept in a list so the two legs
       touching a focused point can thicken without the rest of the line
       moving — see focusAt below. */
    const segs = [];
    for (let i = 1; i < data.length; i++) {
      segs.push(add('line', {
        class: 'trend-seg',
        x1: s.x(i - 1), y1: s.y(data[i - 1].spent), x2: s.x(i), y2: s.y(data[i].spent),
        stroke: over(data[i - 1]) || over(data[i]) ? c.danger : c.success,
        'stroke-width': '2.5', 'stroke-linecap': 'round',
      }));
    }

    /* Past a dozen points the dots merge into a bead chain and stop being
       readable — a year of weekly periods is 52 of them. The line carries the
       shape on its own from there, and the focus marks below still land on
       every period whether or not it wears a dot. */
    if (data.length <= 12) {
      data.forEach((d, i) => add('circle', {
        cx: s.x(i), cy: s.y(d.spent), r: '5',
        fill: c.hole, stroke: over(d) ? c.danger : c.success, 'stroke-width': '2.5',
      }));
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
      spentMark.setAttribute('cx', x); spentMark.setAttribute('cy', y);
      spentMark.setAttribute('stroke', key);
      incomeMark.setAttribute('cx', x); incomeMark.setAttribute('cy', s.y(d.income));
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
      rSpent.val.textContent = money(d.spent);
      rSpent.swatch.classList.toggle('is-over', bad);
      rIncome.val.textContent = money(d.income);
      rBudget.val.textContent = money(d.budget);
      rBudget.node.classList.toggle('hidden', !(d.budget > 0));
      const gap = d.budget - d.spent;
      tipDelta.textContent = d.budget > 0
        ? i18n.t(bad ? 'dash.trend.tip.over' : 'dash.trend.tip.under', { amount: money(Math.abs(gap)) })
        : '';
      tipDelta.classList.toggle('is-over', bad);

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
        tip(add, hit, `${d.label} — `
          + `${i18n.t('shell.legend.spent')} ${money(d.spent)}`
          + ` · ${i18n.t('shell.legend.budget')} ${money(d.budget)}`
          + ` · ${i18n.t('shell.legend.income')} ${money(d.income)}`);
      });
    }

    axisLabels(add, s, data.map(d => d.label), H);
    wrap.append(svg, tipBox);
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

     `periods` really is periods here, not months. This card averages PAY
     CYCLES — on a weekly cycle "3M" has always meant the three cycles before
     this one — so the fixed entries stay literal counts and only All, which
     means "as far back as the vault goes", is converted from the span. */
  const splitRanges = () => {
    const span = historySpan();
    const out = [
      { key: '1m', label: i18n.t('dash.split.r1m'), periods: 1 },
      { key: '3m', label: '3M', periods: 3 },
      { key: '6m', label: '6M', periods: 6 },
      { key: '1y', label: '1Y', periods: 12 },
    ];
    if (span > 60) out.push({ key: '5y', label: '5Y', periods: 60 });
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

  /* How much of the period ON SCREEN has actually happened yet, or null when it
     is finished and the question does not arise.

     This is the number the comparison column was missing. Nine days of August
     were being measured against three whole Julys: every category that bills
     late in the month showed a large green fall, every category that bills on
     the 1st showed a rise, and both figures were reporting nothing but today's
     date. The card said spending was down 39% on food in a month that had
     barely started. Same trap monthlyIncome() already sidesteps in period.js —
     a part-period cannot be read against whole ones.

     The last day of a running period counts as complete: by then the capped
     window IS the whole period, so there is nothing left to explain. */
  function elapsedDays() {
    if (S.period !== currentPeriod()) return null;
    const { start, end } = periodRange(S.period);
    const today = todayIso();
    if (today >= end) return null;
    return Math.max(1, isoDayNumber(today) - isoDayNumber(start) + 1);
  }

  /* Spend per category for one period, twice over: the whole period, and only
     its first `days` (which is the same thing when days is null, or when the
     window runs past the period's own end — a 31-day month compared against a
     30-day one caps at 30).

     Filtering mirrors periodSummary() exactly — the per-row veto, the
     per-account one, transfers dropped, income dropped, and NET per category so
     a refund nets off rather than counting as spend. A baseline built by
     different rules than the figure it is subtracted from is not a comparison.

     `count` deliberately ignores the cap. It answers "does the vault cover this
     period at all", and a month whose data starts on the 20th still happened —
     counting only the capped rows would drop it from the average entirely. */
  function periodSpend(p, days) {
    const skip = nonBudgetLabels();
    let cut = null;
    if (days !== null) {
      const { start, end } = periodRange(p);
      const c = isoFromDayNumber(isoDayNumber(start) + days - 1);
      if (c < end) cut = c;
    }
    const net = {}, netPart = {};
    let count = 0;
    for (const t of txInPeriod(p)) {
      if (t.excluded || skip.has(t.label)) continue;
      count++;
      if (catType(t.cat) === 'transfer') continue;
      const k = t.cat || '';
      net[k] = (net[k] || 0) + t.amount;
      if (!cut || t.date <= cut) netPart[k] = (netPart[k] || 0) + t.amount;
    }
    const spendOf = m => {
      const out = {};
      for (const [cat, amt] of Object.entries(m)) {
        const type = catType(cat);
        if (!cat || type === 'income' || type === 'transfer' || amt >= 0) continue;
        out[cat] = -amt;
      }
      return out;
    };
    return { count, whole: spendOf(net), part: spendOf(netPart) };
  }

  /* Spend per category, averaged over the N periods BEFORE the one on screen.
     Returns null when there is not a single completed period to compare with —
     a first-month vault gets the donut it has always had rather than a column
     of "new" against nothing.

     TWO totals, because they answer different questions. `totals` is the
     like-for-like baseline the change column subtracts from, measured over the
     same elapsed window as the period on screen. `full` is the whole of each
     period, and its only job is deciding whether a category is genuinely NEW or
     has merely not billed yet this month — without it, every category that
     charges after the 9th would be announced as new for the first week of
     every period. */
  function compareBaseline() {
    const r = splitRange();
    const days = elapsedDays();
    const totals = {}, full = {};
    let counted = 0;
    for (let i = 1; i <= r.periods; i++) {
      const p = shiftPeriod(S.period, -i);
      const sum = periodSpend(p, days);
      /* A period with no transactions at all is not a zero-spend period, it is
         a period the vault does not cover — averaging it in would halve every
         figure for every month before the data starts. */
      if (!sum.count) continue;
      counted++;
      for (const [cat, amt] of Object.entries(sum.whole)) full[cat] = (full[cat] || 0) + amt;
      for (const [cat, amt] of Object.entries(sum.part)) totals[cat] = (totals[cat] || 0) + amt;
    }
    if (!counted) return null;
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
      totals, full, counted, floor, days,
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
        await plugin.saveSettings();
        guardedSplit();
      },
    })); }

    /* byCat holds signed amounts and every type. Spending is the negative side
       of the non-income, non-transfer categories — a refund inside a category
       nets off rather than counting as spend, which is what the table does too. */
    const spend = [];
    for (const [cat, amt] of Object.entries(sum.byCat)) {
      const type = catType(cat);
      if (!cat || type === 'income' || type === 'transfer') continue;
      if (amt >= 0) continue;
      spend.push({ cat, amount: -amt, color: catColor(cat) });
    }
    spend.sort((a, b) => b.amount - a.amount);

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
       and to state it NET: a period holding R16 895 of uncategorised payments
       against R21 440 of uncategorised deposits nets positive, so the note said
       nothing at all while the two figures sat R17 195 apart. Rounding is the
       only thing left under a currency unit, so that is where it goes quiet. */
    const notShown = Math.max(0, sum.spend - total);
    const uncat = Math.min(sum.uncatSpend || 0, notShown);
    const netted = notShown - uncat;
    const parts = [];
    if (uncat >= 1) parts.push(i18n.t('dash.split.uncatNote', { amount: money(uncat) }));
    if (netted >= 1) parts.push(i18n.t('dash.split.nettedNote', { amount: money(netted) }));
    const gapNote = parts.join('');

    $('#dashSplitSub').textContent = (total > 0
      ? `${money(total)} across ${spend.length} categor${spend.length === 1 ? 'y' : 'ies'} · ${periodMonthName(S.period)}`
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
      const cmp = base && !x.other ? compareCell(x.cat, x.amount, base) : null;
      const face = () => [
        el('i', { style: `background:${x.color}` }),
        el('span', { class: 'dl-name' }, x.cat),
        el('span', { class: 'dl-val num' }, money(x.amount, 0)),
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
  ctx.provide({ renderDashboard, renderTrend: guardedTrend, renderSplit: guardedSplit });
};

/* Exposed for a direct, DOM-free unit test of the rounding algorithm itself —
   the six-equal / three-equal / exact-tie / single-slice / zero-slice cases
   in tests/donut-percentages.test.cjs. The full render is covered separately
   (aria-label and legend text) so a wiring bug that stops the view from
   USING this function is caught even if the function itself is correct. */
module.exports.sharePercents = sharePercents;
