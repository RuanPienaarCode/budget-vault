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

for (const f of files) {
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: 'inherit', cwd: root });
  if (r.status !== 0) {
    console.error(`\nFAILED: tests/${f}`);
    process.exit(r.status || 1);
  }
}
console.log(`\nAll ${files.length} guard suites passed.`);
