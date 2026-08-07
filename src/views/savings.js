'use strict';
/* Savings & Investments — net-worth KPIs, composition, goals, per-group tiles. */

const { el, icoEl } = require('../util');
const { themeColors, createChart, tip } = require('../chart');
const { isStale, stalenessSummary } = require('../reconcile');
const { worth, activeDebts, cardOverlap, debtsByType } = require('../worth');

module.exports = function registerSavings(ctx) {
  const { S, $, root, money, accountForLabel } = ctx;

  /* Does the vault hold transactions for this account? If it does, money has
     been moving through it that `total_invested` knows nothing about — which is
     what makes the figure below not-growth. Also the seam the derived
     contribution split will read from once it exists. */
  function hasTransactions(a) {
    for (const f of Object.values(S.txFiles)) {
      if (accountForLabel(f.label) === a && f.rows && f.rows.length) return true;
    }
    return false;
  }

  function renderSavings() {
    const savings = S.accounts.filter(a => a.type === 'savings');
    const investments = S.accounts.filter(a => a.type === 'investment');
    const totalSavings = savings.reduce((s, a) => s + a.balance, 0);
    const totalInvest = investments.reduce((s, a) => s + a.balance, 0);
    const w = worth(S.accounts, S.debts);
    const netWorth = w.net;

    const kpis = $('#savingsKpis'); kpis.empty();
    const tile = (l, v, cls, sub) => {
      const t = el('div', { class: 'mini' },
        el('div', { class: 'l' }, l), el('div', { class: `v num ${cls || ''}` }, v));
      if (sub) t.append(el('div', { class: 's' }, sub));
      kpis.append(t);
    };
    tile('Net worth', money(netWorth), netWorth >= 0 ? 'grad-txt' : 'text-danger');
    tile('Savings', money(totalSavings));
    tile('Investments', money(totalInvest));
    /* Was "Credit debt", and counted only credit-card accounts — which left it
       disagreeing with the chart six inches below, and with a net worth that
       now includes a home loan. One definition of owed, used everywhere. */
    tile('Debt', money(-w.liabilities), 'text-danger',
      w.fromDebts && w.fromAccounts
        ? `${money(w.fromAccounts, 0)} accounts · ${money(w.fromDebts, 0)} debt page`
        : null);

    renderStaleNote();
    renderWorth();

    renderGoals();
    renderSections(savings, investments);
  }

  /* ----------------------- how old is this number ------------------------
     Net worth is a sum of figures the reader TYPED, and the Accounts page
     labels those very same figures "unconfirmed 118 days". Stating the total
     here as fact while the page next door calls its inputs provisional is the
     disagreement that makes a reader stop trusting both.

     Deliberately a caveat rather than a warning, and never a reason to hide the
     figure: an old balance is still the best answer anyone has. It just should
     not be printed in gradient text as though it were measured this morning. */
  function renderStaleNote() {
    const wrap = $('#savingsStale'); wrap.empty();
    const s = stalenessSummary(S.accounts);
    if (!s.stale) return;

    const all = s.stale === s.total;
    const line = all
      ? `Built from ${s.total === 1 ? 'a balance' : `${s.total} balances`} nobody has confirmed recently`
      : `Built from ${s.stale} of ${s.total} balances nobody has confirmed recently`;
    // oldestDays is null when every stale account is stale for want of a date
    // at all — "never confirmed" is the honest phrasing there, not "0 days".
    const age = s.oldestDays === null
      ? 'none of them carry a date'
      : `the oldest ${s.oldestDays} days ago`;

    const note = el('div', { class: 'kpi-caveat-txt' },
      icoEl(['info', 'alert-circle']), `${line} — ${age}.`);
    const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
      'aria-label': 'Review account balances on the Accounts page' }, 'Review balances');
    btn.addEventListener('click', () => ctx.switchView('accounts'));
    wrap.append(note, btn);
  }

  function renderGoals() {
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
        /* A goal bar divides the same unconfirmed balance the caveat above is
           about. Marked rather than hidden — "62% of the way there, as of
           April" is still worth knowing, and a bar that silently vanishes when
           a balance ages is a worse answer than one that admits its age. */
        const stale = isStale(a.balance_updated);
        const pctLine = reached ? 'Goal reached!'
          : `${Math.round(pct)}%${a.target_date ? ' · target ' + a.target_date : ''}`;
        g.append(el('div', {},
          el('div', { class: 'goal-h' },
            el('div', { class: 'gn' }, a.name),
            el('div', { class: 'gv' }, el('b', {}, money(a.balance)), ' / ', money(a.goal_amount))),
          el('div', { class: `cat-bar${stale ? ' cat-bar-stale' : ''}` },
            el('i', { class: 'cat-bar-fill', style: `width:${pct}%` })),
          el('div', { class: 'goal-pct' }, pctLine,
            ...(stale ? [el('span', { class: 'goal-stale' }, ' · balance unconfirmed')] : []))));
      }
      goalsWrap.append(g);
    }
  }

  function renderSections(savings, investments) {
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
        /* total_invested (what you've put in) is the better baseline; fall back
           to starting_amount (what it opened with) so that field isn't inert.

           This figure is NOT growth, and no longer claims to be. `balance −
           what you put in` only equals growth while `total_invested` keeps pace
           with every contribution — and nothing makes it. A monthly debit order
           moves the balance and leaves the baseline where it was, so the
           difference grows by the contribution and reports it as performance.
           Measured against four real accounts, that was wrong on all four.

           Until the split is derived from transactions, the honest thing is to
           show the arithmetic under its true name and say what is folded into
           it. An account the vault holds transactions for is the case where the
           overstatement is certain, so it is the one that gets told. */
        const baseline = a.total_invested || a.starting_amount;
        if (baseline) {
          const over = a.balance - baseline;
          card.append(el('div', { class: `s2 num ${over >= 0 ? 'text-success' : 'text-danger'}` },
            `${over >= 0 ? '▲' : '▼'} ${money(Math.abs(over), 0)} vs ${money(baseline, 0)} in`));
          if (hasTransactions(a)) {
            card.append(el('div', { class: 's2 s2-caveat',
              title: 'This is the balance less what the account file records as put in — not growth. '
                + 'Contributions since that figure was last updated are counted inside it.' },
            'includes contributions'));
          }
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

     Covers BOTH ledgers — accounts and the Debt page. It used to be scoped to
     accounts alone, disclosed in the subtitle as "the Debt page is tracked
     separately". That was defensible while the KPI above it had the same
     scope, and indefensible once you notice what it does to a reader with a
     bond: a chart captioned "what you own against what you owe" omitting the
     largest thing they owe, with a subtitle as the only warning. A phrase is
     not a disclosure when the number it qualifies is the point of the page. */
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

    /* Debt-page rows, grouped by their own type so a bond and a car loan are
       tellable apart rather than merged into one anonymous block. Colours walk
       a fixed list so the same debt type keeps the same colour between renders
       — a segment that changes colour when another debt is added reads as a
       different debt. */
    const DEBT_VARS = ['--color-warning', '--color-danger', '--color-investment', '--ink-faint'];
    const DEBT_FALLBACKS = ['#f5a524', '#f43f5e', '#6f42c1', '#5f6779'];
    debtsByType(S.debts).forEach((d, i) => {
      const color = (css.getPropertyValue(DEBT_VARS[i % DEBT_VARS.length]) || '').trim()
        || DEBT_FALLBACKS[i % DEBT_FALLBACKS.length];
      debts.push({ label: d.type, amount: d.amount, color, fromDebtPage: true });
    });

    const totalAssets = assets.reduce((t, x) => t + x.amount, 0);
    const totalDebts = debts.reduce((t, x) => t + x.amount, 0);
    const net = totalAssets - totalDebts;

    const active = activeDebts(S.debts);
    const overlap = cardOverlap(S.accounts, S.debts);
    $('#savingsWorthSub').textContent = overlap
      ? 'Across your accounts and the Debt page · a credit card appears on both, so it may be counted twice'
      : (active.length ? 'Across your accounts and the Debt page' : 'Across your accounts');

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
