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

const { el, kpiTiles, icoEl, caveatChip, tableCells } = require('../dom');
const { isSplitPart } = require('../tx-role');
const { splitAroundTable } = require('../markdown');
const { SCHEMAS } = require('../table-schema');
const {
  FOOD_ITEMS_FILE, FOOD_CATEGORIES, itemKey, parseFoodItems, mergeFoodItems, coverage,
  serializeReceipt, serializeFoodItems, refileReceiptText, receiptPath,
  matchReceipts, foodSummary, receiptPaid,
} = require('../receipt-file');
const { askReceipt } = require('../receipt-modal');

module.exports = function registerFood(ctx) {
  const { S, $, app, toast, money, readFile, writeFile, fileAt, pathTaken, periodRange, currentPeriod, catType, dateText } = ctx;

  /* Seeded here for the reason views/notes.js seeds S.noteFilter: the view
     that reads the shape owns it, so it cannot be undefined anywhere the
     loader has not run yet. */
  S.receipts = S.receipts || [];
  S.foodItems = S.foodItems || new Map();
  S.foodFilter = S.foodFilter || { cat: '', q: '' };

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

    /* Coverage (receipt-file.js has the rule). "Food" is the budget's own
       reading of a line — a Food-typed category, not excluded — so a line
       the Budget page leaves out is left out here too. */
    const matchedKeys = new Set([...matches.values()].map(t => t.key));
    const { spend: foodSpend, covered } = coverage(lines, matchedKeys, start, end,
      t => catType(t.row.cat) === 'food' && !t.row.excluded);

    const tile = kpiTiles($('#foodKpis'));
    tile('Spent on receipts', money(sum.spend), '', `${sum.receipts} receipt${sum.receipts === 1 ? '' : 's'} this period`);
    tile('Xtra Savings', money(sum.saved), sum.saved > 0 ? 'text-success' : '', 'XTRASAVE discounts on the slips');
    tile('Healthy', sum.spend > 0 ? `${Math.round(sum.healthyShare * 100)}%` : '—', '',
      sum.spend > 0 ? `${money(sum.healthy)} on (V) HealthyFood lines` : 'no receipts this period');
    const covTile = tile('With a receipt', foodSpend > 0 ? `${Math.round((covered / foodSpend) * 100)}%` : '—', '',
      foodSpend > 0 ? `${money(covered)} of ${money(foodSpend)} grocery spend` : 'no Food spend on the bank this period');
    if (foodSpend > 0 && covered < foodSpend - 0.005) {
      covTile.append(caveatChip('why not 100%?',
        'The categories below describe only the shops you saved a slip for. Food spend on the bank with no matching receipt — a takeaway, a shop you did not keep the slip for, a statement not imported yet — cannot be broken down here. This figure reads the bank lines as they are filed; the Budget page applies its own rules (foreign-currency and set-aside accounts), so the two need not agree to the cent.'));
    }

    renderCategories(sum);
    renderItems(sum);
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
      const row = el('button', {
        type: 'button', class: 'food-cat-row' + (active ? ' is-active' : ''),
        'aria-pressed': active ? 'true' : 'false',
        onclick: () => { S.foodFilter.cat = active ? '' : c.category; renderFood(); },
      },
      el('span', { class: 'food-cat-name' }, c.category),
      el('span', { class: 'food-cat-bar', 'aria-hidden': 'true' },
        el('span', { class: 'food-cat-fill', style: `width:${Math.max(2, Math.round((c.amount / top) * 100))}%` })),
      el('span', { class: 'food-cat-amt num' }, money(c.amount)),
      el('span', { class: 'food-cat-pct num text-muted' }, `${Math.round(share * 100)}%`));
      box.append(row);
    }
  }

  function renderItems(sum) {
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
      body.append(el('tr', {}, el('td', { colspan: '6', class: 'text-muted' },
        sum.items.length ? 'Nothing matches this filter.' : 'Nothing bought on a saved receipt this period.')));
      return;
    }
    const cats = categoryChoices();
    for (const it of rows) {
      const catSel = el('select', { class: 'form-select form-select-sm', 'aria-label': `Category for ${it.name}` });
      for (const c of new Set([...cats, it.category])) catSel.append(el('option', { value: c }, c));
      catSel.value = it.category;
      catSel.addEventListener('change', () => refile(it, { category: catSel.value }));
      const healthyBox = el('input', { type: 'checkbox', 'aria-label': `${it.name} is healthy` });
      healthyBox.checked = !!it.healthy;
      healthyBox.addEventListener('change', () => refile(it, { healthy: healthyBox.checked }));
      const first = it.prices[0].amount, last = it.lastPrice;
      const moved = it.prices.length > 1 && Math.round(first * 100) !== Math.round(last * 100);
      const priceCell = el('td', { class: 'num' }, money(last));
      if (moved) {
        priceCell.append(el('div', { class: `food-price-move ${last > first ? 'text-danger' : 'text-success'}` },
          `${last > first ? '▲' : '▼'} from ${money(first)}`));
      }
      body.append(el('tr', {},
        el('td', {}, it.name),
        el('td', {}, catSel),
        el('td', { class: 'food-chk' }, healthyBox),
        el('td', { class: 'num' }, String(it.count)),
        el('td', { class: 'num' }, money(it.amount)),
        priceCell));
    }
    /* data-label per cell, so the phone layout can fold each row into a
       card with its own captions (src/styles.css, Food). */
    tableCells($('#foodItemsTable'), ['Item', 'Category', 'Healthy', 'Bought', 'Spent', 'Last price']);
  }

  function renderReceipts(matches, start, end) {
    const body = $('#foodReceiptsBody');
    body.empty();
    const inRange = S.receipts.filter(r => r.date >= start && r.date <= end);
    const unmatchedElsewhere = S.receipts.filter(r => !(r.date >= start && r.date <= end) && !matches.has(r.rel)).length;
    if (!inRange.length) {
      body.append(el('tr', {}, el('td', { colspan: '5', class: 'text-muted' }, 'No receipts dated in this period.')));
    }
    for (const r of inRange) {
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
        el('td', {}, el('button', { class: 'btn-ghost btn-ghost-sm', onclick: () => openReceipt(r) },
          icoEl(['file-text', 'file']), 'Open'))));
    }
    tableCells($('#foodReceiptsTable'), ['Date', 'Shop', 'Total', 'Bank line', null]);
    $('#foodReceiptsNote').textContent = unmatchedElsewhere
      ? `${unmatchedElsewhere} receipt${unmatchedElsewhere === 1 ? '' : 's'} in other periods still ha${unmatchedElsewhere === 1 ? 's' : 've'} no bank line.`
      : '';
  }

  async function openReceipt(r) {
    const f = fileAt(r.rel);
    if (!f) { await ctx.loadReceipts(); renderFood(); return toast('That receipt is no longer in the vault', true); }
    await app.workspace.getLeaf('tab').openFile(f);
  }

  /* ------------------------------ writing ------------------------------- */

  /* Remember how a product is filed. Written only when it changes, and from
     the file's current bytes (readFile clears io.js's staleness latch), so a
     line the reader added to Food Items.md by hand survives. */
  async function rememberItems(items) {
    const text = await readFile(FOOD_ITEMS_FILE);
    const map = text ? parseFoodItems(text) : new Map();
    if (!mergeFoodItems(map, items)) return;
    let lead = null, trail = null;
    if (text) ({ before: lead, after: trail } = splitAroundTable(text, SCHEMAS.foodItems.columns[0].header));
    await writeFile(FOOD_ITEMS_FILE, serializeFoodItems(map, { lead, trail }));
  }

  async function addReceipt() {
    const got = await askReceipt(app, { money, foodItems: S.foodItems, categories: categoryChoices() });
    if (!got) return;
    let rel = receiptPath(got);
    for (let n = 2; pathTaken(rel); n++) rel = receiptPath(got).replace(/\.md$/, ` ${n}.md`);
    try {
      await writeFile(rel, serializeReceipt(got));
      await rememberItems(got.items);
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
    try {
      await rememberItems(it.members.map(m => ({ ...m, category, healthy })));
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
        if (changed) await writeFile(r.rel, text);
      }
    } catch (e) {
      toast(`Could not re-file ${it.name}: ${e.message || e}`, true);
    }
    await ctx.loadReceipts();
    renderFood();
  }

  ctx.provide({ renderFood, addFoodReceipt: addReceipt });
};
