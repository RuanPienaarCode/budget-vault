'use strict';
/* The first-steps card on the Dashboard, over the REAL loader and the REAL
   renderDashboard (tests/helpers/dash-audit.cjs).

   src/first-steps.js decides which milestones are done; tests/first-steps
   .test.cjs pins that over hand-built rows. This pins the half that a pure test
   cannot see — that the card reads the right things off a vault the loader
   actually read, and that a row key spelled the way a fixture guessed rather
   than the way table-schema.js names it cannot quietly leave a step unticked
   forever:

     1. off (or never set) means no card at all — an upgraded vault does not
        grow one overnight;
     2. on, over a real vault, it counts what the files earned and offers the
        NEXT step with a button to the page where it is done;
     3. hiding it early turns it off and saves the setting;
     4. a full house says "All set" once and retires the card for good;
     5. a step that ticks between two renders draws its tick — and a card
        drawn for the first time does not replay ticks the reader earned
        last week.

     node tests/first-steps-card.test.cjs */
const assert = require('assert');
const { B, tx, base, account, renderDash, find, hasClass, textOf, pinClock } = require('./helpers/dash-audit.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TODAY = '2026-11-12';
const SINCE = '2026-11-05';
const budget = rows => '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + rows.map(([c, a]) => `| ${c} | expense | ${a} |  |\n`).join('');

function vault({ budgetRows = [['Groceries', 0]], txRows = [], balanceUpdated = SINCE } = {}) {
  return {
    ...base(),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: 100, balance_updated: balanceUpdated }),
    [`${B}/Budgets/2026-11.md`]: budget(budgetRows),
    ...(txRows.length ? { [`${B}/Transactions/Cheque/2026-11.md`]: tx(txRows) } : {}),
  };
}

async function draw(files, plugin = {}, today = TODAY) {
  const unpin = pinClock(today);
  try {
    const { stubObsidian } = require('./helpers/harness.cjs');
    stubObsidian();
    const { mountFor } = require('./helpers/figures.cjs');
    const M = await mountFor(files, { period: '2026-11' });
    Object.assign(M.ctx.plugin.settings, plugin);
    let saved = 0;
    M.ctx.plugin.saveSettings = async () => { saved++; };
    const went = [];
    M.ctx.switchView = v => went.push(v);
    M.ctx.renderDashboard();
    const card = M.nodes.get('#firstStepsCard');
    return { M, card, went, saved: () => saved, redraw: () => { const u = pinClock(today); try { M.ctx.renderDashboard(); } finally { u(); } } };
  } finally { unpin(); }
}
const buttonsIn = n => find(n, x => x.tagName === 'BUTTON');
const fire = n => n.click();   // dom-stub routes click() through its own listeners

(async () => {
  /* 1 */
  {
    const { card } = await draw(vault());
    ok(hasClass(card, 'hidden'), 'never switched on: hidden');
    eq(buttonsIn(card).length, 0, 'and empty');
    const off = await draw(vault(), { firstSteps: 'done', firstStepsSince: SINCE });
    ok(hasClass(off.card, 'hidden'), 'done stays gone');
  }

  /* 2 */
  {
    const { card, went } = await draw(vault({
      budgetRows: [['Groceries', 3000]],
      txRows: [['2026-11-06', 'Shop', 'Groceries', -250], ['2026-11-07', 'Mystery', '', -40]],
    }), { firstSteps: 'on', firstStepsSince: SINCE });
    ok(!hasClass(card, 'hidden'), 'on: the card shows');
    const text = textOf(card);
    ok(text.includes(i18n.t('fs.count', { n: 2, total: 5 })),
      `budget and spending are done, the blank category holds back "sorted": got "${text}"`);
    const segs = find(card, n => hasClass(n, 'fs-seg'));
    eq(segs.length, 5, 'five segments');
    eq(segs.filter(n => hasClass(n, 'is-done')).length, 2, 'two filled');
    ok(text.includes(i18n.t('fs.sorted.title')), 'the next step is sorting');
    const go = buttonsIn(card).find(b => hasClass(b, 'fs-go'));
    ok(go, 'with a button');
    fire(go);
    eq(went, ['transactions'], 'that goes where the sorting is done');
    const bar = find(card, n => n.attrs && n.attrs.role === 'progressbar')[0];
    eq(bar && bar.attrs['aria-valuenow'], '2', 'the bar reads as progress to a screen reader');
  }

  /* 3 */
  {
    const d = await draw(vault(), { firstSteps: 'on', firstStepsSince: SINCE });
    const hide = buttonsIn(d.card).find(b => hasClass(b, 'fs-hide'));
    ok(hide, 'a hide button');
    eq(hide.attrs['aria-label'], i18n.t('fs.hide'), 'labelled for a screen reader');
    fire(hide);
    eq(d.M.ctx.plugin.settings.firstSteps, 'off', 'hiding turns it off');
    ok(d.saved() >= 1, 'and saves');
    ok(hasClass(d.card, 'hidden'), 'and the card goes at once');
  }

  /* 4 */
  {
    const d = await draw(vault({
      budgetRows: [['Groceries', 3000]],
      /* An imported transfer arrives EXCLUDED and uncategorised (import.js);
         the budget never counts it, so the card must not ask for a category
         on it — the first cut did, and the card could never finish. */
      txRows: [['2026-11-06', 'Shop', 'Groceries', -250], ['2026-11-08', 'To savings', '', -500, 'yes']],
      balanceUpdated: '2026-11-10',
    }), { firstSteps: 'on', firstStepsSince: '2026-10-05', firstStepsStamps: { Cheque: '100|2026-10-05' } }, TODAY);
    const text = textOf(d.card);
    ok(text.includes(i18n.t('fs.done.title')), `a full house says All set, got "${text}"`);
    eq(d.M.ctx.plugin.settings.firstSteps, 'done', 'and retires the card');
    ok(d.saved() >= 1, 'saved, so it stays retired');
  }

  /* 5 */
  {
    const files = vault({ budgetRows: [['Groceries', 3000]] });
    const d = await draw(files, { firstSteps: 'on', firstStepsSince: SINCE });
    eq(find(d.card, n => hasClass(n, 'is-new')).length, 0,
      'the first drawing replays nothing — those ticks were earned before this visit');
    // The reader goes away and records a transaction; the vault reloads.
    d.M.S.txFiles['Cheque/2026-11'] = {
      label: 'Cheque', month: '2026-11', rows: [{ date: '2026-11-08', desc: 'Shop', cat: 'Groceries', amount: -10, excluded: false, split: '' }],
    };
    d.redraw();
    const fresh = find(d.card, n => hasClass(n, 'is-new'));
    ok(fresh.length >= 1, 'the step that just ticked draws its tick');
    d.redraw();
    eq(find(d.card, n => hasClass(n, 'is-new')).length, 0, 'once — the next render does not play it again');
  }

  /* 6 — switched on from Settings, there is no snapshot yet: the first
     drawing takes one, so the balances already in the vault do not tick the
     step, and saves it. */
  {
    const d = await draw(vault(), { firstSteps: 'on', firstStepsSince: SINCE });
    eq(d.M.ctx.plugin.settings.firstStepsStamps, { Cheque: '100|' + SINCE }, 'the first drawing snapshots the balances');
    ok(d.saved() >= 1, 'and saves the snapshot');
    const acct = d.M.S.accounts.find(a => a.name === 'Cheque');
    acct.balance = 4321;   // the reader types their bank's figure in, same day
    d.redraw();
    ok(find(d.card, n => hasClass(n, 'fs-item') && hasClass(n, 'is-done')).some(n => textOf(n).includes(i18n.t('fs.balance.title'))),
      'a same-day check of the account ticks the balance step');
  }

  console.log(`PASS first-steps-card (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
