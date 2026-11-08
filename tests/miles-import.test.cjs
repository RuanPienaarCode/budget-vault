'use strict';
/* A Discovery Miles export through the REAL import view, serializer and loader.

   tests/miles.test.cjs pins the pure module. This pins what only the wired-up
   app can show:

     1. ROUTING. `DiscoveryBankMiles_<n>_…` matches the very pattern the other
        Discovery exports route by, and nothing says <n> differs from the cheque
        account's number. So a Miles file is only ever auto-routed to an
        account that is OUT of the budget — with the cheque account holding the
        same number and sorting later, with no Miles account at all (left
        unrouted: a question, never the cheque account), and — the converse —
        an ordinary bank statement preferring the budget account over a Miles
        account that shares its number, even though the Miles account sorts
        first.
     2. THE REVIEW says what the file was read as, at what rate, and what it
        comes to; and ARGUES when the account picked counts toward the budget.
     3. THE ROUND TRIP. commit -> real serializeTxFile -> real loadVault: every
        imported row reloads unchanged (date, description, amount, note), a
        re-save is byte-identical, the Miles count is recoverable from the
        reloaded Note, and the account balance is total Miles x rate.
     4. RE-IMPORT, from the LOADED rows (not the in-memory index): the same
        export adds nothing, and an overlapping later one adds only what is new,
        including the fourth of four identical rows on one day.
     5. THE RATE SETTING reads from Settings.md through the loader (absent,
        unreadable and clamped), and moves the amounts.
     6. THE NEW-ACCOUNT OFFER defaults to a non-budget rewards account carrying
        the file's name and number, and what it writes reloads as non-budget.
     7. THE SETTINGS TAB's declarative half shows the rate the importer will
        run, writes a plain number, and refuses "10" rather than clamping it.

   Fixture rows are invented; only the shapes are the real export's.

     node tests/miles-import.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* The create-account form is a modal; stand it in with a queue of answers and a
   record of what it was OFFERED, so the defaults can be asserted. */
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const answers = [];
const offered = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async (app, title, fields) => { offered.push(fields); return answers.shift() || null; },
      askSplit: async () => null,
      confirmModal: async () => true,
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { parseMilesNote } = require('../src/miles');

const B = 'Budget';
const NUMBER = '12345678901';
/* The Miles account sorts BEFORE the cheque account on purpose: first-match-wins
   would then pick it for an ordinary bank statement, which is the failure the
   budget preference exists to prevent. */
const MILES_ACCT = 'Discovery Miles', CHEQUE_ACCT = 'Gold Transact';
const settings = extra => `---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n${extra || ''}---\n`;
const acct = (type, extra) => `---\ntype: ${type}\naccount_number: "${NUMBER}"\nbalance: 0.00\nbalance_updated: 2026-09-30\n${extra || ''}---\n`;
const FILES = {
  [`${B}/Settings.md`]: settings(),
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/${CHEQUE_ACCT}.md`]: acct('checking'),
  [`${B}/Accounts/${MILES_ACCT}.md`]: acct('other', 'budget: false\n'),
};

const HEADER = ['Value Date', 'Type', 'Description', 'Additional information', 'Miles'];
const toCsv = rows => [HEADER, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\r\n') + '\r\n';
const COFFEE = ['2026-10-18', 'Basket value - R 25.00', 'Discovery Miles Redeemed For Coffee Bar', '', '-190.00'];
const ROWS_A = [
  ['2026-10-20', 'Base Miles', 'Fuel Stop Central', '2026-10-20 - R 480.00', '48.00'],
  ['2026-10-19', 'Vitality Money', 'Fuel Station', '2026-10-19 \u0014  R 833.00', '83.00'],
  ['2026-10-18', 'Basket value - R 1,019.00', 'Discovery Miles Redeemed For Outdoor Shop', '', '-7500.00'],
  COFFEE, COFFEE, COFFEE,
  ['2026-10-17', 'No reward', 'Streaming Service 99.00 Zar', '', '0.00'],
  ['2026-10-16', 'Prepaid Electricity - R150.00', 'Cape Town', '', '-1100.00'],
  ['2026-10-15', '', 'Gameboard - Coin tile', '', '20.00'],
  ['2026-10-14', 'Base Miles Reverse', 'Fuel Stop Central', '2026-10-14 - R 480.00-', '-48.00'],
  ['2026-11-01', 'Miles Received', 'From Alex', ' - ', '10000.00'],
  ['2026-10-01', 'Base Miles', 'Greengrocer Plaza', '2026-10-01 - R 1,250.00', '125.00'],
];
const ROWS_B = [   // a later, overlapping export: new days on top, a FOURTH identical coffee row
  ['2026-11-02', 'Base Miles', 'Greengrocer Plaza', '2026-11-02 - R 300.00', '30.00'],
  ['2026-10-28', 'Base Miles', 'Fuel Stop Central', '2026-10-28 - R 500.00', '50.00'],
  ...ROWS_A.slice(0, 5), COFFEE, ...ROWS_A.slice(5, 10),
];
const MILES_FILE = `DiscoveryBankMiles_${NUMBER}_20221001_20261102.csv`;
const file = (name, text) => ({ name, async arrayBuffer() { return new TextEncoder().encode(text).buffer; } });
const txt = el => String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();

async function mount(files = FILES) {
  const m = await mountFor(files, { period: '2026-10', budgetFolder: B });
  m.ctx.render = () => {};
  m.ctx.switchView = () => {};
  return m;
}
const monthFile = (ctx, month) => ctx.vault._store.get(`${B}/Transactions/${MILES_ACCT}/${month}.md`);
const sumCents = rows => rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);

(async () => {
  const unpin = pinClock('2026-11-08');
  try {
    /* ---- 1. routing ---- */
    {
      const { ctx, S } = await mount();
      eq(S.accounts.map(a => a.name), [MILES_ACCT, CHEQUE_ACCT], 'fixture: the Miles account sorts first, so first-match-wins would pick it');
      eq(S.accounts.map(a => a.in_budget), [false, true], 'fixture: Miles is out of the budget, the cheque account is in');

      await ctx.handleStatementFile(file(MILES_FILE, toCsv(ROWS_A)));
      eq(S.pendingImport.label, MILES_ACCT, 'a Miles file routes to the non-budget account carrying its number');
      ok(S.pendingImport.miles, 'and is marked as a Miles import');

      /* A bank statement under the same number goes to the budget account. */
      const bank = 'Date,Description,Amount\n2026-10-05,Greengrocer Plaza,-120.00\n2026-10-06,Fuel Stop Central,-300.00\n';
      await ctx.handleStatementFile(file(`DiscoveryBank_${NUMBER}_20260901_20261031.csv`, bank));
      eq(S.pendingImport.label, CHEQUE_ACCT, 'a bank statement under the shared number prefers the budget account, not whichever sorted first');
      ok(!S.pendingImport.miles, 'and is not a Miles import');
    }
    {
      // Negative control: no Miles account. The cheque account HAS the number and must not be offered.
      const only = { ...FILES };
      delete only[`${B}/Accounts/${MILES_ACCT}.md`];
      const { ctx, S } = await mount(only);
      await ctx.handleStatementFile(file(MILES_FILE, toCsv(ROWS_A)));
      eq(S.pendingImport.label, '', 'with no non-budget account the Miles file is left unrouted — never sent to the cheque account whose number it carries');
      eq(ctx.$('#impCommit').disabled, true, 'so Import rows is off until the reader chooses');
      await ctx.commitImport();
      eq(Object.keys(S.txFiles), [], 'and a commit that gets through anyway writes nothing');

      // Fallback the other way: a lone non-budget account with the number still takes a bank statement.
      const lone = { ...FILES };
      delete lone[`${B}/Accounts/${CHEQUE_ACCT}.md`];
      const m2 = await mount(lone);
      await m2.ctx.handleStatementFile(file(`DiscoveryBank_${NUMBER}_20260901_20261031.csv`, 'Date,Description,Amount\n2026-10-05,Shop,-1.00\n2026-10-06,Shop B,-2.00\n'));
      eq(m2.S.pendingImport.label, MILES_ACCT, 'a bank statement whose only match is a non-budget account still routes to it');
    }

    /* ---- 2. the review ---- */
    {
      const { ctx, S } = await mount();
      await ctx.handleStatementFile(file(MILES_FILE, toCsv(ROWS_A)));
      const p = S.pendingImport;
      eq(p.items.length, 11, 'eleven rows reviewed: twelve data rows less the 0.00 one');
      eq(p.noted, 1, 'the zero row is reported as "no amount (not imported)", not as unparseable');
      eq(p.skipped, 0, 'nothing is unparseable');
      const banner = txt(ctx.$('#impReconcile'));
      ok(/Discovery Miles export/.test(banner), `the review says what the file was read as — "${banner}"`);
      ok(/0[.,]10/.test(banner), 'at which rate');
      ok(/1\W?058/.test(banner), 'and the Miles total');
      ok(/105[.,]80/.test(banner), 'and what that comes to in rand');
      ok(!/counts toward your budget/.test(banner), 'with no complaint while the destination is out of the budget');
      ok(!ctx.$('#impReconcile').classList.contains('imp-reconcile-warn'), 'and not styled as a warning');
      ok(/non-budget|excluded from the budget/i.test(txt(ctx.$('#impNonBudget'))), 'the existing non-budget notice is on too');

      // Pointing it at the budget account is ARGUED with, not refused.
      p.label = CHEQUE_ACCT;
      ctx.renderImportReview();
      const warned = txt(ctx.$('#impReconcile'));
      ok(new RegExp(`${CHEQUE_ACCT} counts toward your budget`).test(warned), `the budget account is named and the reader is told why it is wrong — "${warned}"`);
      ok(ctx.$('#impReconcile').classList.contains('imp-reconcile-warn'), 'styled as a warning');
      eq(ctx.$('#impCommit').disabled, false, 'but the reader is still allowed — the app argues, it does not correct');
      p.label = MILES_ACCT;
      ctx.renderImportReview();
    }

    /* ---- 3. commit, then the real loader ---- */
    const { ctx, S } = await mount();
    await ctx.handleStatementFile(file(MILES_FILE, toCsv(ROWS_A)));
    const imported = S.pendingImport.items.map(it => ({ date: it.date, desc: it.desc, amount: it.amount, note: it.note, miles: it.miles }));
    await ctx.commitImport();
    eq(S.pendingImport, null, 'the import committed');
    eq(Object.keys(S.txFiles).sort(), [`${MILES_ACCT}/2026-10`, `${MILES_ACCT}/2026-11`], 'rows are filed under the calendar month they fell in, in the Miles account\'s folder');

    const octText = monthFile(ctx, '2026-10');
    ok(/\| Date \| Description \| Category \| Amount \| Excluded \| Note \|\n/.test(octText), 'six columns — no Split column was added');
    ok(!/Split/.test(octText), 'the positional columns are untouched: nothing was inserted or appended');
    ok(octText.includes('| Fuel Stop Central |  | 4.80 |  | Miles: 48.00 · Info: 2026-10-20 - R 480.00 |'), 'the Miles count and the bank\'s own detail sit in the Note column');
    ok(octText.includes('| Prepaid Electricity — Cape Town |  | -110.00 |  | Miles: -1100.00 · Printed: R150.00 |'), 'a redemption keeps its printed value in the note, and is booked at the one rate');

    await ctx.loadVault();   // the REAL loader, over what the REAL serializer wrote
    const S2 = ctx.S;
    const reloaded = Object.values(S2.txFiles).flatMap(f => f.rows)
      .map(r => ({ date: r.date, desc: r.desc, amount: r.amount, note: r.note }));
    const byKey = a => a.date + a.desc + a.amount + a.note;
    eq(reloaded.map(byKey).sort(), imported.map(byKey).sort(), 'every imported row reloads unchanged: date, description, amount and note');
    ok(Object.values(S2.txFiles).flatMap(f => f.rows).every(r => r.cat === '' && r.excluded === false && !r.amountRaw && !r.split),
      'uncategorised, not excluded, no unreadable amount, no split role');

    for (const f of Object.values(S2.txFiles)) {
      eq(ctx.serializeTxFile(f), ctx.vault._store.get(`${B}/Transactions/${f.label}/${f.month}.md`), `${f.month}: a re-save is byte-identical`);
    }

    const rows = Object.values(S2.txFiles).flatMap(f => f.rows);
    const miles = rows.map(r => parseMilesNote(r.note).miles);
    eq(miles.reduce((s, m) => s + Math.round(m * 100), 0), 105800, 'the Miles count is recoverable from every reloaded note — and totals 1,058');
    eq(sumCents(rows), 10580, 'the account\'s rand balance is total Miles x 0.10: R105.80');
    ok(rows.every((r, i) => Math.round(r.amount * 100) === Math.round(parseMilesNote(r.note).miles * 10)), 'row for row, amount = Miles x rate');
    const acctRow = S2.accounts.find(a => a.name === MILES_ACCT);
    eq(acctRow.in_budget, false, 'the account stays out of the budget');

    /* ---- 4. re-import, against the LOADED rows ---- */
    await ctx.handleStatementFile(file(MILES_FILE, toCsv(ROWS_A)));
    let p = ctx.S.pendingImport;
    eq([p.label, p.items.filter(i => i.dup).length, p.items.filter(i => !i.dup).length], [MILES_ACCT, 11, 0],
      'the same export again: every row is already in the vault, three identical coffee rows included');
    await ctx.commitImport();
    ok(ctx._toasts.some(t => /Nothing selected to import/.test(t.msg)), 'and there is nothing to commit');

    await ctx.handleStatementFile(file('DiscoveryBankMiles_12345678901_20221001_20261103.csv', toCsv(ROWS_B)));
    p = ctx.S.pendingImport;
    const fresh = p.items.filter(i => !i.dup);
    eq(p.items.filter(i => i.dup).length, 9, 'an overlapping later export: the nine rows the vault holds are recognised');
    eq(fresh.map(i => i.desc).sort(), ['Discovery Miles Redeemed For Coffee Bar'.replace(/^/, 'Basket value — '), 'Fuel Stop Central', 'Greengrocer Plaza'].sort(),
      'and only the two new days and the fourth identical coffee row are new');
    ok(fresh.every(i => i.include), 'all ticked: none of them was mistaken for a near-duplicate');
    await ctx.commitImport();
    const afterB = Object.values(ctx.S.txFiles).flatMap(f => f.rows);
    eq(afterB.length, 14, 'eleven rows plus the three new ones');
    eq(afterB.filter(r => r.desc === 'Basket value — Discovery Miles Redeemed For Coffee Bar').length, 4, 'four identical coffee rows on one day, as the statement says');

    /* ---- 5. the rate ---- */
    {
      const { ctx: c5, S: S5 } = await mount({ ...FILES, [`${B}/Settings.md`]: settings('miles_rate: 0.12\n') });
      eq(S5.settings.miles_rate, 0.12, 'miles_rate is read off Settings.md by the real loader');
      await c5.handleStatementFile(file(MILES_FILE, toCsv(ROWS_A)));
      eq(S5.pendingImport.items[0].amount, 5.76, 'and the importer values a Mile at it: 48 Miles at 0.12 is 5.76');
      eq(S5.pendingImport.miles.rate, 0.12, 'the rate used is carried on the import');
      ok(/0[.,]12/.test(txt(c5.$('#impReconcile'))), 'and said on the review');
    }
    for (const [raw, want, why] of [
      ['', 0.1, 'absent'], ['miles_rate: abc\n', 0.1, 'unreadable'], ['miles_rate: 0\n', 0.1, 'zero'],
      ['miles_rate: -1\n', 0.1, 'negative'], ['miles_rate: 5\n', 1, 'above the ceiling (clamped, for a hand edit)'],
      ['miles_rate: "0,15"\n', 0.15, 'a decimal comma'],
    ]) {
      const m = await mount({ ...FILES, [`${B}/Settings.md`]: settings(raw) });
      eq(m.S.settings.miles_rate, want, `miles_rate ${why} reads as ${want}`);
    }

    /* ---- 6. the new-account offer ---- */
    {
      const lone = { ...FILES };
      delete lone[`${B}/Accounts/${MILES_ACCT}.md`];
      const m = await mount(lone);
      await m.ctx.handleStatementFile(file(MILES_FILE, toCsv(ROWS_A)));
      offered.length = 0;
      answers.push({ name: MILES_ACCT, type: 'other', institution: 'Discovery', balance: '0', currency: '', currency_code: '', budget: 'no' });
      await m.ctx.$('#impNewAccount').onclick();
      const form = Object.fromEntries((offered[0] || []).map(f => [f.key, f]));
      eq(form.name.value, 'Discovery Miles', 'the create form is offered with the account already named');
      eq(form.institution.value, 'Discovery', 'with the institution filled in');
      eq(form.type.value, 'other', 'as a rewards account, not a bank one');
      eq(form.budget.value, 'no', 'and OUT of the budget by default');
      eq(m.S.pendingImport.label, MILES_ACCT, 'the review then selects the account just made');
      const made = m.S.accounts.find(a => a.name === MILES_ACCT);
      eq(made.account_number, NUMBER, 'carrying the number the file was named with, so the next export routes itself');
      const fileText = m.ctx.vault._store.get(`${B}/Accounts/${MILES_ACCT}.md`);
      ok(/account_number: "12345678901"/.test(fileText) && /budget: false/.test(fileText), 'and the file says so');
      await m.ctx.loadVault();
      const back = m.ctx.S.accounts.find(a => a.name === MILES_ACCT);
      eq([back.in_budget, back.account_number], [false, NUMBER], 'it reloads as a non-budget account with the number');

      // Other callers get exactly what they got before: budget by default, nothing pre-named.
      offered.length = 0;
      answers.push(null);
      await m.ctx.addAccount({ type: 'checking' });
      const plain = Object.fromEntries(offered[0].map(f => [f.key, f]));
      eq([plain.budget.value, plain.name.value, plain.institution.value], ['yes', undefined, undefined], 'an ordinary new account still defaults to counting toward the budget');
      offered.length = 0;
      answers.push(null);
      await m.ctx.addAccount({ type: 'checking', budget: 'maybe', name: 42 });
      const junk = Object.fromEntries(offered[0].map(f => [f.key, f]));
      eq([junk.budget.value, junk.name.value], ['yes', undefined], 'and a malformed default is ignored — only the literal "no" opts out');
    }

    /* ---- 7. the settings tab's two halves (1.13+ declarative path) ---- */
    {
      const { BudgetSettingTab } = require('../src/settings-tab');
      const written = [];
      const plugin = { updateBudgetSettingsMd: async (k, v) => written.push([k, v]), reloadViews() {}, forEachView() {} };
      const tab = new BudgetSettingTab({}, plugin);
      let md = {};
      tab.mdSettings = () => md;
      eq(tab.getControlValue('miles_rate'), 0.1, 'the control shows the default when the file says nothing');
      md = { miles_rate: 'abc' };
      eq(tab.getControlValue('miles_rate'), 0.1, 'and when it says something unreadable — the rate the importer will actually run');
      md = { miles_rate: 0.125 };
      eq(tab.getControlValue('miles_rate'), 0.125, 'a stated rate is shown as stated');
      await tab.setControlValue('miles_rate', '0.12');
      eq(written, [['miles_rate', '0.12']], 'writing it puts the plain number in Settings.md');
      const defs = tab.getSettingDefinitions().filter(d => d.control && d.control.key === 'miles_rate');
      eq(defs.length, 1, 'the declarative tab offers exactly one such control');
      const v = defs[0].control.validate;
      eq([v('0.10'), v('1')], [undefined, undefined], 'a rate up to the ceiling validates');
      ok(v('10') && v('0') && v('-1') && v('abc') && v(''), 'ten (meaning "ten Miles to the rand"), zero, negative and unreadable are all refused rather than clamped');
    }
  } finally { unpin(); Module._load = origLoad; }
  console.log(`PASS miles-import — Miles route only to non-budget accounts, round-trip through the real loader, re-import counts identical rows (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
