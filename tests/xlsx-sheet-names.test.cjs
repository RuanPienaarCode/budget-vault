'use strict';
/* sheetName checks the name it WRITES, and Excel's reserved name is refused.

   2026-10-07 audit, L4A-10 (latent: every caller today passes a fixed English
   literal). sheetName() promises that "every rule here is Excel's own", but:

     1. it tested a name for emptiness, length and uniqueness BEFORE
        workbookXml's escXml stripped the characters XML 1.0 cannot carry — so
        a name made only of control characters passed as non-empty and was
        written as name="", and a name that was unique only by such a
        character collided with its neighbour once stripped. Excel refuses a
        workbook with an empty or duplicate sheet name ("repair?");
     2. it let "History" through. Excel reserves that name (any case) for its
        own change-tracking sheet and will not open a workbook that uses it.

   Now the illegal characters go first, and every rule runs on what is left;
   "History" is treated as already taken, so it disambiguates like any other
   collision. A cap at 31 never splits a surrogate pair (the half that escXml
   would then drop is a name changing after it was checked, again).

   Read back through python's zipfile + minidom when the machine has them —
   the reader is not this repo's.

     node tests/xlsx-sheet-names.test.cjs */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildXlsx, sheetName } = require('../src/xlsx');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* the names workbook.xml actually carries, read with a plain regex over the stored (uncompressed) part */
const namesIn = xlsx => {
  const s = Buffer.from(xlsx).toString('utf8');
  const wb = s.slice(s.indexOf('<workbook'), s.indexOf('</workbook>'));
  return [...wb.matchAll(/<sheet name="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
};

{
  eq(sheetName('\u0001\u0002', new Set()), 'Sheet', 'a name of nothing but control characters is EMPTY once they are stripped — it falls back, it is not written as ""');
  eq(sheetName('Summary\u0007', new Set()), 'Summary', 'a stray control character is stripped before the name is checked');
  const taken = new Set();
  eq(sheetName('Budget', taken), 'Budget', 'first use');
  eq(sheetName('Budget\u0001', taken), 'Budget (2)', 'unique only by an illegal character is NOT unique: it disambiguates instead of colliding after the strip');
  eq(sheetName('A\uD800B', new Set()), 'AB', 'a lone surrogate is stripped before the checks too');
  eq(sheetName('Tab\there', new Set()), 'Tab here', 'a tab or newline becomes a space (an attribute value would read it as one anyway)');
}
{
  eq(sheetName('History', new Set()), 'History (2)', 'Excel\'s reserved "History" is never written as a sheet name');
  eq(sheetName('history', new Set()), 'history (2)', 'in any case');
  eq(sheetName(' HISTORY ', new Set()), 'HISTORY (2)', 'or with stray spaces');
  eq(sheetName('History of spending', new Set()), 'History of spending', 'only the exact name is reserved');
  const taken = new Set();
  sheetName('History', taken);
  eq(sheetName('History (2)', taken), 'History (2) (2)', 'and the disambiguated name is itself taken afterwards');
}
{
  const smile = '😀';
  const name = sheetName('x'.repeat(30) + smile + 'tail', new Set());
  ok(name.length <= 31, `capped at 31 (got ${name.length})`);
  ok(!/[\uD800-\uDBFF]$/.test(name), 'the cap never leaves half of a surrogate pair at the end');
  eq(name, 'x'.repeat(30), 'it drops the whole emoji instead');
  // 29 units; disambiguating cuts it to 27 to make room for " (2)" — which would land between the emoji's two halves
  const raw = 'y'.repeat(26) + smile + 'z';
  const long = sheetName(raw, new Set([raw.toLowerCase()]));
  eq(long, 'y'.repeat(26) + ' (2)', `disambiguating a long name cuts on a character boundary too (${JSON.stringify(long)})`);
}

/* ---- the workbook: what a reader sees ---- */
{
  const xlsx = buildXlsx([{ name: '\u0001\u0002', rows: [['a']] }, { name: 'History', rows: [['b']] }, { name: 'Sheet', rows: [['c']] }], { created: '2026-10-07T12:00' });
  const names = namesIn(xlsx);
  eq(names, ['Sheet', 'History (2)', 'Sheet (2)'], 'workbook.xml names: none empty, none reserved, all distinct');
  let py = null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-vault-sheets-'));
  const f = path.join(dir, 'names.xlsx');
  fs.writeFileSync(f, xlsx);
  try {
    py = execFileSync('python3', ['-c', 'import zipfile,sys,json; from xml.dom import minidom; d=minidom.parseString(zipfile.ZipFile(sys.argv[1]).read("xl/workbook.xml")); print(json.dumps([s.getAttribute("name") for s in d.getElementsByTagName("sheet")]))', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { py = null; }
  if (py) eq(JSON.parse(py), ['Sheet', 'History (2)', 'Sheet (2)'], 'python minidom reads the same three names');
  else console.log('xlsx-sheet-names: python3 not found — minidom read-back skipped');
}

console.log(`PASS xlsx-sheet-names (${checks} checks)`);
