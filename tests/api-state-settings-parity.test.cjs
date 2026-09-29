'use strict';
/* api.js's S.settings defaults, held against controller.js's.

   api.js builds its own headless ctx with no view and no mounted app, so it
   cannot share controller.js's `const S = {…}` object — but doLoadVault()
   (load.js) only overwrites S.settings.month_start_day and S.settings.currency
   `if (fm.month_start_day)` / `if (fm.currency)`; every other Settings.md key
   an older or hand-edited vault omits keeps whatever the mounting ctx started
   it at. Two different starting literals for the same state is exactly the
   "two figures derived by different rules" shape this repo keeps finding
   under a new name — so this pins the copies together rather than trusting
   two contributors editing either file six months apart to keep them in sync
   by eye.

   Text-parsed rather than imported: controller.js's literal is inline inside
   mountApp(), which needs a live view to construct at all.

     node tests/api-state-settings-parity.test.cjs
*/
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
const m = controller.match(/settings:\s*\{([^}]*)\}/);
ok(m, 'controller.js still declares S.settings as one literal inside its S declaration');

// The literal has no nested braces (owners/groups/nonessential_groups are
// array literals), so a plain Function constructor round-trips it without
// needing a real parser.
const fromController = new Function(`return {${m[1]}};`)(); // eslint-disable-line no-new-func

const { DEFAULT_STATE_SETTINGS } = require('../src/api');
eq(DEFAULT_STATE_SETTINGS, fromController,
  "api.js's headless S.settings defaults must stay byte-identical to controller.js's mounted ones");

console.log(`api-state-settings-parity: ${checks} checks OK`);
