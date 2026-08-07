'use strict';
/* DOM construction helpers. The ONLY module under src/ that imports obsidian.

   That is the point of the split: everything else this app does — reading
   markdown, parsing a statement, matching a rule, the money and date maths —
   is now requirable in bare node, so it can be tested without a stub and
   reasoned about without a browser. Anything that touches document or an
   obsidian API belongs here; nothing here may hold app logic.

   Browser/Obsidian APIs only — must stay mobile-safe (no Node imports in this
   file or anywhere under src/), and the engine floor is iOS 15 / WebKit, which
   is why setInert exists at the bottom rather than a bare `inert` attribute. */

const { setIcon } = require('obsidian');
// For dateInput's shape check. The calendar-date helpers live in the pure
// src/dates.js so the maths modules can share them without inheriting the
// obsidian import above.
const { ISO_DATE } = require('./dates');

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) n.append(kid?.nodeType ? kid : document.createTextNode(kid ?? ''));
  return n;
};

/* A date field, built to behave on a phone: a native <input type="date"> gives
   the picker and no soft keyboard, so iOS autocorrect/autofill never gets a
   chance to interfere with a YYYY-MM-DD value. Only used when the stored value
   is empty or already a real ISO date though — these files are hand-editable,
   and a date input renders free text ("end of October") as blank and would
   silently discard it on the first edit. Those fall back to a text field with
   the correction features switched off. `commit` receives (value, event). */
function dateInput(value, attrs, commit) {
  const v = (value ?? '').toString().trim();
  const picker = v === '' || ISO_DATE.test(v);
  return el('input', {
    type: picker ? 'date' : 'text',
    value: v,
    ...(picker ? {} : {
      placeholder: 'YYYY-MM-DD', inputmode: 'numeric',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    }),
    ...attrs,
    onchange: e => commit(e.target.value.trim(), e),
  });
}

/* Rebuilding a table's innerHTML resets its scroll container to the left edge.
   On a phone every table here is wider than the screen, so that yanks the
   columns out from under the reader. Call around a rebuild to hold position. */
function keepScroll(elm, rebuild) {
  const box = elm.parentElement;
  const left = box ? box.scrollLeft : 0;
  rebuild();
  if (box) box.scrollLeft = left;
}

/* Lucide icons: try each name until one renders (icon names occasionally get
   renamed between the lucide versions Obsidian ships). */
function setIco(elm, names) {
  for (const n of Array.isArray(names) ? names : [names]) {
    try { setIcon(elm, n); } catch (e) { /* unknown icon name */ }
    if (elm.firstElementChild) return;
  }
}
function icoEl(names, cls) {
  const s = document.createElement('span');
  s.className = 'ico' + (cls ? ' ' + cls : '');
  // Decorative: every icon here sits next to its own text label, and a future
  // lucide version adding default <title>s would otherwise double-announce it.
  s.setAttribute('aria-hidden', 'true');
  setIco(s, names);
  return s;
}

/* The KPI strip every page opens with: a row of `.mini` tiles, each a label,
   a number, and optionally a line of context under it.

   Empties the container and hands back the tile builder, because those two
   steps were always written together — six views each carried their own copy
   of this, three of them identical and three the same thing with the `sub`
   argument left off. A tile that renders differently on one page than another
   is the kind of drift nobody files a bug about; they just stop trusting that
   two numbers styled alike mean comparable things.

   `cls` styles the VALUE (text-success, text-danger, text-warning, grad-txt),
   not the tile. */
function kpiTiles(container) {
  container.empty();
  return (label, value, cls, sub) => {
    const t = el('div', { class: 'mini' },
      el('div', { class: 'l' }, label),
      el('div', { class: `v num ${cls || ''}` }, value));
    if (sub) t.append(el('div', { class: 's' }, sub));
    container.append(t);
    return t;
  };
}

/* ---- inert, with a floor-safe fallback --------------------------------
   `inert` is the whole mechanism behind two features: the closed drawer
   leaving the tab order, and the privacy gate making the covered app
   unreachable. It is Safari 15.5+, and this plugin's floor is iOS 15.0 — on
   15.0-15.4 the attribute parses and does NOTHING, so Tab walks straight
   into the balances behind a gate whose entire purpose is that it can't.

   Same discipline as the @supports fallbacks in styles.css: feature-detect,
   and on the old engines reproduce the behaviour by hand — tabindex="-1" on
   every focusable descendant (remembering what was there so it can be put
   back) plus aria-hidden for the screen-reader half. */
const INERT_SUPPORTED = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;
const FOCUSABLE_SEL = 'a[href],button,input,select,textarea,summary,[tabindex]';
function setInert(elm, on) {
  if (!elm) return;
  if (on) elm.setAttribute('inert', ''); else elm.removeAttribute('inert');
  if (INERT_SUPPORTED) return;
  if (on) {
    elm.setAttribute('aria-hidden', 'true');
    for (const f of elm.querySelectorAll(FOCUSABLE_SEL)) {
      // Store the previous tabindex ('' meaning "had none") so a nested call
      // or a re-lock can't overwrite the original with the -1 it just set.
      if (!f.hasAttribute('data-bud-ti')) f.setAttribute('data-bud-ti', f.getAttribute('tabindex') ?? '');
      f.setAttribute('tabindex', '-1');
    }
    // Real `inert` blurs whatever it swallows; tabindex="-1" does not, so an
    // already-focused field would stay focused (and typable) behind the gate.
    if (elm.contains(document.activeElement) && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  } else {
    elm.removeAttribute('aria-hidden');
    for (const f of elm.querySelectorAll('[data-bud-ti]')) {
      const prev = f.getAttribute('data-bud-ti');
      if (prev === '') f.removeAttribute('tabindex'); else f.setAttribute('tabindex', prev);
      f.removeAttribute('data-bud-ti');
    }
  }
}

module.exports = { el, dateInput, keepScroll, setIco, icoEl, kpiTiles, setInert };
