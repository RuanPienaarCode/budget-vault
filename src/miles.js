'use strict';
/* Reading a Discovery Miles export — and putting it in rand.

   WHY IT IS NOT A BANK STATEMENT.

   The Miles export is `Value Date, Type, Description, Additional information,
   Miles`: dated rows of a rewards balance, newest first, with a SIGNED count of
   Miles (earned positive, redeemed negative) and no amount column at all. That
   does NOT make src/statement.js reject it, which is what this was first written
   believing: with no amount in the header it is not read as a header at all, and
   the headerless SHAPE detector takes over — a date in column 0, text, a column
   of numbers on the right — and answers with the Miles column as the Amount and
   "Additional information" as the description. No mapper opens. Every Mile is
   imported as one rand, which is a plausible wrong number: the 667,502 Miles
   earned on the file this was built against would arrive as R667,502 of income
   under an ordinary-looking review screen. So a Miles file is recognised by its
   header, ahead of the statement reader, on its own path, and the conversion to
   rand is a stated rule rather than a shape detector's accident.

   ONE RATE, NOT THE PRINTED RAND.

   A redemption prints its own rand value in the Type (`Prepaid Electricity -
   R150.00`), and the obvious move is to book that as the amount. It is wrong
   here, and the evidence is the file itself: across 653,906 Miles redeemed the
   printed values come to R88,009.96 — about 7.4 Miles to the rand — while the
   same Miles were EARNED at about ten to the rand. Mixed rates break linearity:
   earned at 10c and redeemed at ~13.5c, the running balance would go negative
   on a file whose Miles balance is a positive 200. With one rate for every row
   the balance is simply `total Miles x rate`, which is the only reading under
   which the account balance and the Miles balance cannot disagree.

   The printed value is not thrown away. It, the Miles count and the bank's own
   "Additional information" go into the row's Note (see milesNote), so a later
   rewards summary can set the REALISED value of a redemption against the
   assumed rate. The app argues; it does not correct — the rate is the
   household's stated claim (Settings), the note is the evidence beside it.

   ROUNDING. Rand is written to the cent and Miles are written to two places, so
   a rate that is not a multiple of a cent per hundredth of a Mile would round
   each row independently and drift. The default 0.10 cannot (every Mile count on
   the real file was whole, and 10c x a whole number is exact); any other rate is
   rounded per row, half away from zero, and the Miles count in the Note stays
   exact so nothing is lost by the rounding.

   WHAT IS NOT IMPORTED.

   Rows with 0.00 Miles (`No reward`, 346 of 4,116 on the real file) carry no
   money and would be dropped by the importer anyway; here they are counted
   apart, like an FNB waived fee, rather than reported as unreadable.

   Pure — no DOM, no obsidian import — so every shape this app claims to read is
   testable in bare node. The caller (views/import.js) owns the account, the
   dedupe index and the review screen; none of that is decided here.

   PUBLIC SURFACE

     detectMilesExport(rows, filename) -> map | null
         `rows` as parseStatement returns them. A column map in the same shape
         detectStatementColumns returns (so "Columns wrong?" can reopen the
         manual mapper on it) plus iType, iInfo, iMiles and `miles: true`.
         null means "not a Miles export — carry on with the normal detection".
     milesRows(rows, map, { rate }) -> { items, skipped, zero, tooSmall, miles }
         Importer-shaped items { date, desc, amount, cat, note, miles, ... } in
         file order. `miles` is the signed total of the items returned.
     milesToRand(miles, rate) -> number           (to the cent, sign preserved)
     milesNote({ miles, printed, info }) -> string
     parseMilesNote(note) -> { miles, printed, info } | null
         The inverse of milesNote; null for any note that is not one of ours.
     milesFilenameNumber(filename) -> string      ('' when there is none)
     isMilesFilename(filename) -> boolean
     milesRate(v) -> number                       (a readable, sane rate)
     MILES_RATE_DEFAULT, MILES_RATE_MAX */

const { normalizeAmount } = require('./amount');
const { parseStatementDate, hasAmountColumn } = require('./statement');

/* Ten Miles to the rand. Rand per Mile rather than Miles per rand because that
   is the direction the arithmetic runs (amount = miles x rate) and the one the
   Settings.md key stores. */
const MILES_RATE_DEFAULT = 0.1;
/* R1 a Mile is already ten times the default and far past any redemption this
   programme has ever offered. The ceiling is not about plausibility of the
   value — it is about the other way to read the field: someone who types "10"
   meaning "10 Miles to the rand" would otherwise value every Mile at R10, and
   the settings tab refuses it rather than clamping it to a figure nobody typed. */
const MILES_RATE_MAX = 1;

/* A rate the arithmetic can run on. Unreadable, zero or negative falls back to
   the default — NOT to the minimum: a blank is "I never set it", and a zero
   rate would silently value every Mile at nothing and then skip every row as
   too small. Above the ceiling clamps, for a hand-edited Settings.md the
   settings tab never saw; the tab itself rejects such a value outright. One
   definition, because the loader, the tab and the importer must agree about
   what a hand-edited value means. */
function milesRate(v) {
  const s = String(v == null ? '' : v).trim().replace(',', '.');
  const n = s === '' ? NaN : Number(s);
  if (!Number.isFinite(n) || n <= 0) return MILES_RATE_DEFAULT;
  return Math.min(MILES_RATE_MAX, n);
}

/* Miles -> rand, to the cent. Done in hundredths of a Mile so the common case
   (whole Miles, a rate of 0.10) never touches a float that is not exact, and
   rounded half AWAY from zero so a refund of N Miles is exactly the negative of
   the earn of N Miles — Math.round alone rounds -0.5 toward zero and +0.5 away,
   which would make a reversal differ from the row it reverses by a cent. The
   tiny epsilon is for the half-cent cases a binary float lands just under. */
function milesToRand(miles, rate) {
  const hundredths = Math.round(Number(miles) * 100);
  const cents = Math.round(Math.abs(hundredths * milesRate(rate)) + 1e-9);
  return (hundredths < 0 ? -cents : cents) / 100;
}

/* The bank's own text, made fit for a markdown table cell and a dedup key: the
   Additional-information column carries a stray control character in places
   (`2026-11-05 \x14  R 833.87` on the bp rewards) which would otherwise be
   written into a markdown file and, being invisible, sit in the key forever.
   Control characters become a space, then runs of whitespace collapse. */
function clean(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* A redemption prints its rand value as the tail of the TYPE: `Basket value -
   R 1,019.00`, `Data bundle - R89.00`, and once with nothing before the dash.
   Two decimals are required of the figure: a Type that merely ends in "R5" is a
   name, not a value. No lookbehind — it is a parse-time SyntaxError on the iOS 15
   floor and would take the whole bundle with it. */
const PRINTED_TAIL = /\s*-\s*R\s?((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s*$/i;

function splitType(type) {
  const t = clean(type);
  const m = PRINTED_TAIL.exec(t);
  if (!m) return { label: t, printed: null };
  return { label: t.slice(0, m.index).trim(), printed: Number(m[1].replace(/,/g, '')) };
}

/* The description a row is stored under.

   The bank's Description is the merchant on a Base Miles earn and, on a
   redemption, only the place (`Cape Town`, 103 of 104 electricity top-ups) —
   so on its own the row would read as a municipality and not as electricity.
   And the Description is not even unique across Types: `Checkers in-store`
   appears under both Vitality Money and Vitality Health, which are different
   earns the household may want told apart. So the Type's label leads whenever
   there is one — except on a plain `Base Miles` earn, where the merchant IS the
   story and a "Base Miles — " in front of every one of 2,886 rows would be noise
   the reader scrolls past. A Description that already begins with the label is
   left alone rather than saying it twice. An empty Type (`Gameboard - Coin
   tile`) is the Description alone. */
function milesDescription(label, desc) {
  const d = clean(desc);
  if (!label || label.toLowerCase() === 'base miles') return d;
  if (!d) return label;
  if (d.toLowerCase().startsWith(label.toLowerCase())) return d;
  return `${label} — ${d}`;
}

/* The facts, in the Note column, in a shape a parser can take apart again:

     Miles: 623.12 · Printed: R150.00 · Info: 2026-11-05 - R 623.12

   `Miles:` always leads and is signed, so a rewards summary reads the exact
   count back without re-deriving it from a rounded rand figure. `Printed:` is
   the rand value a redemption printed in its Type, written plainly (no grouping
   comma) with the bank's own R. `Info:` is the Additional-information text,
   cleaned. Absent facts are absent, not blank. The separator is " · " because a
   pipe is the table's own and an em dash is the description's. Note is the LAST
   text column of the transaction row but not the last column (Split follows), so
   nothing here may be a pipe or a newline. */
const NOTE_SEP = ' · ';
function milesNote({ miles, printed, info }) {
  const parts = [`Miles: ${Number(miles).toFixed(2)}`];
  if (printed != null) parts.push(`Printed: R${Number(printed).toFixed(2)}`);
  /* A lone dash is how the bank writes "nothing" in this column (4 rows on the
     real file) — an Info segment holding only that would be a fact about
     nothing. */
  const i = clean(info);
  if (i && !/^[-\s]+$/.test(i)) parts.push(`Info: ${i.split(NOTE_SEP).join(' - ')}`);
  return parts.join(NOTE_SEP);
}

/* The inverse. Anchored on the leading `Miles:` and nothing else, so a reader who
   appends their own words to the note, or an importer that adds " · Excluded
   during import" after ours, leaves the Miles count readable. A note that does
   not open with it is not ours and yields null — never a guess from loose
   digits. */
function parseMilesNote(note) {
  const parts = String(note == null ? '' : note).split(NOTE_SEP);
  const lead = /^\s*Miles:\s*(-?\d+(?:\.\d+)?)\s*$/.exec(parts[0]);
  if (!lead) return null;
  const out = { miles: Number(lead[1]), printed: null, info: '' };
  for (const p of parts.slice(1)) {
    const pm = /^Printed:\s*R\s?(\d+(?:\.\d+)?)\s*$/.exec(p);
    if (pm && out.printed == null) { out.printed = Number(pm[1]); continue; }
    if (p.startsWith('Info:') && !out.info) out.info = p.slice(5).trim();
  }
  return out;
}

/* `DiscoveryBankMiles_<accountNo>_<from>_<to>.csv` — the number is the one the
   other Discovery exports carry in the same slot, which is what lets the
   importer route by it. It is NOT proof of anything: whether it equals the
   cheque account's number is not something this module (or the file) can say,
   which is why the importer only ever routes a Miles file to a NON-budget
   account (views/import.js) — a Miles file whose number happened to match the
   cheque account must not land in it. */
function milesFilenameNumber(filename) {
  const m = /^[A-Za-z]*Miles[A-Za-z0-9]*_(\d{4,})(?:_|\.)/i.exec(String(filename || ''));
  return m ? m[1] : '';
}
const isMilesFilename = filename => /miles/i.test(String(filename || ''));

/* Is this a Discovery Miles export? Decided on the HEADER, with the filename as a
   second opinion where the header is thin.

   The evidence is a Miles column and the ABSENCE of an amount column. Absence
   matters as much as presence: a file with both is somebody's own sheet (a
   travel log with a Miles column and an Amount), and it has an amount that
   needs no rate. The amount vocabulary is statement.js's own (hasAmountColumn),
   so the two readers cannot disagree about what counts as an amount.

   Two shapes. The Discovery shape has a Type column and is recognised by its
   header alone. Without a Type column the header is just Date, Description,
   Miles — which is also what a car's mileage log looks like — so there the
   filename has to say Miles as well. Nothing here is a guess that costs money
   silently: even a wrong header-only call lands on a review screen that says
   "read as a Discovery Miles export" and offers "Columns wrong?". */
function detectMilesExport(rows, filename) {
  const head = (rows || []).slice(0, 10);
  for (let h = 0; h < head.length; h++) {
    const low = head[h].map(c => String(c == null ? '' : c).replace(/^﻿/, '').trim().toLowerCase());
    const iMiles = low.findIndex(c => c === 'miles' || c === 'discovery miles' || /^miles\b/.test(c));
    if (iMiles === -1) continue;
    if (hasAmountColumn(low)) return null;
    let iDate = low.indexOf('value date');
    if (iDate === -1) iDate = low.indexOf('date');
    if (iDate === -1) iDate = low.findIndex(c => c.includes('date'));
    let iDesc = low.indexOf('description');
    if (iDesc === -1) iDesc = low.findIndex(c => c.includes('desc'));
    if (iDate === -1 || iDesc === -1) return null;
    const iType = low.indexOf('type');
    if (iType === -1 && !isMilesFilename(filename)) return null;
    let iInfo = low.indexOf('additional information');
    if (iInfo === -1) iInfo = low.findIndex(c => c.includes('additional') || c.includes('info'));
    return { iDate, iDesc, iType, iInfo, iMiles, miles: true,
      iAmount: -1, iDebit: -1, iCredit: -1, iFee: -1, iBalance: -1, iExtra: -1,
      headerIdx: h, dataStart: h + 1 };
  }
  return null;
}

/* The rows of a Miles export as importer items, at `rate` rand per Mile.

   Four outcomes for a data row, each counted apart so the review can say what
   happened to every line rather than "N unparseable":
     imported  — dated, described, a non-zero Miles figure that is worth at
                 least a cent;
     zero      — 0.00 Miles: no reward, nothing to record;
     tooSmall  — a real Miles figure the rate rounds to R0.00 (fractional Miles
                 at a low rate): it would be dropped by the importer's own
                 zero-amount rule, so it is named here instead of vanishing;
     skipped   — looked like a row and was not usable (no readable date or
                 Miles, or nothing to call it).
   A blank line or trailing text carries neither a date nor a Miles figure and is
   ignored silently, as the statement importer ignores them.

   `cat` is left empty on purpose: the household's categorisation rules are
   written for merchants it SPENDS at, and "Woolworths" on a Base Miles earn is
   not a grocery bill. Categorising these would put reward Miles under Groceries
   in every category report that reads a non-budget account's rows. */
function milesRows(rows, map, opts) {
  const r = milesRate(opts && opts.rate);
  const items = [];
  let skipped = 0, zero = 0, tooSmall = 0, miles = 0;
  for (const row of (rows || []).slice(map.dataStart)) {
    const cell = i => (i >= 0 && row[i] != null ? String(row[i]) : '');
    const date = parseStatementDate(cell(map.iDate).trim(), true);
    // 'comma': a Miles cell is a plain count and a comma in one can only be a
    // thousands group — never a decimal comma — so the file need not prove it.
    const m = normalizeAmount(cell(map.iMiles), { grouping: 'comma' });
    if (m == null && !date) continue;                  // not a data row at all
    if (m === 0) { zero++; continue; }
    const { label, printed } = splitType(cell(map.iType));
    const desc = milesDescription(label, cell(map.iDesc));
    if (!date || m == null || !desc) { skipped++; continue; }
    const amount = milesToRand(m, r);
    if (amount === 0) { tooSmall++; continue; }
    miles += Math.round(m * 100);
    items.push({
      date, desc, amount, cat: '', matchedPattern: '',
      note: milesNote({ miles: m, printed, info: cell(map.iInfo) }),
      miles: m, include: true, excluded: false, transferTo: '',
    });
  }
  return { items, skipped, zero, tooSmall, miles: miles / 100 };
}

module.exports = {
  detectMilesExport, milesRows, milesToRand, milesNote, parseMilesNote,
  milesFilenameNumber, isMilesFilename, milesRate, milesDescription, splitType,
  MILES_RATE_DEFAULT, MILES_RATE_MAX,
};
