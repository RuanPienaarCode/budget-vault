'use strict';
/* Receipt text -> line items. The pure half of the Food page's import: no DOM,
   no obsidian import, no network, so it runs in bare node under
   tests/receipt-parse.test.cjs and on an iPhone with nothing installed.

   WHERE THE TEXT COMES FROM. A plugin cannot read an image, and the one OCR
   engine every reader already owns is the operating system's: Live Text on
   iOS and macOS (long-press the receipt photo, Copy All, paste). This module
   is written against what that engine actually produces, which is NOT the
   receipt's layout. On the Checkers slips this was built against, Apple's
   recogniser reads the left column and the right column as separate blocks,
   so the names arrive in one run and their prices in another — and on one
   three-item slip the prices landed AFTER the loyalty-card footer, past
   TOTAL. It also reads `R48.00` as `RS0.90`, `R32.91` as `R32. 91`, `(V)` as
   `(WS`, and drops `R0.00` outright. A parser that paired each name with the
   price on its own line would have been right on a typed receipt and wrong on
   every real paste.

   So pairing is done the way a person checking the slip would: the receipt
   states its own total, and the run of prices that belongs to the items is
   the run whose signs fit the items (positive for a product, negative for an
   XTRASAVE discount or a voided line) AND whose sum is that total. Typed or
   one-price-per-line text satisfies this at the first window; column-split
   OCR satisfies it a few prices along. When no window adds up, the prices are
   paired in order anyway and the result says by how much it misses — the
   review table is where a person settles it, never this module.

   WHAT IT DOES NOT DO. Categorise (receipt-file.js), match a bank line
   (receipt-file.js), or decide anything is right. Every disagreement it can
   see — total vs items, the slip's own item count vs lines found — is
   returned as a problem for the review table to show. */

/* OCR's habitual misreads inside a money figure. Only applied to a token that
   is already price-shaped (R + digits + two decimals), so a word like "RSA" is
   never turned into a number. B->8 is left out on purpose: it is rarer than
   the damage it would do to a real B. */
const DIGIT_FIX = { O: '0', S: '5', I: '1', l: '1', '|': '1' };
const fixDigits = s => s.replace(/[OSIl|]/g, ch => DIGIT_FIX[ch]);

/* A price token: optional minus, R, digits (thousands may be grouped with a
   comma or a space), a decimal point or comma, two digits, and an optional
   VAT letter (`A` marks a zero-rated line on Checkers slips). OCR inserts
   spaces around the point, so they are allowed there. */
const PRICE_RE = /(-?)\s*R\s*([0-9OSIl|]{1,3}(?:[, ][0-9OSIl|]{3})+|[0-9OSIl|]+)\s*[.,]\s*([0-9OSIl|]{2})\s*[A-Z]?/;
const PRICE_LINE = new RegExp('^' + PRICE_RE.source + '\\s*$');
const PRICE_TAIL = new RegExp('\\s' + PRICE_RE.source + '\\s*$');

function priceValue(m) {
  const whole = fixDigits(m[2]).replace(/[, ]/g, '');
  const cents = fixDigits(m[3]);
  if (!/^\d+$/.test(whole) || !/^\d{2}$/.test(cents)) return null;
  const v = Number(whole) + Number(cents) / 100;
  return m[1] === '-' ? -v : v;
}

/* A whole line that is only a price -> its value, else null. */
function linePrice(line) {
  const m = line.match(PRICE_LINE);
  return m ? priceValue(m) : null;
}

/* A line ending in a price -> { text, value }, else null. The price must be
   separated from the text by whitespace, so "TUNA 170G" never loses "170G". */
function tailPrice(line) {
  const m = line.match(PRICE_TAIL);
  if (!m) return null;
  const value = priceValue(m);
  if (value == null) return null;
  return { text: line.slice(0, m.index).trim(), value };
}

const { roundCents } = require('./amount');
const cents = v => Math.round(v * 100);

/* `(V)` — Discovery Vitality HealthyFood — at the end of a product name.
   Accepts the shapes Live Text actually returned for it: `(V)`, `(V`, `(W)`,
   `(WS`. Stripped from the name either way; the flag is what carries it. */
const HEALTHY_TAIL = /\s*\(\s*[VW]\s*[)S]?\s*$/;

const GTIN_LINE = /^Item\s*\/?\s*GT[I1l]N\s*:?\s*(\d{6,14})\b/i;
const DISCOUNT_LINE = /^X\s*T\s*R\s*A?\s*S\s*A\s*V\s*E\b/i;
const TOTAL_LINE = /^TOTAL\s*\[\s*(\d+)\s*\]/i;
const APPROVED = /APPROVED\s+AMOUNT\s*:?\s*/i;
/* Lines inside the item block that are never a product name. */
/* Whole words (`\b` after the group), so a product called NETTLE TEA or
   TAXI SNACK is not read as the NET or TAX heading of the VAT table. */
const NOT_A_NAME = /^(Electronic Payment|RATE|TAX|GROSS|NET|Voided|VoidLineItem|Transaction Level|Today you saved|on our great|Card Number|Thank you|Xtra Savings|Since joining|you have saved|with Xtra|Savings at)\b|^(\*\s*Auth|Hi\s|[A-Z]\s+\d+%|\d+%|\d+₴)/i;
/* Where a Checkers slip's item block ends for good. */
const BLOCK_END = /^(BARCODE|Please keep your till slip)/i;

/* Lines a generic (non-Checkers) receipt prints with a price that are not a
   product. TOTAL is read for the total; the rest are skipped. */
const GENERIC_SKIP = /\b(SUB\s*TOTAL|TOTAL|BALANCE|CHANGE|CASH|CARD|TENDER|PAYMENT|VAT|TAX|ROUNDING|SAVED|SAVINGS|DUE|AMOUNT)\b/i;

/* Store "Checkers Sampletown" off the line naming the branch ("SAMPLETOWN Tel
   No ..."). Title-cased because the slip shouts. */
const titleCase = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

/* The purchase date. Slash-dated dd/mm/yy only for Checkers — the slip also
   prints "Savings at 17-09-2026", a dash date that is the loyalty balance's
   as-of, not the purchase, and taking it would file the receipt in the wrong
   week. ISO is accepted for typed and generic receipts. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function findDate(lines) {
  for (const l of lines) {
    const m = l.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      const iso = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      if (validIso(iso)) return iso;
    }
  }
  for (const l of lines) {
    const m = l.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m && validIso(m[0])) return m[0];
  }
  /* "26 Aug 2026" / "Aug 26, 2026" — the small-shop tills print the month
     as a word. */
  for (const l of lines) {
    let m = l.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/);
    let d, mon, y;
    if (m) [, d, mon, y] = m;
    else if ((m = l.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/))) [, mon, d, y] = m;
    const mi = mon ? MONTHS.indexOf(mon.toLowerCase()) : -1;
    if (mi >= 0) {
      const iso = `${y}-${String(mi + 1).padStart(2, '0')}-${d.padStart(2, '0')}`;
      if (validIso(iso)) return iso;
    }
  }
  for (const l of lines) {
    if (/savings at/i.test(l)) continue;
    const m = l.match(/\b(\d{2})[-.](\d{2})[-.](\d{4})\b/);
    if (m) { const iso = `${m[3]}-${m[2]}-${m[1]}`; if (validIso(iso)) return iso; }
  }
  return '';
}
function validIso(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}
function findTime(lines) {
  for (const l of lines) {
    const m = l.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
    if (m) return `${m[1]}:${m[2]}`;
  }
  return '';
}

/* The total the slip states about itself. APPROVED AMOUNT (the card
   terminal's own figure) first, because it sits in the EFT copy above the
   item block and survives OCR column-splitting intact; then a price on the
   TOTAL line; then the first price after it. */
function findTotal(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(APPROVED);
    if (!m) continue;
    const rest = lines[i].slice(m.index + m[0].length).trim();
    const v = linePrice(rest) ?? (i + 1 < lines.length ? linePrice(lines[i + 1]) : null);
    if (v != null && v > 0) return v;
  }
  for (let i = 0; i < lines.length; i++) {
    if (!/^TOTAL\b/i.test(lines[i])) continue;
    const t = tailPrice(lines[i]);
    if (t && t.value > 0) return t.value;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const v = linePrice(lines[j]) ?? (tailPrice(lines[j]) || {}).value;
      if (v != null && v > 0) return v;
    }
  }
  return null;
}

/* The pairing described in the header. `entries` are items and discounts in
   slip order, each with sign +1 or -1; `prices` are every price in the block
   in reading order. Returns the prices to use, one per entry, and whether
   they were proven by the total. */
function pairPrices(entries, prices, total) {
  const k = entries.length;
  if (!k) return { values: [], proven: total == null ? false : total === 0 };
  const wantPos = entries.filter(e => e.sign > 0).length;
  let near = null;
  if (total != null) {
    for (let s = 0; s + k <= prices.length; s++) {
      const win = prices.slice(s, s + k);
      const pos = win.filter(v => v >= 0);
      if (pos.length !== wantPos) continue;
      const miss = Math.abs(cents(win.reduce((a, v) => a + v, 0)) - cents(total));
      if (miss === 0) return { values: assign(entries, win), proven: true };
      if (!near || miss < near.miss) near = { win, miss };
    }
  }
  /* Nothing adds up. The run that comes CLOSEST to the total is the one to
     show: one misread digit ("R5O.03" for R50.00) leaves the right run a few
     cents out, while starting from the first price in the block pairs every
     line with its neighbour's figure — the first version did exactly that,
     reading a stray VAT-table R12.00 as the milk. Failing any run with the
     right signs, in order from the first price, so the review table still
     shows a full grid rather than a half-empty one. */
  return { values: assign(entries, near ? near.win : prices.slice(0, k)), proven: false };
}
function assign(entries, win) {
  const pos = win.filter(v => v >= 0);
  const neg = win.filter(v => v < 0);
  return entries.map(e => (e.sign > 0 ? pos.shift() : neg.shift()) ?? null);
}

function isCheckers(text) {
  return /Item\s*\/?\s*GT[I1l]N/i.test(text) || /SHOPRITE CHECKERS|XTRA\s*SAVE/i.test(text);
}

/* -> { format, store, date, time, total, count, items, problems }
   items: [{ barcode, name, amount, discount, healthy }] — amount is the
   price on the slip, discount the XTRASAVE that follows it (<= 0), so what
   was paid is amount + discount.
   problems: [{ code, ... }] — 'no-items' | 'no-date' | 'no-total' |
   'sum-mismatch' {items, total} | 'count-mismatch' {slip, found} |
   'saved-mismatch' {items, slip} | 'unpriced' {n}.
   `known`: barcode -> { name } from the Food items map, used to replace an
   OCR-mangled name with the one already confirmed for that barcode. */
function parseReceiptText(text, { known } = {}) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const checkers = isCheckers(text);
  const out = checkers ? parseCheckers(lines, known) : parseGeneric(lines);
  out.date = findDate(lines);
  out.time = findTime(lines);
  if (!out.date) out.problems.unshift({ code: 'no-date' });
  if (out.total == null) out.problems.push({ code: 'no-total' });
  if (!out.items.length) out.problems.unshift({ code: 'no-items' });
  return out;
}

function parseCheckers(lines, known) {
  let store = 'Checkers';
  for (const l of lines) {
    const m = l.match(/^([A-Z][A-Z .'-]+?)\s+Tel\s*No/i);
    if (m) { store = 'Checkers ' + titleCase(m[1].trim()); break; }
  }
  const total = findTotal(lines);

  /* The item block: after the last TAX INVOICE (the EFT copies above it carry
     prices of their own), up to the barcode footer. */
  let start = 0;
  lines.forEach((l, i) => { if (/TAX\s*INVOICE/i.test(l)) start = i + 1; });
  let end = lines.length;
  for (let i = start; i < lines.length; i++) if (BLOCK_END.test(lines[i])) { end = i; break; }
  const block = lines.slice(start, end);

  const entries = [];     // { kind: 'item'|'disc', sign, barcode, name, zero, inline }
  const prices = [];
  let slipCount = null;
  let pending = null;     // the item whose name is still being read
  let voidNext = false;
  let skipping = false;   // after "* Auth:", the approver's name follows
  let afterTotal = false;

  const seen = new Set();
  for (const raw of block) {
    const g = raw.match(GTIN_LINE);
    if (g) {
      skipping = false;
      const barcode = g[1];
      const reversal = voidNext && seen.has(barcode);
      seen.add(barcode);
      voidNext = false;
      pending = { kind: 'item', sign: reversal ? -1 : 1, void: reversal, barcode, name: '', nameLines: 0 };
      entries.push(pending);
      continue;
    }
    const tm = raw.match(TOTAL_LINE);
    if (tm) { slipCount = Number(tm[1]); pending = null; afterTotal = true; continue; }
    if (/^Voided$/i.test(raw)) { voidNext = true; pending = null; continue; }
    if (/^\*\s*Auth/i.test(raw)) { skipping = true; pending = null; continue; }
    if (/^VoidLineItem$/i.test(raw)) { skipping = false; continue; }

    const lp = linePrice(raw);
    if (lp != null) { prices.push(lp); if (pending) pending.priced = true; continue; }
    if (skipping) continue;

    if (afterTotal) {
      /* Past TOTAL nothing is a name, but prices still arrive there in
         column-split OCR — collected above. */
      continue;
    }
    if (DISCOUNT_LINE.test(raw)) {
      const t = tailPrice(raw);
      entries.push({ kind: 'disc', sign: -1, name: t ? t.text : raw });
      if (t) prices.push(t.value);
      pending = null;
      continue;
    }
    if (NOT_A_NAME.test(raw)) { pending = null; continue; }
    if (pending && !pending.priced && pending.nameLines < 2) {
      const t = tailPrice(raw);
      const part = t ? t.text : raw;
      pending.name = (pending.name ? pending.name + ' ' : '') + part;
      pending.nameLines++;
      if (t) { prices.push(t.value); pending.priced = true; }
      continue;
    }
  }

  /* LITTLE SHOP is Checkers' R0.00 collectable line. Its price is the one OCR
     drops, so it is taken out of the pairing entirely and counted only
     toward the slip's own item count. */
  for (const e of entries) {
    if (e.kind === 'item' && /^LITTLE SHOP\b/i.test(e.name)) e.zero = true;
  }
  const paired = entries.filter(e => !e.zero);
  /* A zero printed on the slip (typed text keeps them) is not one of the
     paired prices either. */
  const nonZero = prices.filter(v => cents(v) !== 0);
  const { values, proven } = pairPrices(paired, nonZero, total);
  paired.forEach((e, i) => { e.value = values[i]; });

  const problems = [];
  const items = [];
  let last = null;
  for (const e of entries) {
    if (e.kind === 'disc') {
      if (last && e.value != null) last.discount = roundCents(last.discount + e.value);
      continue;
    }
    /* An R0 line cannot carry a discount, so `last` stays on the product
       before it: an XTRASAVE printed after LITTLE SHOP still comes off a
       real line and the slip still adds up, rather than being dropped. */
    if (e.zero) continue;
    if (e.void) {
      /* A voided line cancels the latest earlier line for the same barcode. */
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].barcode === e.barcode) { items.splice(i, 1); break; }
      }
      continue;
    }
    let name = e.name.trim();
    const healthy = HEALTHY_TAIL.test(name);
    name = name.replace(HEALTHY_TAIL, '').trim();
    const k = known && known[e.barcode];
    if (k && k.name) name = k.name;
    last = { barcode: e.barcode, name, amount: e.value, discount: 0, healthy: healthy || !!(k && k.healthy) };
    items.push(last);
  }
  const unpriced = items.filter(it => it.amount == null).length;
  if (unpriced) problems.push({ code: 'unpriced', n: unpriced });
  if (total != null && !proven) {
    problems.push({ code: 'sum-mismatch', items: itemsTotal(items), total });
  }
  /* "Today you saved R40.00" — the slip's own sum of its XTRASAVE lines, so
     a discount OCR lost or paired with the wrong line shows up here even
     when a compensating price error hid it from the total. */
  for (const l of lines) {
    const m = l.match(/Today you saved\s+(.*)$/i);
    const v = m ? linePrice(m[1].trim()) : null;
    if (v == null) continue;
    const got = roundCents(-items.reduce((a, it) => a + (it.discount || 0), 0));
    if (cents(got) !== cents(v)) problems.push({ code: 'saved-mismatch', items: got, slip: v });
    break;
  }
  /* The slip counts every product line it printed, R0 lines and the voided
     original included, but not the reversal line that cancels it nor the
     discounts (a real slip printed TOTAL [29] over thirty product lines, one
     of them the reversal). */
  const found = entries.filter(e => e.kind === 'item' && !e.void).length;
  if (slipCount != null && slipCount !== found) problems.push({ code: 'count-mismatch', slip: slipCount, found });

  return { format: 'checkers', store, total, count: slipCount, items, problems };
}

/* Any other shop. Read the way a person reads a slip they have never seen:

     - the products sit between the header and the totals — after the first
       "TAX INVOICE" or dashed line when there is one, up to the first
       Total / Sub Total / payment line;
     - a product's price is the LAST money figure before the next product,
       so "0.250 @ 100.00   100.00" under "Free Range Biltong" gives 100.00,
       and so does the same slip with every figure on a line of its own
       (Live Text on a photo splits columns that way);
     - a money figure has two decimals or none, with or without an R —
       "0.250" kg and "2.4" kg never are, and a line ending in "@" is a
       weight waiting for its price;
     - a negative figure is a discount on the product above it.

   The total is the slip's TOTAL, else its Sub Total, else what was paid
   (EFT, card, amount due). A slip whose lines miss that by under 10c is
   reported as rounding — a till rounding to the nearest 10c, as the first
   butcher slip imported here did — not as a misread line. */
const MONEY_TAIL = /(?:^|\s)(-?)R?\s?(\d{1,3}(?:[ ,]\d{3})+|\d+)(?:[.,](\d{2}))?\s*[A-Z]?$/;
const SEPARATOR = /^[-=_*~.]{5,}$/;
const DATE_OR_TIME = /\b\d{1,2}[:h]\d{2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3}[a-z]*\.?\s+\d{4}\b/;
const PAID_LINE = /\b(E\.?\s*F\.?\s*T|CARD|AMOUNT\s+DUE|BALANCE\s+DUE|TENDER(?:ED)?|CREDIT|DEBIT)\b/i;

function moneyTail(line) {
  const m = line.match(MONEY_TAIL);
  if (!m) return null;
  const whole = m[2].replace(/[ ,]/g, '');
  const v = Number(whole) + (m[3] ? Number(m[3]) / 100 : 0);
  return { text: line.slice(0, m.index).trim(), value: m[1] === '-' ? -v : v };
}
const hasWords = s => /[A-Za-z]{2,}/.test(s.replace(/\b\d+(?:[.,]\d+)?\s*(?:@|x|kg|g)\b/gi, ''));

function genericTotal(lines) {
  /* The figure on the label's own line, or — Live Text puts a column on
     lines of its own — on the line under it. */
  const pick = re => {
    for (let i = 0; i < lines.length; i++) {
      if (!re.test(lines[i])) continue;
      const own = moneyTail(lines[i]);
      if (own && own.value > 0 && hasWords(own.text)) return own.value;
      const next = lines[i + 1] && moneyTail(lines[i + 1]);
      if (next && next.value > 0 && !hasWords(next.text)) return next.value;
    }
    return null;
  };
  return pick(/^(?!.*SUB\s*TOTAL).*\bTOTAL\b/i) ?? pick(/SUB\s*TOTAL/i) ?? pick(PAID_LINE);
}

function parseGeneric(lines) {
  const store = lines.find(l => hasWords(l) && !moneyTail(l) && !DATE_OR_TIME.test(l)) || lines[0] || '';
  let start = lines.indexOf(store) + 1;
  const head = lines.findIndex(l => /TAX\s*INVOICE/i.test(l) || SEPARATOR.test(l));
  if (head >= 0) start = Math.max(start, head + 1);
  const items = [];
  let pending = null;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (SEPARATOR.test(l) || /TAX\s*INVOICE/i.test(l)) continue;
    if (GENERIC_SKIP.test(l) || PAID_LINE.test(l)) {
      if (items.length) break;      // the totals: the product block is over
      continue;                     // a header line above it
    }
    if (DATE_OR_TIME.test(l) && !items.length && !pending) continue;
    if (/[@x×]\s*$/i.test(l)) continue;           // "0.268 @" — weight, price follows
    const t = moneyTail(l);
    if (t && !hasWords(t.text)) {
      /* A figure with no product words: the price of the product above,
         or a discount on it. The last one before the next product wins. */
      if (t.value < 0) {
        const last = items[items.length - 1];
        if (last) last.discount = roundCents(last.discount + t.value);
      } else if (pending) {
        pending.amount = t.value;
      }
      continue;
    }
    if (t && t.value < 0) {
      const last = items[items.length - 1];
      if (last) { last.discount = roundCents(last.discount + t.value); continue; }
    }
    let name = t ? t.text : l;
    const healthy = HEALTHY_TAIL.test(name);
    name = name.replace(HEALTHY_TAIL, '').trim();
    pending = { barcode: '', name, amount: t ? t.value : null, discount: 0, healthy };
    items.push(pending);
  }
  const kept = items.filter(it => it.amount == null || cents(it.amount) !== 0);
  const total = genericTotal(lines);
  const problems = [];
  const unpriced = kept.filter(it => it.amount == null).length;
  if (unpriced) problems.push({ code: 'unpriced', n: unpriced });
  if (total != null && !unpriced) {
    const got = itemsTotal(kept);
    const diff = roundCents(total - got);
    if (diff !== 0) {
      problems.push(Math.abs(diff) < 0.1
        ? { code: 'rounding', items: got, total, diff }
        : { code: 'sum-mismatch', items: got, total });
    }
  }
  return { format: 'generic', store, total, count: null, items: kept, problems };
}

/* What the items add up to — prices plus their discounts. */
function itemsTotal(items) {
  return roundCents(items.reduce((a, it) => a + (it.amount || 0) + (it.discount || 0), 0));
}

module.exports = { parseReceiptText, itemsTotal, linePrice, tailPrice, pairPrices };
