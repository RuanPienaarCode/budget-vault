'use strict';
/* The lead above a table: the plugin's own lines are regenerated, the
   household's own lines are kept — decided line by line.

   Every file the plugin rebuilds (budgets, the four flat tables, Plans, Tax)
   opens with a fixed lead: a blank line, `# Title`, a blank line, the view's
   own sentences, a blank line. Those sentences track live state — a budget's
   range note follows month_start_day, the Tax sentence follows the
   household's country — so markdown.js's withLeadExtra regenerates them on
   every save, and replays whatever a household wrote PAST the fixed block.

   It decided by LENGTH. A captured lead no longer than the fixed block was
   thrown away whole and regenerated, so a household that replaced the
   plugin's sentence with its own — same number of lines — lost its sentence
   on the next save of the page, while one that ADDED a line kept it
   (2026-10-07 audit, L3-15, on a budget period). A longer lead that matched
   the block everywhere but its first two lines had those two replaced
   unread: text typed directly under the frontmatter fence was lost the same
   way.

   Now each line of the fixed block is regenerated only when it is still the
   plugin's own line for that slot: a blank where a blank goes, a `# heading`
   where the title goes (the title is live state — a renamed plan's heading
   follows the new name), the sentence the plugin writes now, or the SAME
   generated sentence written under other settings or by an earlier version
   (markdown.js names those families). Any other line is the household's and
   is kept where it stands. Nothing is ever dropped that the plugin did not
   write, and no plugin line is ever written twice.

   Three parts:

     1. withLeadExtra on its own: the cases above, the families, and an
        exhaustive sweep of household edits (replace any line, insert a line
        anywhere, delete any line) over several lead shapes — every
        household line survives in order, no plugin sentence is duplicated,
        and an untouched or merely trimmed lead regenerates exactly,
     2. through the REAL loader and serializers, the household's own sentence
        survives a no-change save of a budget period, all four flat tables, a
        plan and a tax year,
     3. and the plugin's own sentence is still regenerated when the setting it
        describes changes (range note, tax authority), when it was written in
        an earlier wording (the Services cycle list, the one-line Owed lead),
        and when a plan is renamed.

     node tests/lead-lines-kept-or-regenerated.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { withLeadExtra, freshLeadLines } = require('../src/markdown');
const { budgetRangeNote } = require('../src/budget-file');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* What load.js hands withLeadExtra: the raw text above the table, which
   starts with the line break that ended the frontmatter fence. */
const cap = lines => '\n' + lines.join('\n');

/* ---- 1: withLeadExtra on its own ------------------------------------------ */
const RN1 = budgetRangeNote({ monthStartDay: 1 });
const RN25 = budgetRangeNote({ monthStartDay: 25 });
const BUD = freshLeadLines('Budget — 2026-10', [RN25]);
const OWN = 'Agreed at the family meeting: no takeaways until the car is paid.';

eq(withLeadExtra(cap(BUD), BUD), BUD, 'an untouched lead regenerates to itself');
eq(withLeadExtra(cap(['', '# Budget — 2026-10', '', OWN, '']), BUD), ['', '# Budget — 2026-10', '', OWN, ''],
  'the household\'s sentence in the plugin\'s own slot is KEPT — same line count, which used to lose it');
eq(withLeadExtra(cap(['', '# Budget — 2026-10', '', RN1, '']), BUD), BUD,
  'the plugin\'s range note written under another month_start_day is regenerated');
eq(withLeadExtra(cap(['', '# Budget — 2026-10', '',
  'With `month_start_day: 25`, this period runs from the 25rd of the previous month to the 24nd of this month.', '']), BUD), BUD,
'and so is the spelling the 1.0 releases wrote ("25rd", "24nd")');
eq(withLeadExtra(cap(['', '# Budget — 2026-10', '',
  'With `period_type: fortnightly`, this period runs for 14 days from 2026-10-01, derived from `period_anchor: 2026-01-01`.', '']), BUD), BUD,
'and the interval sentence an earlier version wrote under `period_type`');
eq(withLeadExtra(cap(['', '# Budget — 2026-10', '', RN1, '', 'A paragraph of ours.', '']), BUD),
  [...BUD, 'A paragraph of ours.', ''],
  'a stale range note is regenerated even when the household added a paragraph below it');
eq(withLeadExtra(cap(['Typed right under the fence.', '# Budget — 2026-10', '', RN25, '', 'More of ours.', '']), BUD),
  ['Typed right under the fence.', '# Budget — 2026-10', '', RN25, '', 'More of ours.', ''],
  'text typed directly under the fence is kept — it used to be replaced by the blank line the plugin writes there');
eq(withLeadExtra(cap(['', '# Old plan name', '', 'Our own intro.', '']), freshLeadLines('New plan name', ['Plugin sentence.'])),
  ['', '# New plan name', '', 'Our own intro.', ''],
  'the title follows live state (a renamed plan) even beside a household\'s own sentence');

const OWED = freshLeadLines('Owed Money', ['Money owed to the household. `status` is `outstanding` or `paid`.',
  '`Repaid` is how much has come back; `Lent` is when it went out.']);
eq(withLeadExtra(cap(['', '# Owed Money', '', OWED[3], '']), OWED), OWED,
  'a shorter lead written by an earlier version (one sentence where there are now two) is regenerated whole');
eq(withLeadExtra(cap(['', '# Owed Money', '']), OWED), OWED, 'a title-only lead is regenerated whole');
eq(withLeadExtra(cap(['']), OWED), OWED, 'and so is an empty one');
eq(withLeadExtra(cap(['', '# Owed Money', '', 'Only ours.']), OWED), ['', '# Owed Money', '', 'Only ours.'],
  'a shorter lead holding a line of the household\'s is kept as it stands, not padded around');
eq(withLeadExtra(null, OWED), OWED, 'a file never loaded gets the fixed shape');

const SVC = freshLeadLines('Services & Subscriptions', ['Recurring services and subscriptions. `cycle` is one of: weekly, fortnightly, monthly, annual.']);
eq(withLeadExtra(cap(['', '# Services & Subscriptions', '', 'Recurring services and subscriptions. `cycle` is `monthly` or `annual`.', '']), SVC), SVC,
  'the two-word cycle sentence earlier versions wrote is regenerated as the current one');

const TAX = authority => freshLeadLines('Tax Year 2026', [
  `${authority} return tracking for the 2026 tax year (one year).`, 'Step `status` is …', 'Uploaded files live in `Tax/2026/`.']);
eq(withLeadExtra(cap(TAX('SARS')), TAX('HMRC')), TAX('HMRC'), 'the Tax sentence follows a change of country');
eq(withLeadExtra(cap([...TAX('SARS').slice(0, 5), 'Our scans are in the blue folder.', '']), TAX('HMRC')),
  [...TAX('HMRC').slice(0, 5), 'Our scans are in the blue folder.', ''],
  'and is regenerated while a household line two slots down is kept');

/* The sweep. Shapes cover a one-sentence lead with a family member, a
   three-sentence lead, a one-sentence lead, and a title-only lead. */
const SHAPES = [
  BUD,
  freshLeadLines('Debts', ['First plugin sentence.', 'Second plugin sentence.', 'Third plugin sentence.']),
  freshLeadLines('One', ['Only plugin sentence.']),
  freshLeadLines('Bare', []),
];
const MINE = ['A line the household wrote.', 'Another of theirs.'];
const isMine = l => MINE.includes(l);
let swept = 0;
for (const fresh of SHAPES) {
  const variants = [];
  for (let i = 0; i < fresh.length; i++) variants.push(fresh.map((l, j) => (j === i ? MINE[0] : l)));
  for (let j = 0; j <= fresh.length; j++) variants.push([...fresh.slice(0, j), MINE[0], ...fresh.slice(j)]);
  for (let k = 0; k < fresh.length; k++) variants.push(fresh.filter((_, j) => j !== k));
  for (let i = 0; i < fresh.length; i++) {
    for (let j = 0; j <= fresh.length; j++) {
      const v = fresh.map((l, x) => (x === i ? MINE[0] : l));
      variants.push([...v.slice(0, j), MINE[1], ...v.slice(j)]);
    }
  }
  /* Two lines inserted together push the plugin's own last sentence PAST the
     fixed block, which is where a rule that trusted positions duplicated it. */
  for (let j = 0; j <= fresh.length; j++) variants.push([...fresh.slice(0, j), MINE[0], MINE[1], ...fresh.slice(j)]);
  const prose = fresh.filter(l => l.trim() && !l.startsWith('# '));
  for (const v of variants) {
    const out = withLeadExtra(cap(v), fresh);
    const mineIn = v.filter(isMine);
    assert.deepStrictEqual(out.filter(isMine), mineIn, `every household line survives, in order — ${JSON.stringify(v)}`);
    for (const line of prose) {
      assert.ok(out.filter(l => l === line).length <= 1, `no plugin sentence is written twice — ${JSON.stringify(v)}`);
    }
    if (!mineIn.length) assert.deepStrictEqual(out, fresh, `a lead with nothing of the household's regenerates exactly — ${JSON.stringify(v)}`);
    else {
      assert.strictEqual(out.length, v.length, `with a household line in it, no line is added or dropped — ${JSON.stringify(v)}`);
      v.forEach((l, i) => {
        if (prose.includes(l)) assert.strictEqual(out[i], l, `a line that already is one of the plugin's sentences is never swapped for another — ${JSON.stringify(v)}`);
      });
    }
    swept++;
  }
}
ok(swept > 100, `the sweep covered every single-line edit and every pair of edits (${swept} leads)`);

/* ---- 2 + 3: through the real loader and serializers ----------------------- */
const B = 'Budget';
const SETTINGS = ms => `---\nmonth_start_day: ${ms}\ncurrency: "R"\ncountry: za\n---\n`;
const TABLE = '| Category | Type | Amount | Notes |\n|----------|------|-------:|-------|\n| Food | expense | 4000.00 |  |\n';

async function budgetSave(files, period) {
  const { makeDom } = require('./helpers/dom-stub.cjs');
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = period;
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  ctx.render = () => {};
  require('../src/categories')(ctx);
  require('../src/views/budgets')(ctx);
  ctx.invalidateBudgetDraft();
  await ctx.saveBudget();
  return ctx.vault._store.get(`${B}/Budgets/${period}.md`);
}

async function flat(view, fn, file, text) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS(1), [`${B}/${file}`]: text });
  await loadInto(ctx);
  require(`../src/views/${view}`)(ctx);
  return ctx[fn]();
}

(async () => {
  /* 2a. the audit's own case: a budget period whose range note the household replaced */
  const budget = `---\nperiod: 2026-10\n---\n\n# Budget — 2026-10\n\n${OWN}\n\n${TABLE}`;
  const cat = { [`${B}/Categories/Food.md`]: '---\ntype: expense\n---\n' };
  const saved = await budgetSave({ [`${B}/Settings.md`]: SETTINGS(1), ...cat, [`${B}/Budgets/2026-10.md`]: budget }, '2026-10');
  eq(saved, budget, 'a no-change save of the period writes the household\'s sentence back, byte for byte');
  ok(!saved.includes('With `month_start_day'), 'and does not put the plugin\'s range note back over it');

  /* 3a. the range note itself still follows the setting */
  const ours = budgetRangeNote({ monthStartDay: 1 });
  const stale = `---\nperiod: 2026-10\n---\n\n# Budget — 2026-10\n\n${ours}\n\n${TABLE}`;
  const moved = await budgetSave({ [`${B}/Settings.md`]: SETTINGS(25), ...cat, [`${B}/Budgets/2026-10.md`]: stale }, '2026-10');
  ok(moved.includes('With `month_start_day: 25`, this period runs from the 25th of the previous month to the 24th of this month.'),
    'with month_start_day changed to 25, the save writes the range note for 25');
  ok(!moved.includes(ours), 'and the note for the old setting is gone, not kept beside it');

  /* 2b. the four flat tables: one plugin sentence replaced by the household's, same line count */
  const assetsHead = '| Item | Kind | Value | Valued | Notes |\n|------|------|------:|--------|-------|\n| Car | vehicle | 90000.00 | 2026-01-01 |  |\n';
  const assets = '---\nkind: assets\n---\n\n# Assets\n\n'
    + 'What the household owns that is not an account — property, vehicles, contents,\n'
    + 'We value the car at trade-in, not retail.\n'
    + 'that was last worked out. Money owed against any of these lives on the Debt page.\n\n' + assetsHead;
  const outA = await flat('assets', 'serializeAssets', 'Assets.md', assets);
  ok(outA.includes('We value the car at trade-in, not retail.'), 'Assets: the household\'s line in the plugin\'s slot survives');
  ok(outA.startsWith('---\nkind: assets\n---\n\n# Assets\n\nWhat the household owns that is not an account'),
    'Assets: around it, the plugin\'s own lines are still its own');

  const debts = '---\nkind: debts\n---\n\n# Debts\n\n'
    + 'Money the household owes. `rate` is the annual interest rate as a percentage,\n'
    + '`payment` the contracted monthly amount and `extra` anything paid on top of it.\n'
    + 'The car is in both our names.\n\n'
    + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
    + '|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|\n'
    + '| Car | Bank A | vehicle | 1000.00 | 2000.00 | 10.00 | 100.00 | 0.00 | 2024-01-01 |  | active |  |\n';
  eq(await flat('debts', 'serializeDebts', 'Debts.md', debts), debts, 'Debts: the household\'s line survives and the file round-trips byte for byte');

  const owed = '---\nkind: owed\n---\n\n# Owed Money\n\nWe only lend to family.\n'
    + '`Repaid` is how much has come back; `Lent` is when it went out.\n\n'
    + '| Person | Amount | Description | Due date | Status | Repaid | Lent |\n'
    + '|--------|-------:|-------------|----------|--------|-------:|------|\n| Sam | 250.00 | lunch |  | outstanding | 0.00 |  |\n';
  eq(await flat('owed', 'serializeOwed', 'Owed Money.md', owed), owed, 'Owed: the household\'s first line survives, byte for byte');

  const svcTable = '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n'
    + '|------|----------|-------:|-------|--------------|----------|--------|-------|\n| Gym | Club | 300.00 | monthly | 2026-11-01 |  | yes |  |\n';
  const services = `---\nkind: services\n---\n\n# Services & Subscriptions\n\nCancel the gym in January.\n\n${svcTable}`;
  eq(await flat('services', 'serializeServices', 'Services.md', services), services,
    'Services: the household\'s sentence in the one prose slot survives, byte for byte');

  /* 3b. the earlier wordings are still regenerated */
  const oldSvc = '---\nkind: services\n---\n\n# Services & Subscriptions\n\n'
    + 'Recurring services and subscriptions. `cycle` is `monthly` or `annual`.\n\n' + svcTable;
  const outS = await flat('services', 'serializeServices', 'Services.md', oldSvc);
  ok(/`cycle` is one of: weekly, fortnightly, monthly, annual\./.test(outS) && !outS.includes('`monthly` or `annual`'),
    'Services: the two-word cycle sentence an earlier version wrote is replaced by the current one');
  const oldOwed = '---\nkind: owed\n---\n\n# Owed Money\n\nMoney owed to the household. `status` is `outstanding` or `paid`.\n\n'
    + '| Person | Amount | Description | Due date | Status | Repaid | Lent |\n'
    + '|--------|-------:|-------------|----------|--------|-------:|------|\n| Sam | 250.00 | lunch |  | outstanding | 0.00 |  |\n';
  ok((await flat('owed', 'serializeOwed', 'Owed Money.md', oldOwed)).includes(
    'Money owed to the household. `status` is `outstanding` or `paid`.\n`Repaid` is how much has come back; `Lent` is when it went out.\n'),
  'Owed: the one-sentence lead an earlier version wrote gains the second sentence');

  /* 2c + 3c. a plan: the household's sentence kept, the title following a rename */
  const plan = '---\nkind: plan\nplan: "Bonus"\nstatus: active\n---\n\n# Bonus\n\n'
    + 'Money that arrives once, divided on purpose.\n'
    + 'Half of it goes to the bond, whatever happens.\n'
    + 'An envelope\'s amount is what you placed in it — it need not equal the items inside.\n\n'
    + '## Money in\n\n| Source | Kind | Amount | Date | Status | Notes |\n|--------|------|-------:|------|--------|-------|\n'
    + '| Bonus | Work | 5000.00 |  | received |  |\n\n'
    + '## Envelopes\n\n| Envelope | Amount | Note | Tint |\n|----------|-------:|------|------|\n\n'
    + '## Items\n\n| Item | Envelope | Amount | Spent | Status | Category | Notes |\n|------|----------|-------:|------:|--------|----------|-------|\n';
  {
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS(1), [`${B}/Plans/Bonus.md`]: plan });
    const S = await loadInto(ctx);
    require('../src/views/plan')(ctx);
    S.planName = 'Bonus';
    eq(ctx.serializePlan('Bonus'), plan, 'Plan: the household\'s sentence survives a no-change save, byte for byte');
    S.plans.Bonus.name = 'Year-end bonus';
    const renamed = ctx.serializePlan('Bonus');
    ok(renamed.includes('\n# Year-end bonus\n') && renamed.includes('Half of it goes to the bond, whatever happens.'),
      'Plan: renamed, the heading follows the new name and the household\'s sentence stays');
  }

  /* 2d + 3d. a tax year: the household's line kept while the authority sentence follows the country */
  const tax = '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: standard\nassessment: unknown\n---\n\n# Tax Year 2026\n\n'
    + 'SARS return tracking for the 2026 tax year (1 Mar 2025 – end Feb 2026).\n'
    + 'Step `status` is `todo`, `busy`, `done` or `n/a`; document `status` is `needed`, `uploaded` or `n/a`.\n'
    + 'Our scans are in the blue folder.\n\n'
    + '## Progress\n\n| Step | Status | Due | Notes |\n|------|--------|-----|-------|\n\n'
    + '## Documents\n\n| Document | Source | Status | File | Notes |\n|----------|--------|--------|------|-------|\n\n'
    + '## Figures\n\n| Source code | Description | Source | Amount |\n|------|-------------|--------|--------|\n';
  {
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS(1), [`${B}/Tax/2026.md`]: tax });
    const S = await loadInto(ctx);
    require('../src/views/tax')(ctx);
    S.taxYear = '2026';
    eq(ctx.serializeTax('2026'), tax, 'Tax: the household\'s line survives a no-change save, byte for byte');
  }
  {
    const ctx = makeCtx({ [`${B}/Settings.md`]: SETTINGS(1), [`${B}/Tax/2026.md`]: tax });
    ctx.locale = () => require('../src/locale').PROFILES.uk;
    const S = await loadInto(ctx);
    require('../src/views/tax')(ctx);
    S.taxYear = '2026';
    const out = ctx.serializeTax('2026');
    ok(/\nHMRC return tracking for the 2026 tax year \(.+\)\.\n/.test(out) && !out.includes('SARS return tracking'),
      'Tax: under another country, the authority sentence is regenerated for it');
    ok(out.includes('Our scans are in the blue folder.'), 'and the household\'s own line two slots down is still there');
  }

  console.log(`PASS — the lead keeps the household's own lines and regenerates the plugin's (${checks} checks, ${swept} swept leads).`);
})().catch(e => { console.error(e); process.exit(1); });
