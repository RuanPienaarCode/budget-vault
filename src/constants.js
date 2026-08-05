'use strict';
/* Shared constants. */

const VIEW_TYPE = 'budget-app-view';

const DEFAULT_SETTINGS = {
  budgetFolder: 'Finances/Budget',
  theme: 'auto',          // 'auto' (follow Obsidian) | 'dark' | 'light'
  openOnStartup: false,
  onboarded: false,       // first-run wizard shown (or an existing budget was detected)
  privacyLock: true,      // splash gate: nothing loads or paints until "Enter budget" is tapped
};

/* Public feedback form — bug reports and feature requests. Opened in the
   system browser on click; the plugin itself never touches the network. */
const FEEDBACK_URL = 'https://forms.gle/EVJKCuZxNQ9vJhTz6';

/* Optional donation link, mirroring manifest.json's fundingUrl. Same deal as
   the feedback form: handed to the system browser, never fetched in-plugin. */
const SUPPORT_URL = 'https://paypal.me/ruanpienaar86';

/* Pay cycles offered as presets, keyed by the length stored in period_days.
   Lives here because BOTH the settings tab and the setup wizard offer them, and
   settings-tab.js already requires onboarding.js — a shared table in either
   would be a require cycle. The stored value is a plain day count so it needs
   no translating (see the header of period.js); the labels do the talking,
   because nobody thinks of themselves as being paid "every 14 days". */
const PERIOD_PRESETS = { 0: 'Monthly (payday month)', 7: 'Every week', 14: 'Every 2 weeks', 28: 'Every 4 weeks' };

const TYPE_ORDER = ['income', 'expense', 'debt', 'services', 'insurance', 'giving', 'savings', 'investment', 'luxuries', 'transfer'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

module.exports = { VIEW_TYPE, DEFAULT_SETTINGS, FEEDBACK_URL, SUPPORT_URL, TYPE_ORDER, MONTHS, PERIOD_PRESETS };
