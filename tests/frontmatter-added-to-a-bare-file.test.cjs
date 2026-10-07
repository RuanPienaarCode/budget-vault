'use strict';
/* A file with no frontmatter gets one on a line of its own.

   io.patchFile writes `---\n${fm}\n---${body}` with no line break before the
   body, on the documented assumption that parseFrontmatter's `body` "starts
   immediately after the closing fence and keeps its own leading break". For a
   file that HAS a block that is true: the body is sliced right after `---`,
   and the line break that ends the fence line comes with it. For a file with
   NO block it was not — the body was the whole text, starting with whatever
   the household's first line was — so the first frontmatter this app added
   to a hand-written note was glued to that line (2026-10-07 audit, L3-07):

       Categories/Snacks.md, "# Snacks" + the Budget page's Fixed toggle
         ->  ---\nfixed: true\n---# Snacks
       Accounts/Wallet.md, hand-made, + its first balance edit
         ->  ---\ntype: other\nbalance: 250.00\nbalance_updated: …\n---# Wallet

   `---# Snacks` is not a closing fence — a fence is a line of its own — so
   Obsidian saw no properties on the file at all, while this module's own lazy
   regex still found the block, so nothing inside the app noticed.
   views/notes.js's splitFm already supplied the missing break for the notes
   it re-points; parseFrontmatter now does the same for every caller, which is
   where the assumption lives.

   The same missing break made a bare file READ wrongly, not only write
   wrongly: load.js's section() and markdown.js's extraContent find a `##`
   heading by the line break in front of it, and a plan whose very first line
   was `## Money in` had none — its sources table never loaded, and the next
   save wrote an empty Money in table under the rows it had replayed as prose.

   Four claims:

     1. parseFrontmatter: a file with no block reads as the line break the
        fence needs, then the file's own text verbatim; every file that HAS a
        block gets exactly the body it always did; an empty file still reads
        as '' (there is no first line to glue anything to),
     2. the Fixed toggle on a bare category note writes the fence on its own
        line and leaves the note's text exactly as it was below it,
     3. a bare account saved through saveAccount's rebuild branch gets the same,
     4. a bare plan that opens on `## Money in` loads that table, and keeps it
        as a table through a save and a reload.

   Runs the REAL loader, categories module, budgets view, accounts view and
   plan view over the shared DOM stub — vault-roundtrip.test.cjs's rule.

     node tests/frontmatter-added-to-a-bare-file.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { parseFrontmatter, patchFrontmatter } = require('../src/markdown');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
/* A closing fence is `---` at the start of a line, followed by the end of that
   line (or of the file). The lazy /\n---/ this module itself matches with is
   exactly what let `---# Snacks` pass unnoticed, so the check here is the
   stricter, line-shaped one. */
const fenceOnItsOwnLine = t => /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.test(t);

/* ---- 1: the body ----------------------------------------------------------- */

eq(parseFrontmatter('# Snacks\n\nBiltong and the like.\n').body, '\n# Snacks\n\nBiltong and the like.\n',
  'no block: the body is the fence\'s line break, then the file\'s own text, verbatim');
eq(parseFrontmatter('# Snacks\n').raw, '', 'and there is no block to patch');
eq(`---\n${patchFrontmatter('', { fixed: 'true' })}\n---${parseFrontmatter('# Snacks\n').body}`,
  '---\nfixed: true\n---\n# Snacks\n', 'so io.patchFile\'s own template puts the closing fence on a line of its own');
eq(parseFrontmatter('\n# Snacks').body, '\n\n# Snacks',
  'a household\'s own leading blank line is kept, not spent as the fence\'s line break');
eq(parseFrontmatter('kind: x\n---\n').body, '\nkind: x\n---\n',
  'text with no OPENING fence is not a block, and is kept whole');
eq(parseFrontmatter('').body, '', 'an empty file reads as an empty body — nothing to glue to');
eq(parseFrontmatter('\uFEFF').body, '', 'and so does a file holding only a byte-order mark');

/* Every file that HAS a block: exactly the body it always had. */
for (const [text, body] of [
  ['---\nk: v\n---\n\n# X\n', '\n\n# X\n'],
  ['---\nk: v\n---\n# X', '\n# X'],
  ['---\r\nk: v\r\n---\r\n# X\r\n', '\r\n# X\r\n'],
  ['---\nk: v\n---', ''],
  ['---\nk: v\n---\n', '\n'],
  ['\uFEFF---\nk: v\n---\nbody', '\nbody'],
  ['---\nk: v\nother: "a: b"\n---\n\n| a | b |\n|---|---|\n', '\n\n| a | b |\n|---|---|\n'],
]) {
  eq(parseFrontmatter(text).body, body, `a file with a block keeps its body byte for byte — ${JSON.stringify(text)}`);
}

/* ---- 2-4: through the real views ------------------------------------------ */

async function mount(files, period) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = period;
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.render = () => {};
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  require('../src/views/budgets')(ctx);
  require('../src/views/accounts')(ctx);
  require('../src/views/plan')(ctx);
  return { ctx, S, $ };
}

const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const SNACKS = '# Snacks\n\nBiltong and the like.\n';
const WALLET = '# Wallet\n\nCash in my pocket.\n';
const BONUS =
  '## Money in\n\n| Source | Kind | Amount | Date | Status | Notes |\n|--------|------|-------:|------|--------|-------|\n'
  + '| Bonus | Work | 5000.00 |  | received |  |\n\n'
  + '## Envelopes\n\n| Envelope | Amount | Note | Tint |\n|----------|-------:|------|------|\n'
  + '| Holiday | 5000.00 |  |  |\n\n'
  + '## Items\n\n| Item | Envelope | Amount | Spent | Status | Category | Notes |\n'
  + '|------|----------|-------:|------:|--------|----------|-------|\n';

(async () => {
  const files = {
    [`${B}/Settings.md`]: SETTINGS,
    [`${B}/Categories/Snacks.md`]: SNACKS,
    [`${B}/Accounts/Wallet.md`]: WALLET,
    [`${B}/Plans/Bonus.md`]: BONUS,
    [`${B}/Budgets/2026-10.md`]: '---\nperiod: 2026-10\n---\n\n# Budget — 2026-10\n\n'
      + '| Category | Type | Amount | Notes |\n|----------|------|-------:|-------|\n| Snacks | expense | 100.00 |  |\n',
  };
  const { ctx, S, $ } = await mount(files, '2026-10');

  /* ---- 2: the Fixed toggle on a bare category note ---- */
  ctx.renderBudgets();
  const btn = $('#budTable').querySelector(`[aria-label="${i18n.t('bud.aria.fixed', { category: 'Snacks' })}"]`);
  ok(!!btn, 'the Budget page renders a Fixed toggle for the bare category');
  btn.click();
  await new Promise(r => setImmediate(r));
  const cat = ctx.vault._store.get(`${B}/Categories/Snacks.md`);
  eq(cat, `---\nfixed: true\n---\n${SNACKS}`,
    'the toggle adds a block whose closing fence ends its own line, and the note below it is untouched');
  ok(fenceOnItsOwnLine(cat), 'so the block is one a line-shaped frontmatter reader sees');
  ok(S.categories.find(c => c.name === 'Snacks').fixed === true, 'and the flag took in memory');

  /* ---- 3: a bare account through saveAccount's rebuild branch ---- */
  const wallet = S.accounts.find(a => a.name === 'Wallet');
  ok(!!wallet && !wallet.fmRaw, 'the hand-made account loaded with no frontmatter to patch');
  wallet.balance = 250; wallet.balanceRaw = null; wallet.balance_updated = '2026-10-07';
  ok(await ctx.saveAccount(wallet), 'the save lands');
  const acct = ctx.vault._store.get(`${B}/Accounts/Wallet.md`);
  ok(fenceOnItsOwnLine(acct), 'the rebuilt block closes on a line of its own');
  ok(acct.endsWith(`\n---\n${WALLET}`), 'and the account note\'s own text follows it, exactly as it was');

  /* ---- 4: a bare plan that opens on its first table ---- */
  const plan = S.plans.Bonus;
  eq(plan.sources.length, 1, 'a bare plan whose first line is `## Money in` loads that table');
  eq(plan.sources[0].name, 'Bonus', 'with the row it holds');
  S.planName = 'Bonus';
  const saved = ctx.serializePlan('Bonus');
  eq((saved.match(/\| Bonus \| Work \| 5000\.00 \|/g) || []).length, 1,
    'the save writes the row once, under its heading — not again as replayed prose');
  const again = makeCtx({ ...files, [`${B}/Plans/Bonus.md`]: saved });
  const S2 = await loadInto(again);
  eq(S2.plans.Bonus.sources.length, 1, 'and the reloaded file still holds it as a table row');
  eq(S2.plans.Bonus.envelopes.length, 1, 'next to the envelope it always had');

  console.log(`PASS — a file with no frontmatter gets its block on lines of its own, and reads like any other (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
