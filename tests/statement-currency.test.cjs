'use strict';
/* THE MUTED CURRENCY SYMBOL: A ROOT CLASS, A ::first-letter RULE, AND A SHORT LIST.

   The statement-type redesign draws the currency symbol smaller and muted on the
   big figures WITHOUT changing the printed text (the figures ledger and the
   reconciliation harness read "R 48 000" as one text node). The only CSS that
   can style "the symbol and nothing else" is ::first-letter, which has two
   hazards, and this pins both:

     1. IT MUST ONLY EVER APPLY TO A ONE-CHARACTER SYMBOL. A code such as CHF or
        A$ would get one stray styled letter. So every ::first-letter rule in the
        stylesheet sits under .budget-app-root.bv-cur-1, and src/controller.js
        owns that class: derived from Settings' currency, re-derived on render
        and set at start, so a settings change cannot leave it stale.
     2. IT MUST ONLY EVER APPLY TO A FIGURE THAT BEGINS WITH MONEY. On "58% of the
        plan" or "3" it would shrink the first digit. So the rules may not name
        the classes known to print counts, percentages or dates.

     3. THE SYMBOL A FIGURE PRINTS MAY NOT BE THE HOUSEHOLD'S. The Transactions
        amount cell and the Accounts drawer balance print the ACCOUNT's own
        symbol or code ("USD 12,00", "Rp 5"), so the household gate alone would
        shrink only the "U" or the "R". Those two rules also require .st-cur1,
        a class the view appends exactly when the symbol it printed is one code
        point (never before the first class: the figures harness reads a cell
        by its first class).
     4. THE SYMBOL'S GAP FOLLOWS ITS SIZE. The ::first-letter margin is in ems of
        the symbol, so a figure at display or statement size needs its own gap
        token, and a rule that steps a display figure down must put the figure
        gap back. Every block that sets --st-cur to one of those tokens sets
        --st-cur-gap beside it.

     node tests/statement-currency.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readRules, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const rules = readRules();
const fl = rules.filter(r => r.selectors.some(s => s.includes('::first-letter')));
ok(fl.length >= 1, 'the foundation has ::first-letter rules');

/* 1. every first-letter selector is gated on the one-character class */
const ungated = [];
for (const r of fl) for (const s of r.selectors) {
  if (!s.includes('::first-letter')) continue;
  if (!s.startsWith('.budget-app-root.bv-cur-1 ')) ungated.push(s);
}
ok(!ungated.length, 'every ::first-letter selector is under .budget-app-root.bv-cur-1:\n    ' + ungated.join('\n    '));

/* 2. none names a class that prints non-money */
const NOT_MONEY = ['free-fig', 'acct-fact-v', 'dp-date', 'health-fig', 'score-ring-num', 'hero-lbl'];
const bad = [];
for (const r of fl) for (const s of r.selectors) for (const c of NOT_MONEY) if (new RegExp('\\.' + c + '(?![\\w-])').test(s)) bad.push(s);
ok(!bad.length, 'no ::first-letter rule targets a figure that can print a count, percent or date:\n    ' + bad.join('\n    '));

/* 3. the controller owns the class */
const ctl = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
ok(/function applyCurrencyClass\(\)/.test(ctl), 'controller.js defines applyCurrencyClass()');
ok(/classList\.toggle\('bv-cur-1',\s*Array\.from\(sym\)\.length === 1\)/.test(ctl),
  'the class is on exactly when the symbol is one character (counted by code point, so a symbol outside the BMP still counts as one)');
ok(/function render\(\) \{\s*applyCurrencyClass\(\);/.test(ctl), 'render() re-derives it, so a settings change or reload keeps it in step');
ok(/start: async \(\) => \{\s*applyTheme\(\);\s*applyCurrencyClass\(\);/.test(ctl), 'start() sets it before the first paint');

/* 4. per-figure class: the two figures that can print a foreign symbol */
const needs = (frag, label) => {
  const hit = fl.flatMap(r => r.selectors).filter(sel => sel.includes(frag));
  ok(hit.length >= 1, `a ::first-letter rule names ${label}`);
  for (const sel of hit) ok(sel.includes('.st-cur1'), `${label}'s ::first-letter rule requires the per-figure class .st-cur1: ${sel}`);
};
needs('td.num', 'the Transactions amount cell');
needs('.acct-drawer-v', 'the Accounts drawer balance');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const tx = read('views/transactions.js');
const ac = read('views/accounts.js');
ok(/class: `num\$\{r\.amount > 0 \? ' text-success' : ''\}\$\{rowSymbolIsOneChar\(r\) \? ' st-cur1' : ''\}`/.test(tx),
  'the amount cell appends st-cur1 AFTER num (and the sign class), so `num` stays its first class');
ok(/const rowSymbolIsOneChar = r => Array\.from\(rowPrintedSymbol\(r\)\)\.length === 1;/.test(tx),
  'transactions.js decides "one symbol" by code point, like the controller');
ok(/const rowPrintedSymbol = r => \{[\s\S]*?sym === \(S\.settings \|\| \{\}\)\.currency[\s\S]*?typeof ctx\.moneyIn !== 'function'/.test(tx),
  'rowPrintedSymbol uses rowMoney()\'s own test for "this row prints the household symbol"');
ok(/acct-drawer-v num\$\{[^`]*\}\$\{acctSymbolIsOneChar\(a\) \? ' st-cur1' : ''\}`/.test(ac),
  'the drawer balance appends st-cur1 after num');
ok(/const acctSymbolIsOneChar = a => Array\.from\(String\(symbolOf\(a, S\.settings\.currency\)\)\.trim\(\)\)\.length === 1;/.test(ac),
  'accounts.js counts the symbol acctMoney() prints (symbolOf: a conflicted account prints its CODE, which is never one point)');

/* 5. every --st-cur at display/statement size has its gap beside it */
{
  const PAIRS = { 'var(--st-cur-statement)': 'var(--st-cur-gap-statement)', 'var(--st-cur-display)': 'var(--st-cur-gap-display)' };
  let pairs = 0;
  const bad = [];
  for (const r of rules) {
    const cur = r.decls.find(d => d.prop === '--st-cur');
    if (!cur || !PAIRS[cur.value]) continue;
    pairs++;
    const gap = r.decls.find(d => d.prop === '--st-cur-gap');
    if (!gap || gap.value !== PAIRS[cur.value]) bad.push(`${r.selectors.join(', ')} sets --st-cur: ${cur.value} without --st-cur-gap: ${PAIRS[cur.value]}`);
  }
  ok(pairs >= 3, `the display/statement figures are found (${pairs})`);
  ok(!bad.length, 'a display or statement size sets its gap token beside its symbol size:\n    ' + bad.join('\n    '));
  /* and the lane-local hack is gone: no ::first-letter rule outside the foundation sets its own margin */
  const hack = fl.filter(r => !/foundation/.test(locate(r.line)) && r.decls.some(d => d.prop === 'margin-right'));
  ok(!hack.length, 'no lane overrides the symbol margin itself (use --st-cur-gap): ' + hack.map(r => locate(r.line)).join(', '));
}

console.log(`PASS statement-currency — every ::first-letter rule is gated on .bv-cur-1 and avoids non-money figures; the controller keeps the class true (${checks} checks, ${fl.length} rules)`);
