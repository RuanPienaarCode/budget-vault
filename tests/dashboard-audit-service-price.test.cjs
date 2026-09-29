'use strict';
/* "Last charged" must be the service's LAST charge (2026-09-29 totals audit).

   recurring.js kept only the description group with the largest LIFETIME
   total, and both committed.js (the amount) and the Dashboard (the "last
   charged" it prints) took the median of that group's last three charges. A
   merchant that renames its debit order leaves that group behind with the
   history while the money moves to a newer one. On the vault audited:

     - a phone contract printed "last charged" at the price of an old
       description (whose final charge was months back) while the current
       debit order was higher;
     - a hosting subscription printed the dominant group's price while its
       latest charge, which had fallen in a variant of the description, was
       different;
     - "still committed" came out light by the difference.

   Pinned on synthetic services that rename their description mid-history. The
   figures are invented; the SHAPE (a bigger old group, a newer smaller one) is
   what the audit measured.

   `matchCharges().charges` keeps its contract — the dominant group by
   lifetime total, which the Services page and tests/recurring.test.cjs read —
   and the new `current` field carries the answer to "what does it cost now".

     node tests/dashboard-audit-service-price.test.cjs */
const assert = require('assert');
const { B, tx, base, account, figNumber, renderDash, textOf: t2, pinClock, mountFor } = require('./helpers/dash-audit.cjs');
const { matchCharges, chargeStats } = require('../src/recurring');
const { serviceCommitments } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const chg = (date, amount, desc) => ({ date, amount: -amount, desc, cat: 'Phone' });
const svc = (name, provider) => ({ name, provider, amount: 0, cycle: 'monthly', active: true });
const monthly = (desc, amount, from, to) => {
  const out = [];
  for (let y = 2025, m = 1; ; m++) {
    if (m > 12) { m = 1; y++; }
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k < from) continue;
    if (k > to) break;
    out.push(chg(`${k}-08`, amount, desc));
  }
  return out;
};

/* ---- 1. a rename mid-history: the newer group is the current price ---------- */
{
  const rows = [
    ...monthly('MOBILECO DEBIT ORDER', 511.90, '2025-06', '2026-02'),   // 9 charges, the big old group
    ...monthly('MOBILECO MINI APPS PMT', 548.30, '2026-07', '2026-08'), // 2 charges, current
  ];
  const m = matchCharges(svc('Airtime and Data', 'MobileCo'), rows);
  eq(m.charges.length, 9, 'contract kept: `charges` is still the dominant group by lifetime total');
  eq(chargeStats(m.charges).recent, 511.90, '…and reads the old price (why the audit found it)');
  eq(m.current.length, 2, '`current` is the group charged most recently');
  eq(chargeStats(m.current).recent, 548.30, 'so the price is what the merchant takes now');
  eq(chargeStats(m.current).last, '2026-08-08', 'and its last charge is the real last charge');
}

/* ---- 2. one charge in a variant description is still the latest charge ------ */
{
  const rows = [
    ...monthly('WEBHOST.COM', 471.20, '2025-09', '2026-07'),
    chg('2026-08-08', 468.05, 'WEBHOST.COM USD'),
  ];
  const m = matchCharges(svc('Hosting', 'WebHost'), rows);
  eq(chargeStats(m.charges).recent, 471.20, 'the dominant group still says 471.20');
  eq(chargeStats(m.current).recent, 468.05, 'the latest charge is the one that was actually taken');
}

/* ---- 3. a rider fee never takes the price over ------------------------------- */
{
  for (const feeDay of ['15', '16']) {       // the same day, and the day after
    const rows = [];
    for (const m of ['03', '04', '05', '06']) {
      rows.push(chg(`2026-${m}-15`, 94.99, 'SpotifyZA 94.99 ZAR'));
      rows.push(chg(`2026-${m}-${feeDay}`, 2.37, 'Intl payment fee SpotifyZA'));
    }
    const m = matchCharges(svc('Spotify Couple', 'Spotify'), rows);
    eq(chargeStats(m.current).recent, 94.99, `a R2 fee posted on the ${feeDay}th is not the price`);
    eq(m.related.length, 1, 'and is still reported as related');
  }
}

/* ---- 4. a renamed order at an unrelated amount is left with the dominant ----- */
{
  const rows = [
    ...monthly('OLD PLAN', 200, '2025-06', '2026-02'),
    ...monthly('NEW PLAN', 900, '2026-07', '2026-08'),     // 4.5x: not the same kind of charge
  ];
  const m = matchCharges(svc('Thing', 'Thing'), rows);
  eq(m.current, m.charges, 'outside the band there is no way to tell it from a different charge: unchanged');
}

/* ---- 5. serviceCommitments carries the current price ------------------------- */
{
  const rows = [
    ...monthly('MOBILECO DEBIT ORDER', 511.90, '2025-06', '2026-02'),
    ...monthly('MOBILECO MINI APPS PMT', 548.30, '2026-07', '2026-08'),
  ];
  const [it] = serviceCommitments({
    services: [{ ...svc('Airtime and Data', 'MobileCo'), amount: 675 }],
    rows, from: '2026-09-05', to: '2026-09-30', periodStart: '2026-09-01',
  });
  eq([it.amount, it.basis], [548.30, 'charged'], 'the committed amount is the current debit order');
}

(async () => {
  /* ---- 6. …and the Dashboard prints it -------------------------------------- */
  const files = {
    ...base(),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-04' }),
    [`${B}/Services.md`]: '---\nkind: services\n---\n\n'
      + '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Currency |\n'
      + '|---|---|---:|---|---|---|---|---|---|\n'
      + '| Airtime and Data | MobileCo | 675.00 | monthly | 2026-09-08 | Phone | yes |  |  |\n',
  };
  const byMonth = {};
  for (const r of [
    ...monthly('MOBILECO DEBIT ORDER', 511.90, '2025-06', '2026-02'),
    ...monthly('MOBILECO MINI APPS PMT', 548.30, '2026-07', '2026-08'),
  ]) (byMonth[r.date.slice(0, 7)] = byMonth[r.date.slice(0, 7)] || []).push([r.date, r.desc, 'Phone', r.amount]);
  for (const [k, rows] of Object.entries(byMonth)) files[`${B}/Transactions/Cheque/${k}.md`] = tx(rows);

  const { nodes, t } = await renderDash(files, { today: '2026-09-05' });
  eq(figNumber(nodes.get('#leftBody'), 'left-committed'), 548, 'the hero commits the current price');
  const left = t('#leftBody');
  /* The row states the RULE the figure comes from. It used to read "last
     charged R548", but the price is the middle of the last three charges
     (recurring.js chargeStats, a double-bill guard), which is a different
     claim whenever the last charge is the odd one out. */
  ok(/usually about R ?548/.test(left), `and the disclosure row says so: ${left}`);
  ok(!/last charged/i.test(left), 'without claiming it is the LAST charge');
  ok(!/last actually charged/.test(left), '(the footnote under the list either)');
  ok(/usually charged \(the middle of the last three charges\)/.test(left), `and the footnote names the median rule: ${left}`);
  ok(!/512/.test(left), 'with no trace of the abandoned description\'s price');

  /* ---- 7. the Services page prices the service the same way ------------------
     The Services page read `m.charges` (the dominant group by lifetime total)
     while the Dashboard read `m.current`, so the same service was "really
     R512" on one page and R548 on the other. */
  {
    const unpin = pinClock('2026-09-05');
    let M;
    try { M = await mountFor(files, { period: '2026-09' }); M.ctx.renderServices(); } finally { unpin(); }
    const page = t2(M.nodes.get('#svcTable'));
    ok(/really R ?548/.test(page), `the Services page prices it at the current debit order: ${page}`);
    ok(!/really R ?512/.test(page), 'and not at the abandoned description');
  }

  /* ---- 8. every language states the rule, not "last charged" ----------------- */
  {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'src', 'lang');
    const en = require(path.join(dir, 'en.js'));
    eq(en['dash.left.lastCharged'], 'usually about {amount}', 'English states the median rule');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js') && n !== 'en.js')) {
      const t = require(path.join(dir, f));
      ok(t['dash.left.lastCharged'] && t['dash.left.lastCharged'] !== en['dash.left.lastCharged'], `${f} has its own dash.left.lastCharged`);
      ok(t['dash.left.lastCharged'].includes('{amount}'), `${f} keeps the amount`);
      ok(t['dash.left.source'] !== en['dash.left.source'], `${f} has its own dash.left.source`);
    }
  }

  console.log(`PASS dashboard-audit-service-price (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
