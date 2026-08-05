'use strict';
/* DOM + parsing helpers. Browser/Obsidian APIs only — must stay mobile-safe
   (no Node imports in this file or anywhere under src/). */

const { setIcon } = require('obsidian');

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) n.append(kid?.nodeType ? kid : document.createTextNode(kid ?? ''));
  return n;
};

/* A date field, built to behave on a phone: a native <input type="date"> gives
   the picker and no soft keyboard, so iOS autocorrect/autofill never gets a
   chance to interfere with a YYYY-MM-DD value. Only used when the stored value
   is empty or already a real ISO date though — these files are hand-editable,
   and a date input renders free text ("end of October") as blank and would
   silently discard it on the first edit. Those fall back to a text field with
   the correction features switched off. `commit` receives (value, event). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function dateInput(value, attrs, commit) {
  const v = (value ?? '').toString().trim();
  const picker = v === '' || ISO_DATE.test(v);
  return el('input', {
    type: picker ? 'date' : 'text',
    value: v,
    ...(picker ? {} : {
      placeholder: 'YYYY-MM-DD', inputmode: 'numeric',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    }),
    ...attrs,
    onchange: e => commit(e.target.value.trim(), e),
  });
}

/* Rebuilding a table's innerHTML resets its scroll container to the left edge.
   On a phone every table here is wider than the screen, so that yanks the
   columns out from under the reader. Call around a rebuild to hold position. */
function keepScroll(elm, rebuild) {
  const box = elm.parentElement;
  const left = box ? box.scrollLeft : 0;
  rebuild();
  if (box) box.scrollLeft = left;
}

/* Lucide icons: try each name until one renders (icon names occasionally get
   renamed between the lucide versions Obsidian ships). */
function setIco(elm, names) {
  for (const n of Array.isArray(names) ? names : [names]) {
    try { setIcon(elm, n); } catch (e) { /* unknown icon name */ }
    if (elm.firstElementChild) return;
  }
}
function icoEl(names, cls) {
  const s = document.createElement('span');
  s.className = 'ico' + (cls ? ' ' + cls : '');
  // Decorative: every icon here sits next to its own text label, and a future
  // lucide version adding default <title>s would otherwise double-announce it.
  s.setAttribute('aria-hidden', 'true');
  setIco(s, names);
  return s;
}

const escMd = s => (s ?? '').toString().replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
const unescMd = s => (s ?? '').replace(/<br>/g, '\n').replace(/\\\|/g, '|').trim();

/* ---------------- markdown frontmatter + table parsing ------------------ */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) {
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      if (/^".*"$/.test(val)) val = val.slice(1, -1);
      fm[key] = val;
    }
  }
  // `raw` is the verbatim frontmatter block (between the --- fences) so a
  // serializer can write back keys it doesn't model (tags, aliases, …).
  return { fm, raw: m ? m[1] : '', body: m ? text.slice(m[0].length) : text };
}
/* "Is the last character an unescaped pipe?" and "split on unescaped pipes".
   Hand-rolled rather than /(?<!\\)\|/ on purpose: a lookbehind *literal* is a
   parse-time SyntaxError on WebKit before iOS 16.4, which would take down the
   whole bundle — not just this function — on a device Obsidian itself still
   supports (iOS 14.5+). Same char-by-char shape as parseCsv below. */
const endsWithBarePipe = s => s.endsWith('|') && s[s.length - 2] !== '\\';
function splitBarePipes(s) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '|' && s[i - 1] !== '\\') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}
function parseMdTable(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    /* Stop at the end of the FIRST table. This used to collect every `|` line
       in the file, which merged a second table into the first — and because
       every caller does `.slice(1)` to drop the one header row, the second
       table's HEADER survived as data: a budget category literally named
       "Category" with type "Type" and amount 0, counted in the totals. It then
       became permanent, because saveBudget rebuilds the file from parsed state.
       A blank line ends a table in markdown and Obsidian renders it that way,
       so stopping here is what makes the parser agree with what the user sees.
       Anything before the table (frontmatter, a heading, prose) is still
       skipped — the run only closes once rows have actually started. */
    if (!t.startsWith('|')) { if (rows.length) break; continue; }
    if (/^\|[\s:|-]+\|$/.test(t)) continue;
    // Drop the leading pipe; drop the trailing pipe only when it's actually
    // there and unescaped — a hand-edited row with no trailing pipe must not
    // lose its final cell's last character.
    let inner = t.slice(1);
    if (endsWithBarePipe(inner)) inner = inner.slice(0, -1);
    const cells = splitBarePipes(inner).map(c => c.trim());
    rows.push(cells);
  }
  return rows;
}

/* Strict numeric-cell parse. Returns { ok, value, raw }. `ok` is true only for
   a plain decimal (the app's on-disk format); anything else (e.g. "1 234,56",
   "R100") is preserved verbatim in `raw` so a serializer can write it back
   unchanged instead of silently coercing it to a wrong number.

   The fallback `value` still has to be the reader's best guess, because it
   feeds every total and KPI — but it must not be a *plausible wrong number*.
   Bare parseFloat reads "1,234.56" as 1 and "R150.00" as 0, which shows up as
   a quietly wrong balance rather than an obvious error. normalizeAmount knows
   both separator conventions and every statement flavour, so use it. */
function parseNum(s) {
  const t = (s ?? '').toString().trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return { ok: true, value: parseFloat(t) };
  return { ok: false, value: normalizeAmount(t) ?? 0, raw: t };
}

/* Patch specific keys inside a YAML frontmatter block while preserving key
   order, unmodeled keys, and multi-line (block) values verbatim. `updates` maps
   key -> preformatted RHS string (null removes the key; absent keys are left
   untouched; new keys are appended). This is what lets Accounts/Budgets/Tx
   serializers keep tags, aliases, cssclasses and any hand-added frontmatter
   that the in-memory model doesn't carry. */
function patchFrontmatter(raw, updates) {
  const has = k => Object.prototype.hasOwnProperty.call(updates, k);
  if (!raw || !raw.trim()) {
    return Object.keys(updates).filter(k => updates[k] != null).map(k => `${k}: ${updates[k]}`).join('\n');
  }
  const isTopKey = l => /^[^\s#][^:]*:(\s.*)?$/.test(l);
  const entries = [];
  let cur = null;
  for (const line of raw.split(/\r?\n/)) {
    if (isTopKey(line)) { cur = { key: line.slice(0, line.indexOf(':')).trim(), lines: [line] }; entries.push(cur); }
    else if (cur) cur.lines.push(line);
    else entries.push({ key: null, lines: [line] });
  }
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (e.key != null && has(e.key)) {
      seen.add(e.key);
      if (updates[e.key] != null) out.push(`${e.key}: ${updates[e.key]}`);  // replace (collapses block→scalar)
      // else: remove entry entirely
    } else {
      out.push(...e.lines);  // preserve verbatim
    }
  }
  for (const k of Object.keys(updates)) {
    if (!seen.has(k) && updates[k] != null) out.push(`${k}: ${updates[k]}`);
  }
  return out.join('\n');
}
function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
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

/* Parse a bank-statement date cell to a canonical 'YYYY-MM-DD' string, or null
   if unparseable. Explicit and engine-independent — never the Date constructor,
   whose non-ISO parsing differs between V8 (desktop) and JavaScriptCore (iOS)
   and silently mis-files DD/MM vs MM/DD dates. SA bank exports are DD/MM/YYYY;
   an unambiguous MM/DD (day field > 12) is tolerated by swapping. */
function isoParts(y, mo, d) {
  if (!y || y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
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
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return isoParts(+m[3], mo, +m[1]);
  }
  const dt = new Date(s);                                        // last-resort fallback
  if (!isNaN(dt.getTime())) return isoParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  return null;
}

/* Parse a statement amount cell to a Number, or null if empty/unparseable.
   Tolerates the spread of bank export styles: "R 1 234.56", "$1,234.56",
   decimal-comma "1 234,56" / "1.234,56", parenthesised negatives "(123.45)",
   trailing minus "123.45-", and Cr/Dr markers (Cr → credit/positive,
   Dr → debit/negative). Zero is a valid return — callers decide to skip it. */
function normalizeAmount(raw) {
  let s = (raw ?? '').toString().trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  const marker = s.match(/(cr|dr)\.?\s*$/i);
  if (marker) { if (marker[1].toLowerCase() === 'dr') neg = true; s = s.slice(0, marker.index).trim(); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1).trim(); }
  if (s.startsWith('-')) { neg = true; s = s.slice(1).trim(); }
  if (s.startsWith('+')) s = s.slice(1).trim();
  s = s.replace(/^(zar|usd|gbp|eur|aud|cad|us\$|a\$|c\$|nz\$|r|[$\u00A3\u20AC])\s*/i, '').replace(/[\s\u00A0\u202F']/g, '');
  if (/^\d+(\.\d{3})*,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');  // decimal comma
  else s = s.replace(/,/g, '');                                                       // thousands comma
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
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

/* Trim trailing reference noise (masked card numbers, statement refs, phone /
   meter numbers, caps+digit ref codes) from a transaction description so a
   learned categorisation rule generalises to next month's version of the same
   merchant. Internal whitespace is preserved byte-for-byte — rule matching is
   exact/substring against the raw description, so collapsing spaces would
   break it. Falls back to the untrimmed description if trimming would leave
   fewer than 4 characters. */
function learnPattern(desc) {
  let s = (desc ?? '').toString().trim();
  for (;;) {
    const m = s.match(/^(.*\S)[ \t]+(\S+)$/);
    if (!m) break;
    const w = m[2];
    const digits = (w.match(/\d/g) || []).length;
    const noise = /\*{2,}/.test(w) ||                          // masked card: 000000******0000
      /\d{4,}/.test(w) ||                                      // long digit run: refs, phone, meter numbers
      (digits > 0 && digits / w.length >= 0.4) ||              // digit-heavy token: X0000000
      (digits > 0 && w.length >= 8 && /^[A-Z0-9]+$/.test(w));  // long caps+digit ref: VODREF0000000
    if (!noise) break;
    s = m[1];
  }
  return s.length >= 4 ? s : (desc ?? '').toString().trim();
}

/* Sanitise a string for safe use as a single path segment (folder/file name):
   strip path separators and filesystem-illegal characters, and neutralise
   "../" traversal attempts (dot runs, leading dots).

   This is also the ONE canonicaliser for path segments, and that matters more
   than the sanitising. A transactions file is looked up in memory by a key and
   written to a path; if the two are derived by different functions the lookup
   can miss while the write still lands on the existing file — which rebuilds
   that month from scratch, holding only the new rows. So:
     - NFC, because Obsidian's normalizePath folds to NFC on the way to disk. A
       decomposed "ë" (what macOS/iCloud hands you) would otherwise key one way
       and write another.
     - NBSP variants folded to a plain space, for the same reason.
     - Control chars and bidi overrides removed: invisible in a filename, and
       the bidi ones let "IT3b<RLO>fdp.exe" render as "IT3bexe.pdf".
     - Trailing dots/spaces stripped and Windows device names suffixed, because
       the OS silently rewrites both and every later lookup then misses. */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function safeSeg(s) {
  const out = (s ?? '').toString()
    .normalize('NFC')
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^\.+/, '')
    .trim()
    .replace(/[. ]+$/, '');
  return WIN_RESERVED.test(out) ? `${out}-` : out;
}

/* Quote a value for use as a YAML frontmatter scalar. Everything written into
   frontmatter goes through here: an unescaped quote, backslash or a bare
   "Ref: ABC-1" makes the whole block unparseable to Obsidian, which drops the
   note's properties from the metadata cache — while this plugin's own
   first-colon parser reads it back happily, so the breakage is invisible from
   inside the app. */
const yamlStr = v => `"${String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/* Quote a value for a CSV cell. Beyond the usual quote/comma/newline rules,
   a leading =, +, -, @, tab or CR makes the cell a live formula in Excel and
   LibreOffice. The categorisation rules file is written from bank statement
   descriptions — which anyone who can send the user a payment reference gets
   to influence — and it is explicitly a file the user opens in a spreadsheet.
   Prefix those with an apostrophe so they stay inert. */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["',\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ---- inert, with a floor-safe fallback --------------------------------
   `inert` is the whole mechanism behind two features: the closed drawer
   leaving the tab order, and the privacy gate making the covered app
   unreachable. It is Safari 15.5+, and this plugin's floor is iOS 15.0 — on
   15.0-15.4 the attribute parses and does NOTHING, so Tab walks straight
   into the balances behind a gate whose entire purpose is that it can't.

   Same discipline as the @supports fallbacks in styles.css: feature-detect,
   and on the old engines reproduce the behaviour by hand — tabindex="-1" on
   every focusable descendant (remembering what was there so it can be put
   back) plus aria-hidden for the screen-reader half. */
const INERT_SUPPORTED = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;
const FOCUSABLE_SEL = 'a[href],button,input,select,textarea,summary,[tabindex]';
function setInert(elm, on) {
  if (!elm) return;
  if (on) elm.setAttribute('inert', ''); else elm.removeAttribute('inert');
  if (INERT_SUPPORTED) return;
  if (on) {
    elm.setAttribute('aria-hidden', 'true');
    for (const f of elm.querySelectorAll(FOCUSABLE_SEL)) {
      // Store the previous tabindex ('' meaning "had none") so a nested call
      // or a re-lock can't overwrite the original with the -1 it just set.
      if (!f.hasAttribute('data-bud-ti')) f.setAttribute('data-bud-ti', f.getAttribute('tabindex') ?? '');
      f.setAttribute('tabindex', '-1');
    }
    // Real `inert` blurs whatever it swallows; tabindex="-1" does not, so an
    // already-focused field would stay focused (and typable) behind the gate.
    if (elm.contains(document.activeElement) && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  } else {
    elm.removeAttribute('aria-hidden');
    for (const f of elm.querySelectorAll('[data-bud-ti]')) {
      const prev = f.getAttribute('data-bud-ti');
      if (prev === '') f.removeAttribute('tabindex'); else f.setAttribute('tabindex', prev);
      f.removeAttribute('data-bud-ti');
    }
  }
}

/* Collapse '.' and '..' segments in a '/'-path; returns null if it escapes the
   root (more '..' than depth). Used to verify a write stays inside the folder. */
function collapsePath(p) {
  const out = [];
  for (const seg of (p || '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); }
    else out.push(seg);
  }
  return out.join('/');
}

/* A period length in days, or 0 for the payday month. Lives here rather than in
   period.js because the LOADER has to agree with it: if the loader stored what
   the file said and period.js decided separately what was usable, a settings
   control reading the raw value would report a cycle the app isn't running.
   Out-of-band values become 0, never the nearest legal number — falling back to
   the payday month the user already had is honest, whereas coercing 400 to 31
   would silently invent a cycle nobody chose. The band is wide enough for every
   real payroll rhythm and narrow enough to exclude a one-day period. */
const MIN_PERIOD_DAYS = 7, MAX_PERIOD_DAYS = 31;
function periodDaysOrZero(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < MIN_PERIOD_DAYS || n > MAX_PERIOD_DAYS) return 0;
  return n;
}

/* Whole days since the epoch, in UTC. Local-time date maths drifts by a day
   across a DST boundary, which would silently lengthen or shorten a period
   twice a year. Shared so the settings tab measures an anchor shift with the
   same arithmetic period.js derives the periods themselves with — if the two
   ever disagreed, the tab would warn about a move that changed nothing, or
   stay silent through one that moved every boundary. */
function isoDayNumber(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/* A real calendar date in YYYY-MM-DD, not merely something date-SHAPED. The
   shape regex admits 2026-13-45 and 2026-02-30, which Date.UTC rolls forward
   without complaint — so a pay cycle anchored on one ran from a day its own
   Settings.md never named. Shared because the loader, the period maths and
   both settings tabs must agree on which anchors are usable: if the loader
   accepted one that period.js then refused, the tab would sit there offering a
   cycle the app is not running. */
const ISO_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
function isRealIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE_SHAPE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(t)) return false;
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() + 1 === m && back.getUTCDate() === d;
}

module.exports = { el, dateInput, keepScroll, setIco, icoEl, escMd, unescMd, parseFrontmatter, parseMdTable, parseCsv, parseStatementDate, normalizeAmount, detectHeaderlessColumns, detectStatementColumns, reconcileAmounts, parseNum, patchFrontmatter, learnPattern, safeSeg, collapsePath, yamlStr, csvCell, setInert, periodDaysOrZero, isoDayNumber, isRealIsoDate };
