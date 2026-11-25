'use strict';
/* The inspector's "This period" and "Still to come" values break only at their
   separator (2026-11-25 audit, VIS-13).

   The value was one text node, "+R 45 000 · −R 30 860", so in the inspector's
   narrow column it wrapped wherever it liked — between "−R" and its number,
   leaving "−R" at the end of one line and "30 860" at the start of the next.
   It is now two figure elements with the " · " between them, each marked
   `acct-insp-fig`, and the stylesheet gives that class `white-space: nowrap` —
   a class in src/statement/accounts.css, not an inline style, so the host
   cascade and the build's CSS guards see it. A line that fits is the same
   characters in the same order as before.

     1. the This-period value is exactly two figure elements and a separator
     2. each figure holds one whole signed amount: its sign and its symbol and
        its number are inside the same element, so no break can fall between
     3. the figures carry the class and NO inline style; the class is defined in
        the statement stylesheet with `white-space: nowrap`
     4. the text read off the page is unchanged: "+… · −…"
     5. the same holds for the "Still to come" value beside it

     node tests/accounts-inspector-flow-figures-do-not-break.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { el } = require('../src/dom');
const i18n = require('../src/i18n');
const { SEED, PERIOD, atAuditDate } = require('./_audit-seed.cjs');
const { readRules } = require('./helpers/css-sources.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const walk = (n, fn) => { fn(n); for (const c of (n.children || [])) walk(c, fn); };

async function inspectorFor(account) {
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.switchView = () => {};
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  ctx.renderAccounts();
  let row = null;
  walk(ctx.$('#acctTable'), n => {
    if (row || !n._cls || !n._cls.has('acct-row')) return;
    walk(n, m => { if (m._cls && m._cls.has('acct-name-btn') && m.textContent.trim() === account) row = n; });
  });
  ok(row, `the ${account} row is on the page to click`);
  row.click();
  return ctx.$('#acctInspector');
}

/* The value cell of the inspector fact labelled `label`. */
function valueOf(inspector, label) {
  let found = null;
  walk(inspector, n => {
    if (found || !n._cls || !n._cls.has('acct-drawer-f')) return;
    const l = n.children.find(c => c._cls && c._cls.has('acct-drawer-l'));
    if (l && l.textContent === label) found = n.children.find(c => c._cls && c._cls.has('acct-drawer-val'));
  });
  return found;
}

atAuditDate(async () => {
  const insp = await inspectorFor('Cheque');

  for (const [label, what] of [[i18n.t('acct.drawer.flow'), 'This period'], [i18n.t('acct.drawer.ahead'), 'Still to come']]) {
    const val = valueOf(insp, label);
    ok(val, `${what}: the inspector has the row`);
    const figs = val.children.filter(c => c._cls && c._cls.has('acct-insp-fig'));
    eq(figs.length, 2, `${what}: two figure elements`);
    ok(/^\+/.test(figs[0].textContent) && /^−/.test(figs[1].textContent),
      `${what}: money in first with its plus, money out second with its minus — each sign INSIDE its own element`);
    ok(/\d/.test(figs[0].textContent) && /\d/.test(figs[1].textContent), `${what}: and each holds its number too`);
    eq(val.children.filter(c => !(c._cls && c._cls.has('acct-insp-fig'))).map(c => c.rawText ?? c._text), [' · '],
      `${what}: the only thing outside the figures is the separator, so it is the only place a line can break`);
    eq(val.textContent, `${figs[0].textContent} · ${figs[1].textContent}`,
      `${what}: the text read off the page is the same "+… · −…" it always was`);
    for (const f of figs) {
      ok(!(f.attrs && f.attrs.style) && Object.keys(f.style || {}).length === 0,
        `${what}: no inline style — the nowrap lives in the stylesheet`);
    }
  }

  const rules = readRules().filter(r => r.selectors.some(s => /(^|\s)\.acct-insp-fig\b/.test(s)));
  ok(rules.length >= 1, 'the statement stylesheet defines .acct-insp-fig');
  ok(rules.every(r => r.selectors.every(s => /\.budget-app-root/.test(s))), 'scoped to the plugin root');
  ok(rules.some(r => r.decls.some(d => d.prop === 'white-space' && d.value === 'nowrap')), 'with white-space: nowrap');

  console.log(`PASS accounts-inspector-flow-figures-do-not-break — the pair breaks at its separator only (${checks} checks)`);
});
