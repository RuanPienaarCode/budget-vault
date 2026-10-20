'use strict';
/* A TONE CLASS IS THE LAST WORD ON AN ELEMENT'S COLOUR (2026-10-20 audit, D1-11).

   The views mark a figure's meaning with .text-danger / .text-warning /
   .text-success: an overdrawn balance, an amount still outstanding, a
   reconciliation that matched. Those three rules were (0,2,0) near the top of
   src/styles.css, and a component's own colour rule of the same weight, later
   in the file, beat them on source order. Measured in the audit:

     button.acct-bal.text-danger        an overdrawn card balance (R -4 200,50
                                        in the harness) in neutral ink, while the
                                        same figure was red on Savings and on the
                                        Dashboard's Debt tile
     .assets-hero-num.text-success      the Assets total in ink
     .sav-row-status.text-warning       "3 unmatched" in muted grey

   The same shape, out of the harness's sight: "Matches your transactions"
   (.acct-recon-txt.text-success) muted; the Savings stated-growth line
   (.mini .s2.text-danger) faint; the Debt plan's "not within 50 years"
   (.dpp-h.text-danger) in the plan's GREEN heading colour; the Dashboard's
   over-claimed reserve warning (.lm.text-danger) in the faint caption ink; the
   Report folder problem (.text-muted.text-danger) muted.

   The rule now: the three tone classes are doubled to (0,3,0) and live in
   statement/foundation.css, after the whole legacy sheet, so they out-rank
   every class-only colour rule there; an id-scoped lane rule that must yield
   gets a compound .x.text-tone beside it. Checked two ways:
     1. the named cases above, resolved through the cascade;
     2. every class string in src/ that carries a tone, rendered as a bare
        element under the root: its colour must come from a rule that names
        the tone (the tone rule, or a compound with it), never from the
        component's own colour.

     node tests/css-tone-wins.test.cjs */

const fs = require('fs');
const path = require('path');
const { locate } = require('./helpers/css-sources.cjs');
const { computed, node, ROOT } = require('./helpers/css-cascade.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const show = d => (d ? `"${d.value}" from ${d.selector} (${locate(d.line)})` : 'nothing');
const INK = { 'text-danger': 'var(--color-danger-ink)', 'text-warning': 'var(--color-warning-ink)', 'text-success': 'var(--color-success)' };
const colourIs = (path, tone, why, env = { width: 1280 }) => {
  const d = computed(path, 'color', env);
  ok(d && d.value === INK[tone] && d.selector.includes('.' + tone), `${why}: colour is ${show(d)}, wanted ${INK[tone]} from the ${tone} rule`);
};

/* ---- 1. the named cases ---- */
const R = ROOT();
const P = ROOT('phone');
colourIs([...R, node('td'), node('button', ['acct-bal', 'num', 'text-danger'])], 'text-danger', 'D1-11 an overdrawn Accounts balance');
colourIs([...R, node('td'), node('button', ['acct-bal', 'num', 'text-warning'])], 'text-warning', 'an unreadable Accounts balance');
colourIs([...P, node('td'), node('button', ['acct-bal', 'num', 'text-danger'])], 'text-danger', 'an overdrawn Accounts balance on a phone', { width: 375 });
colourIs([...R, node('div', ['assets-hero']), node('div', ['assets-hero-num', 'text-success'])], 'text-success', 'D1-11 the Assets total');
colourIs([...R, node('div', ['sav-row-end']), node('div', ['sav-row-status', 'text-warning'])], 'text-warning', 'D1-11 a Savings row "unmatched" status');
colourIs([...R, node('div', ['sav-row-end']), node('div', ['sav-row-status', 'text-success'])], 'text-success', 'a Savings row "matches" status');
colourIs([...R, node('div', ['acct-recon']), node('div', ['acct-recon-txt', 'text-success'])], 'text-success', '"Matches your transactions"');
colourIs([...R, node('div', ['acct-recon']), node('div', ['acct-recon-txt', 'text-warning'])], 'text-warning', 'the unreadable-dates reconciliation warning');
colourIs([...R, node('div', ['mini']), node('div', ['s2', 'num', 'text-danger'])], 'text-danger', 'the Savings stated-growth line, when it fell');
colourIs([...R, node('div', ['mini']), node('div', ['s2', 'num', 'text-success'])], 'text-success', 'the Savings stated-growth line, when it grew');
colourIs([...R, node('div', ['debt-plan-projected']), node('div', ['dpp-h', 'text-danger'])], 'text-danger', 'the Debt plan\'s "not within 50 years"');
colourIs([...R, node('div', [], { id: 'healthBody' }), node('div', ['health-fig', 'is-poor']), node('div', ['lm', 'text-danger'])], 'text-danger', 'the Dashboard\'s over-claimed reserve warning');
colourIs([...R, node('span', ['text-muted', 'report-folder-desc', 'text-danger'], { id: 'reportFolderDesc' })], 'text-danger', 'the Report folder problem');
colourIs([...R, node('div', ['pot-fig', 'text-danger'])], 'text-danger', 'the Plan overspent figure (already compound, must stay so)');
/* The one place a tone must NOT win: white text on the Dashboard score slab
   is a colour decision for the slab, and it out-ranks any tone by design. */
{
  const d = computed([...R, node('div', ['health-fig', 'is-score']), node('div', ['lv']), node('span', ['num', 'text-success'])], 'color', { width: 1280 });
  ok(d && !d.selector.includes('.text-success'), `the score slab keeps its own ink over a tone (got ${show(d)})`);
}
/* The tones are (0,3,0): doubled, in the foundation, after the legacy sheet. */
for (const tone of Object.keys(INK)) {
  const d = computed([...R, node('span', [tone])], 'color', { width: 1280 });
  ok(d && d.selector === `.budget-app-root .${tone}.${tone}` && /foundation/.test(locate(d.line)),
    `.${tone} is the doubled (0,3,0) rule in statement/foundation.css (found ${show(d)})`);
}

/* ---- 2. every tone-carrying class string in src/ ---- */
const SRC = path.join(__dirname, '..', 'src');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (f !== 'lang') walk(p); } else if (f.endsWith('.js')) files.push(p);
  }
})(SRC);
let scanned = 0;
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/class:\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
    const str = m[1].slice(1, -1);
    const tones = [...new Set([...str.matchAll(/\btext-(success|danger|warning)\b/g)].map(x => x[0]))];
    if (!tones.length) continue;
    const stat = str.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(x => /^[a-z][\w-]*$/.test(x) && !/^text-(success|danger|warning)$/.test(x));
    // A tag the class sits on, where the call says (el('button', …)); a div otherwise.
    const tag = (/el\(\s*'(\w+)'\s*,\s*\{[^{}]*$/.exec(t.slice(Math.max(0, m.index - 200), m.index)) || [])[1] || 'div';
    for (const tone of tones) {
      scanned++;
      const d = computed([...R, node(tag, [...stat, tone])], 'color', { width: 1280 });
      const where = `${path.relative(path.join(__dirname, '..'), f)}:${t.slice(0, m.index).split('\n').length}`;
      ok(d && d.selector.includes('.' + tone), `${where} <${tag} class="${[...stat, tone].join(' ')}">: the colour comes from ${show(d)}, not from .${tone}`);
    }
  }
}
ok(scanned > 40, `sanity: the scan should find the tone-carrying class strings in src/, found ${scanned}`);

if (failures.length) { console.error(`FAIL — css-tone-wins: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-tone-wins: .text-danger/.text-warning/.text-success decide the colour of every element that carries one (${scanned} class strings scanned, ${checks} checks).`);
