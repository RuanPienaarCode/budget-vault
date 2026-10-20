'use strict';
/* The Loan calculators, read the way a South African household reads them.

   Five findings of the 20 Oct 2026 audit (lanes D1, D2, M2), one block each,
   through the REAL view with the REAL formatter and the ZA locale
   (tests/helpers/figures.cjs mountFor). Nothing here is anyone's real loan.

   - M2-13: with "Include estimated insurance" ticked, "Total per month"
     carried the insurance and "Total cost of ownership" did not — a monthly
     cost that never reached the term total built from the same rows.
   - D2-16 / D1-19: "Monthly repayment" was the green celebratory gradient,
     and "Total per month", "Cash needed upfront" and "Balloon due" were rose.
     They are costs, neither good news nor overspend; the Debt page's "Paying
     per month" is neutral, and rose is kept for over and short.
   - D2-18 / D1-13: the amortisation tables printed whole rands in a table.
   - D2-07: the deposit readout said "13.3%", and the ZA rate hint "11.00%",
     on a page whose money says "R 1 350 000,00".
   - D2-26: the statutory notes quoted "R5 250" and "R60" by hand, beside
     money()'s "R 5 250".

     node tests/loans-printed-figures.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend, readable } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const B = 'Budget';
const FILES = { [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' };

const byClass = (root, cls) => descend(root).filter(n => n._cls && n._cls.has(cls));
/* label -> { text, cls } for every result row in a card. */
const rows = node => {
  const out = new Map();
  for (const r of byClass(node, 'lo-row')) {
    const v = byClass(r, 'lo-v')[0];
    out.set(byClass(r, 'lo-l')[0].textContent, { text: v.textContent, cls: v._cls });
  }
  return out;
};
// "R 1 234 567" -> 1234567, for the one block that has to do arithmetic on a printed figure.
const rands = s => Number(readable(s).replace(/[^\d,]/g, '').replace(',', '.'));

(async () => {
  const unpin = pinClock('2026-10-20');
  try {
    const { ctx, nodes } = await mountFor(FILES, { period: '2026-10', budgetFolder: B });
    ctx.renderLoans();
    const carForm = nodes.get('#loanCarForm');
    const inputs = descend(carForm).filter(n => n.tagName === 'INPUT');
    const insurance = inputs.find(n => n.attrs.type === 'checkbox');
    const balloon = inputs.filter(n => n.attrs.type === 'range').find(n => !n.attrs['aria-label']);

    /* ---- M2-13: insurance reaches the total cost of ownership ---- */
    {
      const before = rows(nodes.get('#loanCarOut'));
      insurance.checked = true; insurance._fire('change');
      const after = rows(nodes.get('#loanCarOut'));
      const premium = after.get('Insurance (rough estimate)');
      ok(premium, 'sanity: ticking the box adds the insurance row');
      const months = 60;   // the calculator's default term
      eq(rands(after.get('Total cost of ownership').text) - rands(before.get('Total cost of ownership').text),
        rands(premium.text) * months,
        'the total cost of ownership grows by the insurance for every month of the term, as "Total per month" already does');
    }

    /* ---- D2-16 / D1-19: costs in neutral ink ---- */
    {
      balloon.value = '20'; balloon._fire('input');
      const home = rows(nodes.get('#loanHomeOut'));
      const car = rows(nodes.get('#loanCarOut'));
      for (const [card, label] of [[home, 'Monthly repayment'], [home, 'Total per month'], [home, 'Cash needed upfront'],
        [car, 'Monthly instalment'], [car, 'Total per month'], [car, 'Balloon due at the end']]) {
        const r = card.get(label);
        ok(r, `sanity: the "${label}" row is drawn`);
        for (const tone of ['grad-txt', 'text-danger', 'text-success']) {
          ok(!r.cls.has(tone), `"${label}" is a cost, printed in neutral ink — it carries ${tone}`);
        }
      }
      ok(home.get('Monthly repayment').cls.has('lo-big'), 'the repayment is still the headline size, just not green');
    }

    /* ---- D2-18 / D1-13: the amortisation tables keep cents ----
       The headline estimates above stay whole rands (a calculator's answer
       is an estimate); a schedule row is a table figure. */
    for (const id of ['#loanHomeAmort', '#loanCarAmort']) {
      const body = descend(nodes.get(id)).find(n => n.tagName === 'TBODY');
      const cells = body.children.flatMap(tr => tr.children.slice(1).map(td => td.textContent));
      ok(cells.length >= 4, `sanity: ${id} has schedule rows`);
      for (const c of cells) ok(/^R [\d ]+,\d{2}$/.test(c), `${id}: a schedule cell prints cents — got "${c}"`);
    }

    /* ---- D2-07: the deposit share and the rate hint in the household's decimal mark ---- */
    {
      const homeForm = nodes.get('#loanHomeForm');
      const amount = descend(homeForm).find(n => n.attrs['aria-label'] === 'Deposit amount');
      amount.value = '200000'; amount._fire('input');
      const label = descend(homeForm).find(n => n._cls.has('lf-l') && /^Deposit/.test(n.textContent));
      eq(label.textContent, 'Deposit — 13,3%', 'R200 000 down on R1 500 000 reads "13,3%", not "13.3%"');
      const hint = byClass(homeForm, 'lf-h').map(n => n.textContent).find(t => /defaults to/.test(t));
      ok(hint && hint.includes('defaults to 11,00%'), `the rate hint quotes its default in the decimal comma — got "${hint}"`);
    }

    /* ---- D2-26: the statutory notes format money the way money() does ---- */
    {
      const costs = readable(nodes.get('#loanHomeCostsSub').textContent);
      const fees = readable(nodes.get('#loanCarFeesSub').textContent);
      for (const [where, text] of [['home costs note', costs], ['vehicle fees note', fees]]) {
        ok(!/R\d/.test(text), `${where}: no hand-spaced "R5 250" — got "${text}"`);
      }
      ok(costs.includes('initiation R 5 250 + VAT, monthly service fee R 60 + VAT'),
        `the home costs note quotes the caps as money() prints them — got "${costs}"`);
      for (const want of ['R 1 100 plus 10% above R 10 000, capped at R 5 250 + VAT (R 6 038)',
        'R 165 plus 10% above R 1 000, capped at R 1 050 + VAT (R 1 208)',
        'monthly service fee R 60 + VAT (R 69)']) {
        ok(fees.includes(want), `the vehicle fees note reads "${want}" — got "${fees}"`);
      }
    }

    /* ---- the generic profile speaks the same contract ----
       The notes are functions of the view's formatters now, for every
       profile; a country the app has no tariffs for still gets its hint, and
       still no costs card. */
    {
      const us = await mountFor({ [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "$"\ncountry: us\n---\n' },
        { period: '2026-10', budgetFolder: B });
      us.ctx.renderLoans();
      const hints = byClass(us.nodes.get('#loanHomeForm'), 'lf-h').map(n => n.textContent);
      ok(hints.includes('Enter the annual interest rate your lender quoted.'), `the generic rate hint is drawn — got ${JSON.stringify(hints)}`);
      ok(us.nodes.get('#loanHomeCostsCard')._cls.has('hidden'), 'and the buying-costs card stays hidden');
    }
  } finally {
    unpin();
  }
  console.log(`PASS loans-printed-figures — insurance in the total cost, costs in neutral ink, schedules in cents, decimals in the household's mark, statutory notes formatted like money() (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
