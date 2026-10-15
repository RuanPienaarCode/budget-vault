'use strict';
/* The "unreadable files" banner must not greet a brand-new vault
   (2026-10-14 audit, Wave B lane B3; follows L8-03).

   The loader records { rel: 'Settings.md', why: 'missing' } whenever Settings.md
   is absent — which is the normal state of a vault that has never been set up.
   Wave A's banner would therefore have printed "Settings.md could not be read…
   the figures use defaults" behind the setup wizard's own modal. The controller
   holds the banner back while the plugin's `onboarded` flag is false, and shows
   it again the moment setup has run (a Settings.md that is missing AFTER setup
   is a real fault). Files that are present but broken are faults either way.

   The banner is built on demand and held by reference — NOT looked up with
   `$('#unreadableBanner')`, which tests/shell-contract.test.cjs rejects because
   the shell defines no such id, and NOT defined in the shell as a hidden box,
   which tests/vanishing-margin.test.cjs rejects (a box that can vanish cannot
   carry the spacing around it).

     node tests/unreadable-banner-fresh-vault.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { visibleUnreadable, unreadableBannerText } = require('../src/controller');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
i18n.setLanguage('en');

const FRESH = [{ rel: 'Settings.md', why: 'missing' }];

/* ---- a fresh vault, wizard pending ---- */
eq(unreadableBannerText(FRESH, false), '', 'fresh vault, wizard pending: no banner sentence');
eq(visibleUnreadable(FRESH, false), [], 'a missing Settings.md is not a fault before setup has run');
eq(unreadableBannerText(undefined, false), '', 'a loader that set nothing is read defensively');
eq(unreadableBannerText(FRESH, undefined), '', 'a plugin with no onboarded flag at all counts as pending');

/* ---- once setup has run, the same record is a real fault ---- */
{
  const t = unreadableBannerText(FRESH, true);
  ok(/Settings\.md/.test(t), 'after setup, a missing Settings.md is named');
  eq(unreadableBannerText([], true), '', 'an empty list says nothing (the banner is removed)');
}

/* ---- faults other than "missing Settings.md" are never held back ---- */
{
  const mixed = [{ rel: 'Settings.md', why: 'missing' }, { rel: 'Assets.md', why: 'table' }];
  const t = unreadableBannerText(mixed, false);
  ok(/Assets\.md/.test(t), 'a broken Assets.md shows even while the wizard is pending');
  ok(!/Settings\.md/.test(t), '…and only the real fault is named; the fresh-vault Settings.md is left out');
  eq(visibleUnreadable([{ rel: 'Settings.md', why: 'frontmatter' }], false).length, 1,
    'a Settings.md that EXISTS but lost its fence is a fault even before setup');
  eq(visibleUnreadable([{ rel: 'Data/Categorisation Rules.csv', why: 'table' }], false).length, 1,
    'so is a rules file nothing could be read from');
}

/* ---- wiring ---- */
{
  const SRC = path.join(__dirname, '..', 'src');
  const shell = fs.readFileSync(path.join(SRC, 'shell.js'), 'utf8');
  const ctl = fs.readFileSync(path.join(SRC, 'controller.js'), 'utf8');
  ok(!/\$\('#unreadableBanner'\)/.test(ctl), 'the controller never queries an id the shell does not define');
  ok(!/unreadableBanner/.test(shell), 'the shell does not define a box that can vanish');
  ok(/unreadableBannerText\(S\.unreadableFiles, plugin\.settings\.onboarded\)/.test(ctl),
    'render() hands the plugin\'s onboarded flag to the banner text');
}

console.log(`PASS unreadable-banner-fresh-vault — nothing on a fresh vault until setup has run, shown for any real fault, no shell id (${checks} checks)`);
