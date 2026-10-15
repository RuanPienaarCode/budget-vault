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
want(`${D} td:nth-child(6) > select`, 'max-width', WIDE, v => px(v) === 128, 'cap the Category select at 8rem (it was 212px, the width of its longest option)');
want(`${D} th`, 'padding-inline', WIDE, v => px(v) === 10, 'tighten the Debts cell padding to 10px (11 columns x 12px)');
want(`${D} td`, 'padding-inline', WIDE, v => px(v) === 10, 'tighten the Debts body cell padding to 10px');
want(`${D} .debt-prog`, 'min-width', WIDE, v => px(v) === 92, 'lower the progress cell floor (it was 120px)');
want(`${D} .debt-prog .cat-bar`, 'min-width', WIDE, v => px(v) === 52, 'lower the progress bar floor (it was 70px) so the cell can reach it');

if (failures.length) { console.error(`FAIL — css-desktop-table-reach: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-desktop-table-reach: Accounts state cell wraps at every width and drops its repeated columns in two steps, Budget and Debts give up room before columns (${checks} checks).`);
