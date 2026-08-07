'use strict';
/* Interface language — deliberately SEPARATE from `country` in locale.js.

   The two axes are orthogonal and must stay that way: someone living in South
   Africa may want the interface in English, and someone living in Germany may
   want it in Afrikaans. Country drives money formatting, statement date order
   and the Tax view's authority-specific checklist; language drives the words
   the interface is written in. Neither implies the other, and picking one never
   constrains the other.

   Stored as `language:` in the budget folder's Settings.md (vault-synced, like
   `country` and `currency`); a missing key means "follow Obsidian's own display
   language, falling back to English", which is what every pre-language install
   effectively was.

   A missing key in the active language falls back to English rather than
   rendering blank or throwing — a half-translated table degrades to a
   half-English interface, which is usable, instead of a broken one.

   iOS 15 / WebKit floor: no regex lookbehind anywhere in this file (it is a
   parse-time SyntaxError that kills the WHOLE bundle, not just this module). */

const en = require('./lang/en');
const af = require('./lang/af');
const de = require('./lang/de');
const es = require('./lang/es');
const fr = require('./lang/fr');
const ja = require('./lang/ja');
const zh = require('./lang/zh');

/* The tables that actually ship. Adding a language is: write src/lang/xx.js,
   add it here, add its name below. tests/i18n.test.cjs fails the build if a
   table is missing keys English has, or carries keys English doesn't. */
const TABLES = { en, af, de, es, fr, ja, zh };

/* Every language's name written the way its own speakers write it — never
   translated into the current interface language, because someone who has
   accidentally set the interface to a language they cannot read needs to find
   their own language in this list to get back out. */
const LANGUAGE_NAMES = {
  en: 'English',
  af: 'Afrikaans',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  zh: '中文',
};

/* Dropdown order — English first (the pre-language default), then the rest in
   the order they were added. Derived from TABLES rather than hand-listed so the
   dropdown can never offer a language that has no table behind it. */
const LANGUAGE_ORDER = ['en', 'af', 'de', 'es', 'fr', 'ja', 'zh'].filter(id => TABLES[id]);

/* --------------------------- plural categories ---------------------------- */

/* Languages with a SINGLE noun form — a count never changes the wording, so
   every plural entry resolves to `other`. Writing `1 item / 2 items` logic into
   these produces text a native reader finds wrong, not merely clumsy. */
const ONE_FORM = new Set(['zh', 'ja']);

/* Languages where 0 takes the SINGULAR alongside 1 (French: "0 fichier",
   "1 fichier", "2 fichiers"). English, Afrikaans, German and Spanish all take
   the plural at 0 ("0 files"), so they use the ordinary n === 1 rule. */
const ZERO_IS_SINGULAR = new Set(['fr']);

/* Which form of a plural entry a count selects. Kept deliberately small: these
   seven languages need exactly two categories between them, and Intl.PluralRules
   — which would be the general answer — is not something to depend on for
   correctness across the WebKit floor when the rule set is this shallow. */
function pluralCategory(lang, n) {
  const count = Math.abs(Number(n) || 0);
  if (ONE_FORM.has(lang)) return 'other';
  if (ZERO_IS_SINGULAR.has(lang)) return count < 2 ? 'one' : 'other';
  return count === 1 ? 'one' : 'other';
}

/* ------------------------------ ordinal days ------------------------------- */

/* "the 25th" does not survive translation as a string — every language builds
   an ordinal day differently, and interpolating an English "25th" into a German
   sentence is the single most obvious tell that a UI was translated badly.
   Scoped deliberately to days 1–31, which is the only place the wizard needs
   one; a general ordinal formatter for arbitrary numbers is a much bigger
   problem and nothing here asks for it.

   Intl.PluralRules with type:'ordinal' would give the English rule for free,
   but only English needs rules at all here — the rest are a suffix or a
   character — so the table is smaller than the feature detection would be. */
const ORDINAL_DAY = {
  /* 1st / 2nd / 3rd / 4th, with 11th–13th taking "th" against the pattern. */
  en: n => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  },
  /* Afrikaans: 1ste, 2de, 3de, 4de … 8ste, and -ste again from 20 up. */
  af: n => n + (n === 1 || n === 8 || n >= 20 ? 'ste' : 'de'),
  de: n => n + '.',                       // "am 25." — the period IS the ordinal
  es: n => String(n),                     // "el 25" — Spanish uses the cardinal
  fr: n => n + (n === 1 ? 'er' : ''),     // "le 1er", then "le 25"
  ja: n => n + '日',
  zh: n => n + ' 日',
};

function ordinalDay(lang, n) {
  const fn = ORDINAL_DAY[lang] || ORDINAL_DAY.en;
  return fn(Number(n));
}

/* The active language's formatter, for callers that do not track the language
   themselves — which is all of them. */
function day(n) {
  return ordinalDay(current, n);
}

/* ------------------------------ current language --------------------------- */

/* Seeded from Obsidian's own display language rather than hardcoded to English,
   because "absent means follow Obsidian" has to hold from the first t() call —
   not only after something has read Settings.md. The first run is exactly the
   case where nothing has: the setup wizard opens before any budget file exists,
   and a hardcoded 'en' here would render it in English while its own language
   picker showed the user's actual language selected. */
let current = defaultLanguage();

/* Resolve any stored/hand-edited value to a language we actually have a table
   for. Unknown values resolve to English rather than throwing, so a typo in a
   hand-edited Settings.md cannot break the app — the same contract localeFor()
   gives `country`. */
function resolveLanguage(code) {
  const id = (code || '').toString().trim().toLowerCase();
  return TABLES[id] ? id : 'en';
}

function setLanguage(code) {
  current = resolveLanguage(code);
  return current;
}

function currentLanguage() {
  return current;
}

/* Obsidian's own display language, for a vault that has never set `language`.
   Obsidian keeps it in localStorage under `language` (absent or empty for
   English). Both reads are guarded: localStorage throws in restricted contexts,
   and neither `window` nor `navigator` exists in the bare-node guard tests. */
function defaultLanguage() {
  const base = v => (v || '').toString().trim().toLowerCase().split(/[-_]/)[0];
  try {
    const obsidian = base(window.localStorage.getItem('language'));
    if (TABLES[obsidian]) return obsidian;
  } catch (e) { /* no window, or localStorage unavailable */ }
  try {
    const nav = base(navigator.language);
    if (TABLES[nav]) return nav;
  } catch (e) { /* no navigator */ }
  return 'en';
}

/* ------------------------------- translation ------------------------------- */

/* `{name}` only — no lookbehind, no nested braces. An unknown placeholder is
   left standing verbatim rather than rendered as "undefined", so a missing
   param shows up as an obvious `{count}` in the interface instead of quietly
   producing a sentence that reads as if a real value were zero. */
const PLACEHOLDER = /\{(\w+)\}/g;

function interpolate(s, params) {
  if (!params || typeof s !== 'string') return s;
  return s.replace(PLACEHOLDER, (whole, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
}

/* One key, resolved against one table. Plural entries are objects keyed by
   category; a table that gives only `other` (Chinese, Japanese) still answers a
   `one` lookup, because pluralCategory never asks those languages for `one`. */
function lookup(lang, key, count) {
  const table = TABLES[lang];
  if (!table) return undefined;
  const v = table[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  const cat = pluralCategory(lang, count);
  return v[cat] !== undefined ? v[cat] : v.other;
}

/* The interface's one translation call.

   t('nav.dashboard')
   t('settings.budgetsKept', { count: n })      // plural entry, `count` selects
   t('tax.filedOn', { date: '2026-08-07' })     // {date} interpolated

   Resolution order is active language -> English -> the key itself. Returning
   the key is the deliberate worst case: it is visible in the interface and
   greppable in a bug report, where a blank string is neither. */
function t(key, params) {
  const count = params && params.count;
  let s = lookup(current, key, count);
  if (s === undefined && current !== 'en') s = lookup('en', key, count);
  if (s === undefined) return key;
  return interpolate(s, params);
}

/* ---------------------------- DOM markup pass ------------------------------ */

/* SHELL_HTML is a single 30KB static string parsed once through DOMParser, and
   turning it into a template literal of t() calls would make it unreadable and
   re-parse it on every language change. It carries data-i18n attributes
   instead, applied here after the parse.

   Attribute -> what it sets. `data-i18n` writes textContent, so the element
   must hold TEXT ONLY — a drawer link wraps its label in its own span rather
   than carrying a bare text node beside the icon span, or the icon would be
   overwritten. */
const DOM_BINDINGS = [
  ['data-i18n', null],
  ['data-i18n-aria', 'aria-label'],
  ['data-i18n-title', 'title'],
  ['data-i18n-placeholder', 'placeholder'],
];

function applyDom(root) {
  if (!root || !root.querySelectorAll) return;
  for (const [attr, target] of DOM_BINDINGS) {
    root.querySelectorAll('[' + attr + ']').forEach(node => {
      const s = t(node.getAttribute(attr));
      if (target) node.setAttribute(target, s);
      else node.textContent = s;
    });
  }
}

module.exports = {
  t,
  setLanguage,
  currentLanguage,
  resolveLanguage,
  defaultLanguage,
  pluralCategory,
  ordinalDay,
  day,
  applyDom,
  TABLES,
  LANGUAGE_NAMES,
  LANGUAGE_ORDER,
};
