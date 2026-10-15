'use strict';
/* The Services hint says "not imported yet" where the Dashboard does.

   The one-tap next-billing hint steps a date forward past today and explains
   why in its tooltip: "<date> has passed with no charge in your transactions
   yet". That is a claim that the charge did not happen. For a service paid from
   an account whose statements are imported only to the 26th, a charge due on
   the 1st has not been seen because the records stop before it, and the
   Dashboard's "still committed" says exactly that ("due 1 Oct — not imported
   yet"). Same service, same day, two answers (2026-10-14 audit, L2b-07).

   Both now ask committed.js's knownTo: the newest imported row on or before
   today, or the day the balance was confirmed, whichever is later. A date after
   it is "not imported yet", with the date the records reach; a date the records
   do reach with nothing on it keeps the old sentence, because there the claim is
   true.

     node tests/services-next-hint-not-imported.test.cjs */

const assert = require('assert');
const { pinClock } = require('./helpers/figures.cjs');
const { household, servicesPage, rowNamed } = require('./helpers/services-page.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const row = (date, desc, amount) => `| ${date} | ${desc} | Bills | -${amount} |  |  |  |`;
const byMonth = rows => {
  const out = {};
  for (const r of rows) (out[r.slice(2, 9)] ??= []).push(r);
  return out;
};
const GYM = '| Gym | Fitco | 310.00 | monthly | 2026-09-01 | Bills | yes |  |  |';
const GYM_ROWS = [row('2026-07-01', 'FITCO GYM 1', '310.00'), row('2026-08-01', 'FITCO GYM 2', '310.00'), row('2026-09-01', 'FITCO GYM 3', '310.00')];

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. records stop before the date: "not imported yet" ---- */
    {
      const p = await servicesPage(household({
        services: [GYM],
        accounts: { Cheque: 'type: checking\nbalance: 5000.00\nbalance_updated: 2026-09-10' },
        tx: { Cheque: byMonth([...GYM_ROWS, row('2026-09-26', 'SHOP', '40.00')]) },
      }));
      eq(p.error, null, 'renders');
      const hint = rowNamed(p, 'Gym').hint;
      eq(hint.text, 'due 2026-11-01', 'the offered date is unchanged');
      ok(/2026-10-01/.test(hint.title) && /not imported yet/.test(hint.title),
        `the tooltip says the passed date is not imported yet — got "${hint.title}"`);
      ok(/last import 2026-09-26/.test(hint.title), `and names how far the records reach — got "${hint.title}"`);
      ok(!/no charge/.test(hint.title), 'and does not claim there was no charge');
    }

    /* ---- 2. NEGATIVE CONTROL: records reach the date, nothing on it ---- */
    {
      const p = await servicesPage(household({
        services: [GYM],
        accounts: { Cheque: 'type: checking\nbalance: 5000.00\nbalance_updated: 2026-09-10' },
        tx: { Cheque: byMonth([...GYM_ROWS, row('2026-10-03', 'SHOP', '40.00')]) },
      }));
      const hint = rowNamed(p, 'Gym').hint;
      ok(/2026-10-01 has passed with no charge/.test(hint.title),
        `imported past the 1st with no gym charge on it: the old sentence stands — got "${hint.title}"`);
      ok(!/not imported yet/.test(hint.title), 'and it does not say "not imported yet"');
    }

    /* ---- 3. a balance confirmed after the date counts, as on the Dashboard ---- */
    {
      const p = await servicesPage(household({
        services: [GYM],
        accounts: { Cheque: 'type: checking\nbalance: 5000.00\nbalance_updated: 2026-10-02' },
        tx: { Cheque: byMonth(GYM_ROWS) },
      }));
      const hint = rowNamed(p, 'Gym').hint;
      ok(/has passed with no charge/.test(hint.title) && !/not imported yet/.test(hint.title),
        `a balance confirmed on the 2nd already holds the 1st — got "${hint.title}"`);
    }

    /* ---- 4. the account is the one that PAYS the service ---- */
    {
      const p = await servicesPage(household({
        services: [GYM],
        accounts: {
          Cheque: 'type: checking\nbalance: 5000.00\nbalance_updated: 2026-09-10',
          Card: 'type: credit_card\nbalance: 0.00\nbalance_updated: 2026-09-10',
        },
        tx: {
          Cheque: byMonth([row('2026-10-05', 'SHOP', '40.00')]),
          Card: byMonth([...GYM_ROWS, row('2026-09-20', 'SHOP', '40.00')]),
        },
      }));
      const hint = rowNamed(p, 'Gym').hint;
      ok(/not imported yet/.test(hint.title) && /last import 2026-09-20/.test(hint.title),
        `the card that paid it is imported to 20 Sep; the cheque account's later rows do not matter — got "${hint.title}"`);
    }
  } finally { unpin(); }

  console.log(`PASS services-next-hint-not-imported.test.cjs (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
