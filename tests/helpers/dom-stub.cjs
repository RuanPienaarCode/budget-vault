'use strict';
/* A DOM small enough to run a view against, and no smaller.

   Views are where this app breaks in the way tests miss: the arithmetic under
   them is covered thoroughly, and coverage of the maths reads like coverage of
   the page. A caption in views/debts.js once reached for a binding declared in
   a different function — valid syntax, so `node --check` passed, and there is
   no linter — and the Debt page threw on every render for a whole release while
   every guard suite stayed green. Nothing but executing the view catches that.

   Deliberately NOT a DOM implementation. It answers the calls src/dom.js and
   the views actually make, and it auto-creates any element asked for by id, so
   a test does not have to enumerate a view's containers and go stale when one
   is added. If a view starts needing something that isn't here, the honest fix
   is to add it here rather than to give that view its own private stub.

   Used by tests/views-render.test.cjs and tests/debts-render.test.cjs. */

class FakeEl {
  constructor(tag = 'div') {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.dataset = {};
    this._cls = new Set();
    this._text = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.files = [];
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => x && self._cls.add(x)),
      remove: (...c) => c.forEach(x => self._cls.delete(x)),
      toggle: (c, on) => (on === undefined
        ? (self._cls.has(c) ? self._cls.delete(c) : self._cls.add(c))
        : (on ? self._cls.add(c) : self._cls.delete(c))),
      contains: c => self._cls.has(c),
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  // A real <select> exposes its <option>s, and more than one view counts them
  // to decide whether the list still needs building.
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get parentElement() { return this._parent || null; }
  get offsetWidth() { return 800; }
  get scrollTop() { return 0; }
  set scrollTop(_v) { /* keepScroll writes this back */ }

  empty() { this.children = []; this._text = ''; }
  append(...kids) {
    for (const k of kids) {
      if (k == null || k === '') continue;
      const node = typeof k === 'string' ? Object.assign(new FakeEl('#text'), { _text: k }) : k;
      node._parent = this;
      this.children.push(node);
    }
  }
  appendChild(k) { this.append(k); return k; }
  insertBefore(k, _ref) { this.append(k); return k; }
  removeChild(k) { this.children = this.children.filter(c => c !== k); return k; }
  remove() { if (this._parent) this._parent.removeChild(this); }
  replaceChildren(...kids) { this.children = []; this._text = ''; this.append(...kids); }
  /* `class` is reflected into _cls the same way the `className` setter
     already does — real DOM does this too, for HTML *and* SVG elements
     (setAttribute('class', ...) is the ONLY correct way to set an SVG
     element's class; assigning .className directly is unreliable there,
     since SVGElement.className is an SVGAnimatedString in a spec-strict
     engine). The score ring is the first stub SVG built entirely through
     setAttribute rather than the `class` shorthand in dom.js's el(), and
     without this its every class query came back empty. */
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') { this.className = String(v); }
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  /* Handlers are KEPT, not swallowed. A stub that drops them lets a suite prove
     a control was rendered and never that pressing it does anything — which is
     most of what a control is. _fire() is the way in; click() routes through it
     so a view calling .click() on its own element behaves. */
  addEventListener(type, fn) {
    if (typeof fn !== 'function') return;
    (this._on || (this._on = {}))[type] = [...((this._on || {})[type] || []), fn];
  }
  removeEventListener(type, fn) {
    if (!this._on || !this._on[type]) return;
    this._on[type] = this._on[type].filter(f => f !== fn);
  }
  /* Deliberately NOT a DOM event: no bubbling, no default action, no synthetic
     Event object beyond what the handlers here actually read. Anything more
     would be a second event system to keep true to the first. */
  _fire(type, evt = {}) {
    for (const fn of (this._on && this._on[type]) || []) {
      fn({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...evt });
    }
    return this;
  }
  focus() {}
  blur() {}
  click() { return this._fire('click'); }
  closest() { return null; }
  /* A real answer, walked up the parent chain. It returned a flat `false`
     while nothing asked it anything that mattered — but the score explainer
     decides whether to stay open by asking whether focus is still inside its
     tile, and a double that always says "no" cannot tell a correct fix from
     the bug it replaced. */
  contains(node) {
    for (let n = node; n; n = n._parent) { if (n === this) { return true; } }
    return false;
  }
  scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 400, right: 800, bottom: 400 }; }
  // Depth-first, matching only the shapes the views actually query for.
  querySelectorAll(sel) { return descend(this).filter(e => matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function descend(el, out = []) {
  for (const c of el.children) { if (c.nodeType === 1) { out.push(c); descend(c, out); } }
  return out;
}
function matches(el, sel) {
  const s = String(sel).trim();
  if (s.startsWith('.')) return el._cls.has(s.slice(1));
  if (s.startsWith('#')) return el.attrs.id === s.slice(1);
  /* [attr="value"] — the shell addresses its drawer links by data-view, and
     controller.js's applyInputMode() hides one of them by exactly that
     selector. Without this shape here, that query would match nothing and a
     test could "prove" a hide that never happened. */
  const attr = s.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (attr) return el.attrs[attr[1]] === attr[2];
  return el.tagName === s.toUpperCase();
}

/* Install the globals src/dom.js and src/chart.js reach for. Idempotent, so a
   suite that calls it twice does not end up with two different document
   objects handing out incompatible elements. */
function installDom() {
  if (!global.document) {
    global.document = {
      createElement: t => new FakeEl(t),
      createElementNS: (_ns, t) => new FakeEl(t),
      createTextNode: t => Object.assign(new FakeEl('#text'), { _text: String(t) }),
      createDocumentFragment: () => new FakeEl('#fragment'),
      querySelector: () => null,
      querySelectorAll: () => [],
      body: new FakeEl('body'),
      documentElement: new FakeEl('html'),
    };
    /* Focus has to have somewhere to BE, and <body> is where a browser parks
       it when a touch lands on something unfocusable — the exact state the
       score explainer has to tell apart from "the reader tabbed away". A test
       assigns document.activeElement directly to rehearse either one. */
    global.document.activeElement = global.document.body;
  }
  if (!global.getComputedStyle) {
    // Empty throughout, so themeColors() takes its documented hex fallbacks
    // rather than depending on a stylesheet no test loads.
    global.getComputedStyle = () => ({ getPropertyValue: () => '' });
  }
  if (!global.requestAnimationFrame) global.requestAnimationFrame = fn => setTimeout(fn, 0);
  if (!global.matchMedia) global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  /* `window` itself, because several views legitimately reach for browser APIs
     that exist in Obsidian on both desktop and mobile — matchMedia for a
     hover-capable pointer, PointerEvent for chart interaction, setTimeout for
     deferred focus. Note the guards in the views test the METHOD
     (`typeof window.matchMedia === 'function'`), which throws before it can
     help if `window` is absent entirely — so a bare node run needs this even
     though the app never does.

     matchMedia reports NO hover and NO fine pointer: of the two branches that
     is the touch one, which is the harder path and the one a phone takes. */
  if (!global.window) {
    global.window = {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: id => clearTimeout(id),
      requestAnimationFrame: fn => setTimeout(fn, 0),
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      addEventListener() {}, removeEventListener() {},
      // Deliberately absent: PointerEvent. chart.js checks for it before wiring
      // pointer handlers, so leaving it undefined exercises the fallback.
      document: global.document,
      innerWidth: 800, innerHeight: 1000, devicePixelRatio: 1,
    };
  }
  return global.document;
}

/* An auto-vivifying `$`. A view asking for a container it owns gets one, so a
   test never has to list a view's ids — that list is exactly the thing that
   goes stale, and a missing id fails as "the card guarded itself correctly"
   rather than as a gap in the test. The tag is guessed from the id because a
   couple of views read `.value` or count `.options`. */
function makeDom() {
  installDom();
  const nodes = new Map();
  const tagFor = id => (/table$/i.test(id) ? 'table'
    : /(select|range|strategy|filter|sort|period|year|cycle|mode)$/i.test(id) ? 'select'
    : /(input|search|extra|amount|name|note|date|file)$/i.test(id) ? 'input'
    : 'div');
  const $ = sel => {
    const key = String(sel);
    if (!nodes.has(key)) {
      const el = new FakeEl(key.startsWith('#') ? tagFor(key.slice(1)) : 'div');
      if (key.startsWith('#')) el.attrs.id = key.slice(1);
      nodes.set(key, el);
    }
    return nodes.get(key);
  };
  return { $, nodes, FakeEl };
}

module.exports = { FakeEl, makeDom, installDom, descend };
