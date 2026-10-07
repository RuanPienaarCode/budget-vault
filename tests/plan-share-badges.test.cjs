'use strict';
/* The Plan page's share badges sum to exactly 100% of the pot.

   Every spending bucket carries a badge — its share of the pot, as a whole
   percent — and the loud card under them names the share left unplaced. Each
   badge used to be rounded on its own (plan-math.js sharePct, Math.round), so a
   column of shares of ONE pot summed past it: the 2026-10-07 figures audit
   found the six badges of a real, fully placed plan summing to 101%, and a
   plain 50 / 25 / 12.5 / 12.5 split prints 50 + 25 + 13 + 13. A page whose whole
   thesis is "every rand lands somewhere" cannot add its own column up wrong.

   The fix is the largest-remainder allocation src/share-percents.js already
   gives the Dashboard donut, taken over the buckets PLUS the unplaced
   remainder, so the badges and the loud card's "% of the plan" are one
   partition of the pot. The slider's live badge is held to the same rule: a
   drag that printed 45% and a release that re-rendered it as 44% would be two
   figures for one bucket, one tick apart.

   Synthetic plans only. The six-bucket plan below is built to have the
   audit's defect — six shares that round alone to 101 (45.5 / 20.6 / 15.7 /
   5.6 / 3.2 / 9.4) — and holds nobody's real figures.

     node tests/plan-share-badges.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const planText = (pot, envelopes) => [
  '---', 'kind: plan', 'plan: "Shares"', 'started: "2026-08-01"', 'status: active', '---', '',
  '# Shares', '', '## Money in', '',
  '| Source | Kind | Amount | Date | Status | Notes |', '|--------|------|-------:|------|--------|-------|',
  `| Payout | Other | ${pot.toFixed(2)} | 2026-08-03 | received |  |`, '',
  '## Envelopes', '', '| Envelope | Amount | Note | Tint |', '|----------|-------:|------|------|',
  ...envelopes.map(([n, a]) => `| ${n} | ${a.toFixed(2)} |  |  |`), '',
  '## Items', '', '| Item | Envelope | Amount | Spent | Status | Category | Notes |',
  '|------|----------|-------:|------:|--------|----------|-------|', '',
].join('\n');

async function mountPlan(pot, envelopes) {
  const ctx = makeCtx({
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Plans/Shares.md`]: planText(pot, envelopes),
  }, { budgetFolder: B });
  await loadInto(ctx);
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  require('../src/views/plan')(ctx);
  ctx.S.planName = 'Shares';
  ctx.renderPlan();
  return { ctx, $ };
}

/* The badges in plan order: the open bucket's card badge, then each collapsed
   row's — read off the rendered page, never recomputed here. */
const badges = $ => $('#planEnvelopes').children.map(c => {
  const b = c.querySelector(c._cls.has('env') ? '.env-share' : '.env-sum-pct');
  return b ? Number(b.textContent.replace('%', '')) : NaN;
});
const sumOf = xs => xs.reduce((a, b) => a + b, 0);

const SIX = [['Settle', 4550], ['Keep', 2060], ['Coming', 1570], ['House', 560], ['Us', 320], ['Baby', 940]];

(async () => {
  /* ---- 1. a fully placed pot: the column is 100, exactly ---- */
  {
    const { $ } = await mountPlan(10000, SIX);
    const got = badges($);
    eq(sumOf(got), 100, `a fully placed pot's badges must sum to 100% (got ${got.join(' + ')})`);
    eq(got, [45, 21, 16, 6, 3, 9],
      'largest remainder: the three biggest fractions take the three spare points, in plan order');
    ok($('#planFree')._cls.has('hidden'), 'precondition: nothing is unplaced, so the loud card is hidden');
  }

  /* ---- 1b. the collapsed rows follow the partition too ----
     The open card is the first bucket, exactly 50%; the two halves of the
     last quarter sit in COLLAPSED rows, where Math.round alone prints 13 + 13. */
  {
    const { $ } = await mountPlan(10000, [['Half', 5000], ['Quarter', 2500], ['Eighth', 1250], ['Other eighth', 1250]]);
    const got = badges($);
    eq(got, [50, 25, 13, 12], `12.5 + 12.5 in two collapsed rows: the earlier takes the point (got ${got.join(' + ')})`);
    eq(sumOf(got), 100, 'and the column sums to the pot');
  }

  /* ---- 2. an unplaced remainder is part of the same partition ---- */
  {
    const { $ } = await mountPlan(10000, [['One', 3333.33], ['Two', 3333.33]]);
    const got = badges($);
    const card = $('#planFree').querySelector('.free-fig');
    ok(card, 'precondition: an unplaced remainder shows the loud card');
    const cardPct = Number(((card && card.textContent) || '').replace(/%.*$/, ''));
    eq(got, [33, 33], 'two thirds of a pot read 33% each');
    eq(cardPct, 34, 'and the unplaced third takes the spare point');
    eq(sumOf(got) + cardPct, 100, 'badges plus "% of the plan" are one partition of the pot');
  }

  /* ---- 3. the slider's live badge is the badge the release will draw ---- */
  {
    const { $ } = await mountPlan(10000, SIX);
    const card = $('#planEnvelopes').querySelector('.env');
    const slider = card.querySelector('INPUT');
    const share = card.querySelector('.env-share');
    /* 44.5% rounded alone is 45; inside the partition it loses its point to
       the larger fractions, so the column still sums to 100. */
    slider.value = '4450';
    slider._fire('input');
    const live = share.textContent;
    eq(live, '44%', `mid-drag the badge follows the partition, not Math.round alone (got ${live})`);
    slider._fire('change');
    const after = badges($);
    eq(`${after[0]}%`, live, 'and the release re-renders exactly what the drag showed');
    const freeFig = $('#planFree').querySelector('.free-fig');
    const freePct = freeFig ? Number(freeFig.textContent.replace(/%.*$/, '')) : 0;
    eq(sumOf(after) + freePct, 100, 'with the 1% now unplaced, the page still adds up to the pot');
  }

  /* ---- 4. the pure partition, held apart from the page ---- */
  {
    const { envelopeShares } = require('../src/plan-math');
    eq(envelopeShares([5000, 2500, 1250, 1250], 10000), { shares: [50, 25, 13, 12], unplaced: 0 },
      '50 / 25 / 12.5 / 12.5: one of the two halves takes the point, the earlier one');
    eq(envelopeShares([], 0), { shares: [], unplaced: 0 }, 'an empty plan is no shares and nothing to divide');
    eq(envelopeShares([100, 200], 0), { shares: [0, 0], unplaced: 0 }, 'a pot of zero divides by nothing');
    eq(envelopeShares([0, 0], 1000), { shares: [0, 0], unplaced: 100 }, 'a pot with nothing placed is all unplaced');
    /* Over-placed: the buckets claim 140% and the remainder is −40%. The
       column still partitions the pot, it just has a negative slot — the
       loud card states that figure as "40% of the plan" over the limit. */
    eq(envelopeShares([700, 700], 1000), { shares: [70, 70], unplaced: -40 },
      'an over-placed plan keeps its true shares, and the remainder goes negative by exactly the excess');

    /* The invariant, over random plans with a deterministic seed. */
    let seed = 20261007;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 400; n++) {
      const pot = Math.round(rnd() * 5000000) / 100 + 1;
      const amounts = Array.from({ length: Math.floor(rnd() * 8) }, () => Math.round(rnd() * pot * 40) / 100);
      const { shares, unplaced } = envelopeShares(amounts, pot);
      assert.strictEqual(sumOf(shares) + unplaced, 100, `shares + unplaced must be exactly 100 (n=${n})`);
      for (const [i, s] of shares.entries()) {
        const exact = (amounts[i] / pot) * 100;
        assert.ok(Math.abs(s - exact) < 1, `each share is within one point of its exact value (n=${n}, i=${i})`);
      }
    }
    checks += 2;
  }

  console.log(`plan-share-badges: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
