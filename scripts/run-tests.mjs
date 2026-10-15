/* Run every guard test, fail the build on the first one that fails.

   These are plain bare-node scripts, not a test framework — each one exits
   non-zero and prints its own summary. A `for` loop in an npm script would work
   on a shell but not everywhere npm runs, and swallowing a failure here would
   make `npm test` green while the suite is red, which is worse than having no
   script at all. */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'tests');
const files = readdirSync(dir).filter(f => f.endsWith('.test.cjs')).sort();

if (!files.length) {
  console.error('No tests found in tests/ — that is a broken checkout, not a pass.');
  process.exit(1);
}

/* ISSUE 90 — pin the OS locale every test process sees, never the app's own
   behaviour. src/i18n.js seeds its default language from `navigator.language`
   (Node's own global, itself read off LANG/LC_ALL) so a vault that has never
   set `language` in Settings.md still opens in Obsidian's own display
   language on the very first render — a real, wanted feature. The cost is
   that every guard test asserting an English string was implicitly asserting
   "and the contributor's shell locale is English too": on a clean checkout
   under LANG=de_DE.UTF-8 28 suites failed on exactly that, not on anything
   broken. Overriding the CHILD's environment (never touching src/i18n.js
   itself) makes the suite assert the same thing regardless of whose machine
   or CI image runs it. */
const ENGLISH_LOCALE = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LANGUAGE: 'en_US' };

/* ISSUE 90 — a suite that exits 0 without saying anything is not a pass, it is
   a file the runner never actually heard from: gutted, emptied by a bad merge,
   or an assertion failure swallowed by a stray try/catch before it could
   report.

   The first bar for "it spoke" was any output carrying a digit or one of
   ok/pass/check. The 15 Oct 2026 code-health audit (L8-10) found two shapes
   that clear it while checking nothing: a suite whose async body awaits a
   promise nothing settles exits 0 (Node leaves when the event loop empties)
   having printed only "loaded 3 fixtures"; and an assertion caught and logged
   as "note: 1 check skipped" passes on the digit. So the bar is now a RESULT
   line: the last stdout line that says PASS / OK / "passed" (or the golden
   ledger suites' "N figures … ledger unchanged"), which must not claim zero
   checks. All 349 suites in the repo print one — the wording is still not
   standardised ("PASS foo (12 checks)", "12 checks passed", "foo: ok — …"), the
   requirement is only that the suite reaches the line that says it finished.
   stderr is not read for it: a caught stack trace there is noise, not a result. */
const RESULT_LINE = /\b(?:pass|passed|ok)\b|\b[1-9]\d*\s+figures\b.*\bunchanged\b/i;
const CLAIMS_NOTHING = /(?:^|[^\d.])0\s+(?:checks?|assertions?|figures?)\b/i;
function resultLine(stdout) {
  const lines = String(stdout || '').split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) if (RESULT_LINE.test(lines[i])) return lines[i];
  return null;
}

/* A suite stuck on a live handle (an interval, an open socket) never exits and
   would hold the build forever; the slowest suite today takes about 13 s, so
   three minutes is generous on a slow CI image and still ends a hang. */
const SUITE_TIMEOUT_MS = Number(process.env.RUN_TESTS_TIMEOUT_MS) || 180000;

for (const f of files) {
  const r = spawnSync(process.execPath, [join(dir, f)],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ...ENGLISH_LOCALE },
      // Output is captured now, not inherited: spawnSync's 1 MB default would
      // kill a chatty suite with ENOBUFS and report it as a failure.
      maxBuffer: 64 * 1024 * 1024, timeout: SUITE_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    if (r.stdout) process.stdout.write(r.stdout);
    console.error(`\nFAILED: tests/${f} timed out after ${SUITE_TIMEOUT_MS} ms — hung on a live handle or an unsettled await.`);
    process.exit(1);
  }
  if (r.error) { console.error(`\nFAILED: tests/${f} — ${r.error.message}`); process.exit(1); }
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`\nFAILED: tests/${f}`);
    process.exit(r.status || 1);
  }
  const result = resultLine(r.stdout);
  if (!result || CLAIMS_NOTHING.test(result)) {
    console.error(`\nFAILED: tests/${f} exited 0 but never reported a result — `
      + (result ? `its result line claims zero checks: "${result}"`
        : 'no stdout line says PASS / OK / passed')
      + '. Gutted, empty, hung on an unsettled await, or a failure swallowed '
      + 'before it could report. A guard test must say what it checked.');
    process.exit(1);
  }
}
console.log(`\nAll ${files.length} guard suites passed.`);
