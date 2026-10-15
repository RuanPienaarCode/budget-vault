'use strict';
/* parseDelimited stays linear on an unquoted field full of quotes, and reads
   every file exactly as it did.

   L4b-01 (Low). A quote opens a quoted field only at the START of one, which the
   parser decided by running `field.trim() === ''` at every `"` it met in an
   unquoted field. trim() copies the whole field, so a field holding n quotes
   cost O(n^2): a 400 000-character field took 9.5 s. A statement CSV is
   untrusted input and the parse runs on the main thread, so one hostile
   description froze the app.

   The fix carries a running "only whitespace so far" flag instead. Because that
   is a rewrite of the one function every statement and the rules file go
   through, the second half of this test is the proof it changed nothing it
   should not: the previous implementation is kept below as `reference` and the
   two are run over a few thousand generated texts built from the characters
   that matter (quotes, both delimiters, CR, LF, spaces, tabs, a no-break
   space, letters), asserting identical rows.

     node tests/csv-quote-scan-linear.test.cjs */

const assert = require('assert');
const { parseDelimited } = require('../src/csv');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The implementation as shipped in 1.52.0, verbatim apart from the name. */
function reference(text, delim) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      inQ = true;
    }
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ---- 1. the cost ---- */
{
  const ms = f => { const t = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
  const mk = ch => 'Date,Description,Amount\n2026-01-01,REF a' + ch.repeat(400000) + ',-10.00\n2026-01-02,SHOP,-5.00\n';
  const [tq, rq] = ms(() => parseDelimited(mk('"'), ','));
  const [tb, rb] = ms(() => parseDelimited(mk('b'), ','));
  eq(rq.length, rb.length, 'the quote-filled field parses to the same number of rows as a plain one');
  ok(tq < 1000, `a 400 000-quote field parses in ${tq.toFixed(0)} ms (was ~9 500 ms; budget 1 000 ms), plain field ${tb.toFixed(0)} ms`);
}

/* ---- 2. what it reads is unchanged ---- */
eq(parseDelimited('a,"b,c",d\n', ','), [['a', 'b,c', 'd']], 'a quoted field still opens at the start of a field');
eq(parseDelimited('a, "b,c",d\n', ','), reference('a, "b,c",d\n', ','), 'and after a delimiter plus a space, as it always did');
eq(parseDelimited('BUILDERS 15" HOSE,10\n', ','), [['BUILDERS 15" HOSE', '10']], 'an inch mark mid-field is a literal quote (issue 51)');
eq(parseDelimited('"a""b",c\n', ','), [['a"b', 'c']], 'a doubled quote inside a quoted field is one quote');

const ALPHA = ['"', '"', ',', ';', '\n', '\r', ' ', ' ', '\t', ' ', 'a', 'b', '1'];
let seed = 20261014;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let compared = 0;
for (let n = 0; n < 6000; n++) {
  const len = 1 + Math.floor(rnd() * 40);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[Math.floor(rnd() * ALPHA.length)];
  for (const d of [',', ';']) {
    const want = reference(s, d), got = parseDelimited(s, d);
    if (JSON.stringify(want) !== JSON.stringify(got)) assert.fail(`diverged on ${JSON.stringify(s)} delim ${d}: ${JSON.stringify(want)} vs ${JSON.stringify(got)}`);
    compared++;
  }
}
checks++;
ok(compared === 12000, `12 000 generated texts read identically to the 1.52.0 parser (${compared})`);

console.log(`PASS csv-quote-scan-linear (${checks} checks)`);
