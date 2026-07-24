'use strict';
/* The workspace view that hosts the budget app. */

const { ItemView, Notice } = require('obsidian');
const { VIEW_TYPE } = require('./constants');
const { mountApp } = require('./controller');

class BudgetView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Budget'; }
  getIcon() { return 'wallet'; }
  async onOpen() {
    this.appCtl = mountApp(this);
    await this.appCtl.start();
    this.setupKeyboardViewport();
  }

  /* Mobile keyboard fix. Obsidian's pane does not shrink when the iOS soft keyboard
     opens, so the app (height:100% of the pane) keeps its full height behind the
     keyboard — leaving a dead band and hiding the focused input. We watch
     visualViewport: when it shrinks (keyboard up), cap the app's height to the
     visible area above the keyboard so the inner scroll region can bring the
     focused field into view; restore height:100% when it closes. */
  setupKeyboardViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = this.contentEl;
    const KB_MIN = 120; // ignore small viewport nudges (URL bar etc.); only react to a real keyboard
    const adjust = () => {
      const keyboard = window.innerHeight - (vv.height + vv.offsetTop);
      if (keyboard > KB_MIN) {
        const top = root.getBoundingClientRect().top;
        const h = (vv.offsetTop + vv.height) - top;
        if (h > 120) root.style.height = `${h}px`;
        const a = document.activeElement;
        if (a && root.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
          window.setTimeout(() => a.scrollIntoView({ block: 'center' }), 60);
        }
      } else {
        root.style.height = '';
      }
    };
    this.registerDomEvent(vv, 'resize', adjust);
    this.registerDomEvent(vv, 'scroll', adjust);
  }
  async onClose() {
    if (this.appCtl && this.appCtl.hasDirty()) {
      new Notice('Budget: the view closed with unsaved changes — they were not written to disk.', 8000);
    }
    this.appCtl = null;
    this.contentEl.empty();
    this.contentEl.classList.remove('budget-app-root', 'bud-dark');
  }
}

module.exports = { BudgetView };
