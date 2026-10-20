'use strict';
/* A DESKTOP TABLE MUST NOT HIDE ITS LAST COLUMNS BEHIND A SIDEWAYS SCROLL (audit L6-01).

   Measured in Chromium with Obsidian 1.14.4's real app.css, over the synthetic
   household, at 1024 and 1280px wide (the card is about 902 and 1078px):

     Accounts  1443px of table in a 902-1078px card. The State cell (the reason
               a balance is flagged, plus Review / "Use R ..." / Ignore) and the
               Notes chip were past the card edge at EVERY window width, not just
               a small one.
     Debts     1373px.
     Budget    1104px, with the row's delete button outside the card.

   Causes, one per table:

     Accounts  `.acct-col-state { white-space: nowrap }` held the pill, the
               reason and up to three buttons on ONE line (453px), and the only
               rule that let it wrap lived inside `@media (max-width: 760px)`. The
               Progress cell was a bar and its label in a nowrap row, 195px, which
               the table could not narrow either.
     Budget    the Notes input carries `style="width:230px"`, an inline width that
               no stylesheet rule beats, so the column could never give; the
               Actual column held "no transaction expected" on a nowrap line
               (td.num is nowrap); the Type badge is nowrap.
     Debts     eleven columns, nine of them fixed-width controls inside 16px cell
               padding.

   Two more were left over from that pass and measured the same way on
   15 Oct 2026, in the same harness over the same household (whole history):

     Transactions  1076px in an 887px scroller at 1024 (902px card, less its
                   own vertical scrollbar); 1076 in 1078 at 1280, two pixels
                   from scrolling. Row actions past the card edge at 1024.
     Owed Money    1062px in 902 at 1024, the remove button outside it; 1062
                   in 1078 at 1280.

   Causes:

     Transactions  16px cell padding on eight columns; the Account and
                   Category cells nowrap (the category button is nowrap for
                   its ellipsis, inside a 130px min-width wrapper), so the
                   longest account name and "Debt Repayments" each fixed a
                   column; the "Excl. budget" heading held a 107px column for
                   a checkbox; and the Note input carries style="width:130px".
     Owed Money    16px padding on seven columns, a 220px Description input
                   and a 110px Amount input.

   The rules pinned here let each table give up room before it gives up a
   column, in this order: wrap what can wrap, narrow what can narrow, and only
   then drop the columns the Accounts drawer already repeats (the phone has
   always dropped them; this reaches the widths between a phone and a laptop).
   The layout itself was measured in a browser, before and after; what a bare
   node guard can honestly hold is that the rules which did the work are still
   there and still say what they said, so each assertion names the number the
   browser measurement turned on.

     node tests/css-desktop-table-reach.test.cjs */

const { readRules, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const rules = readRules();
const R = '.budget-app-root';

/* The LAST declaration of `prop` for an exact selector in an exact context —
   the one the cascade keeps between equal rules. */
const decl = (sel, prop, ctx = []) => {
  let hit = null;
  for (const r of rules) {
    if (JSON.stringify(r.context) !== JSON.stringify(ctx) || !r.selectors.includes(sel)) continue;
    for (const d of r.decls) if (d.prop === prop) hit = { ...d, rule: r };
  }
  return hit;
};
const px = v => { const m = /^(-?[\d.]+)(px|rem)?$/.exec(String(v).trim()); return m ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : NaN; };
const want = (sel, prop, ctx, test, why) => {
  const d = decl(sel, prop, ctx);
  ok(d && test(d.value), `${ctx.join(' ') || '(base)'} ${sel} { ${prop} } should ${why}; found ${d ? `"${d.value}" at ${locate(d.line)}` : 'nothing'}`);
  return d;
};

/* ---- 1. ACCOUNTS: the state cell wraps at every width, the actions take their own line ---- */
want(`${R} .acct-col-state`, 'white-space', [], v => v === 'normal',
  'let the state cell wrap at desktop widths too (it was nowrap above 760px: 453px for a pill, a reason and three buttons)');
want(`${R} .acct-row-acts`, 'display', [], v => v === 'flex', 'be a flex row of its own, not an inline-flex run beside the pill');
want(`${R} .acct-row-acts`, 'flex-wrap', [], v => v === 'wrap', 'wrap its buttons');
want(`${R} .acct-row-why`, 'flex', [], v => /^1 1 100%$/.test(v),
  'take the whole first line of the actions row, so the reason wraps in the cell instead of stretching it');
{
  const m = decl(`${R} .acct-row-acts`, 'margin', []);
  const p = m && String(m.value).trim().split(/\s+/);
  ok(m && px(p[0]) > 0 && (p[3] === undefined ? px(p[1] === undefined ? p[0] : p[1]) : px(p[3])) === 0,
    `the actions keep a gap ABOVE them and no inline offset (found "${m && m.value}")`);
}
want(`${R} .acct-goal`, 'flex-wrap', [], v => v === 'wrap',
  'let the goal label drop under its bar: the bar and a nowrap label were 195px, the Progress column could not narrow');

/* The columns the drawer repeats drop in two steps between a phone and a
   laptop. Each step is the width below which the table, with everything before
   it already wrapped and narrowed, no longer fits the card: the card is the
   window less ~122px (the drawer's rail and the page gutters), the table needs
   about 1061px with all eight columns, 826 without the sparkline and the
   confirmed date, 587 with only the name, balance, state and notes. */
const STEP1 = '@media (max-width: 1180px)', STEP2 = '@media (max-width: 960px)';
const hides = (ctx, sel) => { const d = decl(sel, 'display', [ctx]); return d && d.value === 'none'; };
for (const n of [4, 6]) {
  ok(hides(STEP1, `${R} #acctTable:not(.is-sized) .acct-col-drop:nth-child(${n})`),
    `${STEP1}: the ${n === 4 ? 'sparkline' : 'confirmed-date'} column (nth-child(${n})) drops, so the table fits a ~1024px window`);
}
ok(hides(STEP2, `${R} #acctTable:not(.is-sized) .acct-col-drop`),
  `${STEP2}: every .acct-col-drop column drops (the phone's set), so the table fits down to the 760px rule that already does it`);
/* A reader who dragged a column edge chose their widths (fixed layout); hiding
   columns under that would make the stored widths mean something else. */
for (const r of rules) {
  if (!r.context.some(c => c === STEP1 || c === STEP2)) continue;
  for (const s of r.selectors.filter(x => x.includes('#acctTable'))) {
    ok(/#acctTable:not\(\.is-sized\)/.test(s), `${locate(r.line)}: "${s}" drops a column of a table the reader has sized by hand`);
  }
}
/* The VoiceOver gate (css-phone-layout) only concerns display values that take
   the table out of table layout; display:none is neither, so nothing here may
   re-lay the table out. */
for (const r of rules) {
  if (!r.context.some(c => c === STEP1 || c === STEP2)) continue;
  for (const d of r.decls) ok(!(d.prop === 'display' && /^(grid|block|flex|inline-flex|contents)$/.test(d.value)),
    `${locate(r.line)}: a width step may drop a column, never re-lay the table out (${d.prop}: ${d.value})`);
}

/* ---- 2. BUDGET: the inline-width Notes input, the nowrap caption and badge ---- */
const WIDE = ['@media (min-width: 601px)'];
const NOTES = `${R} .bud-table tbody tr:not(.type-row) td:nth-child(5) input.form-control`;
{
  const d = want(NOTES, 'max-width', WIDE, v => px(v) > 0 && px(v) <= 176,
    'cap the Notes input: it carries an inline width:230px that only a max-width can lower (the column was 262px)');
  ok(d && px(d.value) >= 144, `the cap keeps a usable note field (>= 9rem), found ${d && d.value}`);
}
want(`${R} .bud-table .category-badge`, 'white-space', WIDE, v => v === 'normal',
  'let the Type badge wrap ("Everyday expenses" was one 130px nowrap line)');
want(`${R} .bud-table td.num .bud-assumed-note`, 'white-space', WIDE, v => v === 'normal',
  'let "no transaction expected" wrap (td.num is nowrap, so the caption fixed the whole Actual column at 165px)');
want(`${R} .bud-table thead th`, 'padding-inline', WIDE, v => px(v) === 12, 'tighten the cell padding to 12px (16px x 12 sides was 48px of a 902px card)');
want(`${R} .bud-table tbody td`, 'padding-inline', WIDE, v => px(v) === 12, 'tighten the body cell padding to 12px');

/* ---- 3. DEBTS: eleven columns, narrowed to what they print ---- */
const DEBT_INPUTS = { 2: 100, 3: 68, 4: 88, 5: 84 };
for (const [n, w] of Object.entries(DEBT_INPUTS)) {
  const d = decl(`${R} #debtTable td:nth-child(${n}) > input`, 'width', []);
  ok(d && px(d.value) === w, `Debts column ${n}'s desktop input is ${w}px (was 120/84/110/100: 1373px of table); found ${d && d.value} at ${d && locate(d.line)}`);
}
/* Scoped to a body that is NOT a phone: a landscape iPhone (601-932px, still
   .is-phone) stacks these rows into cards whose controls fill their cell, and a
   max-width or a padding written for the table would follow them in. */
const D = `body:not(.is-phone) ${R} #debtTable`;
/* Second pass (2026-10-20 audit, D1-18): the first pass fitted the card but
   left a 74px name column (names broke per word), a clipped Category select
   (8rem showed "Debt Repayme") and a three-line Interest heading. The select
   now flexes between a floor that shows a two-word category whole and the
   width of a long one; the name and Interest columns get floors; Rate and
   Extra flex; the cell padding and progress floors give the room back.
   Measured at 1280px: min-content 1068px in the 1078px card. */
{
  const d = want(`${D} td:nth-child(6) > select`, 'min-width', WIDE, v => px(v) >= 136,
    'give the Category select a floor that shows "Debt Repayments" whole (8rem clipped it to "Debt Repayme")');
  ok(d, 'the Category select floor is set');
}
want(`${D} td:nth-child(6) > select`, 'max-width', WIDE, v => px(v) > 136 && px(v) <= 176, 'and let it grow only to 11rem (it was 212px, the width of its longest option)');
want(`${D} td:nth-child(6) > select`, 'width', WIDE, v => v === '100%', 'and take the column it is given between the two');
want(`${D} th`, 'padding-inline', WIDE, v => px(v) === 8, 'tighten the Debts cell padding to 8px (11 columns x 16px)');
want(`${D} td`, 'padding-inline', WIDE, v => px(v) === 8, 'tighten the Debts body cell padding to 8px');
want(`${D} thead th`, 'white-space', WIDE, v => v === 'normal', 'let the Debts headings wrap ("Extra / month", "Interest still to pay")');
want(`${D} thead th:first-child`, 'min-width', WIDE, v => px(v) >= 112, 'give the Debt name column a floor (it was 74px: "Visa / Gold")');
want(`${D} thead th:nth-child(9)`, 'min-width', WIDE, v => px(v) >= 104, 'give "Interest still to pay" the room for two lines, not three');
for (const [n, lo, hi] of [[3, 56, 68], [5, 68, 84]]) {
  want(`${D} td:nth-child(${n}) > input`, 'min-width', WIDE, v => px(v) === lo, `let Debts column ${n}'s input narrow to ${lo}px`);
  want(`${D} td:nth-child(${n}) > input`, 'max-width', WIDE, v => px(v) === hi, `and no wider than the ${hi}px it was`);
}
want(`${D} .debt-prog`, 'min-width', WIDE, v => px(v) === 80, 'lower the progress cell floor (it was 120px, then 92)');
want(`${D} .debt-prog .cat-bar`, 'min-width', WIDE, v => px(v) === 40, 'lower the progress bar floor (it was 70px, then 52) so the cell can reach it');

/* ---- 4. TRANSACTIONS: wrap the names, tighten the padding, cap the note ----
   Scoped like Debts: a landscape iPhone (.is-phone, 601-932px) stacks these
   rows into cards (phone.css), and nothing written for the table may follow
   them in. Measured: min-content 1076 -> 852px, so the table fits the 887px
   scroller at 1024 with 35px to spare and fills 1078 at 1280. */
const T = `body:not(.is-phone) ${R} #txTable`;
want(`${T} th`, 'padding-inline', WIDE, v => px(v) === 10, 'tighten the Transactions cell padding to 10px (16px x 16 sides was 256px of an 887px scroller)');
want(`${T} td`, 'padding-inline', WIDE, v => px(v) === 10, 'tighten the Transactions body cell padding to 10px');
want(`${T} tbody td:nth-child(3)`, 'white-space', WIDE, v => v === 'normal',
  'let the account name wrap (the nowrap cell was 148px for "FNB Cheque" and grows with every longer account name)');
want(`${T} tbody td:nth-child(4)`, 'white-space', WIDE, v => v === 'normal', 'let the category cell wrap');
want(`${T} .cat-cell-btn`, 'white-space', WIDE, v => v === 'normal',
  'let the category name wrap at its spaces ("Debt Repayments" on one nowrap line fixed the column at 176px)');
want(`${T} .cat-cell`, 'min-width', WIDE, v => px(v) === 0,
  'drop the 130px floor of the category wrapper, so a short name does not hold the column wider than its longest word');
want(`${T} thead th:nth-child(6)`, 'white-space', WIDE, v => v === 'normal',
  'let the "Excl. budget" heading wrap (it held a 107px column for a 20px checkbox; "Fora do orçamento" is longer still)');
{
  const d = want(`${T} td:nth-child(7) input`, 'max-width', WIDE, v => px(v) > 0 && px(v) <= 112,
    'cap the Note input: it carries an inline width:130px that only a max-width can lower');
  ok(d && px(d.value) >= 96, `the cap keeps a usable note field (>= 6rem), found ${d && d.value}`);
}

/* ---- 5. OWED MONEY: a description that flexes, an amount sized to a figure ----
   Measured: min-content 1062 -> 856px, which fits the 902px card at 1024; at
   1280 the Description field takes the spare room (202px) instead of a fixed
   220. Dates keep their 140px floor: a date input narrower than that clips
   its own value in some locales' formats. */
const O = `body:not(.is-phone) ${R} #owedTable`;
want(`${O} th`, 'padding-inline', WIDE, v => px(v) === 10, 'tighten the Owed Money cell padding to 10px (7 columns x 32px)');
want(`${O} td`, 'padding-inline', WIDE, v => px(v) === 10, 'tighten the Owed Money body cell padding to 10px');
want(`${O} td:nth-child(2) > input`, 'width', WIDE, v => v === '100%',
  'let the Description field take the column rather than a fixed 220px');
{
  const d = want(`${O} td:nth-child(2) > input`, 'min-width', WIDE, v => px(v) >= 96 && px(v) <= 128,
    'keep a floor under the Description field that still fits the card at 1024');
  ok(d, 'the Description floor is set');
}
want(`${O} td:nth-child(3) > input`, 'max-width', WIDE, v => px(v) > 0 && px(v) <= 96,
  'cap the Amount field at 6rem (it was 110px; "150000.00" takes ~63px of text)');
want(`${O} td.num .fine-note`, 'white-space', WIDE, v => v === 'normal',
  'let "counts as 0 in the totals" wrap (td.num is nowrap, so the note would fix the Amount column at its own length)');

if (failures.length) { console.error(`FAIL — css-desktop-table-reach: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-desktop-table-reach: Accounts state cell wraps at every width and drops its repeated columns in two steps, Budget, Debts, Transactions and Owed Money give up room before columns (${checks} checks).`);
