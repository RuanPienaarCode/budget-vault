'use strict';
/* THE STATEMENT-TYPE FIX ROUND: SIX CSS INVARIANTS THAT LOOK LIKE CRUFT.

   Each of these was a defect found by an iOS-15 review or a browser run of the
   October 2026 restyle, and each fix is one declaration that a tidy-up could
   delete without any other suite noticing:

     1. AN AMOUNT'S SIGN NEVER PARTS FROM ITS FIGURE. Since the 20 Oct 2026
        audit (D2-04) the sign is the cell's own text, a span ahead of the
        figure's inline-block ("−" | "R 50,00"), not a "+" drawn by a ::before.
        A line may break between two boxes, so the cell must not wrap, or a
        narrow column prints the sign on one line and the figure on the next.
        (It used to pin the absolutely positioned "+" to its cell; that rule
        is gone, and a sign drawn by the sheet as well as written in the text
        would print twice — so that is checked for too.)
     2. A FIELD OR BUTTON KEEPS ITS FOCUS / HOVER BORDER. The firmer color-mix()
        edge on the Transactions controls out-ranks .form-control:focus and
        .btn-ghost:hover (src/styles.css), so it must be switched off in exactly
        those states.
     3. A FIGURE NEVER WRAPS MID-NUMBER, and a five-up KPI row steps its size
        down instead.
     4. A BUDGET FIGURE OF SEVEN DIGITS OR MORE STEPS DOWN (.is-long), and the
        view that sets the class is the one that counts the digits.
     5. SUCCESS-COLOURED TEXT USES THE PRIMARY INK ON THE LIGHT THEME ONLY. The
        raw success green is 1.9-2.3:1 on a pale tile; on a dark surface it is
        8:1 and stays.
     6. THE DASHBOARD LEGEND ASKS FOR ROOM FOR ITS NAME COLUMN.

   Every check is a function of the parsed stylesheet, and each is run twice: on
   the real sheet (must find nothing) and on a copy with the invariant broken
   (must find something) — a guard that cannot fail is not a guard.

     node tests/statement-fix-round.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { assembled, readRulesOf } = require('./helpers/css-sources.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const rulesOf = text => readRulesOf(text, 'styles.css');
const decl = (r, prop) => r.decls.find(d => d.prop === prop);
const inCtx = (r, frag) => r.context.some(c => c.includes(frag));

/* each check returns a list of problems */
const CHECKS = {
  amountSignStaysWithFigure: rules => {
    const cell = rules.filter(r => r.selectors.some(s => /#view-transactions \.table td\.num(:not\(\.text-warning\))?$/.test(s)));
    const drawn = rules.filter(r => r.selectors.some(s => /#view-transactions[^,]*td\.num[^,]*::?before$/.test(s))
      && r.decls.some(d => d.prop === 'content' && /['"][+−-]['"]/.test(d.value)));
    const out = [];
    if (!cell.length) out.push('no rule for the Transactions amount cell (test is stale)');
    if (!cell.some(r => (decl(r, 'white-space') || {}).value === 'nowrap')) out.push('the amount cell may wrap, so its sign can land on a line of its own');
    for (const r of drawn) out.push(`the sheet draws a sign of its own as well as the text's: ${r.prelude}`);
    return out;
  },

  firmEdgeYieldsToFocusAndHover: rules => {
    const firm = rules.filter(r => inCtx(r, 'color-mix') && decl(r, 'border-color') && /color-mix/.test(decl(r, 'border-color').value) && r.selectors.some(s => s.includes('#view-transactions')));
    const out = [];
    if (!firm.length) out.push('no color-mix border rule found (test is stale)');
    for (const r of firm) for (const s of r.selectors) {
      if (!/:not\(:(focus|hover)\)$/.test(s)) out.push(`the firm border applies in every state: ${s}`);
    }
    return out;
  },

  figuresNeverWrap: rules => {
    const out = [];
    const want = ['.mini .v', '.stat .sv', '.acct-drawer-v', '.env-amt', '.score-flow-in'];
    for (const w of want) {
      const hit = rules.some(r => r.selectors.some(s => s.endsWith(w)) && (decl(r, 'white-space') || {}).value === 'nowrap');
      if (!hit) out.push(`${w} is allowed to wrap mid-number`);
    }
    const dense = rules.find(r => inCtx(r, 'min-width: 1101px') && r.selectors.some(s => s.endsWith('.mini-kpis-5 .mini .v')));
    if (!dense || !decl(dense, 'font-size')) out.push('the five-up KPI row has no smaller figure size at 1101px and up');
    return out;
  },

  budgetLongFigureStepsDown: rules => {
    const out = [];
    const top = rules.find(r => r.selectors.some(s => s.endsWith('#budTotalsTop .bud-total-v.is-left.is-long')));
    if (!top || !/--st-figure\)/.test((decl(top, 'font-size') || {}).value || '')) out.push('"Left to budget" does not step down to figure size at seven digits');
    if (top && (decl(top, '--st-cur-gap') || {}).value !== 'var(--st-cur-gap-figure)') out.push('the stepped-down figure keeps the display symbol gap');
    if (!rules.some(r => r.selectors.some(s => s.endsWith('.bud-total-v.is-long:not(.is-left)')))) out.push('the plain totals have no seven-digit step');
    const band = rules.filter(r => r.selectors.includes('.budget-app-root .bud-totals') && !r.context.length);
    if (!band.some(r => (decl(r, 'overflow-x') || {}).value === 'auto')) out.push('the totals band can spill past its card in a narrow pane');
    return out;
  },

  successInkIsLightOnly: rules => {
    const out = [];
    const ink = rules.filter(r => r.selectors.some(s => /\.text-success$/.test(s)) && decl(r, '--color-success'));
    if (!ink.length) out.push('no rule re-points --color-success on .text-success (test is stale)');
    for (const r of ink) for (const s of r.selectors) {
      if (!s.includes(':not(.bud-dark)')) out.push(`the success ink would also apply on the dark theme: ${s}`);
    }
    if (!ink.some(r => decl(r, '--color-success').value === 'var(--color-primary)')) out.push('.text-success does not take the primary ink');
    const direct = ['.acct-chip.up', '.dp-save', '.dl-delta.is-down'];
    for (const d of direct) {
      const hit = rules.filter(r => r.selectors.some(s => s.endsWith(d) && s.includes(':not(.bud-dark)')) && (decl(r, 'color') || {}).value === 'var(--color-primary)');
      if (!hit.length) out.push(`${d} keeps the raw success green on the light theme`);
    }
    return out;
  },

  legendKeepsRoomForNames: rules => {
    const out = [];
    const leg = rules.find(r => r.selectors.some(s => s.endsWith('#dashSplit .donut-legend')) && decl(r, 'flex-basis'));
    if (!leg || parseInt(decl(leg, 'flex-basis').value, 10) < 470) out.push('the Dashboard legend no longer asks for room beside the donut');
    const val = rules.find(r => r.selectors.some(s => s.endsWith('.donut-legend .dl-val')) && decl(r, 'font-weight') && r.decls.some(d => d.prop === 'white-space'));
    if (!val || Number(decl(val, 'font-weight').value) > 500) out.push('.dl-val is wider than weight 500 or can wrap');
    return out;
  },
};

const real = rulesOf(assembled());
for (const [name, fn] of Object.entries(CHECKS)) {
  const found = fn(real);
  ok(!found.length, `${name}:\n    ${found.join('\n    ')}`);
}

/* the view half of item 4: budgets.js counts digits and appends the class to the
   figure, after `bud-total-v` (the figures harness reads the first class) */
const bud = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'budgets.js'), 'utf8');
/* longFig moved to src/dom.js (2026-10-14 audit, L8-06): one copy, imported by
   both pages. tests/long-fig-shared.test.cjs pins the helper's behaviour; this
   pins that the Budget page still reads it from there. */
ok(/const \{[^}]*\blongFig\b[^}]*\} = require\('\.\.\/dom'\);/.test(bud),
  'budgets.js takes longFig from dom.js, the one copy the Dashboard reads too');
ok(/class: `bud-total-v\$\{[^`]*\}\$\{longFig\(t\.value\)\}`/.test(bud), 'the totals figure appends is-long after bud-total-v');

/* NEGATIVE CONTROLS: break each invariant in a copy of the sheet; the check must notice */
const text = assembled();
const broke = (name, find, repl) => {
  const hit = typeof find === 'string' ? text.includes(find) : find.test(text);
  assert.ok(hit, `negative control for ${name}: the pattern to break was not found in the sheet`);
  const found = CHECKS[name](rulesOf(text.replace(find, repl)));
  ok(found.length > 0, `negative control: ${name} did not notice the invariant being broken`);
};
broke('amountSignStaysWithFigure', /(#view-transactions \.table td\.num:not\(\.text-warning\) \{\s*)white-space: nowrap;/, '$1');
broke('amountSignStaysWithFigure', /(#view-transactions \.table td\.num\.text-success \{)/,
  "#view-transactions .table td.num.text-success::before { content: '+'; }\n.budget-app-root $1");
broke('firmEdgeYieldsToFocusAndHover', '.btn-ghost:not(:hover)', '.btn-ghost');
broke('firmEdgeYieldsToFocusAndHover', '#txSearch:not(:focus)', '#txSearch');
broke('figuresNeverWrap', /(\.budget-app-root \.score-flow-in,[^{]*\.lo-big \{\s*)white-space: nowrap;/, '$1');
broke('figuresNeverWrap', /\.budget-app-root \.mini-kpis-5 \.mini \.v \{ font-size: [^}]*\}/, '');
broke('budgetLongFigureStepsDown', /(#budTotalsTop \.bud-total-v\.is-left\.is-long \{[^}]*?)--st-cur-gap: var\(--st-cur-gap-figure\);/, '$1');
broke('budgetLongFigureStepsDown', /(\.budget-app-root \.bud-totals \{[^}]*?)overflow-x: auto;/, '$1');
broke('successInkIsLightOnly', '.budget-app-root:not(.bud-dark) .text-success {', '.budget-app-root .text-success {');
broke('successInkIsLightOnly', '.budget-app-root:not(.bud-dark) .acct-chip.up,', '.budget-app-root .acct-chip.up,');
broke('legendKeepsRoomForNames', 'flex-basis: 470px', 'flex-basis: 260px');
broke('legendKeepsRoomForNames', /(\.donut-legend \.dl-val \{\s*font-weight: )500;/, '$1600;');

console.log(`PASS statement-fix-round — the amount's sign kept with its figure, focus/hover edges, figure wrapping, long budget figures, light-theme success ink and legend room are each pinned, and each pin fails when broken (${checks} checks)`);
