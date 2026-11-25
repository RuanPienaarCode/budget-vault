'use strict';
/* The menu's "Reload from disk" asks before it discards unsaved work
   (2026-11-25 audit, FUN-3).

   The drawer item ran reloadFromDisk() straight away, on every page: it resets
   each section to what the files say, so every page's unsaved edits, the Budget
   draft and a pending import review were gone with no question. The file
   watcher refuses to reload over that (it reads hasDirty), books.switch.dirty
   and ctl.notice.unsavedReloadSkipped both point the reader at this very menu
   item as the way to discard on purpose, and the period pill asks first. This
   was the one door that did not.

   mountApp needs a DOMParser shell no bare-node test can build, so the guard is
   the exported makeReloadConfirmer (the question and its answer) plus source
   checks on the wiring: the handler awaits it BEFORE doReloadFromDisk, and it
   is given the watcher's own hasDirty rather than a second list of what counts.

     node tests/reload-from-disk-asks-first.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { makeReloadConfirmer } = require('../src/controller');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

(async () => {
  /* ---- nothing dirty: no dialog, the reload goes ahead ---- */
  let asked = 0;
  const confirm = answer => async opts => { asked++; confirm.last = opts; return answer; };
  let go = await makeReloadConfirmer({ hasDirty: () => false, confirm: confirm(false) })();
  eq(go, true, 'clean state: reload proceeds');
  eq(asked, 0, 'clean state: no dialog is shown');

  /* ---- dirty: asks, and the answer decides ---- */
  go = await makeReloadConfirmer({ hasDirty: () => true, confirm: confirm(true) })();
  eq(asked, 1, 'unsaved work: the dialog is shown');
  eq(go, true, 'unsaved work, confirmed: reload proceeds');
  go = await makeReloadConfirmer({ hasDirty: () => true, confirm: confirm(false) })();
  eq(go, false, 'unsaved work, declined: no reload');
  go = await makeReloadConfirmer({ hasDirty: () => true, confirm: async () => undefined })();
  eq(go, false, 'unsaved work, dialog dismissed (no answer): no reload');

  /* ---- the dirty test is read at click time, not captured once ---- */
  let dirty = false;
  const gate = makeReloadConfirmer({ hasDirty: () => dirty, confirm: confirm(true) });
  asked = 0;
  await gate(); eq(asked, 0, 'clean at the first click: no dialog');
  dirty = true;
  await gate(); eq(asked, 1, 'dirty by the second click: dialog');

  /* ---- the words: say what is lost, in the period dialog's terms ---- */
  const o = confirm.last;
  eq(o.title, i18n.t('ctl.reload.confirmTitle'), 'title comes from i18n');
  ok(/unsaved/i.test(o.title) && /unsaved/i.test(o.message), 'it names unsaved changes as what would be lost');
  ok(/discard/i.test(o.message) && /^Discard/.test(o.confirmText), 'and the confirm button says Discard, as the period dialog does');
  ok(o.title !== 'ctl.reload.confirmTitle' && o.message !== 'ctl.reload.confirmMessage' && o.confirmText !== 'ctl.reload.confirmDiscard',
    'every string resolved (no key echoed back)');
  eq(o.cancelText, i18n.t('bx.cancel'), 'the cancel button is the translated generic one');

  /* ---- the wiring ---- */
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
  ok(/makeReloadConfirmer\(\{\s*hasDirty,/.test(src),
    'the guard is given mountApp\'s own hasDirty — the predicate the file watcher reads');
  ok(/dirtyChecks\.some\(fn => fn\(\)\)/.test(src), 'and hasDirty is the registered dirty checks');
  const h = src.slice(src.indexOf("$('#reloadLink').addEventListener"));
  const iAsk = h.indexOf('await confirmReload()');
  const iDo = h.indexOf('await doReloadFromDisk()');
  ok(iAsk > 0 && iDo > iAsk, 'the click handler asks BEFORE it reloads');
  ok(/if \(!\(await confirmReload\(\)\)\) return;/.test(h), 'and a decline returns without reloading');

  /* ---- every language carries the three strings ---- */
  const dir = path.join(__dirname, '..', 'src', 'lang');
  let langs = 0;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const k of ['ctl.reload.confirmTitle', 'ctl.reload.confirmMessage', 'ctl.reload.confirmDiscard']) {
      ok(t.includes(`'${k}':`), `${f} has ${k}`);
    }
    langs++;
  }
  eq(langs, 12, 'twelve language files');

  console.log(`PASS — reload-from-disk-asks-first: Reload from disk asks only when something is unsaved, and a decline keeps it (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
