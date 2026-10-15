'use strict';
/* The Savings page's Growth tile carries the caveat its cards carry, and a card
   without a starting amount names the opening it could not record (audit
   2026-10-14, L2a-N06, L2a-N13, and the Savings half of L2a-N09).

   N06. Each card says "growth may be overstated" when the account's records
   begin long after it opened (or none exist), because every rand the records
   miss is read as growth. The Growth tile pools those same accounts and printed
   the flattering total with none of the warning.

   N13. A card with no starting amount printed put in / growth / taken out that
   did not add up to the balance above them and named nothing for the rest. The
   rest is what the account held before its records begin — accountFlows'
   `opening`, the figure that makes the identity hold — and is now printed.

   N09. A rate printed "+25.0%" where the household's decimal mark is a comma.

   The REAL Savings view over a synthetic vault, the clock pinned.

     node tests/savings-tile-and-card-honesty.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock, leaves, ownText } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const TODAY = '2026-10-14';
const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const tx = rows => HEAD + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} |  |  |  |\n`).join('');
const acct = (name, fm) => ({ [`${B}/Accounts/${name}.md`]: `---\ntype: investment\ntx_label: "${name}"\n${fm}\n---\n` });

const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Interest.md`]: '---\ntype: income\ninterest: true\ncolor: "#27ae60"\n---\n',
  /* On time: records begin the month it opened. */
  ...acct('On Time', 'balance: 12000.00\nbalance_updated: 2026-10-01\nstarting_amount: 10000.00\ninception_date: 2026-01-01'),
  [`${B}/Transactions/On Time/2026-01.md`]: tx([['2026-01-05', 'Debit order', '', 1000]]),
  /* Late: opened 1 Jan, first record 1 Jun (155 days after). */
  ...acct('Late Start', 'balance: 20000.00\nbalance_updated: 2026-10-01\nstarting_amount: 10000.00\ninception_date: 2026-01-01'),
  [`${B}/Transactions/Late Start/2026-06.md`]: tx([['2026-06-05', 'Debit order', '', 2000]]),
  /* None: opened long ago, no record at all. */
  ...acct('No Records', 'balance: 11000.00\nbalance_updated: 2026-10-01\nstarting_amount: 10000.00\ninception_date: 2026-01-01'),
  /* No starting amount: put in 600, growth none; the balance is 1 000. */
  ...acct('Derived', 'balance: 1000.00\nbalance_updated: 2026-10-10\ninception_date: 2026-09-01'),
  [`${B}/Transactions/Derived/2026-09.md`]: tx([['2026-09-05', 'Debit order', '', 400], ['2026-09-20', 'Debit order', '', 200]]),
};

const flat = n => String(n.textContent).replace(/\s+/g, ' ').trim();
const hasCls = (e, c) => !!(e._cls && e._cls.has(c));

async function render(files) {
  const unpin = pinClock(TODAY);
  try {
    const { ctx, nodes } = await mountFor(files, { period: '2026-10' });
    ctx.switchView = () => {};
    ctx.renderSavings();
    return { ctx, nodes };
  } finally { unpin(); }
}

(async () => {
  const { nodes } = await render(FILES);
  const tile = descend(nodes.get('#savingsKpis')).filter(n => hasCls(n, 'mini')).map(flat).find(t => t.startsWith('Growth'));
  ok(tile, 'a Growth tile is drawn');

  /* N06: two of the three measured accounts are the ones the cards flag. */
  const card = name => descend(nodes.get('#savingsSections')).find(n => hasCls(n, 'mini')
    && String(n.children[0] && n.children[0].textContent) === name);
  ok(/records begin 155 days after it opened — growth may be overstated/.test(flat(card('Late Start'))), 'the Late Start card carries its caveat');
  ok(/no transactions recorded in the \d+ days since it opened — growth may be overstated/.test(flat(card('No Records'))), 'the No Records card carries its caveat');
  ok(!/may be overstated/.test(flat(card('On Time'))), 'the On Time card carries none');
  ok(/2 of 3 may be overstated — records start late/.test(tile), `the tile carries the cards\' caveat, counting the same accounts (got "${tile}")`);

  /* …and a tile with nothing late says nothing. */
  const clean = { ...FILES };
  for (const k of Object.keys(clean)) { if (/Late Start|No Records/.test(k)) { delete clean[k]; } }
  const { nodes: n2 } = await render(clean);
  const tile2 = descend(n2.get('#savingsKpis')).filter(n => hasCls(n, 'mini')).map(flat).find(t => t.startsWith('Growth'));
  ok(tile2 && !/may be overstated/.test(tile2), `no late records, no caveat on the tile (got "${tile2}")`);

  /* N09: the rate uses the household's decimal comma. */
  ok(/[+-]\d+,\d% on /.test(tile), `the tile\'s rate uses the household\'s decimal mark (got "${tile}")`);
  ok(!/[+-]\d+\.\d% /.test(tile), 'and not a point');

  /* N13: the Derived card's line is a sum a reader can finish. */
  const d = flat(card('Derived'));
  ok(/put in R 600/.test(d), `the card states what the records put in (got "${d}")`);
  ok(/R 400 before your records begin/.test(d), `and the opening the records do not hold: 1 000 - 600 (got "${d}")`);

  /* Records that add up to MORE than the balance: no negative opening is named. */
  const over = { ...FILES, ...acct('Over', 'balance: 500.00\nbalance_updated: 2026-10-10\ninception_date: 2026-09-01'),
    [`${B}/Transactions/Over/2026-09.md`]: tx([['2026-09-05', 'Debit order', '', 400], ['2026-09-20', 'Debit order', '', 200]]) };
  const { nodes: n4 } = await render(over);
  const o = flat(descend(n4.get('#savingsSections')).find(n => hasCls(n, 'mini') && String(n.children[0] && n.children[0].textContent) === 'Over'));
  ok(/its records add up to R 100 more than the balance/.test(o), `a negative opening is said in words (got "${o}")`);
  ok(!/before your records begin/.test(o), 'and is never printed as a negative opening balance');

  /* A card whose records do begin at the start has nothing before them. */
  const even = { ...FILES, ...acct('Even', 'balance: 600.00\nbalance_updated: 2026-10-10\ninception_date: 2026-09-01'),
    [`${B}/Transactions/Even/2026-09.md`]: tx([['2026-09-05', 'Debit order', '', 400], ['2026-09-20', 'Debit order', '', 200]]) };
  const { nodes: n3 } = await render(even);
  const e = flat(descend(n3.get('#savingsSections')).find(n => hasCls(n, 'mini') && String(n.children[0] && n.children[0].textContent) === 'Even'));
  ok(!/before your records begin/.test(e), `when the records explain the whole balance nothing is named (got "${e}")`);

  console.log(`PASS savings-tile-and-card-honesty (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
