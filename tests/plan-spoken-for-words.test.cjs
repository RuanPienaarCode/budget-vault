'use strict';
/* THE PLAN PAGE SAYS ONE THING ONE WAY, AND NEVER SPLITS A FIGURE ACROSS A LINE
   (2026-10-20 audit, D2-14 and D1-05).

   D2-14. The bar's visible key named the three states of the pot "Already
   spent", "Spoken for" and "Not spoken for". The same bar's aria-label — the
   sentence a screen reader hears INSTEAD of the key — said "allocated but
   unspent", "not yet allocated" and "more allocated than this plan holds",
   words that appeared nowhere on the page; the loud card and the bucket dialog
   called the not-spoken-for money "unplaced"; the bucket slider was "Amount
   allocated to …". A reader who hears one set of words and a reader who sees
   another are reading two different pages. The rule the audit set: one word
   per quantity, seen and spoken alike.

   RENAMED 15 Nov 2026, rule kept. The redesign reads the page as "money in"
   against "allocated", and the words moved with it — the audit's chosen words
   ("placed", "spoken for") are now the ones the page must NOT use, because it
   no longer prints them. The file keeps its name so its history stays with it.
   The vocabulary, from the table at the head of en.js's plan.* keys:

     pot        what the sources add up to            "money in"
     allocated  what the buckets hold                 "allocated"
     free       pot less allocated                    "not allocated"
     placeable  what can still go into a bucket       "left to allocate"
     spent      what has gone                         "spent"
     left       pot less spent                        "left to spend"

   "Spoken for" (allocated and not yet gone) is no longer a figure the page
   prints, so the word went with it — and every word the page used to have
   for a Plan quantity is refused below (HIDDEN), on screen and in the spoken
   sentences alike, so one surface cannot quietly keep the old word while the
   other moves on.

   "allocated" is still NOT folded into anything narrower. What a bucket holds
   and what it holds less what has gone differ as soon as anything is spent:
   buckets of 12 000 against 10 000 in, with 5 000 spent, are 2 000 "more
   allocated than the money in" — true — and the page says exactly that, never
   a figure for the unspent part.

   D1-05. "6 spending buckets · R 49 450,00 placed of R 56 / 000,00" wrapped
   in the middle of a figure on a phone: the za locale groups thousands with a
   breaking space, and this line was English concatenated outside i18n.t, so
   the glue i18n.t now puts inside a whole-figure param never reached it. It
   goes through i18n.t (plan.env.sub) now; the page's other English sentences
   that carry a figure glue it the same way (i18n.nbspFigure). The redesign's
   new sentences — the notes under the three hero stats, the in-the-account
   key over the sources — are held to the same rule here. A figure standing
   alone in its own element (.pot-fig, .pot-stat-v, .env-amt) is kept whole by
   the stylesheet instead and is not read by this test.

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
/* Every word the page has had for a Plan quantity and no longer prints:
   the audit's own "spoken for" / "placed" / "left to place", and the
   "placeable" / "unplaced" it already refused. `\bplaced\b` leaves "replaced"
   and "unplaced" to their own entries. */
const HIDDEN = /spoken for|placeable|unplaced|\bplaced\b|left to place\b/i;
/* A money figure with an ordinary (breaking) space inside it: after the symbol,
   or between two digit groups. */
const BREAKABLE = /R \d|\d \d{3}\b/;
const rawOf = n => n.rawText;
/* The page's word for a quantity, from en.js — a template's figure dropped. */
const word = (key, params) => i18n.t(key, params).replace(/\s+/g, ' ').trim().toLowerCase();

(async () => {
  /* ---- 1. a plan with some spent, some allocated and unspent, some not allocated ----
     48 000 in; 30 000 + 11 250 allocated; 2 000 spent from Car. So 6 750 is
     not allocated and left to allocate, and 46 000 is left to spend. */
  {
    const { ctx, $ } = await mount(plan('Payout plan', {
      sources: [src(48000)],
      envelopes: [env('Car', 30000), env('Holiday', 11250)],
      items: [item('Tyres', 'Car', 2000)],
    }));
    const aria = ariaOf($);
    ok(!HIDDEN.test(aria), `the bar's spoken sentence uses no word the page does not show (got "${aria}")`);
    const VOCAB = [
      word('plan.stat.moneyIn'),                      // pot
      word('plan.stat.allocated'),                    // allocated
      word('plan.stat.spent'),                        // spent
      word('plan.split.notAllocated'),                // free
      word('plan.hero.leftToPlace'),                  // placeable
      word('plan.stat.leftToSpend', { amount: '' }),  // left
    ];
    eq(VOCAB, ['money in', 'allocated', 'spent', 'not allocated', 'left to allocate', 'left to spend'],
      'precondition: en.js carries the vocabulary this test holds the page to');
    for (const label of VOCAB) {
      ok(aria.toLowerCase().includes(label), `the spoken sentence says "${label}", as the page shows it (got "${aria}")`);
      ok(visible($('#planPot')).toLowerCase().includes(label), `and "${label}" is on screen for a sighted reader`);
    }
    /* The figure and its word together, both ways: the spoken sentence pairs
       each figure with the word the page prints for it, and the hero prints
       the same pairing where it has one (the Spent note). */
    ok(aria.includes('R 41 250,00 allocated') && aria.includes('R 6 750,00 is not allocated')
      && aria.includes('R 46 000,00 left to spend') && aria.includes('R 6 750,00 of it left to allocate'),
      `each figure is spoken with the word the page prints for it (got "${aria}")`);
    ok(visible($('#planPot')).includes('R 46 000,00 left to spend'),
      'and the hero prints "R 46 000,00 left to spend" in the same words the sentence speaks');

    /* The sighted side of the rule: nothing on the page prints a retired word. */
    const page = [visible($('#planPot')), visible($('#planFree')), visible($('#planEnvelopes')),
      readable(rawOf($('#planEnvSub'))), visible($('#planSources'))].join(' ');
    ok(!HIDDEN.test(page), `no retired word for a Plan quantity is printed anywhere on the page (got "${(page.match(HIDDEN) || [])[0]}")`);

    /* A healthy plan's block under the bar is two buttons and no sentence:
       the hero's figure is the sentence. They use the hero's verb. */
    const card = $('#planFree');
    ok(!HIDDEN.test(visible(card)), `the block under the bar uses no retired word (got "${visible(card)}")`);
    ok(/\ballocate\b/i.test(visible(card)), `it offers to "allocate" the money, the hero's verb (got "${visible(card)}")`);

    const slider = descend($('#planEnvelopes')).find(n => n.tagName === 'INPUT' && n.getAttribute('type') === 'range');
    const sliderLabel = slider && slider.getAttribute('aria-label');
    ok(sliderLabel && !HIDDEN.test(sliderLabel) && /allocated/.test(sliderLabel),
      `the bucket slider is "Amount allocated to …", the page's word (got "${sliderLabel}")`);

    /* D1-05: the bucket line, through i18n.t, figures glued */
    const sub = $('#planEnvSub');
    eq(readable(rawOf(sub)), 'R 41 250,00 allocated across 2 spending buckets', 'the bucket line reads in the page\'s words');
    ok(!BREAKABLE.test(rawOf(sub)), `and no figure in it can break across a line (raw ${JSON.stringify(rawOf(sub))})`);
    ok(rawOf(sub).includes('R 41 250,00'), 'the allocated total is one unbreakable figure');
    ok(!BREAKABLE.test(rawOf(card)), `nor in the block under the bar (raw ${JSON.stringify(rawOf(card))})`);
    /* The redesign's new sentences that carry a figure: the three hero notes
       and the in-the-account key over the sources. */
    const notes = $('#planPot').querySelectorAll('.pot-stat-n');
    eq(notes.length, 3, 'precondition: three hero stats, each with its note');
    const keyLine = $('#planSources').querySelector('.src2-inout-key');
    ok([...notes, keyLine].every(n => n && !BREAKABLE.test(rawOf(n))),
      `nor in the hero's notes or the sources' key (raw ${JSON.stringify([...notes, keyLine].map(n => n && rawOf(n)))})`);

    /* the remove-bucket dialog */
    seen.confirms = [];
    const del = descend($('#planEnvelopes')).find(n => n.tagName === 'BUTTON' && /env-del-ico/.test(n.className));
    del.click();
    await new Promise(r => setImmediate(r));
    const msg = readable(seen.confirms[0].message);
    ok(!HIDDEN.test(msg) && /no longer allocated/.test(msg), `removing a bucket says its money is no longer allocated (got "${msg}")`);
    void ctx;
  }

  /* ---- 2. buckets allocated past the money in ---- */
  {
    const { $ } = await mount(plan('Over placed', {
      sources: [src(10000)],
      envelopes: [env('Car', 6000), env('Holiday', 4500)],
    }));
    const aria = ariaOf($);
    ok(!HIDDEN.test(aria), `over-allocated: the spoken sentence uses no retired word (got "${aria}")`);
    ok(aria.includes('R 500,00 more is allocated than the money in'),
      `and says it in the words the heading under the bar prints (got "${aria}")`);
    ok(visible($('#planFree')).includes('R 500,00 more is allocated than the money in'), 'which is on screen');
    ok(!BREAKABLE.test(rawOf($('#planFree'))), 'with the figure glued');
  }

  /* ---- 3. a bucket run past what it held, every rand left in no bucket ----
     2 000 in, 1 000 allocated, 1 300 spent from it: 300 over, 700 left, and
     none of the 700 still in a bucket. */
  {
    const { $ } = await mount(plan('Over spent', {
      sources: [src(2000)],
      envelopes: [env('Repairs', 1000)],
      items: [item('Geyser', 'Repairs', 1300)],
    }));
    const card = $('#planFree');
    const text = visible(card);
    ok(!HIDDEN.test(text) && !/had not placed|had placed/.test(text), `overspent: the words under the bar use no retired word (got "${text}")`);
    ok(/none of it still in a bucket/.test(text), `and say what is left is none of it still in a bucket (got "${text}")`);
    ok(text.includes(i18n.t('plan.free.overspentFix')), 'and close with what to do about the overrun');
    ok(!BREAKABLE.test(rawOf(card)), `no figure in them can break across a line (raw ${JSON.stringify(rawOf(card))})`);
    const flags = descend($('#planEnvelopes')).filter(n => /env-rail-flag/.test(n.className || ''));
    ok(flags.length && flags.every(f => !BREAKABLE.test(rawOf(f))), 'nor in a bucket\'s "over" flag');
    const spentNote = $('#planPot').querySelectorAll('.pot-stat-n')[2];
    ok(spentNote && /over its bucket/.test(readable(rawOf(spentNote))) && !BREAKABLE.test(rawOf(spentNote)),
      `nor in the Spent note that names the overrun (raw ${JSON.stringify(spentNote && rawOf(spentNote))})`);
  }

  /* ---- 4. a collapsed overspent row ----
     The open bucket's header is built as a row too (`env-sum is-open`), so
     the collapsed rows are the `.env-sum` that are not open. */
  {
    const { $ } = await mount(plan('Two buckets', {
      sources: [src(20000)],
      envelopes: [env('Open', 1000), env('Closed', 1000)],
      items: [item('Big', 'Closed', 1500)],
    }));
    const rows = $('#planEnvelopes').querySelectorAll('.env-sum').filter(r => !r.classList.contains('is-open'));
    const rem = rows.map(r => r.querySelector('.env-sum-rem')).filter(Boolean);
    ok(rem.length === 1 && /over/.test(readable(rawOf(rem[0]))), 'the collapsed row says what it is over by');
    ok(!BREAKABLE.test(rawOf(rem[0])), `with the figure glued (raw ${JSON.stringify(rawOf(rem[0]))})`);
  }

  console.log(`PASS plan-spoken-for-words — the Plan page speaks the words it shows, and its figures never break across a line (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
