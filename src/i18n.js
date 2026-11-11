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

/* The tables that actually ship, each behind the function that loads it.
   Adding a language is: write src/lang/xx.js, add its loader here, add its name
   below. tests/i18n.test.cjs fails the build if a table is missing keys English
   has, or carries keys English doesn't.

   LOADED ON FIRST READ, NOT AT PLUGIN LOAD. Until November 2026 this file
   required all twelve at the top, and every reader paid for eleven languages
   they would never see: measured on the 1.59.0 bundle the tables were 1.77 MB
   of its 2.63 MB, and requiring the bundle kept 8.9 MB of heap where 6.0 MB
   does. Nothing about the bundler had to change to stop that — esbuild wraps
   each CommonJS module in a function that runs on its first require(), so a
   require() that is only reached from inside a function costs nothing until it
   is called. That is all each entry below is.

   Each path is spelled out as a string literal on purpose. esbuild can only
   bundle a require() whose argument it can read; `require('./lang/' + code)`
   would be left in the bundle as a runtime call to a file that does not exist
   beside main.js. tests/i18n-lazy-tables.test.cjs pins both halves: every file
   in src/lang/ has its loader here, and no table is evaluated by loading the
   plugin. */
const LOADERS = {
  en: () => require('./lang/en'),
  af: () => require('./lang/af'),
  de: () => require('./lang/de'),
  es: () => require('./lang/es'),
  fr: () => require('./lang/fr'),
  ja: () => require('./lang/ja'),
  zh: () => require('./lang/zh'),
  xh: () => require('./lang/xh'),
  zu: () => require('./lang/zu'),
  pt: () => require('./lang/pt'),
  hi: () => require('./lang/hi'),
  id: () => require('./lang/id'),
};

/* "Does this language ship" — answered from the loader list, WITHOUT loading
   the table. Everything that only needs to know whether a code is real asks
   this (the dropdown order, resolveLanguage, defaultLanguage); asking the table
   itself would pull all twelve in at module load and undo the point of the
   list above.

   An own-property test rather than `LOADERS[code]`: the code can come from a
   hand-edited Settings.md, and plain indexing calls `constructor` and
   `toString` languages, because every object inherits them. (Not
   Object.hasOwn — that is Safari 15.4, above the iOS 15.0 floor.) */
const ships = code => Object.prototype.hasOwnProperty.call(LOADERS, code);

/* code -> its table, or null for one that could not be loaded. Filled on the
   first read of each language and never emptied. */
const loaded = Object.create(null);

/* The one place a table is loaded.

   A table that cannot be loaded is remembered as null and reads as "no such
   key" for every key, which is the case t() already handles: the lookup falls
   through to English, and to the key itself if English is the one that failed.
   So a broken table degrades to an English interface instead of a view that
   throws on its first string — the same contract a half-translated table has
   always had, extended to a table that is entirely missing.

   Remembered rather than retried: a render makes hundreds of lookups, and a
   require() that threw once will throw the same way every time. Reported once
   on the console for the same reason it must be reported at all — an interface
   that quietly turned English with no trace is a bug report nobody can act on.
   The app argues rather than hides, even about itself. */
function tableFor(code) {
  if (code in loaded) return loaded[code];
  if (!ships(code)) return undefined;
  let table = null;
  let why = 'it did not export a table';
  try {
    const mod = LOADERS[code]();
    if (mod && typeof mod === 'object') table = mod;
  } catch (e) {
    why = (e && e.message) || String(e);
  }
  if (!table) {
    try {
      console.error(`Budget Vault: the "${code}" language table could not be loaded — `
        + `showing English instead. (${why})`);
    } catch (e) { /* no console — nothing else can be done about it */ }
  }
  loaded[code] = table;
  return table;
}

/* The public face of the tables, kept exactly as it was when they were loaded
   eagerly: one enumerable key per shipped language, whose value is the table
   itself — the same object t() reads, so a key a test writes through
   TABLES.en is a key t() then finds. Each value is a getter, so listing the
   languages (Object.keys, `in`) loads nothing and reading one loads only that
   one. A table that could not be loaded reads as undefined, never as an empty
   object: "absent" is what it is. */
const TABLES = {};
for (const code of Object.keys(LOADERS)) {
  Object.defineProperty(TABLES, code, { enumerable: true, get: () => tableFor(code) || undefined });
}

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

/* The BCP 47 tag each table is written in — what goes in a `lang` attribute.

   The interface language is this plugin's own setting, not Obsidian's, so the
   two disagree as a matter of course: an English Obsidian with the budget in
   isiZulu, a German one with it in Afrikaans. A screen reader picks its voice
   from the nearest `lang` up the tree, and until November 2026 the nearest one
   was Obsidian's own, on <html> — so a French interface was read out by the
   host's English voice, mispronounced end to end (audit of 11 Nov 2026,
   task 19). The same attribute is what WebKit picks hyphenation rules, quote
   marks and — for Chinese against Japanese, which share code points — the
   glyphs themselves from.

   Eleven of the twelve are the bare language subtag — the table's own code —
   and deliberately no narrower. A region subtag would pick the reader's voice
   for them: pt.js leans Brazilian where the two standards part but is written
   to be read in Portugal too (its own header says why), and es.js names no
   country at all, so `pt` and `es` leave the choice to the Portuguese or
   Spanish voice the reader's own device already has. Chinese is the exception,
   because the SCRIPT is not implied by the language: zh.js is Simplified, and
   a bare `zh` leaves an engine to guess between Simplified and Traditional.

   No `dir` anywhere, deliberately: every one of these is written left to
   right, which is the document's default. A right-to-left table (Arabic,
   Hebrew, Urdu) would need `dir="rtl"` set beside `lang` in followLanguage()
   below — and a pass over the stylesheet's physical left/right properties,
   which is the larger half of that job. tests/i18n-lang-attribute.test.cjs
   fails if a table ships without a tag here. */
const LANGUAGE_TAGS = {
  en: 'en',
  af: 'af',
  de: 'de',
  es: 'es',
  fr: 'fr',
  ja: 'ja',
  zh: 'zh-Hans',
  xh: 'xh',
  zu: 'zu',
  pt: 'pt',
  hi: 'hi',
  id: 'id',
};

/* Dropdown order — English first (the pre-language default), then the rest in
   the order they were added. Filtered against the loader list rather than
   trusted as hand-listed, so the dropdown can never offer a language that has
   no table behind it. */
const LANGUAGE_ORDER = ['en', 'af', 'de', 'es', 'fr', 'pt', 'ja', 'zh', 'hi', 'id', 'xh', 'zu']
  .filter(ships);

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
   twelve languages need exactly two categories between them, and
   Intl.PluralRules — which would be the general answer — is not something to
   depend on for correctness across the WebKit floor when the rule set is this
   shallow.

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
  return ships(id) ? id : 'en';
}

function setLanguage(code) {
  current = resolveLanguage(code);
  restampLanguage();
  return current;
}

/* ------------------------------ the lang attribute ------------------------- */

/* The tag for a language code — the active one when none is given. Falls back
   to the code itself, which for every shipped table IS a valid BCP 47 primary
   subtag, so a table added without an entry above still gets a usable tag
   while the guard test reports the missing one. */
function languageTag(code) {
  const id = code === undefined ? current : resolveLanguage(code);
  return Object.prototype.hasOwnProperty.call(LANGUAGE_TAGS, id) ? LANGUAGE_TAGS[id] : id;
}

/* The elements whose `lang` follows the interface language: the plugin root,
   and every surface Obsidian mounts OUTSIDE it — a modal, the setup wizard,
   the settings tab — which inherit Obsidian's `lang` from <html>, not ours.

   Kept here rather than re-stamped by each caller, because the language moves
   from four places (load.js on every read of Settings.md, the settings tab's
   dropdown and its file watcher, the wizard's picker) and a root that is only
   stamped where someone remembered to would be right at mount and wrong after
   the first book switch. Everything that changes the language already goes
   through setLanguage(); so that is the one place the attribute is written
   again, and no caller can forget.

   A Set of elements, so following the same one twice is harmless — the
   settings tab's display() runs again on every re-open. */
const following = new Set();

function stampLanguage(node) {
  try { node.setAttribute('lang', languageTag()); } catch (e) { /* not an element — nothing to stamp */ }
}

/* setLanguage()'s other half. An element that has left the document is
   dropped rather than stamped: a closed modal is never told it closed (every
   dialog would need an onClose for it), and without this the set would keep
   every dialog ever opened alive. `isConnected === false` exactly — the
   bare-node fakes the guard tests use have no such property, and are kept. */
function restampLanguage() {
  for (const node of following) {
    if (node.isConnected === false) following.delete(node);
    else stampLanguage(node);
  }
}

/* Give `node` the active language's `lang` now, and keep it right from here
   on. A missing node is ignored, so a caller can pass `this.modalEl` without
   first asking whether the host (or a test's stub of it) built one. */
function followLanguage(node) {
  if (!node || typeof node.setAttribute !== 'function') return;
  /* The same sweep restampLanguage() makes, here as well: the language can go
     a whole session without changing, and every confirm and every field
     dialog opened in that time would otherwise be held — its DOM and the
     closures under it — until it did. Opening the next dialog lets go of the
     ones already closed. */
  for (const other of following) if (other.isConnected === false) following.delete(other);
  following.add(node);
  stampLanguage(node);
}

/* The undo, for an element that outlives its use: the view's contentEl is
   Obsidian's and is handed to whatever view opens in that leaf next, which
   must not inherit this plugin's language. */
function unfollowLanguage(node) {
  if (!node) return;
  following.delete(node);
  try { node.removeAttribute('lang'); } catch (e) { /* not an element */ }
}

/* Obsidian's own display language, for a vault that has never set `language`.
   Obsidian keeps it in localStorage under `language` (absent or empty for
   English). Both reads are guarded: localStorage throws in restricted contexts,
   and neither `window` nor `navigator` exists in the bare-node guard tests. */
function defaultLanguage() {
  const base = v => (v || '').toString().trim().toLowerCase().split(/[-_]/)[0];
  try {
    const obsidian = base(window.localStorage.getItem('language'));
    if (ships(obsidian)) return obsidian;
  } catch (e) { /* no window, or localStorage unavailable */ }
  try {
    const nav = base(navigator.language);
    if (ships(nav)) return nav;
  } catch (e) { /* no navigator */ }
  return 'en';
}

/* ------------------------------- translation ------------------------------- */

/* `{name}` only — no lookbehind, no nested braces. An unknown placeholder is
   left standing verbatim rather than rendered as "undefined", so a missing
   param shows up as an obvious `{count}` in the interface instead of quietly
   producing a sentence that reads as if a real value were zero. */
const PLACEHOLDER = /\{(\w+)\}/g;

/* A figure inside a sentence must not break across lines (audit of
   20 Oct 2026). The za locale groups thousands with U+0020 and money puts a
   U+0020 after the symbol, so every gap inside "R 12 345" is an ordinary
   breaking space. On a real vault a signed figure in brackets wrapped as
   "(−R 12" on one line and "345)" on the next (figures here made up), and on
   a phone "R 48" / "000,00" — and read across the break, "R 12" is a
   different number, not an untidy one. So a param VALUE that is, as a whole,
   a figure has those spaces swapped for U+00A0 before it goes into the
   sentence. Done here, once, because every translated sentence passes through
   this function and no view has to remember it.

   "As a whole" is the load-bearing part. The shape is anchored at both ends,
   so a value that merely CONTAINS a figure — "R 1 200 of R 3 000", "R 1 200/mo"
   — is left alone, as is anything that is not a figure at all: a category
   name, "3 accounts", a date. Three shapes count:

     money    an optional sign, a symbol, a space, an optional sign, a number:
              "R 12 345", "−R 12 345" (formatSigned), "R -50,00" (formatAmount),
              "+R 3 922", "€ 640,00", "USD 1 200,00" (a conflicted account is
              labelled by its code — currency.js symbolOf)
     percent  an optional sign, a number, an optional space, "%": "12 %"
     number   an optional sign and a grouped number: "12 345"

   The symbol is the hard part, and the same problem tests/helpers/figures.cjs
   names in its own header: a symbol cannot be pinned down by shape alone. What
   it may be here is a currency sign with up to three letters before it ("€",
   "$", "US$", "R$"), three CAPITALS (an ISO code), or one or two letters with
   an optional full stop ("R", "Rp", "kr", "Rs."). That rules out "Oct 21" and
   "Mai 21" — a month is three letters in title case, which is neither — at the
   cost of a household that types a three-letter, lower-case symbol keeping its
   breaking space. That cost is a figure that can still wrap, which is the
   state every figure was in before this; the opposite mistake would glue words
   the reader expects to wrap. (A param that is a two-letter word and a number,
   "in 2026", reads as a figure too and keeps its two words on one line —
   harmless, and no view passes one today.)

   The gaps it accepts are U+0020, U+00A0 and U+202F, so a value that is
   already partly glued (or came out of Intl.NumberFormat, whose fr-FR output
   uses U+202F) still reads as a figure — and only U+0020 is replaced, so the
   swap is idempotent. Unicode property escapes need the `u` flag, which the
   iOS 15 WebKit floor has had since Safari 11.1 (src/amount.js already relies
   on \p{Sc}). No lookbehind: anchored alternation does the whole job.

   Anything that reads printed prose back — the figures ledger, the
   reconciliation, a guard test matching a sentence — must map U+00A0 to a
   space first. tests/helpers/dom-stub.cjs `readable` is the one spelling of
   that mapping: the stub's textContent, the figures harvest and the Report
   read-back all go through it. src/pdf.js normalizeText already does the same
   before its WinAnsi check, so an export stays vector text. */
const FIG_GAP = '[ \\u00a0\\u202f]';
const FIG_SIGN = '[+\\-\\u2212]?';
const FIG_NUM = '\\d+(?:[ \\u00a0\\u202f.,]\\d{3})*(?:[.,]\\d+)?';
const FIG_SYMBOL = '(?:\\p{L}{0,3}\\p{Sc}|\\p{Lu}{3}|\\p{L}{1,2}\\.?)';
const WHOLE_FIGURE = new RegExp(
  `^(?:${FIG_SIGN}${FIG_SYMBOL}${FIG_GAP}${FIG_SIGN}${FIG_NUM}`   // money
  + `|${FIG_SIGN}${FIG_NUM}${FIG_GAP}?%`                           // percent
  + `|${FIG_SIGN}${FIG_NUM})$`, 'u');                               // grouped number

/* The param as interpolate prints it: String(v), with its spaces made
   unbreakable when the whole of it is a figure. Exported for the guard test. */
function nbspFigure(v) {
  const s = String(v);
  return s.indexOf(' ') >= 0 && WHOLE_FIGURE.test(s) ? s.replace(/ /g, '\u00a0') : s;
}

function interpolate(s, params) {
  if (!params || typeof s !== 'string') return s;
  return s.replace(PLACEHOLDER, (whole, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? nbspFigure(params[name]) : whole);
}

/* One key, resolved against one table. Plural entries are objects keyed by
   category; a table that gives only `other` (Chinese, Japanese) still answers a
   `one` lookup, because pluralCategory never asks those languages for `one`. */
function lookup(lang, key, count) {
  const table = tableFor(lang);
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
   t('acct.badge.asOf', { date: '2026-08-07' }) // {date} interpolated

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
  languageTag,
  followLanguage,
  unfollowLanguage,
  interpolate,
  nbspFigure,
  TABLES,
  LANGUAGE_NAMES,
  LANGUAGE_TAGS,
  LANGUAGE_ORDER,
};
