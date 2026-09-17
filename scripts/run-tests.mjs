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
   report. Every one of the 199 guard suites in this repo prints its own
   result line when it finishes — the exact wording is not standardised
   ("PASS foo (12 checks)", "12 checks OK", "foo: ok — …"), so the rule below
   asks only for what every one of them actually satisfies today: some real
   output, carrying either a number (a count of what it checked) or one of the
   words a result line is built from. A file that prints nothing meeting that
   bar exits 0 for the wrong reason, and the build must not call that a pass. */
const REPORTS_A_RESULT = /\b(ok|pass(?:ed)?|checks?)\b/i;

for (const f of files) {
  const r = spawnSync(process.execPath, [join(dir, f)],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ...ENGLISH_LOCALE },
      // Output is captured now, not inherited: spawnSync's 1 MB default would
      // kill a chatty suite with ENOBUFS and report it as a failure.
      maxBuffer: 64 * 1024 * 1024 });
  if (r.error) { console.error(`\nFAILED: tests/${f} — ${r.error.message}`); process.exit(1); }
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`\nFAILED: tests/${f}`);
    process.exit(r.status || 1);
  }
  const out = (r.stdout || '') + (r.stderr || '');
  if (!out.trim() || !(/\d/.test(out) || REPORTS_A_RESULT.test(out))) {
    console.error(`\nFAILED: tests/${f} exited 0 but printed nothing that reads as a `
      + 'result — gutted, empty, or a failure swallowed before it could report. '
      + 'A guard test must say what it checked.');
    process.exit(1);
  }
}
console.log(`\nAll ${files.length} guard suites passed.`);
