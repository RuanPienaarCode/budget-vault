'use strict';
/* A whole foreign statement, through the real import view.

   tests/foreign-statement-import.test.cjs pins the two parsers on their own.
   This runs a file end to end, because the defect that motivated it was only
   visible once the pieces were assembled: every cell parsed "correctly" by
   its own rule, and the COLUMN still came out wrong.

     Rp -1.500.000  ->  -1500000   (two dot groups: unambiguous)
     Rp   -250.000  ->      -250   (one group: ambiguous, left alone)

   -250 next to -1500000 in one column, off by a thousand, with nothing on
   screen to say so. What "1.500" means is a property of the FILE, and it is
   inferred once per import now.

     node tests/foreign-statement-e2e.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
/* A DOM stub of the same shape tests/import-dup-explainer.test.cjs uses —
   the review screen builds real elements, and src/dom.js reaches for
   document.createElement. */
class FakeEl {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this._text = ''; this.style = {}; this.nodeType = 1; this.classList = { _s: new Set(), add(...c) { c.forEach(x => this._s.add(x)); }, remove(...c) { c.forEach(x => this._s.delete(x)); }, toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) { this._s.add(c); } else { this._s.delete(c); } }, contains(c) { return this._s.has(c); } }; }
  get textContent() { return this._text || this.children.map(c => c.textContent || '').join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  empty() { this.children = []; this._text = ''; }
  append(...kids) { for (const k of kids.flat()) this.children.push(k && k.nodeType ? k : new FakeEl('span')); }
  appendChild(n) { this.children.push(n); return n; }
  createDiv() { const n = new FakeEl('div'); this.children.push(n); return n; }
  createEl(t) { const n = new FakeEl(t); this.children.push(n); return n; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  focus() {}
}
global.document = {
  createElement: tag => new FakeEl(tag),
  createTextNode: t => { const n = new FakeEl('#text'); n.textContent = t; return n; },
};

const registerImport = require('../src/views/import');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

function makeCtx(settings = {}) {
  const els = {};
  const ctx = {
    S: {
      settings: { currency: 'Rp', country: 'id', month_start_day: 1, ...settings },
      accounts: [], categories: [], rules: [], txFiles: {}, budgets: {}, period: '2026-08',
    },
    $: sel => (els[sel] ||= new FakeEl('div')),
    $$: () => [],
    app: {},
    money: v => `Rp ${Number(v).toFixed(2)}`,
    moneyIn: (s, v) => `${s} ${Number(v).toFixed(2)}`,
    toast() {},
    async writeFile() {},
    currentPeriod: () => '2026-08',
    periodRange: () => ({ start: '2026-08-01', end: '2026-08-31' }),
    periodTitle: () => 'Aug 2026',
    deferredCatSelect: () => new FakeEl('select'),
    serializeTxFile: () => '',
    locale: () => ({ dayFirst: true, thousands: '.', decimal: ',', banks: null, importHint: '' }),
    learnRules() {},
    txSegment: s => s,
    accountForLabel: () => null,
    provide(obj) { Object.assign(ctx, obj); },
  };
  return ctx;
}

const file = text => ({ name: 'rekening.csv', async arrayBuffer() { return new TextEncoder().encode(text).buffer; } });

async function main() {
  /* A real Indonesian export: local column names, rupiah symbol, dot-grouped
     thousands, and — the crux — a mix of two-group and one-group amounts. */
  const csv = [
    'Tanggal,Keterangan,Jumlah,Saldo',
    '01/08/2026,WARUNG MAKAN,"Rp -1.500.000","Rp 8.500.000"',
    '03/08/2026,GAJI BULANAN,"Rp 12.000.000","Rp 20.500.000"',
    '05/08/2026,ALFAMART,"Rp -250.000","Rp 20.250.000"',
    '07/08/2026,KOPI,"Rp -35.000","Rp 20.215.000"',
  ].join('\n') + '\n';

  const ctx = makeCtx();
  registerImport(ctx);
  await ctx.handleStatementFile(file(csv));

  const p = ctx.S.pendingImport;
  ok(p, 'the statement was recognised — Indonesian headings and all, without the manual mapper');
  eq(p.items.length, 4, 'every row became an item; none was counted as "skipped"');

  const byDesc = Object.fromEntries(p.items.map(i => [i.desc, i.amount]));
  eq(byDesc['WARUNG MAKAN'], -1500000, 'the unambiguous two-group amount reads as 1.5 million');
  eq(byDesc['GAJI BULANAN'], 12000000, 'and so does the income row');
  eq(byDesc['ALFAMART'], -250000,
    'the ONE-group amount reads as 250 thousand — not the 250 it came back as when every cell was read on its own');
  eq(byDesc['KOPI'], -35000, 'and so does the smallest one');

  const dates = p.items.map(i => i.date);
  eq(dates, ['2026-08-01', '2026-08-03', '2026-08-05', '2026-08-07'],
    'day-first dates survive too — the whole file is readable, not just its amounts');

  /* NEGATIVE CONTROL: a US-style file in the same run must not be dragged
     into the other convention. The inference is per import, and a comma file
     offers comma evidence. */
  {
    const usCtx = makeCtx({ currency: '$', country: 'us' });
    usCtx.locale = () => ({ dayFirst: false, thousands: ',', decimal: '.', banks: null, importHint: '' });
    registerImport(usCtx);
    await usCtx.handleStatementFile(file([
      'Date,Description,Amount,Balance',
      '08/01/2026,RENT,"$-1,500.00","$8,500.00"',
      '08/05/2026,COFFEE,"$-3.50","$8,496.50"',
    ].join('\n') + '\n'));
    const items = usCtx.S.pendingImport.items;
    eq(items.map(i => i.amount), [-1500, -3.5],
      'a comma-grouped file is unaffected — "1,500.00" is still 1500 and "3.50" is still three fifty');
  }

  console.log(`PASS — a foreign statement end to end: headings, symbols and one separator convention per file (${checks} checks).`);
}

main().catch(e => { console.error(e); process.exit(1); });
