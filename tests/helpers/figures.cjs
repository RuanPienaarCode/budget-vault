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
const { makeDom, readable } = require('./dom-stub.cjs');

/* ---- the money recorder -------------------------------------------------
   Wrapped at src/currency.js's formatAmount, NOT at ctx.money, because
   ctx.money is only one of its two callers. locale.js's fmtAmt calls
   formatAmount directly — that is how the Tax page prints the R23 800 interest
   exemption — so a recorder installed on the ctx wrapper saw none of it, and
   eight of the Tax page's figures landed in the ledger as bare numbers with no
   raw value. A ledger that reports a currency figure as a plain number is
   wrong in the one column it exists to be right about.

   The src cache is purged first so that every module destructuring
   `formatAmount` at require time picks up the wrapper rather than the original
   it captured on a previous mount. That also gives each view a clean module
   state, which is closer to what the app does than sixteen views sharing one. */
function installMoneyRecorder() {
  const srcDir = path.join(__dirname, '..', '..', 'src') + path.sep;
  for (const k of Object.keys(require.cache)) if (k.startsWith(srcDir)) delete require.cache[k];
  const currency = require('../../src/currency');
  const real = currency.formatAmount;
  const seen = new Map();
  currency.formatAmount = (symbol, v, decimals, loc) => {
    const text = real(symbol, v, decimals, loc);
    if (!seen.has(text)) seen.set(text, new Set());
    seen.get(text).add(Number(v));
    return text;
  };
  return { seen, currency, restore: () => { currency.formatAmount = real; } };
}

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
   the same process.

   ISSUE 90 (Third). Pinning the EPOCH instant is not pinning the DAY: `iso` was
   fixed to `${iso}T12:00:00Z`, and every consumer here reads it back through
   LOCAL getters (isoOf, todayIso — this codebase's own rule is local-calendar
   dates throughout, ADR-0007). Noon UTC is a different LOCAL calendar day on
   any host east of UTC+12 — at UTC+14 (Pacific/Kiritimati, a real IANA zone,
   not a corner case) "2026-09-02T12:00:00Z" reads back as 3 September. Eight
   figures in the golden ledger are downstream of exactly that local `today`,
   so the ledger a contributor blessed was quietly a different fixture from
   the one CI (or a teammate on another zone) verified.

   Fixed at the root rather than by hunting the 12:00 offset for a "safe"
   hour — there is no hour of the day that survives every zone from UTC-12 to
   UTC+14, a 26-hour spread. What DOES survive is not asking the local
   timezone to agree with the intent at all: process.env.TZ is read by V8's
   Date getters on every call, not cached at construction (verified — flipping
   it after building a Date changes what that same object's getters report),
   so pinning it to UTC for exactly the window the clock is pinned makes
   "local calendar day" and "UTC calendar day" the same question, on every
   host. Restored alongside global.Date so a harvest run under a real TZ for
   some OTHER reason is not left silently on UTC afterwards. */
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
  const hadTZ = 'TZ' in process.env, realTZ = process.env.TZ;
  process.env.TZ = 'UTC';
  return () => {
    global.Date = Real;
    if (hadTZ) process.env.TZ = realTZ; else delete process.env.TZ;
  };
}

/* ---- one mount, one view ------------------------------------------------
   A fresh ctx per view rather than one shared mount. The shared mount is what
   views-render.test.cjs does and it is right for "does it throw"; it is wrong
   here, because every view writes into the same auto-vivified element map and
   the second view's figures would be harvested on top of the first's. Exact
   attribution is the whole point of an addressed ledger, so each view gets its
   own DOM and pays for one more vault load. */
async function mountFor(files, { period, settings, budgetFolder } = {}) {
  const recorder = installMoneyRecorder();
  const opts = {};
  if (settings) opts.settings = settings;
  if (budgetFolder) opts.budgetFolder = budgetFolder;
  const ctx = makeCtx(files, opts);
  /* The DOM is wired BEFORE loadInto, not after. views/notes.js (registered by
     loadInto, because it publishes the noteButton chip five other views render)
     destructures `$` off the ctx at register time; with the swap done afterwards
     it kept the harness's inert stand-in, drew nothing, and every golden ledger
     carried an empty `## notes` section (audit L2b-10, 15 Oct 2026). */
  const { $, nodes } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  const S = await loadInto(ctx);
  if (period) S.period = period;

  /* The real formatter, wired the way controller.js wires it: moneyIn takes an
     explicit symbol (an account prints its OWN currency), money defaults to the
     household's. Raw values are recorded on the side so the ledger can carry
     both without parsing the printed string back into a number — which would
     re-derive the figure through a second rule, the exact bug shape this
     harness exists to find. */
  const loc = ctx.locale();
  /* seen: text -> the SET of raw values that formatted to it.

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
  ctx.moneyIn = (sym, v, dp = 2) => recorder.currency.formatAmount(sym, Number(v), dp, loc);
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
  return { ctx, S, nodes, raws: recorder.seen, restore: recorder.restore };
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
/* A '-' counts as a sign only where a sign can be: at a boundary, not inside a
   word. "under-65" is not negative sixty-five — which is exactly what the Tax
   page's age threshold was being reported as.

   Written with a leading group rather than a lookbehind deliberately. Lookbehind
   is fine in bare node and this file is never bundled, but it is fatal on the
   iOS 15 WebKit this plugin still supports, and a pattern sitting in the repo is
   a pattern someone will copy into src/ one day. Not worth the saving. */
const NUMBER = /(^|[^\w-])(-?\d[\d  ,.]*\d|-?\d)/gu;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
const TRIM = /^[\s,.;:)\]]+|[\s,.;:(\[]+$/gu;

/* Printed prose, read back the way the formatter wrote it.

   Since the audit of 20 Oct 2026 src/i18n.js interpolate() glues a figure
   that is a sentence's param with U+00A0, so "R 12 345" can no longer wrap
   as "R 12" / "345" on a phone. The formatter itself still writes U+0020
   (currency.js formatAmount is untouched), so the recorded money strings
   below say "R 12 345" while the sentence says "R\u00a012\u00a0345" — and an
   indexOf between the two finds nothing. Unmatched, the figure fell through
   to NUMBER, which does not cross a U+00A0, and the ledger reported "R 12 100"
   as the bare numbers 12 and 100.

   Mapped back to U+0020 HERE, once, for everything that reads printed text:
   numbersIn (the DOM harvest and the Report markdown harvest), ownText (the
   leaf readers scripts/reconcile-page.cjs and the dash-audit suites build on).
   The mapping is the inverse of the one interpolate applies, so a harvested
   line reads exactly as it did before the glue — which is what lets the
   golden ledgers prove the change moved whitespace and nothing else.
   `readable` itself lives in dom-stub.cjs, beside the stub's own textContent
   that applies it, so there is one spelling of the mapping. */

function numbersIn(text, moneyStrings = []) {
  /* Dates are blanked, not deleted: every other offset must stay put, because
     the claimed-span bookkeeping below is what stops one figure being reported
     twice under two kinds. */
  const s = readable(text).replace(ISO_DATE, m => ' '.repeat(m.length));
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
    const from = m.index + m[1].length, to = from + m[2].length;
    if (free(from, to)) claim(from, to, 'number', null, false);
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

/* Text-owning nodes only. An ancestor's textContent concatenates every
   descendant's, so harvesting every element would report each figure once per
   level of nesting and invent numbers that appear nowhere ("R 12" + "340,00"
   read as one string). What is collected instead is each element's OWN text —
   the part of it no descendant also claims.

   "Own text" means both ways an element can hold it, and the first cut here
   knew only one. dom.js's el() writes a plain string child through append(),
   which the DOM stub stores as a #TEXT node; textContent= writes `_text`
   instead. Checking `_text` alone therefore dropped every figure sitting beside
   an element sibling — on the Accounts page that was the savings group total
   (a `span.acct-group-total` whose text is followed by the `.acct-group-other`
   span naming the foreign balance), its donut legend twin, and both "Use
   R 17 000,00" buttons on the deck.

   A ledger whose whole claim is "every number the app displays" cannot decide
   which numbers to look at by which of two equivalent DOM calls a view happened
   to use. */
function ownText(el) {
  return readable((el._text || '')
    + el.children.filter(c => c.nodeType === 1 && c.tagName === '#TEXT').map(c => c._text).join(''));
}

function leaves(el, out = []) {
  const elementKids = el.children.filter(c => c.nodeType === 1 && c.tagName !== '#TEXT');
  if (!elementKids.length) { out.push(el); return out; }
  if (ownText(el).trim()) out.push(el);
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
      const text = ownText(leaf);
      const nums = numbersIn(text, moneyStrings);
      if (!nums.length) continue;
      /* The words around the figure, recorded HERE, at harvest time, on the
         figure itself. reconcile-page.cjs used to rebuild this afterwards as a
         Map keyed by address, and an address is not unique: every
         `acctTable/@acct-group-total` shares one, and so does every Savings
         worth-chart segment (data-fig stops addressOf's walk at the name). The
         Map kept the LAST leaf written under each key, so all of a page's group
         totals read the same neighbours and "the Savings group" was looked up
         among text that only ever described the final group. The leaf is in
         hand here; nothing needs to be guessed back from a string. */
      const p = leaf._parent;
      const parentText = p ? String(p.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const context = { own: text.replace(/\s+/g, ' ').trim(), parent: parentText.slice(0, 140) };
      const address = addressOf(leaf, rootId);
      for (const num of nums) {
        figures.push({ view, address, kind: num.kind,
          text: num.text, raw: num.raw, ambiguous: !!num.ambiguous, context });
      }
    }
  }
  return { view, error: null, figures };
}

/* ---- the generated report ------------------------------------------------
   The Report page renders a form; its figures live in the document Create
   writes. harvestView cannot see them, which is how a 12-month report printing
   "165% of spending budget used" passed every guard (audit L2b-10, 15 Oct 2026).
   So the document is generated the way a reader does — through the real page,
   with the Period pill set — and its markdown is harvested with the same
   number rules as the DOM.

   Addressed by section and row: `<view>/<## heading>/<first cell>/c<column>` for
   a table row, `<view>/<## heading>/p<n>` for the nth prose line. Content paths,
   like the DOM addresses, so they move when a row is renamed and not when a row
   is added elsewhere. The header (front matter, title, "Generated at", the
   disclaimer) is left out: the stamp is a date and a time, not a figure. */
function harvestReportMarkdown(view, md, raws) {
  const moneyStrings = [...raws.entries()]
    .map(([str, set]) => ({ str, raw: set.size === 1 ? [...set][0] : null, ambiguous: set.size > 1 }))
    .sort((a, b) => b.str.length - a.str.length);
  const figures = [];
  let heading = null, prose = 0;
  const seen = new Map();
  for (const line of String(md).split('\n')) {
    const h = /^##\s+(.*\S)\s*$/.exec(line);
    if (h) { heading = h[1]; prose = 0; continue; }
    /* Skipped: nothing before the first heading, blank lines, a table's rule
       line, and an italic-only caption (`_Aug 1 – Sep 30, 2026_` is the span the
       section covers, a pair of dates, not a figure). */
    if (heading === null || !line.trim() || /^\|[\s|:-]+\|?\s*$/.test(line) || /^_[^_]*_$/.test(line.trim())) continue;
    const cells = line.startsWith('|') ? line.replace(/^\||\|\s*$/g, '').split('|').map(c => c.trim()) : null;
    const parts = cells
      ? cells.map((c, i) => ({ text: c, at: i === 0 ? null : `c${i}` }))
      : [{ text: line, at: `p${++prose}` }];
    const rowKey = cells ? (cells[0] || '(blank)') : null;
    for (const part of parts) {
      if (part.at === null) continue;
      const base = `${view}/${heading}/${rowKey ? `${rowKey}/` : ''}${part.at}`;
      /* A row label repeated in one section (two "Total" rows) gets an index. */
      const n = seen.get(base) || 0; seen.set(base, n + 1);
      const address = n ? `${base}[${n}]` : base;
      const again = new Map();     // the same figure twice in one cell is told apart by occurrence
      for (const num of numbersIn(part.text, moneyStrings)) {
        const k = `${num.kind}|${num.text}`, o = (again.get(k) || 0) + 1; again.set(k, o);
        figures.push({ view, address: o > 1 ? `${address}#${o}` : address, kind: num.kind, text: num.text, raw: num.raw,
          ambiguous: !!num.ambiguous, context: { own: part.text, parent: line.slice(0, 140) } });
      }
    }
  }
  return figures;
}

/* The two multi-period documents. 'current' is the page the Report view
   already renders; 3m and 12m are the ones with no other witness. */
async function harvestReports(files, { period, settings, budgetFolder } = {}) {
  const { createReport } = require('./report-page.cjs');
  const out = [];
  for (const pill of ['3m', '12m']) {
    const view = `report-${pill}`;
    const M = await mountFor(files, { period, settings, budgetFolder });
    try {
      const r = await createReport(M, { pill, json: false });
      if (!r.md) { out.push({ view, error: `no document written (${r.toasts.join('; ') || 'no toast'})`, figures: [] }); continue; }
      out.push({ view, error: null, figures: harvestReportMarkdown(view, r.md, M.raws) });
    } catch (e) { out.push({ view, error: e.message, figures: [] }); }
  }
  return out;
}

/* Every view, each on its own mount, then the generated 3- and 12-month
   reports. */
async function harvestAll(files, { period = '2026-09', today = '2026-09-02', settings, budgetFolder } = {}) {
  const unpin = pinClock(today);
  try {
    const views = dispatchedViews();
    const results = [];
    for (const v of views) {
      const { ctx, nodes, raws } = await mountFor(files, { period, settings, budgetFolder });
      results.push(harvestView(ctx, nodes, raws, v));
    }
    results.push(...await harvestReports(files, { period, settings, budgetFolder }));
    return results;
  } finally { unpin(); }
}

/* ---- reading a real vault off disk -------------------------------------
   ONE reader for scripts/figures.cjs and scripts/reconcile-page.cjs (audit L8-11).
   The vault as { path: text }, read the way Obsidian holds it, because that is
   what every page reads: markdown, the `.csv` files (the loader reads
   Data/Categorisation Rules.csv), and every folder that would otherwise vanish.
   A folder with nothing the loader reads in it — empty, or holding only a PDF —
   is kept as `<folder>/.folder`, the in-memory vault's own marker
   (tests/helpers/harness.cjs). Until 2026-10-07 this kept `.md` alone: the
   census printed "rules: 0" for a vault holding hundreds, and an account whose
   Transactions folder was empty read "no folder" instead of "no transactions
   yet" — so on the audited vault the reconciliation's Accounts page counted
   two muted accounts as needing attention that the app does not (audit H-1).
   Dot-files and dot-folders stay out, as they stay out of Obsidian's tree. */
function readVault(root) {
  const out = {};
  const walk = (dir, prefix) => {
    let kept = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, rel); kept++; }
      else if (e.name.endsWith('.md') || e.name.endsWith('.csv')) { out[rel] = fs.readFileSync(abs, 'utf8'); kept++; }
    }
    /* A kept sub-folder carries its own marker if it needs one, and its path
       alone makes this folder exist in the in-memory tree. */
    if (!kept && prefix) out[`${prefix}/.folder`] = '';
  };
  walk(root, '');
  return out;
}

module.exports = { readable, readVault, harvestReportMarkdown, harvestReports, dispatchedViews, pinClock, mountFor, harvestView, harvestAll, numbersIn, addressOf, leaves, ownText };
