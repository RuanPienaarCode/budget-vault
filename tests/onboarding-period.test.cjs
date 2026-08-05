'use strict';
/* The setup wizard's period step, and the contract between what it writes and
   what the loader reads back.

   This is the seam a fortnightly user meets first, and the one place a mistake
   is invisible: the wizard can finish successfully, write a Settings.md that
   looks right, and still leave the app on monthly periods — because the loader
   drops period_days and period_anchor together whenever either is unusable. So
   these checks do not stop at "the wizard produced a string". They run the
   REAL loader over the wizard's own output and assert the settings that come
   back are the ones the user chose.

   Runs in bare node. Wired into ./build.sh.
     node tests/onboarding-period.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();

const { OnboardingWizard } = require('../src/onboarding');
const { PERIOD_PRESETS } = require('../src/constants');
const { parseFrontmatter, periodDaysOrZero } = require('../src/util');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* A wizard instance with its data prefilled — the Modal constructor only needs
   an app, and nothing below touches the DOM. */
function wiz(data) {
  const w = new OnboardingWizard({}, { settings: { budgetFolder: 'Finances/Budget' } });
  Object.assign(w.data, data);
  return w;
}

/* ---- the presets the wizard offers are the ones the app can store ---- */
{
  for (const days of Object.keys(PERIOD_PRESETS)) {
    const n = Number(days);
    if (!n) continue;   // 0 is monthly, offered as the other two modes
    eq(periodDaysOrZero(n), n, `preset "${PERIOD_PRESETS[days]}" (${n}) survives the loader's band`);
  }
  ok(Object.keys(PERIOD_PRESETS).includes('14'),
    'a fortnightly option must exist — this is the whole point of issue #1');
}

/* ---- a cycle is only ever half-written if BOTH halves are usable ---- */
{
  eq(wiz({ periodMode: 'cycle', periodDays: 14, periodAnchor: '2026-08-07' }).cycleDays(), 14,
    'a complete cycle reports its length');
  eq(wiz({ periodMode: 'cycle', periodDays: 14, periodAnchor: '' }).cycleDays(), 0,
    'a cycle with no anchor reports 0 — the loader would drop it anyway');
  eq(wiz({ periodMode: 'cycle', periodDays: 14, periodAnchor: '7 Aug 2026' }).cycleDays(), 0,
    'a non-ISO anchor reports 0');
  eq(wiz({ periodMode: 'cycle', periodDays: 400, periodAnchor: '2026-08-07' }).cycleDays(), 0,
    'an out-of-band length reports 0 rather than being coerced');
  eq(wiz({ periodMode: 'payday', payday: 25, periodDays: 14, periodAnchor: '2026-08-07' }).cycleDays(), 0,
    'choosing payday-to-payday ignores cycle fields left behind by a back-step');
  eq(wiz({ periodMode: 'cycle', periodDays: 14, periodAnchor: '2026-08-07' }).cycleAnchor(), '2026-08-07',
    'the anchor rides with the length');
  eq(wiz({ periodMode: 'calendar', periodDays: 14, periodAnchor: '2026-08-07' }).cycleAnchor(), '',
    'and is withheld when the length is');
}

/* ---- the seeded budget file is named in the shape the app will look for ---- */
{
  const c = wiz({ periodMode: 'cycle', periodDays: 14, periodAnchor: '2026-08-07' }).firstPeriod();
  ok(/^\d{4}-\d{2}-\d{2}$/.test(c), `a cycle seeds a DATE-named budget file, got "${c}"`);

  const m = wiz({ periodMode: 'payday', payday: 25 }).firstPeriod();
  ok(/^\d{4}-\d{2}$/.test(m), `a payday month seeds a MONTH-named budget file, got "${m}"`);

  const cal = wiz({ periodMode: 'calendar' }).firstPeriod();
  ok(/^\d{4}-\d{2}$/.test(cal), `a calendar month does too, got "${cal}"`);

  // The seeded name must be a real period start, not merely date-shaped: the
  // anchor plus a whole number of cycles. Off by a day and the first budget
  // file a new user owns is one nothing will ever address.
  // Compared with ok() rather than eq(): when the anchor is in the FUTURE the
  // floor walks backwards and the remainder is -0, which deepStrictEqual calls
  // different from 0. That path is not an edge case to tolerate but one to
  // cover — the wizard asks for the LAST payday, and someone who enters their
  // next one must still get real periods.
  const anchor = Date.UTC(2026, 7, 7) / 86400000;
  const [y, mo, d] = c.split('-').map(Number);
  ok((Date.UTC(y, mo - 1, d) / 86400000 - anchor) % 14 === 0,
    'the seeded period start sits exactly a whole number of cycles from the anchor');
}

/* ---- what the wizard WRITES, the loader must READ BACK unchanged ---- */
(async () => {
  const { loadInto } = require('./helpers/harness.cjs');
  const B = 'Budget';   // the harness's default budgetFolder — must match makeCtx

  // Rebuild the frontmatter the create path emits, from the wizard itself.
  const settingsMd = w => {
    const day = w.monthStartDay();
    return `---\nmonth_start_day: ${day}\n` +
      (w.cycleDays() ? `period_days: ${w.cycleDays()}\nperiod_anchor: ${w.cycleAnchor()}\n` : '') +
      `currency: "R"\ncountry: za\n---\n`;
  };

  for (const [data, days, anchor, why] of [
    [{ periodMode: 'cycle', periodDays: 14, periodAnchor: '2026-08-07' }, 14, '2026-08-07',
      'a fortnightly wizard run survives the round trip to disk and back'],
    [{ periodMode: 'cycle', periodDays: 7, periodAnchor: '2026-08-07' }, 7, '2026-08-07',
      'so does a weekly one'],
    [{ periodMode: 'payday', payday: 25 }, 0, '',
      'a payday month writes no cycle keys and loads as monthly'],
    [{ periodMode: 'calendar' }, 0, '',
      'nor does a calendar month'],
  ]) {
    const w = wiz(data);
    const s = await loadInto(makeCtx({ [`${B}/Settings.md`]: settingsMd(w) }));
    eq([s.settings.period_days, s.settings.period_anchor], [days, anchor], why);

    // And the frontmatter really does parse — a malformed block would load as
    // monthly too, which would otherwise be indistinguishable from success.
    const { fm } = parseFrontmatter(settingsMd(w));
    eq(periodDaysOrZero(fm.period_days), days, `${why} — frontmatter parses to the same length`);
  }

  console.log(`PASS — setup wizard period step + loader round-trip intact (${checks} assertions).`);
})();
