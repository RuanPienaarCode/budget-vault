'use strict';
/* The Budget view hears a file renamed OUT of the budget folder (7 Oct 2026
   audit, the controller half of the api.js watcher fix).

   Obsidian hands a 'rename' listener the file at its NEW path and the path it
   left. The view's own watcher read only `file.path`, so a transactions month
   or an account note moved out of the budget folder was still in the view's
   figures until something else made it reload. modify, create and delete hand
   over the file alone, so a second argument there is never an old path.

   The test of the decision is pure (fsChangeInBudget). The wiring is pinned
   on the source: mountApp needs a DOM shell no bare-node test can build, the
   same reason classifyRename and reloadFromDisk were extracted to be tested.

     node tests/controller-watcher-rename.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { fsChangeInBudget } = require('../src/controller');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

ok(typeof fsChangeInBudget === 'function', 'controller.js exports fsChangeInBudget');

const BP = 'Finances/Budget';
const f = p => ({ path: p });

ok(fsChangeInBudget(BP, f('Finances/Budget/Transactions/Cheque/2026-09.md')), 'a change inside the folder counts');
ok(fsChangeInBudget(BP, f('Finances/Budget')), 'the folder itself counts');
ok(!fsChangeInBudget(BP, f('Daily/2026-10-07.md')), 'a change elsewhere does not');
ok(!fsChangeInBudget(BP, f('Finances/Budget2/x.md')), 'a sibling folder sharing the prefix does not');

/* The finding: renamed out, renamed in, renamed within. */
ok(fsChangeInBudget(BP, f('Archive/2026-09.md'), 'Finances/Budget/Transactions/Cheque/2026-09.md'),
  'a file renamed OUT of the budget folder counts, by the path it left');
ok(fsChangeInBudget(BP, f('Finances/Budget/Accounts/Savings.md'), 'Inbox/Savings.md'),
  'a file renamed INTO the folder counts, by its new path');
ok(!fsChangeInBudget(BP, f('Archive/b.md'), 'Archive/a.md'), 'a rename entirely outside the folder does not');

/* Not an old path: whatever else a listener might be handed. */
ok(!fsChangeInBudget(BP, f('Daily/x.md'), { path: 'Finances/Budget/x.md' }), 'a non-string second argument is not an old path');
ok(!fsChangeInBudget(BP, null, undefined), 'no file and no old path is no change');

/* The wiring: rename passes its old path through, the other three do not. */
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
ok(/view\.registerEvent\(vault\.on\('rename', \(file, oldPath\) => onFsChange\(file, oldPath\)\)\)/.test(src),
  "the view registers 'rename' with the old path passed through");
for (const ev of ['modify', 'create', 'delete']) {
  ok(new RegExp(`view\\.registerEvent\\(vault\\.on\\('${ev}', file => onFsChange\\(file\\)\\)\\)`).test(src),
    `and '${ev}' with the file alone`);
}

console.log(`PASS controller-watcher-rename (${checks} checks)`);
