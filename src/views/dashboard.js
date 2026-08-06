'use strict';
/* Dashboard — hero card, spending-trend SVG, category split, budget-vs-actual. */

const { el } = require('../util');
const { TYPE_ORDER } = require('../constants');
const {
  themeColors, createChart, scales, gridlines, axisLabels,
  linePath, areaPath, areaGradient, arcPath, tip,
  historicalRanges, rangeFor, rangePills,
} = require('../chart');

module.exports = function registerDashboard(ctx) {
  const { S, $, root, plugin, money, periodSummary, budgetTotals, periodTitle, periodMonthName, periodShortLabel, periodRange, shiftPeriod, catType } = ctx;

  function renderDashboard() {
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

    renderTrend();
    renderSplit();

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

    const total = spend.reduce((t, x) => t + x.amount, 0);
    $('#dashSplitSub').textContent = total > 0
      ? `${money(total)} across ${spend.length} categor${spend.length === 1 ? 'y' : 'ies'} · ${periodMonthName(S.period)}`
      : periodMonthName(S.period);

    if (!total) {
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        'Nothing categorised as spending in this period yet.'));
      return;
    }

    /* Everything past the top slices collapses into one wedge. Twenty legend
       rows on a phone is a wall of text, and the tail slivers are too thin to
       point at anyway. */
    const shown = spend.slice(0, SPLIT_SLICES);
    const rest = spend.slice(SPLIT_SLICES);
    if (rest.length) {
      shown.push({
        cat: `Other (${rest.length})`,
        amount: rest.reduce((t, x) => t + x.amount, 0),
        color: themeColors(root).muted,
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
      });
      tip(add, seg, `${x.cat}: ${money(x.amount)} · ${Math.round((x.amount / total) * 100)}%`);
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

    const legend = el('ul', { class: 'donut-legend' });
    for (const x of shown) {
      legend.append(el('li', {},
        el('i', { style: `background:${x.color}` }),
        el('span', { class: 'dl-name' }, x.cat),
        el('span', { class: 'dl-val num' }, money(x.amount, 0)),
        el('span', { class: 'dl-pct num' }, `${Math.round((x.amount / total) * 100)}%`)));
    }
    wrap.append(svg, legend);
  }

  ctx.provide({ renderDashboard, renderTrend, renderSplit });
};
