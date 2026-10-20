'use strict';
/* Owed Money states its other-currency totals through the app's formatter,
   with no hand-built stand-in behind it.

   2026-10-20 audit, D2-26. renderOwedKpis carried a fallback for a ctx with
   no moneyIn — `${sym} ${Math.round(v)}` — a second spelling of money that
   groups no thousands and ignores the household's separators ("€ 1300" where
   the formatter prints "€ 1 300"). It can never run: controller.js builds the
   ctx with moneyIn in the same literal as money, before any view registers,
   and the test harness does the same. A branch that cannot run is still a
   rule someone will copy, so it goes, and this file pins both halves — the
   premise that makes it dead, and that it stays gone. The note keeps cents
   now, like the tile figure it sits under (D2-03).

   The page itself is mounted through the REAL loader and view with the REAL
   formatter, on made-up entries.

     node tests/owed-no-hand-money-fallback.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* ---- the premise: every ctx a view can be handed carries moneyIn ---- */
{
  const controller = strip(fs.readFileSync(path.join(SRC, 'controller.js'), 'utf8'));
  const literal = (controller.match(/const ctx = \{([^}]*)\}/) || [])[1] || '';
  ok(/\bmoneyIn\b/.test(literal) && /\bmoney\b/.test(literal),
    'controller.js builds the ctx with money AND moneyIn in one literal, before any view registers');
  ok(typeof makeCtx({}).moneyIn === 'function', 'and the test harness\'s ctx carries moneyIn too');
}

/* ---- and so the view holds no hand-built fallback for its absence ---- */
{
  const owed = strip(fs.readFileSync(path.join(SRC, 'views', 'owed.js'), 'utf8'));
  ok(!/`\$\{sym\} \$\{/.test(owed), 'views/owed.js builds no "${sym} ${…}" money string by hand');
  ok(!/Math\.round\(v\)/.test(owed), 'and rounds no figure by hand for display');
}

/* ---- the page: the other-currency note reads the way the formatter writes ---- */
(async () => {
  const unpin = pinClock('2026-10-20');
  try {
    const B = 'Budget';
    const M = await mountFor({
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n'
        + '| Person | Amount | Description | Due date | Status | Repaid | Lent | Currency |\n'
        + '|---|---:|---|---|---|---:|---|---|\n'
        + '| Sam | 2000.00 | Loan |  | outstanding | 500.00 | 2026-06-01 |  |\n'
        + '| Ana | 1500.00 | Trip |  | outstanding | 200.00 | 2026-07-01 | € |\n',
    }, { period: '2026-10', budgetFolder: B });
    M.ctx.renderOwed();
    const subs = descend(M.nodes.get('#owedKpis')).filter(n => n._cls && n._cls.has('s')).map(n => n.textContent);
    ok(subs.includes('plus € 1 300,00 owed in other currencies'),
      `the euro still owed is stated through the formatter, thousands grouped and in cents like the tile above it — got ${JSON.stringify(subs)}`);
  } finally {
    unpin();
  }
  console.log(`PASS owed-no-hand-money-fallback — the ctx always carries moneyIn, and Owed Money keeps no hand-built stand-in for it (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
