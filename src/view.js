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
