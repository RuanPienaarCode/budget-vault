'use strict';
/* Savings & Investments — net-worth KPIs, composition, goals, per-group tiles. */

const { el, kpiTiles, icoEl } = require('../dom');
const { themeColors, createChart, tip, parseColor } = require('../chart');
const { isStale, stalenessSummary, reconcile } = require('../reconcile');
const { todayIso } = require('../dates');
const { accountFlows } = require('../savings-math');
const { worth, activeDebts, cardOverlap, accountGroups, debtsByType, assetsByType } = require('../worth');
const { daysSince } = require('../reconcile');

/* Bumped once per composition chart drawn, to keep its clipPath and gradient
   ids unique across every render AND across every open leaf. Module scope
   rather than per-registration for exactly that second reason. */
let worthSeq = 0;

module.exports = function registerSavings(ctx) {
  const { S, $, root, money, toast, accountIndex, catType, saveAccount } = ctx;

  function renderSavings() {
    const savings = S.accounts.filter(a => a.type === 'savings');
    const investments = S.accounts.filter(a => a.type === 'investment');
    const totalSavings = savings.reduce((s, a) => s + a.balance, 0);
    const totalInvest = investments.reduce((s, a) => s + a.balance, 0);
    const w = worth(S.accounts, S.debts, S.assets);
    const netWorth = w.net;

    const tile = kpiTiles($('#savingsKpis'));
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
    renderSections(savings, investments, accountIndex());
  }

  /* Accept the implied balance. Identical contract to the Accounts page: stamp
     today, so the rows just absorbed cannot be counted a second time — the next
     reconciliation window starts clear of them. */
  async function acceptImplied(a, implied) {
    a.balance = implied;
    a.balanceRaw = null;
    a.balance_updated = todayIso();
    await saveAccount(a);
    renderSavings();
    toast(`${a.name} reconciled to ${money(implied)}`);
  }

  /* ----------------------- how old is this number ------------------------
     Net worth is a sum of figures the reader TYPED, and the Accounts page
     labels those very same figures "unconfirmed 118 days". Stating the total
     here as fact while the page next door calls its inputs provisional is the
     disagreement that makes a reader stop trusting both.

     Deliberately a caveat rather than a warning, and never a reason to hide the
     figure: an old balance is still the best answer anyone has. It just should
     not be printed in gradient text as though it were measured this morning. */
  /* An asset value goes stale on a year's clock, not the 30 days a bank
     balance does — see the header of views/assets.js. Reported as its own line
     rather than folded into the account count above: the two say "unconfirmed"
     about different lengths of time, and one sentence covering both would be
     true of neither. */
  const ASSET_STALE_DAYS = 365;
  function staleAssets() {
    return (S.assets || []).filter(a => {
      const d = daysSince(a.valued);
      return (d === null || d > ASSET_STALE_DAYS) && a.value > 0;
    });
  }

  function renderStaleNote() {
    const wrap = $('#savingsStale'); wrap.empty();
    renderAssetCaveat(wrap);
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

  /* Named separately from the balances caveat and shown before it, because an
     out-of-date house valuation is usually the single largest input to the
     figure printed above and the reader should meet it first. */
  function renderAssetCaveat(wrap) {
    const stale = staleAssets();
    if (!stale.length) return;
    const owned = stale.reduce((t, a) => t + a.value, 0);
    wrap.append(el('div', { class: 'kpi-caveat-txt' }, icoEl(['info', 'alert-circle']),
      `${money(owned, 0)} of what you own was last valued over a year ago.`));
    const btn = el('button', { type: 'button', class: 'kpi-caveat-btn',
      'aria-label': 'Review asset valuations on the Assets page' }, 'Review valuations');
    btn.addEventListener('click', () => ctx.switchView('assets'));
    wrap.append(btn);
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

  function renderSections(savings, investments, idx) {
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
        /* What the balance is MADE of, derived from the account's own
           transactions: contributions are money the household put in, growth is
           what the account earned on its own. The old single figure —
           `balance − total_invested` — called the whole difference growth, and
           since nothing keeps total_invested in step with a debit order, every
           contribution was reported as performance. */
        const rows = (idx.get(a) || {}).rows || [];
        const flows = accountFlows(a, rows, catType);

        if (flows.basis === 'derived') {
          const g = flows.growth;
          const line = el('div', { class: 's2' }, `in ${money(flows.contributions, 0)}`);
          /* A zero growth figure is NOT a measurement of zero growth — it means
             nothing in this account posted a transaction the vault could read as
             growth. A unit trust normally posts none at all: the market moves,
             the balance is retyped, and no row is ever written. Printing "▲ R0"
             in green against that claims the fund went nowhere, which on the
             page named after these accounts is the worst place to guess. So the
             chip appears only when there is something to report. */
          if (g) {
            line.append(' · ', el('span', { class: `num ${g >= 0 ? 'text-success' : 'text-danger'}` },
              `${g >= 0 ? '▲' : '▼'} ${money(Math.abs(g), 0)}`));
          }
          if (flows.withdrawals) line.append(` · out ${money(flows.withdrawals, 0)}`);
          card.append(line);

          /* And say so outright where the silence is most likely to mislead.
             Only for investments, and only when no growth was recorded at all —
             a savings account crediting monthly interest has a real figure
             above and needs no explanation of one it does not have. */
          if (a.type === 'investment' && !g) {
            card.append(el('div', { class: 's2 s2-caveat',
              title: 'Growth only appears here when the account posts it as a transaction the vault can read. '
                + 'A fund whose value moves with the market posts nothing, so its growth is inside the balance '
                + 'you typed rather than in this line.' },
            'no growth recorded — it is inside the balance, not measured here'));
          }
          /* Growth is recognised by category TYPE, and income the household
             EARNED and then deposited here is income-type too — counselling
             fees paid into a savings account, a salary routed straight to it.
             Neither is growth: the household put that money in, the account did
             not earn it. Nothing in the data tells the two apart.

             So the categories are named ON the card rather than in a tooltip.
             On the vault this was built against, one account's growth was 41%
             counselling income — an error big enough that hiding it behind a
             hover would have been the same silent overstatement this whole
             change set out to end.

             Named whenever ANY category fed the figure, including a single one.
             Gating this at "more than one" withheld the disclosure in precisely
             the case that needs it most: where one category IS the whole figure,
             a wrong one makes the growth 100% wrong rather than 41% wrong — the
             card read "▲ R9 000" of consulting fees with nothing beside it. A
             redundant "growth from Interest R120" on the honest account is a
             cheap price for closing that. */
          if (flows.growthCategories.length) {
            card.append(el('div', { class: 's2 s2-caveat',
              title: 'Anything here that is not interest or dividends is really a contribution. '
                + 'Recategorise the rows, or change the category\'s type, and this figure corrects itself.' },
            'growth from ' + flows.growthCategories.map(c => `${c.cat} ${money(c.amount, 0)}`).join(', ')));
          }
        } else if (flows.basis === 'stated') {
          /* No transactions for this account, so the hand-typed baseline is the
             only signal there is. Shown, but never called derived. */
          const over = flows.growth;
          card.append(el('div', { class: `s2 num ${over >= 0 ? 'text-success' : 'text-danger'}` },
            `${over >= 0 ? '▲' : '▼'} ${money(Math.abs(over), 0)} vs ${money(flows.opening, 0)} in`));
          card.append(el('div', { class: 's2 s2-caveat',
            title: 'No transactions in the vault for this account, so this is the balance less what the '
              + 'account file records as put in. Import its statements and the split becomes real.' },
          'from the account file'));
        } else if (a.inception_date) {
          card.append(el('div', { class: 's2' }, `since ${a.inception_date}`));
        }

        /* Reconciliation — the same argument the Accounts page makes, on the
           page where the balance is largest and least often confirmed. */
        const rec = reconcile(a, rows);
        if (rec.state === 'drift') {
          const line = el('div', { class: 'acct-recon' },
            el('div', { class: 'acct-recon-txt' },
              `${rec.count} since · implies `, el('b', { class: 'num' }, money(rec.implied)),
              rec.ahead ? ` · ${rec.ahead} dated ahead` : ''));
          const btn = el('button', { type: 'button', class: 'acct-recon-btn',
            'aria-label': `Set ${a.name} balance to ${money(rec.implied)}` }, icoEl(['check']), 'Use this');
          btn.addEventListener('click', () => acceptImplied(a, rec.implied));
          line.append(btn);
          card.append(line);
          /* On a fund the implied figure is a FLOOR, not a correction, and the
             difference is the growth. An account confirmed at R200 000 that has
             taken three R2 000 debit orders since implies R206 000 — while the
             real balance, market included, is R214 000. Accepting that offer
             quietly writes off R8 000 and stamps the result as confirmed.

             The button stays: a fixed deposit that posts its interest as a real
             transaction reconciles exactly, and taking the offer away from those
             accounts to protect the others helps nobody. What it gets is the one
             sentence that stops it reading as a correction. */
          if (a.type === 'investment') {
            card.append(el('div', { class: 's2 s2-caveat',
              title: 'The implied figure adds up recorded movements only. Growth that never posted a '
                + 'transaction is not in it, so on a market-linked fund this figure is a floor rather '
                + 'than a correction — take it only if your provider agrees.' },
            'implied from recorded movements only — growth is not in it'));
          }
        } else if (rec.state === 'clean') {
          card.append(el('div', { class: 'acct-recon' },
            el('div', { class: 'acct-recon-txt text-success' }, 'Matches your transactions')));
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

  /* Colours for a type this list has never heard of — walked in order so the
     same unlisted type keeps the same colour between renders, exactly as the
     debt and asset walks below do. */
  const EXTRA_VARS = ['--color-warning', '--color-investment', '--color-info', '--ink-faint'];
  const EXTRA_FALLBACKS = ['#f5a524', '#6f42c1', '#0ea5e9', '#5f6779'];

  function renderWorth() {
    const wrap = $('#savingsWorth'); wrap.empty();
    const css = getComputedStyle(root);
    const c = themeColors(root);

    /* Split by SIGN, not by type: a cheque account overdrawn is a liability
       however it is labelled, and a credit card in credit is an asset.

       The grouping itself is worth.js's, not a filter written here, because a
       filter written here is what let an account of an unlisted type sit inside
       the net-worth tile and be absent from this chart — two net worths on one
       screen. Every account the vault holds now reaches a segment; a type this
       file has no label for keeps its own name and takes a walked colour. */
    const meta = new Map(WORTH_TYPES.map(([type, label, varName, fallback]) => [type, {
      label, color: (css.getPropertyValue(varName) || '').trim() || fallback,
    }]));
    /* Memoised BY TYPE, not by position in the walk. One unlisted type can
       reach both bars at once — two `tfsa` accounts, one in credit and one
       overdrawn — and drawing the same type in two colours on one chart says
       they are two different things. */
    const extraColors = new Map();
    const colorFor = type => {
      if (!extraColors.has(type)) {
        const i = extraColors.size;
        extraColors.set(type, (css.getPropertyValue(EXTRA_VARS[i % EXTRA_VARS.length]) || '').trim()
          || EXTRA_FALLBACKS[i % EXTRA_FALLBACKS.length]);
      }
      return extraColors.get(type);
    };
    const segFor = g => (g.known
      ? { label: meta.get(g.type).label, amount: g.amount, color: meta.get(g.type).color }
      : { label: g.type.replace(/_/g, ' '), amount: g.amount, color: colorFor(g.type) });
    const groups = accountGroups(S.accounts, WORTH_TYPES.map(([type]) => type));
    const assets = groups.owned.map(segFor);
    const debts = groups.owed.map(segFor);

    /* Assets-page rows, grouped by their own kind — the house, the car and the
       ring as three named blocks rather than one anonymous slab. Colours walk a
       fixed list for the same reason the debt colours below do. Deliberately
       appended AFTER the accounts so the bar reads bank money first and
       possessions second: the two are not equally liquid, and a chart that
       leads with a house implies you could spend it this week. */
    const ASSET_VARS = ['--color-accent', '--color-investment', '--color-info', '--ink-faint'];
    const ASSET_FALLBACKS = ['#0d9488', '#6f42c1', '#0ea5e9', '#5f6779'];
    assetsByType(S.assets).forEach((a, i) => {
      const color = (css.getPropertyValue(ASSET_VARS[i % ASSET_VARS.length]) || '').trim()
        || ASSET_FALLBACKS[i % ASSET_FALLBACKS.length];
      assets.push({ label: a.type, amount: a.amount, color, fromAssetPage: true });
    });

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
    // Name every ledger the bar is drawn from. The subtitle is not a
    // disclosure — the figures are all actually IN the chart — but a reader
    // who cannot tell which pages fed it has no way to check it.
    const ledgers = ['your accounts',
      ...(S.assets && S.assets.some(a => a.value > 0) ? ['the Assets page'] : []),
      ...(active.length ? ['the Debt page'] : [])];
    const across = ledgers.length > 1
      ? `Across ${ledgers.slice(0, -1).join(', ')} and ${ledgers[ledgers.length - 1]}`
      : 'Across your accounts';
    $('#savingsWorthSub').textContent = overlap
      ? `${across} · a credit card appears on two of them, so it may be counted twice`
      : across;

    if (!totalAssets && !totalDebts) {
      wrap.append(el('p', { class: 'text-muted', style: 'margin:0' },
        'Add a balance to any account and the split appears here.'));
      return;
    }

    const W = 1000, H = 210, padL = 8, padR = 8, barH = 46;
    const scale = Math.max(totalAssets, totalDebts, 1);
    const innerW = W - padL - padR;

    /* Every id minted below is per-render. Two plugin leaves open at once put
       two of these charts in one document, and a repeated clipPath or gradient
       id means the second bar silently references the first one's — the same
       trap areaGradient() documents in chart.js. */
    const uid = `bud-worth-${++worthSeq}`;

    /* The segment <title>s below are the ONLY thing a pointer gets, but they are
       invisible to a screen reader: createChart marks the svg role="img", which
       collapses the whole thing to one node and hides its children. So the
       breakdown has to be in the label itself, or a non-sighted reader gets two
       totals and no composition — and on a desktop, where the titles are
       dropped in favour of the tooltip, nothing at all. */
    const listFor = segs => segs.map(s => `${s.label} ${money(s.amount, 0)}`).join(', ');
    const { svg, add } = createChart({
      w: W, h: H, cls: 'worth-svg',
      label: `Net worth ${money(net)}: assets ${money(totalAssets)} against debts ${money(totalDebts)}`
        + (assets.length ? `. Owned: ${listFor(assets)}` : '')
        + (debts.length ? `. Owed: ${listFor(debts)}` : ''),
    });
    const defs = add('defs', {});

    /* A single top-to-bottom sheen laid over every bar — the "glow". Drawn as
       SVG rather than a CSS filter because it has to survive the iOS 15 floor
       untouched, and because a gradient overlay costs nothing to composite. */
    const sheen = add('linearGradient', { id: `${uid}-sheen`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    add('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': '0.22' }, sheen);
    add('stop', { offset: '48%', 'stop-color': '#ffffff', 'stop-opacity': '0.05' }, sheen);
    add('stop', { offset: '100%', 'stop-color': '#000000', 'stop-opacity': '0.08' }, sheen);

    /* Hover is a real capability question, not a screen-size one. Where there
       is a fine pointer the HTML tooltip below reads better and lands instantly,
       so the native <title> is left off — two tooltips for one segment is worse
       than either. Where there is not (every phone, which is where this plugin
       mostly lives) nothing changes: touch-and-hold still shows the <title> it
       always did, and no hover-only affordance is invented for a finger. */
    const hoverable = typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const tipBox = el('div', { class: 'worth-tip', 'aria-hidden': 'true' });
    const tipName = el('div', { class: 'worth-tip-name' });
    const tipVal = el('div', { class: 'worth-tip-val num' });
    tipBox.append(tipName, tipVal);

    const clearHover = () => {
      svg.classList.remove('is-hover');
      for (const n of svg.querySelectorAll('.worth-seg.is-on')) n.classList.remove('is-on');
      tipBox.classList.remove('is-on');
    };

    const row = (y, segs, total, heading, idx) => {
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

      /* The bar wipes in left to right behind a clip rect rather than each
         segment growing from its own left edge — segments are adjacent, so
         growing them individually opens gaps between them for the length of
         the animation and reads as a broken chart rather than an entering one. */
      const clip = add('clipPath', { id: `${uid}-wipe-${idx}` }, defs);
      add('rect', {
        class: `worth-wipe${idx ? ' worth-wipe--b' : ''}`,
        x: padL, y, width: innerW, height: barH,
      }, clip);
      const band = add('g', { 'clip-path': `url(#${uid}-wipe-${idx})` });

      let x = padL;
      for (const seg of segs) {
        const w = (seg.amount / scale) * innerW;
        const share = Math.round((seg.amount / total) * 100);
        /* The glow is the segment's OWN colour at low alpha, so it reads as the
           block lighting up rather than a generic highlight landing on it. The
           fill arrives as a resolved rgb() from getComputedStyle or as a hex
           fallback; parseColor takes both, and a colour it cannot read simply
           gets no glow rather than an invented one. */
        const rgb = parseColor(seg.color);
        const g = add('g', {
          class: 'worth-seg',
          style: rgb
            ? `--seg-soft:rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.28);` +
              `--seg-glow:rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.6)`
            : null,
        }, band);
        const node = add('rect', {
          x, y, width: Math.max(2, w), height: barH,
          fill: seg.color, rx: w > 20 ? 10 : 2,
        }, g);
        if (hoverable) {
          g.addEventListener('pointerenter', () => {
            svg.classList.add('is-hover');
            for (const n of svg.querySelectorAll('.worth-seg.is-on')) n.classList.remove('is-on');
            g.classList.add('is-on');
            tipName.textContent = seg.label;
            tipVal.textContent = `${money(seg.amount)} · ${share}% of ${heading.toLowerCase()}`;
            tipBox.classList.add('is-on');
          });
        } else {
          tip(add, node, `${seg.label}: ${money(seg.amount)} · ${share}% of ${heading.toLowerCase()}`);
        }
        // Only label a segment wide enough to hold the text without clipping.
        if (w > 96) {
          add('text', {
            x: x + w / 2, y: y + barH / 2 + 5, 'text-anchor': 'middle',
            'font-size': '13', 'font-weight': '600', fill: c.hole, 'font-family': 'inherit',
          }, g).textContent = seg.label;
        }
        x += w;
      }

      /* Laid over the finished row, and only as far as the row actually runs —
         a sheen across the empty track would draw a ghost bar the full width of
         the chart. Inert to the pointer so it cannot steal a segment's hover. */
      add('rect', {
        x: padL, y, width: (total / scale) * innerW, height: barH, rx: 10,
        fill: `url(#${uid}-sheen)`, 'pointer-events': 'none',
      }, band);
    };

    row(34, assets, totalAssets, 'What you own', 0);
    row(132, debts, totalDebts, 'What you owe', 1);

    if (hoverable) {
      /* Positioned from the pointer rather than from the segment: a segment can
         be most of the chart wide, and a tooltip parked at its centre ends up
         nowhere near the cursor. Measured at pointer time, which is the one
         moment the chart is guaranteed to be on screen — the standing rule
         against DOM measurement here is about rendering into a hidden tab. */
      svg.addEventListener('pointermove', e => {
        if (!tipBox.classList.contains('is-on')) return;
        const r = svg.getBoundingClientRect();
        const pad = Math.min(60, r.width / 2);
        tipBox.style.left = `${Math.max(pad, Math.min(e.clientX - r.left, r.width - pad))}px`;
        tipBox.style.top = `${e.clientY - r.top}px`;
      });
      svg.addEventListener('pointerleave', clearHover);
    }

    wrap.append(svg, tipBox);

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
