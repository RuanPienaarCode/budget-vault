'use strict';
/* The i18n RENDER gate — proves what tests/i18n.test.cjs cannot: what actually
   reaches the screen, not what a source-level grep can parse.

   tests/i18n.test.cjs is a static gate. It proves every language table carries
   English's key set, and it proves every key literal it can PARSE out of src/
   exists in lang/en.js. Both are real guarantees. Neither one runs a view and
   looks at what came out the other end — so both of the following pass it
   clean while shipping broken:

     - a key referenced through a shape the static parser cannot see (string
       concatenation two levels removed, a key assembled from more than one
       variable) renders as its own raw dotted name, in every language;
     - a test that asserts the RAW KEY text is present — pinning the bug
       instead of the behaviour, so it goes green on a broken render and red
       the day someone fixes it. (This nearly shipped in the 1.23.0 pass: a
       assertion read `tableTxt.includes('acct.balance.unreadable')`, which
       only passed because the key was untranslated. Renamed in review.)

   This file renders every view controller.js dispatches — the real module,
   through the real i18n table, over the shared FakeEl DOM stub
   (tests/helpers/dom-stub.cjs) — once per shipped language, and inspects the
   actual text nodes and aria-label/title/alt/placeholder attributes that
   would reach a phone screen. Bare node, no Obsidian, no browser.

     node tests/i18n-render.test.cjs        # non-zero exit on failure

   -------------------------------------------------------------------------
   Five assertions, in order of how much they're worth:

     1. RAW KEY LEAK — no `two.or.more.dotted.segments` string reaches a text
        node or an aria-label/title/alt/placeholder attribute, in ANY
        language. This is the highest-value check in the file: it is the one
        that would have caught the 1.23.0 near-miss instead of merely
        confirming it after the fact.

     2. UNINTERPOLATED PLACEHOLDER — no literal `{word}` survives into
        rendered text. A `{amount}` on screen means a call site forgot to
        pass a param, which i18n.js's `t()` deliberately leaves standing
        rather than silently dropping (see i18n.js's own header) — a
        DESIGN DECISION for missing keys, but never something that should
        survive to a screen for a param the call site controls.

     3. LANGUAGE SWITCH RATCHET — for every view controller.js dispatches,
        rendering under German must differ from rendering under English, or
        the view is not reading the language setting at all. Nine views
        currently don't (see EXPECTED_ENGLISH_ONLY below) — declared, with an
        asserted count, so the list can only ever SHRINK: translating a view
        forces this file to be edited, and a NEW untranslated view fails
        the build instead of silently joining the backlog.

     4. LITERAL "(s)" IN A TRANSLATED VIEW — lang/en.js's own header says a
        string is "whole sentences per form, not fragments concatenated
        around a number" — but a literal "(s)" is neither form. Three keys
        carried it (see the file header's FIXED note below); KNOWN_LITERAL_S_
        KEYS/VIEWS are now empty ratchets, not deleted, so a NEW one still
        fails loudly. Scoped to the five views that actually call i18n.t()
        today (TRANSLATED_VIEWS, mirroring tests/i18n.test.cjs's own
        inventory) — unscoped, this trips on 'IT3(s)', a real South African
        tax form name rendered verbatim in the (currently untranslated) Tax
        view, which is not a plural bug.

     5. RAW ENUM LEAK — a category TYPE_ORDER value (`expense`, `housing`, …)
        rendered as its own visible text where a translated `wiz.type.*` key
        already exists for it. Was live: controller.js's typeBadge rendered
        `type` directly (`el('span', {...}, type)`) rather than
        `i18n.t('wiz.type.' + type)`; views/budgets.js was the one place it
        showed up. Fixed (obsidian-plugin-engineer) — typeBadge now falls
        back to the raw value only when no `wiz.type.*` key matches, for a
        household's own custom group name. KNOWN_ENUM_LEAK_VIEWS is now an
        empty ratchet, not deleted.

   -------------------------------------------------------------------------
   What this file CANNOT check on rendered output, and why:

     - settings-tab.js. Every one of its ~40 unused `settings.*` keys and its
       21 raw `.setName('English literal')` calls are real — found by reading
       the file, not by rendering it — but Obsidian's `Setting` builder
       (`.setName().setDesc().addText(...)`) is stubbed as `class Setting {}`
       in tests/helpers/harness.cjs (empty on purpose: nothing under src/
       needs more than that to load). Calling `display()` against it throws
       immediately. Building a second, fuller Setting implementation just for
       this file would be a parallel UI toolkit to keep faithful to
       Obsidian's real one — the exact trap tests/helpers/dom-stub.cjs's own
       header warns against for the DOM. Reported in prose instead (see the
       dispatch summary), not gated here.

     - acct.balance.impliedHint / acct.balance.updatedDrift ALSO carried the
       literal "(s)" bug (fixed alongside bud.pull.title — all three
       converted to the plural object form, in every language). Both are
       read from source, not proven on rendered output here: impliedHint
       sits inside editBalance()'s askFields() modal dialog, and
       updatedDrift is a toast fired from inside that same async flow —
       neither is on the page's ordinary render path, and driving them would
       mean simulating a full modal round-trip against a Modal stubbed the
       same empty way Setting is. bud.pull.title carried the same bug on an
       ordinary render path (an "assumed" budget row's Pull button title) and
       IS proven here — see KNOWN_LITERAL_S_KEYS (now empty).

     - true hand-built-plural DETECTION in general (`categor${n===1?'y':
       'ies'}`) is not attempted as a general rendered-output check: a
       correctly-pluralised static string and a leaked hand-built one render
       IDENTICALLY for a given count, so nothing short of re-deriving the
       exact English grammar rule per phrase can tell them apart from output
       alone. The one concrete instance this file ever found (views/
       dashboard.js's spend breakdown line) is fixed (obsidian-plugin-
       engineer) — replaced with the dash.split.summary plural entry, whole
       sentence per form like everything else in lang/en.js. Left
       unpinned deliberately: pinning it would have required either
       asserting the broken behaviour (which goes red the moment someone
       fixes it) or hand-listing the one English noun pair to watch for,
       which is a source-level check wearing a rendered-output costume.
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');
const { TYPE_ORDER } = require('../src/constants');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- the view list, read from controller.js — same parse tests/views-render
   .test.cjs uses, kept independent rather than imported so this file does not
   silently inherit a change to that file's parsing without noticing. ---- */
const CONTROLLER = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
const DISPATCH = (() => {
  const start = CONTROLLER.indexOf('({ dashboard: ctx.renderDashboard');
  ok(start !== -1, 'the view dispatch map is still recognisable in controller.js');
  const chunk = CONTROLLER.slice(start, CONTROLLER.indexOf('[S.view]()', start));
  const out = [];
  for (const m of chunk.matchAll(/(\w+):\s*ctx\.(render\w+)/g)) out.push({ view: m[1], fn: m[2] });
  return out;
})();
ok(DISPATCH.length >= 13, `every dispatched view is covered (found ${DISPATCH.length})`);

/* ---- the languages that actually ship — read off i18n.js itself, not
   hand-listed, so a language added mid-flight (isiXhosa/isiZulu are already
   sitting as untracked src/lang/xh.js and src/lang/zu.js at the time of
   writing, not yet wired into i18n.js's TABLES) is picked up automatically
   the moment it lands, with no edit needed here. ---- */
const LANGS = i18n.LANGUAGE_ORDER;
ok(LANGS.includes('en') && LANGS.length >= 7, `at least the 7 shipped languages are present (found ${LANGS.length})`);

/* ---- TRANSLATED_VIEWS — mirrors tests/i18n.test.cjs's own inventory of the
   same name, but declared independently: this file must not import from an
   owner file it isn't allowed to touch, and a divergence between the two
   copies is itself a signal worth seeing rather than silently inheriting. */
const TRANSLATED_VIEWS = new Set(['dashboard', 'score', 'transactions', 'budgets', 'accounts']);

/* ---- EXPECTED_ENGLISH_ONLY — the ratchet. Declared here as the definition
   of "not yet translated", so a view that gains real i18n.t() usage without
   this list shrinking fails LOUDLY (assertion 3 below), and a NEW view added
   to controller.js with no i18n usage fails just as loudly rather than
   quietly joining the backlog unnoticed.

   Ten, not the seven named in the brief that motivated this file — plan.js,
   services.js and notes.js carry zero i18n.t()/data-i18n usage same as the
   other seven (verified: `grep -c 'i18n\.t(\|data-i18n'` on every dispatched
   view returns 0 for exactly these ten and only these ten). Reported as a
   finding, not silently folded in without comment — see the dispatch
   summary. */
const EXPECTED_ENGLISH_ONLY = ['plan', 'notes', 'savings', 'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import'];
eq(EXPECTED_ENGLISH_ONLY.length, 10, 'the declared English-only backlog is exactly 10 views — translating one shrinks this list');
for (const v of EXPECTED_ENGLISH_ONLY) {
  ok(!TRANSLATED_VIEWS.has(v), `'${v}' cannot be in both TRANSLATED_VIEWS and EXPECTED_ENGLISH_ONLY`);
}

/* ---- KNOWN_LITERAL_S_KEYS — a live bug (see file header, assertion 4),
   reported not fixed: this file may not edit src/lang/*.js. Declared as a
   shrink-only ratchet the same shape as EXPECTED_ENGLISH_ONLY, so fixing the
   string in lang/en.js (and its six translations) is what turns this list
   empty — not a silent pass. Only the one of the three reachable on an
   ordinary render is proven here (see file header for the other two). */
// Fixed (obsidian-plugin-engineer, three-key i18n pass): bud.pull.title
// converted to the plural object form in every language, so the literal
// "(s)" no longer reaches this render path. This list is empty, not
// deleted, so a NEW literal-"(s)" key landing anywhere still fails loudly.
const KNOWN_LITERAL_S_KEYS = [];
eq(KNOWN_LITERAL_S_KEYS.length, 0, 'no literal-"(s)" key is proven on the render path today');
// Which DISPATCH view(s) each of those keys renders in. Kept as its own
// declared list (rather than derived) so a new key landing in a view is a
// one-line addition here, not a change to the comparison logic below.
const KNOWN_LITERAL_S_VIEWS = [];

/* ---- KNOWN_ENUM_LEAK_VIEWS — the other live bug (assertion 5): controller.js
   builds typeBadge as `el('span', {...}, type)`, the raw TYPE_ORDER value,
   never `i18n.t('wiz.type.' + type)` — even though every one of those keys
   already exists and is translated in all seven languages. views/budgets.js
   is the one call site (`typeBadge(d.type)`). Reported, not fixed: fixing it
   means editing controller.js, which is not this file's owner file. */
// Fixed (obsidian-plugin-engineer): controller.js's typeBadge now routes
// through i18n.t('wiz.type.' + type), falling back to the raw value only
// when no key matches (a household's own custom group name). Empty, not
// deleted, so a NEW raw-enum leak anywhere still fails loudly.
const KNOWN_ENUM_LEAK_VIEWS = [];
eq(KNOWN_ENUM_LEAK_VIEWS.length, 0, 'no view leaks a raw TYPE_ORDER value through typeBadge today');

/* ---------------------------- rendered-string walk ------------------------
   Walks a FakeEl tree (tests/helpers/dom-stub.cjs) and returns every discrete
   piece of text that would actually reach the screen: an element's own
   directly-set text (`el.textContent = t('key')`, which budgets.js's
   `remainingEl` uses), each text-node CHILD an element was built with via
   dom.js's el() (the far more common shape), and the aria-label / title /
   alt / placeholder attributes.

   Deliberately per RUN, not per subtree-concatenation: `el.textContent`
   (the getter) would concatenate an entire subtree into one string, which
   can never equal a bare raw key even when a child three levels down holds
   exactly that key. Reading each node's OWN `_text` keeps every run atomic,
   which is what "reaches the screen as its own text node" in the brief
   actually means. */
const ATTRS_TO_CHECK = ['aria-label', 'title', 'alt', 'placeholder'];
/* tests/helpers/dom-stub.cjs's FakeEl sets `nodeType = 1` UNCONDITIONALLY in
   its constructor — including for the nodes document.createTextNode() hands
   back (`Object.assign(new FakeEl('#text'), { _text: ... })`). nodeType is
   therefore not how the stub tells a text node from an element; `tagName ===
   '#TEXT'` is (FakeEl upper-cases whatever tag string it's built with, and
   '#text' is the tag createTextNode uses). Checked against the stub's own
   source above, not assumed from real-DOM nodeType semantics. */
function collectRuns(node, out) {
  if (!node) return out;
  if (node.tagName === '#TEXT') {
    if (node._text) {
      const cls = (node._parent && node._parent._cls) || new Set();
      const tag = (node._parent && node._parent.tagName) || '#text';
      out.push({ text: node._text, cls, tag, src: 'text' });
    }
    return out;
  }
  if (node._text) out.push({ text: node._text, cls: node._cls, tag: node.tagName, src: 'text' });
  for (const attr of ATTRS_TO_CHECK) {
    if (node.attrs && attr in node.attrs) {
      out.push({ text: node.attrs[attr], cls: node._cls, tag: node.tagName, src: 'attr:' + attr });
    }
  }
  for (const c of node.children || []) collectRuns(c, out);
  return out;
}
function runsForNodes(nodesMap) {
  const out = [];
  for (const node of nodesMap.values()) collectRuns(node, out);
  return out;
}

/* Two or more dotted lowerCamelCase-or-lowercase segments, matched against
   the WHOLE trimmed run — not "contains a dot somewhere", which would flag
   an ordinary sentence ending in a decimal amount. Every real key in
   lang/en.js fits this shape (`nav.dashboard`, `settings.budgetsKept`,
   `wiz.type.expense`); nothing else this app renders does — verified no
   view renders a bare URL or dotted identifier as visible text (grepped for
   `.com`/`href=` across src/views/*.js: none found as of this writing). */
const RAW_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*){1,}$/;
const PLACEHOLDER_RE = /\{[a-zA-Z_]\w*\}/;

function isRawKey(s) {
  const v = String(s).trim();
  return v.length > 0 && RAW_KEY_RE.test(v);
}
function findPlaceholder(s) {
  const m = String(s).match(PLACEHOLDER_RE);
  return m ? m[0] : null;
}

/* -------------------------------- fixture ---------------------------------
   Same shape as tests/views-render.test.cjs's FILES (every figure synthetic;
   never real statement data in this repo), plus one addition: a category
   with `assume_spent: true` and a matching budget row, which is what puts
   views/budgets.js's "Pull" button on the page at all — the render path
   KNOWN_LITERAL_S_KEYS['bud.pull.title'] needs to prove itself against. */
const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nhousehold: "Test"\n---\n',

  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Transfer.md`]: '---\ntype: transfer\ncolor: "#666666"\n---\n',
  // assume_spent: true — the one thing that makes budgets.js render its
  // "Pull" button, which carries the literal "(s)" bud.pull.title key.
  [`${B}/Categories/Rent.md`]: '---\ntype: housing\ncolor: "#aa6633"\nassume_spent: true\n---\n',

  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ninstitution: "Bank A"\naccount_number: "12345678901"\ntx_label: "Cheque"\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit_card\ncredit_limit: 30000\nbalance: -4000.00\nsettle_monthly: true\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Savings Pot.md`]: '---\ntype: savings\nbalance: 55000.00\ngoal_amount: 100000\nmonthly_contribution: 2000\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Fund.md`]: '---\ntype: investment\nbalance: 90000.00\ntotal_invested: 75000\nbalance_updated: 2026-07-01\n---\n',

  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 | |\n| Salary | income | 40000.00 | |\n| Rent | housing | 9000.00 | |\n',

  [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
    + '| 2026-07-01 | Salary | Salary | 40000.00 |  |  |  |\n'
    + '| 2026-07-03 | Grocer | Groceries | -1200.00 |  |  |  |\n'
    + '| 2026-07-09 | Uncategorised thing |  | -300.00 |  |  |  |\n',

  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
    + '| Card debt | Bank A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | | active | |\n',

  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n| House | property | 1500000.00 | 2026-03-01 | |\n',

  [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n| Person | Amount | Description | Due date | Status | Repaid |\n|---|---:|---|---|---|---:|\n| Sam | 250.00 | lunch | 2026-08-01 | outstanding | |\n',

  [`${B}/Services.md`]: '---\nkind: services\n---\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|---|---|---:|---|---|---|---|---|\n| Streaming | Provider A | 199.00 | monthly | 2026-08-05 | Groceries | yes | |\n',

  [`${B}/Tax/2026.md`]: '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: pending\n---\n\n# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n| Gather documents | busy | 2026-09-01 | |\n\n## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | needed | | |\n\n## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n| 4201 | Local interest | Bank A | 15000.00 |\n',
};
const PERIOD = '2026-07';

/* Mount every view module against one fresh ctx — same registration set and
   order as tests/views-render.test.cjs's mountAll, copied rather than
   imported (that file is a script, not a module, and this lane owns nothing
   in it). A FRESH mount per call, not a shared one, is what keeps each
   view's `nodes` map free of ids any OTHER view happens to have queried —
   the isolation assertion 3's per-view before/after diff depends on. */
async function mountView() {
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);          // io, period, trend-math, health-data, load, notes
  S.period = PERIOD;
  const { $, nodes } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  // The REAL typeBadge from controller.js, verbatim — this is the exact
  // shape assertion 5 depends on, so a divergent stub here would test a
  // different bug than the one that ships. Kept in sync by hand with
  // controller.js's own typeBadge (fixed: routes through wiz.type.* with a
  // raw-value fallback for keys that don't exist) rather than imported,
  // because controller.js does not export it standalone.
  ctx.typeBadge = type => {
    const key = 'wiz.type.' + type;
    const label = i18n.t(key);
    return el('span', { class: `category-badge badge-${type}` }, label === key ? type : label);
  };
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'score', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  return { ctx, nodes };
}

(async () => {
  const rawKeyHits = [];
  const placeholderHits = [];
  const sLiteralHits = [];
  const enumLeakHits = [];
  const enTextByView = {};

  for (const { view, fn } of DISPATCH) {
    const { ctx, nodes } = await mountView();
    ok(typeof ctx[fn] === 'function', `controller dispatches "${view}" to ctx.${fn}`);

    for (const lang of LANGS) {
      i18n.setLanguage(lang);
      assert.doesNotThrow(() => ctx[fn](), `the ${view} view must render under language '${lang}'`);
      checks++;

      const runs = runsForNodes(nodes);

      /* ---- 1. raw key leak ---- */
      for (const r of runs) {
        const v = r.text.trim();
        if (isRawKey(v)) rawKeyHits.push({ view, lang, src: r.src, tag: r.tag, val: v });
      }

      /* ---- 2. uninterpolated placeholder ---- */
      for (const r of runs) {
        const ph = findPlaceholder(r.text);
        if (ph) placeholderHits.push({ view, lang, src: r.src, tag: r.tag, ph, val: r.text });
      }

      /* ---- 4. literal "(s)", scoped to views that actually call i18n.t() ---- */
      if (TRANSLATED_VIEWS.has(view)) {
        for (const r of runs) {
          if (r.text.includes('(s)')) sLiteralHits.push({ view, lang, src: r.src, tag: r.tag, val: r.text });
        }
      }

      /* ---- 5. raw enum leak — a TYPE_ORDER value as a category-badge's own
         text, checked at the badge SPAN's class (the parent of the text run,
         per collectRuns' cls-from-parent rule for text-node children). ---- */
      for (const r of runs) {
        const v = r.text.trim();
        if (r.cls && r.cls.has && r.cls.has('category-badge') && TYPE_ORDER.includes(v)) {
          enumLeakHits.push({ view, lang, val: v });
        }
      }

      if (lang === 'en') {
        // Concatenated in a stable order (Map iteration order is insertion
        // order, and `nodes` is only ever appended to) so the same view's
        // 'en' and 'de' snapshots are comparing the same layout of runs.
        enTextByView[view] = runs.map(r => r.text).join('␟');
      }
    }

    /* ---- 3. language switch ratchet, per view ---- */
    i18n.setLanguage('de');
    assert.doesNotThrow(() => ctx[fn](), `the ${view} view must re-render once more under 'de' for the switch check`);
    const deText = runsForNodes(nodes).map(r => r.text).join('␟');
    i18n.setLanguage('en');

    const switches = deText !== enTextByView[view];
    if (EXPECTED_ENGLISH_ONLY.includes(view)) {
      ok(!switches,
        `'${view}' is declared in EXPECTED_ENGLISH_ONLY but its German render now differs from English — ` +
        `it has been translated. Remove it from the list (shrink EXPECTED_ENGLISH_ONLY and its asserted count).`);
    } else {
      ok(switches,
        `'${view}' is not in EXPECTED_ENGLISH_ONLY, so it is assumed translated, but its German render is ` +
        `byte-identical to its English render — either it stopped reading the language setting, or it was ` +
        `never translated and belongs in EXPECTED_ENGLISH_ONLY`);
    }
  }
  i18n.setLanguage('en');

  /* ---- assertion 1 report ---- */
  eq(rawKeyHits.map(h => `${h.view}/${h.lang} ${h.src} <${h.tag}> "${h.val}"`), [],
    'no raw i18n key reached rendered text or an aria-label/title/alt/placeholder attribute');

  /* ---- assertion 2 report ---- */
  eq(placeholderHits.map(h => `${h.view}/${h.lang} ${h.src} <${h.tag}> ${h.ph} in "${h.val}"`), [],
    'no {placeholder} survived un-interpolated into rendered output');

  /* ---- assertion 4 report — exactly the known, ratcheted leaks, nothing more.
     Comparing the VIEW set, not the raw hit list: a view renders the same
     literal "(s)" string once per language (7 hits), so pinning the hit
     count would just be pinning LANGS.length in disguise — the view set is
     the actual claim ("this bug lives here and nowhere else new"). */
  const sLiteralViews = [...new Set(sLiteralHits.map(h => h.view))].sort();
  eq(sLiteralViews, [...KNOWN_LITERAL_S_VIEWS].sort(),
    `a literal "(s)" rendered in views ${JSON.stringify(sLiteralViews)}, expected exactly ` +
    `${JSON.stringify(KNOWN_LITERAL_S_VIEWS)} (KNOWN_LITERAL_S_VIEWS) — a NEW view carrying this bug, or the ` +
    'known one disappearing without this list shrinking, both fail here');

  /* ---- assertion 5 report — exactly the known, ratcheted leaks, nothing more ---- */
  const enumLeakViews = [...new Set(enumLeakHits.map(h => h.view))].sort();
  eq(enumLeakViews, [...KNOWN_ENUM_LEAK_VIEWS].sort(),
    `raw TYPE_ORDER values leaked through category-badge text in views ${JSON.stringify(enumLeakViews)}, ` +
    `expected exactly ${JSON.stringify(KNOWN_ENUM_LEAK_VIEWS)} (KNOWN_ENUM_LEAK_VIEWS) — a NEW view leaking ` +
    'an untranslated enum value fails here even though it is not what this run found');

  console.log(
    `PASS — i18n render gate: ${DISPATCH.length} views x ${LANGS.length} languages, ` +
    `${EXPECTED_ENGLISH_ONLY.length} declared English-only, ${KNOWN_LITERAL_S_KEYS.length} known literal-"(s)" ` +
    `key(s), ${KNOWN_ENUM_LEAK_VIEWS.length} known enum-leak view(s) (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
