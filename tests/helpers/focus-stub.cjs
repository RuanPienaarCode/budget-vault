'use strict';
/* Focus, for the stub DOM — the one thing it had no model of.

   tests/helpers/dom-stub.cjs gives every element a focus() that does nothing
   and a document.activeElement that is whatever a test last assigned. That is
   enough to prove a view CALLS focus(), and not enough to prove where focus
   ends up, which is the whole question after a rebuild: a handler empties its
   table, the control that fired it is gone, and the browser parks focus on
   <body>. A keyboard reader is then at the top of the page, and a screen
   reader says nothing at all.

   So this installs the three facts a browser supplies and the stub did not:

     1. focus() moves document.activeElement to the element.
     2. an element REMOVED from the page stops being the active element — the
        browser falls back to <body> the moment it is detached. The stub never
        clears a child's parent pointer on empty()/replaceChildren(), so
        "attached" is asked the honest way: does every ancestor still list it?
     3. focus() on something that is not rendered — itself or an ancestor
        carrying the house `hidden` class — is refused, exactly as it is for
        display:none, so a fallback that names a hidden bar cannot look like a
        landing.
     4. focus() on something that is not focusable is refused too: a <tr> or a
        <div> takes focus only once it carries a tabindex. Without this a test
        could "land" on a table row no browser would ever focus.
     5. a focused control that is then HIDDEN — not removed — is still
        document.activeElement, and has no box: getClientRects() is empty. A
        browser only drops that focus to <body> at its next frame, so code
        asking synchronously sees a "focused" control nobody can see. That is
        the state src/dom.js refocus has to recognise, so it is modelled as it
        is rather than tidied into the after-the-frame answer.

   Patched onto FakeEl's prototype for the calling test's process only (each
   suite is its own node process), and deliberately kept out of dom-stub.cjs:
   every other suite written against the inert focus() keeps the behaviour it
   was written against.

     const focus = installFocus();
     button.focus();           // or focus.on(button)
     rebuild();
     focus.at()                // -> document.body when the button was destroyed
*/

const { FakeEl, installDom } = require('./dom-stub.cjs');

function installFocus() {
  const doc = installDom();
  let current = null;

  const attached = node => {
    for (let n = node; n && n._parent; n = n._parent) {
      if (!n._parent.children.includes(n)) return false;
    }
    return true;
  };
  const rendered = node => {
    for (let n = node; n; n = n._parent) if (n._cls && n._cls.has('hidden')) return false;
    return true;
  };

  Object.defineProperty(doc, 'activeElement', {
    configurable: true,
    get: () => (current && attached(current) ? current : doc.body),
    set: v => { current = v && v !== doc.body ? v : null; },
  });
  const focusable = node => /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(node.tagName) || node.hasAttribute('tabindex');
  FakeEl.prototype.focus = function () {
    if (this.disabled || !focusable(this) || !attached(this) || !rendered(this)) return;
    current = this;
  };
  FakeEl.prototype.blur = function () { if (current === this) current = null; };
  FakeEl.prototype.getClientRects = function () { return attached(this) && rendered(this) ? [{}] : []; };

  return {
    at: () => doc.activeElement,
    on: el => { el.focus(); return el; },
    lost: () => doc.activeElement === doc.body || doc.activeElement.getClientRects().length === 0,
    reset: () => { current = null; },
    /* The key of whatever holds focus, or null on <body> — what most of the
       assertions in these suites actually want to say. */
    key: () => (doc.activeElement === doc.body ? null : doc.activeElement.getAttribute('data-focus-key')),
  };
}

/* The first element under `root` carrying this focus key, read the way a test
   wants it: without going through the helper under test. */
function keyed(root, key) {
  const walk = e => {
    for (const c of e.children) {
      if (c.attrs && c.attrs['data-focus-key'] === key) return c;
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root);
}

module.exports = { installFocus, keyed };
