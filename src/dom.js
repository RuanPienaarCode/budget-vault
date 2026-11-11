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

/* Table semantics and column names that survive the phone layout. Under 600px
   the Transactions and Budget tables stack each row into a card (styles.css,
   "stacked rows"): a grid <tr> is no longer a row to VoiceOver, and the card
   prints each cell's `data-label` where the column header used to be. So stamp
   the ARIA roles explicitly, and give every body cell its column's name.
   `labels` is by column position; a falsy entry (the actions column) and any
   spanning cell (group bars, empty state, "show more") get no label.

   "Column position" is counted in COLUMNS, not in child nodes: a cell with a
   colspan advances the count by its span. Until the Services and Tax tables
   came here every spanning row was a lone cell, so the two readings agreed;
   Services' group bar is a colspan-6 name followed by a subtotal in the LAST
   column, and Tax's figure totals skip two, and by child index those cells
   were labelled "Provider" and "Source". */
function tableCells(table, labels) {
  table.setAttribute('role', 'table');
  for (const group of Array.from(table.children)) {
    group.setAttribute('role', 'rowgroup');
    const head = group.tagName === 'THEAD';
    for (const tr of Array.from(group.children)) {
      tr.setAttribute('role', 'row');
      let col = 0;
      Array.from(tr.children).forEach(cell => {
        cell.setAttribute('role', head ? 'columnheader' : 'cell');
        const span = Number(cell.colSpan) || 1;   // the reflected attribute; 1 when absent
        if (!head && labels[col] && !cell.hasAttribute('colspan')) cell.setAttribute('data-label', labels[col]);
        col += span;
      });
    }
  }
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

/* Put focus back after a rebuild took it away.

   Nearly every page here redraws by emptying a container and building it
   again. A control that lived INSIDE that container and asked for the redraw
   — a row's delete, a status pill, "Show more", a range pill — is destroyed
   with the rest, and the browser parks focus on <body>. A keyboard reader is
   then at the top of the page after every press; a screen reader hears
   nothing. Four views had each written their own restore (tax, debts, owed,
   assets, all by position in a querySelectorAll list) and the other handlers
   had none: Transactions' "Show more", every row delete, the chart range
   pills (audit of 11 Nov 2026, task 16).

   The contract is one attribute. A control worth finding again carries
   `data-focus-key`, and the handler that rebuilt its container says where the
   reader should be:

     renderOwed(); refocus(table, [`del:${i}`, `del:${i - 1}`, addButton]);

   `keys` is one key or a list, first match wins — which is how "the row that
   took this one's place, else the one above, else the Add button" is said in
   one call. An entry may be an element, for a landing outside the rebuilt
   root. A candidate that cannot take focus (disabled, or inside a hidden bar)
   is passed over rather than counted as a landing, which is why the loop
   checks where focus actually went.

   It only ever RESTORES. If focus is on a live control when this runs — the
   control survived, or the reader moved to the search box while a save was in
   flight — it is left exactly there: taking it would be a second defect. So
   it is safe to call after any rebuild, including one that turned out to
   destroy nothing.

   "Live" means still on the page AND still displayed. A control removed from
   the page stops being the active element at once; one that is merely HIDDEN
   (its card gained `hidden`) stays document.activeElement until the browser's
   next frame, and only then is focus dropped to <body>. Asking at this moment
   would find it "focused", decline, and lose focus a frame later — so a
   focused control with no box counts as lost here.

   Deliberately not conditional on focus having been inside `root` beforehand.
   A tap on iOS does not focus the button it lands on, so "was focus in here?"
   answers no for a VoiceOver user who has just activated that very control —
   and they are the reader a rebuild strands most completely. The four
   hand-written restores this replaces focused unconditionally for the same
   reason. The cost is a focus ring after a tap on the engines that have no
   :focus-visible, which those four already paid.

   Keys are matched as an attribute value, so the two characters that could
   end the quoted string early are escaped; a key built from a file path (the
   Notes page) is safe to pass as it is. */
const NATIVE_FOCUS = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/i;
function refocus(root, keys) {
  if (!root || typeof root.querySelector !== 'function') return null;
  const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;
  const live = doc.activeElement;
  const displayed = typeof (live && live.getClientRects) !== 'function' || live.getClientRects().length > 0;
  if (live && live !== doc.body && live !== doc.documentElement && displayed) return null;
  for (const k of [].concat(keys)) {
    if (k === null || k === undefined || k === '') continue;
    const hit = typeof k === 'string'
      ? root.querySelector(`[data-focus-key="${k.replace(/["\\]/g, '\\$&')}"]`)
      : k;
    if (!hit || typeof hit.focus !== 'function' || hit.disabled) continue;
    /* A landing that is not a control — a table row, for "Show more" — is made
       focusable here, at the moment it is needed, and not where it is built.
       tabindex="-1" on every row of every table would make each one
       click-focusable for good, and on the engines without :focus-visible
       that is a focus ring on any row a reader happens to tap. */
    if (!NATIVE_FOCUS.test(hit.tagName || '') && typeof hit.hasAttribute === 'function' && !hit.hasAttribute('tabindex')) {
      hit.setAttribute('tabindex', '-1');
    }
    hit.focus();
    if (doc.activeElement === hit) return hit;
  }
  return null;
}

/* Lucide icons: try each name until one renders (icon names occasionally get
   renamed between the lucide versions Obsidian ships).

   Accepts an array of names OR the shell's data-ico form, 'a|b|c' — a
   fallback chain written as one string. Splitting here, not at the call
   sites: icoEl('crown|award|medal') once reached Obsidian's setIcon as a
   single name containing two pipes, which it silently no-ops on, so the
   Score page's full-marks badge shipped blank on every device. Any caller
   may write the chain the way the shell already does and get the walk. */
function setIco(elm, names) {
  const list = Array.isArray(names) ? names : String(names).split('|');
  for (const n of list) {
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

/* A caveat that reads on a phone, not just under a mouse.

   `title=` is a hover tooltip — invisible on iOS/Android, which have no
   hover — so a caveat that only lived in a `title` attribute (the "Interest
   still to pay" column header, the Savings page's account-file-not-
   transactions note, an Accounts drawer reconciliation line) disappeared
   entirely on the platform this plugin ships to as a first-class target, not
   a fallback one. This renders the short version as a real, focusable
   `<button>` that reveals an inline detail line on tap, with `aria-expanded`
   so a screen reader knows which state it is in. `title` is kept too — a
   free desktop-hover bonus that costs nothing and some readers still reach
   for — but it is never the ONLY way to reach the sentence again.

   No CSS transition on the reveal: the detail line is either there or it
   isn't, so there is nothing here that needs a prefers-reduced-motion guard.

   The 44pt touch target is not this function's job to build: the blanket
   `button:not(.mod-loading)::after` overlay rule in styles.css (under
   `@media (pointer: coarse)`) already grows every plain `<button>` on a
   coarse pointer, for free, via `:where(button:not(.mod-loading))` — which
   carries zero specificity, so a caller that needs to position ITS OWN
   button (the way the score ring centres its own) keeps that positioning
   without a fight.

   `cls` dresses the button as something the page already has. A FLAG — the
   "not seen" on a service, the "transfer?" on an import row — was a
   `.category-badge` <span> with its reason in a `title`, and its colour is
   part of what it says: a price above the listed one is the debt colour,
   below it the savings one. Making those the chip's own outlined pill would
   have thrown that away, so the chip takes the badge's classes instead of its
   own. A badge on a <button> is already styled (the Notes page's "unmatched"
   has been one since it was written), and `badge-chip` adds the two things a
   span never needed: a pointer cursor and a focus ring.

   Returns the wrapping `<span>`; append it wherever a bare `title=` used to
   sit — the whole point is that nothing else about the call site changes. */
function caveatChip(shortText, detailText, cls = 'caveat-chip-btn') {
  const btn = el('button', {
    type: 'button', class: cls, title: detailText, 'aria-expanded': 'false',
  }, shortText);
  const detail = el('div', { class: 'caveat-chip-detail hidden' }, detailText);
  btn.addEventListener('click', e => {
    /* The tap is the chip's, never the row's around it. On the Accounts page
       the "ignored" chip sits inside a table row whose own click opens the
       row's drawer: the click bubbled, the drawer opened, the re-render threw
       the just-expanded chip away, and the reason never showed — the one
       thing this component exists to make reachable by tap (audit of
       7 Oct 2026). Guarded, because a caller may fire the handler bare. */
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
    detail.classList.toggle('hidden', open);
  });
  /* The two keys that press a button are the chip's too. A native <button>
     turns Enter and Space into a click, stopped above; the keydown itself
     still bubbles, and an ancestor acting on Enter without checking its own
     target would act on it as well. Every other key passes, so Escape and Tab
     still reach the page. */
  btn.addEventListener('keydown', e => {
    if (e && (e.key === 'Enter' || e.key === ' ') && typeof e.stopPropagation === 'function') e.stopPropagation();
  });
  return el('span', { class: 'caveat-chip' }, btn, detail);
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

/* The size step for a statement figure that will not fit its column: seven or
   more digits steps down one size (the `.is-long` rule in statement/*.css)
   rather than overflowing the card. Counts DIGITS, so the symbol, the grouping
   and a decimal comma do not move the threshold, and a figure printed to cents
   steps down sooner than the same figure in whole rand, which is the point.

   One helper, here, because it was two copies (views/dashboard.js and
   views/budgets.js) that each said they were the same rule as the other, and
   only one of them was pinned by a test: a mutation of the Dashboard's copy
   survived the whole suite (2026-10-14 audit, L8-06). Returns the class WITH
   its leading space, so a caller appends it straight onto a class string. */
const longFig = text => ((String(text).match(/\d/g) || []).length >= 7 ? ' is-long' : '');

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

module.exports = { el, dateInput, keepScroll, refocus, setIco, icoEl, caveatChip, kpiTiles, setInert, tableCells, longFig };
