'use strict';
/* A monthly debit order is not forgotten at the period boundary.

   serviceCommitments dated a monthly service off its last charge plus one
   cycle (nextExpected) and then dropped it whenever that date fell before the
   period's start: "a charge dated earlier that never arrived is missing, not
   still coming". That is right once the account has been imported past the
   date. It is wrong at the boundary of a household that imports at month end:
   the period opens on the 22nd, the cheque account was last imported on the
   26th of the month before, and every service last charged on the 1st has its
   next date (the 1st) BEFORE the period — so the whole monthly bill fell out
   of "still committed" for the entire new period, never stepped forward to
   the 1st of the month after. On the real vault this was found on, "still
   committed" read about R2 300 on the 21st and R60 on the 22nd, with no file
   changed (2026-10-14 audit, L1-01).

   The two halves of the fix, pinned here:
     1. a due date before the period is stepped forward a cycle at a time into
        the window, and the first occurrence inside it is committed;
     2. each date the payer's records have not reached yet (after knownTo) is
        held as `not-imported` whatever side of the boundary it falls on —
        those charges are in neither the cash nor the statements. A date the
        records DO reach with no charge on it really was missed, and stays
        dropped.
   Weekly and fortnightly services get the second half too: their walk used to
   start at the period start and so skipped everything between the payer's
   last import and the boundary.

   Synthetic figures; the shape is the real one.

     node tests/committed-period-boundary.test.cjs */

const assert = require('assert');
const { serviceCommitments, whatsLeft } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* A payday month, 22nd to 21st, read on the day it opens. */
const P_START = '2026-10-22', P_END = '2026-11-21', TODAY = '2026-10-22';

const cheque = extra => ({ name: 'Cheque', type: 'checking', dated: true, inBudget: true, implied: 20000,
  importedTo: '2026-09-26', balanceDate: '2026-09-10', ...extra });
const monthly = (desc, amount, dates) => dates.map(d => ({ date: d, desc, cat: 'Bills', amount: -amount }));
const owned = (rows, account) => new Map(rows.map(r => [r, account]));
const run = (services, rows, account, extra) => serviceCommitments({
  services, rows, from: TODAY, to: P_END, periodStart: P_START, accountOfRow: owned(rows, account), ...extra,
});
const shape = items => items.map(i => [i.name, i.basis, i.due, i.occurrences, i.amount]);

const gym = { name: 'Gym', provider: 'GymCo', cycle: 'monthly', amount: 300, active: true, next: '' };
const gymRows = monthly('GYMCO DEBIT', 300, ['2026-07-01', '2026-08-01', '2026-09-01']);

/* ---- 1. the reported shape: last charge the 1st, import stops on the 26th ----
   1 Oct fell between the import and the boundary (held); 1 Nov is the charge
   this period will see (committed). Before the fix BOTH were dropped. */
{
  const out = run([gym], gymRows, cheque());
  eq(shape(out), [
    ['Gym', 'not-imported', '2026-10-01', 1, 300],
    ['Gym', 'charged', '2026-11-01', 1, 300],
  ], 'a monthly service is held for the date the import missed AND committed for the one in the window');
  eq(out[0].asOf, '2026-09-26', 'the held row names how far its account is imported');
  eq(out[0].account, 'Cheque', 'and which account');
}

/* ---- 2. NEGATIVE CONTROL: records that reach the date, no charge on it ----
   Imported to 5 Oct and nothing on the 1st: that charge really did not happen
   (cancelled, skipped, moved). It is not held; the window's date still stands. */
{
  const out = run([gym], gymRows, cheque({ importedTo: '2026-10-05' }));
  eq(shape(out), [['Gym', 'charged', '2026-11-01', 1, 300]],
    'a date the records reach with no charge on it is dropped, not held');
}

/* ---- 3. a balance confirmed after the date already holds the charge ---- */
{
  const out = run([gym], gymRows, cheque({ balanceDate: '2026-10-02' }));
  eq(shape(out), [['Gym', 'charged', '2026-11-01', 1, 300]],
    'a balance confirmed on 2 Oct already contains the 1 Oct charge — not subtracted twice');
}

/* ---- 4. no account facts: the window's own date is still committed ----
   Before the fix this returned nothing at all for the whole period. */
{
  const out = serviceCommitments({ services: [gym], rows: gymRows, from: TODAY, to: P_END, periodStart: P_START });
  eq(shape(out), [['Gym', 'charged', '2026-11-01', 1, 300]],
    'with no accountOfRow the date before the period is skipped, and 1 Nov is committed');
}

/* ---- 5. several missed cycles come back as ONE held row with a count ---- */
{
  const rows = monthly('GYMCO DEBIT', 300, ['2026-06-01', '2026-07-01', '2026-08-01']);
  const out = run([gym], rows, cheque({ importedTo: '2026-08-20', balanceDate: '2026-08-10' }));
  eq(shape(out), [
    ['Gym', 'not-imported', '2026-09-01', 2, 600],
    ['Gym', 'charged', '2026-11-01', 1, 300],
  ], 'the 1 Sep and 1 Oct charges the import has not reached are one held row, 2 x R300');
}

/* ---- 6. a service that stopped does not resurface ----
   Last charge in June, records to 26 Sep: three cycles of silence is the same
   "has this been cancelled" the Services page asks, and the boundary fix must
   not revive it. */
{
  const rows = monthly('GYMCO DEBIT', 300, ['2026-04-01', '2026-05-01', '2026-06-01']);
  eq(run([gym], rows, cheque()), [], 'a service silent for more than two cycles is not carried across the boundary');
}

/* ---- 7. a charge that already landed this period is the period's one ---- */
{
  const rows = monthly('GYMCO DEBIT', 300, ['2026-09-01', '2026-10-23']);
  eq(serviceCommitments({
    services: [gym], rows, from: '2026-10-25', to: P_END, periodStart: P_START,
    accountOfRow: owned(rows, cheque({ importedTo: '2026-10-24' })),
  }), [], 'one charge per period: seen on the 23rd, nothing left to come');
}

/* ---- 8. annual: the same stepping, a year at a time ---- */
{
  const annual = { name: 'Licence', provider: 'LicenceCo', cycle: 'annual', amount: 1200, active: true, next: '' };
  const rows = [{ date: '2025-11-05', desc: 'LICENCECO RENEWAL', cat: 'Bills', amount: -1200 }];
  eq(shape(run([annual], rows, cheque())), [['Licence', 'charged', '2026-11-05', 1, 1200]],
    'an annual renewal a year after the last one lands in the window');
  eq(run([annual], [{ ...rows[0], date: '2025-10-05' }], cheque({ importedTo: '2026-10-10' })), [],
    'and one whose date the records reached without a charge is not invented');
}

/* ---- 9. weekly: the walk starts where the records stop, not at the boundary ---- */
{
  const swim = { name: 'Swim', provider: 'SwimCo', cycle: 'weekly', amount: 50, active: true, next: '' };
  const rows = monthly('SWIMCO', 50, ['2026-09-15', '2026-09-22', '2026-09-29']);
  const out = run([swim], rows, cheque({ importedTo: '2026-09-29', balanceDate: '2026-09-10' }));
  eq(shape(out), [
    ['Swim', 'not-imported', '2026-10-06', 3, 150],
    ['Swim', 'charged', '2026-10-27', 4, 200],
  ], 'the 6, 13 and 20 Oct charges before the boundary are held; 27 Oct onward are still to come');
}

/* ---- 10. the card, end to end ---- */
{
  const ch = cheque();
  const L = whatsLeft({
    accounts: [ch], services: [gym], debts: [], rows: gymRows, accountOfRow: owned(gymRows, ch),
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.committed, 600, 'still committed carries both the held charge and the one in the window');
  eq(L.free, 20000 - 600, '"actually free" is cash less both');
  eq(L.counts.notImported, 1, 'and says one of them is held for an account not imported yet');
  ok(L.items.length === 2, 'two disclosure rows');
}

console.log(`PASS committed-period-boundary.test.cjs (${checks} checks)`);
