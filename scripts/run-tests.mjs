/* Run every guard test, fail the build on the first one that fails.

   These are plain bare-node scripts, not a test framework — each one exits
   non-zero and prints its own summary. A `for` loop in an npm script would work
   on a shell but not everywhere npm runs, and swallowing a failure here would
   make `npm test` green while the suite is red, which is worse than having no
   script at all.

   TWO KINDS OF RED, kept apart since the 11 Nov 2026 audit. A suite failing is
   news about the code. A checkout with no node_modules is news about the
   machine — and it used to arrive as the first: `npm test` in a fresh clone
   stopped at tests/pure-types.test.cjs ("typescript is not installed"), two
   thirds of the way down the alphabet, and the 163 suites sorted after it
   never ran. Read quickly that is one failing test; it was a third of the
   suite not looked at, behind a failure that had nothing to do with any of it.

   So the environment is checked FIRST, before any suite, and named as what it
   is (environmentProblems, below). The other way to stop one failure hiding
   the rest would have been to run everything and report at the end. That was
   weighed and not taken: stopping at the first failing suite is this runner's
   design, not an accident of it. The suite takes minutes; a real failure
   should be the last thing on the screen, with its own output directly above
   it, not something to scroll back for through three hundred green lines —
   and every caller (./build.sh, the release workflow) only wants to know
   whether to stop. What stopping early must never do is LOOK like a full run,
   so a stop now says how many suites it did not reach. */

import { readdirSync, readFileSync } from 'node:fs';
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

/* What is wrong with this checkout's installed dependencies, as a list of
   plain sentences — empty when nothing is.

   Read from package.json rather than naming typescript and esbuild here: the
   list of what the suites need is already declared there, and a third
   dependency added next year should be covered without anyone remembering
   this file. Each declared package must be present in node_modules, and where
   package.json pins an exact version (this repo pins both, because the
   community scorecard rebuilds main.js and compares bytes) the installed copy
   must BE that version: a node_modules left over from another branch builds a
   different bundle and fails the build-identity suites for a reason no diff
   will show. Both have the same cure, which is why they share a message.

   Looked up the way Node itself would find it for a suite — node_modules/<name>
   in this folder, then in each folder above it — so a checkout whose
   dependencies are installed one level up (a workspace) is not called broken
   when every `require('typescript')` in tests/ would in fact succeed. Read as
   a file rather than through require.resolve, because a package's `exports`
   map may refuse to resolve its own package.json.

   No package.json at all means nothing is declared, so there is nothing to
   check; the suites still run and still have to report a result. */
function installedVersion(name) {
  for (let at = root; ; at = dirname(at)) {
    try {
      return JSON.parse(readFileSync(join(at, 'node_modules', name, 'package.json'), 'utf8')).version;
    } catch { /* not here — look one folder up, as require() does */ }
    if (dirname(at) === at) return null;
  }
}

function environmentProblems() {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch (e) {
    return e.code === 'ENOENT' ? [] : [`package.json could not be read (${e.message})`];
  }
  const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const problems = [];
  for (const [name, wanted] of Object.entries(declared)) {
    const installed = installedVersion(name);
    if (installed === null) {
      problems.push(`${name} is not installed`);
      continue;
    }
    if (/^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(String(wanted)) && installed !== wanted) {
      problems.push(`${name} ${installed} is installed, but package.json pins ${wanted}`);
    }
  }
  return problems;
}

const problems = environmentProblems();
if (problems.length) {
  console.error(
    `\nNOT RUN: none of the ${files.length} guard suites was started — this is the checkout, not the code.\n`
    + problems.map(p => `  - ${p}\n`).join('')
    + `\nRun \`npm ci\` in ${root} and try again.\n`
    + 'Several suites need the dev dependencies (the type check, the bundle and stylesheet guards), and\n'
    + 'the runner stops at the first failure — so starting without them would report one failing suite\n'
    + 'and silently skip every suite sorted after it.');
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

/* Every stop goes through here, so none of them can read as a completed run:
   the suites sorted after the failing one were not started, and the count of
   them is the difference between "one thing is broken" and "one thing is
   broken that we know of". */
function stop(index, message, code = 1) {
  const notRun = files.length - index - 1;
  console.error(`\n${message}`);
  console.error(`Stopped at suite ${index + 1} of ${files.length}`
    + (notRun ? ` — the ${notRun} suite${notRun === 1 ? '' : 's'} after it ${notRun === 1 ? 'was' : 'were'} NOT run, `
      + 'so this is the first failure, not a count of them.' : ', the last one.'));
  process.exit(code);
}

for (const [index, f] of files.entries()) {
  const r = spawnSync(process.execPath, [join(dir, f)],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ...ENGLISH_LOCALE },
      // Output is captured now, not inherited: spawnSync's 1 MB default would
      // kill a chatty suite with ENOBUFS and report it as a failure.
      maxBuffer: 64 * 1024 * 1024, timeout: SUITE_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    if (r.stdout) process.stdout.write(r.stdout);
    stop(index, `FAILED: tests/${f} timed out after ${SUITE_TIMEOUT_MS} ms — hung on a live handle or an unsettled await.`);
  }
  if (r.error) stop(index, `FAILED: tests/${f} — ${r.error.message}`);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) stop(index, `FAILED: tests/${f}`, r.status || 1);
  const result = resultLine(r.stdout);
  if (!result || CLAIMS_NOTHING.test(result)) {
    stop(index, `FAILED: tests/${f} exited 0 but never reported a result — `
      + (result ? `its result line claims zero checks: "${result}"`
        : 'no stdout line says PASS / OK / passed')
      + '. Gutted, empty, hung on an unsettled await, or a failure swallowed '
      + 'before it could report. A guard test must say what it checked.');
  }
}
console.log(`\nAll ${files.length} guard suites passed.`);
