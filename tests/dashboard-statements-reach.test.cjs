'use strict';
/* The Dashboard says how far the statements reach (2026-11-25 audit, NUM-1,
   NUM-2, NUM-3).

   Every figure on the home page was arithmetically right and still misled,
   because nothing said the statements behind it stopped short. On the owner's
   vault his pay period had begun three days earlier, no budget existed for it
   yet, and the newest imported row was from a week BEFORE the period began:
   the hero read a huge "R 0 / Total spent" under "New period — nothing
   budgeted yet", with "Total spent" printed twice and no way on to the page
   that fixes it. The period before it, whose statements also stopped before
   its last day, was presented by the hero as finished while the health card
   quietly left it out of its averages; and a fund whose own statements
   stopped before the period read "R 0 of R 2 000 saved so far".

   Pinned here, over a synthetic household with the same shape, real loader,
   real view, clock pinned:
     1. no budget, statements stop before the period: the hero says how far
        the statements are imported, offers the Budget page, and says "Total
        spent" once;
     2. a finished period whose statements stop before its end carries the
        same line, and the health card names it as left out and why;
     3. statements up to today: no line (NEGATIVE CONTROL);
     4. a past period with no budget: wording unchanged, no button;
     5. a fund whose rows stop before the period: the set-aside sentence says
        so instead of "R 0 … saved so far", and with the fund imported it is
        the ordinary sentence again (NEGATIVE CONTROL).

     node tests/dashboard-statements-reach.test.cjs */

const assert = require('assert');
const { B, tx, account, cat, find, hasClass, textOf, renderDash } = require('./helpers/dash-audit.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const BUDGET = rows => '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + rows.map(([c, t, a]) => `| ${c} | ${t} | ${a.toFixed(2)} |  |\n`).join('');

/* Payday months from the 22nd: 2026-11 runs 22 Oct – 21 Nov, 2026-12 runs
   22 Nov – 21 Dec. Salary on the 22nd, groceries on the 5th and the 15th, and
   R 2 000 moved to the fund on the 25th. */
function household({ chequeTo = '2026-11-15', fundTo = '2026-09-30', fundRows = null } = {}) {
  const cheque = [], fund = [];
  const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
  for (const m of months) {
    cheque.push([`${m}-05`, 'Checkers', 'Groceries', -3000]);
    cheque.push([`${m}-15`, 'Woolies', 'Groceries', -1000]);
    cheque.push([`${m}-22`, 'EMPLOYER SALARY', 'Salary', 30000]);
    cheque.push([`${m}-25`, 'To fund', 'Transfer', -2000]);
    fund.push([`${m}-25`, 'From cheque', 'Transfer', 2000]);
  }
  const files = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 22\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
    [`${B}/Categories/Salary.md`]: cat('income'),
    [`${B}/Categories/Groceries.md`]: cat('expense'),
    [`${B}/Categories/Transfer.md`]: cat('transfer'),
    [`${B}/Categories/Savings.md`]: cat('savings'),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '20000.00', balance_updated: '2026-06-01' }),
    /* Outside the budget, as most households keep a fund: the spend
       completeness check never looks at it. */
    [`${B}/Accounts/Fund.md`]: account('Fund', { type: 'savings', balance: '10000.00', balance_updated: '2026-06-01', budget: 'false' }),
    [`${B}/Budgets/2026-11.md`]: BUDGET([['Salary', 'income', 30000], ['Groceries', 'expense', 8000], ['Savings', 'savings', 2000]]),
  };
  const byMonth = (label, rows, to) => {
    for (const r of rows.filter(x => x[0] <= to)) {
      const k = `${B}/Transactions/${label}/${r[0].slice(0, 7)}.md`;
      (files[k] ??= []).push(r);
    }
  };
  byMonth('Cheque', cheque, chequeTo);
  byMonth('Fund', fundRows || fund, fundTo);
  for (const k of Object.keys(files)) if (Array.isArray(files[k])) files[k] = tx(files[k]);
  return files;
}

const heroText = nodes => textOf(nodes.get('#heroCard'));
const heroLines = nodes => find(nodes.get('#heroCard'), n => hasClass(n, 'hero-sub--ahead')).map(textOf);
const nextBtn = nodes => find(nodes.get('#heroCard'), n => n.tagName === 'BUTTON' && hasClass(n, 'hero-next'))[0];
const count = (s, needle) => s.split(needle).length - 1;

(async () => {
  /* ---- 1. the owner's morning: new period, no budget, statements a week short ---- */
  {
    const { nodes, ctx } = await renderDash(household(), { today: '2026-11-26', period: '2026-12' });
    const text = heroText(nodes);
    ok(/New period — nothing budgeted yet/.test(text), `fixture: the fresh-period label is up: ${text}`);
    ok(heroLines(nodes).some(l => l === 'Statements imported to Nov 15'),
      `the hero says how far the statements reach: ${JSON.stringify(heroLines(nodes))}`);
    const btn = nextBtn(nodes);
    ok(btn, 'the hero offers the next step');
    eq(btn && textOf(btn), 'Set up this period\'s budget', 'labelled with what it does');
    ok(btn && hasClass(btn, 'btn') && hasClass(btn, 'btn-ghost'), 'in the app\'s existing button style');
    const went = [];
    ctx.switchView = v => went.push(v);
    btn.click();
    eq(went, ['budgets'], 'and it opens the Budget page, where the copy-previous banner lives');
    eq(count(text, 'Total spent'), 1, `"Total spent" is said once, not under the figure and again beside it: ${text}`);
    /* NUM-4, rendered: the salary due on the 22nd sits after the cheque
       account's last import (the 15th), so it is held, in the debit orders'
       own words, and is not in the cash figure. */
    const left = textOf(nodes.get('#leftBody'));
    ok(/R 30 000 expected Nov 22 — not imported yet/.test(left), `the What's-left card holds the salary as not imported yet: ${left}`);
    ok(!/lands on/.test(left), 'and does not say it is still to land');
  }

  /* ---- 2. the finished period whose statements stop before its end ---- */
  {
    const { nodes, t } = await renderDash(household(), { today: '2026-11-26', period: '2026-11' });
    ok(heroLines(nodes).includes('Statements imported to Nov 15'),
      `a finished period read off short statements says so: ${JSON.stringify(heroLines(nodes))}`);
    ok(!nextBtn(nodes), 'a budgeted period offers no set-up button');
    const sub = t('#healthSub');
    ok(/November 2026 left out: statements stop before it ended/.test(sub),
      `the health card names the left-out period and why: ${sub}`);
    ok(/^Averaged over your last 5 completed periods/.test(sub), `beside the count it did average: ${sub}`);
  }

  /* ---- 3. NEGATIVE CONTROL: statements up to today ---- */
  {
    const { nodes, t } = await renderDash(household({ chequeTo: '2026-11-15', fundTo: '2026-11-15' }),
      { today: '2026-11-15', period: '2026-11' });
    ok(!heroLines(nodes).some(l => /Statements imported/.test(l)),
      `imported up to today, there is nothing to qualify: ${JSON.stringify(heroLines(nodes))}`);
    ok(!/left out/.test(t('#healthSub')), `and the health card leaves nothing out: ${t('#healthSub')}`);
  }

  /* ---- 4. a past period with no budget: unchanged wording, no button ---- */
  {
    const { nodes } = await renderDash(household(), { today: '2026-11-26', period: '2026-10' });
    const text = heroText(nodes);
    ok(/No budget was set for this period/.test(text), `the finished-period wording stands: ${text}`);
    ok(!nextBtn(nodes), 'a finished period offers no set-up button');
    ok(!heroLines(nodes).some(l => /Statements imported/.test(l)), 'imported past its end, it carries no line');
    eq(count(text, 'Total spent'), 1, `"Total spent" once here too: ${text}`);
  }

  /* ---- 5. the fund's own statements stop before the period ---- */
  {
    const { nodes } = await renderDash(household(), { today: '2026-11-26', period: '2026-11' });
    const text = heroText(nodes);
    ok(!/R 0 of R 2 000 saved so far/.test(text), `no "R 0 … saved so far" when the fund\'s rows stop before the period: ${text}`);
    ok(/R 2 000 for savings — fund statements stop on Sep 25, so what was saved cannot be seen yet/.test(text),
      `the set-aside amount stays, and the reason is named: ${text}`);

    const imported = await renderDash(household({ fundTo: '2026-11-15' }), { today: '2026-11-26', period: '2026-11' });
    ok(/R 2 000 of R 2 000 saved so far/.test(heroText(imported.nodes)),
      `NEGATIVE CONTROL: the fund imported, the ordinary sentence: ${heroText(imported.nodes)}`);

    const reachedNothing = await renderDash(household({
      fundTo: '2026-11-15',
      fundRows: [['2026-07-25', 'From cheque', 'Transfer', 2000], ['2026-11-10', 'Interest', 'Salary', 5]],
    }), { today: '2026-11-26', period: '2026-11' });
    ok(/R 0 of R 2 000 saved so far/.test(heroText(reachedNothing.nodes)),
      `a fund imported into the period that received nothing really reads R 0: ${heroText(reachedNothing.nodes)}`);
  }

  console.log(`PASS dashboard-statements-reach (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
