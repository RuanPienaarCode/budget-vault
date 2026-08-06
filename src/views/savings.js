'use strict';
/* Savings & Investments — net-worth KPIs, composition, goals, per-group tiles. */

const { el } = require('../util');
const { themeColors, createChart, tip } = require('../chart');

module.exports = function registerSavings(ctx) {
  const { S, $, root, money } = ctx;

  function renderSavings() {
    const savings = S.accounts.filter(a => a.type === 'savings');
    const investments = S.accounts.filter(a => a.type === 'investment');
    const totalSavings = savings.reduce((s, a) => s + a.balance, 0);
    const totalInvest = investments.reduce((s, a) => s + a.balance, 0);
    const netWorth = S.accounts.reduce((s, a) => s + a.balance, 0);
    const creditDebt = S.accounts.filter(a => a.type === 'credit_card').reduce((s, a) => s + Math.min(0, a.balance), 0);

    const kpis = $('#savingsKpis'); kpis.empty();
    const tile = (l, v, cls) => kpis.append(el('div', { class: 'mini' },
      el('div', { class: 'l' }, l), el('div', { class: `v num ${cls || ''}` }, v)));
    tile('Net worth', money(netWorth), netWorth >= 0 ? 'grad-txt' : 'text-danger');
    tile('Savings', money(totalSavings));
    tile('Investments', money(totalInvest));
    tile('Credit debt', money(creditDebt), 'text-danger');

    renderWorth();

    const withGoals = S.accounts.filter(a => a.goal_amount);
    const goalsWrap = $('#savingsGoals'); goalsWrap.empty();
    if (!withGoals.length) {
      goalsWrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        'No goals set yet. Add a goal_amount (and optional target_date) to any account file to track progress here.'));
    } else {
      const g = el('div', { class: 'goals' });
      for (const a of withGoals) {
        const pct = Math.min(100, Math.max(0, (a.balance / a.goal_amount) * 100));
        const reached = a.balance >= a.goal_amount;
        g.append(el('div', {},
          el('div', { class: 'goal-h' },
            el('div', { class: 'gn' }, a.name),
            el('div', { class: 'gv' }, el('b', {}, money(a.balance)), ' / ', money(a.goal_amount))),
          el('div', { class: 'cat-bar' }, el('i', { class: 'cat-bar-fill', style: `width:${pct}%` })),
          el('div', { class: 'goal-pct' }, reached ? 'Goal reached!' : `${Math.round(pct)}%${a.target_date ? ' · target ' + a.target_date : ''}`)));
      }
      goalsWrap.append(g);
    }

    const wrap = $('#savingsSections'); wrap.empty();
    for (const [title, list] of [['Savings', savings], ['Investments', investments]]) {
      if (!list.length) continue;
      const grid = el('div', { class: 'mini-grid' });
      const total = list.reduce((s, a) => s + a.balance, 0);
      for (const a of list) {
        const parts = [[a.type.replace('_', ' '), a.institution].filter(Boolean).join(' · ')];
        if (a.monthly_contribution) parts.push(`${money(a.monthly_contribution, 0)}/m`);
        const card = el('div', { class: 'mini' },
          el('div', { class: 'l' }, a.name),
          el('div', { class: 'v num' }, money(a.balance)),
          el('div', { class: 's' }, parts.filter(Boolean).join(' · ')));
        // total_invested (what you've put in) is the better baseline; fall back to
        // starting_amount (what it opened with) so that field isn't inert.
        const baseline = a.total_invested || a.starting_amount;
        if (baseline) {
          const growth = a.balance - baseline;
          card.append(el('div', { class: `s2 num ${growth >= 0 ? 'text-success' : 'text-danger'}` },
            `${growth >= 0 ? '▲' : '▼'} ${money(Math.abs(growth), 0)} vs ${money(baseline, 0)} in`));
        } else if (a.inception_date) {
          card.append(el('div', { class: 's2' }, `since ${a.inception_date}`));
        }
        grid.append(card);
      }
      wrap.append(el('div', { class: 'card mb-4' },
        el('div', { class: 'card-h' },
          el('div', {}, el('h2', {}, title), el('div', { class: 'sub' }, `${list.length} accounts`)),
          el('div', { class: 'legend' }, el('span', {}, el('b', { class: 'num', style: 'font-size:15px;color:var(--text-primary)' }, money(total))))),
        el('div', { class: 'body-pad' }, grid)));
    }
  }

  /* --------------------- net-worth composition ---------------------------
     Two stacked bars — what you own, and what you owe — drawn on ONE shared
     scale so their lengths are directly comparable. That shared scale is the
     entire point of the chart: the four KPI tiles above already give the
     figures, and what a number cannot show is that the debt bar is two thirds
     the length of the asset bar.

     Deliberately not a donut. A donut has to take the absolute value of a
     negative balance to draw it, which turns a credit-card debt into a slice
     of net worth that reads as an asset.

     Scoped to accounts only, matching the KPI tiles directly above it. The
     Debt page's own balances are a separate ledger, and a chart quietly using
     a wider definition than the number six inches above it is worse than a
     chart that admits its scope in the subtitle. */
  const WORTH_TYPES = [
    ['investment', 'Investments', '--color-investment', '#6f42c1'],
    ['savings', 'Savings', '--color-success', '#22c55e'],
    ['checking', 'Cheque', '--color-info', '#0ea5e9'],
    ['cash', 'Cash', '--color-accent', '#0d9488'],
    ['credit_card', 'Credit cards', '--color-danger', '#f43f5e'],
    ['other', 'Other', '--ink-faint', '#5f6779'],
  ];

  function renderWorth() {
    const wrap = $('#savingsWorth'); wrap.empty();
    const css = getComputedStyle(root);
    const c = themeColors(root);

    /* Split by SIGN, not by type: a cheque account overdrawn is a liability
       however it is labelled, and a credit card in credit is an asset. */
    const assets = [], debts = [];
    for (const [type, label, varName, fallback] of WORTH_TYPES) {
      const color = (css.getPropertyValue(varName) || '').trim() || fallback;
      const inType = S.accounts.filter(a => a.type === type);
      const pos = inType.reduce((t, a) => t + Math.max(0, a.balance), 0);
      const neg = inType.reduce((t, a) => t + Math.min(0, a.balance), 0);
      if (pos > 0) assets.push({ label, amount: pos, color });
      if (neg < 0) debts.push({ label, amount: -neg, color });
    }

    const totalAssets = assets.reduce((t, x) => t + x.amount, 0);
    const totalDebts = debts.reduce((t, x) => t + x.amount, 0);
    const net = totalAssets - totalDebts;

    $('#savingsWorthSub').textContent = 'Across your accounts · the Debt page is tracked separately';

    if (!totalAssets && !totalDebts) {
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        'Add a balance to any account and the split appears here.'));
      return;
    }

    const W = 1000, H = 210, padL = 8, padR = 8, barH = 46;
    const scale = Math.max(totalAssets, totalDebts, 1);
    const innerW = W - padL - padR;
    const { svg, add } = createChart({
      w: W, h: H,
      label: `Net worth ${money(net)}: assets ${money(totalAssets)} against debts ${money(totalDebts)}`,
    });

    const row = (y, segs, total, heading) => {
      add('text', {
        x: padL, y: y - 10, 'font-size': '13', 'font-weight': '600',
        fill: 'currentColor', 'fill-opacity': '0.55', 'font-family': 'inherit',
      }).textContent = heading;
      add('text', {
        x: W - padR, y: y - 10, 'text-anchor': 'end', 'font-size': '13', 'font-weight': '700',
        fill: 'currentColor', 'fill-opacity': '0.8', 'font-family': 'inherit',
      }).textContent = money(total, 0);
      // The track shows how far short of the longer bar this one falls.
      add('rect', {
        x: padL, y, width: innerW, height: barH, rx: 10,
        fill: 'currentColor', 'fill-opacity': '0.05',
      });
      if (!total) return;
      let x = padL;
      for (const seg of segs) {
        const w = (seg.amount / scale) * innerW;
        const node = add('rect', {
          x, y, width: Math.max(2, w), height: barH,
          fill: seg.color, rx: w > 20 ? 10 : 2,
        });
        tip(add, node, `${seg.label}: ${money(seg.amount)} · ${Math.round((seg.amount / total) * 100)}% of ${heading.toLowerCase()}`);
        // Only label a segment wide enough to hold the text without clipping.
        if (w > 96) {
          add('text', {
            x: x + w / 2, y: y + barH / 2 + 5, 'text-anchor': 'middle',
            'font-size': '13', 'font-weight': '600', fill: c.hole, 'font-family': 'inherit',
          }).textContent = seg.label;
        }
        x += w;
      }
    };

    row(34, assets, totalAssets, 'What you own');
    row(132, debts, totalDebts, 'What you owe');
    wrap.append(svg);

    const legend = el('ul', { class: 'donut-legend donut-legend--inline' });
    for (const seg of [...assets, ...debts.map(d => ({ ...d, label: `${d.label} (owed)` }))]) {
      legend.append(el('li', {},
        el('i', { style: `background:${seg.color}` }),
        el('span', { class: 'dl-name' }, seg.label),
        el('span', { class: 'dl-val num' }, money(seg.amount, 0))));
    }
    wrap.append(legend);
  }

  ctx.provide({ renderSavings, renderWorth });
};
