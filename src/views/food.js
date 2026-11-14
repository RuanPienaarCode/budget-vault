'use strict';
/* Food — what the grocery receipts say was bought, for the period in the
   header pill.

   The bank says "Checkers R640.00"; this page says that R640.00 was two
   chickens, a honey, three tins of tuna and R40.00 of XTRASAVE. It reads the
   receipt files under Receipts/ (receipt-file.js has the contract) and
   nothing it shows feeds a budget total — the bank line is still the figure
   the Budget and Dashboard count. Which is also why this page can be wrong
   without harm: an unread line, a slip never saved, a product filed under
   the wrong category moves a figure HERE and nowhere else.

   What it argues rather than hides:
     - coverage: how much of the period's Food-typed bank spend has a slip
       behind it — the category totals below describe only that much;
     - a receipt with no bank line yet is listed as such, and links itself
       when the statement arrives (matching is derived on every render).

   Writes: a new receipt file (Add receipt), and re-filing a product — Food
   Items.md plus the Category cell of every receipt carrying it. Each write
   happens in the same interaction, so there is no draft to protect and no
   registerDirty, the same choice views/notes.js records. */

const { opWriterOf } = require('../io');
const { el, kpiTiles, icoEl, caveatChip, tableCells, refocus } = require('../dom');
const { isSplitPart } = require('../tx-role');
const { splitAroundTable } = require('../markdown');
const { SCHEMAS } = require('../table-schema');
const {
  FOOD_ITEMS_FILE, FOOD_CATEGORIES, OTHER, itemKey, parseFoodItems, mergeFoodItems, coverage,
  serializeReceipt, serializeFoodItems, refileReceiptText, receiptPath,
  matchReceipts, foodSummary, receiptPaid, foodTrend, priceChange, versusLastPeriod,
} = require('../receipt-file');
const {
  RANGES, rangePills, createChart, scales, gridlines, axisLabels, linePath,
  trackPoints, themeColors, SLICE_PALETTE, phoneWidth,
} = require('../chart');
const { askReceipt } = require('../receipt-modal');
// For the accessible names only — the page's visible copy is still English
// (EXPECTED_ENGLISH_ONLY in tests/i18n-render.test.cjs). Namespaced, as
// everywhere in src/.
const i18n = require('../i18n');

module.exports = function registerFood(ctx) {
  const { S, $, app, plugin, toast, money, readFile, writeFile, fileAt, pathTaken, periodRange, currentPeriod, catType, dateText,
    periodShortLabel } = ctx;

  /* Seeded here for the reason views/notes.js seeds S.noteFilter: the view
     that reads the shape owns it, so it cannot be undefined anywhere the
     loader has not run yet. */
  S.receipts = S.receipts || [];
  S.foodItems = S.foodItems || new Map();
  S.foodFilter = S.foodFilter || { cat: '', q: '' };
  S.foodOpen = S.foodOpen || null;     // the Items row whose price chart is open

  /* Every statement line the bank printed, across every month on disk. Split
     PARTS are left out (tx-role.js, the single door): a part is a category a
     reader drew inside a charge, and no till slip was ever for one. The
     parent keeps the amount the card was charged, which is what a slip's
     total is. */
  function statementLines() {
    const out = [];
    for (const f of Object.values(S.txFiles || {})) {
      f.rows.forEach((r, i) => {
        if (isSplitPart(r) || typeof r.amount !== 'number') return;
        out.push({ key: `${f.label}/${f.month}#${i}`, date: r.date, amount: r.amount, desc: r.desc || '', label: f.label, row: r });
      });
    }
    return out;
  }

  /* All categories a product could be filed under: the starter list, every
     one the household has used, in that order. */
  function categoryChoices() {
    const used = new Set();
    for (const v of S.foodItems.values()) if (v.category) used.add(v.category);
    for (const r of S.receipts) for (const it of r.items) if (it.category) used.add(it.category);
    return [...new Set([...FOOD_CATEGORIES, ...[...used].sort()])];
  }

  /* ------------------------------ render -------------------------------- */
  function renderFood() {
    const { start, end } = periodRange(S.period);
    const lines = statementLines();
    const matches = matchReceipts(S.receipts, lines);
    const sum = foodSummary(S.receipts, start, end);
    const win = foodWindow();
    /* The period before the one in the header, for the Items table's Last
       month column — the same period the header's ‹ arrow would show. */
    const prev = periodRange(ctx.shiftPeriod(S.period, -1));
    const vs = versusLastPeriod(sum, foodSummary(S.receipts, prev.start, prev.end));

    /* Coverage (receipt-file.js has the rule). "Food" is the budget's own
       reading of a line — a Food-typed category, not excluded — so a line
       the Budget page leaves out is left out here too. */
    const matchedKeys = new Set([...matches.values()].map(t => t.key));
    const { spend: foodSpend, covered } = coverage(lines, matchedKeys, start, end,
      t => catType(t.row.cat) === 'food' && !t.row.excluded);

    const tile = kpiTiles($('#foodKpis'));
    tile('Spent on receipts', money(sum.spend), '', `${sum.receipts} receipt${sum.receipts === 1 ? '' : 's'} this period`);
    tile('Discounts', money(sum.saved), sum.saved > 0 ? 'text-success' : '', 'XTRASAVE, specials and till rounding');
    tile('Healthy', sum.spend > 0 ? `${Math.round(sum.healthyShare * 100)}%` : '—', '',
      sum.spend > 0 ? `${money(sum.healthy)} on (V) HealthyFood lines` : 'no receipts this period');
    /* How much of the period's receipt spend is filed into a real category,
       and how much still sits in Other (blank cells included) — the rand
       figure the By category list cannot be trusted past until it is small. */
    tile('Categorised', sum.spend > 0 ? money(sum.categorised) : '—',
      sum.spend > 0 && sum.uncategorised < 0.005 ? 'text-success' : '',
      sum.spend > 0 ? `${money(sum.uncategorised)} uncategorised (in ${OTHER})` : 'no receipts this period');
    const covTile = tile('With a receipt', foodSpend > 0 ? `${Math.round((covered / foodSpend) * 100)}%` : '—', '',
      foodSpend > 0 ? `${money(covered)} of ${money(foodSpend)} grocery spend` : 'no Food spend on the bank this period');
    if (foodSpend > 0 && covered < foodSpend - 0.005) {
      covTile.append(caveatChip('why not 100%?',
        'The categories below describe only the shops you saved a slip for. Food spend on the bank with no matching receipt — a takeaway, a shop you did not keep the slip for, a statement not imported yet — cannot be broken down here. This figure reads the bank lines as they are filed; the Budget page applies its own rules (foreign-currency and set-aside accounts), so the two need not agree to the cent.'));
    }

    renderTrend(win);
    renderCategories(sum);
    renderItems(sum, win, vs);
    renderReceipts(matches, start, end);
  }

  function renderCategories(sum) {
    const box = $('#foodCats');
    box.empty();
    if (!sum.byCategory.length) {
      box.append(el('p', { class: 'text-muted food-empty' },
        S.receipts.length ? 'No receipts dated in this period.' : 'No receipts yet. Add one and its lines are filed into categories here.'));
      return;
    }
    const top = sum.byCategory[0].amount || 1;
    for (const c of sum.byCategory) {
      const share = sum.spend > 0 ? c.amount / sum.spend : 0;
      const active = S.foodFilter.cat === c.category;
      /* The press filters the Items table and redraws the whole page, this
         list with it, so the row pressed was destroyed by its own press and
         focus fell to <body> (audit of 11 Nov 2026, task 16). The reader is
         put back on the same category, which now reads pressed — or no longer
         does (dom.js refocus). Keyed by the category's name: the list is
         sorted by spend, and a name is on it once. */
      const row = el('button', {
        type: 'button', class: 'food-cat-row' + (active ? ' is-active' : ''),
        'aria-pressed': active ? 'true' : 'false',
        'data-focus-key': `cat:${c.category}`,
        onclick: () => { S.foodFilter.cat = active ? '' : c.category; renderFood(); refocus(box, `cat:${c.category}`); },
      },
      el('span', { class: 'food-cat-name' }, c.category),
      el('span', { class: 'food-cat-bar', 'aria-hidden': 'true' },
        el('span', { class: 'food-cat-fill', style: `width:${Math.max(2, Math.round((c.amount / top) * 100))}%` })),
      el('span', { class: 'food-cat-amt num' }, money(c.amount)),
      el('span', { class: 'food-cat-pct num text-muted' }, `${Math.round(share * 100)}%`));
      box.append(row);
    }
  }

  /* ------------------------------ over time ------------------------------ */

  /* 3M, 6M, 1Y — what was asked for, and all a receipt history this young can
     honestly fill. The window ends at the period in the header pill, like the
     Dashboard trend, so stepping the pill back steps the chart back. */
  const FOOD_RANGES = RANGES.filter(r => ['3m', '6m', '1y'].includes(r.key));
  /* The most category lines one chart can carry and stay readable; the rest
     are summed into one "Everything else" line so the totals still add up. */
  const MAX_LINES = 6;

  function foodWindow() {
    const range = FOOD_RANGES.find(r => r.key === (plugin.settings || {}).chartFoodRange) || FOOD_RANGES[1];
    /* Period keys straight back from the header pill, NOT trendPeriods: that
       stops at the oldest bank statement, and a household's receipts can
       start long after it — the gap is drawn as a gap either way. */
    const want = ctx.periodsForMonths ? ctx.periodsForMonths(range.months) : range.months;
    const keys = [];
    for (let i = want - 1; i >= 0; i--) keys.push(ctx.shiftPeriod(S.period, -i));
    const periods = keys.map(k => ({ key: k, ...periodRange(k), label: periodShortLabel(k) }));
    return { range, periods, start: periods[0].start };
  }

  function renderTrend(win) {
    const pills = $('#foodTrendRange');
    pills.empty();
    pills.append(rangePills({
      ranges: FOOD_RANGES, value: win.range.key, label: i18n.t('food.aria.range'),
      onPick: async key => {
        plugin.settings.chartFoodRange = key;
        try { await plugin.saveSettings(); } catch (e) { toast(`Could not save the chart range: ${e.message || e}`, true); }
        renderFood();
      },
    }));

    const t = foodTrend(S.receipts, win.periods);
    const wrap = $('#foodTrendChart');
    const legend = $('#foodTrendLegend');
    wrap.empty(); legend.empty();
    const coveredCount = t.covered.filter(Boolean).length;
    $('#foodTrendSub').textContent = coveredCount
      ? `What was paid per period, by category · ${coveredCount} of ${win.periods.length} periods have receipts`
      : 'What was paid per period, by category';
    if (!coveredCount) {
      wrap.append(el('p', { class: 'text-muted food-empty' },
        'No receipts in this window yet. Each slip you add becomes a point here.'));
      return;
    }

    /* Biggest categories get their own line; the tail is summed. */
    let lines = t.categories.slice(0, MAX_LINES).map(c => ({ name: c, values: t.series[c] }));
    if (t.categories.length > MAX_LINES) {
      const rest = t.categories.slice(MAX_LINES);
      lines.push({ name: 'Everything else', values: win.periods.map((_, i) =>
        (t.covered[i] ? Math.round(rest.reduce((a, c) => a + t.series[c][i], 0) * 100) / 100 : null)) });
    }
    lines = lines.map((l, i) => ({ ...l, color: SLICE_PALETTE[i % SLICE_PALETTE.length] }));

    const W = 1000, H = 280;
    const max = Math.max(1, ...lines.flatMap(l => l.values.filter(v => v != null))) * 1.12;
    const s = scales({ w: W, h: H, count: win.periods.length, max, padL: 24, padR: 24, padB: phoneWidth() ? 52 : 40 });
    const { svg, add } = createChart({ w: W, h: H,
      label: i18n.t('food.aria.trend', { count: win.periods.length, categories: lines.map(l => l.name).join(', ') }) });
    gridlines(add, s, W);
    axisLabels(add, s, win.periods.map(p => p.label), H);

    /* One path per unbroken run of covered periods, a dot on every covered
       point — with one or two slips saved, the dots ARE the chart. */
    for (const l of lines) {
      let run = [];
      const flush = () => { if (run.length > 1) add('path', { d: linePath(run), fill: 'none', stroke: l.color, 'stroke-width': '2.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }); run = []; };
      l.values.forEach((v, i) => {
        if (v == null) { flush(); return; }
        run.push([s.x(i), s.y(v)]);
        add('circle', { cx: s.x(i), cy: s.y(v), r: '4', fill: l.color });
      });
      flush();
    }
    const guide = add('line', { x1: 0, x2: 0, y1: s.padT, y2: s.baseline, stroke: 'currentColor', 'stroke-opacity': '0', 'stroke-width': '1' });
    wrap.append(svg);

    /* The legend doubles as the readout: it shows the window's totals, and
       the focused period's figures while a point is being inspected — one
       place to read, on a phone as on a desktop. */
    const firstLast = vals => {
      const pts = vals.map((v, i) => [v, i]).filter(([v]) => v != null);
      return pts.length > 1 ? [pts[0][0], pts[pts.length - 1][0]] : null;
    };
    const head = el('div', { class: 'food-legend-head text-muted' });
    legend.append(head);
    const rows = lines.map(l => {
      const val = el('span', { class: 'food-legend-v num' });
      const delta = el('span', { class: 'food-legend-d num' });
      legend.append(el('div', { class: 'food-legend-row' },
        el('span', { class: 'food-legend-dot', style: `background:${l.color}` }), el('span', { class: 'food-legend-n' }, l.name), val, delta));
      return { l, val, delta };
    });
    const showWindow = () => {
      head.textContent = `Total over ${win.range.label} · change from first to last period with receipts`;
      guide.setAttribute('stroke-opacity', '0');
      for (const { l, val, delta } of rows) {
        val.textContent = money(l.values.reduce((a, v) => a + (v || 0), 0));
        const fl = firstLast(l.values);
        delta.className = 'food-legend-d num';
        if (!fl || !fl[0]) { delta.textContent = ''; continue; }
        const pct = Math.round(((fl[1] - fl[0]) / fl[0]) * 100);
        delta.textContent = `${pct > 0 ? '▲ +' : pct < 0 ? '▼ ' : ''}${pct}%`;
        delta.classList.add(pct > 0 ? 'text-danger' : pct < 0 ? 'text-success' : 'text-muted');
      }
    };
    const showPeriod = i => {
      head.textContent = win.periods[i].label + (t.covered[i] ? '' : ' · no receipts saved');
      guide.setAttribute('x1', s.x(i)); guide.setAttribute('x2', s.x(i)); guide.setAttribute('stroke-opacity', '0.25');
      for (const { l, val, delta } of rows) {
        val.textContent = l.values[i] == null ? '—' : money(l.values[i]);
        delta.textContent = '';
      }
    };
    showWindow();
    trackPoints({ svg, w: W, xs: win.periods.map((_, i) => s.x(i)), onFocus: showPeriod, onClear: showWindow });
  }

  /* One product's shelf price at every purchase in the chart window. */
  function priceChart(it, win) {
    const pts = it.prices.filter(p => p.date >= win.start);
    const pc = priceChange(it.prices, win.start);
    const box = el('div', { class: 'food-price-detail' });
    if (!pc) { box.append(el('p', { class: 'text-muted' }, `Not bought in the last ${win.range.label}.`)); return box; }
    const verb = pc.change > 0 ? 'up' : pc.change < 0 ? 'down' : 'unchanged';
    box.append(el('p', { class: 'food-price-sum' },
      pc.n === 1 ? `Bought once in the last ${win.range.label}, at ${money(pc.first)}.`
        : `${money(pc.first)} → ${money(pc.last)} over ${pc.n} purchases in the last ${win.range.label}: `
          + (pc.change ? `${verb} ${money(Math.abs(pc.change))} (${pc.pct > 0 ? '+' : ''}${Math.round(pc.pct * 100)}%).` : 'no change.')));
    if (pts.length < 2) return box;
    const W = 600, H = 170;
    const lo = Math.min(...pts.map(p => p.amount)), hi = Math.max(...pts.map(p => p.amount));
    const pad = Math.max(1, (hi - lo) * 0.25);
    const s = scales({ w: W, h: H, count: pts.length, max: hi + pad, min: Math.max(0, lo - pad), padL: 20, padR: 20, padT: 18, padB: phoneWidth() ? 48 : 34 });
    const { svg, add } = createChart({ w: W, h: H, cls: 'food-price-svg',
      label: i18n.t('food.aria.price', { name: it.name, first: money(pc.first), last: money(pc.last) }) });
    const c = themeColors(ctx.root);
    gridlines(add, s, W, 3);
    /* Two purchases on one day share one label — "Oct 3, Oct 3" says less. */
    axisLabels(add, s, pts.map((p, i) => (i && pts[i - 1].date === p.date ? '' : dateText(p.date))), H, { maxLabels: 6 });
    add('path', { d: linePath(pts.map((p, i) => [s.x(i), s.y(p.amount)])), fill: 'none', stroke: c.primary || 'currentColor', 'stroke-width': '2.5' });
    pts.forEach((p, i) => {
      const dot = add('circle', { cx: s.x(i), cy: s.y(p.amount), r: '4.5', fill: c.primary || 'currentColor' });
      add('title', {}, dot).textContent = `${dateText(p.date)}: ${money(p.amount)}`;
    });
    box.append(svg);
    return box;
  }

  function renderItems(sum, win, vs) {
    const sel = $('#foodCatFilter');
    const keep = S.foodFilter.cat;
    sel.empty();
    sel.append(el('option', { value: '' }, 'All categories'));
    for (const c of sum.byCategory) sel.append(el('option', { value: c.category }, c.category));
    sel.value = sum.byCategory.some(c => c.category === keep) ? keep : '';
    if (sel.value !== keep) S.foodFilter.cat = sel.value;
    $('#foodSearch').value = S.foodFilter.q;

    const q = S.foodFilter.q.trim().toLowerCase();
    const rows = sum.items.filter(it =>
      (!S.foodFilter.cat || it.category === S.foodFilter.cat) && (!q || it.name.toLowerCase().includes(q)));
    const body = $('#foodItemsBody');
    body.empty();
    if (!rows.length) {
      body.append(el('tr', {}, el('td', { colspan: '7', class: 'text-muted' },
        sum.items.length ? 'Nothing matches this filter.' : 'Nothing bought on a saved receipt this period.')));
      return;
    }
    const cats = categoryChoices();
    /* Each of a row's three controls redraws the page under itself, and says
       where the reader should be afterwards (dom.js refocus). Keyed by the
       PRODUCT (receipt-file.js rowKey), not the row's position: the table is
       sorted by what was spent, and a row is a product once. Re-filing is the
       one press that can take its own row off the page — with the category
       filter on, a product moved to another category is no longer in the list
       — and then the landing is the row that moved up, else the one above,
       else the filter that is hiding it. On that row it is the product's
       NAME, never its category select: on Windows and Linux an arrow key on a
       closed select is a `change`, so a reader arrowing down a list of
       categories would have re-filed the product, been put on the next
       product's select, and re-filed that one with the very next press —
       one product per keystroke, down the page (review of this change). The
       name only opens a price chart. A re-file is several file writes, so a
       reader who has moved on by the time it finishes is left where they
       went: refocus only restores. */
    rows.forEach((it, n) => {
      const after = prefix => [`${prefix}:${it.key}`,
        rows[n + 1] ? `item:${rows[n + 1].key}` : null,
        rows[n - 1] ? `item:${rows[n - 1].key}` : null, sel];
      const catSel = el('select', { class: 'form-select form-select-sm', 'aria-label': i18n.t('food.aria.category', { name: it.name }),
        'data-focus-key': `filed:${it.key}` });
      for (const c of new Set([...cats, it.category])) catSel.append(el('option', { value: c }, c));
      catSel.value = it.category;
      catSel.addEventListener('change', async () => { await refile(it, { category: catSel.value }); refocus(body, after('filed')); });
      const healthyBox = el('input', { type: 'checkbox', 'aria-label': i18n.t('food.aria.healthy', { name: it.name }),
        'data-focus-key': `healthy:${it.key}` });
      healthyBox.checked = !!it.healthy;
      healthyBox.addEventListener('change', async () => { await refile(it, { healthy: healthyBox.checked }); refocus(body, after('healthy')); });
      /* Against last month when it was bought then — the question the
         column beside it asks — else against the start of the chart window,
         so the arrow agrees with the price chart one tap away. Each says
         which it is. */
      const last = it.lastPrice;
      const lm = vs.get(it.key);
      const move = (delta, cls, text) => el('div', { class: `food-price-move ${delta > 0 ? cls[0] : cls[1]}` }, text);
      const priceCell = el('td', { class: 'num' }, money(last));
      const pc = priceChange(it.prices, win.start);
      if (lm && lm.priceChange) {
        priceCell.append(move(lm.priceChange, ['text-danger', 'text-success'],
          `${lm.priceChange > 0 ? '▲' : '▼'} from ${money(lm.price)} last month`));
      } else if (!lm && pc && pc.change) {
        priceCell.append(move(pc.change, ['text-danger', 'text-success'],
          `${pc.change > 0 ? '▲' : '▼'} from ${money(pc.first)} in ${win.range.label}`));
      }
      const spentCell = el('td', { class: 'num' }, money(it.amount));
      if (lm && lm.spentChange) {
        spentCell.append(move(lm.spentChange, ['text-danger', 'text-success'],
          `${lm.spentChange > 0 ? '▲' : '▼'} ${money(Math.abs(lm.spentChange))} ${lm.spentChange > 0 ? 'more' : 'less'}`));
      }
      const lastMonthCell = lm
        ? el('td', { class: 'num' }, money(lm.spent), el('div', { class: 'food-price-move text-muted' }, `at ${money(lm.price)}`))
        : el('td', { class: 'num text-muted' }, '—');
      const open = S.foodOpen === it.key;
      const nameBtn = el('button', {
        type: 'button', class: 'food-item-name', 'aria-expanded': open ? 'true' : 'false',
        'data-focus-key': `item:${it.key}`,
        onclick: () => { S.foodOpen = open ? null : it.key; renderFood(); refocus(body, `item:${it.key}`); },
      }, it.name);
      body.append(el('tr', { class: open ? 'is-open' : '' },
        el('td', {}, nameBtn),
        el('td', {}, catSel),
        el('td', { class: 'food-chk' }, healthyBox),
        el('td', { class: 'num' }, String(it.count)),
        spentCell,
        lastMonthCell,
        priceCell));
      if (open) body.append(el('tr', { class: 'food-item-detail' }, el('td', { colspan: '7' }, priceChart(it, win))));
    });
    /* data-label per cell, so the phone layout can fold each row into a
       card with its own captions (src/styles.css, Food). */
    tableCells($('#foodItemsTable'), ['Item', 'Category', 'Healthy', 'Bought', 'Spent', 'Last month', 'Last price']);
  }

  function renderReceipts(matches, start, end) {
    const body = $('#foodReceiptsBody');
    body.empty();
    const inRange = S.receipts.filter(r => r.date >= start && r.date <= end);
    const unmatchedElsewhere = S.receipts.filter(r => !(r.date >= start && r.date <= end) && !matches.has(r.rel)).length;
    if (!inRange.length) {
      body.append(el('tr', {}, el('td', { colspan: '5', class: 'text-muted' }, 'No receipts dated in this period.')));
    }
    inRange.forEach((r, n) => {
      const t = matches.get(r.rel);
      const paid = receiptPaid(r);
      const off = r.total != null && Math.round(paid * 100) !== Math.round(r.total * 100);
      const bank = t
        ? el('span', {}, `${t.label} · ${dateText(t.date)}`)
        : el('span', { class: 'text-warning' }, 'No bank line yet');
      const totalCell = el('td', { class: 'num' }, money(r.total == null ? paid : r.total));
      if (off) totalCell.append(caveatChip('lines differ', `The lines on this receipt add up to ${money(paid)}, not the slip total of ${money(r.total)}. Open it to check a line against the paper.`));
      body.append(el('tr', {},
        el('td', { class: 'num' }, `${dateText(r.date)}${r.time ? ' ' + r.time : ''}`),
        el('td', {}, r.store),
        totalCell,
        el('td', {}, bank),
        el('td', {}, el('button', { class: 'btn-ghost btn-ghost-sm', 'data-focus-key': `open:${n}`, onclick: () => openReceipt(r, n) },
          icoEl(['file-text', 'file']), 'Open'))));
    });
    tableCells($('#foodReceiptsTable'), ['Date', 'Shop', 'Total', 'Bank line', null]);
    $('#foodReceiptsNote').textContent = unmatchedElsewhere
      ? `${unmatchedElsewhere} receipt${unmatchedElsewhere === 1 ? '' : 's'} in other periods still ha${unmatchedElsewhere === 1 ? 's' : 've'} no bank line.`
      : '';
  }

  /* `n` is the row's position in the receipts table. Only the vanished-file
     branch redraws, and it takes the row that was pressed off the page: the
     receipt that moved up into its place, else the one above, else Add
     receipt. An Open that opens is left alone — the reader is in the new tab,
     and pulling focus back here would take them out of it. */
  async function openReceipt(r, n) {
    const f = fileAt(r.rel);
    if (!f) {
      await ctx.loadReceipts(); renderFood();
      refocus($('#foodReceiptsBody'), [`open:${n}`, `open:${n - 1}`, $('#foodAdd')]);
      return toast('That receipt is no longer in the vault', true);
    }
    await app.workspace.getLeaf('tab').openFile(f);
  }

  /* ------------------------------ writing ------------------------------- */

  /* Remember how a product is filed. Written only when it changes, and from
     the file's current bytes (readFile clears io.js's staleness latch), so a
     line the reader added to Food Items.md by hand survives. */
  async function rememberItems(items, op = opWriterOf(ctx)) {
    const text = await readFile(FOOD_ITEMS_FILE);
    const map = text ? parseFoodItems(text) : new Map();
    if (!mergeFoodItems(map, items)) return;
    let lead = null, trail = null;
    if (text) ({ before: lead, after: trail } = splitAroundTable(text, SCHEMAS.foodItems.columns[0].header));
    await op.writeFile(FOOD_ITEMS_FILE, serializeFoodItems(map, { lead, trail }));
  }

  async function addReceipt() {
    /* The slip is typed for the book on screen: the dialog, the receipt write
       and the Food Items write are bound to this load (io.js opWriter). */
    const op = opWriterOf(ctx, { book: true });   // bound to the BOOK, not the exact load: this only creates from what is typed (io.js opWriter({ book: true }))
    const got = await askReceipt(app, { money, foodItems: S.foodItems, categories: categoryChoices() });
    if (!got) return;
    if (op.replaced()) return toast(op.replaced(), true);
    let rel = receiptPath(got);
    for (let n = 2; pathTaken(rel); n++) rel = receiptPath(got).replace(/\.md$/, ` ${n}.md`);
    try {
      await op.writeFile(rel, serializeReceipt(got));
      await rememberItems(got.items, op);
    } catch (e) {
      return toast(`Could not save the receipt: ${e.message || e}`, true);
    }
    await ctx.loadReceipts();
    /* Jump the header pill to the receipt's own period, so the reader sees
       what they just saved rather than an unchanged page. */
    S.period = currentPeriod(got.date);
    toast(`Saved ${got.items.length} line${got.items.length === 1 ? '' : 's'} from ${got.store}`);
    ctx.render();
  }

  /* Re-file one Items row everywhere it appears. A row is a product NAME
     (receipt-file.js rowKey), so it can stand for several barcodes — every
     one of them is remembered and rewritten, or the next receipt carrying
     the other barcode would arrive filed the old way. */
  async function refile(it, change) {
    const category = change.category ?? it.category;
    const healthy = change.healthy ?? it.healthy;
    /* `it` and S.receipts are this load's, and the loop below reads and writes
       one receipt at a time: one load for all of it (io.js opWriter), so a
       reload committing mid-loop stops it instead of re-filing the next book's
       receipts of the same name. */
    const op = opWriterOf(ctx);
    try {
      await rememberItems(it.members.map(m => ({ ...m, category, healthy })), op);
      const keys = new Set(it.members.map(itemKey));
      for (const r of S.receipts) {
        if (!r.items.some(x => keys.has(itemKey(x)))) continue;
        let text = await readFile(r.rel);
        if (text == null) continue;
        let changed = false;
        for (const key of keys) {
          const out = refileReceiptText(text, key, change);
          if (out != null) { text = out; changed = true; }
        }
        if (changed) await op.writeFile(r.rel, text);
      }
    } catch (e) {
      toast(`Could not re-file ${it.name}: ${e.message || e}`, true);
    }
    await ctx.loadReceipts();
    renderFood();
  }

  ctx.provide({ renderFood, addFoodReceipt: addReceipt });
};
