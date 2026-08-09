'use strict';
/* Delimiter sniffing + character-encoding detection for FOREIGN statement
   files — everything that happens between "the user dropped a file" and
   "detectStatementColumns gets an array of rows".

   Both of these fail silently rather than loudly, which is why they are pinned
   here:

     - Guess the delimiter wrong and every row parses as ONE field. That isn't
       an error; it reaches detectStatementColumns as an unrecognisable file,
       and the user is sent to the manual mapper with a single column to map.

     - Guess the encoding wrong and merchant names come back with replacement
       characters or NULs in them. That imports. It writes to disk, it becomes
       the dedup key, and learnRules turns it into a permanent categorisation
       rule matching a name the bank will never send again.

   Runs in bare node. Wired into ./build.sh.
     node tests/statement-decoding.test.cjs
*/

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

const { parseCsv, parseDelimited, sniffDelimiter } = require('../src/csv');
const { parseStatement, decodeStatement, detectStatementColumns, reconcileAmounts } = require('../src/statement');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const bytes = (...n) => Uint8Array.from(n);
const utf8 = s => new TextEncoder().encode(s);
/* ASCII → UTF-16, either byte order, with or without a BOM. */
function utf16(s, { le = true, bom = false } = {}) {
  const out = [];
  if (bom) out.push(...(le ? [0xFF, 0xFE] : [0xFE, 0xFF]));
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out.push(...(le ? [c & 0xFF, c >> 8] : [c >> 8, c & 0xFF]));
  }
  return Uint8Array.from(out);
}

/* ========================== delimiter sniffing ========================== */

/* The ordinary case, and the one that must never regress: a plain SA bank
   CSV stays a comma CSV. */
{
  const csv = [
    'Date,Description,Amount,Balance',
    '2026-07-01,WOOLWORTHS SANDTON,-249.99,10250.01',
    '2026-07-02,SALARY,25000.00,35250.01',
    '2026-07-03,VODACOM PREPAID,-99.00,35151.01',
  ].join('\n');
  eq(sniffDelimiter(csv), ',', 'a comma CSV sniffs as comma');
  eq(parseStatement(csv)[1][1], 'WOOLWORTHS SANDTON', 'and parses into the same rows as before');
}

/* The case this exists for. A comma-decimal locale exports semicolons, and the
   commas inside the amounts OUTNUMBER nothing but are numerous enough that a
   raw frequency count is not obviously safe. Score by consistency and the
   semicolons win: they produce a square block of rows, the commas a ragged one. */
{
  const eu = [
    'Datum;Beschreibung;Betrag;Saldo',
    '01.07.2026;REWE MARKT;-24,99;1.250,01',
    '02.07.2026;GEHALT;2.500,00;3.750,01',
    '03.07.2026;VODAFONE;-9,99;3.740,02',
  ].join('\n');
  eq(sniffDelimiter(eu), ';', 'a semicolon export sniffs as semicolon, not comma');
  const rows = parseStatement(eu);
  eq(rows[1].length, 4, 'and yields four fields per row');
  eq(rows[1][1], 'REWE MARKT', 'with the description intact');
  /* The German headers are not in DATE_COLS/AMOUNT_COLS, so this file still
     goes to the manual mapper — correctly, because "Betrag" is not something
     to guess at. What the delimiter fix buys is WHAT THE MAPPER IS HANDED:
     four columns to point at instead of one 60-character field that cannot be
     mapped to anything. That is the whole difference between importable and
     not, so it is the thing worth pinning. */
  eq(detectStatementColumns(rows, true), null,
    'unknown-language headers still ask rather than guess');
  eq(rows.reduce((w, r) => Math.max(w, r.length), 0), 4,
    'but the mapper is offered four real columns — before the fix it was one');
}

/* The same file with headers the detector knows imports with no mapper at all,
   which is the outcome for an English-language bank that happens to export
   semicolons. */
{
  const rows = parseStatement([
    'Date;Description;Amount;Balance',
    '01/07/2026;REWE MARKT;-24.99;1250.01',
    '02/07/2026;SALARY;2500.00;3750.01',
  ].join('\n'));
  const map = detectStatementColumns(rows, true);
  ok(map, 'a semicolon export with known headers resolves without the mapper');
  eq([map.iDate, map.iDesc, map.iAmount, map.iBalance], [0, 1, 2, 3],
    'and every column lands where the header names say it should');
}

/* Tab-separated, with commas inside the descriptions — the shape where a naive
   "most frequent character" sniff is most likely to pick the wrong one. */
{
  const tsv = [
    'Date\tDescription\tAmount',
    '2026-07-01\tPICK N PAY, CENTURION\t-320.50',
    '2026-07-02\tCLICKS, MENLYN\t-89.99',
    '2026-07-03\tENGEN, LYNNWOOD ROAD\t-750.00',
  ].join('\n');
  eq(sniffDelimiter(tsv), '\t', 'tabs win over the commas inside the descriptions');
  eq(parseStatement(tsv)[1][1], 'PICK N PAY, CENTURION',
    'and the comma stays part of the description rather than splitting it');
}

/* Pipe-delimited. Rarer, but it costs one entry in the candidate list. */
{
  const psv = [
    'Date|Description|Amount',
    '2026-07-01|CHECKERS|-120.00',
    '2026-07-02|SALARY|18000.00',
  ].join('\n');
  eq(sniffDelimiter(psv), '|', 'a pipe-delimited export sniffs as pipe');
}

/* A single-column file has no delimiter to find. Comma is the fallback, and
   the important part is that it does not throw or pick something arbitrary —
   the file goes to the manual mapper, which is the correct answer for it. */
{
  eq(sniffDelimiter('Date\n2026-07-01\n2026-07-02\n'), ',',
    'a file with no delimiter at all falls back to comma rather than guessing');
  eq(sniffDelimiter(''), ',', 'and an empty file does not throw');
}

/* Quoted fields containing the delimiter must not be counted as separators —
   the sniffer parses with each candidate rather than counting characters, so
   this comes out right for free. Pinned because a rewrite to a cheap
   character count would break it silently. */
{
  const csv = [
    'Date,Description,Amount',
    '2026-07-01,"SPAR, BROOKLYN; MALL",-210.00',
    '2026-07-02,"TAKEALOT; ORDER 12,345",-899.00',
    '2026-07-03,"NETFLIX; MONTHLY",-199.00',
  ].join('\n');
  eq(sniffDelimiter(csv), ',', 'delimiters inside quoted fields do not vote');
  eq(parseStatement(csv)[1][1], 'SPAR, BROOKLYN; MALL', 'and the quoted field survives intact');
}

/* parseCsv is the app's OWN reader — Data/Categorisation Rules.csv — and must
   stay comma-only. A learned rule whose pattern contains a semicolon or a tab
   would otherwise re-sniff the whole file into a different shape and scramble
   every rule in it. */
{
  const rules = [
    'Pattern,Category',
    'WOOLWORTHS;SANDTON;ZA,Groceries',
    'PICK N PAY;MENLYN;ZA,Groceries',
    'ENGEN;LYNNWOOD;ZA,Fuel',
  ].join('\n');
  eq(parseCsv(rules)[1], ['WOOLWORTHS;SANDTON;ZA', 'Groceries'],
    'parseCsv splits on commas only, whatever the field contents look like');
  // Not a hypothetical hazard: these patterns carry two semicolons each, which
  // is a squarer block than the commas produce, so the sniffer genuinely
  // prefers semicolon here. Run this file through it and every rule in the
  // vault is silently repartitioned.
  eq(sniffDelimiter(rules), ';',
    'sniffing the same text WOULD have chosen semicolon — which is why the app’s own files never sniff');
  eq(parseCsv(rules).length, 4, 'parseCsv is unmoved by that and still reads four rows');
}

/* parseDelimited under an explicit delimiter keeps every quoting rule the
   original comma-only scanner had. */
{
  eq(parseDelimited('a;"b""c";d\n', ';'), [['a', 'b"c', 'd']], 'doubled quotes unescape');
  eq(parseDelimited('a;b\r\nc;d\r\n', ';'), [['a', 'b'], ['c', 'd']], 'CRLF line endings');
  eq(parseDelimited('a;"multi\nline";c\n', ';'), [['a', 'multi\nline', 'c']],
    'a newline inside a quoted field does not end the row');
}

/* ========================== encoding detection ========================== */

/* Plain UTF-8, the overwhelmingly common case. */
{
  eq(decodeStatement(utf8('Date,Description\n2026-07-01,CAFÉ ENIQUE\n')),
    'Date,Description\n2026-07-01,CAFÉ ENIQUE\n', 'UTF-8 round-trips');
}

/* Excel on Windows writes a UTF-8 BOM. It must not survive into the first
   header cell — "﻿Date" does not match the DATE_COLS list, so a BOM left
   in place turns a perfectly ordinary statement into an unrecognised one. */
{
  const withBom = Uint8Array.from([0xEF, 0xBB, 0xBF, ...utf8('Date,Description\n2026-07-01,SPAR\n')]);
  const text = decodeStatement(withBom);
  ok(!text.startsWith('﻿'), 'the UTF-8 BOM is stripped');
  eq(parseStatement(text)[0][0], 'Date', 'so the first header cell matches by name');
}

/* windows-1252. The bytes are not valid UTF-8, so the fatal probe rejects them
   and the legacy decoder takes over. Decoded as UTF-8 this row would carry
   U+FFFD where the é is — which imports, and becomes a dedup key and a
   learned rule that can never match the same merchant again. */
{
  // "CAFE" + 0xC9 (É in cp1252) + " ROMA"
  const cp1252 = Uint8Array.from([...utf8('Date,Description\n2026-07-01,CAF'), 0xC9, ...utf8(' ROMA\n')]);
  const text = decodeStatement(cp1252);
  eq(parseStatement(text)[1][1], 'CAFÉ ROMA', 'windows-1252 bytes decode to the right characters');
  ok(!text.includes('�'), 'and no replacement character reaches the description');
}

/* UTF-16 with a BOM, both byte orders. */
{
  const src = 'Date,Description\n2026-07-01,WOOLWORTHS\n';
  eq(decodeStatement(utf16(src, { le: true, bom: true })), src, 'UTF-16LE with BOM');
  eq(decodeStatement(utf16(src, { le: false, bom: true })), src, 'UTF-16BE with BOM');
}

/* BOM-less UTF-16 — the one case the fatal-UTF-8 probe cannot catch, because
   NUL is valid UTF-8. Without the explicit NUL-pattern check this decodes
   "successfully" into "D\0a\0t\0e\0", which parses, imports, and looks like a
   merchant name with gaps in it. */
{
  const src = 'Date,Description,Amount\n2026-07-01,WOOLWORTHS,-249.99\n';
  const le = decodeStatement(utf16(src, { le: true, bom: false }));
  eq(le, src, 'BOM-less UTF-16LE is detected from its NUL pattern');
  ok(!le.includes(' '), 'and no NUL survives into the parsed text');
  eq(decodeStatement(utf16(src, { le: false, bom: false })), src, 'BOM-less UTF-16BE too');
}

/* The NUL heuristic must not fire on short ASCII files, where two or three
   incidental bytes could clear a proportional threshold. */
{
  eq(decodeStatement(utf8('a,b\n')), 'a,b\n', 'a tiny ASCII file is not mistaken for UTF-16');
  eq(decodeStatement(bytes()), '', 'an empty file decodes to an empty string rather than throwing');
}

/* End to end: the two fixes compose. A semicolon file in windows-1252 — the
   realistic European-bank export — arrives as usable rows. */
{
  const line = (...f) => f.join(';');
  const src = [line('Datum', 'Beschreibung', 'Betrag'),
    line('01.07.2026', 'CAFÉ ROMA', '-24,99'),
    line('02.07.2026', 'MÜLLER DROGERIE', '-15,50'),
    line('03.07.2026', 'GEHALT', '2500,00')].join('\n') + '\n';
  const raw = Uint8Array.from([...src].map(c => c.charCodeAt(0)));   // cp1252 is byte-per-char here
  const rows = parseStatement(decodeStatement(raw));
  eq(rows[1], ['01.07.2026', 'CAFÉ ROMA', '-24,99'],
    'a windows-1252 semicolon export decodes AND splits correctly');
  eq(rows[2][1], 'MÜLLER DROGERIE', 'including the row that motivated the encoding work');
}


/* ---- a file can prove its own signs are INVERTED, not merely unproven ----

   reconcileAmounts returns { verified: true, flip: true } when a statement
   reconciles ONLY if every amount is negated. On a single signed Amount column
   the importer acts on that and corrects the file. On a Debit/Credit PAIR it
   deliberately does not - the sign came from a column NAME, so a disagreement
   means the mapping is wrong rather than the arithmetic - and the verdict used
   to be dropped on the floor: the review fell through to "Amounts check out
   against this statement's own balance column", the reassuring message, on the
   one file that had just failed. views/import.js now keys an `inverted` warning
   off exactly this pair of flags, so they are pinned here. */
{
  // True movements -150 -200 +300 -100 -50 from an opening 1000; the amounts
  // below carry the OPPOSITE sign, as a swapped Money-In/Money-Out pair would.
  const inverted = reconcileAmounts([
    { amount:  150, balance: 850 },
    { amount:  200, balance: 650 },
    { amount: -300, balance: 950 },
    { amount:  100, balance: 850 },
    { amount:   50, balance: 800 },
  ]);
  ok(inverted.verified, 'a consistently inverted file still RECONCILES');
  ok(inverted.flip, 'and says so - it only balances with every sign negated');
  eq(inverted.agreement, 4, 'on every pair, not merely most of them');

  // The same movements with the signs the app expects must verify WITHOUT a flip,
  // or the new warning would fire on correctly-read files.
  const straight = reconcileAmounts([
    { amount: -150, balance: 850 },
    { amount: -200, balance: 650 },
    { amount:  300, balance: 950 },
    { amount: -100, balance: 850 },
    { amount:  -50, balance: 800 },
  ]);
  ok(straight.verified && !straight.flip,
    'so a correctly-signed file is never mistaken for an inverted one');
}
console.log(`statement-decoding.test.cjs — ${checks} checks passed`);
