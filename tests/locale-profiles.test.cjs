'use strict';
/* Country-profile guard test.

   Every country profile in src/locale.js must carry the full set of keys the
   views read — otherwise selecting that country crashes the Tax / Import view
   with an `undefined` access (exactly the failure mode the cn profile was
   audited for). This test asserts key completeness, shape, and that the profile
   functions run without throwing and return sane values.

   Runs in bare node — locale.js has no `obsidian` dependency, so no stub needed.
   Wired into ./build.sh, so a profile that drops a key fails the build.

     node tests/locale-profiles.test.cjs      # exits non-zero on any failure

   Keep the key lists below in sync with what the code actually reads:
     grep -rhoE '(loc|locale\(\))\.[a-zA-Z_]+' src/ | sed -E 's/^[^.]*\.//' | sort -u
   plus the direct PROFILES[x].label / .currency reads in settings-tab / onboarding. */

const assert = require('assert');
const { PROFILES, COUNTRY_ORDER, localeFor } = require('../src/locale');

const STRING_KEYS = ['label', 'currency', 'thousands', 'decimal', 'authority', 'taxIntro', 'yearHint', 'safetyNote', 'figureCodeLabel'];
const NULLABLE_KEYS = ['banks', 'importHint'];   // must be PRESENT, may be null (za importHint / eu banks)
const BOOL_KEYS = ['dayFirst'];
const ARRAY_KEYS = ['deadlineLabels', 'taxpayerTypes', 'assessments'];
const FN_KEYS = ['yearSpan', 'currentTaxYear', 'seedDeadlines', 'activeDeadline', 'seasonMsgs', 'seedSteps', 'seedDocs', 'figureChecks'];
const ENUM_KEYS = {
  defaultTaxpayerType: ['provisional', 'standard', 'unknown'],
  // 'assessed' is a terminal state no profile defaults to, but the enum must
  // permit it so a country could seed straight into it.
  defaultAssessment: ['submit-requested', 'auto-assessed', 'assessed', 'unknown'],
};
const OPTIONAL = ['stripDescSuffix'];   // za-only; guarded at import.js (`if (loc.stripDescSuffix …)`)

let failures = 0;
const fail = (code, msg) => { console.error(`  ✗ [${code}] ${msg}`); failures++; };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// COUNTRY_ORDER (the dropdown) and PROFILES must agree — no dropdown entry that
// fails to resolve, and no orphan profile that never appears in the picker.
for (const code of COUNTRY_ORDER) if (!PROFILES[code]) fail(code, 'listed in COUNTRY_ORDER but missing from PROFILES');
for (const code of Object.keys(PROFILES)) if (!COUNTRY_ORDER.includes(code)) fail(code, 'defined in PROFILES but missing from the COUNTRY_ORDER dropdown');

for (const code of Object.keys(PROFILES)) {
  const p = PROFILES[code];
  for (const k of STRING_KEYS) if (typeof p[k] !== 'string' || !p[k]) fail(code, `${k} must be a non-empty string`);
  for (const k of NULLABLE_KEYS) if (!has(p, k)) fail(code, `${k} key missing (may be null, but must be present)`);
  for (const k of BOOL_KEYS) if (typeof p[k] !== 'boolean') fail(code, `${k} must be a boolean`);
  for (const k of ARRAY_KEYS) if (!Array.isArray(p[k])) fail(code, `${k} must be an array`);
  for (const k of FN_KEYS) if (typeof p[k] !== 'function') fail(code, `${k} must be a function`);
  for (const [k, allowed] of Object.entries(ENUM_KEYS)) if (!allowed.includes(p[k])) fail(code, `${k} must be one of ${allowed.join('|')} (got ${JSON.stringify(p[k])})`);

  // taxpayerTypes / assessments: [value, label] string pairs, with the canonical
  // model values present (the stored data model is country-agnostic).
  const pairs = (k, values) => {
    if (!Array.isArray(p[k])) return;
    for (const row of p[k]) {
      if (!Array.isArray(row) || row.length < 2 || typeof row[0] !== 'string' || typeof row[1] !== 'string') {
        fail(code, `${k} rows must be [value, label] string pairs`); return;
      }
    }
    for (const v of values) if (!p[k].some(r => r[0] === v)) fail(code, `${k} is missing the required value "${v}"`);
  };
  pairs('taxpayerTypes', ['provisional', 'standard', 'unknown']);
  pairs('assessments', ['submit-requested', 'auto-assessed', 'assessed', 'unknown']);
  if (Array.isArray(p.deadlineLabels) && p.deadlineLabels.length < 2) fail(code, 'deadlineLabels needs 2 entries (standard + alternative)');

  // Exercise the functions the way the views do — fixed inputs (no Date.now),
  // must not throw and must return the shapes tax.js expects.
  try {
    const Y = 2026;
    assert.strictEqual(typeof p.yearSpan(Y), 'string', 'yearSpan must return a string');
    assert.strictEqual(typeof p.currentTaxYear(new Date(2026, 6, 1)), 'number', 'currentTaxYear must return a number');
    const dl = p.seedDeadlines(Y);
    assert.ok(dl && has(dl, 'deadline_standard') && has(dl, 'deadline_provisional'), 'seedDeadlines must return {deadline_standard, deadline_provisional}');
    const fakeT = { taxpayer_type: 'provisional', assessment: 'submit-requested', deadline_standard: '2026-06-30', deadline_provisional: '2026-03-01' };
    assert.strictEqual(typeof p.activeDeadline(fakeT), 'string', 'activeDeadline must return a string');
    assert.ok(Array.isArray(p.seasonMsgs(fakeT)), 'seasonMsgs must return an array');
    for (const step of p.seedSteps(Y)) assert.ok(step && typeof step.step === 'string', 'each seedSteps row needs a string .step');
    for (const doc of p.seedDocs()) assert.ok(doc && typeof doc.name === 'string', 'each seedDocs row needs a string .name');

    // figureChecks must tolerate every shape the view can hand it — an empty
    // table, junk rows, and a fully-populated assessed year — and always return
    // {ok, text} pairs. A profile that throws here would blank the Tax page.
    const assessedT = { ...fakeT, assessment: 'assessed', assessment_income: 400000, assessment_result: -1250 };
    for (const [figs, tt] of [
      [[], fakeT],
      [[{ code: '', description: '', source: '', amount: 0 }], fakeT],
      [[{ code: '4201', description: 'Interest', source: 'Bank', amount: 5000 },
        { code: '3601', description: 'Salary', source: 'Employer', amount: 400000 },
        { code: '4219', description: 'TFSA', source: 'Provider', amount: 20000 },
        { code: '4250', description: 'Gains', source: 'Provider', amount: 500 }], assessedT],
    ]) {
      const out = p.figureChecks(figs, Y, tt);
      assert.ok(Array.isArray(out), 'figureChecks must return an array');
      for (const m of out) {
        assert.strictEqual(typeof m.ok, 'boolean', 'each figureChecks message needs a boolean .ok');
        assert.ok(m.text && typeof m.text === 'string', 'each figureChecks message needs a non-empty .text');
      }
    }
  } catch (e) {
    fail(code, `function exercise threw: ${e.message}`);
  }

  // Warn (don't fail) on an unrecognised top-level key — catches typos like
  // `taxpyerTypes` that would otherwise silently read as undefined at runtime.
  const known = new Set([...STRING_KEYS, ...NULLABLE_KEYS, ...BOOL_KEYS, ...ARRAY_KEYS, ...FN_KEYS, ...Object.keys(ENUM_KEYS), ...OPTIONAL]);
  for (const k of Object.keys(p)) if (!known.has(k)) console.warn(`  ! [${code}] unrecognised key "${k}" (typo, or add it to the test's known set)`);
}

// localeFor falls back to za for unknown/blank input — every pre-country install
// (no `country:` in Settings.md) relies on this, so it must never return undefined.
/* ISSUE 30 — an unknown country and an ABSENT one are deliberately different
   answers now, and the distinction is the fix.

   Absent still means za: that is the documented default for every vault
   written before `country` existed, and moving it would swap the tax page
   under people who never chose one.

   A value that was actually TYPED and is not recognised falls to `other`,
   which exists for exactly this. It used to fall to za, while loan-math.js's
   loanProfileFor() — reading the same key — fell to GENERIC. So a hand-edited
   `country: nl` in Settings.md, a file this app documents as user-editable,
   put one reader in two countries at once: the full SARS checklist, ITR12 and
   the R23 800 interest exemption on one page, a generic loan profile on
   another. Handing South African tax rules to someone who typed "nl" is the
   more dangerous of the two ways to be wrong, because those rules look
   authoritative and are not theirs. */
assert.strictEqual(localeFor('zzz'), PROFILES.other, 'localeFor(unknown) falls back to `other` — no tax law rather than the wrong country\'s');
assert.strictEqual(localeFor('nl'), PROFILES.other, 'a plausible-looking country this app has no law for gets none');
assert.strictEqual(localeFor(''), PROFILES.za, 'localeFor(empty) still means za — the documented pre-`country` default');
assert.strictEqual(localeFor(undefined), PROFILES.za, 'localeFor(undefined) still means za, for the same reason');
assert.strictEqual(localeFor('ZA '), PROFILES.za, 'localeFor is case/space-insensitive');

/* ---------------- currentTaxYear: the cutover, to the DAY ------------------

   currentTaxYear names the most recently COMPLETED tax year — the one the
   reader can actually work on — so its answer must change on the day after
   that year's last day, and not before. `yearSpan` states where each of those
   days is, and the two are the same fact written twice: any profile whose
   cutover disagrees with its own yearSpan is telling the reader to gather
   documents for a year that has not finished.

   Two of the three non-calendar year-ends fall on a month boundary (za: end
   February, so 1 March; au: 30 June, so 1 July) and a month-only test is
   exactly right for them — they are the negative controls here. The UK's does
   NOT: the year ends 5 April and the next begins on the 6th, which is the one
   date in this file where a month-only comparison is wrong. `>= 4` reported
   the year 1–5 April as though it had already ended, so a reader opening the
   Tax page on 2 April 2026 was shown 2026 — a year still four days from
   finishing — with the SA302 checklist and the January filing deadline that
   belong to it.

   Local noon, deliberately: currentTaxYear reads local calendar parts (the
   dates.js rule), and a midnight boundary in a UTC-constructed date would
   make this test's own answers depend on the machine's zone.

   The calendar-year profiles (us, ca, eu, cn, other) are a different
   convention — they name the return currently in season, not a year-end — so
   their boundary is asserted where their own rule puts it: on 1 January. */
{
  const noon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);
  const cases = [
    // [country, last day of the year, first day of the next, the year that just ended]
    ['za', [2026, 2, 28], [2026, 3, 1], 2026],
    ['uk', [2026, 4, 5], [2026, 4, 6], 2026],
    ['au', [2026, 6, 30], [2026, 7, 1], 2026],
  ];
  for (const [code, last, next, ended] of cases) {
    const f = PROFILES[code].currentTaxYear;
    assert.strictEqual(f(noon(...last)), ended - 1,
      `${code}: on ${last.join('-')} the year ending that day has NOT ended yet — ` +
      `${PROFILES[code].yearSpan(ended)} is still running`);
    assert.strictEqual(f(noon(...next)), ended,
      `${code}: the day after (${next.join('-')}) it has, and becomes the year to work on`);
    // A day either side of the pair, so the answer is a step and not a spike.
    assert.strictEqual(f(noon(last[0], last[1], last[2] - 1)), ended - 1, `${code}: the day before the cutover agrees with it`);
    assert.strictEqual(f(noon(next[0], next[1], next[2] + 1)), ended, `${code}: and the day after does too`);
  }

  /* The UK's mid-month boundary, walked across in full — this is the range the
     month-only test admitted, and every day of it was wrong. */
  for (const d of [1, 2, 3, 4, 5]) {
    assert.strictEqual(PROFILES.uk.currentTaxYear(noon(2026, 4, d)), 2025,
      `uk: 2026-04-0${d} falls INSIDE the tax year ending 5 Apr 2026 — the year to work on is still ${PROFILES.uk.yearSpan(2025)}`);
  }
  for (const d of [6, 7, 30]) {
    assert.strictEqual(PROFILES.uk.currentTaxYear(noon(2026, 4, d)), 2026,
      `uk: 2026-04-${d} is in the NEXT tax year, so 2026 is the one that just ended`);
  }
  assert.strictEqual(PROFILES.uk.currentTaxYear(noon(2026, 3, 31)), 2025, 'uk: March is unambiguously the old year');
  assert.strictEqual(PROFILES.uk.currentTaxYear(noon(2026, 5, 1)), 2026, 'uk: May is unambiguously the new one');

  /* The calendar-year profiles answer a DIFFERENT question, and the difference
     is easy to mistake for a bug. Their tax year is Jan–Dec, so it has always
     already ended by the time anyone reads the page; what moves instead is
     which return is in SEASON. They hold last year's return open through the
     filing window and step the month after it closes — 1 May for the 15 April
     deadline countries, 1 July for cn. So the year they name in April is
     deliberately last year's, and "fixing" that to 1 January would hand a
     reader in February a year they cannot yet file.

     Pinned per profile rather than derived, so a country whose deadline moves
     has to say so here. The step is asserted to be exactly one month wide and
     exactly +1 year, which is what rules out the off-by-a-day shape the UK
     profile had. */
  const SEASON_STEP = { us: 5, ca: 5, eu: 5, other: 5, cn: 7 };
  for (const [code, month] of Object.entries(SEASON_STEP)) {
    const p = PROFILES[code];
    if (!p) { fail(code, 'SEASON_STEP names a profile that does not exist'); continue; }
    assert.ok(/Jan\s*–\s*Dec/.test(p.yearSpan(2026)),
      `${code}: SEASON_STEP is only for calendar-year profiles — this one's span is "${p.yearSpan(2026)}"`);
    const f = p.currentTaxYear;
    assert.strictEqual(f(noon(2026, month, 1)), f(noon(2026, month - 1, 28)) + 1,
      `${code}: the filing season turns over on 1 ${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'][month]}, once, by one year`);
    assert.strictEqual(f(noon(2026, month, 1)), 2026,
      `${code}: and lands on the calendar year that has just become fileable`);
    assert.strictEqual(f(noon(2026, 12, 31)), f(noon(2026, month, 1)),
      `${code}: nothing moves again before the year is out`);
    assert.strictEqual(f(noon(2026, 1, 1)), 2025,
      `${code}: January still belongs to last year's return, not to the calendar's new one`);
  }
}

/* The two resolvers read the same key and must agree about what it means. */
{
  const { loanProfileFor } = require('../src/loan-math');
  for (const code of [undefined, '', 'za', 'us', 'nl', 'zzz']) {
    const knownToLocale = localeFor(code) !== PROFILES.other || (code || 'za') === 'other';
    const knownToLoans = loanProfileFor(code).hasBuyingCosts;
    // Only za has buying costs, so "loans knows this country" implies za.
    assert.ok(!knownToLoans || localeFor(code) === PROFILES.za,
      `localeFor and loanProfileFor must not disagree about ${JSON.stringify(code)}`);
    void knownToLocale;
  }
}

if (failures) { console.error(`\nFAIL — ${failures} profile issue(s) above.`); process.exit(1); }
console.log(`PASS — all ${Object.keys(PROFILES).length} country profiles carry the full key set the views read.`);
