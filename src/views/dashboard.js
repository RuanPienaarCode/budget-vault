'use strict';
/* Dashboard — hero card, spending-trend SVG, category split, budget-vs-actual. */

const { el, icoEl } = require('../dom');
const { safeSeg } = require('../vault-path');
const { TYPE_ORDER } = require('../constants');
const { stalenessSummary } = require('../reconcile');
const { worth, cardOverlap } = require('../worth');
const { owedSummary } = require('../owed-math');
const {
  themeColors, createChart, scales, gridlines, axisLabels,
  linePath, areaPath, areaGradient, arcPath, tip, distinctColors,
  historicalRanges, rangeFor, rangePills,
} = require('../chart');

module.exports = function registerDashboard(ctx) {
  const { S, $, app, root, plugin, money, toast, fileAt, periodSummary, budgetTotals, periodTitle, periodMonthName, periodShortLabel, periodRange, shiftPeriod, catType } = ctx;

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
        const msg = `Could not draw the ${label} — ${e?.message || e}`;
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
      ? 'As things stand today — these do not move with the period above'
      : '';
    if (!hasLedger) return;

    posTile(grid, {
      label: 'Net worth', value: money(w.net, 0),
      cls: w.net >= 0 ? 'grad-txt' : 'text-danger',
      sub: `${money(w.assets, 0)} owned · ${money(w.liabilities, 0)} owed`,
      view: 'savings',
      say: `Net worth ${money(w.net)} — ${money(w.assets)} owned against ${money(w.liabilities)} owed. Open Savings and Investments.`,
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
    posTile(grid, {
      label: 'Debt', value: money(-w.liabilities, 0),
      cls: w.liabilities > 0 ? 'text-danger' : '',
      sub: w.fromDebts && w.fromAccounts
        ? `${money(w.fromAccounts, 0)} accounts · ${money(w.fromDebts, 0)} debt page`
        : (w.liabilities > 0 ? `${w.active.length} active` : 'nothing owed'),
      view: 'debts',
      say: w.liabilities > 0
        ? `Debt ${money(w.liabilities)} owed. Open the Debt page.`
        : 'No debt owed. Open the Debt page.',
    });

    /* The one figure on this card that is money coming TOWARDS the household,
       so it is never red — outstanding is a warning at most. Age rather than a
       due date, for the reason owed-math.js sets out. */
    posTile(grid, {
      label: 'Owed to you', value: money(owed.outstanding, 0),
      cls: owed.outstanding > 0 ? 'text-warning' : '',
      sub: owed.outstanding > 0
        ? `${owed.open} outstanding${owed.oldestDays !== null ? ` · oldest out ${owed.oldestDays} days` : ''}`
        : (owed.entries ? `${money(owed.recovered, 0)} recovered` : 'nothing lent out'),
      view: 'owed',
      say: owed.outstanding > 0
        ? `${money(owed.outstanding)} owed to you across ${owed.open} ${owed.open === 1 ? 'entry' : 'entries'}. Open Owed Money.`
        : 'Nothing outstanding. Open Owed Money.',
    });

    /* Uncoloured, deliberately. The Savings page leaves its Savings and
       Investments tiles plain and spends its colour on the two figures that
       carry a verdict — net worth and debt — and this band has to read the same
       way. Given green it becomes a second green number beside the gradient one,
       and the eye stops being able to tell which of the four is the headline. */
    posTile(grid, {
      label: 'Savings & investments', value: money(savings + invest, 0),
      sub: `${money(savings, 0)} savings · ${money(invest, 0)} invested`,
      view: 'savings',
      say: `${money(savings + invest)} in savings and investments. Open Savings and Investments.`,
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
      `${o.cardAccounts} credit-card ${o.cardAccounts === 1 ? 'account' : 'accounts'} and ` +
      `${o.cardDebts} card ${o.cardDebts === 1 ? 'debt' : 'debts'} are tracked — if any card is in both, it is counted twice above.`));
    const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
      'aria-label': 'Review tracked debts on the Debt page' }, 'Review debts');
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
    const age = s.oldestDays === null ? 'none of them carry a date' : `the oldest ${s.oldestDays} days ago`;
    const all = s.stale === s.total;
    const line = all
      ? `Built from ${s.total === 1 ? 'a balance' : `${s.total} balances`} nobody has confirmed recently`
      : `Built from ${s.stale} of ${s.total} balances nobody has confirmed recently`;
    wrap.append(el('div', { class: 'kpi-caveat-txt' }, icoEl(['info', 'alert-circle']),
      `${line} — ${age}.`));
    const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
      'aria-label': 'Review account balances on the Accounts page' }, 'Review balances');
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
    const budgetedPct = sum.income > 0 ? Math.round((bud.spend / sum.income) * 100) : null;
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
        el('div', {}, el('div', { class: 'sl' }, 'Total Income')),
        el('div', {}, el('div', { class: 'sv grad-txt' }, money(sum.income)))),
      el('div', { class: 'stat' },
        el('div', {}, el('div', { class: 'sl' }, 'Budgeted')),
        el('div', {}, el('div', { class: 'sv' }, money(bud.spend)),
          budgetedPct !== null ? el('div', { class: 'st' }, `${budgetedPct}% allocated`) : '')),
      el('div', { class: 'stat' },
        el('div', {}, el('div', { class: 'sl' }, 'Total Spent')),
        el('div', {}, el('div', { class: 'sv' }, money(sum.spend)),
          usedPct !== null ? el('div', { class: 'st' }, el('span', { class: 'tag warn' }, `${usedPct}% used`)) : '')));
    if (sum.uncategorised > 0) statCol.append(
      el('div', { class: 'stat' },
        el('div', {}, el('div', { class: 'sl' }, 'Uncategorised')),
        el('div', {}, el('div', { class: 'sv', style: 'color: var(--color-warning)' }, String(sum.uncategorised)),
          el('div', { class: 'st' }, 'review in Transactions'))));
    const hour = new Date().getHours();
    const greeting = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    hero.append(el('div', { class: 'hero-grid' },
      el('div', {},
        S.settings.household ? el('div', { class: 'hero-greet' }, `${greeting}, ${S.settings.household}`) : '',
        el('div', { class: 'hero-lbl' }, heroNegative ? 'Overspent this period' : 'Remaining this period'),
        heroNum,
        el('div', { class: 'hero-sub' }, el('b', {}, money(sum.spend)), ' spent of ', el('b', {}, money(bud.spend)), ' budgeted'),
        meter),
      statCol));
  }

  function renderBudgetTable() {
    const sum = periodSummary(S.period);
    const t = $('#dashBudget'); t.empty();
    $('#dashBudgetSub').textContent = `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Category'), el('th', { scope: 'col', class: 'num' }, 'Budget'), el('th', { scope: 'col', class: 'num' }, 'Spent'),
      el('th', { scope: 'col', style: 'width:26%' }, ''), el('th', { scope: 'col', class: 'num' }, 'Remaining'))));
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
      const near = !over && r.budget > 0 && r.actual / r.budget >= 0.85;
      const barCls = r.type === 'income' ? '' : over ? ' bg-danger' : near ? ' bg-warning' : '';
      const remaining = r.budget - r.actual;
      const bar = el('div', { class: 'cat-bar' }, el('i', { class: `cat-bar-fill${barCls}`, style: `width:${pct}%` }));
      body.append(el('tr', {},
        el('td', {}, cat, r.notes ? el('div', { class: 'text-muted', style: 'font-size:11.5px;margin-top:2px' }, r.notes.split('\n')[0]) : ''),
        el('td', { class: 'num' }, r.budget ? money(r.budget) : '—'),
        el('td', { class: 'num' }, money(r.actual)),
        el('td', {}, bar),
        el('td', { class: `num${over ? ' text-danger' : ''}` }, r.budget ? money(remaining) : '')));
    }
    if (!sorted.length) body.append(el('tr', {}, el('td', { colspan: '5', class: 'text-muted' }, 'No budget or transactions in this period yet.')));
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

  const trendRange = () => rangeFor(plugin.settings.chartTrendRange) || rangeFor('6m');

  function renderTrend() {
    const wrap = $('#trendChart'); wrap.empty();

    const range = trendRange();
    const want = periodsForMonths(range.months);
    const periods = trendPeriods(want);
    const data = periods.map(p => {
      const sum = periodSummary(p);
      return { p, spent: sum.spend, income: sum.income, budget: budgetTotals(p).spend, label: periodShortLabel(p) };
    });

    /* The pills live in the header, but they are rebuilt here so the active
       one can never disagree with the series actually drawn below. */
    const pills = $('#trendRange'); pills.empty();
    pills.append(rangePills({
      ranges: historicalRanges(),
      value: range.key,
      label: 'Spending trend range',
      onPick: async key => {
        plugin.settings.chartTrendRange = key;
        await plugin.saveSettings();
        renderTrend();
      },
    }));

    /* Say when the range was cut short, rather than letting a "1Y" pill sit
       above six months of chart with nothing to explain the difference. */
    const clamped = periods.length < want;
    $('#trendSub').textContent = `Spent vs budget · ${periods.length} period${periods.length === 1 ? '' : 's'}` +
      (clamped ? ` · all the history imported so far` : '');

    if (data.length < 2) {
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        'Import a second period of transactions and the trend line starts here.'));
      return;
    }

    const W = 1000, H = 300;
    const c = themeColors(root);
    const max = Math.max(1, ...data.flatMap(d => [d.spent, d.budget, d.income])) * 1.12;
    const s = scales({ w: W, h: H, count: data.length, max });
    const over = d => d.budget > 0 && d.spent > d.budget;
    const { svg, add } = createChart({
      w: W, h: H,
      label: `Spent, budgeted and income over the last ${data.length} periods`,
    });

    const fill = areaGradient(add, 'trendSpentArea', c.success);
    gridlines(add, s, W);

    const spentPts = data.map((d, i) => [s.x(i), s.y(d.spent)]);
    add('path', { d: areaPath(spentPts, s.baseline), fill });

    add('polyline', {
      points: data.map((d, i) => `${s.x(i)},${s.y(d.budget)}`).join(' '),
      fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.28',
      'stroke-width': '1.5', 'stroke-dasharray': '5 6', 'stroke-linecap': 'round',
    });

    /* Income sits above spend in a healthy period, so it is drawn before the
       spend line and thinner — it is context for the spend line, not a rival
       to it. */
    add('path', {
      d: linePath(data.map((d, i) => [s.x(i), s.y(d.income)])),
      fill: 'none', stroke: c.info, 'stroke-opacity': '0.85',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });

    /* Segment by segment rather than one polyline, so a period that broke its
       budget colours only the legs touching it. */
    for (let i = 1; i < data.length; i++) {
      add('line', {
        x1: s.x(i - 1), y1: s.y(data[i - 1].spent), x2: s.x(i), y2: s.y(data[i].spent),
        stroke: over(data[i - 1]) || over(data[i]) ? c.danger : c.success,
        'stroke-width': '2.5', 'stroke-linecap': 'round',
      });
    }

    /* Past a dozen points the dots merge into a bead chain and stop being
       readable — a year of weekly periods is 52 of them. The line carries the
       shape on its own from there. */
    const dots = data.length <= 12;
    data.forEach((d, i) => {
      const node = dots
        ? add('circle', {
            cx: s.x(i), cy: s.y(d.spent), r: '5',
            fill: c.hole, stroke: over(d) ? c.danger : c.success, 'stroke-width': '2.5',
          })
        /* No dot to hang a tooltip on, so an invisible full-height hit strip
           keeps every period reachable by touch and hover. */
        : add('rect', {
            x: s.x(i) - s.innerW / (data.length * 2), y: s.padT,
            width: s.innerW / data.length, height: s.innerH, fill: 'transparent',
          });
      tip(add, node, `${d.label}: ${money(d.spent)} spent · ${money(d.budget)} budgeted · ${money(d.income)} in`);
    });

    axisLabels(add, s, data.map(d => d.label), H);
    wrap.append(svg);
  }

  /* --------------------------- category split ---------------------------
     A donut of where the period's money actually went. Deliberately NOT a
     second ranked list: the table below already ranks categories against their
     budgets, and what that cannot show is proportion of the whole. */
  const SPLIT_SLICES = 8;

  function catColor(name) {
    return S.categories.find(c => c.name === name)?.color || '#888';
  }

  function renderSplit() {
    const wrap = $('#dashSplit'); wrap.empty();
    const sum = periodSummary(S.period);

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

    /* Uncategorised rows land in byCat under the empty-string key and are
       skipped above — a gap in the data is not a place the money went, and it
       has no colour, no budget and nothing to drill into. But it must not be
       SILENT. The hero's "Total Spent" counts uncategorised spending and this
       donut does not, so the two disagree by exactly this much with nothing on
       screen to say why. A reader who then categorises nothing sees the number
       above move on every import while the donut below it sits still, which is
       indistinguishable from a chart that has stopped updating — and gets
       reported as one. Net, not gross, to match how the slices treat a refund. */
    const uncat = -Math.min(0, sum.byCat[''] || 0);
    const uncatNote = uncat > 0 ? ` · ${money(uncat)} uncategorised, not shown` : '';

    const total = spend.reduce((t, x) => t + x.amount, 0);
    $('#dashSplitSub').textContent = (total > 0
      ? `${money(total)} across ${spend.length} categor${spend.length === 1 ? 'y' : 'ies'} · ${periodMonthName(S.period)}`
      : periodMonthName(S.period)) + uncatNote;

    if (!total) {
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        uncat > 0
          ? `${money(uncat)} went out this period, but none of it is categorised yet — set categories in Transactions and the split appears here.`
          : 'Nothing categorised as spending in this period yet.'));
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

    const W = 320, H = 320, cx = W / 2, cy = H / 2, rOut = 140, rIn = 88;
    const { svg, add } = createChart({
      w: W, h: H, cls: 'donut',
      label: `Spending split for ${periodMonthName(S.period)}: ` +
        shown.map(x => `${x.cat} ${Math.round((x.amount / total) * 100)}%`).join(', '),
    });

    let a = -Math.PI / 2;                      // 12 o'clock, so the largest slice starts at the top
    for (const x of shown) {
      const sweep = (x.amount / total) * Math.PI * 2;
      const seg = add('path', {
        d: arcPath(cx, cy, rOut, rIn, a, a + sweep),
        fill: x.color, stroke: themeColors(root).hole, 'stroke-width': '2',
        class: x.other ? null : 'donut-slice',
      });
      tip(add, seg, `${x.cat}: ${money(x.amount)} · ${Math.round((x.amount / total) * 100)}%`);
      /* Pointer only, deliberately: the <svg> is role="img", which takes its
         whole subtree out of the accessibility tree, so a focusable wedge would
         be a tab stop no screen reader can announce. The legend below carries
         the same two actions as real buttons — that is the keyboard and AT
         path, and the wedge is the convenience one for a mouse or thumb. */
      if (!x.other) seg.addEventListener('click', () => openCategory(x.cat));
      a += sweep;
    }

    add('text', {
      x: cx, y: cy - 6, 'text-anchor': 'middle', 'font-size': '13',
      fill: 'currentColor', 'fill-opacity': '0.5', 'font-family': 'inherit',
    }).textContent = 'Total spent';
    add('text', {
      x: cx, y: cy + 22, 'text-anchor': 'middle', 'font-size': '26', 'font-weight': '700',
      fill: 'currentColor', 'font-family': 'inherit',
    }).textContent = money(total, 0);

    const legend = el('ul', { class: 'donut-legend donut-legend--linked' });
    for (const x of shown) {
      const pct = Math.round((x.amount / total) * 100);
      /* Rebuilt per row rather than shared: these are appended into either a
         plain <li> or a <button>, and a node can only live in one of them. */
      const face = () => [
        el('i', { style: `background:${x.color}` }),
        el('span', { class: 'dl-name' }, x.cat),
        el('span', { class: 'dl-val num' }, money(x.amount, 0)),
        el('span', { class: 'dl-pct num' }, `${pct}%`),
      ];
      /* "Other" is a bucket of categories, so neither action has a single
         target to point at — it stays an inert row. */
      if (x.other) { legend.append(el('li', {}, face())); continue; }
      legend.append(el('li', {},
        /* aria-label rather than the row's own text: read as-is a screen
           reader gets "Groceries 4 200 32", three unlabelled fragments. */
        el('button', {
          type: 'button', class: 'dl-link',
          'aria-label': `${x.cat}: ${money(x.amount)}, ${pct}% of spending — show transactions`,
          onclick: () => openCategory(x.cat),
        }, face()),
        el('button', {
          type: 'button', class: 'dl-note',
          'aria-label': `Open the ${x.cat} category note`,
          title: 'Open category note',
          onclick: () => openCategoryFile(x.cat),
          /* An ARRAY, not the 'a|b' string the shell's data-ico attributes
             use — icoEl walks a list, and only controller.js splits on the
             pipe. Passed as a string the whole thing is treated as one icon
             name, setIcon silently draws nothing, and the button ships empty. */
        }, icoEl(['file-text', 'file']))));
    }
    wrap.append(svg, legend);
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
    if (!file) return toast(`No category note found for "${cat}"`, true);
    await app.workspace.getLeaf('tab').openFile(file);
  }

  /* The guarded wrappers, not the raw ones: applyTheme() calls both of these
     directly on a theme flip, and an unguarded throw there freezes the same
     two cards this module just took care to isolate. */
  ctx.provide({ renderDashboard, renderTrend: guardedTrend, renderSplit: guardedSplit });
};
