'use strict';
/* ON AN IPAD THE PLUGIN'S BUTTONS KEEP THEIR OWN PADDING (audit L5-02).

   Obsidian's app.css ships

       .is-tablet button:not(.clickable-icon) { padding: var(--size-4-1) var(--size-4-5); }

   which is (0,2,1) and applies to every <button> on an iPad (body.is-tablet).
   Almost every plugin button class is (0,2,0) (`.budget-app-root .btn-ghost`),
   so on an iPad ~65 of them lost their padding to 4px 20px: the Plan page's
   done-tick became a 42x24 pill, the Import drop zone 96px tall instead of
   168px, every icon-only button 42px wide, and the drawer's rows 38px instead
   of 52px (measured in Chromium against Obsidian 1.14.4's real app.css, 820px
   wide, host render vs the same render with the host sheet removed: 73
   distinct button selectors differed).

   The fix is a block of rules that re-states the plugin's own padding at
   (0,2,2): `body.is-tablet .budget-app-root button`, which beats the host
   (0,2,1) outright, then `button:where(.cls)` per class. :where() keeps each
   class twin at (0,2,2) too, so

     - it beats the host's (0,2,1);
     - it still LOSES to every (0,3,0)+ component rule (`.acct-deck-btn.sm`,
       `.bud-table .bud-act`, the id-scoped Transactions rules), which already
       beat the host and are the intended value; and
     - the twins order among themselves exactly as their base rules do, because
       they tie and source order decides.

   Nothing here reaches a desktop or an iPhone: every selector starts
   `body.is-tablet`.

   This test holds three things: the reset exists and out-ranks the host; every
   button class the views create that has a simple padding rule has a twin with
   the SAME declarations in the SAME media context, in the SAME order; and no
   twin out-ranks a (0,3,0) component rule.

   Negative controls, each run by hand: delete the reset; change one twin's
   padding; swap two twins; drop one class (.ei-tick-style classes are the
   reset's, a padded one like .env-add needs its twin). Each fails here.

     node tests/css-tablet-button-padding.test.cjs */

const fs = require('fs');
const path = require('path');
const { readRules, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const rules = readRules();
const R = '.budget-app-root';
const ROOT = path.join(__dirname, '..');

/* ---- specificity: [ids, classes+attributes+pseudo-classes, types+pseudo-elements] ---- */
function spec(sel) {
  let s = sel.replace(/\\./g, 'x');
  let a = 0, b = 0, c = 0;
  s = s.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');                  // :where() is zero
  s = s.replace(/:(?:not|is|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner) => {      // :not/:is take their most specific argument
    const best = inner.split(',').map(spec).sort((x, y) => (y[0] - x[0]) || (y[1] - x[1]) || (y[2] - x[2]))[0];
    a += best[0]; b += best[1]; c += best[2]; return '';
  });
  s = s.replace(/::[\w-]+/g, () => { c++; return ''; });
  s = s.replace(/\[[^\]]*\]/g, () => { b++; return ''; });
  s = s.replace(/#[\w-]+/g, () => { a++; return ''; });
  s = s.replace(/\.[\w-]+/g, () => { b++; return ''; });
  s = s.replace(/:[\w-]+(\([^)]*\))?/g, () => { b++; return ''; });
  s = s.replace(/[>+~*]/g, ' ');
  c += (s.match(/[a-zA-Z][\w-]*/g) || []).length;
  return [a, b, c];
}
const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
const HOST = [0, 2, 1];                     // .is-tablet button:not(.clickable-icon)
ok(cmp(spec('.is-tablet button:not(.clickable-icon)'), HOST) === 0, 'spec(): the host rule is (0,2,1)');
ok(cmp(spec(`${R} .btn-ghost`), [0, 2, 0]) === 0, 'spec(): a plugin component class is (0,2,0)');
ok(cmp(spec(`body.is-tablet ${R} button:where(.btn-ghost)`), [0, 2, 2]) === 0, 'spec(): the class twin is (0,2,2)');

const isPad = p => p === 'padding' || /^padding-/.test(p);
const padKey = r => r.decls.filter(d => isPad(d.prop)).map(d => `${d.prop}:${d.value}`).join(';');
const ctxKey = r => JSON.stringify(r.context);

/* ---- 1. the reset: the plugin's `button { padding: 0 }` re-asserted over the host ---- */
const RESET = `body.is-tablet ${R} button`;
{
  const reset = rules.find(r => r.context.length === 0 && r.selectors.includes(RESET));
  ok(reset && reset.decls.some(d => d.prop === 'padding' && d.value === '0'), `${RESET} { padding: 0 } exists (the base \`${R} button\` reset loses to the host's (0,2,1) on an iPad)`);
  ok(reset && cmp(spec(RESET), HOST) > 0, `${RESET} must out-rank the host's (0,2,1); is (${spec(RESET)})`);
}

/* ---- 2. every padded button class has a twin ---- */
const jsFiles = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== 'lang') walk(p); } else if (p.endsWith('.js')) jsFiles.push(p); } })(path.join(ROOT, 'src'));
const buttonClasses = new Set();
for (const f of jsFiles) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/(?:el|createEl|h)\(\s*'button'\s*,\s*\{([^}]*)\}/g)) {
    const c = /class(?:Name)?:\s*['`]([^'`$]*)['`]/.exec(m[1]);
    if (c) c[1].split(/\s+/).filter(Boolean).forEach(k => buttonClasses.add(k));
  }
  for (const m of t.matchAll(/<button[^>]*class="([^"]*)"/g)) m[1].split(/\s+/).filter(Boolean).forEach(k => buttonClasses.add(k));
}
ok(buttonClasses.size > 40, `expected to find the views' button classes in src/, found ${buttonClasses.size}`);

/* Classes created for buttons by markup the scan above cannot see (a class built
   from a template, or set through a helper). Each is a real <button>. */
for (const k of ['plan-del-ico', 'src2-del', 'tx-undo-x', 'bud-pull', 'score-gap-go', 'ei-tick', 'env-collapse', 'env-del-ico',
  'btn-sm', 'status-pill', 'chart-range-btn', 'cat-cell-btn', 'env-sum', 'ei-name', 'score-ring-row', 'acct-owner-row']) buttonClasses.add(k);

const twinRules = rules.filter(r => r.selectors.some(s => s.startsWith(`${RESET}:where(`)));
const twinFor = (k, ctx) => twinRules.find(r => r.selectors.includes(`${RESET}:where(.${k})`) && JSON.stringify(r.context) === ctx);
const baseOrder = [];     // each class's base rule line and its twin's, in every media context
for (const k of [...buttonClasses].sort()) {
  const bases = rules.filter(r => r.selectors.includes(`${R} .${k}`) && r.decls.some(d => isPad(d.prop)));
  for (const b of bases) {
    const key = padKey(b);
    if (/^padding:0$/.test(key)) continue;                  // the reset's own value
    const t = twinFor(k, ctxKey(b));
    ok(t, `.${k} has a padding rule (${key}) at ${locate(b.line)} in ${b.context.join(' ') || '(base)'} but no \`${RESET}:where(.${k})\` twin in that context: on an iPad the host's 4px 20px wins`);
    if (t) {
      ok(padKey(t) === key, `${RESET}:where(.${k}) at ${locate(t.line)} says "${padKey(t)}" but its base rule at ${locate(b.line)} says "${key}"`);
      baseOrder.push({ k, base: b.line, twin: t.line });
    }
  }
}

/* ---- 3. the twins order as their bases do (they tie at (0,2,2); order decides) ---- */
for (const x of baseOrder) for (const y of baseOrder) {
  if (x.k !== y.k && x.base < y.base) ok(x.twin < y.twin, `twin order: .${x.k} (base ${locate(x.base)}) must come before .${y.k} (base ${locate(y.base)}), but its twin comes after`);
}

/* ---- 4. no twin out-ranks a (0,3,0) component rule; each is gated to iPad ---- */
for (const r of twinRules) for (const s of r.selectors) {
  ok(cmp(spec(s), [0, 2, 2]) === 0, `${locate(r.line)}: "${s}" is (${spec(s)}); it must stay (0,2,2) so a (0,3,0) component rule still beats it`);
  ok(s.startsWith('body.is-tablet '), `${locate(r.line)}: "${s}" must start body.is-tablet (it may not reach a desktop or a phone)`);
}

/* ---- 5. the split dialog's delete button (a Modal, outside .budget-app-root) ---- */
{
  const t = rules.find(r => r.context.length === 0 && r.selectors.includes('.is-tablet button.budget-split-del'));
  const base = rules.find(r => r.selectors.includes('.budget-split-del') && r.decls.some(d => d.prop === 'padding'));
  ok(t && base && padKey(t) === padKey(base), '.is-tablet button.budget-split-del re-states .budget-split-del\'s padding (a tie with the host at (0,2,1) is enough: the plugin sheet loads later)');
}

if (failures.length) {
  console.log(`FAIL — css-tablet-button-padding: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — css-tablet-button-padding: ${checks} checks (reset out-ranks the host, ${twinRules.length} class twins match their base rules in value, context and order, none beats a (0,3,0) rule).`);
