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
const { periodFlow, railSegments } = require('../money-flow');
const { sharePercentLabel } = require('../share-percents');
const { savedFromOutside } = require('../savings-math');

/* A pillar counts as "going well" a little below the top. Demanding 100% would
   put a household at 97% of its target in the same list as one at 4%, which is
   not a distinction anyone recognises in their own finances. */
const GOOD_ENOUGH = 0.9;

module.exports = function registerScore(ctx) {
  const {
    S, $, root, money, healthSnapshot, periodMonthName, currentPeriod,
    periodSpend, periodSummary, budgetTotals, catType, declaredCatType, accountIndex,
    txInPeriod, locale,
  } = ctx;

  function renderScore() {
    const hero = $('#scoreHero');
    const good = $('#scoreGood');
    const work = $('#scoreWork');
    if (!hero) { return; }
    hero.empty(); good.empty(); work.empty();

    /* Independent of the score breakdown below — the flow card describes what
       THIS period's income did, which a vault too new to average six periods
       can still answer. Rebuilt fresh every render (remove-then-append) the
       same way hero/good/work are emptied-then-rebuilt; the shell has no
       static container for this card, so the node itself is the thing that
       gets thrown away and remade rather than a div that gets emptied. */
    renderFlowCard();

    const snap = healthSnapshot();
    const { metrics: M, breakdown, target, earmarks } = snap;
    const debtsRecorded = snap.debtsRecorded;
    /* Debts listed, but not one of them states a rate — so the debt pillar can
       only be standing on its instalments, and "Nothing is lost to interest"
       would be a claim about a figure nobody supplied. */
    const debtRateUnknown = debtsRecorded && snap.debtInterest === null;

    /* No score at all. It gets an explanation of what the page needs, not an
       empty page and not a zero — a zero would be a verdict the data has not
       earned.

       TWO DIFFERENT REASONS, and telling a household the wrong one is worse
       than saying nothing. A vault too new to average anything needs history.
       A vault with six months of history and no recognised income needs the
       income, and "not enough history yet" would send it looking for periods
       it already has. The second case exists because most of the score is
       measured AGAINST income — saving, spending, debt and wealth are all
       shares of it — so financialScore refuses to report at all when too
       little of the household is live (see MIN_LIVE_WEIGHT). */
    if (!breakdown) {
      const noHistory = !M || !M.countedPeriods;
      hero.append(el('div', { class: 'score-empty' },
        el('div', { class: 'score-empty-h' },
          i18n.t(noHistory ? 'score.empty.title' : 'score.empty.unmeasured.title')),
        /* Same reason as the trend card's empty state on the Dashboard: a
           manual household has no Import page in front of them, so "import a
           statement" names a move they cannot make. Read at render time off
           the loaded setting, so flipping it is enough. */
        el('p', { class: 'score-empty-p' },
          i18n.t(noHistory
            ? (S.settings.input_mode === 'manual' ? 'score.empty.body.manual' : 'score.empty.body')
            : 'score.empty.unmeasured.body'))));
      $('#scoreGoodCard').classList.add('hidden');
      $('#scoreWorkCard').classList.add('hidden');
      return;
    }

    renderHero(hero, breakdown, M, target, earmarks, snap.otherCurrencies);
    renderGood(good, breakdown, debtsRecorded, debtRateUnknown);
    renderWork(work, breakdown, M, target, earmarks);
  }

  /* ------------------------------- the hero ------------------------------ */
  function renderHero(hero, breakdown, M, target, earmarks, otherCurrencies) {
    const band = breakdown.band;
    const wrap = el('div', { class: `score-hero is-${band}` });

    /* The number, its band and all five parts, together — Ruan's call after
       the segmented bar shipped and read as hard to follow: one ring says in
       a glance what the bar said in a row of unlabelled rectangles. The
       number and band move INTO the ring's own centre; the meter and the
       supporting lines stay below it exactly as they were. */
    wrap.append(buildScoreRing(breakdown, M, target, earmarks));

    wrap.append(el('div', { class: 'score-meter', role: 'img',
      'aria-label': i18n.t('score.meterAria', { score: breakdown.total }) },
    el('i', { class: 'score-meter-fill', style: `width:${breakdown.total}%` })));

    const counted = M.countedPeriods;
    wrap.append(el('p', { class: 'score-hero-sub' },
      counted ? i18n.t('score.hero.sub', { count: counted }) : i18n.t('dash.health.subNone')));

    /* ISSUE 30. Every pillar of this score is a RATIO — months of cover,
       savings rate, instalment share, net-worth multiple — and a ratio built
       across currencies does not overstate, it inverts: a rand emergency fund
       over a rupiah-polluted spend average showed "0.0 months" in red where
       the true reading was 6.7 in green, and the total fell 26 points. Both
       legs are taken inside one currency now (health-data.js), which means
       this page is scoring PART of the household's money — and a score that
       silently ignores an account is exactly the silent exclusion
       currency.js:14 rules out. Reuses the Dashboard's wording rather than a
       second sentence for the same fact. */
    if (otherCurrencies && otherCurrencies.length) {
      wrap.append(el('p', { class: 'score-hero-sub' },
        i18n.t('dash.foreignExcluded', {
          count: otherCurrencies.length,
          symbols: otherCurrencies.map(([sym]) => sym).join(' · '),
        })));
    }

    /* The one sentence a reader takes away, pitched at the band they are in
       rather than a single generic line. */
    wrap.append(el('p', { class: 'score-hero-say' }, i18n.t(`score.say.${band}`)));

    /* What the standalone "How the score is built" card used to carry, minus
       everything the ring beside it already says.

       That card explained five parts in a table of name / worth / sentence —
       but the legend right above prints every one of those names, and "12 of
       25" IS the weight, so two thirds of it was the ring restated in prose
       further down the page. Only two facts were its own: the band scale, and
       that an unanswerable part is left out rather than counted as zero. They
       are footnotes to the number, so they read as footnotes to it. The
       per-pillar sentences moved into the rows themselves — see the legend
       in buildScoreRing, where a part explains itself at the moment a reader
       asks about that part rather than in a list of five they must match up
       by eye. */
    wrap.append(el('p', { class: 'score-hero-note' }, i18n.t('dash.health.why.bands', {
      strong: SCORE_BANDS.strong, steady: SCORE_BANDS.steady, strongLess: SCORE_BANDS.strong - 1,
    })));
    wrap.append(el('p', { class: 'score-hero-note' }, i18n.t('score.how.foot')));
    hero.append(wrap);

    celebrate(hero, breakdown);
  }

  /* ------------------------------ the ring -------------------------------
     r=120, stroke-width 26, rotated -90° so length 0 sits at 12 o'clock
     rather than 3. Read PILLARS' own weight order off railSegments() — same
     data the old bar read, still true that the widths sum to 100 and the
     fills sum to the score, just drawn as arcs instead of rectangles. */
  const RING_R = 120, RING_CX = 150, RING_CY = 150, RING_STROKE = 26, RING_GAP = 6;
  const RING_C = 2 * Math.PI * RING_R;
  const RING_NS = 'http://www.w3.org/2000/svg';

  /* The point at raw path-length `len` along a circle of radius RING_R
     centred on (RING_CX, RING_CY), BEFORE the <g>'s own -90° rotation is
     applied — the transform rotates whatever this returns exactly the same
     way it rotates the <circle> elements, so a path built from this lines up
     with them without hand-applying the rotation twice. */
  function ringPoint(len) {
    const theta = len / RING_R;
    return [RING_CX + RING_R * Math.cos(theta), RING_CY + RING_R * Math.sin(theta)];
  }

  /* An SVG arc `d` spanning exactly one segment's own length, for the "earned
     nothing" case — a <path>, not a dashed <circle>: a dash pattern on a full
     circle repeats all the way round, which would put danger-red dashes
     across every OTHER segment too. The designer's mockup hit exactly this
     and drew a path instead; this is that fix, generalised to any segment. */
  function ringZeroPath(startLen, len) {
    const [x0, y0] = ringPoint(startLen);
    const [x1, y1] = ringPoint(startLen + len);
    const large = len / RING_R > Math.PI ? 1 : 0;
    return `M ${x0.toFixed(2)},${y0.toFixed(2)} A ${RING_R},${RING_R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }

  function buildScoreRing(breakdown, M, target, earmarks) {
    const wrap = el('div', { class: 'score-ring-wrap' });
    const segs = railSegments(breakdown);
    if (!segs.length) { return wrap; }

    /* One row per part, built once and read by the SVG, the legend AND the
       ring centre's tap-to-focus swap — the exact figures and words can never
       drift apart because there is only one place any of them reads from,
       the same discipline the flow card's buildFlowRows keeps. */
    const rows = segs.map(s => {
      const at = s.at || 0;
      const cls = at >= 0.999 ? 'is-full' : at <= 0.001 ? 'is-none' : 'is-partial';
      return {
        key: s.key, width: s.width, fill: s.fill, at, cls,
        name: i18n.t(`dash.health.why.name.${s.key}`),
        now: whereYouAre(s.key, M, target, earmarks),
        /* What this part MEASURES, as opposed to `now`, which is where the
           household stands in it. Read straight off the same score.how.<key>
           strings the removed "How the score is built" card printed, so the
           explanation did not get rewritten on the way here — it just moved
           to where the part itself is. */
        how: i18n.t(`score.how.${s.key}`)
          /* Audit finding #1: "months of essential spending" names a divisor
             that is defined nowhere on screen — NON_ESSENTIAL_TYPES plus
             whatever the vault's own Non-essential groups setting adds
             (health-math.js's own comment on essentialTotal). A reader
             cannot tell whether 3.9 months means 3.9 months of their real
             life without knowing what was left OUT of it. i18n wave:
             score.how.reserves.essentialDef added to lang/en.js and all six
             sibling tables. */
          + (s.key === 'reserves' ? ' ' + i18n.t('score.how.reserves.essentialDef') : ''),
      };
    });

    /* Track lengths share (RING_C minus one gap per segment) in proportion
       to weight — the same "widths sum to 100" guarantee railSegments already
       carries, just measured in arc units instead of percent. Fill lengths
       are `at` (the UNROUNDED fraction) of each segment's OWN track length,
       not shownPoints/shownMax of it — see money-flow.js's own note on why
       that pairing is the one that cannot visibly disagree with the rounded
       numbers printed beside it. */
    const totalWeight = rows.reduce((s, r) => s + r.width, 0) || 100;
    const usable = RING_C - rows.length * RING_GAP;
    const perWeight = usable / totalWeight;
    let cum = 0;
    const laid = rows.map(r => {
      const trackLen = r.width * perWeight;
      const laidRow = { ...r, trackLen, trackStart: cum };
      cum += trackLen + RING_GAP;
      return laidRow;
    });

    const parts = laid.map(r => `${r.name} ` + i18n.t('dash.health.why.points', { points: r.fill, max: r.width }));
    const ariaAll = i18n.t('score.ring.aria', { score: breakdown.total, parts: parts.join(', ') });

    const svg = document.createElementNS(RING_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 300 300');
    svg.setAttribute('class', 'score-ring');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', ariaAll);
    const g = document.createElementNS(RING_NS, 'g');
    g.setAttribute('transform', `rotate(-90 ${RING_CX} ${RING_CY})`);
    g.setAttribute('stroke-width', String(RING_STROKE));
    svg.append(g);
    const addArc = (tag, attrs) => {
      const n = document.createElementNS(RING_NS, tag);
      for (const [k, v] of Object.entries(attrs)) { if (v !== null && v !== undefined) { n.setAttribute(k, v); } }
      g.append(n);
      return n;
    };

    const segEls = [];
    // Tracks first (background), then fills/zero-hairlines on top.
    for (const r of laid) {
      segEls.push(addArc('circle', {
        class: 'score-ring-seg score-ring-track', 'data-k': r.key,
        cx: RING_CX, cy: RING_CY, r: RING_R, fill: 'none',
        'stroke-dasharray': `${r.trackLen.toFixed(2)} ${(RING_C - r.trackLen).toFixed(2)}`,
        'stroke-dashoffset': (-r.trackStart).toFixed(2),
      }));
    }
    for (const r of laid) {
      if (r.cls === 'is-none') {
        segEls.push(addArc('path', {
          class: 'score-ring-seg score-ring-zero', 'data-k': r.key, fill: 'none',
          d: ringZeroPath(r.trackStart, r.trackLen),
        }));
        continue;
      }
      const fillLen = r.trackLen * r.at;
      const to = -r.trackStart;
      const from = -(r.trackStart + fillLen);
      segEls.push(addArc('circle', {
        class: `score-ring-seg score-ring-fill ${r.cls}`, 'data-k': r.key,
        cx: RING_CX, cy: RING_CY, r: RING_R, fill: 'none',
        'stroke-dasharray': `${fillLen.toFixed(2)} ${(RING_C - fillLen).toFixed(2)}`,
        'stroke-dashoffset': to.toFixed(2),
        style: `--seg-from:${from.toFixed(2)};--seg-to:${to.toFixed(2)}`,
      }));
    }

    /* Created here rather than at the end beside its children: the hover
       wiring below measures and class-toggles it, and a closure reaching
       forward to a `const` declared later works only by TDZ timing. */
    const hold = el('div', { class: 'score-ring-hold' });

    /* What a part says when the reader points at it: the SAME three things
       its legend row prints — name, points, and whereYouAre — read off `laid`
       rather than re-derived, so the ring and the list beside it can never
       describe one pillar two ways. No new lang keys either: both halves are
       strings the legend already renders in all twelve languages. */
    const tipPts = r => i18n.t('dash.health.why.points', { points: r.fill, max: r.width });

    /* Hover is a capability question, not a screen-size one — the rule
       views/savings.js states for the worth chart, kept here for the same
       reason. Where there is a fine pointer, a readout that follows the
       cursor carries a name, a score and a sentence; where there is not
       (every phone, which is where this plugin mostly lives) each segment
       keeps the native <title> that touch-and-hold has always shown, and no
       hover-only affordance is invented for a finger. Never both: two
       tooltips for one segment is worse than either. */
    const hoverable = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const tipBox = el('div', { class: 'score-ring-tip', 'aria-hidden': 'true' });
    const tipName = el('div', { class: 'score-ring-tip-name' });
    const tipPtsEl = el('div', { class: 'score-ring-tip-pts num' });
    const tipNow = el('div', { class: 'score-ring-tip-now' });
    const tipHow = el('div', { class: 'score-ring-tip-how' });
    tipBox.append(tipName, tipPtsEl, tipNow, tipHow);

    if (hoverable) {
      /* The holder's box and the readout's own size, taken once per hovered
         part rather than once per pointermove. Null until the first enter,
         which is what the move handler's guard reads. */
      let hostBox = null, tipW = 0, tipH = 0;

      /* Keyed on data-k, so the TRACK and the fill arc of one pillar are one
         hover target between them: the grey remainder of a part is still that
         part, and a reader pointing at the half of "Emergency cover" it has
         not earned yet must not fall through to nothing. */
      const hotten = key => {
        hold.classList.toggle('is-hover', !!key);
        for (const seg of segEls) {
          seg.classList.toggle('is-hot', !!key && seg.getAttribute('data-k') === key);
        }
      };
      for (const seg of segEls) {
        seg.addEventListener('pointerenter', () => {
          const r = laid.find(x => x.key === seg.getAttribute('data-k'));
          if (!r) { return; }
          hotten(r.key);
          tipName.textContent = r.name;
          tipPtsEl.textContent = tipPts(r);
          tipNow.textContent = r.now || '';
          tipHow.textContent = r.how || '';
          tipBox.classList.add('is-on');
          /* Measured HERE, once, not on every pointermove. Reading
             getBoundingClientRect/offsetWidth forces a synchronous layout, and
             doing it per mouse-move — on a box whose text was just rewritten —
             is the layout thrash a profile of this page actually caught: three
             forced reflows per pixel of travel. The readout's size can only
             change when its CONTENT does, and that is this handler; the
             holder's box can only change on a scroll or resize, neither of
             which can happen without the pointer leaving the ring first. */
          hostBox = hold.getBoundingClientRect();
          tipW = tipBox.offsetWidth;
          tipH = tipBox.offsetHeight;
        });
      }
      /* Positioned from the POINTER, not from the arc: a segment can be a
         quarter of the ring long and a readout parked at its midpoint ends up
         nowhere near the cursor. Measured at pointer time — the one moment
         the ring is guaranteed to be on screen, which is what keeps this
         clear of the standing rule against measuring a hidden tab. */
      svg.addEventListener('pointermove', e => {
        if (!tipBox.classList.contains('is-on') || !hostBox) { return; }
        const box = hostBox, tw = tipW, th = tipH;   // measured on enter — see above
        const x = e.clientX - box.left, y = e.clientY - box.top;
        /* Kept inside the holder rather than parked exactly on the pointer:
           the box is centred on `left`, so a part near either edge would
           otherwise hang half the readout off the card. Guarded for a box
           wider than the holder — there the clamp would invert and pin it to
           the wrong side, so it just centres. */
        const half = tw / 2;
        tipBox.style.left = `${tw >= box.width ? box.width / 2 : Math.max(half, Math.min(box.width - half, x))}px`;
        /* Above the pointer where there is room, below it where there is not:
           the top of the ring sits ~40px below the holder's own top edge, and
           a readout anchored above it there would be off the card entirely. */
        tipBox.classList.toggle('is-below', y - th - 14 < 0);
        tipBox.style.top = `${y}px`;
      });
      svg.addEventListener('pointerleave', () => {
        hotten(null);
        tipBox.classList.remove('is-on');
        hostBox = null;   // a measurement must never outlive the hover it was taken for
      });
    } else {
      for (const seg of segEls) {
        const r = laid.find(x => x.key === seg.getAttribute('data-k'));
        if (!r) { continue; }
        const t = document.createElementNS(RING_NS, 'title');
        t.textContent = r.now ? `${r.name} — ${tipPts(r)} · ${r.now}` : `${r.name} — ${tipPts(r)}`;
        seg.append(t);
      }
    }

    const midNum = el('div', { class: 'score-ring-num num' });
    const midBand = el('div', { class: 'score-ring-band' });
    const showTotal = () => {
      midNum.empty();
      midNum.append(String(breakdown.total), el('small', {}, i18n.t('score.outOf')));
      midBand.className = 'score-ring-band';
      midBand.textContent = i18n.t(`dash.health.${breakdown.band}`);
    };
    const showPart = r => {
      midNum.empty();
      midNum.append(String(r.fill));
      midBand.className = 'score-ring-band is-part';
      midBand.textContent = r.name;
    };
    /* The centre is a real button too — tapping it clears the focused part
       the same as tapping that part's own row again does. Always labelled
       with the "show all" action rather than only while focused: idle, the
       action is a no-op (already showing all), but the label stays true
       either way and the control does not need its own extra state to track. */
    const midBtn = el('button', {
      type: 'button', class: 'score-ring-mid', 'aria-label': i18n.t('score.ring.showAll'),
    }, midNum, midBand);
    showTotal();

    const legend = el('div', { class: 'score-ring-legend' },
      el('p', { class: 'score-ring-hint' }, i18n.t('score.ring.hint')));
    const buttons = [];

    /* Dims every OTHER segment (both tracks and fills/zero-hairlines) and
       swaps the centre between the total and one part's own figure. Direct
       classList/attribute writes on the elements actually built above,
       rather than a CSS cascade keyed off a per-pillar modifier class: that
       would need one rule per PILLARS entry and silently stop covering a
       sixth pillar the day one is added, where this covers whatever
       `rows` actually holds. No :has() either way — the iOS 15 floor this
       page already keeps. */
    function applyFocus(key) {
      wrap.classList.toggle('is-focus', !!key);
      for (const seg of segEls) {
        seg.classList.toggle('is-dim', !!key && seg.getAttribute('data-k') !== key);
      }
      for (const btn of buttons) {
        btn.setAttribute('aria-pressed', btn.getAttribute('data-k') === key ? 'true' : 'false');
      }
      const row = key ? laid.find(r => r.key === key) : null;
      if (row) { showPart(row); midBtn.classList.add('is-part'); } else { showTotal(); midBtn.classList.remove('is-part'); }
    }
    midBtn.addEventListener('click', () => applyFocus(null));

    for (const r of rows) {
      const nameEl = el('span', { class: 'score-ring-row-name' }, r.name);
      if (r.cls === 'is-full') {
        nameEl.append(el('span', { class: 'score-ring-row-tag' }, i18n.t('score.win.fullMarks')));
      }
      const bodyKids = [nameEl];
      if (r.now) { bodyKids.push(el('span', { class: 'score-ring-row-now' }, r.now)); }
      /* What this part measures, revealed by the tap that focuses it — the
         one place the removed method card's prose now lives on a phone.
         Rendered always and shown by CSS off aria-pressed rather than
         appended on click: the row's pressed state is already the single
         source of truth for "this part is the one being asked about", and a
         second JS path toggling the same idea is how the two drift. */
      if (r.how) { bodyKids.push(el('span', { class: 'score-ring-row-how' }, r.how)); }
      const btn = el('button', {
        type: 'button', class: `score-ring-row ${r.cls}`, 'aria-pressed': 'false', 'data-k': r.key,
      },
        el('span', { class: `score-ring-dot ${r.cls}`, 'aria-hidden': 'true' }),
        el('span', { class: 'score-ring-row-body' }, ...bodyKids),
        el('span', { class: 'score-ring-row-pts num' },
          i18n.t('dash.health.why.points', { points: r.fill, max: r.width })));
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') === 'true';
        applyFocus(on ? null : r.key);
      });
      buttons.push(btn);
      legend.append(btn);
    }

    hold.append(svg, midBtn);
    // Only where it can ever be shown — see the hover-capability note above.
    if (hoverable) { hold.append(tipBox); }
    wrap.append(hold, legend);
    return wrap;
  }

  /* ---------------------------- what is going well ----------------------- */
  function renderGood(good, breakdown, debtsRecorded, debtRateUnknown) {
    const card = $('#scoreGoodCard');
    /* Best first. These arrive sorted by biggest shortfall, which is right for
       renderWork below and backwards here — it sank the pillars carrying the
       full-marks crown to the bottom of the celebration card. */
    const strong = breakdown.pillars.filter(p => p.at >= GOOD_ENOUGH)
      .slice().sort((a, b) => b.at - a.at || b.max - a.max);
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
          icoEl(maxed ? 'crown|award|medal' : 'circle-check|check-circle')),
        el('div', { class: 'score-win-body' }, name,
          /* The debt win is the only one that can rest on an absence rather
             than an achievement. Where nothing is recorded it says so, instead
             of congratulating a household on a fact the vault never saw. */
          el('div', { class: 'score-win-say' },
            i18n.t(p.key === 'debt' && !debtsRecorded ? 'score.win.debtNone'
              : p.key === 'debt' && debtRateUnknown ? 'score.win.debtNoRate'
                : `score.win.${p.key}`)),
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

      /* The rail again, this time as ONE pillar's own points: solid = what is
         already earned, hatched = what closing the gap buys. Percentages are
         of the PILLAR's own shownMax, not of the overall 100 — the same
         percentages score.js already has on `p` from scoreBreakdown, so
         nothing here re-derives a fraction the breakdown did not already
         compute. */
      row.append(buildGapRail(p));

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

      /* The one page whose entire purpose is "what would move it most" used
         to hand out instructions with nowhere to act on them — the reserves
         guide above literally says "on the Accounts page" without a way to
         get there. Every gap names a page that can actually change the
         figure, wired through the same ctx.switchView every other
         cross-page jump in this app already uses (compare the Dashboard's
         health-fig-btn). `saving` and `reserves` both land on Accounts —
         funding the fund and starting a saving habit are the same first
         action, opening or marking an account — `debt` on Debts, `spending`
         on Services (subscriptions and debit orders are what the guide text
         actually points at), `wealth` on Savings, where net worth's own
         moving parts live. */
      const GAP_DESTS = { reserves: 'accounts', saving: 'accounts', debt: 'debts', spending: 'services', wealth: 'savings' };
      const dest = GAP_DESTS[p.key];
      if (dest) {
        /* TODO(i18n): ideally `score.gap.goto` = "Go to {page}" — one string
           reused across all five rows with the destination's own `nav.*`
           label interpolated in — but that key does not exist yet and this
           lane cannot add one (tests/i18n.test.cjs enforces key parity
           across all 7 languages, so a key added to en.js alone goes RED).
           Reusing the destination's own already-translated `nav.*` label
           gets a real button into every language today rather than shipping
           an untranslated one; whoever owns src/lang/*.js can add the
           richer phrasing and swap this one line later. */
        row.append(el('button', {
          type: 'button', class: 'btn-ghost btn-ghost-sm score-gap-go',
          onclick: () => ctx.switchView(dest),
        }, i18n.t(`nav.${dest}`)));
      }
      work.append(row);
    }
  }

  /* One pillar's own rail: solid up to what is already earned, hatched from
     there to its own full marks. `p` is a `breakdown.pillars` entry, already
     carrying `shownPoints`/`shownMax` from scoreBreakdown — the same two
     numbers "score.gap.points" above already prints, so the rail cannot show
     a gap the text does not. */
  function buildGapRail(p) {
    const max = p.shownMax || 0;
    const pts = Math.max(0, Math.min(max, p.shownPoints || 0));
    const pct = max > 0 ? (pts / max) * 100 : 0;
    const aria = i18n.t('score.gap.railAria', {
      name: i18n.t(`dash.health.why.name.${p.key}`), points: pts, max,
    });
    return el('div', { class: 'score-gap-rail', role: 'img', 'aria-label': aria },
      el('i', { class: 'score-gap-rail-now', style: `left:0;width:${pct}%` }),
      el('i', { class: 'score-gap-rail-gain', style: `left:${pct}%;width:${100 - pct}%` }));
  }

  /* The reader's current standing on one pillar, or null where the vault has
     nothing to state. Deliberately the SAME figures the Dashboard tiles carry. */
  function whereYouAre(key, M, target, earmarks) {
    /* sharePercentLabel, not a bare Math.round — ISSUE 37, and the same rule
       the flow chips further down already take. */
    const pct = v => `${sharePercentLabel(v, locale().decimal)}%`;
    if (key === 'reserves') {
      if (M.months === null) { return null; }
      const base = i18n.t('score.now.reserves', {
        months: M.months.toFixed(1), target, amount: money(earmarks.total, 0),
      });
      /* Audit finding #1's second half: the reader is told they have "3.9
         months covered" but never told what a month of "essential" spending
         actually costs — the number they are being measured against stays
         invisible. M.months !== null already guarantees M.monthlyEssential
         is a real figure (health-math's `months` is only ever set alongside
         it), so no extra null-guard is needed here. i18n wave:
         score.now.reserves.essentials added to lang/en.js and all six
         sibling tables. */
      return `${base} ${i18n.t('score.now.reserves.essentials', { amount: money(M.monthlyEssential, 0) })}`;
    }
    if (key === 'saving') {
      if (M.savingsRate === null) { return null; }
      /* A household really can take more out of its savings than it put in over
         a window, and that is worth saying — but it cannot save a NEGATIVE
         share of its income, and "-19% of income saved · R -8 203 a month" is
         not a sentence that can be true. Said the way round it happened, with
         the magnitude positive. The pillar scores 0 either way, so nothing
         about the number in the ring moves; this is only about the sentence
         under it not contradicting itself. */
      /* 2026-08-25: UNREACHABLE as of the 1.23.1 netting revert — M.monthlySavings
         is health-data.js's six-period average of savedFromOutside(), which sums
         only positive inflows arriving from OUTSIDE the pool (see that function's
         own header for why netting every outflow against them was tried and
         reverted). A sum of non-negative rows divided by a positive period count
         cannot be negative, so this branch never fires today. Left in place, and
         the i18n keys with it: this is load-bearing again the moment savedFromOutside
         goes back to netting outflows, which its own header names as a real
         temptation ("a sinking fund doing its job" reads as dis-saving under that
         rule) — deleting the dead branch now would silently reintroduce the bug
         this file's own comment above already warns "-19% of income saved" is not
         a sentence that can be true. */
      if (M.monthlySavings < 0) {
        return i18n.t('score.now.savingDown', { amount: money(Math.abs(M.monthlySavings), 0) });
      }
      return i18n.t('score.now.saving', { pct: pct(M.savingsRate), amount: money(M.monthlySavings || 0, 0) });
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

  /* ------------------------- where the money went ------------------------ */
  /* "Where the money went" — the money-flow card that closes the page. The
     score is the page's answer and leads; the wins, the gaps and how the score
     is built explain it; the money picture is the context underneath all of
     that, so it comes last (Ruan, 23 Aug 2026). Lives
     entirely outside the hero/good/work/how containers shell.js hands out,
     because there is no static container for it: shell.js is off limits for
     id churn (shell-contract.test.cjs counts them), so the card is built here
     at render time and appended after the last static card, the same way a
     view that owns its own markup always has. Removed and rebuilt on every
     render rather than emptied-in-place, because there is nothing durable to
     empty — see the note on renderScore() above. */
  function renderFlowCard() {
    const view = $('#view-score');
    const heroCard = $('#scoreHeroCard');
    if (!view || !heroCard) { return; }
    const old = view.querySelector('.score-flow-card');
    if (old && old.remove) { old.remove(); }
    view.appendChild(buildFlowCard(buildFlow()));
  }

  /* This period's income, split into committed & fixed bills, living costs,
     saving and what is not yet spent — money-flow.js's periodFlow(), fed the
     SAME raw material health-data.js assembles for the score (periodSummary,
     periodSpend, budgetTotals, splitFlows, S.categories' own `fixed` flag),
     just for one period instead of the trailing six. Nothing about "what
     counts as committed" or "what counts as saving" is decided twice — see
     the header comment in money-flow.js for why that matters. */
  function buildFlow() {
    const cur = currentPeriod();
    const summary = periodSummary(cur);
    const spend = periodSpend(cur, null);
    const budget = budgetTotals(cur);
    const fixedCats = new Set(S.categories.filter(c => c.fixed).map(c => c.name));

    /* Contributions into savings/investment accounts THIS period — the same
       signal health-data.js averages over six periods for the score's own
       saving pillar, read here for one. */
    /* THE SAME "saved" THE SCORE MEANS, from the same function.

       This used to read splitFlows' gross contributions, which counts every
       arrival in a pool account including one that came from another pool
       account. On a real vault it reported R4 270 saved in a period whose only
       movement was R4 270 travelling from a baby fund into an emergency fund,
       while the score's ring on the very same screen counted that as nothing.
       The window differs on purpose — this card is one period, the ring is six
       — but the MEASURE must not, or the two are not comparable at all. */
    const idx = accountIndex();
    /* Case-folded and trimmed against the account's own type, not compared
       raw — the exact trap health-data.js:147-148 (POOL_TYPES) already names:
       `load.js` only defaults `type` when the key is ABSENT, so a hand-typed
       `type: Savings` reached here exactly as written and dropped out of this
       card's saver pool while the score ring two lines below (buildFlow calls
       into health-data.js) kept counting the same account — the flow card and
       the ring disagreeing about the same period on the same screen. Kept as
       its own copy here rather than a shared helper, same as views/savings.js's
       own `typeIs` — health-data.js and this file are siblings, not a shared
       module, and each carries this comment for a reader who lands in only one
       of them. */
    const savers = S.accounts.filter(a =>
      ['savings', 'investment'].includes(String((a && a.type) || '').trim().toLowerCase()));
    const saverLabels = new Map();
    for (const a of savers) {
      for (const L of ((idx.get(a) || {}).labels || [])) { saverLabels.set(L, a); }
    }
    /* ISSUE 32 — the same third argument health-data.js passes, so this card
       and the score it explains cannot pair rows differently. */
    const savingContribution = savedFromOutside(txInPeriod(cur), saverLabels, declaredCatType);

    return periodFlow({
      /* ISSUE 40 follow-up. `budgetSetAside` passed, so the Score's "share of
         income budgeted" is the WHOLE plan the Dashboard and the Budget page
         state (41%), not the spend envelopes alone (30%). Its "budget used"
         still divides by the spend envelopes — see periodFlow's header. */
      income: summary.income, spentTotal: summary.spend,
      budgeted: budget.spend, budgetSetAside: budget.setAside,
      spendByCat: spend.whole, fixedCats, catType, savingContribution, debts: S.debts,
      /* The household's own symbol, so this card's "of which interest" holds
         foreign debts out exactly the way the breakdown beneath it (and the
         Debt page it links to) already does — see money-flow.js's own note on
         `interestRaw`, which is the second copy of that one figure. */
      household: S.settings.currency,
      /* "Allocated of income" is a question about the PLAN, so it is measured
         against the income the plan states — the same rule, from the same
         helper, the Dashboard's "N% allocated" uses. This card always draws
         the running period, so it is never a finished one. */
      budgetIncome: budget.income, periodFinished: false,
    });
  }

  /* The four band descriptors, built ONCE and read by both the desktop Sankey
     and the phone's stacked-bar fallback — the exact figures they show can
     never drift apart because there is only one place either of them reads
     from. */
  function buildFlowRows(flow) {
    const b = flow.bands, d = flow.committedDetail, lefts = flow.lefts;
    const pct = v => `${v}%`;
    /* `amount` stays the raw band (zero tests and geometry read it); `display`
       is money-flow's reconciled rand figure and is what every printed label
       uses, so the four rows sum to the headline the way their percents
       already do — see the note on displayBands in money-flow.js. Same split
       for the sub-line's two lefts, whose printed pair must add up to the
       "Together" row on the chip below. */
    return [
      {
        key: 'committed', cls: 'is-committed',
        name: i18n.t('score.flow.committed'), amount: b.committed, display: b.display.committed, pct: b.percents.committed,
        sub: d.debtRepayments > 0
          ? i18n.t('score.flow.sub.committedDebt', { pct: pct(b.percents.committed), amount: money(d.debtRepayments, 0) })
          : i18n.t('score.flow.sub.pctOfIncome', { pct: pct(b.percents.committed) }),
      },
      {
        key: 'living', cls: 'is-living',
        name: i18n.t('score.flow.living'), amount: b.living, display: b.display.living, pct: b.percents.living,
        sub: i18n.t('score.flow.sub.pctOfIncome', { pct: pct(b.percents.living) }),
      },
      {
        key: 'saving', cls: 'is-saving',
        name: i18n.t('score.flow.saving'), amount: b.saving, display: b.display.saving, pct: b.percents.saving,
        sub: b.saving > 0
          ? i18n.t('score.flow.sub.pctOfIncome', { pct: pct(b.percents.saving) })
          : i18n.t('score.flow.sub.savingZero'),
      },
      {
        key: 'notYetSpent', cls: 'is-notYetSpent',
        name: i18n.t('score.flow.notYetSpent'), amount: b.notYetSpent, display: b.display.notYetSpent, pct: b.percents.notYetSpent,
        sub: i18n.t('score.flow.sub.notYetSpent', {
          inBudget: money(lefts.display.leftInBudget, 0), neverBudgeted: money(lefts.display.neverBudgeted, 0),
        }),
      },
    ];
  }

  function buildFlowCard(flow) {
    const rows = buildFlowRows(flow);
    const card = el('div', { class: 'card mb-4 score-flow-card' });
    card.append(el('div', { class: 'card-h' },
      el('div', {},
        el('h2', {}, i18n.t('score.flow.title')),
        el('div', { class: 'sub' }, i18n.t('score.flow.sub')))));

    const body = el('div', { class: 'body-pad' });
    body.append(el('div', { class: 'score-flow-top' },
      el('div', { class: 'score-flow-eyebrow' }, i18n.t('score.flow.moneyIn')),
      el('div', { class: 'score-flow-in num' }, money(flow.income, 0),
        el('small', {}, i18n.t('score.flow.thisPeriod')))));

    /* Nothing has HAPPENED yet is a different picture from a picture with
       nothing IN it. With no income at all, every band is exactly zero and a
       Sankey drawn from four zero-height bands is not a chart, it is four
       labels fighting for the same few pixels — see buildFlowSankey's own
       hardening below for what that looked like when it shipped in 1.22.0.
       With income but nothing spent or saved yet, the chart would technically
       render (one full-width "not yet spent" band), but it draws a whole
       page of chrome around a single fact one sentence already states.
       Neither state gets a chart; both get one honest line instead, in the
       shape of the page's own `score-empty-p` pattern. */
    const noIncome = flow.income <= 0;
    const noSpend = !noIncome && flow.budget.spentTotal <= 0.005 && flow.bands.saving <= 0.005;
    if (noIncome || noSpend) {
      body.append(el('p', { class: 'score-empty-p score-flow-empty' },
        noIncome ? i18n.t('score.flow.empty.noIncome')
          : i18n.t('score.flow.empty.noSpend', { amount: money(flow.income, 0) })));
    } else {
      /* Both trees always render; styles.css decides which one is on screen
         via a plain `@media (max-width: 560px)` swap — no container query, so
         the floor stays iOS 15. The Sankey is the one thing on this page that
         cannot survive the squeeze: a 960-unit viewBox at a phone's ~360px
         CSS width turns 13px label text into ~5px. */
      body.append(el('div', { class: 'score-flow-sankey-wrap' }, buildFlowSankey(flow, rows)));
      body.append(el('div', { class: 'score-flow-mobile-wrap' }, buildFlowMobile(rows)));
    }
    body.append(buildFlowChips(flow));

    card.append(body);
    return card;
  }

  /* The desktop picture: an inline SVG with the income on the left and the
     four bands running to the right of it. Ribbons are drawn as plain rects
     rather than curved sankey ribbons — deliberately: the source-side slice
     and the destination-side slice are stacked in the SAME order, so a real
     sankey curve would bow between two points at the same height and draw a
     straight line anyway. Colours are CSS classes reading the sealed
     palette's custom properties (`.score-flow-rib.is-committed` etc in
     styles.css), never resolved in JS — an SVG respects the stylesheet's
     var() the same as any other element, so there is nothing here for
     chart.js's themeColors() to do. */
  function buildFlowSankey(flow, rows) {
    const W = 960;
    const PAD_T = 14, PAD_B = 14, GAP = 8, NODE_W = 14, RIB_X0 = NODE_W, DEST_X = 460, DEST_W = 14;
    const LABEL_X = DEST_X + DEST_W + 20;

    /* Hardened against ever being called with four zero-height bands — the
       caller above already skips this entirely for that case, but a chart
       that only behaves when its caller behaves is a chart waiting to ship
       the bug that shipped in 1.22.0: a plot proportioned for real bands
       collapsed every row into an 8px-apart cluster near the top, so four
       13px text labels piled on top of each other, the income node rendered
       as a barely-visible stub, and the SVG still reserved a full 280-unit
       plot's worth of dead space beneath the cluster. Here "nothing to draw"
       gets a full ROW_H of vertical room per row instead of a GAP's worth,
       and the viewBox shrinks to fit that instead of always claiming 280. */
    const allZero = rows.every(r => r.pct <= 0 && Math.abs(r.amount) < 0.005);
    const ROW_H = 40;
    const H = allZero ? PAD_T + PAD_B + rows.length * ROW_H : 280;
    const innerH = H - PAD_T - PAD_B - GAP * (rows.length - 1);

    /* Proportion the plot against what the bands ACTUALLY come to, not a hard
       100. They are percentages of income, and in any overspent period they
       sum past it — a state this app supports and argues about elsewhere via
       periodDeficit. Dividing by 100 regardless walked `y` straight out of the
       viewBox: at a 124% sum a real R5 000 saving band, its name and its
       amount all laid out below y=280 and were clipped away entirely, so the
       reader saw three bands where there were four. The printed percentages
       stay exactly as money-flow reported them; only the geometry is scaled. */
    const pctSum = rows.reduce((s, r) => s + Math.max(0, r.pct), 0);
    const pctSpan = Math.max(100, pctSum);

    let y = PAD_T;
    const laid = rows.map(r => {
      let h = allZero ? 0 : Math.max(0, (r.pct / pctSpan) * innerH);
      /* A real band under ~1.3% of income (3 of this plot's 228 usable units)
         rounds to under 3px tall and used to fall into the "measured, and it
         was nothing" hairline below purely on pixel count — R700 of R60,000
         saved rendered as the exact same zero line as R0 saved, with "R700 ·
         1%" printed beside it. `r.h < 3` was a rendering threshold standing
         in for a zero test it never actually performed. A genuinely non-zero
         band gets a 3-unit floor instead, so it still reads as a sliver
         rather than vanishing into the hairline meant for a true zero. */
      if (h > 0 && h < 3) { h = 3; }
      const top = y, bottom = y + h;
      y = allZero ? top + ROW_H : bottom + GAP;
      return { ...r, top, bottom, h };
    });
    const plotTop = laid[0].top, plotBottom = laid[laid.length - 1].bottom;

    /* The reconciled display figures, not the raw bands — the aria-label is
       the whole chart for a screen-reader user, and four figures that sum one
       rand past the income they follow is the donut aria-label defect
       (share-percents.js's header) in rand instead of percent. */
    const label = i18n.t('score.flow.ariaLabel', {
      income: money(flow.income, 0),
      committed: money(flow.bands.display.committed, 0),
      living: money(flow.bands.display.living, 0),
      saving: money(flow.bands.display.saving, 0),
      notYetSpent: money(flow.bands.display.notYetSpent, 0),
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    svg.setAttribute('class', 'score-flow-sankey');
    const add = (tag, attrs = {}) => {
      const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) { if (v !== null && v !== undefined) { n.setAttribute(k, v); } }
      svg.append(n);
      return n;
    };

    add('rect', { x: 0, y: plotTop, width: NODE_W, height: Math.max(1, plotBottom - plotTop), rx: 4, class: 'score-flow-node' });

    for (const r of laid) {
      /* The zero band: money-flow.js's own comment on `notYetSpent` argues a
         period that spent everything it earned must not draw a slice that
         implies a rand went somewhere it didn't — the same argument applies
         to any of the four bands reading exactly zero, not only saving. A
         hairline says "measured, and it was nothing" where an absent band
         would just look like a rendering bug.

         Gated on the AMOUNT, not on the pixel height `r.h < 3` used to test:
         that was a rendering threshold wearing a zero test's job, and it
         fired for any band under ~1.3% of income — a real R700 of R60,000
         saved drew the exact same hairline as R0 saved, tagged `.is-zero`
         beside it. `buildFlowMobile` already gates its own zero row this
         way; this brings the desktop tree into line with it. A genuinely
         small but non-zero band still gets its 3-unit floor from the `laid`
         mapping above, so it renders as a sliver rather than a hairline. */
      if (Math.abs(r.amount) < 0.005) {
        const midY = (r.top + r.bottom) / 2;
        add('line', { x1: RIB_X0, x2: DEST_X + DEST_W, y1: midY, y2: midY, class: 'score-flow-zero' });
        add('text', { x: LABEL_X, y: midY + 4, class: 'score-flow-name' }).textContent = r.name;
        add('text', { x: W - 8, y: midY + 4, 'text-anchor': 'end', class: 'score-flow-amt is-zero' }).textContent =
          i18n.t('score.flow.amountPct', { amount: money(r.display, 0), pct: `${r.pct}%` });
        continue;
      }
      add('rect', { x: RIB_X0, y: r.top, width: DEST_X + DEST_W - RIB_X0, height: r.h, rx: 4, class: `score-flow-rib ${r.cls}` });
      add('text', { x: LABEL_X, y: r.top + 18, class: 'score-flow-name' }).textContent = r.name;
      add('text', { x: W - 8, y: r.top + 18, 'text-anchor': 'end', class: 'score-flow-amt' }).textContent =
        i18n.t('score.flow.amountPct', { amount: money(r.display, 0), pct: `${r.pct}%` });
      if (r.h >= 34) {
        add('text', { x: LABEL_X, y: r.top + 34, class: 'score-flow-caption' }).textContent = r.sub;
      }
    }
    return svg;
  }

  /* The phone picture: the same four rows as proportional bars, no SVG — see
     the comment on buildFlowCard() for why the Sankey cannot make this
     squeeze. Reads the exact same `rows` the desktop tree built, so nothing
     about a band's figure is re-derived for the narrow layout. */
  function buildFlowMobile(rows) {
    const wrap = el('div', { class: 'score-flow-mobile' });
    /* Same span the Sankey lays out against, for the same reason: a band over
       100% of income would otherwise be given a width wider than its own
       track. Scaled, not clamped — clamping would draw two different
       overspends at an identical full width. */
    const pctSpan = Math.max(100, rows.reduce((s, r) => s + Math.max(0, r.pct), 0));
    for (const r of rows) {
      const zero = Math.abs(r.amount) < 0.005;
      const row = el('div', { class: `score-flow-m-row${zero ? ' is-zero' : ''}` });
      row.append(el('div', { class: 'score-flow-m-head' },
        el('span', { class: 'score-flow-m-name' }, r.name),
        el('span', { class: 'score-flow-m-amt num' }, money(r.display, 0))));
      row.append(zero
        ? el('div', { class: 'score-flow-m-bar is-empty' })
        : el('div', { class: 'score-flow-m-bar' }, el('i', { class: r.cls, style: `width:${(Math.max(0, r.pct) / pctSpan) * 100}%` })));
      row.append(el('div', { class: 'score-flow-m-sub' }, r.sub));
      wrap.append(row);
    }
    return wrap;
  }

  /* The three small tables under the flow: what committed breaks down into,
     the budget comparison, and the two different "left" figures — every
     number pulled straight off `flow`, nothing recomputed. */
  function buildFlowChips(flow) {
    const d = flow.committedDetail, bud = flow.budget, lefts = flow.lefts;
    const wrap = el('div', { class: 'score-flow-chips' });

    /* Nothing flagged fixed at ALL is a different question from "flagged, but
       nothing landed there this period": the first is an unanswered setup
       step (three ¥0 rows under it read as broken rather than as "you have
       not told us yet"), the second is a real ¥0 the household actually
       produced and the rows stay, honest per the shared rule. Read off
       S.categories the SAME way buildFlow()'s own `fixedCats` Set is built,
       so the empty state and the table it replaces can never disagree about
       which case the vault is in. */
    const hasFixedCats = S.categories.some(c => c.fixed);
    /* Nothing here to show is a different question from nothing here to
       EXPLAIN. Even with categories properly flagged fixed, a table of four
       ¥0 rows says nothing the MONEY IN figure above did not already say —
       drop it rather than pad the page with zeros nobody asked to see.
       `flow.bands.committed` is the same total the sub-chips below sum to at
       most (money-flow.js), so checking it once here cannot disagree with
       what the rows themselves would have shown. */
    const committedAllZero = flow.bands.committed <= 0.005;
    if (!hasFixedCats) {
      /* Audit finding #2: nothing in the app SET `fixed: true` — the empty
         state told the reader to hand-edit the category file, but said
         nothing about the SCORE. `fixedShare` (health-math.js) is a third of
         the Spending pillar's own weight, so a household that never finds
         this setting is quietly losing points on a page they have never
         seen, with nothing here or on the Score ring saying so. i18n wave:
         score.flow.committed.empty.scoreNote added to lang/en.js and all six
         sibling tables, appended rather than folded into the existing
         score.flow.committed.empty key so that key's own callers elsewhere
         are unaffected.

         The YAML-editing half of that finding is now fixed too: the Budget
         page (views/budgets.js) carries a per-row fixed-bill toggle, and
         promptCreateCategory (categories.js) offers the same flag up front
         when a category is created. score.flow.committed.empty's own COPY
         was updated to point at the toggle instead of at hand-edited
         frontmatter — this branch's logic (S.categories.some(c => c.fixed),
         same read buildFlow()'s own fixedCats Set uses) needed no change:
         it was always correct once something set the flag, it just had no
         supported way to be set. */
      wrap.append(buildChipEmpty(i18n.t('score.flow.chip.committed'),
        `${i18n.t('score.flow.committed.empty')} ${i18n.t('score.flow.committed.empty.scoreNote')}`));
    } else if (!committedAllZero) {
      const committedRows = [[i18n.t('score.flow.chip.debtRepayments'), money(d.debtRepayments, 0)]];
      if (d.interest > 0) { committedRows.push([i18n.t('score.flow.chip.ofWhichInterest'), money(d.interest, 0), true]); }
      committedRows.push([i18n.t('score.flow.chip.housing'), money(d.housing, 0)]);
      committedRows.push([i18n.t('score.flow.chip.subscriptions'), money(d.subscriptions, 0)]);
      if (d.other > 0) { committedRows.push([i18n.t('score.flow.chip.other'), money(d.other, 0)]); }
      wrap.append(buildChip(i18n.t('score.flow.chip.committed'), committedRows));
    }

    /* Kept unconditionally — budgeted can be non-zero even on a period with
       no income or no spend yet, and that comparison is exactly what a
       reader opening the page early in a period wants to see. */
    const budgetRows = [[i18n.t('score.flow.chip.budgeted'), money(bud.budgeted, 0)]];
    if (bud.allocatedOfIncome !== null) {
      budgetRows.push([i18n.t('score.flow.chip.allocatedOfIncome'), `${sharePercentLabel(bud.allocatedOfIncome, locale().decimal)}%`]);
    }
    budgetRows.push([i18n.t('score.flow.chip.spent'), money(bud.spentTotal, 0)]);
    if (bud.budgetUsed !== null) {
      budgetRows.push([i18n.t('score.flow.chip.budgetUsed'), `${sharePercentLabel(bud.budgetUsed, locale().decimal)}%`]);
    }
    /* The DISCLOSURE half of "declared" (tests/vocabulary.test.cjs's
       GAP A — "Budget used", twice, on one page). This chip's own
       `budgetUsed` and the ring above it (score.now.budget) now share one
       numerator rule (money-flow.js excludes the same savings/investment
       spend health-math.js's consumptionForBudget always has), but they
       still answer different WINDOWS on purpose — this period here, a
       six-period trailing average up in the ring — and a reader who
       glances at both and sees two different percentages under the same
       three words deserves to be told why, the same way the Budget page's
       own income/spend tiles disclose their narrower reading right under
       the number (Terms 3-4 in that same test file). Shown only when the
       row above it actually rendered — a note explaining a figure that
       is not on screen explains nothing. */
    wrap.append(buildChip(i18n.t('score.flow.chip.budget'), budgetRows,
      bud.budgetUsed !== null ? i18n.t('score.flow.chip.budgetUsedNote') : null));

    /* Same rule as committed: real when any of the three differs from zero —
       an over-budget period reads leftInBudget negative, which is a fact
       worth a row — silent when the household's plan, its spend and its
       income all landed on nothing this period. */
    const leftsAllZero = Math.abs(lefts.leftInBudget) < 0.005
      && Math.abs(lefts.neverBudgeted) < 0.005 && Math.abs(lefts.together) < 0.005;
    if (!leftsAllZero) {
      /* Display figures, not raw — "Together" must be the visible sum of the
         two rows above it, which independent money(v, 0) rounding broke by a
         rand. money-flow.js's displayLefts note has the arithmetic. */
      wrap.append(buildChip(i18n.t('score.flow.chip.lefts'), [
        [i18n.t('score.flow.chip.leftInBudget'), money(lefts.display.leftInBudget, 0)],
        [i18n.t('score.flow.chip.neverBudgeted'), money(lefts.display.neverBudgeted, 0)],
        [i18n.t('score.flow.chip.together'), money(lefts.display.together, 0)],
      ]));
    }

    return wrap;
  }

  /* One chip: the `.mini` KPI-tile look the rest of the app already uses
     (explicitly reusable per the sealed-palette rule) with plain label/value
     rows inside it, rather than a second card component. */
  function buildChip(title, rows, note) {
    const chip = el('div', { class: 'mini score-flow-chip' }, el('div', { class: 'l' }, title));
    for (const [label, value, warn] of rows) {
      chip.append(el('div', { class: `score-flow-row${warn ? ' is-warn' : ''}` },
        el('span', {}, label), el('b', { class: 'num' }, value)));
    }
    /* Optional, and appended AFTER every row rather than under the one row it
       is actually about — `.s` is already the sealed note style every `.mini`
       tile uses under its own value (buildChipEmpty below reuses the same
       class for the same reason), so this needs no new CSS and no per-row
       note slot that the other three chips calling this function do not
       need. */
    if (note) { chip.append(el('div', { class: 's' }, note)); }
    return chip;
  }

  /* The same chip shell with a single sentence instead of rows, for a table
     that has nothing to break down yet — not a numeric zero, an unanswered
     setup step. `.mini .s` is already the sealed note style every other KPI
     tile uses under its own value, so this needs no new CSS. */
  function buildChipEmpty(title, note) {
    return el('div', { class: 'mini score-flow-chip' },
      el('div', { class: 'l' }, title),
      el('div', { class: 's' }, note));
  }

  /* ----------------------------- the method ------------------------------ */

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
    /* THE SCORE decides whether there is anything to celebrate, not the parts.

       This used to fire whenever ANY pillar reached full marks, which is a much
       lower bar than it sounds: a household with no Debts.md scores full marks
       on interest by default (health-math's documented "debt-free" reading), so
       a page that was otherwise all gaps still got a shower. Confetti over a
       58 tells a reader the app is not really looking — and a celebration that
       fires for everyone is one nobody believes when it finally means
       something.

       Read off `breakdown.band`, which is the same word the ring's own centre
       prints, rather than comparing against SCORE_BANDS.strong here: one
       threshold, one place, so the confetti cannot disagree with the label
       sitting inside it about whether this is a strong month. */
    if (breakdown.band !== 'strong') { return; }
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
    /* The PANE, not the card. Parented to the hero the burst was clipped to
       the card's own box — a shower two hundred pixels tall that stopped at a
       rounded corner. #root is position:relative and does not scroll, so this
       covers what the reader is actually looking at. */
    (root || hero).append(burst);
    /* Taken down rather than left in the DOM. The card re-renders on a period
       change and a vault reload, and a page that quietly accumulated a hundred
       spent confetti nodes would be this view's own slow leak. */
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(() => { if (burst.remove) { burst.remove(); } }, 2600);
    }
  }

  ctx.provide({ renderScore });
};
