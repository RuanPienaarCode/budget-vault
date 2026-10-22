'use strict';
/* The Add receipt dialog: paste a receipt's text, check what was read, save.

   Two steps in one modal. The first takes text — Live Text's Copy All from a
   photo of the slip, or nothing at all for a receipt typed in by hand. The
   second is the review table, and it is the real interface: OCR of a long
   slip is never trusted to be right (see receipt-parse.js's header for what
   it gets wrong), so every line is editable, lines can be added and removed,
   and the footer keeps the one check that matters in view — do the lines add
   up to what the slip says was paid.

   It argues, it does not correct: a receipt that does not add up can still
   be saved (the reader may know the slip is right and one line is
   unreadable), but the Save button then says so in its own words. */

const { Modal, Setting } = require('obsidian');
const { el } = require('./dom');
const { normalizeAmount, roundCents } = require('./amount');
const { askFields } = require('./modal');
const { parseReceiptText, itemsTotal } = require('./receipt-parse');
const { suggestFiling, FOOD_CATEGORIES, OTHER } = require('./receipt-file');
const { todayIso } = require('./dates');

const NEW_CAT = '\u0001new';

const r2 = v => roundCents(Number(v) || 0);
const toAmount = s => {
  const v = normalizeAmount(String(s ?? '').trim());
  return v == null || Number.isNaN(v) ? null : v;
};

const PROBLEM_TEXT = {
  'no-items': () => 'No product lines were found. Type them in below, or paste the text again.',
  'no-date': () => 'No purchase date was found on it — set one before saving.',
  'no-total': () => 'The slip total was not found — type it in so the lines can be checked against it.',
  'unpriced': p => `${p.n} line${p.n === 1 ? '' : 's'} came through without a price.`,
  'count-mismatch': p => `The slip says ${p.slip} lines; ${p.found} were read. Look for a line OCR skipped.`,
  'saved-mismatch': (p, money) => `The slip says you saved ${money(p.slip)}; the discounts read come to ${money(p.items)}.`,
  'sum-mismatch': () => 'The prices read do not add up to the slip total — check them against the paper.',
};

class ReceiptModal extends Modal {
  /* opts: { money, foodItems (Map), categories (string[]) } */
  constructor(app, opts, resolve) {
    super(app);
    this.opts = opts;
    this.resolve = resolve;
    this.result = null;
  }

  onOpen() {
    this.titleEl.setText('Add a receipt');
    this.modalEl.addClass('bv-receipt-modal');
    this.stepPaste();
  }

  onClose() {
    this.contentEl.empty();
    this.resolve(this.result);
  }

  /* ---- step 1 ---------------------------------------------------------- */
  stepPaste() {
    const c = this.contentEl;
    c.empty();
    c.append(el('p', { class: 'bv-receipt-hint' },
      'Paste the receipt’s text. On an iPhone or Mac: open the photo of the slip, press and hold on the text, ',
      'choose Select All, then Copy. Checkers slips are read line by line; any other shop’s are read as ',
      'best they can be. Nothing leaves this device.'));
    const ta = el('textarea', {
      class: 'bv-receipt-paste', rows: '10', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off',
      placeholder: 'Item/GTIN 6001…\nCLOVR FCRM 2L   R37.99A\n…\nTOTAL [20]   R640.00',
      'aria-label': 'Receipt text',
    });
    c.append(ta);
    const foot = new Setting(c);
    foot.addButton(b => b.setButtonText('Type it in instead').onClick(() => this.stepReview(null)));
    foot.addButton(b => b.setButtonText('Read receipt').setCta().onClick(() => {
      const text = ta.value;
      if (!text.trim()) return this.stepReview(null);
      const known = {};
      for (const [k, v] of this.opts.foodItems || new Map()) if (v.barcode) known[k] = v;
      this.stepReview(parseReceiptText(text, { known }));
    }));
    setTimeout(() => ta.focus(), 0);
  }

  /* ---- step 2 ---------------------------------------------------------- */
  stepReview(parsed) {
    const map = this.opts.foodItems || new Map();
    const p = parsed || { store: '', date: todayIso(), time: '', total: null, items: [], problems: [] };
    this.r = {
      store: p.store || '', date: p.date || '', time: p.time || '',
      total: p.total,
      items: p.items.map(it => {
        const f = suggestFiling(it, map);
        return { barcode: it.barcode || '', name: it.name, amount: it.amount, discount: it.discount || 0, category: f.category, healthy: f.healthy };
      }),
    };
    if (!this.r.items.length) this.r.items.push(blankLine());
    this.problems = (p.problems || []).filter(x => x.code !== 'sum-mismatch' && x.code !== 'no-items');
    this.cats = [...new Set([...FOOD_CATEGORIES, ...(this.opts.categories || []), ...this.r.items.map(i => i.category)])];

    const c = this.contentEl;
    c.empty();
    const head = el('div', { class: 'bv-receipt-head' });
    const field = (label, key, attrs = {}) => {
      const input = el('input', { class: 'form-control form-control-sm', value: this.r[key] ?? '', 'aria-label': label, ...attrs });
      input.addEventListener('input', () => {
        this.r[key] = key === 'total' ? toAmount(input.value) : input.value.trim();
        this.refresh();
      });
      return el('label', { class: 'bv-receipt-field' }, el('span', { class: 'l' }, label), input);
    };
    head.append(
      field('Shop', 'store'),
      field('Date', 'date', { type: 'date' }),
      field('Time', 'time', { placeholder: 'HH:MM', inputmode: 'numeric' }),
      field('Slip total', 'total', { inputmode: 'decimal', value: this.r.total == null ? '' : this.r.total.toFixed(2) }));
    c.append(head);

    if (this.problems.length) {
      c.append(el('ul', { class: 'bv-receipt-problems', role: 'status' },
        ...this.problems.map(x => el('li', {}, (PROBLEM_TEXT[x.code] || (() => x.code))(x, this.opts.money)))));
    }

    this.linesEl = el('div', { class: 'bv-receipt-lines' });
    c.append(this.linesEl);
    const add = el('button', { type: 'button', class: 'btn-ghost btn-ghost-sm' }, '＋ Add line');
    add.addEventListener('click', () => { this.r.items.push(blankLine()); this.renderLines(); this.refresh(); });
    c.append(add);

    this.footEl = el('div', { class: 'bv-receipt-foot', role: 'status', 'aria-live': 'polite' });
    c.append(this.footEl);

    const foot = new Setting(c);
    foot.addButton(b => b.setButtonText('Back').onClick(() => this.stepPaste()));
    foot.addButton(b => { this.saveBtn = b; b.setCta().onClick(() => this.submit()); });

    this.renderLines();
    this.refresh();
  }

  renderLines() {
    const box = this.linesEl;
    box.empty();
    box.append(el('div', { class: 'bv-receipt-line bv-receipt-line-h', 'aria-hidden': 'true' },
      el('span', {}, 'Item'), el('span', {}, 'Price'), el('span', {}, 'Discount'),
      el('span', {}, 'Category'), el('span', {}, 'Healthy'), el('span', {}, '')));
    this.r.items.forEach((it, i) => {
      const name = el('input', { class: 'form-control form-control-sm', value: it.name || '', 'aria-label': `Line ${i + 1} item` });
      name.addEventListener('input', () => { it.name = name.value; this.refresh(); });
      const amt = el('input', { class: 'form-control form-control-sm num', inputmode: 'decimal', value: it.amount == null ? '' : it.amount.toFixed(2), 'aria-label': `Line ${i + 1} price` });
      amt.addEventListener('input', () => { it.amount = toAmount(amt.value); this.refresh(); });
      const disc = el('input', { class: 'form-control form-control-sm num', inputmode: 'decimal', value: it.discount ? it.discount.toFixed(2) : '', placeholder: '0.00', 'aria-label': `Line ${i + 1} discount` });
      /* A discount is money off, so it is stored negative whichever way it
         was typed — "10" in the Discount box means R10 off, never R10 on. */
      disc.addEventListener('input', () => { const v = toAmount(disc.value); it.discount = v ? -Math.abs(v) : 0; this.refresh(); });
      const cat = this.categorySelect(it.category, v => { it.category = v; });
      cat.setAttribute('aria-label', `Line ${i + 1} category`);
      const healthy = el('input', { type: 'checkbox', 'aria-label': `Line ${i + 1} healthy` });
      healthy.checked = !!it.healthy;
      healthy.addEventListener('change', () => { it.healthy = healthy.checked; });
      const del = el('button', { type: 'button', class: 'btn-ghost btn-ghost-sm', 'aria-label': `Remove line ${i + 1}` }, '✕');
      del.addEventListener('click', () => { this.r.items.splice(i, 1); this.renderLines(); this.refresh(); });
      box.append(el('div', { class: 'bv-receipt-line' }, name, amt, disc, cat, el('span', { class: 'bv-receipt-chk' }, healthy), del));
    });
  }

  categorySelect(value, onPick) {
    const sel = el('select', { class: 'form-select form-select-sm' });
    const fill = cur => {
      sel.empty();
      for (const cname of this.cats) sel.append(el('option', { value: cname }, cname));
      sel.append(el('option', { value: NEW_CAT }, 'New category…'));
      sel.value = cur;
    };
    fill(value);
    sel.addEventListener('change', async () => {
      if (sel.value !== NEW_CAT) return onPick(sel.value);
      /* askFields, not window.prompt — Electron and the iOS app both return
         null from prompt() without ever showing it. */
      const got = await askFields(this.app, 'New food category', [{ key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Baby' }]);
      const name = ((got && got.name) || '').trim();
      if (!name) { sel.value = value; return; }
      if (!this.cats.includes(name)) this.cats.push(name);
      value = name;
      onPick(name);
      this.renderLines();
    });
    return sel;
  }

  lines() { return this.r.items.filter(it => (it.name || '').trim() && it.amount != null); }

  refresh() {
    if (!this.footEl) return;
    const { money } = this.opts;
    const got = itemsTotal(this.lines());
    const want = this.r.total;
    this.footEl.empty();
    let label = 'Save receipt';
    if (want == null) {
      this.footEl.append(el('span', {}, `Lines add up to ${money(got)}. Type the slip total to check them.`));
    } else if (Math.round(got * 100) === Math.round(want * 100)) {
      this.footEl.append(el('span', { class: 'bv-receipt-ok' }, `✓ Lines add up to the slip: ${money(want)}`));
    } else {
      const diff = r2(want - got);
      this.footEl.append(el('span', { class: 'bv-receipt-off' },
        `Lines come to ${money(got)}; the slip says ${money(want)} — ${money(Math.abs(diff))} ${diff > 0 ? 'missing' : 'too much'}.`));
      label = 'Save anyway';
    }
    const ready = !!this.r.date && /^\d{4}-\d{2}-\d{2}$/.test(this.r.date) && this.lines().length > 0;
    if (this.saveBtn) { this.saveBtn.setButtonText(label); this.saveBtn.setDisabled(!ready); }
  }

  submit() {
    const items = this.lines().map(it => ({
      barcode: (it.barcode || '').trim(), name: it.name.trim(),
      amount: r2(it.amount), discount: r2(it.discount || 0),
      category: it.category, healthy: !!it.healthy,
    }));
    if (!items.length || !this.r.date) return;
    this.result = {
      store: this.r.store || 'Receipt', date: this.r.date, time: this.r.time,
      total: this.r.total == null ? itemsTotal(items) : r2(this.r.total),
      items,
    };
    this.close();
  }
}

const blankLine = () => ({ barcode: '', name: '', amount: null, discount: 0, category: OTHER, healthy: false });

function askReceipt(app, opts) {
  return new Promise(resolve => new ReceiptModal(app, opts, resolve).open());
}

module.exports = { ReceiptModal, askReceipt };
