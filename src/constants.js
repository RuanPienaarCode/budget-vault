'use strict';
/* Shared constants. */

const VIEW_TYPE = 'budget-app-view';

const DEFAULT_SETTINGS = {
  budgetFolder: 'Finances/Budget',
  theme: 'auto',          // 'auto' (follow Obsidian) | 'dark' | 'light'
  openOnStartup: false,
  onboarded: false,       // first-run wizard shown (or an existing budget was detected)
  privacyLock: true,      // splash gate: nothing loads or paints until "Enter budget" is tapped
  /* Chart time ranges (keys from RANGES in chart.js). Plugin data rather than
     Settings.md: these are display state, and Settings.md is the user's own
     hand-editable file — UI preferences do not belong in it. Two keys rather
     than one because the two charts mean different things by a range (history
     behind you vs a schedule ahead of you) and want different defaults. */
  chartTrendRange: '6m',
  chartDebtRange: '5y',
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

/* A length set by hand in Settings.md that isn't one of the presets must still
   appear, and appear truthfully. Snapping it to the nearest preset would edit
   the user's file behind their back the moment they opened settings — or, in
   the wizard's case, the moment they re-ran it against an existing vault.
   Lives here rather than in settings-tab.js because the setup wizard offers
   the same list, and settings-tab.js already requires onboarding.js — the same
   require-cycle reason PERIOD_PRESETS itself sits here. */
function periodLengthOptions(current) {
  const o = { ...PERIOD_PRESETS };
  if (current && !o[current]) o[current] = `Every ${current} days (set in Settings.md)`;
  return o;
}

const TYPE_ORDER = ['income', 'expense', 'debt', 'services', 'insurance', 'giving', 'savings', 'investment', 'luxuries', 'transfer'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

module.exports = { VIEW_TYPE, DEFAULT_SETTINGS, FEEDBACK_URL, SUPPORT_URL, TYPE_ORDER, MONTHS, PERIOD_PRESETS, periodLengthOptions };
