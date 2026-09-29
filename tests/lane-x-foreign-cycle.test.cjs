'use strict';
/* A foreign band inside a settlement cycle says the card is owed
   (2026-09-29 audit).

   Inside a cycle the settle card leaves `free` (it is measured against the
   income that clears it), and the band prints `committedShown`, which leaves it
   out too - so "cash 6 000 · committed 0 · free 6 000" said nothing about a
   euro card carrying 500. The home chain answers with the cycle line ("X on
   the card this cycle, of the Y that settles it" and the headroom sentence);
   the band now carries the same two sentences, from the same keys, in its own
   symbol. No new key.

     node tests/lane-x-foreign-cycle.test.cjs */
const assert = require('assert');
const { B, tx, base, account, find, hasClass, textOf, renderDash } = require('./helpers/dash-audit.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

(async () => {
  const months = ['2026-04', '2026-05', '2026-06', '2026-07'];
  const files = (euroCard = true) => ({
    ...base(),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '9000.00', balance_updated: '2026-07-14' }),
    [`${B}/Accounts/EuroSave.md`]: account('EuroSave', { currency: '"€"', balance: '6000.00', balance_updated: '2026-07-14' }),
    ...(euroCard ? {
      [`${B}/Accounts/EuroCard.md`]: account('EuroCard', { type: 'credit_card', settle_monthly: 'true', currency: '"€"', balance: '-500.00', balance_updated: '2026-07-14' }),
      [`${B}/Transactions/EuroCard/2026-07.md`]: tx([['2026-07-06', 'Lidl', 'Groceries', -500]]),
    } : {}),
    ...Object.fromEntries(months.map(m => [`${B}/Transactions/EuroSave/${m}.md`, tx([[`${m}-25`, 'Payday', 'Salary', 4000]])])),
  });
  const bandOf = M => find(M.nodes.get('#leftBody'), n => hasClass(n, 'left-fx-txt')).map(textOf);

  {
    const M = await renderDash(files(), { today: '2026-07-15', period: '2026-07' });
    const bands = bandOf(M);
    eq(bands.length, 1, 'one foreign band');
    const txt = bands[0].replace(/[  ]/g, ' ');
    ok(/€ ?500 on the card this cycle, of the € ?4 000 that settles it/.test(txt), `the band states the card spend against the settling income: ${txt}`);
    ok(/€ ?3 500 of headroom before the 2026-08-25 settlement\./.test(txt), `and the headroom, in euro: ${txt}`);
    ok(!/R ?\d/.test(txt), 'with no rand anywhere in a euro band');
    /* The three balancing terms are untouched. */
    ok(/in your accounts € ?6 000/.test(txt) && /actually free € ?6 000/.test(txt), `cash and free are as before: ${txt}`);
  }

  /* No card, no cycle line: a band is not decorated where nothing is owed. */
  {
    const M = await renderDash(files(false), { today: '2026-07-15', period: '2026-07' });
    const txt = bandOf(M).join(' ');
    ok(!/on the card this cycle/.test(txt), 'a euro band with no settle card prints no cycle line');
  }

  /* Over: the card outspent the salary that settles it. */
  {
    const f = files();
    f[`${B}/Transactions/EuroCard/2026-07.md`] = tx([['2026-07-06', 'Lidl', 'Groceries', -5000]]);
    const M = await renderDash(f, { today: '2026-07-15', period: '2026-07' });
    const txt = bandOf(M)[0].replace(/[  ]/g, ' ');
    ok(/€ ?1 000 MORE than the income that settles it on 2026-08-25\./.test(txt), `the over case uses the over sentence: ${txt}`);
  }

  console.log(`PASS - lane X, foreign band discloses its own settlement cycle (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
