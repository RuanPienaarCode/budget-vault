'use strict';
/* normDesc cleans a description ONCE, however many paints ask (2026-11-11
   audit, task 13a).

   The Services page matches every listed service against every outflow, and
   the match is on the cleaned description: lowercased, digits and punctuation
   stripped, whitespace collapsed — three regex passes. recurring.js already
   keeps the cleaned text per rows ARRAY, so one render cleans each row once
   rather than once per service; but the page builds a fresh array on every
   render, so every paint cleaned every description again. Measured at five
   years of history (18 000 rows): about 24 ms of each Services paint.

   Counted, not timed. The cleaning starts with one String#toLowerCase per
   description, and nothing else in src/recurring.js lowercases a description
   on the way through normDesc, so the number of cleans is that count.

   What this pins:
     1. the cached answer is the uncached rule's, on real statement shapes;
     2. a description asked for again — by a second paint, through a second
        array of the same rows — is not cleaned again;
     3. the cache is bounded in entries AND in what one entry may hold —
        including, section 5, that a kept description does not keep the whole
        month file it was cut from alive;
     4. a vault with more distinct descriptions than the bound is never worse
        off than before: nothing is evicted, so what the next paint asks for
        first is still there. (The first cut of a description cache reset
        itself at its cap; on a vault whose bank appends a unique reference to
        every line the reset evicted exactly the keys the next pass wanted,
        and 80 000 rows took 1.9 s against 1.2 s with no cache at all.)

     node tests/recurring-norm-desc-cache.test.cjs */
const assert = require('assert');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { normDesc, matchCharges, NORM_CACHE_MAX, NORM_CACHE_MAX_CHARS, normCacheSize } = require('../src/recurring');

/* The rule as written before the cache. */
const oracle = s => String(s || '').toLowerCase().replace(/\d+/g, ' ')
  .replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim();

/* Cleans performed while `fn` runs. */
function cleans(fn) {
  const real = String.prototype.toLowerCase;
  let n = 0;
  // eslint-disable-next-line no-extend-native
  String.prototype.toLowerCase = function () { n++; return real.call(this); };
  try { fn(); } finally { String.prototype.toLowerCase = real; }
  return n;
}

/* ---- 1. the same answer -------------------------------------------------- */
{
  const SHAPES = ['FIBRE CO123456789', 'Netflix.com 0800-123', 'POS PURCHASE 4521****1234 CHECKERS HYPER 12/08', '  spaced   out  ',
    'ÉCOLE & CAFÉ 42', 'debit order: MEDICAL-AID #77', '1234567890', '', '   ', 'A', 'a b c', 'IP111222-333444-DO', 'Müller GmbH 2026-08-01'];
  for (const pass of [1, 2]) {
    for (const s of SHAPES) eq(normDesc(s), oracle(s), `pass ${pass}: normDesc(${JSON.stringify(s)}) is the rule's "${oracle(s)}"`);
  }
  for (const odd of [null, undefined, 0, 42, false, {}, ['x']]) {
    eq(normDesc(odd), oracle(odd), `a non-string (${JSON.stringify(odd)}) is cleaned by the same rule and never kept`);
  }
}

/* ---- 2. asked again, not cleaned again ----------------------------------- */
{
  const once = cleans(() => { for (let i = 0; i < 500; i++) normDesc('Coffee Roasters ref 990017'); });
  ok(once <= 1, `500 asks for one description clean it once (cleaned ${once} times)`);

  /* The Services page's own shape: the same row objects, handed to
     matchCharges in a NEW array on every render. */
  const rows = [];
  for (let i = 0; i < 400; i++) rows.push({ date: `2026-0${1 + (i % 9)}-1${i % 9}`, desc: `Fibre Co ${100000 + i} debit order`, amount: -799 - (i % 3) });
  const service = { name: 'Fibre', provider: 'Fibre Co', amount: 799, cycle: 'monthly' };
  const first = cleans(() => matchCharges(service, rows.slice()));
  const second = cleans(() => matchCharges(service, rows.slice()));
  ok(first >= 400, `the first render cleans each of its 400 descriptions (${first})`);
  ok(second <= 2, `the second render, over a fresh array of the same rows, cleans none of them again (${second}; the service's own name is the only other thing lowercased)`);
  eq(matchCharges(service, rows.slice()).charges.length, matchCharges(service, rows).charges.length, 'and matches the same charges either way');

  /* A row edited in place is a different description: it gets its own answer,
     never the old one. */
  const edited = [{ date: '2026-08-01', desc: 'Old Gym 123', amount: -300 }];
  matchCharges({ name: 'Gym', provider: 'Old Gym' }, edited);
  edited[0].desc = 'New Yoga Studio 456';
  eq(normDesc(edited[0].desc), 'new yoga studio', 'an edited description is cleaned as what it now says');
}

/* ---- 3. bounded ----------------------------------------------------------- */
{
  ok(Number.isInteger(NORM_CACHE_MAX) && NORM_CACHE_MAX >= 60 * 300,
    `the bound holds five years at 300 rows a month even if every description is unique (${NORM_CACHE_MAX})`);
  ok(Number.isInteger(NORM_CACHE_MAX_CHARS) && NORM_CACHE_MAX_CHARS >= 80, `and one entry is capped in length (${NORM_CACHE_MAX_CHARS} characters)`);

  const before = normCacheSize();
  const long = 'x'.repeat(NORM_CACHE_MAX_CHARS + 1) + ' 123';
  eq(normDesc(long), oracle(long), 'a description longer than the cap is cleaned correctly');
  eq(normCacheSize(), before, 'and not kept: a paragraph pasted into a description cell cannot sit in the cache');

  let top = 0;
  const N = NORM_CACHE_MAX * 3;
  const key = i => `Unique merchant line ${i} ref`;
  for (let i = 0; i < N; i++) { normDesc(key(i)); if (normCacheSize() > top) top = normCacheSize(); }
  ok(top <= NORM_CACHE_MAX, `the cache never holds more than its bound (peaked at ${top} of ${NORM_CACHE_MAX}) after ${N} distinct descriptions`);
  eq(top, NORM_CACHE_MAX, 'and it did fill, so the bound was tested against a full cache');

  /* ---- 4. past the bound: no worse than before, and no thrash ------------ */
  for (const i of [0, 1, NORM_CACHE_MAX, N - 1]) eq(normDesc(key(i)), oracle(key(i)), `description ${i} is still cleaned correctly with the cache full`);
  /* The next paint asks for the same descriptions in the same order. Whatever
     the cache kept, it must still hold — a cache that reset or evicted on the
     way past its bound would clean all N again (or more). */
  const again = cleans(() => { for (let i = 0; i < N; i++) normDesc(key(i)); });
  ok(again < N, `a second pass over ${N} descriptions cleans fewer than all of them (${again}): what was kept is still there`);
  ok(again <= N - Math.floor(NORM_CACHE_MAX / 2), `at least half the bound was served from the cache (${N - again} of ${NORM_CACHE_MAX})`);
  ok(normCacheSize() <= NORM_CACHE_MAX, 'and the cache is still within its bound afterwards');
}

/* ---- 5. a kept description does not keep its FILE alive -------------------- */
{
  /* V8 represents a substring of 13 or more characters as a SLICE of its
     parent, and a cell cut out of a month file by split() and trim() is such a
     slice — of the whole file's text. A cache that outlives a reload and keeps
     that slice as its key keeps every byte of the file it was cut from: 300
     keys cut from 300 texts of ~100 KB held 29 MB in the measurement behind
     this section, against 0.1 MB with the keys copied flat. The loader happens
     to hand over flat strings today; the bound on this cache must not rest on
     that. Measured in a child process, because it needs --expose-gc and a heap
     nothing else is using; the gap between the two outcomes is two orders of
     magnitude, so the threshold is not a fine one. */
  const { execFileSync } = require('child_process');
  const script = `
    const { normDesc, normCacheSize } = require(${JSON.stringify(require('path').join(__dirname, '..', 'src', 'recurring.js'))});
    global.gc(); const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 300; i++) {
      const text = ('| 2026-08-01 | Merchant number ' + i + ' of the month, reference long enough | Groceries | -10.00 |  |  |  |\\n').repeat(1000);
      normDesc(text.split('\\n')[5].split('|')[2].trim());
    }
    global.gc(); global.gc();
    process.stdout.write(JSON.stringify({ kept: process.memoryUsage().heapUsed - before, size: normCacheSize() }));`;
  const out = JSON.parse(execFileSync(process.execPath, ['--expose-gc', '-e', script], { encoding: 'utf8' }));
  eq(out.size, 300, 'the child kept its 300 descriptions, so what follows measured a cache in use');
  ok(out.kept < 5 * 1048576,
    `300 descriptions cut from 300 file-sized texts keep under 5 MB alive once the texts are gone (kept ${(out.kept / 1048576).toFixed(1)} MB; a key that is a slice of its file keeps ~29 MB)`);
}

console.log(`PASS — normDesc cleans a description once, within a bound that never thrashes (${checks} checks)`);
