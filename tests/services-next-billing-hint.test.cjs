'use strict';
/* The Services page's one-tap "next billing" hint offered dates that could
   not be right, under a tooltip about a different charge.

   The hint offers the date the charge history implies, so a stale Next
   billing cell can be fixed in one tap. Four things were wrong with it
   (2026-10-07 audit, SVC-3):

     1. The date stepped from the last charge under ANY of the merchant's
        descriptions; the tooltip quoted the last charge of the PRICE group.
        A storage add-on billed on the 28th moved the date to the 28th while
        the tooltip still said "last charged" on the 5th.
     2. It offered last charge + one cycle even when that date had already
        passed — "due 2026-10-01" on 7 October, for every service whose
        newest statement was not imported yet.
     3. It offered a date EARLIER than the one typed — 2026-09-05 over a
        stored 2026-10-05 — inviting the reader to replace a correct entry.
     4. A weekly service's tooltip read "Billed around day 10 each week": a
        day-of-the-MONTH median, worded as if a week had thirty days.

   Now the hint steps forward a cycle at a time from the charge its tooltip
   names until it reaches today, never offers a date before the stored one,
   and words the cadence the way the service is billed. A service whose
   charges stopped more than two cycles ago gets no hint at all: its row
   already asks whether it has been cancelled, and a projected date would
   answer that question for the reader.

   The stepping is a NEW function, nextDue, beside nextExpected rather than a
   change to it: committed.js (the Dashboard's "still committed") steps one
   cycle with nextExpected and must keep doing exactly that. This file pins
   that the two agree on the first step.
     node tests/services-next-billing-hint.test.cjs */

const assert = require('assert');
const { pinClock } = require('./helpers/figures.cjs');
const { household, servicesPage, rowNamed } = require('./helpers/services-page.cjs');
const { nextExpected, nextDue } = require('../src/recurring');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const row = (date, desc, amount) => `| ${date} | ${desc} | Bills | -${amount} |  |  |  |`;
const byMonth = rows => {
  const out = {};
  for (const r of rows) (out[r.slice(2, 9)] ??= []).push(r);
  return out;
};

(async () => {
  /* ---- 0. the pure stepping ------------------------------------------- */
  {
    // The first step IS nextExpected's, for every cycle and across month ends.
    for (const last of ['2026-01-31', '2026-02-28', '2028-02-29', '2026-12-31', '2026-09-24', '2026-06-15']) {
      for (const cycle of ['weekly', 'fortnightly', 'monthly', 'annual']) {
        eq(nextDue({ last }, cycle, '0000-01-01').date, nextExpected({ last }, cycle),
          `the first step agrees with nextExpected — ${cycle} from ${last}`);
      }
    }
    eq(nextDue({ last: '2026-09-01' }, 'monthly', '2026-10-07'),
      { date: '2026-11-01', first: '2026-10-01', skipped: 1, last: '2026-09-01' },
      'a date already past is stepped over, and the step is reported');
    eq(nextDue({ last: '2026-09-20' }, 'monthly', '2026-10-07').skipped, 0, 'nothing skipped when the first date is still ahead');
    eq(nextDue({ last: '2026-10-07' }, 'weekly', '2026-10-14').date, '2026-10-14', 'today itself is not in the past');
    /* Anchored on the charge, not on the previous step: stepping the 31st one
       month at a time through February must come back to the 31st. */
    eq(nextDue({ last: '2026-01-31' }, 'monthly', '2026-03-15').date, '2026-03-31', 'monthly stepping does not drift to the 28th');
    eq(nextDue({ last: '2026-11-17' }, 'weekly', '2026-11-30').date, '2026-12-01', 'weekly steps in sevens');
    eq(nextDue({ last: '2024-02-29' }, 'annual', '2026-01-10').date, '2026-02-28', 'annual from a leap day clamps');
    eq(nextDue(null, 'monthly', '2026-10-07'), null, 'no charges, no date');
    eq(nextDue({ last: 'end of Sep' }, 'monthly', '2026-10-07'), null, 'an undatable history, no date');
  }

  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. the tooltip cites the charge the date steps from ----------- */
    {
      const p = await servicesPage(household({
        services: ['| Cloud | CloudCo | 100.00 | monthly | 2026-08-05 | Bills | yes |  |  |'],
        tx: { Cheque: byMonth([
          row('2026-07-05', 'CLOUDCO MONTHLY', '100.00'), row('2026-08-05', 'CLOUDCO MONTHLY', '100.00'),
          row('2026-09-05', 'CLOUDCO MONTHLY', '100.00'), row('2026-09-28', 'CLOUDCO STORAGE ADDON', '300.00'),
        ]) },
      }));
      eq(p.error, null, 'renders');
      const hint = rowNamed(p, 'Cloud').hint;
      eq(hint.text, 'due 2026-10-28', 'stepped from the newest charge under any of the merchant\'s names');
      ok(/Last charged 2026-09-28/.test(hint.title), `and the tooltip names that charge — got "${hint.title}"`);
      ok(!/2026-09-05/.test(hint.title), 'not the price group\'s last charge');
    }

    /* ---- 2. never a date already past ---------------------------------- */
    {
      const p = await servicesPage(household({
        services: ['| Gym | Fitco | 310.00 | monthly | 2026-09-01 | Bills | yes |  |  |'],
        tx: { Cheque: byMonth([row('2026-07-01', 'FITCO GYM 1000001', '310.00'), row('2026-08-01', 'FITCO GYM 1000002', '310.00'),
          row('2026-09-01', 'FITCO GYM 1000003', '310.00')]) },
      }));
      const hint = rowNamed(p, 'Gym').hint;
      eq(hint.text, 'due 2026-11-01', 'the next date on or after today, not 2026-10-01');
      ok(/2026-10-01 has passed/.test(hint.title), `and the tooltip says which date it stepped over — got "${hint.title}"`);
    }

    /* ---- 3. never earlier than the date typed ---------------------------
       The reported shape: the newest statement is not in yet (last charge
       10 August), and the reader has typed 2026-10-05. The old hint offered
       2026-09-10 — a month before what they typed, and already past. */
    {
      const p = await servicesPage(household({
        services: ['| Insurance | Shieldco | 250.00 | monthly | 2026-10-05 | Bills | yes |  |  |'],
        tx: { Cheque: byMonth([row('2026-07-10', 'SHIELDCO', '250.00'), row('2026-08-10', 'SHIELDCO', '250.00')]) },
      }));
      eq(rowNamed(p, 'Insurance').hint.text, 'due 2026-10-10', 'it offers the next date on or after today, never 2026-09-10');
    }
    {
      // A stored date AHEAD of what the charges imply is left alone.
      const p = await servicesPage(household({
        services: ['| Insurance | Shieldco | 250.00 | monthly | 2026-12-05 | Bills | yes |  |  |'],
        tx: { Cheque: byMonth([row('2026-08-20', 'SHIELDCO', '250.00'), row('2026-09-20', 'SHIELDCO', '250.00')]) },
      }));
      eq(rowNamed(p, 'Insurance').hint, null, 'no hint that would move a typed date earlier (2026-10-20 < 2026-12-05)');
    }

    /* ---- 4. cadence-appropriate wording -------------------------------- */
    {
      const p = await servicesPage(household({
        services: [
          '| Swim | Aquaclub | 90.00 | weekly | 2026-09-01 | Bills | yes |  |  |',
          '| Tutor | Mathsco | 400.00 | fortnightly | 2026-09-01 | Bills | yes |  |  |',
          '| Cloud | CloudCo | 100.00 | monthly | 2026-08-05 | Bills | yes |  |  |',
        ],
        tx: { Cheque: byMonth([
          row('2026-09-17', 'AQUACLUB', '90.00'), row('2026-09-24', 'AQUACLUB', '90.00'), row('2026-10-01', 'AQUACLUB', '90.00'),
          row('2026-09-10', 'MATHSCO', '400.00'), row('2026-09-24', 'MATHSCO', '400.00'),
          row('2026-08-05', 'CLOUDCO', '100.00'), row('2026-09-05', 'CLOUDCO', '100.00'),
        ]) },
      }));
      const swim = rowNamed(p, 'Swim').hint, tutor = rowNamed(p, 'Tutor').hint, cloud = rowNamed(p, 'Cloud').hint;
      eq(swim.text, 'due 2026-10-08', 'weekly steps a week from the last charge');
      ok(/every week/.test(swim.title) && !/day \d+/.test(swim.title), `a weekly service is not given a day of the month — got "${swim.title}"`);
      eq(tutor.text, 'due 2026-10-08', 'fortnightly steps two weeks');
      ok(/every fortnight/.test(tutor.title) && !/day \d+/.test(tutor.title), `worded by the fortnight — got "${tutor.title}"`);
      ok(/every month/.test(cloud.title), `a monthly one by the month — got "${cloud.title}"`);
    }

    /* ---- 5. no projected date for a service that stopped --------------- */
    {
      const p = await servicesPage(household({
        services: ['| Magazine | Readco | 80.00 | monthly | 2026-06-01 | Bills | yes |  |  |'],
        tx: { Cheque: byMonth([row('2026-04-01', 'READCO', '80.00'), row('2026-05-01', 'READCO', '80.00')]) },
      }));
      const r = rowNamed(p, 'Magazine');
      ok(r.badges.some(b => /^last charged/.test(b.text)), 'precondition: the row asks whether it was cancelled');
      eq(r.hint, null, 'and offers no next billing date beside that question');
    }
  } finally { unpin(); }

  /* ---- 6. the committed second household's weekly service --------------
     Its own clock: stored next 2026-12-07, last charge 2026-11-17. The old
     hint offered to replace that future date with 2026-11-24, already past. */
  {
    const unpin2 = pinClock('2026-11-30');
    try {
      const { SEED } = require('./figures/household2.cjs');
      const p = await servicesPage({ ...SEED }, { period: '2026-11' });
      eq(p.error, null, 'household2 renders');
      const va = p.rows.find(r => /^Virgin Active/.test(r.name));
      ok(va, 'the weekly service is on the page');
      ok(!va.hint || (va.hint.text.replace(/^due /, '') >= '2026-11-30' && !/day \d+ each week/.test(va.hint.title)),
        `any hint it offers is on or after today and worded by the week — got ${JSON.stringify(va.hint && { text: va.hint.text, title: va.hint.title })}`);
    } finally { unpin2(); }
  }

  console.log(`PASS — services: the next-billing hint steps from the charge it names, to a date not yet past and not before the one typed (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
