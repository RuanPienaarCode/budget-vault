'use strict';
/* The Dashboard's first-steps card — five milestones a household new to the
   app works through after setup, drawn above the hero.

   The wizard used to end on a paragraph of homework and then the app said
   nothing more about what to do. This is that paragraph as five things that
   tick off, one of which is always in front of the reader with a button to
   the page where it is done.

   Which steps are done is src/first-steps.js's call, read off the vault —
   nothing here stores a tick. This file only decides what to draw:

     - a five-segment bar and "2 of 5 done";
     - the NEXT step in full: what it is, one sentence on how, and a button;
     - every step behind a native <details>, so the card stays small on a
       375px phone and the whole list is one tap away;
     - when all five are done, "All set" once, and the card retires itself.

   MOTION, and only where something happened. A step that ticks between two
   renders in the same session draws its tick and the existing .bud-shine
   sweeps its title — the dashboard's own landing effect, so there is nothing
   new to look at and no glow. The first drawing of the card replays nothing:
   ticks earned last week are not news. Keyframes only (styles.css), dropped
   under reduced motion.

   Only shown where data.json says `firstSteps: on`, which only the setup
   wizard (and the Settings toggle) writes. */

const { el, icoEl } = require('../dom');
const i18n = require('../i18n');
const { todayIso, isRealIsoDate, isoDayNumber, isoFromDayNumber } = require('../dates');
const { inputMode } = require('../constants');
const { firstSteps, stepTarget, firstStepsOn, balanceStamps } = require('../first-steps');
const { LENSES, keeps } = require('../ledger');

function createFirstStepsCard(ctx) {
  const { S, $, plugin, currentPeriod, periodRange, dateText, ledger } = ctx;
  /* The done-set at the last drawing, or null before the first. A Set rather
     than a count, so a step that un-ticks (the reader blanks a category) and
     another that ticks in the same render is still seen as news. */
  let seen = null;

  function read() {
    const ps = plugin.settings;
    const today = todayIso();
    /* A card switched on by hand-editing data.json, with no date beside it,
       counts from today rather than from never — the conservative reading:
       it can only leave the balance step unticked a little longer. */
    const since = isRealIsoDate(ps.firstStepsSince) ? ps.firstStepsSince : today;
    const cp = currentPeriod();
    const mode = inputMode(S.settings.input_mode);
    /* Rows through the ledger's stamps, not raw — CLAUDE.md's rule for any new
       reader of transaction rows, and the reason is concrete here. The
       importer brings a recognised transfer in EXCLUDED and uncategorised on
       purpose, and a fund or non-budget account's rows are not budget money:
       read raw, "sort every transaction" demanded a category on rows the
       budget never counts, and one transfer kept the card from finishing.

       "Sorted" asks of exactly the rows the Dashboard's own uncategorised
       count is taken over — the BUDGET lens. "Spending in" counts every row
       in a budget account, excluded or not (an imported statement that is
       all transfers still got the statement in); first-steps.js takes the
       split parts back out so one split charge is one transaction. */
    const period = periodRange(cp);
    const periodRows = ledger(period.start, period.end).filter(s => keeps(LENSES.BUDGET, s)).map(s => s.row);
    const rows = ledger('0000-01-01', '9999-12-31').filter(s => !s.nonBudget && !s.foreign).map(s => s.row);
    const sincePeriodEnd = periodRange(currentPeriod(since)).end;
    /* The balance snapshot. The wizard does not write one: the first drawing
       of the card takes it, from the accounts as setup left them, and saves
       it — so a card switched on from Settings over an old vault starts from
       that vault's balances too, and neither path pre-ticks the step. */
    if (!ps.firstStepsStamps || typeof ps.firstStepsStamps !== 'object') {
      ps.firstStepsStamps = balanceStamps(S.accounts);
      save();
    }
    return {
      mode, sincePeriodEnd,
      result: firstSteps({
        mode, since, today, sincePeriodEnd, stamps: ps.firstStepsStamps,
        /* The setup period's budget as well as this one's: budgets are one
           file per period with no carry-forward, so on the day the month step
           ticks, a current-period-only read would UN-tick the budget step —
           un-doing a tick the reader earned weeks ago. */
        budgetRows: [...(S.budgets[cp] || []), ...(S.budgets[currentPeriod(since)] || [])],
        rows, periodRows, accounts: S.accounts || [],
      }),
    };
  }

  async function save() {
    try { await plugin.saveSettings(); } catch (e) {
      ctx.toast?.(i18n.t('settings.err.save', { error: e?.message || e }), 'danger');
    }
  }

  function hide(box) {
    plugin.settings.firstSteps = 'off';
    box.empty();
    box.classList.add('hidden');
    save();
  }

  function stepText(key, mode, sincePeriodEnd) {
    const desc = key === 'spending' ? i18n.t('fs.spending.desc.' + mode)
      : key === 'month' ? i18n.t('fs.month.desc', { date: dateText(nextDay(sincePeriodEnd)) })
        : i18n.t(`fs.${key}.desc`);
    const btn = key === 'spending' ? i18n.t('fs.spending.btn.' + mode) : i18n.t(`fs.${key}.btn`);
    return { title: i18n.t(`fs.${key}.title`), desc, btn };
  }

  function mark(done, fresh) {
    const m = el('span', { class: 'fs-mark' + (done ? ' is-done' : '') + (fresh ? ' is-new' : ''), 'aria-hidden': 'true' });
    if (done) m.append(icoEl('check', 'fs-tick'));
    return m;
  }

  function render() {
    const box = $('#firstStepsCard');
    if (!box) return;
    box.empty();
    if (!firstStepsOn(plugin.settings)) { box.classList.add('hidden'); seen = null; return; }
    box.classList.remove('hidden');

    const { mode, sincePeriodEnd, result } = read();
    const doneNow = new Set(result.steps.filter(s => s.done).map(s => s.key));
    /* Compared against the PREVIOUS drawing, captured before it is replaced —
       `fresh` is called all the way down this function, after `seen` has
       already moved on to this render's set. */
    const before = seen;
    const fresh = k => before !== null && doneNow.has(k) && !before.has(k);
    seen = doneNow;

    const head = el('div', { class: 'fs-head' },
      el('h3', { class: 'fs-title' + (result.complete ? ' bud-shine' : '') },
        i18n.t(result.complete ? 'fs.done.title' : 'fs.title')),
      el('span', { class: 'fs-count' }, i18n.t('fs.count', { n: result.done, total: result.total })),
      el('button', {
        type: 'button', class: 'fs-hide clickable-icon', 'aria-label': i18n.t('fs.hide'), title: i18n.t('fs.hide'),
        onclick: () => hide(box),
      }, icoEl('x')));
    box.append(head);

    box.append(el('div', {
      class: 'fs-bar', role: 'progressbar', 'aria-valuemin': '0',
      'aria-valuemax': String(result.total), 'aria-valuenow': String(result.done),
      'aria-label': i18n.t('fs.count', { n: result.done, total: result.total }),
    }, result.steps.map((s, i) => el('span', {
      class: 'fs-seg' + (s.done ? ' is-done' : '') + (fresh(s.key) ? ' is-new' : ''),
      style: `--fs-i:${i}`,
    }))));

    if (result.complete) {
      box.append(el('p', { class: 'fs-desc' }, i18n.t('fs.done.body')));
      /* Retired on the way out of this render, so the reader sees "All set"
         exactly once and the next visit has no card. Saved, so a restart
         agrees; Settings can switch it back on. */
      plugin.settings.firstSteps = 'done';
      save();
      return;
    }

    const next = stepText(result.next, mode, sincePeriodEnd);
    const target = stepTarget(result.next, mode);
    box.append(el('div', { class: 'fs-next' },
      mark(false, false),
      el('div', { class: 'fs-next-body' },
        el('div', { class: 'fs-next-title' }, next.title),
        el('div', { class: 'fs-desc' }, next.desc),
        target ? el('button', {
          type: 'button', class: 'btn-ghost btn-ghost-sm fs-go',
          onclick: () => ctx.switchView(target),
        }, next.btn) : null)));

    const list = el('details', { class: 'fs-all' },
      el('summary', {}, i18n.t('fs.showAll')),
      el('ol', { class: 'fs-list' }, result.steps.map(s => el('li', {
        class: 'fs-item' + (s.done ? ' is-done' : '') + (s.key === result.next ? ' is-next' : ''),
      }, mark(s.done, fresh(s.key)),
      el('span', { class: 'fs-item-title' + (fresh(s.key) ? ' bud-shine' : '') }, i18n.t(`fs.${s.key}.title`))))));
    box.append(list);
  }

  return { render };
}

/* The first day the month step can tick — the day after the setup period
   ends. Day-number arithmetic from dates.js, the same the period maths uses,
   so a DST change or a month boundary cannot move it. */
const nextDay = iso => (isRealIsoDate(iso) ? isoFromDayNumber(isoDayNumber(iso) + 1) : '');

module.exports = { createFirstStepsCard, nextDay };
