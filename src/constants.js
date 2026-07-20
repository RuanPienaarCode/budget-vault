'use strict';
/* Shared constants. */

const VIEW_TYPE = 'budget-app-view';

const DEFAULT_SETTINGS = {
  budgetFolder: 'Finances/Budget',
  theme: 'auto',          // 'auto' (follow Obsidian) | 'dark' | 'light'
  openOnStartup: false,
  onboarded: false,       // first-run wizard shown (or an existing budget was detected)
};

const TYPE_ORDER = ['income', 'expense', 'services', 'insurance', 'giving', 'savings', 'investment', 'luxuries', 'transfer'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

module.exports = { VIEW_TYPE, DEFAULT_SETTINGS, TYPE_ORDER, MONTHS };
