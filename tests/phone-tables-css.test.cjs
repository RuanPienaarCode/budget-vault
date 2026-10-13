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

if (failures.length) {
  console.log(`FAIL — phone-tables-css: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — phone-tables-css: ${relayouts} card selectors all behind [role='table'], ${portrait.length} rules identical in portrait and landscape copies, desktop carries only input widths, chart text ${units} units (${checks} checks).`);
