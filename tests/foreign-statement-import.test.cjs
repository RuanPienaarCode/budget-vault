'use strict';
/* Reading a statement that is not in rand.

   Issue #28 was reported by an Indonesian household. While fixing the totals
   it turned out they could not have imported a statement in the first place:
   normalizeAmount("Rp 1.500.000") returned null, views/import.js counted the
   row into `skipped`, and a whole statement imported ZERO rows while
   reporting them as skipped. Not an error — a plausible silent nothing, which
   is precisely the failure src/amount.js's own header says it exists to
   refuse.

   Two gaps, pinned here together because they are the same gap seen from two
   ends: the amount cell, and the column heading above it.

     node tests/foreign-statement-import.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { normalizeAmount } = require('../src/amount');
const { detectStatementColumns } = require('../src/statement');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- 1. ANY currency, not a list of remembered ones ----

   The first fix for this was an allowlist of about twenty symbols and codes.
   An allowlist's failure mode is the same silent nothing for the twenty-first
   currency, so the rule is structural now: a money cell is a number with an
   optional unit attached, and the unit is a Unicode currency symbol or a
   short alphabetic code, at either end. These cases are a sample of that
   rule, not its definition — the point is that nothing here was enumerated in
   src/amount.js. ---- */
{
  const cases = [
    // The reporter's own statement (issue #28).
    ['Rp 1.500.000', 1500000, 'Indonesian rupiah, dot-grouped'],
    ['Rp1500000', 1500000, 'and with no space after the symbol'],
    // Symbols.
    ['¥1,200', 1200, 'yen/yuan'],
    ['₹500', 500, 'rupee'],
    ['₩50000', 50000, 'won'],
    ['₪1,234.56', 1234.56, 'shekel'],
    ['₺1.234,56', 1234.56, 'lira, dot-grouped'],
    ['฿1,200', 1200, 'baht'],
    ['₫1.500.000', 1500000, 'dong'],
    ['₦5,000', 5000, 'naira'],
    ['₱1,234.56', 1234.56, 'peso'],
    ['₴ 1 234,56', 1234.56, 'hryvnia'],
    ['₨ 500', 500, 'the other rupee sign'],
    ['£99.99', 99.99, 'pound'],
    ['€900.00', 900, 'euro'],
    // Non-ASCII LETTERS — an [A-Za-z] class read all of these as junk.
    ['zł 99,00', 99, 'Polish złoty'],
    ['Kč 1 234,56', 1234.56, 'Czech koruna'],
    ['лв 99,00', 99, 'Bulgarian lev, Cyrillic'],
    // Alphabetic codes and multi-character symbols.
    ['R$ 250,00', 250, 'Brazilian real — consumed WHOLE, not an R leaving a stray $'],
    ['US$1,200.00', 1200, 'and the same for US$'],
    ['RMB 100', 100, 'the code some Chinese exports use'],
    ['CNY 100', 100, 'as well as the ISO one'],
    ['CHF 50', 50, 'Swiss franc'],
    ['kr 100,50', 100.5, 'Nordic krona with a decimal comma'],
    ['RM 1,234.56', 1234.56, 'ringgit'],
    ['Rs 1,234.56', 1234.56, 'rupees written as a code'],
    // TRAILING markers — banks write it both ways round.
    ['1234.56 ZAR', 1234.56, 'a trailing ISO code'],
    ['100 EUR', 100, 'with a space'],
    ['50CHF', 50, 'and without one'],
    ['1 234,56 €', 1234.56, 'a trailing symbol'],
    ['1,200円', 1200, 'a single trailing CJK character — no shorthand competes for that position'],
    ['1,200元', 1200, ''],
  ];
  for (const [cell, want, why] of cases) {
    eq(normalizeAmount(cell), want, `${JSON.stringify(cell)}${why ? ' — ' + why : ''}`);
  }
}

/* ---- 1b. and it still refuses everything that is not a number ----

   This is the half that makes the generosity above safe, and it caught a real
   regression while it was being written: a greedy letter-run turned
   "about 15 000" into 15000 — prose read as a confident figure, which is the
   exact failure src/amount.js's own header says it exists to refuse. The
   marker is only stripped when a number actually follows it. ---- */
{
  for (const cell of ['about 15 000', 'roughly 200', 'TBC', 'N/A', 'three thousand',
    'abc', '-', '--100', '100m', '1e5', 'R', '$', 'ZAR']) {
    eq(normalizeAmount(cell), null,
      `${JSON.stringify(cell)} is null — a plausible wrong number is worse than no number`);
  }
}

/* ---- 2. what must NOT change: everything that already worked ---- */
{
  const cases = [
    ['R 1 234,56', 1234.56], ['$1,200.00', 1200], ['€900.00', 900],
    ['1.234,56', 1234.56], ['(123.45)', -123.45], ['100.00 Dr', -100],
    ['123.45-', -123.45], ['.50', 0.5], ['18.5%', 18.5],
  ];
  for (const [cell, want] of cases) {
    eq(normalizeAmount(cell), want, `${JSON.stringify(cell)} still reads as it always did`);
  }
}

/* ---- 3. the AMBIGUOUS case is left alone, on purpose ----

   "1.500" is genuinely one and a half OR one thousand five hundred, and this
   vault does not know which. It parses exactly as it always has. Widening the
   dot-grouped rule to cover it would be guessing at money, which is the one
   thing src/amount.js refuses to do — "1.500.000" is safe only because no
   money has two decimal points. */
{
  eq(normalizeAmount('1.500'), 1.5,
    'a SINGLE dot group is ambiguous and is not reinterpreted — guessing here would print a confident wrong number');
  eq(normalizeAmount('0.500'), 0.5, 'and a three-decimal cell is still three decimals');
  eq(normalizeAmount('1.500.000'), 1500000,
    'two or more groups cannot be a decimal, so THAT one is safe to read');
  eq(normalizeAmount('12.345.678'), 12345678, 'however many groups there are');
}

/* ---- 4. junk is still refused ---- */
{
  for (const cell of ['', '   ', 'N/A', 'three thousand', '--100', 'R', '$']) {
    eq(normalizeAmount(cell), null, `${JSON.stringify(cell)} is null — a wrong number is worse than no number`);
  }
}

/* ---- 5. the column heading above the cell ---- */
{
  const rows = h => [h, ['2026-01-01', 'Warung', '1.500.000', '2.000.000']];
  for (const cur of ['ZAR', 'EUR', 'IDR', 'CNY', 'USD']) {
    const got = detectStatementColumns(rows(['Date', 'Description', `Amount (${cur})`, `Balance (${cur})`]));
    ok(got, `a statement headed "Amount (${cur})" is auto-detected`);
    eq(got.iAmount, 2, `and its amount column is found — the currency in a heading is a label, not a different column`);
  }
  const plain = detectStatementColumns(rows(['Date', 'Description', 'Amount', 'Balance']));
  eq(plain.iAmount, 2, 'the unadorned heading is unaffected');

  // NEGATIVE CONTROL: a file with a date and no amount-ish column at all is
  // still not a statement, and must not start passing detection.
  eq(detectStatementColumns([['Date', 'Description', 'Notes'], ['2026-01-01', 'x', 'y']]), null,
    'a file with no amount column is still refused — the fallback widened the match, it did not remove it');
}

/* ---- 6. the HEADINGS are in the bank's language, not the app's ----

   A statement's column names come from the bank. While the interface was
   English-only that assumption went unexamined; the app now ships nine
   languages plus Português, हिन्दी and Bahasa Indonesia, and the household
   that reported issue #28 downloads a file headed "Tanggal, Keterangan,
   Jumlah". Every heading missed, detection returns null, and a file the app
   could have read goes to the manual column mapper instead.

   The mapper is a real fallback, so this is a papercut rather than data loss
   — but it is a papercut on the first thing a new reader does. ---- */
{
  const detect = csv => detectStatementColumns(csv.trim().split('\n').map(l => l.split(',')), true);
  const cases = [
    ['Indonesian', 'Tanggal,Keterangan,Jumlah,Saldo\n01/08/2026,WARUNG,1.500.000,8.500.000'],
    ['Chinese', '日期,摘要,金额,余额\n2026-08-01,午餐,1200,8000'],
    ['Japanese', '日付,内容,金額,残高\n2026-08-01,昼食,1200,8000'],
    ['German', 'Buchungstag,Verwendungszweck,Betrag,Kontostand\n01.08.2026,Miete,-900,1200'],
    ['Spanish', 'Fecha,Concepto,Importe,Saldo\n01/08/2026,Alquiler,-900,1200'],
    ['French', 'Date de valeur,Libellé,Montant,Solde\n01/08/2026,Loyer,-900,1200'],
    ['Portuguese', 'Data,Histórico,Valor,Saldo\n01/08/2026,Aluguel,-900,1200'],
    ['Afrikaans', 'Datum,Beskrywing,Bedrag,Saldo\n01/08/2026,Huur,-900,1200'],
    ['Hindi', 'दिनांक,विवरण,राशि,शेष\n01/08/2026,किराया,-900,1200'],
  ];
  for (const [lang, csv] of cases) {
    const got = detect(csv);
    ok(got, `a ${lang} statement is auto-detected rather than sent to the manual mapper`);
    eq([got.iDate, got.iDesc, got.iAmount, got.iBalance], [0, 1, 2, 3],
      `and every ${lang} column lands where it should`);
  }

  /* The debit/credit PAIR had the identical currency-in-the-heading gap the
     Amount column had — "Debit (IDR)" matched nothing at all. */
  const pair = detect('Date,Description,Debit (IDR),Credit (IDR),Balance\n01/08/2026,X,1.500.000,,8.500.000');
  ok(pair, 'a debit/credit statement with the currency in its headings is detected');
  eq([pair.iDebit, pair.iCredit], [2, 3], 'and both columns are found');

  // NEGATIVE CONTROL: widening the match must not make everything a statement.
  eq(detect('Date,Description,Notes\n2026-01-01,x,y'), null,
    'a file with no amount-ish column is still refused');
  eq(detect('Name,Type,Colour\na,b,c'), null, 'and so is one with no date');
}

console.log(`PASS — a statement in any currency, and headed in any language this app speaks (${checks} checks).`);
