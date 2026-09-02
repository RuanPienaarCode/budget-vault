'use strict';
/* The Excluded cell on a split parent — a chip, and no checkbox anywhere near it.

   THE DEFECT THIS PINS.

   `excluded` means two unrelated things and src/tx-role.js exists to keep them
   apart: "vetoed from the budget totals, but the money still moved", and
   "superseded by its own parts". supersededBySplit() requires BOTH the `parent`
   role AND the Excluded tick, deliberately, so that the reversal the markdown
   invites — untick Excluded, delete the parts — cannot leave a row the budget
   counts and reconciliation skips.

   The Transactions table then rendered a plain checkbox in the Excluded cell of
   EVERY row, split parents included:

     onchange: e => { r.excluded = e.target.checked; mark(); }

   One tap on a parent cleared the tick while the parts sat untouched in the
   same file, so the parent stopped being superseded and every reader measuring
   the ACCOUNT rather than the budget — reconcile(), periodActivity(),
   splitFlows(), chargeIndex() — counted the charge twice from that tap onward.
   That is the 1.11.9 double-count exactly, reached through a control that says
   nothing about splits at all, with no dialog, no toast and no visible change
   beyond one unticked box.

   THE SHAPE OF THE FIX, AND WHY THIS FILE ASSERTS IT STRUCTURALLY.

   Guarding the checkbox — refusing the change, or re-ticking it — would leave
   the bad state reachable and put something in the app that has to keep
   noticing it. Making it UNREACHABLE is the call ADR-0001 already made for the
   stale period anchor. So a parent's Excluded cell renders a chip instead: it
   states how many parts the row was split into, states the shortfall when the
   parts no longer add up, and its one action is the un-split.

   Which is why section 6 below is the point of the whole suite and not a
   flourish: it fires EVERY checkbox in the rendered table with checked=false
   and demands that no parent comes out unexcluded. A test that only asserted
   "the parent's cell holds a button" would still pass if a checkbox for that
   row appeared in some other cell tomorrow.

   Drives the REAL view over the shared harness, with src/modal.js swapped for a
   programmable stub (the un-split is behind a confirm, so a test that could not
   answer the dialog could not reach it) and i18n.t wrapped to record what the
   view actually asked for. Recording the KEY and PARAMS rather than matching
   English is deliberate: the strings themselves live in twelve language tables
   this file does not own, and an assertion on their wording would fail the
   moment a translator improves one.

     node tests/split-parent-chip.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { splitRole, supersededBySplit, splitShortfall } = require('../src/tx-role');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- the dialogs, made answerable --------------------------------------
   Injected into the require cache before any view is loaded, same idiom as
   tests/delete-and-undo.test.cjs. `seen.confirms` is what the reader was
   actually shown, which is how section 5 checks the un-split asked at all. */
const answers = { confirm: true };
const seen = { confirms: [] };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal(app, opts) { seen.confirms.push(opts); return answers.confirm; },
    async askFields() { return null; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

/* ---- what the view asked the language tables for ------------------------
   src/views/transactions.js imports i18n as a NAMESPACE (`i18n.t(...)`, because
   `t` is taken as a local in that file), so the property is read at call time
   and this wrapper is seen by the real view. It delegates, so every string on
   the page is still the real one. */
const i18n = require('../src/i18n');
const realT = i18n.t;
let tCalls = [];
i18n.t = (key, params) => { tCalls.push({ key, params }); return realT(key, params); };
const asked = key => tCalls.filter(c => c.key === key);

/* ---- a vault with one split, one part-of-that-split, and ordinary rows ----
   Every figure is synthetic. Never put real statement data in this repo. */
const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const TX_PATH = `${B}/Transactions/Cheque/2026-07.md`;
const FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
  [TX_PATH]: `---\n${TX_FM}\n---\n\n${HEAD}`
    + '| 2026-07-01 | Salary | Salary | 40000.00 |  |  |  |\n'
    + '| 2026-07-03 | Grocer | Groceries | -1200.00 |  |  |  |\n'
    /* An ordinary EXCLUDED row — an internal transfer, the first meaning of the
       column. It must keep its checkbox: nothing about it can double-count, and
       taking the tick away from a reader who set it by hand would be a
       regression dressed as a fix. */
    + '| 2026-07-04 | Transfer out | Salary | -2500.00 | yes |  |  |\n'
    + '| 2026-07-05 | Big shop | Groceries | -1200.00 | yes | Split into 2 | parent |\n'
    + '| 2026-07-05 | Big shop | Groceries | -800.00 |  |  | part |\n'
    + '| 2026-07-05 | Big shop | Salary | -400.00 |  |  | part |\n',
});

async function mount(files = FILES()) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  // Assigned in controller.js rather than published by a module, so makeCtx
  // does not know about them — same note delete-and-undo.test.cjs carries.
  ctx.render = () => {};
  ctx.switchView = () => {};
  ctx.reloadFromDisk = async () => {};
  return { ctx, S };
}

/* The table's own shape, read the way a reader meets it. The Excluded column is
   the SIXTH cell — Date | Description | Account | Category | Amount | Excluded |
   Note | actions — and that index is asserted against the rendered <thead>
   below rather than trusted, so a column inserted ahead of it fails here
   loudly instead of quietly moving what this file inspects. */
const EXCL = 5;
const kids = (node, tag) => node.children.filter(c => c.tagName === tag);
const bodyRows = ctx => {
  const table = ctx.$('#txTable');
  const tbody = kids(table, 'TBODY')[0];
  ok(!!tbody, 'the transactions table renders a body');
  return kids(tbody, 'TR');
};
const cellOf = (tr, i) => kids(tr, 'TD')[i];
// Every element under a node, matched on tag — the stub's own descend().
const within = (node, tag) => descend(node).filter(e => e.tagName === tag);
const rowByAmount = (rows, text) => rows.find(tr => cellOf(tr, 4) && cellOf(tr, 4).textContent === text);
const render = ctx => { tCalls = []; ctx.renderTransactions(); return bodyRows(ctx); };
const rowIn = (S, match) => S.txFiles['Cheque/2026-07'].rows.find(match);

(async () => {

/* ---- 0. the column index this file reads is the Excluded one ---- */
{
  const { ctx } = await mount();
  render(ctx);
  const thead = kids(ctx.$('#txTable'), 'THEAD')[0];
  const heads = kids(kids(thead, 'TR')[0], 'TH');
  eq(heads.length, 8, 'the table still has eight columns');
  eq(heads[EXCL].textContent, realT('tx.col.excl'),
    'cell 5 is still the Excluded column — everything below reads that index');
}

/* ---- 1. a split parent renders a chip, and NO checkbox ---- */
{
  const { ctx } = await mount();
  const rows = render(ctx);
  const parent = rowByAmount(rows, 'R -1200.00');
  ok(!!parent, 'the split parent is on the page — a split never hides the bank line');
  const cell = cellOf(parent, EXCL);

  eq(within(cell, 'INPUT').length, 0,
    "a split parent's Excluded cell must render no input at all — the checkbox IS the double-count");
  const chips = within(cell, 'BUTTON');
  eq(chips.length, 1, 'it renders exactly one chip in its place');
  const chip = chips[0];
  eq(chip.tagName, 'BUTTON', 'the chip is a real <button>, never a div with a click handler');
  eq(chip.getAttribute('type'), 'button',
    'and types itself, so it cannot submit anything it is ever nested inside');
  ok(chip.getAttribute('aria-label'),
    'a chip whose visible text is "split into 2" needs an aria-label naming the row');
  ok((chip._on && chip._on.click || []).length === 1,
    'the chip does something when pressed — a chip that only describes is a label');

  /* The chip is keyboard-reachable BECAUSE it is a button, not because
     anything set tabindex — and it must not have been opted out of the tab
     order by one either. The focus ring comes from .caveat-chip-btn's own
     :focus-visible rule in src/styles.css. */
  eq(chip.getAttribute('tabindex'), null, 'nothing removes the chip from the tab order');
  ok(/caveat-chip-btn/.test(chip.className),
    'the chip reuses dom.js\'s pill button, which already has a visible focus ring in both themes');
}

/* ---- 2. the chip states the part count ---- */
{
  const { ctx } = await mount();
  const rows = render(ctx);
  const chip = within(cellOf(rowByAmount(rows, 'R -1200.00'), EXCL), 'BUTTON')[0];

  const label = asked('tx.split.chip');
  eq(label.length, 1, 'the chip label comes from tx.split.chip');
  eq(label[0].params.count, 2, 'and is told the number of parts the row was split into');

  const aria = asked('tx.aria.splitChip');
  eq(aria.length, 1, 'the aria-label comes from tx.aria.splitChip');
  eq(aria[0].params.desc, 'Big shop', 'named by description');
  eq(aria[0].params.date, '2026-07-05', 'and dated, the way every other control in this table is');

  eq(chip.textContent, realT('tx.split.chip', { count: 2 }),
    'a split that still adds up says only what it is — no shortfall clause');
  eq(asked('tx.split.chipGap').length, 0, 'and never asks for one');
}

/* ---- 3. delete a part and the shortfall becomes visible ----

   The state this exists for. Deleting one part leaves the parent excluded AND
   still marked, so it stays superseded — and that slice's money is then in NO
   total at all: not the budget's, which never counted the parent, and not the
   account's, which skips it. deleteTransaction's own header names this as the
   one delete that moves a figure. Nothing on screen said so until now. */
{
  const { ctx, S } = await mount();
  answers.confirm = true;
  render(ctx);
  await ctx.deleteTransaction({
    label: 'Cheque', _file: S.txFiles['Cheque/2026-07'],
    _row: rowIn(S, r => r.split === 'part' && r.amount === -400),
  });

  const chip = within(cellOf(rowByAmount(render(ctx), 'R -1200.00'), EXCL), 'BUTTON')[0];
  ok(!!chip, 'the parent still shows a chip — one part fewer is not one split fewer');

  const label = asked('tx.split.chip');
  eq(label[0].params.count, 1, 'the count follows the parts that are actually there');
  const gap = asked('tx.split.chipGap');
  eq(gap.length, 1, 'and the money nobody is accounting for is stated');
  eq(gap[0].params.amount, 'R 400.00',
    'as the magnitude of the shortfall, formatted in the row\'s own currency');
  eq(chip.textContent,
    realT('tx.split.chip', { count: 1 }) + ' · ' + realT('tx.split.chipGap', { amount: 'R 400.00' }),
    'the two clauses are joined into one chip label');

  /* The arithmetic behind it is pure and lives in tx-role.js, so the view holds
     no sum of its own that could drift from the one the guards read. */
  eq(splitShortfall({ amount: -1200 }, [{ amount: -800 }]), -400,
    'splitShortfall is what the chip is reporting');
  eq(splitShortfall({ amount: -1240.85 }, [{ amount: -800 }, { amount: -440.85 }]), 0,
    'and a split that still balances reports nothing, in cents rather than floats');
}

/* ---- 4. a PART keeps its ordinary checkbox, and so does every other row ----
   Excluding one slice from the budget is a legitimate preference. Nothing about
   it can double-count anything, so nothing here takes it away. */
{
  const { ctx, S } = await mount();
  const rows = render(ctx);

  for (const [amount, what] of [
    ['R -800.00', 'a split part'],
    ['R -400.00', 'the other split part'],
    ['R 40000.00', 'an ordinary row'],
    ['R -2500.00', 'an ordinary row that is already excluded'],
  ]) {
    const tr = rowByAmount(rows, amount);
    ok(!!tr, `${what} is on the page`);
    const boxes = within(cellOf(tr, EXCL), 'INPUT');
    eq(boxes.length, 1, `${what} keeps its Excluded checkbox`);
    eq(boxes[0].getAttribute('type'), 'checkbox', `${what}'s control is a checkbox`);
  }

  eq(within(cellOf(rowByAmount(rows, 'R -2500.00'), EXCL), 'INPUT')[0].getAttribute('checked'), '',
    'an excluded row renders its box ticked');

  // And the checkbox still WORKS — a cell full of inert controls would pass
  // every assertion above and be a worse page than the one this replaces.
  const box = within(cellOf(rowByAmount(rows, 'R -800.00'), EXCL), 'INPUT')[0];
  box.checked = true;
  box._fire('change');
  eq(rowIn(S, r => r.split === 'part' && r.amount === -800).excluded, true,
    'ticking a part excludes it from the budget totals');
  ok(S.txFiles['Cheque/2026-07'].dirty, 'and marks the file unsaved');
}

/* ---- 5. the chip's action is the un-split, and it is confirmed ---- */
{
  const { ctx, S } = await mount();
  answers.confirm = true;
  seen.confirms = [];
  const f = S.txFiles['Cheque/2026-07'];
  const onDisk = ctx.vault._store.get(TX_PATH);
  const chip = within(cellOf(rowByAmount(render(ctx), 'R -1200.00'), EXCL), 'BUTTON')[0];

  chip.click();
  await new Promise(r => setTimeout(r, 0));      // the handler is async

  eq(seen.confirms.length, 1, 'un-splitting asks first — it removes rows');
  eq(seen.confirms[0].title, realT('tx.unsplit.title'), 'under its own title');
  eq(seen.confirms[0].confirmText, realT('tx.unsplit.action'), 'with its own confirm button');
  const msg = asked('tx.unsplit.msg');
  eq(msg.length, 1, 'and a message built from tx.unsplit.msg');
  eq(msg[0].params.count, 2, 'saying how many parts go');
  eq(msg[0].params.desc, 'Big shop', 'which row it is');
  eq(msg[0].params.amount, 'R -1200.00', 'and what it is worth');

  eq(f.rows.filter(r => splitRole(r.split) === 'part').length, 0, 'the parts are gone');
  const parent = rowIn(S, r => r.desc === 'Big shop');
  ok(!!parent, "the bank's own line is KEPT — it holds the importer's dedup key");
  eq(parent.amount, -1200, 'with its amount untouched, which IS that key');
  eq(splitRole(parent.split), '', 'the role is cleared');
  eq(parent.excluded, false, 'and the tick with it, so the row is ordinary again everywhere at once');
  ok(!supersededBySplit(parent), 'nothing supersedes it any more — there is nothing left to');

  ok(f.dirty, 'the file is unsaved…');
  eq(ctx.vault._store.get(TX_PATH), onDisk,
    '…and NOT written: serializeTxFile writes the whole file, so an un-split that saved would '
    + 'flush every unsaved edit in the month with it. Save is the one door to disk, and until it '
    + 'is pressed "Reload from disk" is a working undo — the same rule deleteTransaction follows.');

  // The row now renders like any other, which is the visible half of the fix.
  const back = within(cellOf(rowByAmount(render(ctx), 'R -1200.00'), EXCL), 'INPUT');
  eq(back.length, 1, 'an un-split row gets its checkbox back');
  eq(back[0].getAttribute('checked'), null, 'unticked, because the un-split unticked it');
}

/* ---- 5b. a cancelled un-split changes nothing ---- */
{
  const { ctx, S } = await mount();
  answers.confirm = false;
  const f = S.txFiles['Cheque/2026-07'];
  const before = f.rows.length;
  within(cellOf(rowByAmount(render(ctx), 'R -1200.00'), EXCL), 'BUTTON')[0].click();
  await new Promise(r => setTimeout(r, 0));

  eq(f.rows.length, before, 'no rows leave on a cancel');
  const parent = rowIn(S, r => r.desc === 'Big shop' && r.excluded);
  eq(splitRole(parent.split), 'parent', 'the role stands');
  eq(parent.excluded, true, 'and so does the tick');
  ok(!f.dirty, 'and nothing is marked unsaved — a cancelled dialog is not an edit');
  answers.confirm = true;
}

/* ---- 6. THE CLAIM: no control in the rendered table can unexclude a parent ----

   Sections 1-5 describe the cell the fix built. This one asks the question the
   fix exists to answer, of the WHOLE table rather than of one cell: fire every
   checkbox on the page unticked, and every split parent must still be
   superseded afterwards. A checkbox that reappeared for a parent tomorrow — in
   this cell or any other — fails here whatever it is labelled. */
{
  const { ctx, S } = await mount();
  const rows = render(ctx);
  const f = S.txFiles['Cheque/2026-07'];
  const parents = f.rows.filter(r => splitRole(r.split) === 'parent');
  eq(parents.length, 1, 'the fixture holds a parent for this to be a question about');
  ok(parents.every(supersededBySplit), 'which starts out superseded');

  let fired = 0;
  for (const tr of rows) {
    for (const box of within(tr, 'INPUT')) {
      if (box.getAttribute('type') !== 'checkbox') continue;
      box.checked = false;
      box._fire('change');
      fired++;
    }
  }
  ok(fired > 0, 'the sweep found checkboxes to fire — a vacuous pass would prove nothing');

  for (const p of parents) {
    eq(p.excluded, true,
      'NO path through the rendered table may untick a split parent: its parts are still in the '
      + 'file, so a parent that loses supersededBySplit() is counted twice by reconcile(), '
      + 'periodActivity(), splitFlows() and chargeIndex() at once. That is the 1.11.9 bug.');
    ok(supersededBySplit(p), 'and it stays superseded, which is the same claim read the other way');
  }
}

console.log(`PASS — a split parent's Excluded cell is a chip, not a checkbox (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
