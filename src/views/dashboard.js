'use strict';
/* Dashboard — hero card, spending-trend SVG, budget-vs-actual table. */

const { el } = require('../util');
const { TYPE_ORDER, MONTHS } = require('../constants');

module.exports = function registerDashboard(ctx) {
  const { S, $, root, money, periodSummary, budgetTotals, periodTitle, periodMonthName, shiftPeriod, catType } = ctx;

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

    const hero = $('#heroCard'); hero.innerHTML = '';
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

    const t = $('#dashBudget'); t.innerHTML = '';
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

  /* Airy Glass trend chart — inline SVG. */
  function renderTrend() {
    const wrap = $('#trendChart'); wrap.innerHTML = '';
    const periods = []; for (let i = 5; i >= 0; i--) periods.push(shiftPeriod(S.period, -i));
    const data = periods.map(p => ({
      p, spent: periodSummary(p).spend, budget: budgetTotals(p).spend,
      label: `${MONTHS[parseInt(p.slice(5), 10) - 1]} ${p.slice(2, 4)}`,
    }));
    const W = 1000, H = 300, padL = 24, padR = 24, padT = 24, padB = 40;
    const max = Math.max(1, ...data.flatMap(d => [d.spent, d.budget])) * 1.12;
    const x = i => padL + i * ((W - padL - padR) / (data.length - 1));
    const y = v => padT + (1 - v / max) * (H - padT - padB);
    const over = d => d.budget > 0 && d.spent > d.budget;
    const css = getComputedStyle(root);
    const cSuccess = css.getPropertyValue('--color-success').trim() || '#22c55e';
    const cDanger = css.getPropertyValue('--color-danger').trim() || '#f43f5e';
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Spent vs budget over the last 6 periods');
    const add = (tag, attrs, parent = svg) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      parent.append(n);
      return n;
    };
    const defs = add('defs', {});
    const grad = add('linearGradient', { id: 'spentArea', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    add('stop', { offset: '0%', 'stop-color': cSuccess, 'stop-opacity': '0.22' }, grad);
    add('stop', { offset: '100%', 'stop-color': cSuccess, 'stop-opacity': '0' }, grad);
    for (let g = 1; g <= 3; g++) {
      const gy = padT + g * ((H - padT - padB) / 4);
      add('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: 'currentColor', 'stroke-opacity': '0.06' });
    }
    add('path', {
      d: 'M' + data.map((d, i) => `${x(i)},${y(d.spent)}`).join(' L ') +
         ` L ${x(data.length - 1)},${H - padB} L ${x(0)},${H - padB} Z`,
      fill: 'url(#spentArea)',
    });
    add('polyline', {
      points: data.map((d, i) => `${x(i)},${y(d.budget)}`).join(' '),
      fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.28',
      'stroke-width': '1.5', 'stroke-dasharray': '5 6', 'stroke-linecap': 'round',
    });
    for (let i = 1; i < data.length; i++) {
      add('line', {
        x1: x(i - 1), y1: y(data[i - 1].spent), x2: x(i), y2: y(data[i].spent),
        stroke: (over(data[i - 1]) || over(data[i])) ? cDanger : cSuccess,
        'stroke-width': '2.5', 'stroke-linecap': 'round',
      });
    }
    const holeCss = root.classList.contains('bud-dark') ? '#0a0f1e' : '#ffffff';
    data.forEach((d, i) => {
      const dot = add('circle', {
        cx: x(i), cy: y(d.spent), r: '5',
        fill: holeCss, stroke: over(d) ? cDanger : cSuccess, 'stroke-width': '2.5',
      });
      add('title', {}, dot).textContent = `${d.label}: ${money(d.spent)} spent · ${money(d.budget)} budgeted`;
      add('text', {
        x: x(i), y: H - 12, 'text-anchor': 'middle',
        'font-size': '13', fill: 'currentColor', 'fill-opacity': '0.45',
        'font-family': 'inherit',
      }).textContent = d.label;
    });
    svg.style.color = 'var(--text-primary)';
    wrap.append(svg);
  }

  Object.assign(ctx, { renderDashboard, renderTrend });
};
