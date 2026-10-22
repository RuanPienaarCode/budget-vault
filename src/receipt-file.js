'use strict';
/* Receipts — the pure half of the Food page. The file contract, how a product
   is filed into a food category, which bank line a receipt belongs to, and
   what a period's receipts add up to. No DOM, no obsidian import; guarded by
   tests/receipt-file.test.cjs.

   WHAT A RECEIPT IS. One markdown file per till slip, under
   <budget>/Receipts/<YYYY-MM>/, holding one table row per product line. NOT a
   split of the bank transaction: a forty-line Checkers slip as forty split
   rows would bury the Transactions page and run every one of them through
   every total the app has. The bank line stays one Food row, its budget
   figures do not move, and the receipt sits beside it as the itemised
   account of where that one figure went.

   THE LINK TO THE BANK LINE IS DERIVED, NEVER STORED. A receipt is matched to
   a transaction on load by amount and date (matchReceipts below), so a slip
   saved before the statement is imported links itself the moment the
   statement arrives, and a statement re-imported with a corrected date
   cannot leave a stale pointer behind. The app argues, it does not correct:
   an unmatched receipt is shown as unmatched, never quietly attached to the
   nearest thing.

   HOW A PRODUCT IS FILED, in order:
     1. the receipt row's own Category cell — a hand edit always wins;
     2. Receipts/Food Items.md, keyed by barcode (or name) — the household's
        memory, written every time someone recategorises on the Food page;
     3. guessCategory's keyword rules below — a first guess for a product
        nobody has filed yet, which the review table shows before saving.
   `Healthy` is the slip's own (V) — Discovery Vitality HealthyFood — or the
   map's flag. It is a flag beside the category, not a category: a chicken is
   both Meat & fish and healthy. */

const { parseFrontmatter, parseMdTable, splitAroundTable, yamlStr } = require('./markdown');
const { SCHEMAS, headerLines, rowLine, rowToObject } = require('./table-schema');
const { safeSeg } = require('./vault-path');
const { roundCents } = require('./amount');

const RECEIPTS_DIR = 'Receipts';
const FOOD_ITEMS_FILE = 'Receipts/Food Items.md';

/* The starter list. A reader adds a category by typing a new name in the
   picker; these are only what the picker offers before anyone has. */
const FOOD_CATEGORIES = [
  'Meat & fish', 'Dairy & eggs', 'Cheese', 'Fruit & veg', 'Bakery', 'Pantry',
  'Snacks & chocolate', 'Drinks', 'Wine & alcohol', 'Household', 'Other',
];
const OTHER = 'Other';

/* Keyword rules over the slip's abbreviated names (TASTC BRWN, CLOVR FCRM,
   SPKKO SAMAN). ORDER IS THE RULE: the first match wins, so the exceptions
   sit above the words they would otherwise fall into — tinned TOM ONION 410G
   is Pantry before ONION makes it veg, CHICKPEAS is Pantry before CHIC makes
   it meat, BUTTERNUT is veg because BUTTER\b does not match it. No lookbehind
   anywhere (iOS 15 WebKit parses the whole bundle as one; a lookbehind is a
   SyntaxError that takes every page down). */
const RULES = [
  ['Household', /CHECKOUT BAG|\bBAG CH\b|\b[12]PL\b|TOILET|TISSUE|SERVIETTE|CANDLE|PRICES \d|DETERG|DISHWASH|BLEACH|SPONGE|\bFOIL\b|SOAP\b|BATTER(Y|IES)/],
  ['Wine & alcohol', /WINE|MERLOT|SAUV|SHIRAZ|CABERNET|CHARDON|PINOT|PINOTAGE|\bROSE\b|\bBRUT\b|BEER|LAGER|CIDER|\bGIN\b|VODKA|WHISK|BRANDY|\bRUM\b|SPIRIT/],
  ['Pantry', /TOM ONION \d+ ?G|BNS TOM|\bTOM PST\b|TPSTE|TOMATO PASTE|CHICKPEA|PEANUT BUTTER|PNUTB|SAUCE/],
  /* Above Dairy, so CADBURY DAIRY MILK is chocolate and not milk. */
  ['Snacks & chocolate', /CHOC|CADBRY|CADBURY|LINDT|JUNGLE BAR|CHIPS|CRISPS|FLANAGAN|SANTA ANNA|TRIGZ|SALTCRX|BISCUIT|COOKIE|PNUT&RAISN|BUTTANUTT|DATE BALL|COCOA|SWEETS|POPCORN|\bNUTS\b/],
  ['Cheese', /CHEESE|\bCHS\b|CHED|GOUD|MOZZ|FETA|PARMES|BRIE|CAMEMB|HALLOUMI|PRSDNT|PRESIDENT/],
  ['Dairy & eggs', /\bEGGS?\b|MILK|FCRM|\bFC \d|BUTTR\b|BUTTER\b|YOG|CREAM|FRSCRM|CRYSTV/],
  ['Meat & fish', /CHIC|CHICKEN|BEEF|MINCE|PORK|LAMB|STEAK|WORS|SAUSAGE|BACON|\bHAM\b|HAKE|HADDOCK|SALMON|TUNA|SARDINE|MUSSL|PRAWN|FISH|ESPETADA|BILTONG|DROEWORS/],
  ['Bakery', /\bROLLS?\b|BREAD|CIABATTA|PITA|MUFFIN|SDGH|SOURDOUGH|BAGEL|TORTILLA|\bBUNS?\b|HAMBRGR|CROISS|RUSK/],
  ['Drinks', /RED BULL|COKE|COCA|FANTA|SPRITE|JUICE|LIQUI|\bTEA\b|TEABAG|ROOIBOS|FIVROS|FIVE ROSES|JOKO|COFFEE|NESCAFE|WATER|REHIDRAT|ENERGADE|POWERADE|CORDIAL|OROS/],
  ['Fruit & veg', /ONION|\bTOM\b|TOMATO|\bAVO\b|CUCUMB|LETTUCE|SWTPOT|SWEET ?POT|POTATO|BUTTERNUT|PUMPKN|PUMPKIN|CARROT|BROCCOLI|SPINACH|CABBAGE|SWEETCORN|MSHRM|MUSHROOM|GARLIC|GINGER|LEMON|\bLIME|BANANA|APPLE|\bAPL\b|PEARS?\b|MANDARIN|ORANGE|STRAWBERRY|BLUEBERRY|BERR(Y|IES)|GRAPE|MANGO\b|PEPPERS?\b|CELERY|TANGO|MCCAIN/],
  ['Pantry', /RICE|TASTI?C\b|SPKKO|SAMAN|LENTIL|WHLNTL|BEANS?\b|\bBNS\b|PASTA|MACARONI|SPAGH|OATS|CEREAL|PRONUTRO|SUGR|SUGAR|FLOUR|HONEY|\bHNY\b|PNUTB|PEANUT|SIMPLE TRTH|NOLA|MAYO|SAUCE|C&B|PASTE|MASALA|SPICE|ROBERTSON|STOCK|\bOIL\b|VINEGAR|\bSALT\b|\bJAM\b/],
];

/* Checkers' own fresh-produce barcodes start 600367; used only when no word
   matched, because the same prefix also carries the in-store bakery's pita
   and a coconut date ball. */
const FRESH_PREFIX = /^600367/;

function guessCategory(name, barcode) {
  const n = String(name || '').toUpperCase();
  for (const [cat, re] of RULES) if (re.test(n)) return cat;
  if (FRESH_PREFIX.test(String(barcode || ''))) return 'Fruit & veg';
  return OTHER;
}

/* Case- and space-folded, so "Clovr fcrm 2L" and "CLOVR  FCRM 2L" are one
   product to a reader typing it in by hand. */
const fold = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/* The key a product is remembered by: its barcode, or its folded name for a
   line typed without one. `#` cannot start a barcode, so the two never meet. */
const itemKey = it => (it.barcode ? String(it.barcode).trim() : '#' + fold(it.name));

/* Food Items.md -> Map(key -> { barcode, name, category, healthy }) */
function parseFoodItems(text) {
  const map = new Map();
  if (!text) return map;
  const rows = parseMdTable(parseFrontmatter(text).body, SCHEMAS.foodItems.columns[0].header).slice(1);
  for (const c of rows) {
    const r = rowToObject(SCHEMAS.foodItems, c);
    if (!r.barcode && !r.name) continue;
    map.set(itemKey(r), r);
  }
  return map;
}

function serializeFoodItems(map, { lead = null, trail = null } = {}) {
  const rows = [...map.values()].sort((a, b) =>
    (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || ''));
  const [h, sep] = headerLines(SCHEMAS.foodItems);
  const head = lead != null ? lead.replace(/\s+$/, '') : [
    '---', 'kind: food-items', '---', '',
    '# Food items', '',
    'How each product on a receipt is filed. Change a category here or on the Food page;',
    'every receipt carrying that barcode follows it.', '',
  ].join('\n');
  return [head, ...(lead != null ? [''] : []), h, sep, ...rows.map(r => rowLine(SCHEMAS.foodItems, r)),
    ...(trail != null ? [trail.replace(/^\s+/, '')] : ['']), ].join('\n').replace(/\n*$/, '\n');
}

/* The category and healthy flag a fresh line arrives with, before anyone
   has looked at it. */
function suggestFiling(it, map) {
  const k = map && map.get(itemKey(it));
  return {
    category: (k && k.category) || guessCategory(it.name, it.barcode),
    healthy: !!(it.healthy || (k && k.healthy)),
    known: !!(k && k.category),
  };
}

/* Fold newly filed lines into the household's memory. Returns whether the
   map changed, so the caller writes Food Items.md only when it did. An entry
   keeps the NAME it was first remembered by (a later OCR misread must not
   rename a product the household already knows) and takes the newest
   category and healthy flag. */
function mergeFoodItems(map, items) {
  let changed = false;
  for (const it of items) {
    const k = itemKey(it);
    const prev = map.get(k);
    const next = { barcode: it.barcode || '', name: it.name, category: it.category, healthy: !!it.healthy };
    if (prev && prev.category === next.category && !!prev.healthy === next.healthy) continue;
    map.set(k, { ...(prev || {}), ...next, name: (prev && prev.name) || next.name });
    changed = true;
  }
  return changed;
}

/* Of a period's grocery spend on the bank, how much a matched slip accounts
   for. Grocery spend is every line the caller calls food PLUS every line a
   slip matched, whatever it is filed under: a Checkers charge split in two
   (its parent excluded, its parts not statement lines) or filed under
   Household is still shopping a receipt describes. Counted on one side only,
   this read 100% for a month holding a split Checkers charge (spec review,
   22 Oct 2026); as a union it cannot pass 100%.

   lines: [{ key, date, amount }] statement lines; matchedKeys: Set of keys;
   isFood(line) -> boolean, the budget's own reading of the line.
   -> { spend, covered } */
function coverage(lines, matchedKeys, start, end, isFood) {
  let spend = 0, covered = 0;
  for (const t of lines) {
    if (t.date < start || t.date > end || !(t.amount < 0)) continue;
    const matched = matchedKeys.has(t.key);
    if (matched || isFood(t)) spend += -t.amount;
    if (matched) covered += -t.amount;
  }
  return { spend: r2(spend), covered: r2(covered) };
}

/* Receipts/2026-10/2026-10-03 Checkers Sampletown 1633.md. The time is in
   the name because a household that shops twice on a Saturday has two slips
   that would otherwise collide; the store because "2026-10-03.md" says
   nothing in a file list. */
function receiptPath({ date, store, time }) {
  const month = String(date || '').slice(0, 7) || 'undated';
  const t = String(time || '').replace(':', '');
  const name = safeSeg([date || 'undated', store || 'Receipt', t].filter(Boolean).join(' '));
  return `${RECEIPTS_DIR}/${month}/${name}.md`;
}

const r2 = v => roundCents(Number(v) || 0);

function serializeReceipt(r, { lead = null, trail = null } = {}) {
  const [h, sep] = headerLines(SCHEMAS.receiptItems);
  const head = lead != null ? lead.replace(/\s+$/, '') : [
    '---', 'kind: receipt',
    `receipt_store: ${yamlStr(r.store || '')}`,
    `receipt_date: ${r.date || ''}`,
    `receipt_time: ${yamlStr(r.time || '')}`,
    `receipt_total: ${r2(r.total).toFixed(2)}`,
    '---', '',
    `# ${r.store || 'Receipt'} · ${r.date || ''}${r.time ? ' ' + r.time : ''}`, '',
  ].join('\n');
  const rows = r.items.map(it => rowLine(SCHEMAS.receiptItems, it));
  return [head, ...(lead != null ? [''] : []), h, sep, ...rows,
    ...(trail != null ? [trail.replace(/^\s+/, '')] : ['']), ].join('\n').replace(/\n*$/, '\n');
}

function parseReceiptFile(text, rel) {
  const { fm, body } = parseFrontmatter(text);
  const rows = parseMdTable(body, SCHEMAS.receiptItems.columns[0].header).slice(1);
  const items = rows.map(c => rowToObject(SCHEMAS.receiptItems, c)).filter(it => it.name || it.barcode);
  const total = Number(String(fm.receipt_total || '').replace(/[^0-9.-]/g, ''));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(fm.receipt_date || '')) ? String(fm.receipt_date) : '';
  return {
    rel,
    store: String(fm.receipt_store || ''),
    date,
    time: String(fm.receipt_time || ''),
    total: Number.isFinite(total) && String(fm.receipt_total || '').trim() !== '' ? total : null,
    items,
  };
}

/* Re-file every row of one receipt carrying `key`, leaving everything around
   the table — frontmatter, heading, a line the reader added — byte for byte.
   Returns null when nothing in this file changed, so the caller writes only
   the files that did. */
function refileReceiptText(text, key, { category, healthy }) {
  const parsed = parseReceiptFile(text, '');
  let changed = false;
  for (const it of parsed.items) {
    if (itemKey(it) !== key) continue;
    if (category != null && it.category !== category) { it.category = category; changed = true; }
    if (healthy != null && !!it.healthy !== !!healthy) { it.healthy = !!healthy; delete it.healthyRaw; changed = true; }
  }
  if (!changed) return null;
  const { before, after } = splitAroundTable(text, SCHEMAS.receiptItems.columns[0].header);
  return serializeReceipt(parsed, { lead: before, trail: after });
}

const paidOf = it => r2((it.amount || 0) + (it.discount || 0));
const receiptPaid = r => r2(r.items.reduce((a, it) => a + paidOf(it), 0));

/* Which bank line each receipt is the slip for.

   Same amount to the cent, and a bank date from the day before the slip to
   five days after — card lines post late, and a statement dated in the
   bank's timezone can land a late-evening slip on the previous day. Among
   candidates, one whose description names the store's first word wins, then
   the nearest date. One to one: a bank line claimed by one slip is not
   offered to the next, which is what keeps two R48.00 shops in one week
   from both claiming the first.

   txs: [{ key, date, amount, desc }] with amount negative for money out.
   -> Map(receipt.rel -> tx) */
function matchReceipts(receipts, txs) {
  const out = new Map();
  const used = new Set();
  const day = iso => Date.parse(iso + 'T00:00:00Z') / 86400000;
  const ordered = receipts.filter(r => r.date && r.total != null).slice()
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)));
  for (const r of ordered) {
    const want = Math.round(r.total * 100);
    const word = fold(r.store).split(' ')[0] || '';
    let best = null;
    for (const t of txs) {
      if (used.has(t.key) || !t.date) continue;
      if (Math.round(-t.amount * 100) !== want) continue;
      const gap = day(t.date) - day(r.date);
      if (!(gap >= -1 && gap <= 5)) continue;
      const named = word && fold(t.desc).includes(word) ? 0 : 1;
      const score = named * 100 + Math.abs(gap);
      if (!best || score < best.score) best = { t, score };
    }
    if (best) { used.add(best.t.key); out.set(r.rel, best.t); }
  }
  return out;
}

/* What the receipts dated inside [start, end] (ISO, inclusive) say was
   bought. Every figure is what was PAID — price plus its discount — so a
   category total agrees with the slip total it came from. */
function foodSummary(receipts, start, end) {
  /* Oldest first, so "the latest receipt names it" below is true — the
     loader hands receipts over newest first for the list, and walking that
     order let the OLDEST slip's name and category win the Items row. */
  const byDate = receipts.filter(r => r.date)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time)));
  const inRange = byDate.filter(r => r.date >= start && r.date <= end);
  /* Price history runs back past the period: a product bought once a month
     has one price per month, and a history cut at the period edge could
     never show it moving. Up to `end`, never past it — a later slip is not
     history yet for the period being looked at. */
  const history = new Map();
  for (const r of byDate) {
    if (r.date > end) break;
    for (const it of r.items) {
      const k = itemKey(it);
      if (!history.has(k)) history.set(k, []);
      history.get(k).push({ date: r.date, amount: it.amount || 0 });
    }
  }
  const cats = new Map();
  const products = new Map();
  let spend = 0, saved = 0, healthy = 0;
  for (const r of inRange) {
    for (const it of r.items) {
      const paid = paidOf(it);
      const cat = it.category || OTHER;
      spend += paid;
      saved -= (it.discount || 0);
      if (it.healthy) healthy += paid;
      const c = cats.get(cat) || { category: cat, amount: 0, lines: 0 };
      c.amount += paid; c.lines++;
      cats.set(cat, c);
      const k = itemKey(it);
      const p = products.get(k) || { key: k, barcode: it.barcode || '', name: it.name, category: cat, healthy: !!it.healthy, amount: 0, count: 0, prices: history.get(k) || [] };
      p.amount += paid; p.count++;
      /* The latest receipt names it — a slip that spelled it better wins. */
      p.name = it.name || p.name; p.category = cat; p.healthy = !!it.healthy;
      products.set(k, p);
    }
  }
  const byCategory = [...cats.values()].map(c => ({ ...c, amount: r2(c.amount) }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  const items = [...products.values()].map(p =>
    ({ ...p, amount: r2(p.amount), lastPrice: p.prices.length ? p.prices[p.prices.length - 1].amount : 0 })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  spend = r2(spend);
  return {
    receipts: inRange.length,
    spend,
    saved: r2(saved),
    healthy: r2(healthy),
    healthyShare: spend > 0 ? healthy / spend : 0,
    byCategory,
    items,
  };
}

module.exports = {
  RECEIPTS_DIR, FOOD_ITEMS_FILE, FOOD_CATEGORIES, OTHER,
  guessCategory, fold, itemKey, suggestFiling, mergeFoodItems, coverage,
  parseFoodItems, serializeFoodItems,
  receiptPath, serializeReceipt, parseReceiptFile, refileReceiptText,
  paidOf, receiptPaid, matchReceipts, foodSummary,
};
