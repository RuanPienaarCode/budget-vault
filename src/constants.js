'use strict';
/* Shared constants. */

const VIEW_TYPE = 'budget-app-view';

/* Colour palettes, id -> label for the settings dropdown.

   The id is also the CSS class the view carries (`bud-palette-<id>`), and the
   blocks behind these live in src/styles-presets.css, generated at build time
   from the seeds in scripts/presets.cjs. This map is the ONLY part of the
   palette system that ships in the bundle: no colour arithmetic runs at runtime,
   because every palette is already literal CSS by the time Obsidian loads it.
   tests/palette.test.cjs pins these ids against the generator's, so the dropdown
   cannot offer a palette that has no CSS behind it.

   Kept here rather than in settings-tab.js for the same reason PERIOD_PRESETS
   is: both the settings tab and controller.js need it, and settings-tab.js
   already requires onboarding.js, so a shared table in either would be a
   require cycle. */
const PALETTE_PRESETS = {
  'vault-green': 'Vault Green',
  ocean: 'Ocean',
  plum: 'Plum',
  slate: 'Slate',
};

const DEFAULT_PALETTE = 'vault-green';

const DEFAULT_SETTINGS = {
  budgetFolder: 'Finances/Budget',
  theme: 'auto',          // 'auto' (follow Obsidian) | 'dark' | 'light'
  /* Which colour palette the two themes above are drawn in. Orthogonal to
     `theme` on purpose: every palette defines BOTH a light and a dark block, so
     picking one never costs you the ability to follow Obsidian's light/dark
     switch. Defaults to the palette the plugin has always shipped, so an
     upgrade changes nothing until it is asked to. */
  palette: DEFAULT_PALETTE,
  openOnStartup: false,
  /* Accounts-table column widths the reader dragged, keyed by column and
     measured in px. Plugin data for the same reason the chart ranges below
     are: display state, and Settings.md is the user's own hand-editable file.

     An empty object is the default and MEANS something — the table keeps its
     automatic layout until a column is actually dragged, at which point it
     switches to a fixed one so the widths are honoured exactly. So "never
     touched" and "dragged back to roughly the default" stay distinguishable,
     and a household that never wants this never pays for it. */
  acctColWidths: {},
  onboarded: false,       // first-run wizard shown (or an existing budget was detected)
  privacyLock: true,      // splash gate: nothing loads or paints until "Enter budget" is tapped
  /* Chart time ranges (keys from RANGES in chart.js). Plugin data rather than
     Settings.md: these are display state, and Settings.md is the user's own
     hand-editable file — UI preferences do not belong in it. Two keys rather
     than one because the two charts mean different things by a range (history
     behind you vs a schedule ahead of you) and want different defaults. */
  /* Where the last export was written, vault-relative. Remembered so the second
     export does not ask the same question again — the dialog still opens, with
     this prefilled, so the answer is confirmed rather than assumed. Plugin data
     rather than Settings.md for the same reason the chart ranges are: it is
     display state, and Settings.md is the user's own hand-editable file. */
  exportFolder: 'Exports',
  chartTrendRange: '6m',
  chartDebtRange: '5y',
  /* Which window "Where it went" measures this period against. Its own key
     rather than sharing chartTrendRange: the trend plots one point per period
     and cannot usefully draw a single one, so it has no 1M pill — and a shared
     key would put one there. Same plugin-data-not-Settings.md reasoning as the
     two above. */
  splitCompareRange: '3m',
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

/* How many periods back the Budget page reads when it pulls a previous
   overspend. Shared by the loader and BOTH halves of the settings tab, so the
   file, the control and the button can never disagree about what an
   out-of-range value means.

   Clamped to 1–12 rather than rejected: 0 would read the period you are
   standing in, whose deficit is still growing — the button would hand back a
   different number every time you pressed it — and a negative value would read
   the future. Anything unreadable falls to 1, the answer for everyone who has
   never heard of this setting. */
const OVERSPEND_LAG_DEFAULT = 1;
const OVERSPEND_LAG_MAX = 12;
function overspendLag(v) {
  const n = parseInt((v ?? '').toString().trim(), 10);
  if (!Number.isFinite(n)) return OVERSPEND_LAG_DEFAULT;
  return Math.min(OVERSPEND_LAG_MAX, Math.max(1, n));
}

/* Months of essential spending the emergency fund is aiming for. Six is the
   conventional target and the default; three is the other figure households
   plan around, which is why it is a setting rather than a constant.

   Clamped 1–24 for the same reason overspendLag is: a zero target makes the
   cover meter divide by nothing, and past two years the meter stops reading as
   a target and starts reading as a ceiling nobody reaches. One definition,
   because the loader and the settings tab both have to agree about what a
   hand-edited value means — two clamps is how the screen ends up showing a
   figure the app is not running. */
const EMERGENCY_TARGET_DEFAULT = 6;
const EMERGENCY_TARGET_MAX = 24;
function emergencyTarget(v) {
  const n = parseInt((v ?? '').toString().trim(), 10);
  if (!Number.isFinite(n)) return EMERGENCY_TARGET_DEFAULT;
  return Math.min(EMERGENCY_TARGET_MAX, Math.max(1, n));
}

/* How the household gets transactions into the vault: 'csv' (download a
   statement and import it) or 'manual' (type each line on the Transactions
   page). A Settings.md key rather than plugin data, for the same reason
   `country` and `language` are — it is a fact about the household, not about
   this device, and it has to travel with the vault to the phone.

   ABSENT MEANS 'csv', and that is the whole compatibility story: every vault
   written before this key existed goes on behaving exactly as it did, because
   CSV import is what the app has always assumed. An unknown hand-edited value
   falls back the same way rather than throwing — the same contract localeFor
   gives country and resolveLanguage gives language.

   One definition, because the loader, the settings tab and the wizard all have
   to agree about what a hand-edited value means. Two normalisers is how the
   drawer ends up hiding the Import link on a vault the settings screen is
   still describing as a CSV household. */
const INPUT_MODES = ['csv', 'manual'];
const INPUT_MODE_DEFAULT = 'csv';
function inputMode(v) {
  const s = (v ?? '').toString().trim().toLowerCase();
  return INPUT_MODES.includes(s) ? s : INPUT_MODE_DEFAULT;
}

/* Page order for the Budget and Dashboard group headers, and the optgroup
   order in every category picker. The household buckets (housing through
   fees) split what used to be one flat `expense` group; `expense` stays as
   the catch-all so a vault typed before the split keeps loading unchanged.
   health-math treats every type not in NON_ESSENTIAL_TYPES as essential, so
   the new buckets count toward emergency cover without being listed there. */
const TYPE_ORDER = ['income', 'housing', 'utilities', 'food', 'transport', 'health', 'family', 'personal', 'fees', 'expense', 'debt', 'services', 'insurance', 'giving', 'savings', 'investment', 'luxuries', 'transfer'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

module.exports = { VIEW_TYPE, DEFAULT_SETTINGS, FEEDBACK_URL, SUPPORT_URL, TYPE_ORDER, MONTHS, PERIOD_PRESETS, PALETTE_PRESETS, DEFAULT_PALETTE, periodLengthOptions, overspendLag, OVERSPEND_LAG_DEFAULT, OVERSPEND_LAG_MAX, emergencyTarget, EMERGENCY_TARGET_DEFAULT, EMERGENCY_TARGET_MAX, INPUT_MODES, INPUT_MODE_DEFAULT, inputMode };
