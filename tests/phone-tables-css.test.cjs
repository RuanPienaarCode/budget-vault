'use strict';
/* The phone-table stylesheet keeps its promises (src/statement/phone-tables.css).

   Debts, Owed Money, Assets, Services, Tax and Import review stack each row
   into a card under 600px. Three things about that stylesheet cannot be seen
   from a desktop and each has cost a release somewhere else in this repo:

     1. THE VOICEOVER GATE. A grid or block <table> is no longer a table to iOS
        VoiceOver unless its roles were stamped (dom.js tableCells), so no rule
        that takes one of these tables out of table layout may apply without
        [role='table'] in its selector — css-phone-layout pins the same rule for
        Accounts. The gate is checked here for all eight tables.
     2. THE PHONE FENCE. Card rules apply under (max-width: 600px) or under
        `.is-phone` (a landscape iPhone is wider than 600px), and nowhere else:
        a desktop is not allowed to change.
     3. THE TWO COPIES. The card rules are written twice — once per fence — and
        must stay the same rules. A fix made to one and not the other is a
        landscape-only or portrait-only bug that no desktop run will show. This
        compares them, rule for rule, with the fence and the prefix removed.

   Plus the chart text: CSS font-size beats the SVG attribute, so the 4.5px axis
   labels are fixed in the stylesheet, in user units — and chart.js's
   PHONE_TEXT, which the label thinning is sized from, must be the same number.

   The stylesheet's own header line is the one-line "Statement lane:" comment
   that css-sources requires.

     node tests/phone-tables-css.test.cjs */
const fs = require('fs');
const path = require('path');
const { readRules, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

const REL = 'src/statement/phone-tables.css';
const src = fs.readFileSync(path.join(__dirname, '..', REL), 'utf8');
ok(/^\/\* Statement lane: [^\n]*\*\/\n/.test(src), 'the stylesheet opens with the one-line "Statement lane:" header comment');
ok(!/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'no hex colours — tokens only');
ok(!/column-gap|!important|innerHTML/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'no column-gap and no !important (the scorecard lint reads the first; the house avoids the second)');

const TABLES = ['debtTable', 'owedTable', 'assetTable', 'svcTable', 'taxStepsTable', 'taxFiguresTable', 'taxDocsTable', 'impTable'];
const PHONE = '@media (max-width: 600px)';
const rules = readRules().filter(r => r.file === 'styles.css' && locate(r.line).startsWith(REL));
ok(rules.length > 50, `the reader should find the file's rules, found ${rules.length}`);

const mentionsTable = s => TABLES.some(t => s.includes(`#${t}`));
const GATE = /\[role=(['"])table\1\]/;
const RELAYOUT = /^(grid|block|flex|inline-flex|contents|none)$/;

/* ---- 1. the gate ---- */
let relayouts = 0;
for (const r of rules) {
  const touchesDisplay = r.decls.some(d => d.prop === 'display' || d.prop === 'grid-template-columns' || d.prop === 'position');
  for (const s of r.selectors.filter(mentionsTable)) {
    // the desktop input widths (a width / min-width on `td:nth-child(n) > input`) are not a relayout
    if (!r.decls.some(d => ['display', 'grid-column', 'grid-row', 'grid-template-columns', 'justify-self', 'align-self'].includes(d.prop)) && !touchesDisplay) continue;
    relayouts++;
    ok(GATE.test(s), `${locate(r.line)}: "${s}" re-lays out a phone-card table without the [role='table'] gate`);
  }
}
ok(relayouts > 40, `the gate check saw the card rules (${relayouts} selectors)`);
// the card itself exists: a gated tr becomes a grid
ok(rules.some(r => r.selectors.some(s => GATE.test(s) && /> tr$/.test(s)) && r.decls.some(d => d.prop === 'display' && d.value === 'grid')),
  'a [role=table] row becomes a grid');

/* ---- 2. the fence ---- */
const isPhoneCtx = r => r.context.length > 0 && r.context[0] === PHONE;
const isLandscapeSel = s => s.startsWith('.is-phone .budget-app-root');
for (const r of rules) {
  const cardy = r.selectors.some(s => mentionsTable(s) && GATE.test(s)) || r.selectors.some(s => /\.tbl-tick|\.cat-cell/.test(s) && GATE.test(s));
  if (!cardy) continue;
  const phone = isPhoneCtx(r) && r.selectors.every(s => s.startsWith('.budget-app-root'));
  const landscape = r.context.every(c => !c.startsWith('@media (max-width') && !c.startsWith('@media (min-width')) && r.selectors.every(isLandscapeSel);
  ok(phone || landscape, `${locate(r.line)}: a card rule must sit under ${PHONE} or be prefixed .is-phone, found [${r.context.join(' > ')}] ${r.selectors[0]}`);
}

/* ---- 3. the two copies agree ---- */
const strip = r => ({
  ctx: r.context.filter(c => c !== PHONE).join(' > '),
  sel: r.selectors.map(s => s.replace(/^\.is-phone /, '')).join(' , '),
  decls: r.decls.map(d => `${d.prop}:${d.value}`).join(';'),
});
const isCard = r => r.selectors.some(s => GATE.test(s));
const portrait = rules.filter(r => isPhoneCtx(r) && isCard(r)).map(strip);
const landscape = rules.filter(r => !isPhoneCtx(r) && r.selectors.every(isLandscapeSel) && isCard(r)).map(strip);
ok(portrait.length > 40 && portrait.length === landscape.length, `the two copies have the same number of rules (${portrait.length} / ${landscape.length})`);
portrait.forEach((p, i) => {
  const l = landscape[i];
  ok(l && p.ctx === l.ctx && p.sel === l.sel && p.decls === l.decls,
    `copy ${i + 1} differs: portrait "${p.sel.slice(0, 90)}" [${p.ctx}] vs landscape "${l && l.sel.slice(0, 90)}" [${l && l.ctx}]`);
});

/* ---- 4. nothing else is fenced wrongly: desktop gets only the width rules ---- */
const unfenced = rules.filter(r => r.context.length === 0 && !r.selectors.every(isLandscapeSel));
for (const r of unfenced) {
  const props = r.decls.map(d => d.prop);
  ok(props.every(p => ['width', 'min-width', 'display'].includes(p)) && r.selectors.every(s => /td:nth-child\(\d\) > input$|\.tbl-tick$/.test(s)),
    `${locate(r.line)}: an unfenced rule may only carry a desktop input width or the inert .tbl-tick, found ${r.selectors[0]} { ${props.join(', ')} }`);
}
const tick = rules.find(r => r.context.length === 0 && r.selectors.includes('.budget-app-root .tbl-tick'));
ok(tick && tick.decls.length === 1 && tick.decls[0].prop === 'display' && tick.decls[0].value === 'contents',
  'on a desktop the .tbl-tick label is display:contents (it adds no box)');

/* ---- 5. 44px controls on a coarse pointer, 16px so iOS does not zoom ---- */
const coarse = rules.filter(r => r.context.includes('@media (pointer: coarse)') && isPhoneCtx(r));
const field = coarse.find(r => r.selectors.some(s => /input:not\(\[type='checkbox'\]\)$/.test(s)));
ok(field && field.decls.some(d => d.prop === 'min-height' && d.value === '44px') && field.decls.some(d => d.prop === 'font-size' && d.value === '16px'),
  'inputs and selects are 44px tall and 16px on a coarse pointer');
for (const cls of ['status-pill', 'note-chip', 'caveat-chip-btn', 'svc-next-hint']) {
  ok(coarse.some(r => r.selectors.some(s => s.endsWith(`.${cls}`)) && r.decls.some(d => d.prop === 'min-height' && d.value === '44px')),
    `.${cls} is 44px tall inside a phone card on a coarse pointer`);
}

/* ---- 6. chart text ---- */
const chartSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'chart.js'), 'utf8');
const units = Number((/const PHONE_TEXT = (\d+)/.exec(chartSrc) || [])[1]);
const chartRule = rules.find(r => isPhoneCtx(r) && r.selectors.some(s => s.endsWith('.trend-svg-wrap svg text')));
ok(chartRule && chartRule.selectors.some(s => s.endsWith('.stack-wrap svg text')), 'the phone block lifts text in both chart wrappers');
const fsz = chartRule && chartRule.decls.find(d => d.prop === 'font-size');
ok(fsz && fsz.value === `${units}px`, `the CSS chart text (${fsz && fsz.value}) is chart.js's PHONE_TEXT (${units}) — the label thinning is sized from it`);
ok(units * 0.347 >= 11, `${units} user units is at least 11px on a 375px phone (viewBox 1000 drawn at ~347px)`);
ok(!rules.some(r => isPhoneCtx(r) && r.selectors.some(s => /svg text/.test(s)) && r.decls.some(d => d.prop === 'font-size' && parseFloat(d.value) < 28 && !/trend|donut/.test(r.selectors[0]))),
  'no phone chart rule sets a smaller size on the stack charts');

/* ---- 6b. FOLLOW-UP: landscape chart text. The two Savings charts (.stack-wrap)
        were left at their SVG attribute sizes sideways: 8.1px headings, 7.5px
        month labels, 5.9px note at 667x375. They get PHONE_TEXT_WIDE under .is-phone. ---- */
{
  const wide = Number((/const PHONE_TEXT_WIDE = (\d+)/.exec(chartSrc) || [])[1]);
  const L = r => r.context.length === 1 && r.context[0] === '@media (min-width: 601px)';
  const rule = rules.find(r => L(r) && r.selectors.includes('.is-phone .budget-app-root .stack-wrap svg text'));
  ok(rule, 'a landscape-phone rule lifts the Savings charts\' text (.is-phone .stack-wrap svg text, min-width 601px)');
  const f = rule && rule.decls.find(d => d.prop === 'font-size');
  ok(f && f.value === `${wide}px`, `the landscape chart text (${f && f.value}) is chart.js's PHONE_TEXT_WIDE (${wide})`);
  // the Savings SVGs are drawn into a 1000-unit viewBox and come out about 0.625 of it at 667px (625px wide); 0.6 is the margin
  ok(wide * 0.6 >= 11, `${wide} user units is at least 11px at the 0.6 scale a landscape phone draws these charts`);
  ok(rules.some(r => L(r) && r.selectors.includes('.is-phone .budget-app-root .stack-wrap svg text[data-fig]')),
    'the net-worth bar totals keep their stronger fill in landscape');
  ok(!rules.some(r => r.context.length === 0 && r.selectors.some(s => /svg text/.test(s))),
    'no chart-text rule applies without a phone fence (a desktop chart is not touched)');
}

/* ---- 7. FOLLOW-UP: the Tax steps card is two lines, not five. It was a label over
        every field and one field per line: 15 cards of ~250px at 375px. Pinned as the
        grid it must stay: at most two rows, no two cells on top of each other, the
        status pill and the remove button on the first row with the name, the two fields
        on the second. (The two copies themselves are held identical by section 3.) ---- */
{
  const STEPS = "#taxStepsTable[role='table']";
  const portraitRules = rules.filter(r => isPhoneCtx(r));
  const sel = tail => `.budget-app-root ${STEPS} > tbody > tr${tail}`;
  const decl = (tail, prop) => {
    const r = [...portraitRules].reverse().find(x => x.selectors.includes(sel(tail)) && x.decls.some(d => d.prop === prop));
    return r && r.decls.find(d => d.prop === prop).value;
  };
  const tracks = /^repeat\((\d+), minmax\(0, 1fr\)\)$/.exec(decl('', 'grid-template-columns') || '');
  ok(tracks, 'the Tax steps card declares an N-track equal grid');
  const N = tracks ? Number(tracks[1]) : 0;
  const place = {};
  for (let i = 1; i <= 5; i++) {
    const col = /^(\d+) \/ span (\d+)$/.exec(decl(` > td:nth-child(${i})`, 'grid-column') || '');
    const row = Number(decl(` > td:nth-child(${i})`, 'grid-row'));
    ok(col && row, `cell ${i} of a Tax step is placed on a row and a column span`);
    if (col && row) place[i] = { row, from: Number(col[1]), to: Number(col[1]) + Number(col[2]) - 1 };
  }
  const cells = Object.values(place);
  ok(cells.length === 5 && cells.every(c => c.row === 1 || c.row === 2), 'a Tax step card is at most two rows (every cell sits on row 1 or 2)');
  ok(cells.every(c => c.from >= 1 && c.to <= N), `every cell sits inside the ${N} tracks`);
  for (let a = 1; a <= 5; a++) for (let b = a + 1; b <= 5; b++) {
    const A = place[a], B = place[b];
    if (A && B && A.row === B.row) ok(A.to < B.from || B.to < A.from, `Tax step cells ${a} and ${b} do not overlap on row ${A.row}`);
  }
  // the first row: tick (status), name, remove. the second: due and notes.
  ok(place[2] && place[1] && place[5] && [1, 2, 5].every(i => place[i].row === 1), 'the name, status pill and remove button share the first row');
  ok(place[3] && place[4] && place[3].row === 2 && place[4].row === 2, 'the due date and the notes field share the second row');
  // a pill ("To do", ~76px) needs three of twelve tracks at 375px; the remove button two (44px)
  ok(place[2] && place[2].to - place[2].from + 1 >= 3, 'the status pill gets at least three tracks (~83px at 375px)');
  ok(place[5] && place[5].to - place[5].from + 1 >= 2, 'the remove button gets at least two tracks (>= 44px at 375px)');
  const pad = decl('', 'padding');
  const padY = pad && /^([\d.]+)rem /.exec(pad);
  ok(padY && Number(padY[1]) <= 0.6, `the card's vertical padding is compact (${pad})`);
  // reading and keyboard order is the DOM's; no cell is reordered with `order`
  ok(!portraitRules.some(r => r.selectors.some(s => s.includes('#taxStepsTable')) && r.decls.some(d => d.prop === 'order')),
    'no Tax step cell is reordered with `order` — the keyboard order stays step, status, due, notes, remove');
  // the two fields keep their column name inline, in front of the control
  for (const i of [3, 4]) {
    ok(decl(` > td:nth-child(${i})`, 'display') === 'flex', `Tax step cell ${i} lays its inline column name and its field out as a flex line`);
  }
  // views/tax.js was not asked to change behaviour: the five cells, in order, and the write paths
  const taxSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'tax.js'), 'utf8');
  const rs = /function renderSteps\(t, focusStep\) \{[\s\S]*?\n  \}\n/.exec(taxSrc);
  ok(rs && /tableCells\(tbl, \['Step', 'Status', 'Due', 'Notes', null\]\)/.test(rs[0]), 'Tax steps still stamps Step | Status | Due | Notes | (actions) in that column order');
  ok(rs && /s\.due = v/.test(rs[0]) && /s\.notes = e\.target\.value/.test(rs[0]) && /s\.status = STEP_CYCLE\[s\.status\]/.test(rs[0]) && /t\.steps\.splice/.test(rs[0]),
    'and every write path (status, due, notes, remove) is still wired to the step it belongs to');
}

if (failures.length) {
  console.log(`FAIL — phone-tables-css: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — phone-tables-css: ${relayouts} card selectors all behind [role='table'], ${portrait.length} rules identical in portrait and landscape copies, desktop carries only input widths, chart text ${units} units (${checks} checks).`);
