'use strict';
/* A recurring charge that fell due between the period start and today, on an
   account whose records stop BEFORE that day, is not "missing" — it is not
   imported yet. "Still committed" holds it, by name, and the card says how
   fresh its cash figure is.

   committed.js started its window at today and dropped every earlier due
   date ("a charge dated earlier that never arrived is not still coming, it is
   missing"). That is right once the account has been imported past the due
   date. Before that, the charge is in neither bucket: not in cash, because no
   statement holding it has been imported, and not in "still committed",
   because its date has passed. Measured on a real household on a 7 October:
   three debit orders due on the 1st, on two accounts last imported on the
   26th and the 29th, were counted nowhere, and "actually free" was too high
   by their whole sum. Synthetic figures below; the shape is the real one.

   The facts come from the view (each account's newest row on or before
   today, its balance confirmation date, and which account each row belongs
   to); the decision is committed.js's, so it is driven here in bare node.

     node tests/committed-not-imported.test.cjs */

const assert = require('assert');
const { serviceCommitments, whatsLeft } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* A payday month, 22nd to 21st, read on the 7th. */
const P_START = '2026-09-22', P_END = '2026-10-21', TODAY = '2026-10-07';

const acct = (name, extra) => ({ name, type: 'checking', dated: true, inBudget: true, ...extra });
/* The two accounts the cash figure is made of: the cheque account last
   imported on the 26th, a card in credit last imported on the 29th. Both
   balances were confirmed on the 10th. */
const cheque = () => acct('Cheque', { implied: 19800, importedTo: '2026-09-26', balanceDate: '2026-09-10' });
const card = () => acct('Card', { type: 'credit_card', implied: 850, importedTo: '2026-09-29', balanceDate: '2026-09-10' });

const charge = (date, desc, amount) => ({ date, desc, cat: 'Bills', amount });
const monthly = (desc, amount, dates) => dates.map(d => charge(d, desc, -amount));
const gymRows = monthly('GYMCO DEBIT', 300, ['2026-07-01', '2026-08-01', '2026-09-01']);
const fibreRows = monthly('FIBRECO 4471', 600, ['2026-07-01', '2026-08-01', '2026-09-01']);
const streamRows = monthly('STREAMCO', 100, ['2026-08-15', '2026-09-15']);

const gym = { name: 'Gym', provider: 'GymCo', cycle: 'monthly', amount: 300, active: true, next: '' };
const fibre = { name: 'Fibre', provider: 'FibreCo', cycle: 'monthly', amount: 600, active: true, next: '' };
const stream = { name: 'Stream', provider: 'StreamCo', cycle: 'monthly', amount: 100, active: true, next: '' };

/* Which account's folder each row came from — the view builds this map from
   the transaction folders, keyed by the very row objects it hands over. */
function ownership(pairs) {
  const m = new Map();
  for (const [rows, account] of pairs) for (const r of rows) m.set(r, account);
  return m;
}

/* ---- 1. due before today, account not imported since: held, by name ---- */
{
  const c = card();
  const out = serviceCommitments({
    services: [gym], rows: gymRows, from: TODAY, to: P_END, periodStart: P_START,
    accountOfRow: ownership([[gymRows, c]]),
  });
  eq(out, [{
    kind: 'service', name: 'Gym', detail: 'GymCo', due: '2026-10-01',
    amount: 300, occurrences: 1, unit: 300, basis: 'not-imported',
    account: 'Card', asOf: '2026-09-29',
  }], 'a service due before today on an account not imported since is held as not-imported');
}

/* ---- 1b. a due date before the period opened is last period's ----
   Gym last charged 1 August on a card last imported mid-August: its
   September charge fell due on the 1st, before this period began on the
   22nd. Whatever happened to it, it is not a claim on THIS period's cash. */
{
  const rows = monthly('GYMCO DEBIT', 300, ['2026-07-01', '2026-08-01']);
  const c = { ...card(), importedTo: '2026-08-15', balanceDate: '2026-08-10' };
  eq(serviceCommitments({
    services: [gym], rows, from: TODAY, to: P_END, periodStart: P_START,
    accountOfRow: ownership([[rows, c]]),
  }), [], 'only a due date between the period start and today is held');
}

/* ---- 2. NEGATIVE CONTROL: imported past the due date, still dropped ----
   Without this, holding every past due date would pass case 1. */
{
  const c = { ...card(), importedTo: '2026-10-03' };
  eq(serviceCommitments({
    services: [gym], rows: gymRows, from: TODAY, to: P_END, periodStart: P_START,
    accountOfRow: ownership([[gymRows, c]]),
  }), [], 'a service due before today on an account imported past the due date is still dropped');

  /* Imported up to the due date itself counts as imported past it: the rule
     holds a charge only when the account's records are OLDER than its day. */
  const same = { ...card(), importedTo: '2026-10-01' };
  eq(serviceCommitments({
    services: [gym], rows: gymRows, from: TODAY, to: P_END, periodStart: P_START,
    accountOfRow: ownership([[gymRows, same]]),
  }), [], 'records that reach the due date itself are not "older than" it');
}

/* ---- 3. a balance confirmed after the due date already holds the charge ---- */
{
  const c = { ...card(), balanceDate: '2026-10-02' };
  eq(serviceCommitments({
    services: [gym], rows: gymRows, from: TODAY, to: P_END, periodStart: P_START,
    accountOfRow: ownership([[gymRows, c]]),
  }), [], 'a balance confirmed on or after the due date is not held again — that would subtract the charge twice');

  /* A confirmation dated after today is a typo (reconcile() treats it as no
     date at all), so it proves nothing and the rows decide. */
  const typo = { ...card(), balanceDate: '2027-10-02' };
  eq(serviceCommitments({
    services: [gym], rows: gymRows, from: TODAY, to: P_END, periodStart: P_START,
    accountOfRow: ownership([[gymRows, typo]]),
  }).map(i => i.basis), ['not-imported'], 'a confirmation dated in the future does not count as one');
}

/* ---- 4. a charge already seen this period is not double-held ----
   A 45-day window where the monthly charge HAS landed inside it: the
   one-charge-per-period rule decides first, so the next one is not held. */
{
  const rows = monthly('GYMCO DEBIT', 300, ['2026-08-02', '2026-09-02']);
  const c = card();
  eq(serviceCommitments({
    services: [gym], rows, from: TODAY, to: '2026-10-15', periodStart: '2026-09-01',
    accountOfRow: ownership([[rows, c]]),
  }), [], 'a charge already seen this period is not double-held');
}

/* ---- 5. no facts, no change: a caller that never heard of the fields ---- */
{
  eq(serviceCommitments({ services: [gym], rows: gymRows, from: TODAY, to: P_END, periodStart: P_START }),
    [], 'without accountOfRow the past due date is dropped exactly as before');
  const accounts = [{ name: 'Cheque', implied: 1000, dated: true, inBudget: true }];
  const L = whatsLeft({
    accounts, services: [gym], debts: [], rows: gymRows,
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq([L.committed, L.cashAsOf, L.counts.notImported], [0, null, 0],
    'and whatsLeft reports no as-of it was not given the dates for');

  /* A charge on a folder no account claims has no account to read a date off. */
  eq(serviceCommitments({
    services: [gym], rows: gymRows, from: TODAY, to: P_END, periodStart: P_START, accountOfRow: new Map(),
  }), [], 'a charge whose row belongs to no account is not held on a guess');
}

/* ---- 6. the card as a whole ---- */
{
  const ch = cheque(), c = card();
  const rows = [...gymRows, ...fibreRows, ...streamRows];
  const L = whatsLeft({
    accounts: [ch, c], services: [gym, fibre, stream], debts: [], rows,
    accountOfRow: ownership([[gymRows, c], [streamRows, c], [fibreRows, ch]]),
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.items.map(i => [i.name, i.basis, i.due, i.amount]), [
    ['Fibre', 'not-imported', '2026-10-01', 600],
    ['Gym', 'not-imported', '2026-10-01', 300],
    ['Stream', 'charged', '2026-10-15', 100],
  ], 'both overdue-but-unimported orders are held beside the one still to come');
  eq(L.committed, 1000, 'still committed includes them');
  eq(L.free, 20650 - 1000, '"actually free" is cash less committed including them');
  eq(L.counts, { service: 3, debt: 0, card: 0, notImported: 2 }, 'and the counts say how many are held');
  eq(L.cashAsOf, '2026-09-26', 'the cash as-of names the earliest last import');
}

/* ---- 7. the cash as-of reads the accounts in the figure, and only those ---- */
{
  const L = (accounts) => whatsLeft({
    accounts, services: [], debts: [], rows: [], periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L([card()]).cashAsOf, '2026-09-29', 'one account: its own date');
  eq(L([cheque(), card(),
    /* Neither of these is in `cash`, so neither may age it. */
    acct('Empty', { implied: 0, importedTo: '2026-06-01', balanceDate: '2026-06-01' }),
    acct('Business', { inBudget: false, implied: 5000, importedTo: '2026-05-01', balanceDate: '2026-05-01' }),
  ]).cashAsOf, '2026-09-26', 'accounts that contributed nothing to cash do not drag its date back');
  eq(L([{ ...cheque(), importedTo: '' }]).cashAsOf, null,
    'an account nothing is imported into has no import to date the figure by');
  eq(L([cheque(), acct('Wallet', { implied: 500, importedTo: '', balanceDate: '2026-06-01' })]).cashAsOf, '2026-09-26',
    'a hand-kept wallet confirmed in June does not drag the imported figure back to June — "unconfirmed" reports its age');
  eq(L([{ ...cheque(), balanceDate: '2026-10-05' }]).cashAsOf, '2026-10-05',
    'and a balance confirmed after the last import is newer than it');
}

/* ---- 8. a weekly service: each past occurrence is judged on its own ---- */
{
  const swimRows = monthly('SWIMCO', 50, ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
  const swim = { name: 'Swim', provider: 'SwimCo', cycle: 'weekly', amount: 50, active: true, next: '' };
  const run = c => serviceCommitments({
    services: [swim], rows: swimRows, from: TODAY, to: P_END, periodStart: P_START,
    accountOfRow: ownership([[swimRows, c]]),
  }).map(i => [i.basis, i.due, i.occurrences, i.amount]);
  eq(run(card()), [
    ['not-imported', '2026-10-06', 1, 50],
    ['charged', '2026-10-13', 2, 100],
  ], 'the 6 Oct charge is held (card imported to the 29th); 13 and 20 Oct are still to come');
  eq(run({ ...card(), importedTo: '2026-10-06' }), [['charged', '2026-10-13', 2, 100]],
    'imported up to the 6th with no charge that day: missing, dropped as before');
  ok(run(card()).every(([, due]) => due !== '2026-09-22' && due !== '2026-09-29'),
    'occurrences matched by a real charge are never held');
}

console.log(`PASS — a charge its account has not been imported past is held, by name (${checks} assertions).`);
