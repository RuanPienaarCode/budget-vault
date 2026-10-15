'use strict';
/* One helper writes a signed part of a sum (Wave B, lane B4; the 14 Oct 2026
   audit's "two implementations of one rule" leftover).

   Fix wave A landed TWO: figures.js signedPart(format, v, decimals), which the
   Dashboard used, and currency.js formatSigned(symbol, v, decimals, loc), which
   the Score used. They agreed on every input, which is exactly why nobody
   noticed there were two - until one gained a rule the other lacked. The
   survivor is formatSigned: it takes its digits through
   module.exports.formatAmount, so the numbers-ledger recorder still sees the
   amount as money. figures.js no longer carries a copy.

   This pins three things: the second implementation is gone; both pages that
   print a signed part require the one in currency.js; and the Dashboard's
   what's-left confirmation-day net, rendered for real, reads exactly what
   formatSigned says for that value (primary currency, with the household's own
   marks). The Score half of the form is pinned in tests/score-flow-one-rule.test.cjs
   and tests/score-household-decimal-and-signed-form.test.cjs.

     node tests/signed-money-one-helper.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { B, tx, base, account, renderDash } = require('./helpers/dash-audit.cjs');
const { formatSigned } = require('../src/currency');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

/* ---- one definition ---- */
{
  eq(Object.keys(require('../src/figures')).includes('signedPart'), false, 'figures.js no longer exports a second signed-money helper');
  const defs = fs.readdirSync(path.join(__dirname, '..', 'src'), { recursive: true })
    .filter(f => f.endsWith('.js'))
    .filter(f => /function\s+(formatSigned|signedPart|signedMoney)\b|\bsignedPart\s*=|\bformatSigned\s*=/.test(src(f)));
  eq(defs, ['currency.js'], 'exactly one file defines a signed-money function: currency.js');
  ok(/formatSigned[^;]*\}\s*=\s*require\('\.\.\/currency'\)/.test(src('views/dashboard.js')), 'the Dashboard takes formatSigned from currency.js');
  ok(/formatSigned[^;]*\}\s*=\s*require\('\.\.\/currency'\)/.test(src('views/score.js')), 'and so does the Score');
  ok(!/signedPart/.test(src('views/dashboard.js') + src('figures.js')), 'no caller is left on the old name');
}

/* ---- the Dashboard prints what the helper says ---- */
(async () => {
  const za = { thousands: ' ', decimal: ',' };
  for (const [rent, gym] of [[2500, 300], [14000, 765], [40, 20]]) {
    const net = -(rent + gym);
    const r = await renderDash({
      ...base(),
      [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '99000.00', balance_updated: '2026-09-10' }),
      [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-10', 'Rent', 'Groceries', -rent], ['2026-09-10', 'Gym', 'Groceries', -gym]]),
    }, { today: '2026-09-20', period: '2026-09' });
    const want = formatSigned('R', net, 0, za);
    ok(r.t('#leftBody').includes(`2 rows on a confirmation day (${want})`), `the net ${net} reads ${want} - got: ${r.t('#leftBody')}`);
  }
  console.log(`PASS signed-money-one-helper - one signed-money helper (currency.js formatSigned), the Dashboard's confirmation-day net prints exactly its form (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
