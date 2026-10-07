'use strict';
/* The two things an exported file says about itself — its title and when it
   was made — read back the way a reader reads them.

   2026-10-07 audit:

     L4A-08  pdf.js wrote an /Info string it could encode in WinAnsi as WinAnsi
             bytes. A reader decodes an Info literal as PDFDocEncoding, and the
             two disagree in 0x80-0x9F: a fortnightly household's range label
             "Sep – Oct 2026" carries an en dash (WinAnsi 0x96), which every
             reader showed as "Œ" in the document's title bar and properties.
             Now any character above 0x7E sends the string to UTF-16BE with a
             BOM — the one encoding the spec defines for "any text" — and plain
             ASCII stays the literal it always was (the bytes do not move).
     L4A-09  both binary exports stamped LOCAL wall time as UTC. `created` is
             nowLocalMinute() — the household's own clock — and xlsx.js
             appended ":00Z" while pdf.js wrote a zone-less D: date readers
             take as UTC. An export made at 14:00 in Johannesburg claimed to
             have been made at 14:00Z, two hours in the future. The writers now
             take the zone as `utcOffset` (minutes east of UTC): the workbook
             states the instant in UTC (what Excel itself writes into
             core.xml), the PDF states local time WITH its offset (what Acrobat
             writes). The ZIP's DOS timestamps stay local wall time — DOS time
             has no zone and every unzip tool shows it as local.

   Without a `utcOffset` both writers behave exactly as before, so a caller
   that never passes one — and every byte-golden built on them — is unchanged;
   the view always passes one.

   Read back with this file's own small parsers AND, where the machine has
   them, poppler's pdfinfo and python's zipfile. Synthetic data only.

     node tests/export-metadata.test.cjs */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { PAGE, layoutDocument, helveticaMeasure, renderVectorPdf, renderImagePdf } = require('../src/pdf');
const { buildXlsx } = require('../src/xlsx');
const { pinClock } = require('./helpers/figures.cjs');
const FILES = require('./helpers/views-vault.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const latin1 = b => Buffer.from(b).toString('latin1');
const titleOf = bytes => {
  const t = latin1(bytes);
  const hex = /\/Title <(feff[0-9a-f]*)>/i.exec(t);
  if (hex) return { form: 'utf16', text: Buffer.from(hex[1].slice(4), 'hex').swap16().toString('utf16le') };
  const lit = /\/Title \(((?:\\.|[^\\)])*)\)/.exec(t);
  return lit ? { form: 'literal', text: lit[1].replace(/\\(.)/g, '$1') } : null;
};
const creationOf = bytes => (/\/CreationDate \((D:[^)]*)\)/.exec(latin1(bytes)) || [])[1];
const vector = meta => renderVectorPdf(layoutDocument({ title: 'T', blocks: [] }, { measure: helveticaMeasure, page: PAGE.A4 }), { meta });
const coreCreated = xlsx => (/<dcterms:created xsi:type="dcterms:W3CDTF">([^<]*)</.exec(Buffer.from(xlsx).toString('utf8')) || [])[1];
const coreModified = xlsx => (/<dcterms:modified xsi:type="dcterms:W3CDTF">([^<]*)</.exec(Buffer.from(xlsx).toString('utf8')) || [])[1];
/* The first local header's DOS time/date (every entry carries the same pair). */
const dosStamp = xlsx => {
  const dv = new DataView(xlsx.buffer, xlsx.byteOffset, xlsx.byteLength);
  const time = dv.getUint16(10, true), date = dv.getUint16(12, true);
  const p2 = n => String(n).padStart(2, '0');
  return `${1980 + (date >> 9)}-${p2((date >> 5) & 0xf)}-${p2(date & 0x1f)} ${p2(time >> 11)}:${p2((time >> 5) & 0x3f)}`;
};

/* ---------------- L4A-08: the PDF title, as a reader decodes it ---------------- */
{
  const dash = 'Budget summary September 2026 to Sep – Oct 2026';
  const t1 = titleOf(vector({ title: dash, created: '2026-10-07T14:00' }));
  eq(t1, { form: 'utf16', text: dash }, 'a title with an en dash is written UTF-16BE with a BOM, and decodes to exactly the title');
  const t2 = titleOf(vector({ title: 'Begroting Junie – Julie · café', created: '2026-10-07T14:00' }));
  eq(t2 && t2.form, 'utf16', 'Latin-1 letters and a middle dot are above 0x7E too — UTF-16BE, never a WinAnsi byte a reader re-reads as PDFDocEncoding');
  eq(t2.text, 'Begroting Junie – Julie · café', 'and they round-trip exactly');
  const t3 = titleOf(vector({ title: 'Budget June 2026 to July 2026 (Rent)', created: '2026-10-07T14:00' }));
  eq(t3, { form: 'literal', text: 'Budget June 2026 to July 2026 (Rent)' }, 'plain ASCII stays a literal string — the bytes of an ordinary export do not move');
  ok(latin1(vector({ title: 'A (b) \\ c', created: '2026-10-07T14:00' })).includes('/Title (A \\(b\\) \\\\ c)'), 'and keeps its escapes');
  ok(latin1(vector({ title: 'T', producer: 'Budget Vault', created: '2026-10-07T14:00' })).includes('/Producer (Budget Vault)'), '/Producer is the same rule: ASCII, literal');
  const ras = renderImagePdf([{ jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 2, height: 2 }], { page: PAGE.A4, meta: { title: dash, created: '2026-10-07T14:00' } });
  eq(titleOf(ras), { form: 'utf16', text: dash }, 'the image backend writes its Info the same way');
}

/* ---------------- L4A-09: the creation time names its zone ---------------- */
{
  eq(creationOf(vector({ title: 'T', created: '2026-10-07T14:00', utcOffset: 120 })), "D:20261007140000+02'00'", 'SAST: local wall time WITH its +02:00 offset');
  eq(creationOf(vector({ title: 'T', created: '2026-10-07T09:00', utcOffset: -300 })), "D:20261007090000-05'00'", 'a zone west of UTC carries a minus');
  eq(creationOf(vector({ title: 'T', created: '2026-10-07T17:30', utcOffset: 330 })), "D:20261007173000+05'30'", 'half-hour zones keep their minutes');
  eq(creationOf(vector({ title: 'T', created: '2026-10-07T12:00', utcOffset: 0 })), 'D:20261007120000Z', 'UTC itself is Z');
  eq(creationOf(vector({ title: 'T', created: '2026-10-07T14:00' })), 'D:20261007140000', 'no offset handed in: the date exactly as before (no zone claimed)');
  eq(creationOf(vector({ title: 'T', created: '2026-10-07T14:00', utcOffset: NaN })), 'D:20261007140000', 'an offset that is not a number is no offset');
  const ras = renderImagePdf([{ jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 2, height: 2 }], { page: PAGE.A4, meta: { title: 'T', created: '2026-10-07T14:00', utcOffset: 120 } });
  eq(creationOf(ras), "D:20261007140000+02'00'", 'the image backend states the zone too');

  const sheets = [{ name: 'S', rows: [['a', 1]] }];
  const sast = buildXlsx(sheets, { created: '2026-10-07T14:00', utcOffset: 120 });
  eq(coreCreated(sast), '2026-10-07T12:00:00Z', 'workbook: 14:00 SAST is the instant 12:00 UTC');
  eq(coreModified(sast), '2026-10-07T12:00:00Z', 'and modified says the same instant');
  eq(dosStamp(sast), '2026-10-07 14:00', 'while the ZIP entries keep LOCAL wall time — DOS time has no zone');
  eq(coreCreated(buildXlsx(sheets, { created: '2026-10-07T01:30', utcOffset: 120 })), '2026-10-06T23:30:00Z', 'the UTC instant can be on the previous day');
  eq(coreCreated(buildXlsx(sheets, { created: '2026-12-31T22:00', utcOffset: -300 })), '2027-01-01T03:00:00Z', 'or the next year');
  eq(coreCreated(buildXlsx(sheets, { created: '2026-10-07T17:30', utcOffset: 330 })), '2026-10-07T12:00:00Z', 'half-hour zones');
  eq(coreCreated(buildXlsx(sheets, { created: '2026-10-07T14:00' })), '2026-10-07T14:00:00Z', 'no offset handed in: exactly the bytes buildXlsx always wrote');
  eq(Buffer.from(buildXlsx(sheets, { created: '2026-10-07T14:00' })).toString('hex'),
    Buffer.from(buildXlsx(sheets, { created: '2026-10-07T14:00', utcOffset: undefined })).toString('hex'), 'an undefined offset is the same as none');
}

/* ---------------- the view hands the zone over ----------------
   Johannesburg, 12:00Z on the pinned day: the household's clock reads 14:00. */
(async () => {
  const unpin = pinClock('2026-07-15');
  process.env.TZ = 'Africa/Johannesburg';
  const extra = {
    'Budget/Budgets/2026-06.md': '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 4500.00 | |\n| Salary | income | 40000.00 | |\n',
    'Budget/Transactions/Cheque/2026-06.md': `---\n${FILES.TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
      + '| 2026-06-01 | Salary | Salary | 40000.00 |  |  |  |\n| 2026-06-04 | Grocer | Groceries | -2100.50 |  |  |  |\n',
  };
  try {
    const ctx = makeCtx({ ...FILES, ...extra });
    await loadInto(ctx);
    ctx.money = v => `R ${Number(v).toFixed(2)}`;
    ctx.currentPeriod = () => '2026-07';
    require('../src/views/budget-export')(ctx);
    const answer = { range: '3', includeCurrent: true, content: 'summary', categories: null, includeTx: false, formats: ['pdf', 'xlsx'], folder: 'Exports' };
    const { written, model } = await ctx.runBudgetExport(answer);
    eq(model.generated, '2026-07-15 14:00', 'the stamp is the household\'s wall clock (14:00 in Johannesburg at 12:00Z)');
    const pdf = new Uint8Array(ctx.vault._store.get(written.find(p => p.endsWith('.pdf'))));
    const xlsx = new Uint8Array(ctx.vault._store.get(written.find(p => p.endsWith('.xlsx'))));
    eq(creationOf(pdf), "D:20260715140000+02'00'", 'the exported PDF says 14:00 at +02:00 — the right instant');
    eq(coreCreated(xlsx), '2026-07-15T12:00:00Z', 'the exported workbook says 12:00Z — the same instant');
    eq(dosStamp(xlsx), '2026-07-15 14:00', 'and its ZIP entries say 14:00 local, as before');

    /* External readers, when the machine has them. */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-vault-meta-'));
    const pdfPath = path.join(dir, 'x.pdf'), xlsxPath = path.join(dir, 'x.xlsx'), dashPath = path.join(dir, 'dash.pdf');
    fs.writeFileSync(pdfPath, pdf); fs.writeFileSync(xlsxPath, xlsx);
    fs.writeFileSync(dashPath, vector({ title: 'Budget summary September 2026 to Sep – Oct 2026', created: '2026-10-07T14:00', utcOffset: 120 }));
    let pdfinfo = null;
    try { pdfinfo = execFileSync('pdfinfo', ['-isodates', pdfPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { pdfinfo = null; }
    if (pdfinfo) {
      ok(/CreationDate:\s+2026-07-15T14:00:00\+02/.test(pdfinfo), `pdfinfo reads the creation time with its zone: ${(pdfinfo.split('\n').find(l => l.startsWith('CreationDate')) || '').trim()}`);
      const t = execFileSync('pdfinfo', [dashPath], { encoding: 'utf8' }).split('\n').find(l => l.startsWith('Title:'));
      eq(t.replace(/^Title:\s+/, ''), 'Budget summary September 2026 to Sep – Oct 2026', 'pdfinfo reads the en dash as an en dash, not "Œ"');
    } else console.log('export-metadata: pdfinfo not found — poppler read-back skipped');
    let py = null;
    try { py = execFileSync('python3', ['-c', 'import zipfile,sys,re; print(re.search(r"<dcterms:created[^>]*>([^<]*)<", zipfile.ZipFile(sys.argv[1]).read("docProps/core.xml").decode()).group(1))', xlsxPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { py = null; }
    if (py) eq(py, '2026-07-15T12:00:00Z', 'python zipfile reads the same core.xml instant');
    else console.log('export-metadata: python3 not found — zipfile read-back skipped');
  } finally {
    unpin();
  }
  console.log(`PASS export-metadata (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
