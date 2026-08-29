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
const xh = require('./lang/xh');
const zu = require('./lang/zu');
const pt = require('./lang/pt');
const hi = require('./lang/hi');
const id = require('./lang/id');

/* The tables that actually ship. Adding a language is: write src/lang/xx.js,
   add it here, add its name below. tests/i18n.test.cjs fails the build if a
   table is missing keys English has, or carries keys English doesn't. */
const TABLES = { en, af, de, es, fr, ja, zh, xh, zu, pt, hi, id };

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
  xh: 'isiXhosa',
  zu: 'isiZulu',
  pt: 'Português',
  hi: 'हिन्दी',
  id: 'Bahasa Indonesia',
};

/* Dropdown order — English first (the pre-language default), then the rest in
   the order they were added. Derived from TABLES rather than hand-listed so the
   dropdown can never offer a language that has no table behind it. */
const LANGUAGE_ORDER = ['en', 'af', 'de', 'es', 'fr', 'pt', 'ja', 'zh', 'hi', 'id', 'xh', 'zu']
  .filter(code => TABLES[code]);

/* --------------------------- plural categories ---------------------------- */

/* Languages with a SINGLE noun form — a count never changes the wording, so
   every plural entry resolves to `other`. Writing `1 item / 2 items` logic into
   these produces text a native reader finds wrong, not merely clumsy. */
const ONE_FORM = new Set(['zh', 'ja', 'id']);

/* Languages where 0 takes the SINGULAR alongside 1 (French: "0 fichier",
   "1 fichier", "2 fichiers"). English, Afrikaans, German and Spanish all take
   the plural at 0 ("0 files"), so they use the ordinary n === 1 rule. */
/* Portuguese and Hindi join French here on CLDR's own rule for each — `pt`
   is `i = 0..1` and `hi` is `i = 0 or n = 1`, which are both exactly this
   test over the integers a count can be. Their `one` forms are written to
   read correctly at zero rather than assuming the count is one. */
const ZERO_IS_SINGULAR = new Set(['fr', 'pt', 'hi']);

/* Which form of a plural entry a count selects. Kept deliberately small: these
   nine languages need exactly two categories between them, and Intl.PluralRules
   — which would be the general answer — is not something to depend on for
   correctness across the WebKit floor when the rule set is this shallow.

   Twelve languages now, and still exactly two categories between them.

   Indonesian joins Chinese and Japanese in ONE_FORM: a count never changes
   an Indonesian noun, and reduplication (buku-buku) marks plurality on its
   own, never beside a number — "2 buku-buku" is wrong where "2 buku" is
   right.

   isiXhosa and isiZulu take the plain n === 1 rule. Their plurals are a changed
   noun-class prefix rather than a suffix, which the whole-sentence-per-form
   contract already handles — the rule that picks the form is the shallow part,
   and it is the same one English uses. CLDR files isiZulu with French on the
   zero case; this table does not follow it there, because a count of 0 reaches
   these strings almost never (an empty state renders instead) and the `other`
   form reads correctly at 0 in every sentence lang/zu.js carries. */
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
  /* Nguni languages build the day of the month as a possessive concord
     rather than a suffix on the numeral: "umhla we-25", read "the 25th
     day". So the formatter renders the CONCORD AND THE NUMBER, and every
     sentence in lang/xh.js and lang/zu.js that names a day is written to
     sit around it — "ngomhla {day}" reads "ngomhla we-25". Building an
     ordinal word out of the numeral instead (eyesi-2, eyesi-5) would need
     the noun class of whatever the sentence is about, which the formatter
     cannot see from a bare number. */
  xh: n => 'we-' + n,
  zu: n => 'we-' + n,
  /* Portuguese names the first of the month with an ordinal and every other
     day with a cardinal — "no dia 1\u00ba", then "no dia 25" — the same
     shape as French's "le 1er". */
  pt: n => n + (n === 1 ? '\u00ba' : ''),
  /* Hindi and Indonesian both name a day of the month with a bare cardinal:
     "25 \u0924\u093e\u0930\u0940\u0916\u093c", "tanggal 25". The word that makes it a date sits in
     the sentence rather than on the numeral, so the formatter returns the
     number alone and lang/hi.js and lang/id.js are written around it. */
  hi: n => String(n),
  id: n => String(n),
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
  resolveLanguage,
  defaultLanguage,
  pluralCategory,
  day,
  applyDom,
  TABLES,
  LANGUAGE_NAMES,
  LANGUAGE_ORDER,
};
