'use strict';
/* Reading a bank statement nobody here has ever seen.

   The bank-specific layer on top of src/csv.js and src/amount.js: which column
   is the date, which the description, which the amount — and, critically, which
   SIGN CONVENTION the file uses. The governing rule throughout is that a column
   NAME may be guessed (guess wrong and the file is rejected, loudly) but the
   sign convention may not, because getting it wrong imports every expense as
   income with totals that look entirely plausible. So the file is made to prove
   itself against its own running balance, and where it cannot, these functions
   return null — which the import view answers with the manual column mapper.
   null here always means "ask the user", never "give up and guess".

   Pure — no DOM, no obsidian import — so every bank format this app claims to
   read is testable without one. */

const { normalizeAmount } = require('./amount');
const { parseDelimited, sniffDelimiter } = require('./csv');

/* Parse a foreign statement: sniff the delimiter, then read it. */
const parseStatement = text => parseDelimited(text, sniffDelimiter(text));

/* Decode a dropped statement's bytes to text.

   `file.text()` decodes as UTF-8 unconditionally. A statement exported from a
   Windows banking portal is often windows-1252 (or UTF-16 with a BOM), and
   decoding those as UTF-8 doesn't throw — it yields replacement characters
   inside merchant names, which then flow into the dedup key and into learned
   categorisation rules. That is a silent wrong answer, so the encoding is
   established from the bytes here rather than assumed.

   Pure and byte-in/string-out so it can be tested without a File. */
function decodeStatement(bytes) {
  const b = bytes;
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
  /* BOM-less UTF-16. Worth detecting explicitly because it is the one case the
     fatal-UTF-8 probe below CANNOT catch: NUL is valid UTF-8, so ASCII text in
     UTF-16 decodes "successfully" into a string with a NUL between every
     letter — which parses, imports, and looks like a merchant name with gaps.
     ASCII in UTF-16LE puts its NUL in the odd byte, UTF-16BE in the even one. */
  const head = b.subarray(0, 256);
  let evenNul = 0, oddNul = 0;
  for (let i = 0; i < head.length; i++) if (head[i] === 0) { if (i % 2) oddNul++; else evenNul++; }
  if (head.length >= 8) {
    if (oddNul > head.length / 4 && evenNul === 0) return new TextDecoder('utf-16le').decode(b);
    if (evenNul > head.length / 4 && oddNul === 0) return new TextDecoder('utf-16be').decode(b);
  }
  // Well-formed UTF-8 wins; anything that isn't is read as windows-1252, which
  // maps every byte to something and so can never itself fail.
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch (e) { return new TextDecoder('windows-1252').decode(b); }
}

/* Parse a bank-statement date cell to a canonical 'YYYY-MM-DD' string, or null
   if unparseable. Explicit and engine-independent — never the Date constructor,
   whose non-ISO parsing differs between V8 (desktop) and JavaScriptCore (iOS)
   and silently mis-files DD/MM vs MM/DD dates. SA bank exports are DD/MM/YYYY;
   an unambiguous MM/DD (day field > 12) is tolerated by swapping. */
function isoParts(y, mo, d) {
  if (!y || y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/* Month ABBREVIATION → number, for reading a statement's "12 Mar 2026". Named
   apart from constants.js's MONTHS, which is the reverse — an array of short
   names for DISPLAY. Two things called MONTHS with opposite directions is a
   trap for whoever next reaches for one from the wrong import. */
const MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/* dayFirst picks the reading of ambiguous XX/YY/YYYY dates: true → DD/MM
   (SA, UK, AU, EU), false → MM/DD (US, CA). Unambiguous values (13+ in the
   month slot) are corrected either way. */
function parseStatementDate(raw, dayFirst = true) {
  let s = (raw ?? '').toString().trim();
  if (!s) return null;
  /* Drop a trailing clock time ("2026-03-01 00:20", "2026-01-12T09:15:00Z").
     Capitec stamps its Transaction Date column with one; without this the whole
     cell fell through to the Date constructor below, which is exactly the
     engine-dependent path this function exists to avoid. */
  s = s.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm|z|[+-]\d{2}:?\d{2})?$/i, '').trim();
  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);      // ISO: YYYY-MM-DD
  if (m) return isoParts(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);          // DD/MM/YYYY or MM/DD/YYYY
  if (m) {
    let d = dayFirst ? +m[1] : +m[2], mo = dayFirst ? +m[2] : +m[1];
    if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }     // tolerate the other order
    return isoParts(+m[3], mo, d);
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);                        // YYYYMMDD (Absa/SB)
  if (m) return isoParts(+m[1], +m[2], +m[3]);
  // DD Mon YYYY, separated ("24 Jul 2021") or run together ("24Jul2021" — how
  // Nedbank's cheque-account export writes every date).
  m = s.match(/^(\d{1,2})[ -]?([A-Za-z]{3,})[ -]?(\d{4})$/);
  if (m) {
    const mo = MONTH_NUM[m[2].slice(0, 3).toLowerCase()];
    if (mo) return isoParts(+m[3], mo, +m[1]);
  }
  const dt = new Date(s);                                        // last-resort fallback
  if (!isNaN(dt.getTime())) return isoParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  return null;
}

/* Does this description name one of the reader's OWN other accounts?

   Every non-interest line on a linked savings statement is a transfer to or
   from the cheque account next door. Imported without recognition, moving your
   own money between your own accounts registers as income — and then the
   Dashboard reports a month where the household earned its own savings.

   Matching is exact on a run of digits, never fuzzy. A bank reference is full
   of numbers that are not account numbers, and the cost of a wrong match here
   is a real income figure quietly deleted, so the rule is deliberately strict:

     - only digit runs of 4+ are considered, so a card's " 1234" cent amount or
       a date fragment cannot collide with a short account number
     - the digits must EQUAL a known account_number, not merely contain it —
       "10410051720" is not account "1041005172", it is a different account
     - the account being imported INTO is skipped. A statement routinely quotes
       its own number in its rows, and tagging those as transfers would exclude
       an entire import.

   Returns the matching account, or null. Deciding what to do about it is the
   caller's — this function never mutates a row. */
function counterpartyAccount(desc, accounts, selfLabel) {
  const runs = String(desc || '').match(/\d{4,}/g);
  if (!runs) return null;
  for (const n of runs) {
    for (const a of accounts || []) {
      const num = String(a.account_number || '').trim();
      if (!num || num !== n) continue;
      const label = a.tx_label || a.name;
      if (selfLabel && label === selfLabel) continue;   // the statement's own account
      return a;
    }
  }
  return null;
}

/* Check a statement's amounts against its own running-balance column, and say
   whether the amounts carry the sign this app expects (negative = money out).

   This is the only way to support a bank whose export nobody here has ever
   seen. Column NAMES can be guessed safely — guess wrong and the file is
   rejected, loudly. The SIGN CONVENTION cannot: a bank that lists debits as
   positive in a single Amount column would import every expense as income, the
   totals would look plausible, and nothing would announce the error. So rather
   than assume, ask the file: on a statement that carries a balance, successive
   balances must differ by exactly the amount between them, and only one sign
   convention can satisfy that.

   `rows` is [{ amount, balance }] in FILE order. Both reading directions are
   tested because statements come both ways (oldest-first and newest-first), and
   both signs, so the file proves which of the four it is rather than the
   importer betting on one.

   Comparison is in whole cents — the values came from a printed statement, so
   exact equality is the right test and float slop is not a real tolerance.

   Returns { verified, flip, order, pairs, agreement }. `verified: false` means
   "this file did not prove itself" — never "the amounts are wrong". Callers
   must degrade to showing the user rather than to guessing. */
function reconcileAmounts(rows) {
  const c = v => Math.round(v * 100);
  const pts = (rows || []).filter(r => r && r.amount != null && r.balance != null);
  // Under three pairs, agreement is as likely to be coincidence as proof.
  if (pts.length < 4) return { verified: false, flip: false, order: null, pairs: Math.max(0, pts.length - 1), agreement: 0 };

  let best = { verified: false, flip: false, order: null, pairs: pts.length - 1, agreement: 0 };
  for (const order of ['fwd', 'rev']) {
    for (const sign of [1, -1]) {
      let agree = 0;
      for (let i = 1; i < pts.length; i++) {
        const prev = c(pts[i - 1].balance), bal = c(pts[i].balance);
        // Oldest-first: this row's amount moved the balance to here.
        // Newest-first: the PREVIOUS row's amount moved the balance away from here.
        const step = order === 'fwd' ? sign * c(pts[i].amount) : -sign * c(pts[i - 1].amount);
        if (bal - prev === step) agree++;
      }
      if (agree > best.agreement) best = { verified: false, flip: sign === -1, order, pairs: pts.length - 1, agreement: agree };
    }
  }
  // A real statement reconciles almost everywhere; the slack is for the odd
  // reversal or out-of-order row, not for a half-right guess.
  best.verified = best.agreement >= Math.ceil(best.pairs * 0.8);
  return best;
}

/* Infer the column layout of a statement CSV that has NO header row — Nedbank
   exports both its cheque and credit-card statements this way, as a short
   "Statement Enquiry / Account Number / Account Description" preamble followed
   by bare data rows. The two differ in shape, which is exactly why nothing here
   may be hardcoded:

     23Jul2026,SOME PAYMENT - 1000000000,5500.00,2917.04   (date, desc, amount, balance)
     24-01-2026, 24-01-2026,VAT ON FEE,-3.00               (posted, transacted, desc, amount)

   Nothing is matched by name — the layout is read off the SHAPE of the rows:
   the first column parses as a date, a run of numeric columns sits at the far
   right, and the description is the rightmost text column before them. Where
   two numeric columns trail, the last is only treated as a running balance when
   it actually behaves like one (balance − previous balance ≈ amount) — a
   Debit/Credit pair would not, and falls through to reading the last column as
   the amount rather than being silently mis-read as a balance.

   Returns { dataStart, iDate, iDesc, iAmount, iBalance } (iBalance -1 when the
   file carries none) or null when the shape doesn't resolve — callers must
   treat null as "not a statement I can read", never as a reason to guess. */
function detectHeaderlessColumns(rows, dayFirst = true) {
  const isDate = v => !!parseStatementDate(v, dayFirst);
  const num = v => normalizeAmount(v);
  // Preamble rows are short and untyped; the first row that leads with a date
  // AND carries a number is the first real transaction.
  const dataStart = (rows || []).findIndex(r =>
    r.length >= 3 && isDate(r[0]) && r.slice(1).some(c => num(c) != null));
  if (dataStart === -1) return null;
  const width = rows[dataStart].length;
  // Ragged trailing rows (totals, disclaimers) are ignored rather than allowed
  // to widen or narrow the inferred layout.
  const data = rows.slice(dataStart).filter(r => r.length === width && isDate(r[0]));
  if (data.length < 2) return null;

  // Longest run of right-hand columns that is numeric on EVERY data row.
  let firstNum = width;
  while (firstNum > 1 && data.every(r => num(r[firstNum - 1]) != null)) firstNum--;
  if (firstNum >= width) return null;   // no numeric column at all

  let iAmount = width - 1, iBalance = -1;
  if (width - firstNum >= 2) {
    // Two trailing numbers: amount + running balance, or a Debit/Credit pair.
    // Only the first reconciles, so the file decides rather than the importer.
    const bal = reconcileAmounts(data.map(r => ({ amount: num(r[width - 2]), balance: num(r[width - 1]) })));
    if (bal.verified) { iAmount = width - 2; iBalance = width - 1; }
    // Three states, not two: reconciled (above), provably-not-a-balance (a
    // Debit/Credit pair — fall through and read the last column as the amount),
    // and NOT ENOUGH FILE TO TELL. reconcileAmounts reports the third as fewer
    // than three pairs, and it must not collapse into the second: on an
    // amount+balance export that silently imports the running balance as every
    // transaction — an expense booked as income, with plausible-looking totals
    // and nothing to announce it.
    //
    // The ambiguity is only real when BOTH columns could be the amount. A
    // penultimate column that never carries a value (the all-zero Money Out of
    // a Debit/Credit pair) is not a candidate, so the last column still wins
    // without proof. Otherwise there is nothing to choose on but a guess, and
    // null is the honest answer — the caller opens the manual column mapper.
    else if (bal.pairs < 3 && data.some(r => num(r[width - 2]) !== 0)) return null;
  }

  // Description: the rightmost column left of the amount whose values are
  // mostly free text. Scanning right-to-left is what keeps the credit-card
  // shape working — a left-to-right scan would stop on its SECOND date column
  // and import the date as every description.
  let iDesc = -1;
  for (let c = iAmount - 1; c >= 1; c--) {
    const vals = data.map(r => (r[c] ?? '').toString().trim()).filter(Boolean);
    if (!vals.length) continue;
    const text = vals.filter(v => num(v) == null && !isDate(v)).length;
    if (text > vals.length / 2) { iDesc = c; break; }
  }
  if (iDesc === -1) return null;
  return { dataStart, iDate: 0, iDesc, iAmount, iBalance };
}

/* Header-name aliases, lowercase. Exact match wins in array order; amount can
   come from a single signed column OR a debit + credit pair (Capitec "Money
   In"/"Money Out", Debit/Credit statements). */
// 'posting date' outranks 'transaction date' where a statement carries both
// (Capitec): the posting date is the one the balance column follows, and it is
// the one that keeps a month-end row in the month the statement bills it to —
// Capitec timestamps February's interest 2026-03-01 00:20.
const DATE_COLS = ['value date', 'date', 'posting date', 'post date', 'date posted', 'effective date',
  'transaction date', 'trans date', 'txn date', 'process date', 'action date'];
const DESC_COLS = ['description', 'title', 'narrative', 'narration', 'details', 'detail', 'particulars',
  'transaction description', 'statement description', 'transaction detail', 'reference', 'payee', 'memo'];
const AMOUNT_COLS = ['amount', 'transaction amount', 'amount (zar)', 'signed amount', 'value'];
const DEBIT_COLS = ['debit', 'debits', 'debit amount', 'money out', 'amount out', 'withdrawal', 'withdrawals', 'paid out'];
const CREDIT_COLS = ['credit', 'credits', 'credit amount', 'money in', 'amount in', 'deposit', 'deposits', 'paid in'];
/* Not a column the importer needs — a column it CHECKS ITSELF against. See
   reconcileAmounts: the balance is what lets a never-before-seen bank's export
   prove its own sign convention instead of the importer assuming one. */
const BALANCE_COLS = ['balance', 'running balance', 'closing balance', 'account balance', 'balance (zar)'];

/* Decide which column is which: by header name where the file has one, by the
   shape of the rows where it doesn't. Returns a column map, or null when the
   file resolves to neither — null means "ask the user", never "give up", and
   the import view answers it with the manual column mapper.

   Pure, and deliberately outside the view: this one function decides how every
   statement in the app is read, so it has to be testable on its own. */
function detectStatementColumns(rows, dayFirst = true) {
  const headerIdx = (rows || []).findIndex(r => {
    const low = r.map(c => c.trim().toLowerCase());
    const has = names => names.some(n => low.includes(n));
    return (has(DATE_COLS) || low.some(c => c.includes('date'))) &&
           (has(AMOUNT_COLS) || (has(DEBIT_COLS) && has(CREDIT_COLS)));
  });
  if (headerIdx !== -1) {
    const low = rows[headerIdx].map(c => c.trim().toLowerCase());
    const col = names => { for (const n of names) { const i = low.indexOf(n); if (i !== -1) return i; } return -1; };
    // Date and description fall back to a substring match, mirroring the loose
    // test the header row itself was detected with — otherwise a file headed
    // "Date Posted" passes detection and then fails as "missing columns".
    let iDate = col(DATE_COLS);
    if (iDate === -1) iDate = low.findIndex(c => c.includes('date'));
    let iDesc = col(DESC_COLS);
    if (iDesc === -1) iDesc = low.findIndex(c => c.includes('desc'));   // e.g. "Transaction Descr."
    let iBalance = col(BALANCE_COLS);
    if (iBalance === -1) iBalance = low.findIndex(c => c.includes('balance'));
    const iAmount = col(AMOUNT_COLS), iDebit = col(DEBIT_COLS), iCredit = col(CREDIT_COLS);
    if (iDate === -1 || iDesc === -1 || (iAmount === -1 && (iDebit === -1 || iCredit === -1))) return null;
    return { iDate, iDesc, iAmount, iDebit, iCredit, iBalance, iExtra: -1, headerIdx, dataStart: headerIdx + 1 };
  }
  const shape = detectHeaderlessColumns(rows, dayFirst);
  if (!shape) return null;
  return { ...shape, iDebit: -1, iCredit: -1, iExtra: -1, headerIdx: -1 };
}

module.exports = {
  parseStatement, decodeStatement, parseStatementDate,
  counterpartyAccount, reconcileAmounts,
  detectHeaderlessColumns, detectStatementColumns,
};
