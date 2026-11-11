'use strict';
/* scripts/run-tests.mjs must tell a broken CHECKOUT from a broken TEST, and a
   run that stopped early must never read as a run that finished.

   What the 11 Nov 2026 audit found: in a clone with no node_modules,
   `npm test` exited 1 at tests/pure-types.test.cjs — "typescript is not
   installed" — and never reached the 163 suites sorted after it. The runner
   stops at the first failure on purpose, and for a real failure that is the
   right call. But this was not a failure of any suite. It was the machine,
   reported from the middle of the alphabet as if it were one test, with a
   third of the suite unexamined behind it and nothing on the screen saying
   so.

   Two things are pinned, against the REAL runner copied into a throwaway repo
   (the same harness tests/run-tests-requires-a-result.test.cjs uses, and for
   its reason: the runner finds its suites from its own path):

     1. THE ENVIRONMENT IS CHECKED BEFORE ANY SUITE. A dependency package.json
        declares and node_modules lacks — or holds at another version than the
        one pinned — fails the run up front, names the package, says `npm ci`,
        and says in so many words that no suite was started. Proved by a suite
        that leaves a file behind when it runs: the file must not exist.
     2. A STOP SAYS WHAT IT DID NOT RUN. When a suite does fail, the runner
        still stops there — and reports how many suites after it were never
        started, so one red line cannot be mistaken for the whole damage.

   The dependencies in these cases are invented names with invented versions.
   The check reads what package.json declares rather than knowing about
   typescript and esbuild, and a test that used the real names would pass
   against a runner that had simply hard-coded them.

     node tests/run-tests-environment.test.cjs */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = process.env.RUN_TESTS_RUNNER || path.join(__dirname, '..', 'scripts', 'run-tests.mjs');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* A suite that proves it ran by leaving a marker beside itself. */
const marking = name => `require('fs').writeFileSync(require('path').join(__dirname, '${name}.ran'), 'yes');\n`
  + `console.log('PASS ${name} (1 checks)');\n`;
const failing = name => `require('fs').writeFileSync(require('path').join(__dirname, '${name}.ran'), 'yes');\n`
  + `console.log('about to fail');\nprocess.exit(3);\n`;

/* files: { 'relative/path': contents }. Returns { code, out, ran } where `ran`
   is the list of suites that left their marker. */
function run(files) {
  /* The repo sits one folder down inside the throwaway directory, so a case
     can put a node_modules ABOVE it ('../node_modules/…') and still have
     everything removed afterwards. */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-runner-env-'));
  const dir = path.join(tmp, 'repo');
  try {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests'));
    fs.copyFileSync(RUNNER, path.join(dir, 'scripts', 'run-tests.mjs'));
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'run-tests.mjs')],
      { cwd: dir, encoding: 'utf8', timeout: 60000 });
    const ran = fs.readdirSync(path.join(dir, 'tests')).filter(f => f.endsWith('.ran')).map(f => f.slice(0, -4)).sort();
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), ran };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const pkg = devDependencies => JSON.stringify({ name: 'throwaway', private: true, devDependencies });
const installed = (name, version) => ({ [`node_modules/${name}/package.json`]: JSON.stringify({ name, version }) });
const SUITES = { 'tests/a-first.test.cjs': marking('a-first'), 'tests/b-second.test.cjs': marking('b-second') };

/* ---- 1. a declared dependency that is not installed ---- */
{
  const r = run({ ...SUITES, 'package.json': pkg({ 'bv-fake-checker': '5.9.3', 'bv-fake-bundler': '0.25.10' }) });
  ok(r.code !== 0, `a checkout with no node_modules must fail — the runner passed it\n--- runner said:\n${r.out}`);
  eq(r.ran.join(','), '', 'and it must fail BEFORE any suite is started — a suite ran');
  ok(/bv-fake-checker is not installed/.test(r.out) && /bv-fake-bundler is not installed/.test(r.out),
    `every missing dependency is named, not just the first\n--- runner said:\n${r.out}`);
  ok(/npm ci/.test(r.out), 'the message says what to run');
  ok(/NOT RUN/.test(r.out) && /none of the 2 guard suites/.test(r.out),
    `and says outright that nothing was run, with the count\n--- runner said:\n${r.out}`);
  ok(!/FAILED: tests\//.test(r.out), 'it is not reported as a failing suite — no suite failed');
}

/* ---- only one of two missing ---- */
{
  const r = run({ ...SUITES, 'package.json': pkg({ 'bv-fake-checker': '5.9.3', 'bv-fake-bundler': '0.25.10' }),
    ...installed('bv-fake-bundler', '0.25.10') });
  ok(r.code !== 0, 'one missing dependency is enough to stop');
  eq(r.ran.join(','), '', 'again before any suite');
  ok(/bv-fake-checker is not installed/.test(r.out) && !/bv-fake-bundler/.test(r.out),
    `only the missing one is named\n--- runner said:\n${r.out}`);
}

/* ---- 2. installed, but not the pinned version ---- */
{
  const r = run({ ...SUITES, 'package.json': pkg({ 'bv-fake-bundler': '0.25.10' }), ...installed('bv-fake-bundler', '0.24.2') });
  ok(r.code !== 0, 'a node_modules left over from another branch must fail — a different bundler builds a different bundle');
  eq(r.ran.join(','), '', 'before any suite');
  ok(/bv-fake-bundler 0\.24\.2 is installed, but package\.json pins 0\.25\.10/.test(r.out),
    `the message names both versions\n--- runner said:\n${r.out}`);
  ok(/npm ci/.test(r.out), 'and the same cure');
}

/* ---- 3. everything as declared: the suites run ---- */
{
  const r = run({ ...SUITES, 'package.json': pkg({ 'bv-fake-checker': '5.9.3', 'bv-fake-bundler': '0.25.10' }),
    ...installed('bv-fake-checker', '5.9.3'), ...installed('bv-fake-bundler', '0.25.10') });
  eq(r.code, 0, `a correct checkout runs clean\n--- runner said:\n${r.out}`);
  eq(r.ran.join(','), 'a-first,b-second', 'and every suite ran');
  ok(/All 2 guard suites passed/.test(r.out), 'with the usual closing line');
}
{
  /* A range is not a pin: the installed version cannot be judged against it
     without a semver implementation, and guessing would turn a correct
     checkout red. Presence is still required. */
  const r = run({ ...SUITES, 'package.json': pkg({ 'bv-fake-checker': '^5.0.0' }), ...installed('bv-fake-checker', '5.9.3') });
  eq(r.code, 0, `a ranged dependency that is installed is accepted\n--- runner said:\n${r.out}`);
  const missing = run({ ...SUITES, 'package.json': pkg({ 'bv-fake-checker': '^5.0.0' }) });
  ok(missing.code !== 0 && /bv-fake-checker is not installed/.test(missing.out), 'and one that is not installed is still refused');
}
{
  /* Dependencies installed one folder up — a workspace. Every suite's
     require() would find them there, so the checkout is not broken, and a
     check that only looked beside package.json would turn it red. The pinned
     version is still held to. */
  const hoisted = { '../node_modules/bv-fake-checker/package.json': JSON.stringify({ name: 'bv-fake-checker', version: '5.9.3' }) };
  const r = run({ ...SUITES, 'package.json': pkg({ 'bv-fake-checker': '5.9.3' }), ...hoisted });
  eq(r.code, 0, `a dependency installed in a parent folder counts as installed\n--- runner said:\n${r.out}`);
  eq(r.ran.join(','), 'a-first,b-second', 'and the suites run');
  const stale = run({ ...SUITES, 'package.json': pkg({ 'bv-fake-checker': '6.0.0' }), ...hoisted });
  ok(stale.code !== 0 && /bv-fake-checker 5\.9\.3 is installed, but package\.json pins 6\.0\.0/.test(stale.out),
    'and one found there at the wrong version is still refused');
}
{
  /* Nothing declared, nothing to check. */
  eq(run({ ...SUITES, 'package.json': JSON.stringify({ name: 'throwaway' }) }).code, 0, 'a package.json with no dependencies runs the suites');
  eq(run(SUITES).code, 0, 'and so does a tree with no package.json at all');
  const broken = run({ ...SUITES, 'package.json': '{ not json' });
  ok(broken.code !== 0 && broken.ran.length === 0 && /package\.json could not be read/.test(broken.out),
    'a package.json that cannot be parsed is an environment failure too, not a silent skip of the check');
}

/* ---- 4. a real failure still stops the run, and says what it skipped ---- */
{
  const r = run({
    'tests/a-first.test.cjs': marking('a-first'),
    'tests/b-broken.test.cjs': failing('b-broken'),
    'tests/c-third.test.cjs': marking('c-third'),
    'tests/d-fourth.test.cjs': marking('d-fourth'),
  });
  eq(r.code, 3, 'the failing suite\'s own exit code is passed on');
  eq(r.ran.join(','), 'a-first,b-broken', 'the run stops at the first failure — the suites after it are not started');
  ok(/FAILED: tests\/b-broken\.test\.cjs/.test(r.out), 'the failing suite is named');
  ok(/Stopped at suite 2 of 4/.test(r.out) && /the 2 suites after it were NOT run/.test(r.out),
    `and the stop says how many suites it never reached\n--- runner said:\n${r.out}`);
}
{
  const r = run({ 'tests/a-first.test.cjs': marking('a-first'), 'tests/b-broken.test.cjs': failing('b-broken'), 'tests/c-third.test.cjs': marking('c-third') });
  ok(/the 1 suite after it was NOT run/.test(r.out), `one suite skipped is said in the singular\n--- runner said:\n${r.out}`);
}
{
  const r = run({ 'tests/a-first.test.cjs': marking('a-first'), 'tests/z-broken.test.cjs': failing('z-broken') });
  ok(/Stopped at suite 2 of 2, the last one/.test(r.out) && !/NOT run/.test(r.out),
    `a failure in the last suite does not claim anything was skipped\n--- runner said:\n${r.out}`);
}
{
  /* The other ways a suite fails go through the same door. */
  const r = run({ 'tests/a-silent.test.cjs': '', 'tests/b-second.test.cjs': marking('b-second') });
  ok(r.code !== 0 && /never reported a result/.test(r.out) && /the 1 suite after it was NOT run/.test(r.out),
    `a suite that reports nothing also says what was left unrun\n--- runner said:\n${r.out}`);
}

console.log(`PASS run-tests-environment — a missing or stale dependency stops the run before any suite and says npm ci; `
  + `a failing suite says how many it left unrun (${checks} checks)`);
