'use strict';
/* THE PHONE LAYER (375x667) HOLDS, AND NEVER REACHES A DESKTOP WINDOW.

   The 13 Oct 2026 phone audit measured the plugin at 375x667, the size of the
   iPhone 6s/7/8/SE Ruan's mother uses, after she said "the font and css is
   unusable". Twelve findings, all CSS; this pins each of them, because none of
   them is visible to a suite that renders no pages:

     1. Transactions cards were 354px tall, not ~234px: an unscoped desktop rule
        (`#view-transactions .table tbody td { padding: 12px 0 }`, specificity
        1,2,2) beat the phone card's `#txTable tbody td { padding: 0 }` (1,1,2).
     2. The Transactions header was 386px tall: selects share a line, the actions
        are one sideways rail.
     3. 52 text nodes under 12px (the worst 8.8px). --st-micro is the floor, and
        every declared size under it is raised in the phone layer.
     4. Tap targets of 24-40px.
     5. Fields under 16px (iOS zooms the page on focus).
     6. Blocks sitting on the screen edge.
     7. Dashboard "Budget vs actual" 511px in a 365px scroller.
     8. The CLOSED drawer's box-shadow painting a grey strip down every screen.
     9. A title clipped by its own page.
    10. .hero-num breaking inside a number.
    11. Three contrast failures. 12. A totals band that put the first category
        1005px down. And the landscape twin of the stacked cards (a phone on its
        side is still .is-phone, but 601px+ wide).

   Plus the property that makes any of it safe to ship: nothing in
   src/statement/phone.css applies to a desktop window, and the sheet carries
   no !important.

   Negative controls, each run by hand when this file was written: delete the
   @media (min-width: 601px) around the Transactions td padding; drop one
   selector from the type-floor list; add a bare (unscoped) rule to phone.css;
   change a portrait #txTable rule without its landscape twin. Each fails here.

     node tests/phone-375.test.cjs */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { readRules, readRulesOf, sources, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const notes = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

const rules = readRules();
const PORTRAIT = '@media (max-width: 600px)';
const fileOf = line => locate(line).split(':')[0];
const px = v => {
  const m = /^(-?[\d.]+)(px|rem|em)$/.exec(String(v).trim());
  if (!m) return null;
  return m[2] === 'em' ? null : Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
};
/* The last declaration of `prop` for an EXACT selector in an exact context. */
const last = (sel, prop, ctx) => {
  let hit = null;
  for (const r of rules) {
    if (JSON.stringify(r.context) !== JSON.stringify(ctx) || !r.selectors.includes(sel)) continue;
    for (const d of r.decls) if (d.prop === prop) hit = { ...d, rule: r };
  }
  return hit;
};
const want = (sel, prop, ctx, test, why) => {
  const d = last(sel, prop, ctx);
  ok(d && test(d.value), `${ctx.join(' ') || '(base)'} ${sel} { ${prop} } should ${why}; found ${d ? `"${d.value}" at ${locate(d.line)}` : 'nothing'}`);
  return d;
};
const R = '.budget-app-root';

/* ---- 0. the tokens and the file's own shape --------------------------------- */
want(R, '--st-micro', [], v => v === '12px', 'declare the 12px phone type floor (foundation.css)');

const phoneSrc = sources().find(s => s.rel === 'src/statement/phone.css');
ok(phoneSrc && phoneSrc.text.trim().length > 2000, 'src/statement/phone.css exists and is not the empty lane header');
const phoneRules = readRulesOf(phoneSrc.text, 'phone.css');
ok(phoneRules.length > 40, `phone.css should hold the phone layer, found ${phoneRules.length} rules`);

/* ---- 1. NOTHING IN phone.css REACHES A DESKTOP WINDOW ------------------------ */
const OK_CTX = [
  ['@media (max-width: 600px)'],
  ['@media (pointer: coarse)'],
  ['@media (max-width: 600px)', '@supports (overflow-wrap: anywhere)'],
];
const LANDSCAPE = ['@media (min-width: 601px)'];
const LANDSCAPE_GUTTER = ['@media (min-width: 601px) and (max-width: 768px)'];
const isCtx = (c, list) => list.some(x => JSON.stringify(x) === JSON.stringify(c));
for (const r of phoneRules) {
  const c = r.context;
  const portrait = isCtx(c, OK_CTX);
  const wide = c.length >= 1 && (c[0] === LANDSCAPE[0] || c[0] === LANDSCAPE_GUTTER[0]);
  ok(portrait || wide, `phone.css line ${r.line}: "${r.prelude.slice(0, 70)}" sits in ${c.join(' ') || 'no @media'} — it would apply to a desktop window; only the phone breakpoint, (pointer: coarse) or body.is-phone are allowed`);
  if (wide) ok(r.selectors.every(s => s.startsWith('body.is-phone ')), `phone.css line ${r.line}: a rule above 600px must be keyed on body.is-phone, found "${r.prelude.slice(0, 80)}"`);
}

/* The sheet carries no !important (the inline 11.5px notes are a class now). */
const important = [];
for (const r of rules) for (const d of r.decls) if (/!\s*important/i.test(d.value)) important.push({ r, d });
/* .fine-note replaced inline 11.5px notes: desktop must still resolve to 11.5px
   (the #dashBudget .text-muted rule outranks the bare class), the phone to the floor. */
want(`${R} .fine-note`, 'font-size', [], v => px(v) === 11.5, 'stay 11.5px on desktop');
want(`${R} #dashBudget td .text-muted.fine-note`, 'font-size', [], v => px(v) === 11.5, 'beat the #dashBudget .text-muted size on desktop');
want(`${R} #dashBudget td .text-muted.fine-note`, 'font-size', [PORTRAIT], v => /--st-micro/.test(v), 'rise to the type floor on phone');
ok(important.length === 0, `the stylesheet carries no !important, found ${important.length}: ${important.map(i => locate(i.d.line)).join(', ')}`);
ok(!/style: '[^']*font-size:11\.5px/.test(['assets','dashboard','debts','owed'].map(f => fs.readFileSync(path.join(ROOT, 'src/views/' + f + '.js'), 'utf8')).join('')), 'no view sets an inline 11.5px font size the phone floor cannot reach');

/* ---- 2. ITEM 1: THE TRANSACTIONS CARD IS NOT PADDED BY A TABLE RULE --------- */
const PAD = /^padding(-top|-bottom|-block(-start|-end)?)?$/;
for (const r of rules) {
  if (fileOf(r.line) === 'src/statement/phone.css') continue;
  const reaches = r.selectors.some(s => /#view-transactions/.test(s) && /tbody td\b[^ ]*$/.test(s) && !/#txTable/.test(s));
  if (!reaches || !r.decls.some(d => PAD.test(d.prop))) continue;
  const gated = r.context.some(c => /^@media \(min-width: 601px\)/.test(c));
  ok(gated, `${locate(r.line)}: "${r.prelude.slice(0, 70)}" pads Transactions cells outside @media (min-width: 601px). Its specificity beats the phone card's #txTable td { padding: 0 } and made every card 120px taller (354px, not ~234px)`);
}
want(`${R} #txTable tbody td`, 'padding', [PORTRAIT], v => /^0(px)?$/.test(v), 'zero the card cell padding');
ok(rules.some(r => r.context.join() === '@media (min-width: 601px)' && r.selectors.some(s => /#view-transactions \.table tbody td$/.test(s)) && r.decls.some(d => d.prop === 'padding-top' && d.value === '12px')),
  'the desktop row padding still exists, at 601px and up');

/* ---- 3. ITEM 2: THE TRANSACTIONS HEADER ------------------------------------- */
const TX = `${R} #view-transactions`;
want(`${TX} .tx-filters .form-select-sm`, 'flex', [PORTRAIT], v => /calc\(50% - 6px\)/.test(v), 'put the two selects on one line (flex 1 1 calc(50% - 6px))');
want(`${TX} .tx-filters .form-select-sm`, 'min-width', [PORTRAIT], v => /^0(px)?$/.test(v), 'let a select shrink (min-width 0)');
want(`${TX} .tx-actions`, 'flex-wrap', [PORTRAIT], v => v === 'nowrap', 'be a single rail (nowrap)');
want(`${TX} .tx-actions`, 'overflow-x', [PORTRAIT], v => v === 'auto', 'scroll sideways');
want(`${TX} .tx-actions`, '-webkit-overflow-scrolling', [PORTRAIT], v => v === 'touch', 'scroll with momentum on iOS 15');
want(`${TX} .tx-actions`, 'margin', [PORTRAIT], v => /^0 -14px$/.test(v), 'run to the card edges (-14px = the card-h side padding)');
want(`${TX} .tx-actions > *`, 'flex', [PORTRAIT], v => v === 'none', 'keep every rail child its own width');
want(`${TX} .tx-head`, 'flex-wrap', [PORTRAIT], v => v === 'nowrap',
  'not wrap: .card-h wraps, and in a wrapping COLUMN the line is as wide as the rail (991px), so the whole page scrolled sideways');
{
  const base = last(`${TX} .tx-filters .form-select-sm`, 'flex', [PORTRAIT]);
  const baseAfter = rules.filter(r => r.selectors.includes(`${TX} .tx-filters .form-select-sm`) && JSON.stringify(r.context) === '[]' && r.decls.some(d => d.prop === 'height'));
  ok(base && baseAfter.length && base.line > baseAfter[0].line, 'the phone select rule must come AFTER the transactions.css base rules (they tie on specificity)');
}

/* ---- 4. ITEM 3: NOTHING SMALLER THAN --st-micro ON A PHONE ------------------- */
/* The cascade on exact selector strings: the last font-size a selector gets in
   the base (or an enclosing phone-ish media), against the phone layer's. A size
   in em depends on its parent and is checked by name below instead. */
const CTX_OK = c => c.length === 0 || (c.length === 1 && /^@media \(max-width: (600|640|760|768|860|1100)px\)$/.test(c[0]));
const finals = new Map();
for (const r of rules) {
  if (!CTX_OK(r.context)) continue;
  for (const d of r.decls) {
    if (d.prop !== 'font-size') continue;
    const v = /var\(--st-small\)/.test(d.value) ? 13 : /var\(--st-chip\)/.test(d.value) ? 11.5 : /var\(--st-micro\)/.test(d.value) ? 12 : /var\(--st-(label|body|card-title)\)/.test(d.value) ? 14 : px(d.value);
    for (const s of r.selectors) finals.set(s, { v, line: r.line, d });
  }
}
const under = [];
for (const [s, o] of finals) if (o.v !== null && o.v < 12) under.push(`${locate(o.line)}  ${s}  (${o.d.value})`);
const ownerOf = l => /phone-tables\.css:\d+$/.test(l.split(/\s/)[0]);
const laneB = under.filter(u => ownerOf(u)), mine = under.filter(u => !ownerOf(u));
ok(mine.length === 0, `these selectors still end below the 12px floor in the phone layer (add them to the type-floor rule in phone.css):\n    ${mine.join('\n    ')}`);
for (const u of laneB) notes.push(`NOTE (Lane B's phone-tables.css, not enforced here): ${u}`);
/* The ones sized in em, which the scan above cannot judge. */
for (const s of ['.acct-caret', '.score-ring-num small', '.score-flow-in small', '.note-chip', '.ei-tick']) {
  want(`${R} ${s}`, 'font-size', [PORTRAIT], v => v === 'var(--st-micro)', 'be raised to var(--st-micro)');
}
want(`${R} #txTable tbody td[data-label]::before`, 'font-size', [PORTRAIT], v => v === 'var(--st-micro)', 'raise the cell labels (0.68rem = 10.9px) to the floor');
want(`${R} #budTable tbody td[data-label]::before`, 'font-size', [PORTRAIT], v => v === 'var(--st-micro)', 'raise the cell labels to the floor');
want(`${R} code`, 'font-size', [PORTRAIT], v => /^max\(0\.9em, var\(--st-micro\)\)$/.test(v), 'keep inline code at .9em but never under the floor');
/* The floor is what the other 600px rules in phone.css may not undercut. */
/* The landscape twins copy the portrait declarations one for one (a 0.68rem
   label among them) and are floored by the rule after them: judge that rule. */
for (const s of ['#txTable', '#budTable']) {
  const f = phoneRules.filter(r => r.context[0] === '@media (min-width: 601px)' && r.selectors.includes(`body.is-phone ${R} ${s} tbody td[data-label]::before`) && r.decls.some(d => d.prop === 'font-size'));
  ok(f.length && f[f.length - 1].decls.find(d => d.prop === 'font-size').value === 'var(--st-micro)', `the landscape ${s} cell labels end at var(--st-micro)`);
}
for (const r of phoneRules) for (const d of r.decls) {
  if (d.prop !== 'font-size' || r.context[0] === '@media (min-width: 601px)') continue;
  const v = px(d.value);
  ok(v === null ? /var\(--st-micro\)|max\(|calc\(/.test(d.value) || /^16px$/.test(d.value) : v >= 12, `phone.css line ${r.line}: font-size ${d.value} is under the 12px floor`);
}

/* ---- 5. ITEM 4: TAP TARGETS --------------------------------------------------- */
for (const sel of ['.menu-btn', '.topbar-icon-btn', '.topbar-avatar', '.drawer-close']) {
  want(`${R} ${sel}`, 'width', [PORTRAIT], v => px(v) >= 44, 'be at least 44px wide');
  want(`${R} ${sel}`, 'height', [PORTRAIT], v => px(v) >= 44, 'be at least 44px tall');
}
want(`${R} .header-period-pill .pnav-btn`, 'width', [PORTRAIT], v => px(v) >= 44, 'be 44px wide');
want(`${R} .header-period-pill .pnav-btn`, 'height', [PORTRAIT], v => px(v) >= 44, 'be 44px tall');
want(`${R} .header-period-pill .pnav-btn`, 'margin-block', [PORTRAIT], v => px(v) === -8, 'hand the extra 16px back so the pill keeps its 52px height');
for (const [sel, prop] of [['.btn-ghost-sm', 'min-width'], ['.chart-range-btn', 'min-width'], ['.donut-legend .dl-note', 'width'], ['.donut-legend .dl-note', 'height'],
  ['.env-collapse', 'width'], ['.env-collapse', 'height'], ['.plan-del-ico', 'width'], ['.plan-del-ico', 'height'], ['.btn-sm', 'min-height'],
  ['.src2-del', 'min-width'], ['.bud-act', 'min-width'], ['.bud-act', 'min-height'], ['.tx-whole', 'min-height'], ['.env-slider', 'height'], ['.loan-range', 'min-height']]) {
  want(`${R} ${sel}`, prop, [PORTRAIT], v => px(v) >= 44, `be at least 44px (${prop})`);
}
want(`${R} .owed-acts > button`, 'min-width', [PORTRAIT], v => px(v) >= 44, 'be at least 44px wide');
want(`${R} input[type='checkbox']`, 'width', [PORTRAIT], v => px(v) >= 44, 'be at least 44px wide');
want(`${R} label input[type='checkbox']`, 'width', [PORTRAIT], v => px(v) >= 20 && px(v) < 44, 'draw at a normal size inside its 44px label');
want(`${R} .tx-whole`, 'min-height', [PORTRAIT], v => px(v) >= 44, 'keep the labelled tick a 44px target');
/* the slider's visible track stays 8px: height less both paddings. */
{
  const h = last(`${R} .env-slider`, 'height', [PORTRAIT]), pb = last(`${R} .env-slider`, 'padding-block', [PORTRAIT]);
  ok(h && pb && px(h.value) - 2 * px(pb.value) === 8, `the .env-slider track stays 8px inside its 44px hit area, found ${h && h.value} / ${pb && pb.value}`);
}
{
  const ov = rules.find(r => JSON.stringify(r.context) === JSON.stringify([PORTRAIT]) && r.selectors.includes(`${R} button:not(.mod-loading)::after`));
  ok(ov && ov.decls.some(d => d.prop === 'width' && /max\(100%, 44px\)/.test(d.value)) && ov.decls.some(d => d.prop === 'height' && /max\(100%, 44px\)/.test(d.value)),
    'the 44px ::after hit-area overlay exists for phone-narrow panes (the visible 24px ticks, chips and pills borrow it)');
  const keep = rules.find(r => JSON.stringify(r.context) === JSON.stringify([PORTRAIT]) && r.selectors.some(s => /:where\(button:not\(\.mod-loading\)\)/.test(s)));
  ok(keep, 'the overlay positions through :where(), so a self-positioned button (the score ring centre) keeps its own position');
}

/* ---- 6. ITEM 5: FIELDS DO NOT ZOOM THE PAGE ---------------------------------- */
const COARSE = ['@media (pointer: coarse)'];
for (const sel of ['.form-control', '.form-select', '.category-select', '.acct-search input', '.src-name-input', 'textarea']) {
  const s = sel === 'textarea' ? `${R} textarea` : `${R} ${sel}`;
  want(s, 'font-size', COARSE, v => px(v) >= 16, 'be at least 16px on a touch screen (iOS zooms the page on focus below it)');
  want(s, 'min-height', COARSE, v => px(v) >= 44, 'be at least 44px tall on a touch screen');
}
want(`${R} .table .form-control`, 'font-size', COARSE, v => px(v) >= 16, 'stay 16px inside a table too (15px zooms exactly like 12px)');
want(`${R} .table .form-control`, 'min-height', COARSE, v => px(v) >= 36, 'be at least 36px inside a table row');
want(`${TX} .table tbody td:nth-child(7) input`, 'font-size', COARSE, v => px(v) >= 16, 'beat the lane rule that set the note field to 14px');
want(`${TX} .tx-filters .form-select-sm`, 'font-size', COARSE, v => px(v) >= 16, 'beat the lane rule that set the filters to 15px');
{
  const c = last(`${R} .form-control`, 'font-size', COARSE), b = last(`${R} .form-control`, 'font-size', []);
  ok(c && (!b || c.line > b.line), 'the coarse field rule comes after the base rules');
}

/* ---- 7. ITEM 6: GUTTERS --------------------------------------------------------- */
for (const s of ['.mini-grid:not(#planEnvelopes)', '.kpi-caveat', '.loan-tabs', '.acct-strip', '.tx-undo', '.bud-shape-note', '.acct-deck', '.plan-free']) {
  want(`${R} ${s}`, 'margin-left', [PORTRAIT], v => px(v) === 14, 'inset 14px (the cards\' own gutter)');
  want(`${R} ${s}`, 'margin-right', [PORTRAIT], v => px(v) === 14, 'inset 14px (the cards\' own gutter)');
}

/* ---- 8. ITEM 7, 10: DASHBOARD ----------------------------------------------------- */
want(`${R} #dashBudget thead th:nth-child(4)`, 'display', [PORTRAIT], v => v === 'none', 'hide the bar column heading');
want(`${R} #dashBudget tbody td:nth-child(4)`, 'display', [PORTRAIT], v => v === 'none', 'hide the bar column cells');
{
  /* A colspan row has ONE cell, at position 1: the selector cannot reach it. */
  const sel = `${R} #dashBudget tbody td:nth-child(4)`;
  ok(!rules.some(r => r.selectors.some(s => /#dashBudget/.test(s) && /td(\[colspan\]|:first-child|:nth-child\(1\))/.test(s)) && r.decls.some(d => d.prop === 'display' && d.value === 'none')),
    `${sel} must not be written so a colspan row (group bar, empty line) could be hidden`);
}
want(`${R} .donut-legend .dl-delta`, 'width', [PORTRAIT], v => v === 'auto', 'size to its content (it was a fixed 84px with nowrap, and overflowed on 7-digit values)');
want(`${R} #heroCard .hero-num`, 'white-space', [PORTRAIT], v => v === 'nowrap', 'never break inside a number');

/* ---- 9. ITEM 8: THE CLOSED DRAWER ------------------------------------------------- */
want(`${R} .app-drawer:not(.open)`, 'box-shadow', [PORTRAIT], v => v === 'none', 'paint no shadow while closed');
ok(rules.some(r => r.selectors.includes(`${R} .app-drawer`) && r.decls.some(d => d.prop === 'box-shadow' && d.value !== 'none')),
  'the base drawer still has its shadow, for the open state (this fix is a :not(.open) override, not a deletion)');

/* ---- 10. ITEM 9: TITLES ------------------------------------------------------------ */
want(R, '--st-title', [PORTRAIT], v => { const n = px(v); return n >= 32 && n <= 34; }, 'step the page title down to 32-34px');
want(`${R} .financial-period-banner-title`, 'overflow-wrap', [PORTRAIT], v => v === 'break-word', 'break a word that is wider than the column instead of being clipped');

/* ---- 11. ITEM 11: CONTRAST (tokens, no hex) --------------------------------------- */
want(`${R} .bud-total-left .bud-total-n`, 'color', [PORTRAIT], v => v === 'var(--text-muted)', 'use --text-muted (3.77:1 -> 7.1:1 on the dark tile)');
want(`${R}.bud-dark .ei-tick.done`, 'color', [PORTRAIT], v => v === 'var(--ink-on-accent)', 'use --ink-on-accent (white on the dark emerald was 2.54:1)');
want(`${R}:not(.bud-dark) .kind`, 'color', [PORTRAIT], v => v === 'var(--text-muted)', 'use --text-muted (the light-theme accent on a tint was 3.3:1)');

/* ---- 12. ITEM 12: THE BUDGET TOTALS BAND --------------------------------------------- */
want(`${R} .bud-totals`, 'grid-template-columns', [PORTRAIT], v => /repeat\(2, minmax\(0, 1fr\)\)/.test(v), 'be two columns on a phone');
want(`${R} .bud-total-left`, 'grid-column', [PORTRAIT], v => v === '1 / -1', 'give the statement figure the full width');
{
  const t = last(`${R} .bud-totals`, 'grid-template-columns', [PORTRAIT]), b = last(`${R} .bud-totals`, 'grid-template-columns', ['@media (max-width: 640px)']);
  ok(t && b && t.line > b.line, 'the phone totals grid comes after budget.css\'s 640px single column (equal specificity, order decides)');
}

{
  const RAIL = `${R} #view-budgets .card-h > .row`;
  want(RAIL, 'flex-wrap', [PORTRAIT], v => v === 'nowrap', 'make the Budget header actions one rail');
  want(RAIL, 'overflow-x', [PORTRAIT], v => v === 'auto', 'scroll the Budget header rail sideways');
  want(`${RAIL} > #budSave`, 'order', [PORTRAIT], v => v === '-1', 'put Save first on the rail');
}

/* ---- 13. THE LANDSCAPE TWIN OF THE STACKED CARDS --------------------------------------
   Every #txTable / #budTable rule under 600px (src/styles.css and
   transactions.css) has a twin in phone.css at min-width 601px keyed on
   body.is-phone, declaration for declaration. Change a portrait rule and the
   twin has to follow, or a phone on its side gets a different table. */
{
  const key = r => r.decls.map(d => `${d.prop}:${d.value}`).join(';');
  const src = rules.filter(r => fileOf(r.line) !== 'src/statement/phone.css' && fileOf(r.line) !== 'src/statement/phone-tables.css'
    && r.selectors.some(s => /#txTable|#budTable/.test(s)) && r.context[0] === PORTRAIT);
  const twins = phoneRules.filter(r => r.context[0] === LANDSCAPE[0]);
  ok(src.length >= 40, `expected the stacked-card rules under 600px, found ${src.length}`);
  for (const r of src) {
    const want_ = r.selectors.map(s => 'body.is-phone ' + s).join(' | ');
    const hit = twins.find(t => t.selectors.join(' | ') === want_ && key(t) === key(r) && JSON.stringify(t.context.slice(1)) === JSON.stringify(r.context.slice(1)));
    ok(hit, `${locate(r.line)}: "${r.prelude.slice(0, 80)}" has no landscape twin in phone.css (body.is-phone, @media (min-width: 601px)) with the same declarations`);
  }
}

/* ---- 14. iOS 15 floor for what this file added ---------------------------------------- */
{
  const t = phoneSrc.text.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/color-mix\(/.test(t) && !/:focus-visible/.test(t) && !/\(\?<[=!]/.test(t) && !/:has\(/.test(t) && !/@container/.test(t),
    'no color-mix, :focus-visible, :has() or container query in phone.css');
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(t), 'no hex colour in phone.css (the palette is tokens only)');
  ok(!/column-gap/.test(t) && !/clip-path/.test(t), 'no column-gap and no clip-path (the scorecard lints both)');
}

for (const n of notes) console.log(n);
if (failures.length) {
  console.log(`FAIL — phone-375: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — phone-375: ${checks} checks (Transactions card padding scoped, header rail, 12px floor, 44px targets, 16px fields, gutters, ` +
  'dashboard column, closed drawer, titles, contrast, totals band, landscape twins, no !important).');
