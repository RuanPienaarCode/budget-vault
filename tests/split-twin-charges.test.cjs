'use strict';
/* Two identical same-day charges, both split, keep their own parts
   (2026-11-17 audit, split lane S1).

   A part carries no id back to its parent, so the lookup matched on date +
   description alone. Two "UBER TRIP" charges on one day, R100 split 60/40 and
   R50 split 30/20, both said "4 parts" with a false unaccounted amount, Un-split
   on one removed all four and left the other still excluded and still a parent
   (its R50 out of every total), and Delete took the other's parts too.

   The fix is ONE lookup, tx-role.js splitPartsOf. With no twin parent it is the
   old rule (every part with that date and description). With a twin, a parent's
   parts are the contiguous run of `part` rows with its key directly under it —
   which is exactly where applySplit's caller splices them, and where Save and
   Reload leave them — trusted only when every twin's run adds up to its own
   parent and the runs take every part (2026-11-25 audit, TXN-1: a
   hand-reordered file grows runs by accident). Anything less falls back to
   "all of them", splitPartsAmbiguous says so, and Delete and Un-split refuse.

     1. the lookup: single split unchanged; twin split told apart by position
     2. the hand-reordered twin falls back and is flagged — both twins, in
        every order the audit found, including runs that exist but do not add up
     3. the real Transactions view: split twice through splitTransaction, Save,
        reload from disk -> the order survives, each chip says 2 parts, no gap
     4. Un-split on one twin leaves the other split and still adding up
     5. Delete on one twin leaves the other's parts
     6. on an ambiguous file Delete and Un-split refuse, change nothing, and say why
     7. the view keeps no private copy of the lookup

     node tests/split-twin-charges.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const seen = { confirms: [], confirmAnswer: true, splitAnswer: null };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal(app, opts) { seen.confirms.push(opts); return seen.confirmAnswer; },
    async askFields() { return null; },
    async askSplit() { return seen.splitAnswer; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

const T = require('../src/tx-role');

/* ---- 1. the lookup, on plain rows ---- */
const row = (amount, split, o = {}) => ({ date: '2026-07-05', desc: 'UBER TRIP', cat: 'Transport', amount,
  excluded: split === 'parent', note: '', split, ...o });
const amounts = rows => rows.map(r => r.amount);
{
  // One split alone: exactly the old rule, wherever its parts sit in the file.
  const P = row(-100, 'parent');
  const a = row(-60, 'part'), b = row(-40, 'part');
  const other = row(-9, '', { desc: 'COFFEE' });
  eq(T.splitPartsOf([a, other, P, b], P), [a, b], 'a lone split: every part with its date and description, wherever it sits');
  eq(T.splitPartsAmbiguous([a, other, P, b], P), false, 'and nothing is ambiguous about it');
  eq(T.splitPartsOf([P, a, b], P), [a, b], 'tidy file, same answer');
  eq(T.splitPartsOf([P, a, b], { ...P }), [a, b], 'a parent object that is not in the rows falls back to the old rule');

  // The twin example: R100 split 60/40, R50 split 30/20, same day, same description.
  const P1 = row(-100, 'parent'), p1a = row(-60, 'part'), p1b = row(-40, 'part');
  const P2 = row(-50, 'parent'), p2a = row(-30, 'part'), p2b = row(-20, 'part');
  const rows = [P1, p1a, p1b, P2, p2a, p2b];
  eq(T.splitPartsOf(rows, P1), [p1a, p1b], 'twin: the first parent owns the run under it');
  eq(T.splitPartsOf(rows, P2), [p2a, p2b], 'twin: the second parent owns the run under it');
  eq(T.splitPartsAmbiguous(rows, P1) || T.splitPartsAmbiguous(rows, P2), false, 'told apart, so not flagged');
  eq(T.splitShortfall(P1, T.splitPartsOf(rows, P1)), 0, 'the first still adds up');
  eq(T.splitShortfall(P2, T.splitPartsOf(rows, P2)), 0, 'the second still adds up');
  // Unrelated rows between the groups end a run, and an unrelated row is not in one.
  const rows2 = [row(-1, '', { desc: 'ZZ' }), P1, p1a, p1b, row(-9, '', { desc: 'COFFEE' }), P2, p2a, p2b];
  eq(amounts(T.splitPartsOf(rows2, P2)), [-30, -20], 'a run starts under its own parent, whatever else is in the file');
  // A twin that is split later sits above the first one's parts: still told apart.
  const rows3 = [P2, p2a, p2b, P1, p1a, p1b];
  eq(T.splitPartsOf(rows3, P1), [p1a, p1b], 'order of the two groups does not matter');
  // The importer's two helpers keep their names and meaning.
  eq(T.splitParentsSharingKey(rows, P1), [P2], 'splitParentsSharingKey: the other parent with the same key');
  eq(T.splitParentsSharingKey([P1, p1a, p1b], P1), [], 'and none when the split is alone');
  eq(T.splitPartsOf(null, P1), [], 'no rows, no parts');
  eq(T.splitPartsAmbiguous(null, P1), false, 'no rows, nothing ambiguous');
}

/* ---- 2. a hand-reordered twin falls back to "all of them" and is flagged ---- */
{
  const P1 = row(-100, 'parent'), p1a = row(-60, 'part'), p1b = row(-40, 'part');
  const P2 = row(-50, 'parent'), p2a = row(-30, 'part'), p2b = row(-20, 'part');
  // Parts moved ABOVE their parents: no run under either.
  const rows = [p1a, p1b, p2a, p2b, P1, P2];
  eq(T.splitPartsOf(rows, P1), [p1a, p1b, p2a, p2b], 'no run under a twin: all four, so nothing is stranded');
  eq(T.splitPartsAmbiguous(rows, P1), true, 'and the caller can tell it is the ambiguous answer');
  eq(T.splitPartsAmbiguous(rows, P2), true, 'for the other twin too');
  // Parts all at the end of the file, under neither parent — the file sorted
  // by its Split column. The R50 parent HAS a run under it here (all four
  // parts), and used to take it as its own with nothing flagged: Delete on it
  // took the R100's parts too (2026-11-25 audit, TXN-1).
  const rows2 = [P1, P2, p1a, p1b, p2a, p2b];
  eq(T.splitPartsAmbiguous(rows2, P1), true, 'a parent with nothing directly under it is flagged');
  eq(T.splitPartsAmbiguous(rows2, P2), true, 'and so is the twin whose "run" is all four parts: R150 of parts under a R50 parent is not its split');
  eq(T.splitPartsOf(rows2, P1).length, 4, 'and gets every part, as before');
  eq(T.splitPartsOf(rows2, P2).length, 4, 'the twin too: the fallback, flagged, not a confident answer');

  // Sorted by Amount: each parent has a run, neither adds up. R100 used to
  // claim only the -60, so an un-split left the -40 behind, counted twice.
  const rows3 = [P1, p1a, P2, p1b, p2a, p2b];
  eq(T.splitPartsAmbiguous(rows3, P1), true, 'a run that does not add up to its parent (60 of 100) is not trusted');
  eq(T.splitPartsAmbiguous(rows3, P2), true, 'nor its twin\'s (40 + 30 + 20 under a R50 parent)');
  eq(T.splitPartsOf(rows3, P1), [p1a, p1b, p2a, p2b], 'both fall back to every part with the key');

  // Every run adds up, but a part sits outside them all: it could be anyone's.
  const stray = row(-5, 'part');
  const rows4 = [P1, p1a, p1b, P2, p2a, p2b, stray];
  eq(T.splitPartsAmbiguous(rows4, P1), true, 'a part no run claims makes the whole group ambiguous');
  eq(T.splitPartsAmbiguous(rows4, P2), true, 'for both twins: never one confident answer beside a guess');

  // One twin's parts deleted by hand: the other's run still adds up, but the
  // group is not told apart, so neither is answered by position.
  const rows5 = [P1, p1a, p1b, P2];
  eq(T.splitPartsAmbiguous(rows5, P1) && T.splitPartsAmbiguous(rows5, P2), true,
    'a twin with no run under it flags the whole group');

  // To the cent, sign-aware: a run that is right in magnitude but wrong in
  // sign does not add up.
  const P3 = row(-100, 'parent'), P4 = row(-50, 'parent');
  const rows6 = [P3, row(60, 'part'), row(40, 'part'), P4, row(-30, 'part'), row(-20, 'part')];
  eq(T.splitPartsAmbiguous(rows6, P4), true, 'parts summing to +100 under a -100 parent do not add up');
  // And the three-decimal amounts the schema keeps still balance by cents.
  const P5 = row(-912.345, 'parent'), P6 = row(-50, 'parent');
  const rows7 = [P5, row(-512.345, 'part'), row(-400, 'part'), P6, row(-30, 'part'), row(-20, 'part')];
  eq(T.splitPartsAmbiguous(rows7, P5), false, 'a run summing to the parent in cents is trusted');
  eq(amounts(T.splitPartsOf(rows7, P5)), [-512.345, -400], 'and is that parent\'s');
}

/* ---- 3-6. the real Transactions view ---- */
const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const FM = '---\naccount: "Cheque"\nmonth: 2026-07\n---\n\n';
const TX = `${B}/Transactions/Cheque/2026-07.md`;
const FILES = (table) => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Transport.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Fun.md`]: '---\ntype: expense\ncolor: "#777777"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
  [TX]: FM + HEAD + table,
});
const line = (amount, split, desc = 'UBER TRIP') => {
  const n = amount.toFixed(2);
  return `| 2026-07-05 | ${desc} | Transport | ${n} | ${split === 'parent' ? 'yes' : ''} | | ${split} |\n`;
};

async function mount(table) {
  const ctx = makeCtx(FILES(table));
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require('../src/views/transactions')(ctx);
  ctx.render = () => {}; ctx.switchView = () => {}; ctx.reloadFromDisk = async () => {};
  ctx.renderTransactions();
  return { ctx, S, $ };
}
const file = S => S.txFiles['Cheque/2026-07'];
const shape = S => file(S).rows.map(r => `${r.split || '-'}:${r.amount}`);
const itemOf = (S, r) => ({ ...r, label: 'Cheque', _file: file(S), _row: r });
/* The chip buttons on screen, in table order, with their visible text. */
const chips = $ => descend($('#txTable')).filter(n => n.tagName === 'BUTTON' && /caveat-chip-btn/.test(n.className))
  .map(b => ({ text: String(b.textContent).trim(), click: () => b.click() }));
const tick = () => new Promise(r => setImmediate(r));
const flush = async () => { await tick(); await tick(); };
const parentOf = (S, amount) => file(S).rows.find(r => r.split === 'parent' && r.amount === amount);

(async () => {
  /* ---- 3. split both through the view, Save, reload ---- */
  {
    const { ctx, S, $ } = await mount(line(-100, '') + line(-50, ''));
    eq(shape(S), ['-:-100', '-:-50'], 'fixture: two identical unsplit charges on one day');
    seen.splitAnswer = [{ amount: -60, cat: 'Transport', note: '' }, { amount: -40, cat: 'Fun', note: '' }];
    await ctx.splitTransaction(itemOf(S, file(S).rows[0]), 0);
    seen.splitAnswer = [{ amount: -30, cat: 'Transport', note: '' }, { amount: -20, cat: 'Fun', note: '' }];
    await ctx.splitTransaction(itemOf(S, file(S).rows.find(r => r.amount === -50)), 1);
    eq(shape(S), ['parent:-100', 'part:-60', 'part:-40', 'parent:-50', 'part:-30', 'part:-20'],
      'applySplit\'s caller splices each parent\'s parts in directly under it');
    ctx.renderTransactions();
    eq(chips($).map(c => c.text).sort(), ['split into 2', 'split into 2'], 'in memory: each chip says 2 parts, with no shortfall');

    await ctx.saveTransactions();
    const onDisk = ctx.vault._store.get(TX);
    ok(onDisk.indexOf('-60.00') < onDisk.indexOf('-50.00'), 'Save keeps the row order it was given');
    await ctx.loadVault();
    S.period = '2026-07';
    eq(shape(S), ['parent:-100', 'part:-60', 'part:-40', 'parent:-50', 'part:-30', 'part:-20'],
      'a reload from disk reads the rows back in the same order');
    ctx.renderTransactions();
    eq(chips($).map(c => c.text).sort(), ['split into 2', 'split into 2'],
      'after Save and reload the chips still say 2 parts each, no "unaccounted"');
  }

  /* ---- 4. Un-split one twin: only its two parts go, the other still adds up ---- */
  {
    const { ctx, S, $ } = await mount(
      line(-100, 'parent') + line(-60, 'part') + line(-40, 'part') + line(-50, 'parent') + line(-30, 'part') + line(-20, 'part'));
    seen.confirms = []; seen.confirmAnswer = true;
    const all = chips($);
    eq(all.map(c => c.text), ['split into 2', 'split into 2'], 'fixture: two split charges, each chip says 2 parts, no shortfall');
    const first = descend($('#txTable')).filter(n => n.tagName === 'TR')
      .find(tr => descend(tr).some(n => n.tagName === 'BUTTON' && /caveat-chip-btn/.test(n.className) && /100/.test(String(tr.textContent))));
    ok(!!first, 'fixture: the R100 row is on screen');
    descend(first).find(n => n.tagName === 'BUTTON' && /caveat-chip-btn/.test(n.className)).click();
    await flush();
    eq(seen.confirms.length, 1, 'the chip asks before un-splitting');
    ok(/removes the 2 parts/.test(seen.confirms[0].message), `the dialog counts the parent's own 2 parts: ${JSON.stringify(seen.confirms[0].message)}`);
    ok(!/told apart/.test(seen.confirms[0].message), 'and does not claim any ambiguity: the parts were told apart by position');
    eq(shape(S), ['-:-100', 'parent:-50', 'part:-30', 'part:-20'], 'only the R100 parts are removed; R100 is an ordinary row again');
    const other = parentOf(S, -50);
    ok(other && other.excluded === true && other.split === 'parent', 'the R50 parent is still excluded and still a parent');
    eq(T.splitShortfall(other, T.splitPartsOf(file(S).rows, other)), 0, 'and its 30 + 20 still add up to it');
    ctx.renderTransactions();
    eq(chips($).map(c => c.text), ['split into 2'], 'the one chip left says 2 parts, no shortfall');
  }

  /* ---- 5. Delete one twin: the other's parts stay ---- */
  {
    const { ctx, S } = await mount(
      line(-100, 'parent') + line(-60, 'part') + line(-40, 'part') + line(-50, 'parent') + line(-30, 'part') + line(-20, 'part'));
    seen.confirms = []; seen.confirmAnswer = true;
    await ctx.deleteTransaction(itemOf(S, parentOf(S, -50)), 1);
    ok(/Its 2 split parts go with it/.test(seen.confirms[0].message), `the dialog counts 2: ${JSON.stringify(seen.confirms[0].message)}`);
    ok(!/told apart/.test(seen.confirms[0].message), 'with no ambiguity claim');
    eq(shape(S), ['parent:-100', 'part:-60', 'part:-40'], 'only the R50 parent and ITS two parts are gone');
    const keep = parentOf(S, -100);
    eq(T.splitShortfall(keep, T.splitPartsOf(file(S).rows, keep)), 0, 'the R100 split is untouched and still adds up');
  }

  /* ---- 6. the hand-reordered twin: Delete and Un-split refuse ----
     They used to offer "Its 4 split parts go with it" with a sentence saying
     the count was high, and confirming took the other split's parts too: that
     parent stayed excluded with nothing describing it, out of every total
     (2026-11-25 audit, TXN-1). A guess the reader agreed to is still a guess,
     so neither opens a dialog on one. */
  const ORDERS = {
    'parts above both parents': [[-60, 'part'], [-40, 'part'], [-30, 'part'], [-20, 'part'], [-100, 'parent'], [-50, 'parent']],
    'sorted by the Split column': [[-100, 'parent'], [-50, 'parent'], [-60, 'part'], [-40, 'part'], [-30, 'part'], [-20, 'part']],
    'sorted by Amount': [[-100, 'parent'], [-60, 'part'], [-50, 'parent'], [-40, 'part'], [-30, 'part'], [-20, 'part']],
  };
  for (const [name, order] of Object.entries(ORDERS)) {
    for (const target of [-100, -50]) {
      const { ctx, S, $ } = await mount(order.map(([a, s]) => line(a, s)).join(''));
      const before = shape(S);
      seen.confirms = []; seen.confirmAnswer = true;
      const toastsBefore = ctx._toasts.length;
      await ctx.deleteTransaction(itemOf(S, parentOf(S, target)), 0);
      eq(seen.confirms.length, 0, `${name}: Delete on the R${-target} parent opens no dialog on a guess`);
      eq(shape(S), before, `${name}: and removes nothing`);
      const said = ctx._toasts.slice(toastsBefore);
      ok(said.length === 1 && said[0].bad && /cannot be told apart from those of another identical split/.test(said[0].msg)
        && /Cheque\/2026-07/.test(said[0].msg), `${name}: it says why, and which file to fix: ${JSON.stringify(said)}`);

      // Un-split through the chip itself, the way a reader reaches it.
      const tr = descend($('#txTable')).filter(n => n.tagName === 'TR')
        .find(row => descend(row).some(n => n.tagName === 'BUTTON' && /caveat-chip-btn/.test(n.className))
          && new RegExp(`${-target}\\.00`).test(String(row.textContent)));
      ok(!!tr, `${name}: the R${-target} parent's chip is on screen`);
      const n = ctx._toasts.length;
      descend(tr).find(x => x.tagName === 'BUTTON' && /caveat-chip-btn/.test(x.className)).click();
      await flush();
      eq(seen.confirms.length, 0, `${name}: Un-split on the R${-target} parent opens no dialog either`);
      eq(shape(S), before, `${name}: and changes nothing — both parents stay excluded, every part stays`);
      ok(file(S).rows.filter(r => r.split === 'parent').every(r => r.excluded === true), `${name}: no parent was un-excluded`);
      ok(/cannot be told apart/.test((ctx._toasts[n] || {}).msg || ''), `${name}: the un-split refusal says why`);
    }
  }

  /* ---- 7. one lookup, not two ---- */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'transactions.js'), 'utf8');
    ok(!/function splitPartsOf\s*\(/.test(src), 'the view no longer carries its own splitPartsOf');
    ok(/const \{[^}]*\bsplitPartsOf\b[^}]*\} = require\('\.\.\/tx-role'\)/.test(src),
      'it takes splitPartsOf from tx-role.js');
  }

  console.log(`PASS split-twin-charges — two identical same-day splits keep their own parts (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
