'use strict';
/* Obsidian's Modal and Setting, shaped the way the shipped app builds them.

   src/modal.js's FieldModal is the dialog behind every askFields call, and the
   two things a keyboard or screen-reader user needs from it are decided by
   markup Obsidian owns: which element takes focus, and where the visible label
   sits relative to the control. A stub that invents that markup lets a test
   pass against a shape the app never has, so this one is copied from the
   bundle rather than from memory (app.js out of obsidian.asar, read 11 Nov
   2026):

     Setting      settingEl > infoEl > nameEl + descEl, then controlEl. The
                  name is a sibling <div>, never a <label for>, which is the
                  whole of the missing-name defect.
     toggle       <label class="checkbox-container" tabindex="0"> wrapping
                  <input type="checkbox" tabindex="-1">. The LABEL is the tab
                  stop; its own keydown turns Space and Enter into a toggle.
                  setValue() flips `on` and a class, and never the input's
                  `checked`, so the checkbox underneath says "unchecked" about
                  a toggle that is on.
     dropdown     a plain <select> in the control cell.
     Scope        handlers are run from a keydown listener on `window` in the
                  CAPTURE phase, so the dialog's Enter handler sees the key
                  before the focused button, select or toggle does. Returning
                  nothing leaves the key to them; only an explicit
                  preventDefault takes it away.

   `legacyToggle` builds the older shape instead — a <div> container around a
   checkbox that is itself the tab stop — because minAppVersion is 1.8.0 and
   the control's name has to land on whichever element is focusable.

   Elements are tests/helpers/dom-stub.cjs's FakeEl plus the few Obsidian
   augmentations modal.js reaches for. */

const Module = require('module');
const { FakeEl } = require('./dom-stub.cjs');

class El extends FakeEl {
  createEl(tag, o = {}) {
    const n = new El(tag);
    if (o.cls) n.className = o.cls;
    if (o.text != null) n.textContent = o.text;
    for (const [k, v] of Object.entries(o.attr || {})) n.setAttribute(k, v);
    if (o.type) n.type = o.type;
    this.append(n);
    return n;
  }
  createDiv(o) { return this.createEl('div', typeof o === 'string' ? { cls: o } : (o || {})); }
  setText(v) { this.textContent = v; }
  addClass(...c) { this.classList.add(...c); }
  hasClass(c) { return this.classList.contains(c); }
  toggleClass(c, on) { this.classList.toggle(c, !!on); }
  /* Class selectors only, walked up from the element itself — the one shape
     modal.js asks ("is this inside a toggle?"). FakeEl's own closest() answers
     null to everything, which would let that question pass for the wrong
     reason. */
  closest(sel) {
    const cls = String(sel).replace(/^\./, '');
    for (let n = this; n; n = n._parent) if (n._cls && n._cls.has(cls)) return n;
    return null;
  }
}

/* Every element is an El, including the ones src/dom.js's el() makes. Set
   before any src/ file is required, and before dom-stub's installDom() could
   hand out plain FakeEls instead. */
function installModalDom() {
  global.document = {
    createElement: t => new El(t),
    createTextNode: t => Object.assign(new El('#text'), { _text: String(t) }),
    body: new El('body'),
  };
  global.document.activeElement = global.document.body;
  global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };
  return global.document;
}

function makeObsidian({ legacyToggle = false } = {}) {
  /* Read when a toggle is BUILT, so one suite can open a dialog in each shape
     without re-requiring src/modal.js against a second stub. */
  const shape = { legacyToggle };
  class Scope {
    constructor() { this.keys = []; }
    register(modifiers, key, func) { this.keys.push({ modifiers, key, func }); }
  }

  class Modal {
    constructor(app) {
      this.app = app;
      this.scope = new Scope();
      this.modalEl = new El('div');
      this.titleEl = this.modalEl.createDiv('modal-title');
      this.contentEl = this.modalEl.createDiv('modal-content');
    }
    open() { Modal.last = this; this.isOpen = true; this.onOpen(); }
    close() { if (!this.isOpen) return; this.isOpen = false; this.onClose(); }
    /* The keydown as the app delivers it: to the scope first. Hands back what
       the dialog did with it, which is all a caller can observe from outside —
       whether the default was prevented, and whether the dialog closed. */
    press(key, target) {
      let prevented = false;
      const evt = { key, target, preventDefault() { prevented = true; }, stopPropagation() {} };
      for (const k of this.scope.keys) if (k.key === key) k.func(evt);
      return { prevented, closed: !this.isOpen };
    }
  }

  class Setting {
    constructor(containerEl) {
      this.settingEl = containerEl.createDiv({ cls: 'setting-item', attr: { tabindex: '-1' } });
      this.infoEl = this.settingEl.createDiv('setting-item-info');
      this.nameEl = this.infoEl.createDiv('setting-item-name');
      this.descEl = this.infoEl.createDiv('setting-item-description');
      this.controlEl = this.settingEl.createDiv('setting-item-control');
    }
    setName(v) { this.nameEl.setText(v); return this; }
    setDesc(v) { this.descEl.setText(v); return this; }
    setClass(c) { this.settingEl.addClass(c); return this; }
    setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
    addText(cb) {
      const inputEl = this.controlEl.createEl('input', { type: 'text' });
      const c = {
        inputEl,
        setValue(v) { inputEl.value = v; return c; },
        setPlaceholder(v) { inputEl.setAttribute('placeholder', v); return c; },
        onChange(fn) { inputEl._change = fn; return c; },
      };
      cb(c); return this;
    }
    addTextArea(cb) {
      const inputEl = this.controlEl.createEl('textarea');
      const c = {
        inputEl,
        setValue(v) { inputEl.value = v; return c; },
        setPlaceholder(v) { inputEl.setAttribute('placeholder', v); return c; },
        onChange(fn) { inputEl._change = fn; return c; },
      };
      cb(c); return this;
    }
    addDropdown(cb) {
      const selectEl = this.controlEl.createEl('select', { cls: 'dropdown' });
      const c = {
        selectEl,
        addOption(value, label) { selectEl.createEl('option', { text: label, attr: { value } }); return c; },
        setValue(v) { selectEl.value = v; return c; },
        onChange(fn) { selectEl._change = fn; return c; },
      };
      cb(c); return this;
    }
    addToggle(cb) {
      const legacy = shape.legacyToggle;
      const toggleEl = legacy
        ? this.controlEl.createDiv('checkbox-container')
        : this.controlEl.createEl('label', { cls: 'checkbox-container', attr: { tabindex: '0' } });
      const input = toggleEl.createEl('input', { type: 'checkbox', attr: { tabindex: legacy ? '0' : '-1' } });
      const c = {
        toggleEl,
        on: false,
        getValue() { return c.on; },
        /* As shipped: the callback fires on every real change, and the
           checkbox underneath is left alone. */
        setValue(v) {
          if (c.on !== v) { c.on = v; toggleEl.toggleClass('is-enabled', v); if (c._change) c._change(v); }
          return c;
        },
        onChange(fn) { c._change = fn; return c; },
        flip() { c.setValue(!c.on); },
      };
      toggleEl._toggle = c;
      input._toggle = c;
      cb(c); return this;
    }
    addButton(cb) {
      const buttonEl = this.controlEl.createEl('button');
      const c = {
        buttonEl,
        setButtonText(t) { buttonEl.textContent = t; return c; },
        setCta() { buttonEl.addClass('mod-cta'); return c; },
        setWarning() { buttonEl.addClass('mod-warning'); return c; },
        setDisabled(d) { buttonEl.disabled = !!d; return c; },
        onClick(fn) { buttonEl._onClick = fn; return c; },
      };
      cb(c); return this;
    }
  }

  return { Modal, Setting, setIcon() {}, normalizePath: p => p, shape };
}

/* Swap `obsidian` for the stub. Call before requiring anything under src/. */
function stubModalObsidian(opts) {
  installModalDom();
  const obsidian = makeObsidian(opts);
  const origLoad = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'obsidian') return obsidian;
    return origLoad.call(this, req, ...rest);
  };
  return obsidian;
}

/* Every element under `root` with this tag, in document order. */
function byTag(root, tag) {
  const out = [];
  const walk = e => { for (const c of e.children) { if (c.tagName === tag.toUpperCase()) out.push(c); walk(c); } };
  walk(root);
  return out;
}

/* The element a description id points at, found the way a browser resolves an
   IDREF: by id, anywhere in the dialog. */
function byId(root, id) {
  let hit = null;
  const walk = e => { for (const c of e.children) { if (c.attrs && c.attrs.id === id) hit = hit || c; walk(c); } };
  walk(root);
  return hit;
}

module.exports = { El, stubModalObsidian, makeObsidian, installModalDom, byTag, byId };
