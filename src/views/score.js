'use strict';
/* The Score page — the long form of the Dashboard's one-number verdict.

   The card on the Dashboard has room for a figure and a sentence. This has room
   for the whole argument: what the score is built from, what this household is
   already doing well, what would move the number most, and how to actually do
   it. Same snapshot behind both (health-data.js), so the two can never disagree
   about the score they are describing.

   ORDER IS DELIBERATE — what is going well comes BEFORE what to work on. A page
   that opens with five things you are failing at is a page nobody returns to,
   and a household reading it is usually already anxious about money. The good
   news is also the true news: the parts at full marks are genuinely finished
   work. The gaps keep their honesty — they are named, measured, and given a
   figure — they just do not go first. */

const { el, icoEl } = require('../dom');
const i18n = require('../i18n');
const { scoreBand, SCORE_BANDS, FULL_MARKS, PILLARS } = require('../health-math');

/* A pillar counts as "going well" a little below the top. Demanding 100% would
   put a household at 97% of its target in the same list as one at 4%, which is
   not a distinction anyone recognises in their own finances. */
const GOOD_ENOUGH = 0.9;

module.exports = function registerScore(ctx) {
  const { S, $, money, healthSnapshot, periodMonthName, currentPeriod } = ctx;

  function renderScore() {
    const hero = $('#scoreHero');
    const good = $('#scoreGood');
    const work = $('#scoreWork');
    const how = $('#scoreHow');
    if (!hero) { return; }
    hero.empty(); good.empty(); work.empty(); how.empty();

    const snap = healthSnapshot();
    const { metrics: M, breakdown, target, earmarks } = snap;

    /* No score at all: a vault too new to average anything. It gets an
       explanation of what the page will show once there is history, not an
       empty page and not a zero — a zero would be a verdict the data has not
       earned. */
    if (!breakdown) {
      hero.append(el('div', { class: 'score-empty' },
        el('div', { class: 'score-empty-h' }, i18n.t('score.empty.title')),
        el('p', { class: 'score-empty-p' }, i18n.t('score.empty.body'))));
      $('#scoreGoodCard').classList.add('hidden');
      $('#scoreWorkCard').classList.add('hidden');
      renderHow(how);
      return;
    }

    renderHero(hero, breakdown, M);
    renderGood(good, breakdown);
    renderWork(work, breakdown, M, target, earmarks);
    renderHow(how);
  }

  /* ------------------------------- the hero ------------------------------ */
  function renderHero(hero, breakdown, M) {
    const band = breakdown.band;
    const wrap = el('div', { class: `score-hero is-${band}` });

    /* The number, its band, and a ring drawn as a plain bar rather than an SVG
       arc: the arc buys nothing a reader cannot read off a bar, and every SVG
       on this page would have to bake its colours in at render time (see the
       theme-flip note in views/dashboard.js). */
    wrap.append(el('div', { class: 'score-big num' }, String(breakdown.total),
      el('small', {}, i18n.t('score.outOf'))));
    wrap.append(el('div', { class: 'score-band' }, i18n.t(`dash.health.${band}`)));
    wrap.append(el('div', { class: 'score-meter', role: 'img',
      'aria-label': i18n.t('score.meterAria', { score: breakdown.total }) },
    el('i', { class: 'score-meter-fill', style: `width:${breakdown.total}%` })));

    const counted = M.countedPeriods;
    wrap.append(el('p', { class: 'score-hero-sub' },
      counted ? i18n.t('score.hero.sub', { count: counted }) : i18n.t('dash.health.subNone')));

    /* The one sentence a reader takes away, pitched at the band they are in
       rather than a single generic line. */
    wrap.append(el('p', { class: 'score-hero-say' }, i18n.t(`score.say.${band}`)));
    hero.append(wrap);

    celebrate(hero, breakdown);
  }

  /* ---------------------------- what is going well ----------------------- */
  function renderGood(good, breakdown) {
    const card = $('#scoreGoodCard');
    const strong = breakdown.pillars.filter(p => p.at >= GOOD_ENOUGH);
    card.classList.toggle('hidden', !strong.length);
    if (!strong.length) { return; }

    const sub = $('#scoreGoodSub');
    if (sub) { sub.textContent = i18n.t('score.good.sub', { count: strong.length }); }

    for (const p of strong) {
      /* Maxed out, or merely close? Both belong in this list — a household at
         97% of its target does not think of itself as failing — but only the
         first has actually finished, and a stamp that meant "nearly" would
         stop meaning anything. */
      const maxed = p.at >= 0.999;
      const name = el('div', { class: 'score-win-name' }, i18n.t(`dash.health.why.name.${p.key}`));
      if (maxed) {
        name.append(el('span', { class: 'score-win-ribbon' }, i18n.t('score.win.fullMarks')));
      }
      good.append(el('div', { class: `score-win${maxed ? ' is-maxed' : ''}` },
        /* The badge carries the icon AND the score, so the celebration and the
           figure behind it are one object rather than a tick beside a number. */
        el('span', { class: 'score-win-badge', 'aria-hidden': 'true' },
          icoEl(maxed ? 'award|medal|circle-check' : 'circle-check|check-circle')),
        el('div', { class: 'score-win-body' }, name,
          el('div', { class: 'score-win-say' }, i18n.t(`score.win.${p.key}`)),
          el('div', { class: 'score-win-pts num' },
            i18n.t('dash.health.why.points', { points: p.shownPoints, max: p.shownMax })))));
    }
  }

  /* --------------------------- what would move it ------------------------ */
  function renderWork(work, breakdown, M, target, earmarks) {
    const card = $('#scoreWorkCard');
    const gaps = breakdown.pillars.filter(p => p.at < GOOD_ENOUGH);
    card.classList.toggle('hidden', !gaps.length);
    if (!gaps.length) { return; }

    for (const p of gaps) {
      const row = el('div', { class: 'score-gap' });
      row.append(el('div', { class: 'score-gap-h' },
        el('div', { class: 'score-gap-name' }, i18n.t(`dash.health.why.name.${p.key}`)),
        el('div', { class: 'score-gap-pts num' },
          i18n.t('score.gap.points', { points: p.shownLost }))));

      /* Where you are, in the reader's own figures — the same numbers the
         Dashboard tiles show, so moving between the two never means
         re-reading a different measure of the same thing. */
      const now = whereYouAre(p.key, M, target, earmarks);
      if (now) { row.append(el('div', { class: 'score-gap-now' }, now)); }

      /* The concrete step, when there is a figure for it. scoreBreakdown works
         out the gap; this only chooses the sentence. */
      if (p.gap) {
        const g = p.gap;
        const amount = money(g.amount, 0);
        row.append(el('p', { class: 'score-gap-do' },
          g.kind === 'fund' ? i18n.t('dash.health.why.fixFund', { amount, target })
            : g.kind === 'monthly' ? i18n.t('dash.health.why.fixMonthly', { amount, pct: Math.round(FULL_MARKS.savingsRate * 100) })
              : g.kind === 'interest' ? i18n.t('dash.health.why.fixInterest', { amount })
                : g.kind === 'trim' ? i18n.t('dash.health.why.fixTrim', { amount, pct: Math.round(FULL_MARKS.consumptionFloor * 100) })
                  : i18n.t('dash.health.why.fixBuild', { amount, times: FULL_MARKS.netWorthMultiple })));
      }

      /* And the part a figure cannot give: how anyone actually does this.
         `score.guide.*`, not `score.how.*` — the latter is the one-line
         definition of what the pillar measures, used in the method section
         below. Two different jobs; one key name serving both was a collision
         waiting to print the wrong sentence in one of the two places. */
      row.append(el('p', { class: 'score-gap-how' }, i18n.t(`score.guide.${p.key}`)));
      work.append(row);
    }
  }

  /* The reader's current standing on one pillar, or null where the vault has
     nothing to state. Deliberately the SAME figures the Dashboard tiles carry. */
  function whereYouAre(key, M, target, earmarks) {
    const pct = v => `${Math.round(v * 100)}%`;
    if (key === 'reserves') {
      return M.months === null ? null : i18n.t('score.now.reserves', {
        months: M.months.toFixed(1), target, amount: money(earmarks.total, 0),
      });
    }
    if (key === 'saving') {
      return M.savingsRate === null ? null
        : i18n.t('score.now.saving', { pct: pct(M.savingsRate), amount: money(M.monthlySavings || 0, 0) });
    }
    if (key === 'debt') {
      return M.interestShare === null ? null
        : i18n.t('score.now.debt', { pct: pct(M.interestShare) });
    }
    if (key === 'spending') {
      const bits = [];
      if (M.fixedShare !== null) { bits.push(i18n.t('score.now.fixed', { pct: pct(M.fixedShare) })); }
      if (M.consumptionShare !== null) { bits.push(i18n.t('score.now.living', { pct: pct(M.consumptionShare) })); }
      if (M.budgetUsed !== null) { bits.push(i18n.t('score.now.budget', { pct: pct(M.budgetUsed) })); }
      return bits.length ? bits.join(' · ') : null;
    }
    return M.netWorthMultiple === null ? null
      : i18n.t('score.now.wealth', {
        times: M.netWorthMultiple.toFixed(2), amount: money(M.netWorth || 0, 0),
      });
  }

  /* ----------------------------- the method ------------------------------ */
  function renderHow(how) {
    how.append(el('p', { class: 'score-how-intro' }, i18n.t('dash.health.why.intro')));
    how.append(el('p', { class: 'score-how-intro' }, i18n.t('dash.health.why.bands', {
      strong: SCORE_BANDS.strong, steady: SCORE_BANDS.steady, strongLess: SCORE_BANDS.strong - 1,
    })));
    const list = el('div', { class: 'score-how-rows' });
    /* Straight off PILLARS, so a pillar added to the score cannot be forgotten
       here — the page would otherwise explain four of five and look complete. */
    for (const p of PILLARS) {
      list.append(el('div', { class: 'score-how-row' },
        el('div', { class: 'score-how-name' }, i18n.t(`dash.health.why.name.${p.key}`)),
        el('div', { class: 'score-how-weight num' }, i18n.t('score.how.worth', { points: p.weight })),
        el('div', { class: 'score-how-note' }, i18n.t(`score.how.${p.key}`))));
    }
    how.append(list);
    how.append(el('p', { class: 'score-how-foot' }, i18n.t('score.how.foot')));
  }

  /* ----------------------------- celebration ----------------------------- */
  /* Confetti, on the way in, when there is something real to celebrate.

     CSS keyframes rather than requestAnimationFrame, for two reasons. rAF is
     starved to nothing while the pane is hidden or backgrounded, which would
     leave a half-drawn shower frozen on screen the moment a reader switched
     tabs. And a CSS animation is compositor-driven, which on the iOS 15 floor
     is the difference between smooth and a slideshow.

     Nothing is celebrated on a page that has nothing to say: a household with
     no pillar at full marks gets the page without the shower, because confetti
     over a page listing five gaps reads as mockery. */
  function celebrate(hero, breakdown) {
    const wins = breakdown.pillars.filter(p => p.at >= GOOD_ENOUGH).length;
    if (!wins) { return; }
    /* Asked live rather than cached: a reader who turns the system setting on
       mid-session means it now, not at next reload. */
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') { return; }

    const burst = el('div', { class: 'score-confetti', 'aria-hidden': 'true' });
    /* More pieces for more wins, capped: this is punctuation, not weather. */
    const pieces = Math.min(36, 12 + wins * 6);
    for (let i = 0; i < pieces; i++) {
      /* Spread, delay and drift are derived from the index rather than drawn at
         random, so the same score celebrates the same way twice — a shower that
         reshuffles on every re-render reads as a glitch. */
      const left = ((i * 37) % 100);
      const delay = ((i % 6) * 90);
      const drift = ((i % 5) - 2) * 24;
      const spin = 180 + ((i % 4) * 120);
      burst.append(el('i', {
        class: `score-confetti-bit tone-${i % 4}`,
        style: `left:${left}%;animation-delay:${delay}ms;--bud-drift:${drift}px;--bud-spin:${spin}deg`,
      }));
    }
    hero.append(burst);
    /* Taken down rather than left in the DOM. The card re-renders on a period
       change and a vault reload, and a page that quietly accumulated a hundred
       spent confetti nodes would be this view's own slow leak. */
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(() => { if (burst.remove) { burst.remove(); } }, 2600);
    }
  }

  ctx.provide({ renderScore });
};
