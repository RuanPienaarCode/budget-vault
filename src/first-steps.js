'use strict';
/* The dashboard's first-steps checklist: five milestones a new household
   works through after the setup wizard closes.

   The wizard used to end on a sentence of homework — "give your categories an
   amount on the Budgets page, then import your bank's CSV" — and then the app
   said nothing else about what to do. This is that sentence made visible, one
   tick at a time.

   NO TICK IS STORED. Each step is read off the same files every other figure
   is read off, so a reader who types their budget in by hand, edits a balance
   in the account note, or turns the card on over a vault they have had for a
   year gets exactly the ticks their files have earned. A stored "clicked the
   button" flag would be the one number in this app nobody could check.

   The only things kept in data.json are whether the card is showing at all
   (`firstSteps`: on / off / done), the day it was switched on (`since`), and
   a snapshot of each account's balance stamp at that moment (`stamps`) — the
   line between what setup wrote and what the reader did afterwards.

   Pure: no DOM, no obsidian, no clock. `today` is injected.
   tests/first-steps.test.cjs pins it. */

const { supersededBySplit, isSplitPart } = require('./tx-role');
const { isRealIsoDate } = require('./dates');

const STEP_KEYS = ['budget', 'spending', 'sorted', 'balance', 'month'];

/* Five, for a manual household, because one hand-typed row is a test of the
   button rather than a habit; a CSV household's first import brings a whole
   statement in at once, so one row means it worked. */
const MANUAL_ROWS = 5;

/* A split's parts are a category the reader drew INSIDE one charge — not lines
   the bank printed — so they are not more transactions. Counting them would
   let one split of a grocery bill into three finish the manual step. */
const countsAsEntered = r => !isSplitPart(r);

/* A split parent is described by its parts; its own Category cell is blank by
   design (tx-role.js), and asking the reader to fill it in would be asking
   them to categorise the same money twice. */
const needsCategory = r => !supersededBySplit(r);
/* `cat`, the loader's key for the Category column (table-schema.js) — not
   `category`, which is what a budget row calls the same idea. */
const hasCategory = r => String(r && r.cat != null ? r.cat : '').trim() !== '';

function firstSteps({
  mode = 'csv', since = '', today = '', sincePeriodEnd = '',
  budgetRows = [], rows = [], periodRows = [], accounts = [], stamps = null,
} = {}) {
  const budget = budgetRows.some(r => {
    const v = Number(r && r.amount);
    return Number.isFinite(v) && v !== 0;
  });
  const entered = rows.filter(countsAsEntered).length;
  const spending = entered >= (mode === 'manual' ? MANUAL_ROWS : 1);
  /* Waits for spending: "nothing left uncategorised" over an empty ledger is
     true and useless, and ticking it on day one would be the card claiming
     work nobody did. The CURRENT period only — an old vault switching this on
     should not be sent back through three years of blank categories. */
  const sorted = spending && periodRows.filter(needsCategory).every(hasCategory);
  /* Compared by STAMP — balance and date together — against a snapshot of
     what setup left on each account, not by date alone. The wizard stamps
     balance_updated on the day it creates the account, so a date test either
     pre-ticks the step (>=) or makes it unfinishable on setup day (>), which is
     exactly when the card asks for it. Any change to an account's stamp is the
     reader recording a claim: typing in the bank's figure today, confirming
     it on a later day, or accepting the app's own figure (which stamps the
     last counted row's date, usually BEFORE setup — a date test misses it).

     This asks only that the reader RECORD the claim, never that the two
     balances agree: a "make them match" step would reward editing figures
     until they did, the opposite of what reconciliation is for. */
  const balance = accounts.some(a => {
    if (!a || !isRealIsoDate(a.balance_updated)) return false;
    const was = stamps ? stamps[a.name] : undefined;
    if (was !== undefined) return stampOf(a) !== was;
    /* An account the snapshot never saw: added after setup, so a balance
       stated on or after `since` is the reader's. With no snapshot at all
       (the card always passes one), only a later day proves anything. */
    if (!isRealIsoDate(since)) return false;
    return stamps ? a.balance_updated >= since : a.balance_updated > since;
  });
  /* The day AFTER the period ends — the last day is still inside it. */
  const month = isRealIsoDate(sincePeriodEnd) && isRealIsoDate(today) && today > sincePeriodEnd;

  const by = { budget, spending, sorted, balance, month };
  const steps = STEP_KEYS.map(key => ({ key, done: by[key] }));
  const done = steps.filter(s => s.done).length;
  const first = steps.find(s => !s.done);
  return { steps, done, total: steps.length, next: first ? first.key : null, complete: !first };
}

/* An account's balance claim as one comparable string: the figure and the day
   it was stated. Number() so "100.00" on disk and 100 in memory agree. */
const stampOf = a => `${Number(a.balance)}|${a.balance_updated || ''}`;

/* The snapshot `stamps` is compared against — taken from the accounts as setup
   (or the Settings switch) left them, and kept in data.json. */
function balanceStamps(accounts) {
  const out = {};
  for (const a of accounts || []) if (a && a.name) out[a.name] = stampOf(a);
  return out;
}

/* The page each step is done on. `month` has none: it finishes by itself as
   the calendar moves, and a button that goes nowhere is worse than no button. */
function stepTarget(key, mode) {
  if (key === 'budget') return 'budgets';
  if (key === 'spending') return mode === 'manual' ? 'transactions' : 'import';
  if (key === 'sorted') return 'transactions';
  if (key === 'balance') return 'accounts';
  return null;
}

/* Absent is OFF. Only the wizard turns this on, so a vault that predates the
   card does not grow one overnight on upgrade; Settings can turn it on. */
function firstStepsOn(pluginSettings) {
  return !!pluginSettings && pluginSettings.firstSteps === 'on';
}

module.exports = { firstSteps, stepTarget, firstStepsOn, balanceStamps, STEP_KEYS, MANUAL_ROWS };
