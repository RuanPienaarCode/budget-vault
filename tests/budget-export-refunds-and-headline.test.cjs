'use strict';
/* The budget export says what its Spent figure does not take off, states the
   period headline in the workbook, and prints Used the way the app prints a
   share (2026-10-20 audit, M2-03, M2-04, D2-09).

   M2-03. The PDF's per-period line, "Income X · Spent Y · Uncategorised Z",
   never said that refunds are NOT taken off Spent — a refund is money back
   under a spending category, and the Budget page's Total spent says "R X in
   refunds not taken off this figure" beside the same gross figure. On the
   vault this was found on, one month's line was off its own table by an
   amount nothing in the file explained, and a tax-year window by far more. The export
   now carries the sentence in the Dashboard hero's own words
   (dash.hero.nettedOff), with every refund the budget lens kept —
   summaryInRange(start, end).refunds, the figure the Budget page prints —
   per period and for an exact-dates window.

   M2-04. The workbook's About sheet carried the meta lines and the caveats
   but no headline at all, so a workbook whose Summary sheet left a fifth of a
   tax year's spend out as uncategorised said nothing about it anywhere. It now
   holds a small table — Period · Income · Spent · Uncategorised · Refunds not
   taken off — as real numbers, the figures the PDF line prints.

   D2-09. The PDF's Used column was a bare Math.round: 99.7% of a budget
   printed "100%" beside a figure still inside it, and 0.3% printed "0%"
   beside a real amount. Shares now go through sharePercentLabel, the rule
   every other share in the app follows.

   Over the committed household, through the REAL loader and view and the
   REAL writers; the workbook is read back with a zip walk written here, not
   src/zip.js, and — where python3 is installed — once more by Python's own
   zipfile. Added to the household, worked by hand:

     August     Gym refund +150
     September  Checkers refund +300 (Groceries) · Mystery −250, uncategorised
                · Gym shop −797, so Gym is 997 of its 1 000 (99,7%)

     August     income 30 000 · spent 14 000 · uncategorised 0 · refunds 150
     September  income 30 000 · gross 13 600 + 250 + 797 = 14 647
                spent 14 647 − 2 000 set aside + 500 assume-spent = 13 147
                uncategorised 250 · refunds 300
     1 Aug – 2 Sep (today)  refunds 450

     node tests/budget-export-refunds-and-headline.test.cjs */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock, mountFor, readable } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const bx = require('../src/budget-export');
const i18n = require('./helpers/dom-stub.cjs').readingI18n(require('../src/i18n'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const FILES = {
  ...SEED,
  [`${B}/Transactions/Cheque/2026-08.md`]: SEED[`${B}/Transactions/Cheque/2026-08.md`]
    + '| 2026-08-10 | Gym refund | Gym | 150.00 |  |  |  |\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: SEED[`${B}/Transactions/Cheque/2026-09.md`]
    + '| 2026-09-02 | Checkers refund | Groceries | 300.00 |  |  |  |\n'
    + '| 2026-09-02 | Mystery |  | -250.00 |  |  |  |\n'
    + '| 2026-09-02 | Gym shop | Gym | -797.00 |  |  |  |\n',
};
const ANSWER = { mode: 'months', range: '2', includeCurrent: true, content: 'full', categories: null, includeTx: false, formats: ['pdf', 'xlsx', 'csv'], folder: 'Exports' };

/* ---- a stored-zip walk, independent of src/zip.js ------------------------- */
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const parts = new Map();
  let p = dv.getUint32(eocd + 16, true);
  for (let i = 0, n = dv.getUint16(eocd + 10, true); i < n; i++) {
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = Buffer.from(bytes.slice(p + 46, p + 46 + nameLen)).toString('utf8');
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = Buffer.from(bytes.slice(start, start + size));
    parts.set(name, method === 8 ? require('zlib').inflateRawSync(raw) : raw);
    p += 46 + nameLen + extra + comment;
  }
  return parts;
}
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function sheetsOf(bytes) {
  const parts = unzip(bytes);
  const txt = n => parts.get(n).toString('utf8');
  const rels = new Map([...txt('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]));
  const out = {};
  for (const m of txt('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)) {
    const target = rels.get(m[2]).replace(/^\//, '');
    const xml = txt(target.startsWith('xl/') ? target : `xl/${target}`);
    out[unxml(m[1])] = [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map(r => [...r[1].matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>(.*?)<\/c>)/g)].map(c => {
      const body = c[2] || '';
      const t = /<t[^>]*>(.*?)<\/t>/.exec(body);
      if (t) return unxml(t[1]);
      const v = /<v>(.*?)<\/v>/.exec(body);
      return v ? Number(v[1]) : null;
    }));
  }
  return out;
}
/* Every string a vector PDF draws, in page order, joined as one line of text. */
const pdfText = bytes => readable([...Buffer.from(bytes).toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
  .map(m => m[1].replace(/\\(.)/g, '$1')).join(' ')).replace(/\s+/g, ' ');

(async () => {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(FILES, { period: PERIOD, budgetFolder: B });
    require('../src/views/budget-export')(M.ctx);
    const { ctx } = M;
    const money = v => readable(ctx.money(v));

    /* ---- the seams agree with the hand-worked figures (CONTROL) ------------- */
    eq([ctx.periodSummary('2026-08').refunds, ctx.periodSummary('2026-09').refunds], [150, 300], 'CONTROL: the ledger keeps both refunds, in full');
    eq(ctx.summaryInRange('2026-08-01', TODAY).refunds, 450, 'CONTROL: and the window holds both');
    eq([ctx.periodSummary('2026-09').uncatSpend, ctx.budgetUsed('2026-09').spent], [250, 13147], 'CONTROL: September\'s uncategorised and Spent');

    const { model, written, raster } = await ctx.runBudgetExport(ANSWER);
    eq(model.periods.map(p => p.key), ['2026-08', '2026-09'], 'fixture: August and September');
    eq(raster, false, 'the PDF is real text, not a picture of it');

    /* ---- M2-03: the PDF line says what Spent does not take off --------------- */
    const pdf = pdfText(ctx.vault._store.get(written.find(p => p.endsWith('.pdf'))));
    for (const [name, amount] of [['August 2026', 150], ['September 2026', 300]]) {
      const s = i18n.t('dash.hero.nettedOff', { amount: money(amount) });
      const c = model.budgets.find(b => b.period.name === name).caveats.find(x => x.key === 'refunds');
      ok(c && readable(c.text) === s && c.inline === true, `${name}: the model carries the sentence, on the Spent line — "${s}"`);
      ok(pdf.includes(s), `${name}: the PDF prints "${s}"`);
    }
    const doc = bx.modelToDoc(model, { money: ctx.money, labels: {} });
    const sepLine = readable(doc.blocks.find(x => x.type === 'note' && /^Income /.test(x.text) && x.text.includes(money(13147))).text);
    ok(sepLine.includes(`Spent ${money(13147)}`) && sepLine.includes(i18n.t('dash.hero.nettedOff', { amount: money(300) })),
      `on the same line as the Spent it qualifies — got "${sepLine}"`);

    /* ---- the window ------------------------------------------------------------ */
    const ranged = await ctx.runBudgetExport({ ...ANSWER, mode: 'dates', preset: 'custom', from: '2026-08-01', to: '2026-09-30', formats: ['pdf', 'xlsx'] });
    const rs = i18n.t('dash.hero.nettedOff', { amount: money(450) });
    ok(ranged.model.exact.caveats.some(c => c.key === 'refunds' && readable(c.text) === rs), `the exact-dates window carries its own refunds — "${rs}"`);
    ok(pdfText(ctx.vault._store.get(ranged.written.find(p => p.endsWith('.pdf')))).includes(rs), 'and its PDF prints it');

    /* ---- M2-04: the workbook's About sheet states the headline --------------- */
    const xlsxBytes = new Uint8Array(ctx.vault._store.get(written.find(p => p.endsWith('.xlsx'))));
    const about = sheetsOf(xlsxBytes).About;
    ok(about, 'the workbook has an About sheet');
    const L = bx.LABELS;
    const at = about.findIndex(r => r[0] === L.period && r[1] === L.income);
    ok(at > 0, `About carries a headline table — rows:\n${about.map(r => r.join(' | ')).join('\n')}`);
    eq(about[at], [L.period, L.income, L.spent, L.uncategorised, L.refunds], 'headed Period · Income · Spent · Uncategorised · Refunds not taken off');
    eq(about[at + 1], ['August 2026', 30000, 14000, 0, 150], 'August, as numbers');
    eq(about[at + 2], [`September 2026 ${L.inProgress}`, 30000, 13147, 250, 300],
      'September — marked as running, as on every other sheet — as numbers: the PDF line\'s Spent and Uncategorised, and the refunds');
    ok(!about.some(r => typeof r[0] === 'string' && /refunds not taken off this figure/.test(r[0])),
      'no "this figure" sentence on a sheet where it points at nothing — the column carries it');
    const rAbout = sheetsOf(new Uint8Array(ctx.vault._store.get(ranged.written.find(p => p.endsWith('.xlsx'))))).About;
    const rAt = rAbout.findIndex(r => r[0] === L.period && r[1] === L.income);
    const win = rAbout.slice(rAt + 1).find(r => r[0] === `2026-08-01 to ${TODAY}`);
    ok(win, 'a date-range workbook states the window too, named by its dates');
    eq(win.slice(1), [60000, 14000 + 14647 - 2000, 250, 450], 'over the exact days it covers (no budget, so no assume-spent provision)');

    /* The same bytes, read by a reader that did not write them. */
    let python = false;
    try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); python = true; } catch (e) { python = false; }
    if (python) {
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bx-l3-'));
      const file = path.join(dir, 'export.xlsx');
      fs.writeFileSync(file, xlsxBytes);
      const py = 'import sys,zipfile,re\nz=zipfile.ZipFile(sys.argv[1])\nprint(z.testzip() is None)\n'
        + 'x=z.read("xl/worksheets/sheet%d.xml" % len([n for n in z.namelist() if n.startswith("xl/worksheets/sheet")])).decode()\n'
        + 'print(len(re.findall("<v>13147</v>", x)))';
      const out = execFileSync('python3', ['-I', '-c', py, file], { encoding: 'utf8' }).trim().split('\n');
      eq(out, ['True', '1'], 'Python\'s zipfile opens the workbook cleanly and finds September\'s Spent as a number on the last sheet');
      fs.rmSync(dir, { recursive: true, force: true });
    }

    /* ---- the CSVs keep their columns ------------------------------------------- */
    eq(ctx.vault._store.get(written.find(p => p.endsWith('- Budget.csv'))).split('\n')[0],
      'Period,From,To,Category,Type,Currency,Budget,Actual,Remaining,Notes', 'no column was added to the Budget CSV');

    /* ---- D2-09: Used, by the share rule --------------------------------------- */
    ok(pdf.includes(`${ctx.locale().decimal === ',' ? '99,7' : '99.7'}%`), 'Gym, 997 of 1 000, prints 99,7% — not a rounded-up 100%');
    {
      const row = (cat, budget, actual) => ({ cat, type: 'expense', budget, actual, remaining: budget - actual });
      const m = bx.buildModel({
        periods: [{ key: 'p', name: 'P', title: 't', start: 'a', end: 'b', rows: [row('A', 1000, 997), row('B', 1000, 1002.4), row('C', 1000, 3), row('D', 1000, 500)], txs: [], summary: null }],
        content: 'full', categories: null, includeTx: false, generated: 'g', currency: 'R', inProgress: null,
      });
      const used = d => Object.fromEntries(bx.modelToDoc(m, { decimal: d }).blocks.filter(b => b.type === 'table').pop().rows.map(r => [r[0], r[5]]));
      eq(used(','), { A: '99,7%', B: '100,2%', C: '0,3%', D: '50%', 'Total expense': '' },
        'inside, over and barely-there shares say which side of the line they are on, in the household\'s mark (the subtotal has no Used, as before)');
      eq(used(undefined).A, '99.7%', 'a caller that knows no mark gets a point');
    }
  } finally { unpin(); }
  console.log(`PASS budget-export-refunds-and-headline (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
