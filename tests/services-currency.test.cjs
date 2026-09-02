'use strict';
/* The Services page's own totals, which added unlike currencies.

   ADR-0004 gave Services.md a `currency` column, and this page learned exactly
   one half of what that means. `chargeIndex()` is scrupulous — it compares a
   listed price only against charges in the household's own currency, and a
   service billed abroad gets a NEUTRAL "billed in €" badge and no price
   verdict at all rather than a confident wrong one.

   Its three totals then added every active service whatever its symbol:

     KPI "Per month"          R800 Fibre + €15 Cloud  ->  R 815.00
     KPI "Per year"                                        R 9 780.00
     the category subtotal row (rendered in renderServices)
     and its in-place twin (renderServiceSubtotals, run on every amount edit)

   A rand and a euro added together and printed under a rand symbol, on the
   page whose own badges say those two figures cannot be compared. The
   Dashboard already partitions the same services by symbol before they reach
   whatsLeft (views/dashboard.js's homeish/fxOf), so this was also two answers
   to one question on two screens.

   Held out and NAMED, never dropped — currency.js:14 — reusing the keys the
   Accounts page already states this fact with, so no screen words it its own
   way.

   Driven through the REAL loader and the REAL registerServices.
     node tests/services-currency.test.cjs      # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';

/* Two categories, so one subtotal row is mixed and the other is purely
   foreign — a group whose every service is billed abroad must not print a
   rand subtotal of zero as though it cost nothing. */
const SERVICES = {
  [`${B}/Settings.md`]: SETTINGS,
  [`${B}/Categories/Home.md`]: '---\ntype: expense\ncolor: "#c0392b"\n---\n',
  [`${B}/Categories/Media.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',
  [`${B}/Services.md`]:
    '---\nkind: services\n---\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Currency |\n'
    + '|---|---|---:|---|---|---|---|---|---|\n'
    + '| Fibre | ISP | 800.00 | monthly |  | Home | yes |  |  |\n'
    + '| Cloud | Vendor | 15.00 | monthly |  | Home | yes |  | € |\n'
    // An ANNUAL foreign service: monthlyEquiv has to run per symbol, not once
    // over a pooled figure. €120 a year is €10 a month, never R10.
    + '| Streaming | Vendor | 120.00 | annual |  | Media | yes |  | € |\n'
    // Inactive, and foreign: it must be absent from both sides, so a fix that
    // simply moved the filter cannot quietly drop the active test with it.
    + '| Old plan | Vendor | 999.00 | monthly |  | Media | no |  | € |\n',
};

async function mount(files) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;

  /* Three gaps in the shared DOM stub, filled HERE rather than there: it is a
     teammate's file this round, and all three are narrow.

       - querySelectorAll('tr.type-row') — the stub's matcher handles '.cls',
         '#id', a bare tag and [attr="v"], but not tag+class together. That
         selector is how renderServiceSubtotals finds the rows it updates in
         place, so without it the in-place path would silently update nothing
         and "pass".
       - `dataset` — el() writes data-cat through setAttribute, which the stub
         records in attrs without mirroring into dataset. renderServiceSubtotals
         reads row.dataset.cat, so every row would look like an unnamed group.
       - `lastElementChild` — the cell that path writes into.

     Every one is reproduced from what the view itself put there, so the shim
     cannot invent a value the view did not write. */
  const table = $('#svcTable');
  const realQsa = table.querySelectorAll.bind(table);
  const shim = n => {
    n.dataset = { ...n.dataset, cat: n.attrs['data-cat'] };
    if (!('lastElementChild' in n)) {
      Object.defineProperty(n, 'lastElementChild', {
        configurable: true,
        // Live, not snapshotted — text nodes in this stub carry nodeType 1 as
        // well, so they are told apart by their tag rather than by that.
        get() { return this.children.filter(c => c.tagName !== '#TEXT').slice(-1)[0] || null; },
      });
    }
    return n;
  };
  table.querySelectorAll = sel => {
    if (sel !== 'tr.type-row') return realQsa(sel);
    return descend(table).filter(n => n.tagName === 'TR' && n._cls.has('type-row')).map(shim);
  };

  require('../src/views/services')(ctx);
  return { ctx, S, $ };
}

const byClass = (root, cls) => descend(root).filter(n => n._cls && n._cls.has(cls));
const one = (root, cls) => byClass(root, cls)[0];

/* label -> { value, sub } for every KPI tile on the page. */
function kpis($) {
  const out = new Map();
  for (const t of byClass($('#servicesKpis'), 'mini')) {
    out.set((one(t, 'l') || {}).textContent, {
      value: (one(t, 'v') || {}).textContent,
      sub: (one(t, 's') || {}).textContent || '',
    });
  }
  return out;
}

/* category -> the subtotal cell's rendered text, off the type-row itself. */
function subtotals($) {
  const out = new Map();
  for (const tr of descend($('#svcTable')).filter(n => n.tagName === 'TR' && n._cls.has('type-row'))) {
    out.set(tr.attrs['data-cat'], tr.children[tr.children.length - 1].textContent);
  }
  return out;
}

(async () => {
  const { ctx, $ } = await mount(SERVICES);
  ctx.renderServices();

  /* ---- 1. the two KPI tiles state the household's own currency only ---- */
  {
    const k = kpis($);
    eq(k.get('Per month').value, 'R 800.00',
      'Per month is the rand services alone — R800 + €15 is not R815');
    eq(k.get('Per year').value, 'R 9600.00',
      'and Per year is twelve of that figure, not twelve of a mixed one');
    ok(/€/.test(k.get('Per month').sub),
      `the euro services are NAMED beside the figure, never dropped — got "${k.get('Per month').sub}"`);
    /* €15 a month plus €120 a year is €25 a month, and €300 a year. The
       inactive €999 is in neither. */
    ok(/25/.test(k.get('Per month').sub),
      `and stated at their own monthly equivalent (€25) — got "${k.get('Per month').sub}"`);
    ok(/300/.test(k.get('Per year').sub),
      `annualised the same way the figure beside them is — got "${k.get('Per year').sub}"`);
    eq(k.get('Active').value, '3', 'the Active count is unchanged — a euro service is still a service');
  }

  /* ---- 2. the category subtotal rows ---- */
  {
    const s = subtotals($);
    ok(/R 800/.test(s.get('Home')), `the Home subtotal is its rand service alone — got "${s.get('Home')}"`);
    ok(/€/.test(s.get('Home')), `and names the euro one beside it — got "${s.get('Home')}"`);
    /* A group with nothing in the household's currency: R0 is the truthful
       rand subtotal, and it is only truthful WITH the euro figure beside it. */
    ok(/€/.test(s.get('Media')),
      `an all-foreign group states what it costs rather than reading R0 — got "${s.get('Media')}"`);
  }

  /* ---- 3. the in-place update agrees with the full render ----
     renderServiceSubtotals exists so an edited amount can refresh the totals
     without rebuilding the row it was typed into (on a phone `change` fires on
     blur, and a full rebuild lands between the tap that leaves a field and the
     one arriving at the next). It is therefore a SECOND writer of the same
     string, and this repo's recurring defect is two writers of one figure. */
  {
    const before = subtotals($);
    /* Driven the way a reader drives it — the amount field's own change
       handler — rather than by calling renderServiceSubtotals directly, which
       is not on ctx and should not be published just so a test can reach it. */
    const fibreAmount = descend($('#svcTable'))
      .find(n => n.tagName === 'INPUT' && n.attrs['aria-label'] === 'Amount for Fibre');
    ok(fibreAmount, 'the Fibre row has an amount field to edit');
    fibreAmount._fire('change', { target: { value: '800' } });
    const after = subtotals($);
    eq([...after], [...before],
      'the in-place subtotal update writes exactly what the full render wrote');
  }

  console.log(`PASS — the Services page totals the household's own currency and names every other one, on the KPI tiles and in both writers of the category subtotal (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
