'use strict';
/* A pass-through pair drops two ROWS, not every row that looks like them
   (2026-10-07 audit, L2a-09).

   The HOUSEHOLD lens drops the second leg of money already counted once: an
   Excluded outflow on one account and an equal Excluded inflow on another,
   each used once. passthroughPairs() found the pairs correctly, but it handed
   back a set of KEYS — `label|date|amount|description` — and stamp() then
   marked every row whose key was in the set. Two identical Excluded rows on one
   account (two R500 gifts on the same day, written the same way) share a key,
   so pairing ONE of them with an inflow elsewhere dropped BOTH, and real
   household spending vanished from the Score's essential and consumption
   figures. No real vault the audit read (2022–2026) holds such a collision
   today; the rule is wrong all the same, and the fix is to mark the paired rows
   themselves.

   Pure stamp()/tally() first, then the same shape through the REAL loader and
   healthSnapshot(), clock pinned. Synthetic rows.

     node tests/passthrough-pairs-by-row.test.cjs */
const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { atAuditDate } = require('./_audit-seed.cjs');
const { stamp, tally, LENSES } = require('../src/ledger');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); checks++; };

const env = { catType: c => (c === 'Gifts' ? 'expense' : null), catKnown: c => c === 'Gifts' };
const gift = (label, amount) => ({ label, date: '2026-08-05', desc: 'Birthday gift', cat: 'Gifts', amount, excluded: true });

/* ---- 1. identical twins: one paired, one still spending ---------------- */
{
  const rows = [gift('Cheque', -500), gift('Cheque', -500), gift('Savings', 500)];
  const s = stamp(rows, env);
  eq(s.filter(x => x.passthrough).length, 2, 'one pair is two rows: one twin and its opposite leg');
  eq(s.map(x => x.passthrough), [true, false, true], 'the FIRST twin pairs (pairing is in row order, as before); the second is untouched');
  near(tally(s, LENSES.HOUSEHOLD).spendByCat.Gifts || 0, 500, 'so R500 of household spending survives — it read R0 when pairing went by key');
}

/* ---- 2. negative control: a plain pair is still dropped whole ---------- */
{
  const s = stamp([gift('Cheque', -500), gift('Savings', 500)], env);
  eq(s.map(x => x.passthrough), [true, true], 'negative control: the two legs of one movement are both dropped');
  near(tally(s, LENSES.HOUSEHOLD).spendByCat.Gifts || 0, 0, 'and nothing is left of it to count');
}

/* ---- 3. twins on both sides pair one-for-one ----------------------------- */
{
  const s = stamp([gift('Cheque', -500), gift('Cheque', -500), gift('Savings', 500), gift('Savings', 500)], env);
  eq(s.filter(x => x.passthrough).length, 4, 'two outflows and two inflows make two pairs, every row used once');
  near(tally(s, LENSES.HOUSEHOLD).spendByCat.Gifts || 0, 0, 'so the household spent nothing here');
}

/* ---- 4. a same-account match never pairs, by row as by key --------------- */
{
  const s = stamp([gift('Cheque', -500), gift('Cheque', 500)], env);
  eq(s.map(x => x.passthrough), [false, false], 'two legs on ONE account are two events, never a pass-through');
}

/* ---- 5. through the real loader and the Score's snapshot ---------------- */
const B = 'Budget';
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const table = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |  |`).join('\n') + '\n';
const files = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Gifts.md`]: '---\ntype: expense\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 9000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  [`${B}/Accounts/Savings.md`]: '---\ntype: savings\nbalance: 9000.00\nbalance_updated: 2026-08-01\ntx_label: "Savings"\n---\n',
};
for (const m of MONTHS) {
  files[`${B}/Transactions/Cheque/${m}.md`] = table([
    [`${m}-01`, 'Salary', 'Salary', 20000],
    [`${m}-05`, 'Birthday gift', 'Gifts', -500, 'yes'],
    [`${m}-05`, 'Birthday gift', 'Gifts', -500, 'yes'],
  ]);
  files[`${B}/Transactions/Savings/${m}.md`] = table([[`${m}-05`, 'Birthday gift', 'Gifts', 500, 'yes']]);
}

atAuditDate(async () => {
  const ctx = makeCtx(files, { budgetFolder: B, settings: { month_start_day: 1, currency: 'R', country: 'za' } });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  const st = ctx.ledger('2026-07-01', '2026-07-31');
  eq(st.filter(s => s.passthrough).length, 2, 'real loader: two identical rows in one file are two rows, and only one of them pairs');
  const H = ctx.healthSnapshot().metrics;
  near(H.monthlyEssential, 500, 'the Score\'s essential spend keeps the unpaired twin');
  near(H.monthlyConsumption, 500, 'and so do its living costs');
  ok(H.monthlyEssential > 0, 'not the R0 a key-based pairing read');
  console.log(`PASS passthrough-pairs-by-row (${checks} checks)`);
}, '2026-08-15').catch(e => { console.error(e); process.exit(1); });
