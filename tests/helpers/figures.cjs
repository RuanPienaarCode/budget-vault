'use strict';
/* The numbers harness: every figure the app puts on screen, harvested.

   The suites in this repo test the arithmetic under a page thoroughly, and a
   green board reads like coverage of what the reader actually sees. It is not.
   The recurring bug shape here is "two figures derived by different rules"
   (eight occurrences and counting — the multi-currency audit found it on
   Savings, Dashboard, Report, Score and both exports at once), and it survives
   precisely because no single artefact lists what is on screen. Each figure has
   a test; the SET of figures has never had one.

   This file produces that set. It mounts the REAL view modules over the REAL
   loader, renders each one, walks the tree the view actually built, and emits
   one line per number that reached the page — addressed, so the line is stable
   across runs, and carrying its raw value alongside its rendered string.

   Deliberately NOT assertions. Harvesting and judging are separate jobs: this
   module answers "what does the app display", and the suites built on it answer
   "is that right". Mixing them would mean a new figure could only be noticed by
   someone who already knew to look for it, which is the gap being closed.

   Two things it insists on, because a ledger that moves on its own is worse
   than none:

     - The clock is pinned. Twenty-three call sites in src/ read `new Date()`
       and several figures are periods, ages or staleness windows measured from
       it. An unpinned harvest re-baselines itself every midnight.
     - The formatter is the REAL one. src/currency.js formatAmount is what the
       reader sees; the existing harness stubs money() with `R ${v.toFixed(2)}`,
       which is fine for a test about arithmetic and wrong for a ledger whose
       whole subject is the printed figure. Both are recorded: `text` is what
       the page says, `raw` is what the code computed.

   Used by tests/figures-census.test.cjs. */

const fs = require('fs');
const path = require('path');
const { makeCtx, loadInto } = require('./harness.cjs');
const { makeDom } = require('./dom-stub.cjs');
const { formatAmount } = require('../../src/currency');

const SRC = path.join(__dirname, '..', '..', 'src');

/* ---- the view list, read from the app ----------------------------------
   Same parse as tests/views-render.test.cjs, and for the same reason: a
   seventeenth view must appear in the ledger by existing, not by someone
   remembering to add it here. Lifted rather than imported because that file is
   a test script, not a module — it runs its suite on require. */
function dispatchedViews() {
  const controller = fs.readFileSync(path.join(SRC, 'controller.js'), 'utf8');
  const start = controller.indexOf('({ dashboard: ctx.renderDashboard');
  if (start < 0) throw new Error('figures: cannot find controller.js view dispatch map — the parse has gone stale');
  const chunk = controller.slice(start, controller.indexOf('}', start));
  const out = [];
  for (const m of chunk.matchAll(/(\w+):\s*ctx\.(render\w+)/g)) out.push({ view: m[1], fn: m[2] });
  if (!out.length) throw new Error('figures: view dispatch map parsed to nothing');
  return out;
}

/* ---- the pinned clock ---------------------------------------------------
   Whole-Date replacement rather than a shim on one module, because the reads
   are spread across sixteen files and several are `new Date()` with no
   argument inside a view. Restored by the returned function; a harvest that
   left the clock pinned would silently change every suite that ran after it in
   the same process. */
function pinClock(iso) {
  const Real = Date;
  const fixed = new Real(`${iso}T12:00:00Z`).getTime();
  function Pinned(...args) {
    if (!(this instanceof Pinned)) return new Real(fixed).toString();
    return args.length ? new Real(...args) : new Real(fixed);
  }
  Pinned.prototype = Real.prototype;
  Pinned.now = () => fixed;
  Pinned.parse = Real.parse;
  Pinned.UTC = Real.UTC;
  global.Date = Pinned;
  return () => { global.Date = Real; };
}

/* ---- one mount, one view ------------------------------------------------
   A fresh ctx per view rather than one shared mount. The shared mount is what
   views-render.test.cjs does and it is right for "does it throw"; it is wrong
   here, because every view writes into the same auto-vivified element map and
   the second view's figures would be harvested on top of the first's. Exact
   attribution is the whole point of an addressed ledger, so each view gets its
   own DOM and pays for one more vault load. */
async function mountFor(files, { period, settings, budgetFolder } = {}) {
  const opts = {};
  if (settings) opts.settings = settings;
  if (budgetFolder) opts.budgetFolder = budgetFolder;
  const ctx = makeCtx(files, opts);
  const S = await loadInto(ctx);
  if (period) S.period = period;

  const { $, nodes } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };

  /* The real formatter, wired the way controller.js wires it: moneyIn takes an
     explicit symbol (an account prints its OWN currency), money defaults to the
     household's. Raw values are recorded on the side so the ledger can carry
     both without parsing the printed string back into a number — which would
     re-derive the figure through a second rule, the exact bug shape this
     harness exists to find. */
  const loc = ctx.locale();
  /* text -> the SET of raw values that formatted to it.

     Keyed by text because that is the only handle the rendered tree gives back:
     a view appends a string, and nothing survives to say which call produced
     it. A single map cell was the first cut and it quietly lied — a compact
     legend formatting 1419.70 at zero decimals prints "R 1 420", and so does
     any other call that happens to format 1420 exactly. Last write won, and the
     ledger reported a raw value that belonged to a different figure on a
     different card.

     A set cannot fix the ambiguity, but it can REFUSE to guess: one candidate
     is reported, several is reported as ambiguous. A harness whose subject is
     "two figures derived by different rules" has no business inventing a third
     rule to attribute them by. */
  const raws = new Map();
  const remember = (text, v) => {
    if (!raws.has(text)) raws.set(text, new Set());
    raws.get(text).add(Number(v));
    return text;
  };
  ctx.moneyIn = (sym, v, dp = 2) => remember(formatAmount(sym, Number(v), dp, loc), v);
  ctx.money = (v, dp = 2) => ctx.moneyIn(S.settings.currency, v, dp);

  const { el } = require('../../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };

  require('../../src/categories')(ctx);
  /* 'report' immediately after 'dashboard': views/report.js destructures
     budgetVsActualRows/categorySpendRows off ctx at register time and both are
     published by dashboard.js's ctx.provide(). Same order controller.js uses,
     load-bearing in both places. */
  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts',
    'savings', 'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../../src/views/${f}`)(ctx);
  }
  return { ctx, S, nodes, raws };
}

/* ---- what counts as a number -------------------------------------------
   Money is recognised by ASKING THE FORMATTER, not by pattern. The first cut
   here guessed at it — "a symbol, then digits" — and a symbol is impossible to
   pin down by shape: it matched the "ast 3" inside "Last 3 months", the "(1"
   inside "(1 year)" and the "ber 2026" inside "September 2026", each reported
   as a currency figure that appears nowhere on the page. Widening the pattern
   loses real symbols; narrowing it invents figures.

   So money is exactly what ctx.money/moneyIn returned, recorded as they were
   called and matched back into the rendered text. That is the same rule the app
   itself used, rather than a second rule that reads its output — and a second
   rule reading the first one's output is the bug shape this whole harness is
   built to catch. Longest-first, so "R 1 234,00" is never shadowed by the
   "R 1" that also formats.

   Percentages next, then anything else numeric — ratios, counts, months, the
   "3 of 7" in a progress caption. ISO dates are struck out first: to a naive
   scan a date is three numbers and none of them is a quantity the reader
   reads. */
const PERCENT = /-?\d[\d  ,.]*\s?%/gu;
const NUMBER = /-?\d[\d  ,.]*\d|-?\d/gu;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
const TRIM = /^[\s,.;:)\]]+|[\s,.;:(\[]+$/gu;

function numbersIn(text, moneyStrings = []) {
  /* Dates are blanked, not deleted: every other offset must stay put, because
     the claimed-span bookkeeping below is what stops one figure being reported
     twice under two kinds. */
  const s = String(text).replace(ISO_DATE, m => ' '.repeat(m.length));
  if (!s.trim()) return [];
  const out = [];
  const claimed = [];
  const free = (from, to) => !claimed.some(c => from < c[1] && to > c[0]);
  const claim = (from, to, kind, raw, ambiguous) => {
    claimed.push([from, to]);
    const text = s.slice(from, to).replace(TRIM, '');
    if (text) out.push({ kind, text, at: from, raw, ambiguous });
  };

  for (const { str, raw, ambiguous } of moneyStrings) {
    let i = s.indexOf(str);
    while (i >= 0) {
      if (free(i, i + str.length)) claim(i, i + str.length, 'money', raw, ambiguous);
      i = s.indexOf(str, i + 1);
    }
  }
  for (const m of [...s.matchAll(PERCENT)]) {
    if (free(m.index, m.index + m[0].length)) claim(m.index, m.index + m[0].length, 'percent', null, false);
  }
  for (const m of [...s.matchAll(NUMBER)]) {
    if (free(m.index, m.index + m[0].length)) claim(m.index, m.index + m[0].length, 'number', null, false);
  }
  return out.sort((a, b) => a.at - b.at)
    .map(({ kind, text, raw, ambiguous }) => ({ kind, text, raw, ambiguous: !!ambiguous }));
}

/* ---- addressing ---------------------------------------------------------
   Phase 1 addressing is content-path: container id, then the chain of
   tag+class down to the leaf, then the leaf's index among its siblings. It
   needs no production change, which is why it comes first — but it moves when
   a row is reordered, and that is the known limit. Figures that earn a stable
   name get a `data-fig` attribute later, and this function prefers one the
   moment it exists. */
function addressOf(node, rootId) {
  const parts = [];
  for (let n = node; n && n._parent; n = n._parent) {
    if (n.attrs && n.attrs['data-fig']) { parts.unshift(`@${n.attrs['data-fig']}`); break; }
    const tag = n.tagName.toLowerCase();
    const cls = [...n._cls][0];
    const sibs = n._parent.children.filter(c => c.nodeType === 1 && c.tagName === n.tagName);
    const idx = sibs.indexOf(n);
    parts.unshift(cls ? `${tag}.${cls}${sibs.length > 1 ? `[${idx}]` : ''}`
      : `${tag}${sibs.length > 1 ? `[${idx}]` : ''}`);
  }
  return `${rootId}/${parts.join('/')}`;
}

/* Leaves only. An ancestor's textContent concatenates every descendant's, so
   harvesting non-leaves would report each figure once per level of nesting and
   invent numbers that appear nowhere ("R 12" + "340,00" read as one string). */
function leaves(el, out = []) {
  const kids = el.children.filter(c => c.nodeType === 1);
  const elementKids = kids.filter(c => c.tagName !== '#TEXT');
  if (!elementKids.length) { out.push(el); return out; }
  if (el._text && el._text.trim()) out.push(el);   // an element with its own text AND children
  for (const c of elementKids) leaves(c, out);
  return out;
}

/* ---- the harvest --------------------------------------------------------
   Renders one view and returns every figure it put on screen. A view that
   throws returns its error rather than propagating: a ledger that stops at the
   first broken page cannot tell you which OTHER pages are broken, and that is
   the question worth asking after a change. */
function harvestView(ctx, nodes, raws, { view, fn }) {
  if (typeof ctx[fn] !== 'function') return { view, error: `ctx.${fn} is not registered`, figures: [] };
  const before = new Set(nodes.keys());
  try { ctx[fn](); } catch (e) { return { view, error: e.message, figures: [] }; }

  /* Longest first so a shorter formatting of the same figure never shadows a
     longer one that contains it. */
  const moneyStrings = [...raws.entries()]
    .map(([str, set]) => ({ str, raw: set.size === 1 ? [...set][0] : null, ambiguous: set.size > 1 }))
    .sort((a, b) => b.str.length - a.str.length);

  const figures = [];
  for (const [sel, root] of nodes) {
    // Containers the shell owns and every view shares are attributed to the
    // view that wrote them, which is why the map is snapshotted per view.
    void before;
    const rootId = sel.replace(/^#/, '');
    for (const leaf of leaves(root)) {
      const text = (leaf._text || '') + leaf.children.filter(c => c.tagName === '#TEXT').map(c => c._text).join('');
      for (const num of numbersIn(text, moneyStrings)) {
        figures.push({ view, address: addressOf(leaf, rootId), kind: num.kind,
          text: num.text, raw: num.raw, ambiguous: !!num.ambiguous });
      }
    }
  }
  return { view, error: null, figures };
}

/* Every view, each on its own mount. */
async function harvestAll(files, { period = '2026-09', today = '2026-09-02', settings, budgetFolder } = {}) {
  const unpin = pinClock(today);
  try {
    const views = dispatchedViews();
    const results = [];
    for (const v of views) {
      const { ctx, nodes, raws } = await mountFor(files, { period, settings, budgetFolder });
      results.push(harvestView(ctx, nodes, raws, v));
    }
    return results;
  } finally { unpin(); }
}

module.exports = { dispatchedViews, pinClock, mountFor, harvestView, harvestAll, numbersIn, addressOf, leaves };
