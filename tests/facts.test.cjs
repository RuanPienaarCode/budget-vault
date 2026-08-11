'use strict';
/* The facts ledger — provenance, and an expiry date.

   This suite exists because of a class of failure, not an instance of one. The
   app shipped a SARS transfer-duty table whose top three brackets appear in no
   published table from any year; it shipped National Credit Act fee caps
   asserted to the reader as statutory maximums that nobody had ever read from
   the regulation; and it shipped a tax threshold that would have told compliant
   savers they owed a 40% penalty from 1 March 2026. Every one of those was a
   bare number in a source file, and a bare number cannot tell you whether it
   was checked last week or invented.

   The one thing a test genuinely CAN hold about a figure describing the outside
   world is whether a human looked recently. It cannot know today's TFSA limit,
   and pretending otherwise is how the old tax suite came to pin a stale figure
   as "expected" and defend it. So:

     - every entry must carry what it claims, where that claim came from, when
       it was last checked, and when it must be checked again;
     - `verified: null` is a legitimate value meaning nobody has ever read a
       primary source — it must be POSSIBLE to say so, and visible when said;
     - an entry past its review date fails the build.

   Runs in bare node. Wired into ./build.sh.
     node tests/facts.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const F = require('../src/facts');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const entries = Object.entries(F.FACTS);
ok(entries.length > 0, 'the ledger holds entries');

/* ---- 1. every entry carries its provenance ---- */
for (const [key, f] of entries) {
  ok('value' in f, `${key}: has a value`);
  ok(typeof f.claim === 'string' && f.claim.length > 10,
    `${key}: says in words what it claims about the world — a key name is not a claim`);
  ok(typeof f.unit === 'string' && f.unit.length > 0, `${key}: names its unit`);
  ok(f.source === null || /^https?:\/\//.test(f.source),
    `${key}: source is a URL or explicitly null — "somewhere" is not a source`);
  ok(f.verified === null || ISO.test(f.verified),
    `${key}: verified is an ISO date, or null meaning nobody has checked`);
  ok(ISO.test(f.reviewBy), `${key}: carries a review date`);
  /* A figure cannot have been verified against a source that does not exist.
     The reverse is fine: a source can be recorded while verification is still
     outstanding. */
  if (f.verified) ok(f.source !== null, `${key}: says it was verified, so it must say against what`);
}

/* ---- 2. nothing is past its review date ----
   THE build gate. It cannot tell you a figure is right; it tells you nobody has
   looked at it since a date that has now passed, which is the only honest claim
   available and the one that would have caught every stale figure this ledger
   was built for. */
{
  const stale = F.staleFacts();
  eq(stale, [],
    stale.length
      ? `these facts are past their review date and must be re-checked against their source ` +
        `before the build can pass:\n    ` +
        stale.map(s => `${s.key} (reviewBy ${F.FACTS[s.key].reviewBy}) — ${F.FACTS[s.key].claim}`).join('\n    ')
      : 'no fact is past its review date');
}

/* ---- 3. staleFacts actually discriminates ----
   An assertion that passes because the function always returns [] would be
   worse than no assertion, so prove it fires on a date the ledger has passed. */
{
  const future = F.staleFacts('2099-01-01');
  ok(future.length === entries.length,
    'evaluated far enough ahead, EVERY fact is due for review — nothing is exempt from expiry');
  const past = F.staleFacts('2000-01-01');
  eq(past, [], 'and evaluated before any of them were written, none is overdue');
}

/* ---- 4. unverified is a first-class state, and countable ----
   Before this ledger, "nobody has ever checked this" and "checked against SARS
   last week" were the same thing: a number. Two NCA constants survived three
   separate audits precisely because there was nowhere to record that no one had
   read the regulation. */
{
  const un = F.unverifiedFacts();
  ok(Array.isArray(un), 'unverified facts can be listed');
  for (const k of un) eq(F.FACTS[k].verified, null, `${k} is listed as unverified because it is`);
  const verified = entries.filter(([, f]) => f.verified !== null).length;
  ok(verified > 0, 'and at least some facts HAVE been read from a primary source');
}

/* ---- 5. an unknown key fails loudly ----
   A typo returning undefined would put `undefined` into a money figure, which
   is the silent-wrong-number outcome the whole ledger exists to prevent. */
{
  assert.throws(() => F.fact('za.no.such.thing'), /unknown fact/i,
    'asking for a fact that does not exist throws rather than returning undefined');
  checks++;
  ok(F.fact('za.vat.rate') > 1, 'and a real key returns its value');
}

/* ---- 6. year-keyed facts vary BY YEAR ----
   The defect this pins: figureChecks received the tax year and never read it,
   so a 2027 page asserted a 2026 threshold. Testing that the lookup returns
   different answers for different years proves the wiring, without pinning a
   figure this suite has no way to verify. */
{
  const a = F.limitsFor(2026);
  const b = F.limitsFor(2027);
  ok(a.tfsa !== b.tfsa,
    'the TFSA limit differs between the 2026 and 2027 tax years — if these ever match, the year argument is being ignored again');
  eq(F.limitsFor(2026).tfsa, F.limitsFor(2020).tfsa, 'a year before the change reads the older figure');
  ok(F.limitsFor(2099).tfsa === b.tfsa, 'and a year beyond the last row holds at the newest known figure');
}

/* ---- 7. the SARS duty table still compounds exactly ----
   Kept as an INVARIANT rather than pinned numbers, for the reason the old
   version of this check failed: a real published table's base equals the duty
   compounded from the band below it, to the cent. The fabricated one was two
   rand out, and that gap was explained away rather than believed. */
{
  const bands = F.fact('za.transfer.duty');
  for (let i = 1; i < bands.length; i++) {
    const [from, , base, rate] = bands[i - 1];
    const [nextFrom, , nextBase] = bands[i];
    if (!Number.isFinite(nextFrom)) break;
    const compounded = base + (nextFrom - from) * rate;
    ok(Math.abs(compounded - nextBase) < 0.005,
      `the duty base at R${nextFrom} equals the band below compounded to it (${compounded} vs ${nextBase})`);
  }
}


/* ---- 8. CONTRACT: the migrated constants are gone from the source ----

   The expand → migrate → contract sequence is only finished when the OLD form
   cannot come back. Each figure below was a bare literal in a source file until
   this ledger existed, and each is exactly the kind that goes wrong silently
   while nobody touches the code — so a literal reappearing beside the ledger is
   the drift this asserts against, not a style preference.

   Deliberately narrow: it names the specific figures that were migrated rather
   than banning numeric literals, which would be unenforceable and would fire on
   every array index in the file. */
{
  const fs = require('fs');
  const path = require('path');
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')
    // Comments explain the history of these numbers on purpose — the ban is on
    // CODE reintroducing them, not on the file remembering why they changed.
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const banned = [
    ['loan-math.js', /\b5250\b/, 'the NCA mortgage initiation cap'],
    ['loan-math.js', /\b1050\b/, 'the NCA other-agreement initiation cap'],
    ['loan-math.js', /=\s*165\b/, 'the NCA other-agreement initiation base'],
    ['loan-math.js', /vatIncl\(60\)/, 'the NCA monthly service fee'],
    ['loan-math.js', /\b2994800\b|\b13310000\b|\b1241456\b/, 'the SARS transfer-duty brackets'],
    ['loan-math.js', /defaultRate:\s*1[01](\.\d+)?\b/, 'the ZA prime-rate default'],
    ['locale.js', /\b23800\b/, 'the SARS local-interest exemption'],
    ['locale.js', /\b46000\b|\b36000\b/, 'the TFSA annual limits'],
    ['views/loans.js', /\b0\.0035\b/, 'the vehicle insurance rate'],
  ];
  for (const [file, re, what] of banned) {
    ok(!re.test(read(file)),
      `${file}: ${what} must come from src/facts.js, not be written back as a bare literal`);
  }

  /* GENERIC_LOAN_PROFILE.defaultRate is deliberately NOT banned. It is 8 for a
     country the app has no profile for, beside a note reading "Enter the annual
     interest rate your lender quoted" — a starting value for an input, not a
     claim about anywhere. The ZA one is a claim, because it ships a sentence
     saying what prime WAS, which is why only that one is a fact. The line
     between a placeholder and an assertion is exactly what this ledger is for,
     and drawing it wrongly in either direction makes the ledger less useful:
     too wide and it fills with numbers nobody can verify. */

  // And the other half of the same claim: they really are being read from here.
  for (const f of ['loan-math.js', 'locale.js', 'views/loans.js']) {
    ok(/require\((['"])(\.\.?\/)?facts\1\)/.test(read(f)),
      `${f} reads its outside-world figures from the ledger`);
  }
}

console.log(`PASS — facts ledger: ${entries.length} facts, `
  + `${entries.filter(([, f]) => f.verified).length} primary-source verified, `
  + `${F.unverifiedFacts().length} unverified, 0 overdue (${checks} assertions).`);
