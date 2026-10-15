'use strict';
/* A PHONE HELD SIDEWAYS GETS THE TYPE FLOOR, THE 44px TARGETS AND THE CONTRAST FIXES (audit L5-03).

   Obsidian puts `body.is-phone` on the body whatever the orientation, so an
   iPhone on its side (667-932px wide) is still a phone. src/statement/phone.css
   wrapped its type floor, its 44px targets, its dashboard fit and its contrast
   fixes (sections 1, 4, 6 and 7) in `@media (max-width: 600px)`, so a landscape
   phone got the DESKTOP sizes. Measured at 667x375 against Obsidian 1.14.4's
   real app.css: 53 text nodes under 12px (`.score-ring-num small` 8.8px,
   `.acct-caret` 9.6px, `.ei-tick` 10px, `.env-share` 10.5px), `input.env-slider`
   24px, `input.loan-range` 28px, the Import <summary> 20px tall. (The coarse-
   pointer ::after overlay and section 9's 16px fields already reached a phone
   on its side; the stacked Transactions/Budget cards already had their twins,
   section 10. These four sections did not.)

   Each portrait rule of those sections now has a body.is-phone twin at
   `@media (min-width: 601px)`, declaration for declaration (a prefix and
   nothing else), the way section 10's table twins are held to it by
   tests/phone-375.test.cjs. Change a portrait rule and the twin has to follow.

   Exceptions, each stated and each checked below:
     - the cell-label size rules and the Excl. tick rules already have their
       twins in section 10;
     - the ::after hit-area overlay is the (pointer: coarse) rule in
       src/styles.css, which already applies sideways;
     - the top bar's padding/gap are fit tweaks for a 375px bar (sideways has
       room), not floors or targets;
     - the Dashboard table-fit rules (hide the bar column, squeeze padding) only
       matter on the narrowest landscape phone: the table is 645px in a 625px
       scroller at 667px wide and fits from 736px up (measured), so they twin
       at 601-700px only, and a 932px phone keeps its bar column.

   Negative controls, each run by hand: delete one twin; change one twin's
   declaration; add a portrait rule to section 4 without a twin; widen the
   dashboard twin to every landscape width. Each fails here.

     node tests/phone-landscape-floor-and-targets.test.cjs */

const { readRules, readRulesOf, sources, locate } = require('./helpers/css-sources.cjs');
let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

const PORTRAIT = '@media (max-width: 600px)';
const LAND = '@media (min-width: 601px)';
const LAND_NARROW = '@media (min-width: 601px) and (max-width: 700px)';
const phoneSrc = sources().find(s => s.rel === 'src/statement/phone.css');
const phone = readRulesOf(phoneSrc.text, 'phone.css');
const lines = phoneSrc.text.split('\n');
const lineOf = s => { const i = lines.findIndex(l => l.includes(s)); if (i < 0) throw new Error('phone.css lost its section header: ' + s); return i + 1; };
const S = { s1: lineOf('1. TYPE FLOOR'), s2: lineOf('2. PAGE TITLES'), s4: lineOf('4. TAP TARGETS'), s5: lineOf('5. SIDE GUTTERS'), s6: lineOf('6. DASHBOARD'), s7: lineOf('7. CONTRAST'), s8: lineOf('8. BUDGET: THE TOTALS BAND') };
const SECTIONS = [['1 type floor', S.s1, S.s2], ['4 tap targets', S.s4, S.s5], ['6 dashboard', S.s6, S.s7], ['7 contrast', S.s7, S.s8]];

const key = r => r.decls.map(d => `${d.prop}:${d.value}`).join(';');
const ctxIs = (r, c) => r.context.length === 1 && r.context[0] === c;
const landscape = phone.filter(r => r.context.length >= 1 && r.context[0] === LAND || ctxIs(r, LAND_NARROW));

/* The stated exceptions. */
const EXEMPT = [
  { why: 'cell labels: twinned in section 10 and floored there', test: r => r.selectors.every(s => /data-label\]::before$/.test(s)) },
  { why: 'the Excl. tick: twinned in section 10', test: r => r.selectors.some(s => /tbl-tick/.test(s)) },
  { why: 'the ::after overlay is the (pointer: coarse) rule in src/styles.css', test: r => r.selectors.some(s => /button:not\(\.mod-loading\)/.test(s)) },
  { why: 'the top bar padding/gap are fit tweaks for a 375px bar', test: r => r.selectors.every(s => /\.topbar( \.ml-auto)?$/.test(s)) },
];
{
  const overlay = readRules().find(r => r.context.join() === '@media (pointer: coarse)' && r.selectors.includes('.budget-app-root button:not(.mod-loading)::after'));
  ok(overlay, 'the exemption for the ::after overlay holds: src/styles.css carries it under (pointer: coarse), which a phone on its side matches');
  ok(landscape.some(r => r.selectors.includes('body.is-phone .budget-app-root #txTable tbody td[data-label]::before') && r.decls.some(d => d.prop === 'font-size' && d.value === 'var(--st-micro)')),
    'the exemption for the cell labels holds: section 10 floors them sideways');
  ok(landscape.some(r => r.selectors.some(s => /tbl-tick/.test(s))), 'the exemption for the Excl. tick holds: section 10 twins it');
}
const DASH_FIT = r => r.selectors.some(s => /#dashBudget\b/.test(s)) && !r.selectors.some(s => /\.fine-note/.test(s));

let counted = 0;
for (const [name, from, to] of SECTIONS) {
  const portrait = phone.filter(r => ctxIs(r, PORTRAIT) && r.line > from && r.line < to);
  ok(portrait.length >= 3, `section ${name} should hold portrait rules, found ${portrait.length}`);
  for (const r of portrait) {
    const ex = EXEMPT.find(e => e.test(r));
    if (ex) continue;
    counted++;
    const want = r.selectors.map(s => 'body.is-phone ' + s).join(' | ');
    const ctx = DASH_FIT(r) ? LAND_NARROW : LAND;
    const twin = phone.find(t => ctxIs(t, ctx) && t.selectors.join(' | ') === want);
    ok(twin, `section ${name}, phone.css:${r.line}: "${r.prelude.slice(0, 70)}" has no twin in \`${ctx}\` keyed on body.is-phone`);
    if (twin) ok(key(twin) === key(r), `section ${name}, phone.css:${r.line}: the twin at phone.css:${twin.line} says "${key(twin)}" but the portrait rule says "${key(r)}"`);
  }
}
ok(counted >= 30, `expected to hold 30+ portrait rules to a twin, held ${counted}`);

/* The Dashboard fit rules must NOT reach a 932px phone. */
ok(!landscape.some(r => ctxIs(r, LAND) && DASH_FIT(r)), 'the Dashboard table-fit twins are only in the 601-700px block (a wide landscape phone keeps its bar column)');

/* Nothing sideways reaches a desktop window: every selector is body.is-phone. */
for (const r of landscape) ok(r.selectors.every(s => s.startsWith('body.is-phone ')), `phone.css:${r.line}: a landscape rule must be keyed on body.is-phone, found "${r.prelude.slice(0, 70)}"`);

/* The sliders and the <summary> rows are what the measurement named. */
{
  const find = sel => landscape.find(r => r.selectors.includes(sel));
  const sl = find('body.is-phone .budget-app-root .env-slider');
  ok(sl && sl.selectors.includes('body.is-phone .budget-app-root .loan-range') && sl.decls.some(d => d.prop === 'height' && d.value === '44px') && sl.decls.some(d => d.prop === 'padding-block' && d.value === '18px'),
    'both sliders get the 44px hit area around the 8px track sideways');
  const sm = find('body.is-phone .budget-app-root .import-help summary');
  ok(sm && sm.decls.some(d => d.prop === 'padding-block' && d.value === '13px'), 'the Import / loan / left <summary> toggles get their 13px block padding sideways');
  const floor = find('body.is-phone .budget-app-root .ei-tick');
  ok(floor && floor.decls.some(d => d.prop === 'font-size' && d.value === 'var(--st-micro)'), 'the type-floor list (.ei-tick, .acct-caret, .env-share ...) reaches a phone on its side');
  for (const c of ['.acct-caret', '.score-ring-num small', '.env-share']) ok(floor && floor.selectors.includes(`body.is-phone .budget-app-root ${c}`), `${c} is in the sideways type floor`);
}

if (failures.length) {
  console.log(`FAIL — phone-landscape-floor-and-targets: ${failures.length} of ${checks} checks\n  - ${failures.slice(0, 40).join('\n  - ')}${failures.length > 40 ? `\n  ... and ${failures.length - 40} more` : ''}`);
  process.exit(1);
}
console.log(`PASS — phone-landscape-floor-and-targets: ${checks} checks (${counted} portrait rules of sections 1, 4, 6, 7 each have a body.is-phone twin at 601px+; dashboard fit at 601-700px only).`);
