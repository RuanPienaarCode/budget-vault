'use strict';
/* THE PLAN PAGE SAYS ONE THING ONE WAY, AND NEVER SPLITS A FIGURE ACROSS A LINE
   (2026-10-20 audit, D2-14 and D1-05).

   D2-14. The bar's visible key names the three states of the pot "Already
   spent", "Spoken for" and "Not spoken for". The same bar's aria-label — the
   sentence a screen reader hears INSTEAD of the key — said "allocated but
   unspent", "not yet allocated" and "more allocated than this plan holds",
   words that appear nowhere on the page; the loud card and the bucket dialog
   called the not-spoken-for money "unplaced"; the bucket slider was "Amount
   allocated to …". A reader who hears one set of words and a reader who sees
   another are reading two different pages. CONTEXT.md has no Plan term (it
   lists "allocation" among the words a Budget is NOT), so the page's own
   visible words win:

     committed  (placed in a bucket, not yet gone)      "spoken for"
     free       (in no bucket: pot − placed)            "not spoken for"
     allocated  (what the buckets hold)                 "placed" — the hero's
                own word ("Left to place", "Placed more than this plan holds")
     placeable  (what can still go into a bucket)       "left to place"

   "placed" is NOT folded into "spoken for", deliberately. Spoken for is what a
   bucket holds LESS what has gone from it, and the two differ as soon as
   anything is spent: buckets placed at 12 000 against a pot of 10 000, with
   5 000 spent, are 7 000 spoken for — so "2 000 more is spoken for than this
   plan holds" would be false where "2 000 more is placed than this plan holds"
   is true. One word per quantity, and two quantities keep two words.

   D1-05. "6 spending buckets · R 49 450,00 placed of R 56 / 000,00" wrapped
   in the middle of a figure on a phone: the za locale groups thousands with a
   breaking space, and this line was English concatenated outside i18n.t, so
   the glue i18n.t now puts inside a whole-figure param never reached it. It
   goes through i18n.t (plan.env.sub) now; the page's other English sentences
   that carry a figure glue it the same way (i18n.nbspFigure).

   Drives the REAL registerPlan over the dom-stub with the REAL formatter
   (currency.js formatAmount, za separators) and reads the RAW text, U+00A0
   and all — dom-stub's textContent maps it back to a space, rawText does not.

     node tests/plan-spoken-for-words.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend, readable } = require('./helpers/dom-stub.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const seen = { confirms: [] };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal(app, opts) { seen.confirms.push(opts); return false; },
    async askFields() { return null; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};
const registerPlan = require('../src/views/plan');
const { formatAmount } = require('../src/currency');
const { PROFILES } = require('../src/locale');
const i18n = require('../src/i18n');

const B = 'Budget';
async function mount(plan) {
  const ctx = makeCtx({ [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' },
    { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.money = (v, dp = 2) => formatAmount('R', Number(v), dp, PROFILES.za);
  ctx.S.plans = { [plan.file]: plan };
  ctx.S.planName = plan.file;
  registerPlan(ctx);
  ctx.renderPlan();
  return { ctx, $ };
}
const plan = (file, extra) => ({ file, name: file, fmRaw: '', started: '2026-09-01',
  status: 'active', sources: [], envelopes: [], items: [], ...extra });
const src = amount => ({ name: 'Payout', kind: 'Other', date: '2026-09-01', amount, status: 'received', notes: '' });
const env = (name, amount) => ({ name, amount, note: '', tint: '' });
const item = (name, envelope, spent) => ({ name, envelope, amount: spent, spent, status: 'done', category: '', notes: '' });

const ariaOf = $ => $('#planPot').querySelector('.plan-split').getAttribute('aria-label');
const visible = n => descend(n).filter(x => x.tagName === '#TEXT').map(x => readable(x._text)).join(' ');
/* Words that name a Plan quantity and appear nowhere on the page. */
const HIDDEN = /allocat|placeable|unplaced/i;
/* A money figure with an ordinary (breaking) space inside it: after the symbol,
   or between two digit groups. */
const BREAKABLE = /R \d|\d \d{3}\b/;
const rawOf = n => n.rawText;

(async () => {
  /* ---- 1. a plan with some spent, some spoken for, some not ---- */
  {
    const { ctx, $ } = await mount(plan('Payout plan', {
      sources: [src(48000)],
      envelopes: [env('Car', 30000), env('Holiday', 11250)],
      items: [item('Tyres', 'Car', 2000)],
    }));
    const aria = ariaOf($);
    ok(!HIDDEN.test(aria), `the bar's spoken sentence uses no word the page does not show (got "${aria}")`);
    for (const key of ['plan.split.alreadySpent', 'plan.split.spokenFor', 'plan.split.notSpokenFor', 'plan.split.stillLeft', 'plan.hero.leftToPlace']) {
      const label = i18n.t(key).toLowerCase();
      ok(aria.toLowerCase().includes(label), `the spoken sentence says "${label}", as the page shows it (got "${aria}")`);
      ok(visible($('#planPot')).toLowerCase().includes(label), `and "${label}" is on screen for a sighted reader`);
    }
    ok(aria.includes('R 39 250,00 spoken for') && aria.includes('R 6 750,00 not spoken for'),
      `each figure is spoken with the label the key prints beside it (got "${aria}")`);

    const card = $('#planFree');
    ok(!HIDDEN.test(visible(card)), `the loud card uses no hidden word (got "${visible(card)}")`);
    ok(/not spoken for/.test(visible(card)), 'it names the money in no bucket "not spoken for", as the key does');

    const slider = descend($('#planEnvelopes')).find(n => n.tagName === 'INPUT' && n.getAttribute('type') === 'range');
    ok(slider && !HIDDEN.test(slider.getAttribute('aria-label')), `the bucket slider's label uses no hidden word (got "${slider && slider.getAttribute('aria-label')}")`);

    /* D1-05: the bucket line, through i18n.t, figures glued */
    const sub = $('#planEnvSub');
    eq(readable(rawOf(sub)), '2 spending buckets · R 41 250,00 placed of R 48 000,00', 'the bucket line reads as before');
    ok(!BREAKABLE.test(rawOf(sub)), `and no figure in it can break across a line (raw ${JSON.stringify(rawOf(sub))})`);
    ok(rawOf(sub).includes('R 48 000,00'), 'the pot is one unbreakable figure');
    ok(!BREAKABLE.test(rawOf(card)), `nor in the loud card (raw ${JSON.stringify(rawOf(card))})`);

    /* the remove-bucket dialog */
    seen.confirms = [];
    const del = descend($('#planEnvelopes')).find(n => n.tagName === 'BUTTON' && /env-del-ico/.test(n.className));
    del.click();
    await new Promise(r => setImmediate(r));
    const msg = readable(seen.confirms[0].message);
    ok(!HIDDEN.test(msg) && /spoken for/.test(msg), `removing a bucket says its money is no longer spoken for (got "${msg}")`);
    void ctx;
  }

  /* ---- 2. buckets placed past the pot ---- */
  {
    const { $ } = await mount(plan('Over placed', {
      sources: [src(10000)],
      envelopes: [env('Car', 6000), env('Holiday', 4500)],
    }));
    const aria = ariaOf($);
    ok(!HIDDEN.test(aria), `over-placed: the spoken sentence uses no hidden word (got "${aria}")`);
    ok(aria.includes('R 500,00 more is placed than this plan holds'),
      `and says it in the words the card heading prints (got "${aria}")`);
    ok(visible($('#planFree')).includes('R 500,00 more is placed than this plan holds'), 'which is on screen');
    ok(!BREAKABLE.test(rawOf($('#planFree'))), 'with the figure glued');
  }

  /* ---- 3. a bucket run past what it held, every rand left in no bucket ---- */
  {
    const { $ } = await mount(plan('Over spent', {
      sources: [src(2000)],
      envelopes: [env('Repairs', 1000)],
      items: [item('Geyser', 'Repairs', 1300)],
    }));
    const card = $('#planFree');
    const text = visible(card);
    ok(!HIDDEN.test(text) && !/had not placed|had placed/.test(text), `overspent: the card uses no hidden word (got "${text}")`);
    ok(/none of it spoken for/.test(text), `and says what is left is none of it spoken for (got "${text}")`);
    ok(/not spoken for, or spoken for by another bucket/.test(text), 'and where the extra came from, in the key\'s words');
    ok(!BREAKABLE.test(rawOf(card)), `no figure in the card can break across a line (raw ${JSON.stringify(rawOf(card))})`);
    const flags = descend($('#planEnvelopes')).filter(n => /env-rail-flag/.test(n.className || ''));
    ok(flags.length && flags.every(f => !BREAKABLE.test(rawOf(f))), 'nor in a bucket\'s "over" flag');
  }

  /* ---- 4. a collapsed overspent row ---- */
  {
    const { $ } = await mount(plan('Two buckets', {
      sources: [src(20000)],
      envelopes: [env('Open', 1000), env('Closed', 1000)],
      items: [item('Big', 'Closed', 1500)],
    }));
    const rem = descend($('#planEnvelopes')).filter(n => /env-sum-rem/.test(n.className || ''));
    ok(rem.length === 1 && /over/.test(readable(rawOf(rem[0]))), 'the collapsed row says what it is over by');
    ok(!BREAKABLE.test(rawOf(rem[0])), `with the figure glued (raw ${JSON.stringify(rawOf(rem[0]))})`);
  }

  console.log(`PASS plan-spoken-for-words — the Plan page speaks the words it shows, and its figures never break across a line (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
