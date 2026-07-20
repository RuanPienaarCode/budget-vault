'use strict';
/* Savings & Investments — net-worth KPIs, goal progress, per-group tiles. */

const { el } = require('../util');

module.exports = function registerSavings(ctx) {
  const { S, $, money } = ctx;

  function renderSavings() {
    const savings = S.accounts.filter(a => a.type === 'savings');
    const investments = S.accounts.filter(a => a.type === 'investment');
    const totalSavings = savings.reduce((s, a) => s + a.balance, 0);
    const totalInvest = investments.reduce((s, a) => s + a.balance, 0);
    const netWorth = S.accounts.reduce((s, a) => s + a.balance, 0);
    const creditDebt = S.accounts.filter(a => a.type === 'credit_card').reduce((s, a) => s + Math.min(0, a.balance), 0);

    const kpis = $('#savingsKpis'); kpis.innerHTML = '';
    const tile = (l, v, cls) => kpis.append(el('div', { class: 'mini' },
      el('div', { class: 'l' }, l), el('div', { class: `v num ${cls || ''}` }, v)));
    tile('Net worth', money(netWorth), netWorth >= 0 ? 'grad-txt' : 'text-danger');
    tile('Savings', money(totalSavings));
    tile('Investments', money(totalInvest));
    tile('Credit debt', money(creditDebt), 'text-danger');

    const withGoals = S.accounts.filter(a => a.goal_amount);
    const goalsWrap = $('#savingsGoals'); goalsWrap.innerHTML = '';
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

    const wrap = $('#savingsSections'); wrap.innerHTML = '';
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
        if (a.total_invested) {
          const growth = a.balance - a.total_invested;
          card.append(el('div', { class: `s2 num ${growth >= 0 ? 'text-success' : 'text-danger'}` },
            `${growth >= 0 ? '▲' : '▼'} ${money(Math.abs(growth), 0)} vs ${money(a.total_invested, 0)} in`));
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

  Object.assign(ctx, { renderSavings });
};
