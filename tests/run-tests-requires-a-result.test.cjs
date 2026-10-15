'use strict';
/* scripts/run-tests.mjs must hear a RESULT from every suite, not just exit 0.

   The runner's old bar was "some output containing a digit or one of
   ok/pass/check". The 15 Oct 2026 code-health audit (L8-10) showed what slips
   through it: a suite whose async body awaits a promise nothing settles exits 0
   (Node leaves when the event loop empties) having printed only "loaded 3
   fixtures", and a suite that wraps its assertion in try/catch and logs "note: 1
   check skipped" passes because of the digit. Both are suites whose assertions
   never ran, reported as green. This is the build's only gate, so the gate is
   what is under test here.

   Each case below builds a throwaway repo (the REAL runner copied into
   <tmp>/scripts, one synthetic suite in <tmp>/tests) and runs it, because the
   runner locates its suites from its own path and exits on the first failure.
   RUN_TESTS_RUNNER points the same cases at another runner file, which is how
   the negative control was done (the pre-fix runner fails these cases).

     node tests/run-tests-requires-a-result.test.cjs */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = process.env.RUN_TESTS_RUNNER || path.join(__dirname, '..', 'scripts', 'run-tests.mjs');
let checks = 0;

function runOne(name, body, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-runner-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts')); fs.mkdirSync(path.join(dir, 'tests'));
    fs.copyFileSync(RUNNER, path.join(dir, 'scripts', 'run-tests.mjs'));
    fs.writeFileSync(path.join(dir, 'tests', `${name}.test.cjs`), body);
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'run-tests.mjs')],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const passes = (name, body, why, env) => {
  const r = runOne(name, body, env);
  assert.strictEqual(r.code, 0, `${why}\n--- runner said:\n${r.out}`); checks++;
};
const fails = (name, body, why, env) => {
  const r = runOne(name, body, env);
  assert.notStrictEqual(r.code, 0, `${why} — the runner passed it\n--- runner said:\n${r.out}`); checks++;
  return r;
};

/* ---- suites that must NOT pass ----------------------------------------- */
fails('hangs-on-unsettled-promise',
  `console.log('loaded 3 fixtures');\n(async () => { await new Promise(() => {}); console.log('PASS (3 checks)'); })();\n`,
  'an unsettled promise exits 0 with only a fixture count printed — its assertions never ran');
fails('swallowed-failure',
  `const assert = require('assert');\ntry { assert.strictEqual(1 + 1, 3, 'sum'); } catch (e) { console.log('note: 1 check skipped:', e.message); }\n`,
  'an assertion swallowed by a logging try/catch passes on the digit in the log line');
fails('silent', '', 'a suite that prints nothing');
fails('throws-after-fixtures',
  `console.log('3 rows');\n(async () => { throw new Error('async boom'); })();\n`, 'an async rejection (non-zero exit)');
fails('zero-checks', `console.log('PASS zero (0 checks)');\n`,
  'a result line that claims zero checks is a suite that checked nothing');
{
  /* A suite that really hangs (a live timer). The timeout must kill it and say so. */
  const r = fails('really-hangs', `setInterval(() => {}, 1000);\nconsole.log('PASS spinner (1 checks)');\n`,
    'a suite stuck on a live handle must be killed by the per-suite timeout', { RUN_TESTS_TIMEOUT_MS: '1500' });
  assert.ok(/timed out|timeout/i.test(r.out), `the failure names the timeout (got: ${r.out})`); checks++;
}

/* ---- suites that must still pass (the house result-line shapes) --------- */
passes('pass-parens', `console.log('PASS pass-parens (12 checks)');\n`, 'PASS name (N checks)');
passes('n-checks-passed', `console.log('add-account: 28 checks passed');\n`, 'name: N checks passed');
passes('ok-line', `console.log('foo: ok — 5 invariants hold');\n`, 'name: ok — …');
passes('ledger-unchanged', `console.log('figures-ledger: 800 figures across 16 views, ledger unchanged (collection rule self-checked).');\n`,
  'the golden-ledger suites print "N figures … ledger unchanged"');
passes('stderr-noise-then-pass', `console.error('    at some caught stack frame');\nconsole.log('PASS noisy (2 checks)');\n`,
  'diagnostics on stderr do not hide a result on stdout');

console.log(`PASS run-tests-requires-a-result (${checks} checks)`);
