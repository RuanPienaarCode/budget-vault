'use strict';
/* Reading a money value that a HUMAN or a BANK wrote.

   Every amount in this app arrives as text somebody else formatted — a bank's
   CSV export, a hand-edited markdown cell, a value typed into a modal — and the
   formats genuinely differ: SA and EU write "1 234,56", the US and UK write
   "1,234.56", and a bank may add a currency symbol, parentheses or a Cr/Dr
   marker. Bare parseFloat reads "1,234.56" as 1 and "R150.00" as 0, which is
   the worst possible failure here: not an error, a plausible wrong number.

   So there is exactly one reader, and everything goes through it. Four private
   near-copies of this logic had grown across the views, the loader and the
   onboarding wizard, and they disagreed on the grouped-thousands case.

   Pure — no DOM, no obsidian import. */

/* Parse a statement amount cell to a Number, or null if empty/unparseable.
   Tolerates the spread of bank export styles: "R 1 234.56", "$1,234.56",
   decimal-comma "1 234,56" / "1.234,56", parenthesised negatives "(123.45)",
   trailing minus "123.45-", and Cr/Dr markers (Cr → credit/positive,
   Dr → debit/negative). Zero is a valid return — callers decide to skip it. */
/* ---- what the SEPARATORS mean, decided per FILE rather than per cell ----

   "1.500.000" cannot be a decimal — no money has two decimal points — so a
   cell like that reads as grouped thousands without needing to know anything
   about the reader. "250.000" is genuinely ambiguous on its own, and
   normalizeAmount leaves it alone for exactly that reason.

   The trouble is that a real statement contains both. An Indonesian export
   reading

     Rp -1.500.000      -> -1500000   (unambiguous, two groups)
     Rp    -250.000     ->     -250   (ambiguous, one group)

   parsed its own rows by two different rules and put -250 next to -1500000,
   which is this codebase's recurring bug shape arriving inside a single
   column. And it is the worst kind: a plausible number, off by a thousand,
   with nothing on screen to suggest anything happened.

   So the convention is inferred ONCE from the whole column and then applied
   to every cell in it. Evidence is only ever taken from the unambiguous
   forms — two-or-more dot groups, or a decimal comma — so a file that offers
   no evidence gets no guess and every cell parses exactly as it does today.
   A file offering evidence BOTH ways gets no guess either: that is a column
   this function has no business resolving on its own.

   Returns 'dot' (1.500.000 / 1.234,56), 'comma' (1,500,000 / 1,234.56), or
   null for "no evidence — do not assume". */
function inferGrouping(cells) {
  let dot = 0, comma = 0;
  for (const raw of cells || []) {
    const c = String(raw == null ? '' : raw).replace(/[\s\u00A0\u202F']/g, '');
    // Two or more dot groups, or a decimal comma: dot groups the thousands.
    if (/\d{1,3}(\.\d{3}){2,}(?!\d)/.test(c) || /\d(\.\d{3})*,\d{1,2}(?!\d)/.test(c)) dot++;
    // Two or more comma groups, or a decimal point: commas group the thousands.
    if (/\d{1,3}(,\d{3}){2,}(?!\d)/.test(c) || /\d(,\d{3})*\.\d{1,2}(?!\d)/.test(c)) comma++;
  }
  if (dot && !comma) return 'dot';
  if (comma && !dot) return 'comma';
  return null;
}

/* `opts.grouping` is inferGrouping()'s verdict for the column this cell came
   from. Optional at every call site: without it this function behaves exactly
   as it always has, which is what keeps the loader, the modals and the
   onboarding wizard — none of which have a column to infer from — unchanged. */
function normalizeAmount(raw, opts) {
  let s = (raw ?? '').toString().trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  // A Dr/Cr marker can lead ("DR 100.00") or trail ("100.00 Dr") — both are
  // routine across statement exports, and only the trailing form used to be
  // read. Checked before the trailing form so a marker on ONE side of a bare
  // cell is consumed exactly once, from whichever side it's actually on.
  const leadMarker = s.match(/^(cr|dr)\.?\s*/i);
  if (leadMarker) { if (leadMarker[1].toLowerCase() === 'dr') neg = true; s = s.slice(leadMarker[0].length).trim(); }
  const marker = s.match(/(cr|dr)\.?\s*$/i);
  if (marker) { if (marker[1].toLowerCase() === 'dr') neg = true; s = s.slice(0, marker.index).trim(); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1).trim(); }
  /* Sign, symbol, sign - because banks write it both ways round. "-R100" puts
     the minus outside the symbol and "R-100" puts it inside, and a single pass
     can only catch one of them: stripping the sign first leaves "R-100" as
     "-100" AFTER the symbol goes, which fails the final numeric test and comes
     back as null - which parseNum then serves to every total as ZERO. A missing
     sign is a wrong number; a missing amount is a wrong number wearing an empty
     cell.

     The second pass runs ONLY where a symbol was actually removed, and that
     condition is the whole guard. Run unconditionally it also accepts "--100"
     and "+-100" as -100, because each pass sees a fresh leading sign - turning
     junk into a confident number, which is the one thing this file exists to
     refuse. A doubled sign is not a format any bank writes; it is a damaged
     cell, and null is the honest answer. */
  // ASCII hyphen-minus is not the only minus a real cell carries: U+2212 MINUS
  // SIGN is what copy-pasting a PDF bank statement or a formatted online-
  // banking page actually yields, and U+FF0D FULLWIDTH HYPHEN-MINUS shows up
  // from CJK-locale exports. Both were silently falling through to null here,
  // which parseNum then serves to every total as a plausible zero.
  const sign = () => {
    if (/^[-−－]/.test(s)) { neg = true; s = s.slice(1).trim(); return true; }
    if (s.startsWith('+')) { s = s.slice(1).trim(); return true; }
    return false;
  };
  sign();
  /* ---- the currency marker, whichever end of the cell it is on ----

     Not an allowlist. An allowlist was the first fix (issue #28: the
     reporter's "Rp 1.500.000" came back null, so an Indonesian statement
     imported ZERO rows and reported them all as "skipped"), and an
     allowlist's failure mode is the same silent nothing for the next
     currency nobody thought of. So the rule is structural instead: a money
     cell is a number with an optional UNIT attached, and the unit is either
     a currency symbol or a short alphabetic code.

     \p{Sc} is the Unicode currency-symbol category — every currency sign
     there is, present and future, rather than the fourteen somebody
     remembered. Safe on this plugin's real floor: property escapes have
     worked in WebKit since Safari 11.1, and src/controller.js already ships
     \p{L}. LOOKBEHIND is the construct that is fatal before iOS 16.4 (a
     parse-time SyntaxError that kills the whole bundle) and there is none
     here — see tests/bundle-smoke.test.cjs, which scans for it.

     Generous stripping is safe because the numeric gate at the bottom of
     this function is strict: anything left that is not a number still comes
     back null. "N/A" loses its "N" and fails on "/A"; "three thousand" loses
     "three" and fails on the rest.

     \p{L}, not [A-Za-z]: "zł", "Kč" and "лв" are currency markers whose
     letters are not ASCII, and an ASCII-only class read all three as junk and
     returned null — the same silent nothing, one alphabet over. It also picks
     up "1,200円" for free.

     The trailing form requires TWO letters if they are ASCII. Nobody writes
     an amount as "100m" in a statement column, but if a vault does, a single
     trailing ASCII letter is left alone rather than silently turning 100m
     into 100 — that cell comes back null, which is the honest answer to
     something this function cannot read. A single NON-ASCII trailing
     character has no such ambiguity: "1,200円" and "1,200元" are how those
     statements write it, and no shorthand competes for the position.

     Both strips are guarded on the result still containing a digit, which is
     what makes a generous rule safe: "three thousand" loses four letters to
     the leading strip, the remainder has no digit, and the original string is
     put back to fail the numeric gate as it always did. */
  /* Leading: a symbol and/or a code of at most four letters, optionally glued
     to the number ("R150", "Rp 1.500", "US$1,200"). The LOOKAHEAD is what
     makes a generous rule safe — the marker is only removed when a number
     actually follows it. Without it, "about 15 000" lost "abo" to the letter
     run and came back as 15000: prose read as a confident figure, which is
     the precise failure this whole module exists to refuse. Lookahead, not
     lookbehind: the latter is a parse-time SyntaxError before iOS 16.4 that
     would kill the entire bundle (tests/bundle-smoke.test.cjs scans for it).

     The lookahead admits a SIGN as well as a digit, because "R-100" puts the
     minus inside the symbol and is a form banks really write — the sign()
     pass below picks it up once the symbol is gone. */
  const bare = s.replace(
    /^(?:\p{Sc}|\p{L}){1,4}\$?[\s\u00A0]*(?=[\d.,+\-\u2212\uFF0D])/u, '');
  if (bare !== s) { s = bare; sign(); }
  /* Trailing: "1234.56 ZAR", "1 234,56 €", "50CHF", "1,200円". No lookbehind
     available, so the guard is explicit instead: only strip when what remains
     still ENDS in a digit, which "15 000 about" would not survive either. */
  const tail = s.replace(
    /[\s\u00A0]*(?:\p{Sc}|\p{L}{2,4}|[^\x00-\x7F])$/u, '');
  if (tail !== s && /\d$/.test(tail.trim())) s = tail.trim();
  s = s.replace(/[\s\u00A0\u202F']/g, '');
  /* A trailing percent is a unit suffix, exactly like the currency prefix
     stripped above, and it is dropped for the same reason. Debts.md's `Rate`
     column reads through this function under a header literally named "Rate",
     next to prose describing it as "the annual interest rate as a percentage"
     \u2014 so "18.5%" is the obvious hand-edit. Without this it failed the decimal
     test below, came back null, and was served as a rate of ZERO: no interest
     on the Debts page, no interest in the score, and full marks for the debt
     pillar on a quarter-million rand of debt. */
  s = s.replace(/%$/, '');
  if (/^\d+(\.\d{3})*,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');  // decimal comma
  /* Dot-grouped thousands with NO decimal part at all — "1.500.000", the way
     Indonesia, Germany, Brazil and much of Europe write it. Two or more groups
     is required, and that requirement is the whole reason this is safe to do
     without knowing the reader's locale: "1.500" on its own is genuinely
     ambiguous (one and a half, or one thousand five hundred?) and is left
     exactly as it always parsed, but "1.500.000" cannot be a decimal — no
     money has two decimal points. Guessing at the ambiguous case is how a
     confident wrong number gets printed, which this file refuses; declining
     to read the UNambiguous one was simply a gap. */
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');
  /* The single-group case, resolved only where the FILE said which convention
     it uses — see inferGrouping above. This is what stops "250.000" reading
     as 250 in a column whose other rows are plainly dot-grouped. */
  else if (opts && opts.grouping === 'dot' && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(/,/g, '');                                                       // thousands comma
  // A bare ".50" is a real cell (some exports drop the leading zero), and it
  // must parse rather than fall to null and be served as zero by parseNum.
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

/* Strict numeric-cell parse. Returns { ok, value, raw, readable }. `ok` is true
   only for a plain decimal (the app's on-disk format); anything else (e.g.
   "1 234,56", "R100") is preserved verbatim in `raw` so a serializer can write
   it back unchanged instead of silently coercing it to a wrong number.

   The fallback `value` still has to be the reader's best guess, because it
   feeds every total and KPI — but it must not be a *plausible wrong number*.
   Bare parseFloat reads "1,234.56" as 1 and "R150.00" as 0, which shows up as
   a quietly wrong balance rather than an obvious error. normalizeAmount knows
   both separator conventions and every statement flavour, so use it.

   `readable` is the THIRD question, and it is not `ok`. `ok` asks "is this
   already in the canonical on-disk form"; `readable` asks "did a number come
   out of this cell at all". "1 234,56" answers no to the first and yes to the
   second — it is read correctly as 1234.56 and rewritten canonically, which is
   the byte behaviour tests/golden-tables.test.cjs pins. "12 000 R" and
   "prime + 2" answer no to both: normalizeAmount refuses them and the 0 in
   `value` is FABRICATED, not measured.

   Callers needed that separation and could not derive it — `value: 0` looks
   identical whether the file said "0.00" or something nobody can read — so
   table-schema.js's money() reader used to write its fabricated 0 back over
   the reader's own text on the next save. The distinction lives here, beside
   the parse that makes it, rather than as a second normalizeAmount call at
   each call site that would be free to drift from this one. */
function parseNum(s) {
  const t = (s ?? '').toString().trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return { ok: true, value: parseFloat(t), readable: true };
  const n = normalizeAmount(t);
  return { ok: false, value: n ?? 0, raw: t, readable: n != null };
}

module.exports = { normalizeAmount, inferGrouping, parseNum };
