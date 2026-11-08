'use strict';
/* The Accounts page is a quiet list and ONE inspector, driven through the real
   view over the real loader.

   WHY THE PAGE CHANGED. On a real ~760px Obsidian pane the old table crammed
   eight columns in: the State cell held a pill, a why-sentence and up to three
   buttons, so a flagged row was ~270px tall and its buttons were clipped, the
   "November 2026" header wrapped, and the balance sub-line ("R 9 150,62 as at
   Sep 1 · +R 1 080,36 since") ran off its column. The list now says who, how
   much and whether it agrees, with no buttons; selecting a row fills the
   inspector beside it (below it on a phone) with that account's reconciliation
   worked out line by line, its actions and its facts.

   WHAT IS PINNED

     1. DEFAULT SELECTION. With nothing chosen the inspector shows the FIRST
        FLAGGED account in the order the list draws — not the first row — and the
        default is not written into S.acctView.open (so it moves on once that
        account is confirmed). With nothing flagged it shows the first row; with
        no rows it is hidden and the list takes the full width.
     2. SELECTING. A click or Enter/Space selects; the choice lands in
        S.acctView.open; a choice the filter hides is ignored; the table is
        repainted IN PLACE (the very same row nodes), which is what keeps a
        keyboard reader's focus where it was.
     3. THE RECONCILIATION, as lines: Stated, N transactions since, Implied today.
        The three add up, and the last is the figure the ROW leads with (the real
        liveBalance), so the list and the inspector can never print two balances
        for one account. Checked for every account, not only the drifting one.
     4. NO BUTTONS IN THE LIST BEYOND THE THREE A ROW ALWAYS HAD (name, balance,
        notes), and none of the decision controls — the thing that made a flagged
        row ~270px tall. The decisions are in the inspector.
     5. THE ACTIONS, in the inspector: Confirm <implied> first for a drift, then
        the rows and Ignore; the two quiet buttons for a clean account.
     6. THE SHEET ON A PHONE: below 760px, selecting a row scrolls the inspector
        into view; above it, nothing scrolls.
     7. ACCESSIBILITY: the inspector is an aside with an accessible name and a
        polite live region; rows carry aria-selected.
     8. A selection never points at a deleted account.
     9. STICKY CAN STICK: nothing between the inspector and the page's scroller
        is a scroll container, and .main-content (which is) is clipped instead on
        this page. A desktop-only property no DOM stub can see, so its CSS and
        its controller hook are pinned.

     node tests/accounts-inspector.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend, readingI18n } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');
/* readingI18n: the figures harness reads figures through a normaliser (a figure
   space is a no-break space on screen); asking i18n through the same one makes
   "what the page printed" and "what the key says" comparable. */
const i18n = readingI18n(require('../src/i18n'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TODAY = '2026-10-20';
const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const tx = rows => HEAD + rows.map(r => `| ${r[0]} | ${r[1]} |  | ${r[2].toFixed(2)} |  |  |  |\n`).join('');
const acct = (name, fm) => ({ [`${B}/Accounts/${name}.md`]: `---\ntx_label: "${name}"\n${fm}\n---\n` });
const SETTINGS = { [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' };

/* "Big Cheque" is the biggest balance in the first group, so it is the FIRST ROW
   — and it agrees. "Cheque" drifts and is second. If the default were "the first
   row" it would be Big Cheque; the page is a decision queue, so it is Cheque. */
const FILES = {
  ...SETTINGS,
  ...acct('Big Cheque', 'type: checking\nbalance: 90000.00\nbalance_updated: 2026-10-19'),
  [`${B}/Transactions/Big Cheque/2026-09.md`]: tx([['2026-09-02', 'Salary', 5000]]),
  // R1 000,00 typed on the 1st; -100 and +250 since: implies R1 150,00.
  ...acct('Cheque', 'type: checking\nbalance: 1000.00\nbalance_updated: 2026-10-01'),
  [`${B}/Transactions/Cheque/2026-10.md`]: tx([['2026-10-05', 'Shop', -100], ['2026-10-12', 'Refund', 250]]),
  ...acct('Pot', 'type: savings\nbalance: 500.00\nbalance_updated: 2026-10-18\ngoal_amount: 1000.00'),
  [`${B}/Transactions/Pot/2026-09.md`]: tx([['2026-09-20', 'Transfer in', 100]]),
  // Unconfirmed since August: stale, no argument to make.
  ...acct('Old Fund', 'type: savings\nbalance: 200.00\nbalance_updated: 2026-08-01'),
  [`${B}/Transactions/Old Fund/2026-07.md`]: tx([['2026-07-10', 'Transfer in', 200]]),
};
/* Nothing flagged: every account confirmed recently with nothing since. */
const CALM = {
  ...SETTINGS,
  ...acct('Alpha', 'type: checking\nbalance: 300.00\nbalance_updated: 2026-10-19'),
  [`${B}/Transactions/Alpha/2026-09.md`]: tx([['2026-09-02', 'Salary', 5]]),
  ...acct('Beta', 'type: savings\nbalance: 100.00\nbalance_updated: 2026-10-19'),
  [`${B}/Transactions/Beta/2026-09.md`]: tx([['2026-09-02', 'Gift', 5]]),
};

function viewport(wide) {
  const mm = q => ({ matches: /max-width: 760px/.test(q) ? !wide : false, addEventListener() {}, removeEventListener() {} });
  global.matchMedia = mm;
  if (global.window) { global.window.matchMedia = mm; }
}

async function mount(files, { wide = true } = {}) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = '2026-10';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.switchView = () => {};
  ctx.renderTransactions = () => {};   // the name button's drill-through renders it
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  viewport(wide);
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  return { ctx, S, $ };
}

const cls = (n, c) => !!(n._cls && n._cls.has(c));
const byCls = (root, c) => descend(root).filter(n => cls(n, c));
const text = n => String(n.textContent).replace(/\s+/g, ' ').trim();
const num = s => Number(String(s).replace(/−/g, '-').replace(/[^0-9.\-]/g, ''));
const rowsOf = $ => byCls($('#acctTable'), 'acct-row');
const nameOf = tr => text(byCls(tr, 'acct-name-btn')[0] || byCls(tr, 'acct-cell-name')[0]);
const rowNamed = ($, name) => rowsOf($).find(tr => nameOf(tr) === name);
const shownName = $ => text(byCls($('#acctInspector'), 'acct-insp-name')[0]);
const line = ($, fig) => descend($('#acctInspector')).find(n => n.attrs && n.attrs['data-fig'] === fig);

(async () => {
  const unpin = pinClock(TODAY);
  try {
    /* ---- 1. default selection ---- */
    {
      const { ctx, S, $ } = await mount(FILES);
      ctx.renderAccounts();
      const order = rowsOf($).map(nameOf);
      eq(order[0], 'Big Cheque', 'fixture: the first row the list draws is the agreeing account');
      ok(order.includes('Cheque') && order.indexOf('Cheque') > 0, 'and the drifting one sits below it');

      eq(shownName($), 'Cheque', 'nothing chosen: the inspector shows the first FLAGGED account, not the first row');
      eq(S.acctView.open, null, 'and the default is not written down — it must move on once that account is confirmed');
      const sel = rowsOf($).filter(tr => tr.getAttribute('aria-selected') === 'true');
      eq(sel.map(nameOf), ['Cheque'], 'exactly one row is marked selected, and it is the one shown');
      ok(cls(sel[0], 'is-selected'), 'with the class the stylesheet paints');
      ok(rowsOf($).filter(tr => tr !== sel[0]).every(tr => tr.getAttribute('aria-selected') === 'false'),
        'the rest say aria-selected="false" rather than saying nothing');

      /* with a flag filter the list is grouped by reason, and "first" is the list's first */
      S.acctView.filter = 'flag';
      ctx.renderAccounts();
      eq(shownName($), 'Cheque', 'under "Needs a look" the first row is the most urgent reason, a drift');
    }
    {
      const { ctx, $ } = await mount(CALM);
      ctx.renderAccounts();
      eq(rowsOf($).filter(tr => cls(tr, 'is-flag') || cls(tr, 'is-drift')).length, 0, 'fixture: nothing wants a look');
      eq(shownName($), nameOf(rowsOf($)[0]), 'nothing flagged: the inspector shows the first row, so it is never empty');
      ok(!cls($('#acctInspector'), 'is-empty') && cls($('#acctSplit'), 'has-insp'), 'and the list gives it its column');
    }
    {
      const { ctx, $ } = await mount(SETTINGS);
      ctx.renderAccounts();
      ok(cls($('#acctInspector'), 'is-empty'), 'no accounts: the inspector is hidden, not an empty box');
      ok(!cls($('#acctSplit'), 'has-insp'), 'and the list takes the full width');
      eq($('#acctInspector').children.length, 0, 'with nothing in it');
    }

    /* ---- 2. selecting ---- */
    {
      const { ctx, S, $ } = await mount(FILES);
      ctx.renderAccounts();
      const before = rowsOf($);
      rowNamed($, 'Pot')._fire('click');
      eq(shownName($), 'Pot', 'a click selects the row');
      eq(S.acctView.open, 'Pot', 'and the choice is S.acctView.open, which survives a watcher re-render');
      const after = rowsOf($);
      ok(before.length === after.length && before.every((tr, i) => tr === after[i]),
        'the table was repainted IN PLACE — the same row nodes, so a keyboard reader\'s focus is not thrown away');
      eq(after.filter(tr => tr.getAttribute('aria-selected') === 'true').map(nameOf), ['Pot'], 'only the chosen row is selected');
      eq(after.filter(tr => cls(tr, 'is-selected')).length, 1, 'and carries the tint');

      /* a second click on the same row is not a toggle: the inspector is never empty */
      rowNamed($, 'Pot')._fire('click');
      eq(shownName($), 'Pot', 'clicking the selected row again leaves it selected');

      /* keys */
      const old = rowNamed($, 'Old Fund');
      let prevented = 0;
      old._fire('keydown', { key: 'Enter', preventDefault() { prevented++; } });
      eq(shownName($), 'Old Fund', 'Enter on a row selects it');
      rowNamed($, 'Big Cheque')._fire('keydown', { key: ' ', preventDefault() { prevented++; } });
      eq(shownName($), 'Big Cheque', 'and so does Space');
      eq(prevented, 2, 'both stop the page scrolling under the key');
      rowNamed($, 'Cheque')._fire('keydown', { key: 'a' });
      eq(shownName($), 'Big Cheque', 'any other key does nothing');

      /* a full re-render keeps the choice */
      ctx.renderAccounts();
      eq(shownName($), 'Big Cheque', 'a re-render (the watcher) keeps the selection');

      /* a choice the filter hides is ignored, not followed off-screen */
      S.acctView.filter = 'flag';
      ctx.renderAccounts();
      eq(shownName($), 'Cheque', 'Big Cheque is filtered out, so the inspector falls back to the first flagged account');
      eq(S.acctView.open, 'Big Cheque', 'without forgetting the choice, which returns when the filter does');
      S.acctView.filter = 'all';
      ctx.renderAccounts();
      eq(shownName($), 'Big Cheque', 'and it does');

      /* the name button still drills to transactions, and does not select */
      let went = null;
      ctx.switchView = v => { went = v; };
      S.acctView.open = 'Pot';
      ctx.renderAccounts();
      const btn = byCls(rowNamed($, 'Cheque'), 'acct-name-btn')[0];
      ok(btn && btn.tagName === 'BUTTON', 'the name is still a button');
      btn._fire('click', { stopPropagation() {} });
      eq(shownName($), 'Pot', 'drilling into transactions does not move the selection');
    }

    /* ---- 3. the reconciliation, as lines, through the real liveBalance ---- */
    {
      const { ctx, $ } = await mount(FILES);
      ctx.renderAccounts();
      const lines = byCls($('#acctInspector'), 'acct-insp-line');
      eq(lines.length, 3, 'a drift is worked out in three lines');
      const stated = num(text(line($, 'acct-insp-stated'))), since = num(text(line($, 'acct-insp-delta'))), implied = num(text(line($, 'acct-insp-implied')));
      eq(stated, 1000, 'Stated: what was typed');
      eq(since, 150, 'since: what the transactions net (-100 and +250)');
      eq(implied, 1150, 'Implied today: what that implies');
      eq(Math.round((stated + since) * 100), Math.round(implied * 100), 'and the three add up to the cent');
      ok(text(line($, 'acct-insp-delta')).startsWith('+'), 'a rise is signed +');
      ok(cls(lines[2], 'is-total'), 'the last line is the total');
      ok(text(lines[0]).includes(ctx.dateText('2026-10-01')), 'the typed figure carries the date it was typed');
      ok(text(lines[1]).startsWith(i18n.t('acct.insp.since', { count: 2 })), 'and the movement says how many transactions it is');
      eq(num(text(rowNamed($, 'Cheque').querySelectorAll('button').find(b => cls(b, 'acct-bal')))), implied,
        'the implied line IS the figure the list row leads with');
      eq(num(text(line($, 'acct-insp-bal'))), implied, 'and the big balance above it');
      const framing = text(byCls($('#acctInspector'), 'acct-insp-recon-t')[0]);
      ok(framing.includes(i18n.t('acct.insp.which')), 'the argument is framed as a question — which one is wrong?');
      ok(!byCls($('#acctInspector'), 'acct-recon-btn').length, 'and nothing here silently corrects: the one button is the primary action below');
    }

    /* One balance rule, every account: the inspector's big balance is the row's. */
    {
      const { ctx, $ } = await mount(FILES);
      ctx.renderAccounts();
      for (const tr of rowsOf($)) {
        const name = nameOf(tr);
        tr._fire('click');
        const rowBal = text(descend(rowNamed($, name)).find(n => cls(n, 'acct-bal')));
        eq(text(line($, 'acct-insp-bal')), rowBal, `${name}: the inspector prints the balance the row prints`);
      }
      rowNamed($, 'Pot')._fire('click');
      eq(byCls($('#acctInspector'), 'acct-insp-line').length, 0, 'an account with nothing to argue about gets no reconciliation lines');
      ok(text(byCls($('#acctInspector'), 'acct-insp-recon')[0]).includes(i18n.t('acct.drawer.recon.ok')), 'it says so in words');
      rowNamed($, 'Old Fund')._fire('click');
      ok(text(byCls($('#acctInspector'), 'acct-insp-recon')[0]).includes(i18n.t('acct.drawer.recon.stale', { date: ctx.dateText('2026-08-01') })),
        'and a stale one says when it was last confirmed');
    }

    /* ---- 4. no buttons in the list beyond a row's own three ---- */
    {
      const { ctx, $ } = await mount(FILES);
      ctx.renderAccounts();
      const DECISIONS = [i18n.t('acct.deck.ignore'), i18n.t('acct.deck.do.stale'), i18n.t('acct.deck.do.nodate'),
        i18n.t('acct.btn.seeTx'), i18n.t('acct.btn.editBalance'), i18n.t('acct.btn.edit'), i18n.t('acct.btn.delete'),
        i18n.t('acct.deck.do.drift', { amount: 'R 1150.00' })];
      const rows = rowsOf($);
      ok(rows.length >= 4, `the fixture draws several rows (${rows.length})`);
      for (const tr of rows) {
        const name = nameOf(tr);
        const buttons = descend(tr).filter(n => n.tagName === 'BUTTON');
        const allowed = buttons.filter(b => cls(b, 'acct-name-btn') || cls(b, 'acct-bal') || cls(b, 'note-chip') || cls(b, 'note-chip-btn') || cls(b, 'caveat-chip-btn'));
        eq(buttons.filter(b => !allowed.includes(b)).map(text), [], `${name}: no button in the row but name, balance and notes`);
        ok(buttons.length <= 3, `${name}: at most three buttons (${buttons.length})`);
        ok(!buttons.some(b => DECISIONS.includes(text(b))), `${name}: no Confirm / Review / Ignore / Edit on the row`);
        ok(!byCls(tr, 'acct-deck-btn').length && !byCls(tr, 'acct-insp-btn').length && !byCls(tr, 'acct-row-acts').length,
          `${name}: none of the old action classes either`);
        ok(!byCls(tr, 'acct-pill').length, `${name}: no pill — the state is a dot and one word`);
        ok(text(tr).length < 160, `${name}: the row is short — a sentence on it is what made a flagged row ~270px tall (${text(tr).length} chars)`);
      }
      eq(byCls($('#acctTable'), 'acct-drawer-row').length, 0, 'and no drawer row under any of them');

      /* the status is a word, whatever the dot says */
      for (const tr of rows) {
        const st = byCls(tr, 'acct-st')[0];
        ok(st && text(st).length > 0, `${nameOf(tr)}: the status carries a word, not a colour alone`);
      }
      const drift = byCls(rowNamed($, 'Cheque'), 'acct-st')[0];
      eq(text(drift), i18n.t('acct.state.drift'), 'a drift reads "to confirm"');
      ok(cls(drift, 'is-warn'), 'warning-toned');
      eq(text(byCls(rowNamed($, 'Big Cheque'), 'acct-st')[0]), i18n.t('acct.state.ok'), 'an agreeing account reads "agrees"');
      eq(text(byCls(rowNamed($, 'Old Fund'), 'acct-st')[0]), i18n.t('acct.state.stale', { count: 80 }), 'a stale one says how old');

      /* the period's movement stays on the row for the reconciliation gate */
      const flows = byCls($('#acctTable'), 'acct-flow');
      eq(flows.length, 1, 'the movement is a short line under the balance of each account that moved this period (only Cheque did)');
      ok(descend($('#acctTable')).some(n => n.attrs && n.attrs['data-fig'] === 'acct-flow-in'), 'carrying the data-fig the gate reads');
      ok(descend($('#acctTable')).some(n => n.attrs && n.attrs['data-fig'] === 'acct-bal'), 'as does the balance');
      ok(descend($('#acctTable')).some(n => n.attrs && n.attrs['data-fig'] === 'acct-group-total'), 'and the group total');
    }

    /* ---- 5. the actions, in the inspector ---- */
    {
      const { ctx, $ } = await mount(FILES);
      ctx.renderAccounts();
      const btns = () => byCls($('#acctInspector'), 'acct-insp-btn');
      const labels = () => btns().map(text);
      eq(labels(), [i18n.t('acct.deck.do.drift', { amount: 'R 1150.00' }), i18n.t('acct.btn.seeTx'), i18n.t('acct.deck.ignore')],
        'a drift: Confirm the implied figure first, then the rows behind it, then Ignore');
      ok(cls(btns()[0], 'is-primary'), 'and the first is the primary');
      ok(/^Confirm/.test(labels()[0]), 'which says Confirm in English');

      rowNamed($, 'Pot')._fire('click');
      eq(labels(), [i18n.t('acct.btn.seeTx'), i18n.t('acct.btn.editBalance')], 'a clean account: look at its rows, or correct its balance');
      ok(!btns().some(b => cls(b, 'is-primary')), 'with no primary — there is no decision');

      /* everything the drawer offered is still reachable */
      const tools = byCls($('#acctInspector'), 'acct-drawer-act').map(text);
      for (const k of ['acct.btn.edit', 'acct.btn.exclude', 'acct.btn.openNote', 'acct.btn.delete']) {
        ok(tools.includes(i18n.t(k)), `the small controls still include ${i18n.t(k)}`);
      }
      ok(cls(byCls($('#acctInspector'), 'acct-drawer-act').pop(), 'acct-drawer-del'), 'Delete is last and on its own class');
      const facts = byCls($('#acctInspector'), 'acct-drawer-l').map(text);
      for (const k of ['acct.col.confirmed', 'acct.col.state', 'acct.col.goal', 'acct.drawer.goal', 'acct.drawer.toGo', 'acct.drawer.folder', 'acct.drawer.inBudget']) {
        ok(facts.includes(i18n.t(k)), `the facts still include ${i18n.t(k)}`);
      }
      ok(byCls($('#acctInspector'), 'acct-pill').length === 1, 'the state pill is in the inspector, where it has room');
    }

    /* ---- 6. the sheet on a phone ---- */
    for (const [wide, expected] of [[false, 1], [true, 0]]) {
      const { ctx, $ } = await mount(FILES, { wide });
      ctx.renderAccounts();
      let scrolled = 0;
      $('#acctInspector').scrollIntoView = () => { scrolled++; };
      rowNamed($, 'Pot')._fire('click');
      eq(scrolled, expected, wide
        ? 'beside the list, selecting scrolls nothing'
        : 'stacked below the list, selecting scrolls the inspector into view');
    }

    /* ---- 7. accessibility ---- */
    {
      const { ctx, $ } = await mount(FILES);
      ctx.renderAccounts();
      const aside = $('#acctInspector');
      eq(aside.getAttribute('aria-label'), i18n.t('acct.insp.aria'), 'the inspector has an accessible name');
      const shell = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'shell.js'), 'utf8');
      ok(/<aside[^>]*id="acctInspector"[^>]*aria-live="polite"/.test(shell), 'and is an <aside> with aria-live="polite" in the shell, one node across selections');
      ok(/<aside[^>]*id="acctInspector"[^>]*data-i18n-aria="acct\.insp\.aria"/.test(shell), 'whose name follows the language');
      eq($('#acctTable').getAttribute('role'), 'table', 'the list keeps its table semantics');
      ok(byCls($('#acctInspector'), 'acct-insp-grip').every(g => g.getAttribute('aria-hidden') === 'true'), 'the phone grip is decorative');
    }

    /* ---- 8. a selection never points at a deleted account ---- */
    {
      const { ctx, S, $ } = await mount(FILES);
      S.acctView = { open: 'Pot' };
      ctx.renderAccounts();
      eq(shownName($), 'Pot', 'fixture: Pot is selected');
      S.accounts = S.accounts.filter(a => a.name !== 'Pot');
      ctx.renderAccounts();
      eq(shownName($), 'Cheque', 'its account gone, the inspector falls back to the default rather than going blank or throwing');
    }

    /* ---- 9. the inspector can actually stick ----
       `position: sticky` binds to the nearest ancestor that is a scroll
       container. .main-content's `overflow-x: hidden` makes it one that never
       scrolls, so a sticky inspector inside it sits still — silently, in a
       browser, with every rule in this file looking right. Three halves hold it
       together: the inspector is sticky on a desktop; nothing between it and the
       page's real scroller (.bud-scroll) is a scroll container; and the one
       ancestor that IS (.main-content) is turned to `overflow-x: clip` on this
       page, by a class the controller sets. */
    {
      const { readRules } = require('./helpers/css-sources.cjs');
      const rules = readRules();
      const decl = (r, p) => (r.decls.find(d => d.prop === p) || {}).value;
      const insp = rules.filter(r => r.context.length === 0 && r.selectors.includes('.budget-app-root .acct-insp'));
      ok(insp.some(r => decl(r, 'position') === 'sticky'), 'the inspector is position: sticky beside the list');
      for (const sel of ['.budget-app-root .card', '.budget-app-root .acct-split', '.budget-app-root #view-accounts', '.budget-app-root main > section']) {
        for (const r of rules.filter(r => r.selectors.includes(sel))) {
          for (const p of ['overflow', 'overflow-x', 'overflow-y']) {
            ok(!decl(r, p) || /^(visible|clip)$/.test(decl(r, p)),
              `${sel} must not be a scroll container (${p}: ${decl(r, p)}) — the sticky inspector would bind to it and never move`);
          }
        }
      }
      const clip = rules.find(r => r.selectors.includes('.budget-app-root .main-content.is-accounts') && decl(r, 'overflow-x') === 'clip');
      ok(clip, '.main-content.is-accounts swaps overflow-x to clip, so it stops being a scroll container on this page');
      ok(clip && clip.context.some(c => /@supports \(overflow: clip\)/.test(c)), 'behind @supports: iOS 15 has no clip and keeps hidden');
      const ctl = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'controller.js'), 'utf8');
      ok(/\$\('\.main-content'\)\.classList\.toggle\('is-accounts', v === 'accounts'\)/.test(ctl),
        'switchView marks .main-content on the Accounts page and clears it on every other, or the clip would outlive the page');
    }
  } finally {
    unpin();
  }
  console.log(`PASS accounts-inspector — a quiet list, one inspector: default selection, selecting in place, the reconciliation as lines, no list buttons, actions, the phone sheet (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
