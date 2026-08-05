'use strict';
/* setInert fallback guard.

   `inert` is the whole mechanism behind two features: the closed drawer leaving
   the tab order, and the privacy splash gate making the covered app unreachable.
   It is Safari 15.5+, and this plugin's engine floor is iOS 15.0 — on 15.0-15.4
   the attribute parses and does NOTHING. Tab walked straight into the balances
   behind a gate whose entire purpose is that it can't, which is a privacy
   regression rather than a cosmetic one.

   setInert feature-detects and, on the old engines, reproduces the behaviour by
   hand. This test runs it with `inert` deleted from HTMLElement.prototype — the
   iOS 15.0 case — and pins:

     1. every focusable descendant leaves the tab order,
     2. aria-hidden covers the screen-reader half,
     3. an ORIGINAL tabindex (e.g. an explicit 2) is restored, not clobbered,
     4. a re-lock while already locked doesn't overwrite the remembered values,
     5. focus inside the subtree is blurred — real inert does this, tabindex
        alone does not, so a focused field would stay typable behind the gate,
     6. unlocking leaves no bookkeeping attributes behind.

   Runs in bare node with a minimal DOM stub, same as date-input.test.cjs.
   Wired into ./build.sh.
     node tests/inert-fallback.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const Module = require('module');

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { setIcon() {}, normalizePath: p => p };
  return origLoad.call(this, req, ...rest);
};

/* --- minimal DOM ------------------------------------------------------- */
class FakeEl {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...kids) { for (const k of kids) { k.parentElement = this; this.children.push(k); } }
  get descendants() { return this.children.flatMap(c => [c, ...c.descendants]); }
  contains(n) { return n === this || this.descendants.includes(n); }
  blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
  /* Enough selector support for the two queries setInert issues:
     the focusable list, and '[data-bud-ti]'. */
  querySelectorAll(sel) {
    const parts = sel.split(',').map(s => s.trim());
    return this.descendants.filter(n => parts.some(p => {
      const m = p.match(/^([a-z]*)(?:\[([^\]=]+)\])?$/);
      if (!m) return false;
      const [, tag, attr] = m;
      if (tag && n.tagName !== tag.toUpperCase()) return false;
      if (attr && !n.hasAttribute(attr)) return false;
      return true;
    }));
  }
}

const doc = { body: new FakeEl('body') };
doc.activeElement = doc.body;
global.document = doc;
// The point of the test: an engine where the attribute exists but does nothing.
global.HTMLElement = function HTMLElement() {};
global.HTMLElement.prototype = {};
assert.ok(!('inert' in global.HTMLElement.prototype), 'precondition: inert unsupported');

delete require.cache[require.resolve('../src/util.js')];
const { setInert } = require('../src/util.js');

/* --- fixture ----------------------------------------------------------- */
const drawer = new FakeEl('nav', { id: 'drawer' });
const btn = new FakeEl('button');
const link = new FakeEl('a', { href: '#' });
const field = new FakeEl('input');
const roving = new FakeEl('span', { tabindex: '2' });   // an explicit, meaningful value
drawer.append(btn, link, field, roving);
doc.body.append(drawer);

const order = () => [btn, link, field, roving].map(n => n.getAttribute('tabindex'));

let fail = 0;
const check = (name, got, want) => {
  try { assert.deepStrictEqual(got, want); console.log(`  ok   ${name}`); }
  catch { fail++; console.log(`  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`); }
};

check('baseline tab order untouched', order(), [null, null, null, '2']);

/* 5. focus starts inside the subtree, as it would on a re-lock mid-edit. */
doc.activeElement = field;

setInert(drawer, true);
check('locked: every focusable leaves the tab order', order(), ['-1', '-1', '-1', '-1']);
check('locked: aria-hidden set for screen readers', drawer.getAttribute('aria-hidden'), 'true');
check('locked: inert attribute still written for modern engines', drawer.hasAttribute('inert'), true);
check('locked: focus blurred out of the subtree', doc.activeElement, doc.body);

/* 4. a second lock must not remember '-1' as the "original". */
setInert(drawer, true);

setInert(drawer, false);
check('unlocked: original tab order restored, explicit 2 intact', order(), [null, null, null, '2']);
check('unlocked: aria-hidden removed', drawer.getAttribute('aria-hidden'), null);
check('unlocked: inert attribute removed', drawer.hasAttribute('inert'), false);
check('unlocked: no data-bud-ti bookkeeping left behind', drawer.querySelectorAll('[data-bud-ti]').length, 0);

console.log(fail
  ? `\nFAIL — ${fail} check(s) in inert fallback`
  : '\nPASS — inert fallback reproduces inert on an engine without it (10 checks).');
process.exit(fail ? 1 : 0);
