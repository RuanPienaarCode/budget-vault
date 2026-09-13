'use strict';
/* Plan — money that arrives once, divided on purpose. Saved to Plans/<name>.md.

   WHY THIS IS NOT THE BUDGET PAGE. A budget is a rate: "R 4 000 a month on
   groceries, every period, forever". A plan is a fixed sum that exists once — a
   UIF payout, a tax refund, next month's salary surplus, the pram you sold —
   and the only question it asks is where every rand of it lands. The two share
   categories and nothing else: a budget row that overspends rolls into the next
   period, a plan that overspends has simply run out.

   THE THREE-WAY SPLIT is the page's whole thesis, and every figure on it is
   derived from these four sums, never stored:

     pot        = Σ source.amount                    (what the plan holds)
     allocated  = Σ envelope.amount                  (what has been placed)
     spent      = Σ item.spent                       (what has actually gone)
     free       = pot − allocated                    (what is not spoken for)

   An envelope's amount is NOT the sum of its items. That is deliberate, not a
   gap: you decide "R 12 300 goes to the baby" before you know the four things
   you will buy, and the list underneath is a working breakdown that may not add
   up yet. envelopeGap() surfaces the difference rather than papering over it —
   the alternative (forcing envelope = Σ items) would make the slider useless,
   because every drag would have to invent or delete an item.

   RECEIVED vs EXPECTED. A source dated in the future counts toward the pot but
   not toward what can be spent this afternoon. Keeping those two figures apart
   is the one piece of honesty this page owes: a plan that lets you allocate an
   unpaid refund into a purchase you make today is a plan that overdraws you. */

const { el, keepScroll, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { escMd, patchFrontmatter, yamlStr } = require('../markdown');
const { safeSeg } = require('../vault-path');
const { askFields, confirmModal } = require('../modal');
const { planSummary, barSegments, SOURCE_KINDS, sharePct,
  envelopeOverState, envelopeBar, round2 } = require('../plan-math');
const i18n = require('../i18n');

module.exports = function registerPlan(ctx) {
  const { S, $, app, money, toast, writeFile, fileAt, pathTaken } = ctx;

  const { mark, clear: clearDirty } = ctx.dirtyFlag('planDirty', '#planSave');

  /* Which spending bucket is open in the accordion — collapsed-list-with-one-
     open, per the redesign. Lives here (not on the plan object) because it is
     purely a view-state choice, never written to disk; reset whenever the
     open bucket stops existing (deleted, or a different plan switched in). */
  let expandedEnvelope = null;

  /* Built once, by re-parenting the SAME button elements shell.js/controller.js
     already wired up (so their listeners and the dirtyFlag-driven disabled
     state on #planSave keep working untouched) into the rail the redesign
     calls for: Save primary beside New, Delete demoted to a quiet icon-only
     affordance off to the side rather than sitting red beside Save. Idempotent
     — safe to call on every renderPlan(). */
  function ensureActionsRailV2() {
    if (ctx.root.querySelector('.plan-actions-v2')) return;
    const saveBtn = $('#planSave'), newBtn = $('#planNew'), delBtn = $('#planDelete');
    const oldRow = saveBtn && saveBtn.parentElement;
    if (!saveBtn || !newBtn || !delBtn || !oldRow) return;
    saveBtn.classList.add('btn-sm');
    newBtn.classList.add('btn-sm');
    delBtn.classList.add('plan-del-ico');
    delBtn.setAttribute('aria-label', i18n.t('plan.actions.deleteAria'));
    // Drop the button's own text node ("Delete plan"), keeping its icon span —
    // the aria-label just set carries the same words for a screen reader.
    for (const n of [...delBtn.childNodes]) if (n.nodeType === 3) n.remove();
    const rail = el('div', { class: 'plan-actions-v2', id: 'planActionsV2' },
      el('div', { class: 'plan-actions-rail' }, saveBtn, newBtn),
      delBtn);
    oldRow.replaceWith(rail);
  }

  /* The plan currently on screen. S.planName holds the FILE key (the basename
     under Plans/), not the display name — see the note in load.js on why those
     are kept apart. Every render path goes through this rather than reading
     S.plans[…] directly, so a vault whose open plan was deleted on another
     device renders the empty state instead of throwing. */
  const P = () => (S.planName && S.plans[S.planName]) || null;

  /* ------------------------------- render -------------------------------- */

  function renderPlan() {
    const p = P();
    const has = !!p;
    ensureActionsRailV2();
    updateHeaderTitle(p);
    $('#planEmptyCard').classList.toggle('hidden', has);
    $('#planContent').classList.toggle('hidden', !has);
    renderPlanPicker();
    if (!has) return;
    const sum = planSummary(p);
    renderPot(p, sum);
    renderSources(p, sum);
    renderEnvelopes(p, sum);
    renderFree(p, sum);
  }

  /* The plan's own name becomes the page title, per the redesign — the static
     "Plan" banner is a fine label for the empty state, but once a plan is open
     its name is the only thing on screen worth calling the title. Reverts to
     the i18n-driven default the moment there is no plan, so it never sticks a
     stale name on the empty-state banner. */
  function updateHeaderTitle(p) {
    const h1 = $('#view-plan .financial-period-banner-title');
    if (!h1) return;
    if (p) { h1.removeAttribute('data-i18n'); h1.textContent = p.name; }
    else { h1.setAttribute('data-i18n', 'nav.plan'); h1.textContent = i18n.t('nav.plan'); }
  }

  /* The plan switcher. A segmented control rather than a <select> because the
     count is small by nature — a household runs one or two of these a year —
     and because the active plan's name is the page's only title. */
  function renderPlanPicker() {
    const wrap = $('#planPicker');
    wrap.empty();
    // Sorted by the label the reader sees, keyed by the file underneath.
    const keys = Object.keys(S.plans).sort((a, b) =>
      S.plans[a].name.localeCompare(S.plans[b].name));
    for (const key of keys) {
      const b = el('button', { class: 'plan-seg', type: 'button',
        'aria-pressed': key === S.planName ? 'true' : 'false' }, S.plans[key].name);
      b.addEventListener('click', () => { if (key !== S.planName) changePlan(key); });
      wrap.append(b);
    }
    $('#planPickerWrap').classList.toggle('hidden', keys.length < 2);
  }

  /* ---- the pot: two figures, one bar ----

     THE HERO'S BIG NUMBER IS `placeable`, NOT `free`, and that is the whole of
     the 1.45.0 fix. It used to be `free` (pot − allocated), which is a true
     statement about the buckets and the wrong answer to the question the label
     asks. A live vault on 13 Sep 2026 held R 48 200 with R 28 282 placed and
     R 33 659 actually gone — a second car repair having run its bucket R 5 377
     over — and the page said LEFT TO PLACE R 19 918,00 over a "Still left
     R 14 541,00" set in small italics near the bottom of the key. Both figures
     right; the headline an invitation to place R 5 377 that no longer existed.
     Worse, nothing named the overspend: the hero's alarm state and the loud
     card below both keyed off `free < 0`, and free was +19 918.

     So: the big figure is what can actually be placed, the overspend gets a
     row of its own in the key AND the loud card, and "Still left" is promoted
     out of that italic subtotal into a second hero figure beside the first —
     it is the second thing a reader wants and it was the smallest thing on the
     card.

     The original objection to a permanent second figure stands and is honoured:
     on a FRESH plan "still left" is just the pot restated, the same number
     twice. Hence `showLeft` — it appears once anything has actually been
     spent, which is the point at which it starts saying something the first
     figure does not. */
  function renderPot(p, sum) {
    const host = $('#planPot');
    host.empty();
    /* Widths come from barSegments, NOT from the summary: those three always
       sum to the pot, so the bar can never render clipped or backwards. The
       key underneath still reports the summary's honest figures, and the two
       are identical in every case except an overspent plan — which the
       overspend row and the loud card state in words. */
    const seg = barSegments(sum);
    const pct = v => (sum.pot > 0 ? (v / sum.pot) * 100 : 0);
    const over = sum.placeable < 0;
    /* WHICH KIND of "past the end" this is, because the two need different
       words: buckets claiming more than came in is an allocation someone can
       simply take back, whereas money already out of the account is not. When
       both are true the spending is the one worth saying, because it is the
       one that cannot be undrawn. */
    const overLabel = sum.overspend > 0.005
      ? i18n.t('plan.hero.overSpent') : i18n.t('plan.hero.overPlaced');
    /* WHAT THE SECOND SLOT CARRIES, which is not always the same figure.

       "Still left" is the second thing a reader wants — except on an overspent
       plan, where it is arithmetically forced to equal the first: once the
       buckets have been run past, `placeable` collapses onto `left` and the
       hero would print one number twice. In that state the second most
       important fact is not what remains but how far past the buckets the
       money went, so the slot swaps to it. Nothing is lost by the swap: `left`
       is still on screen, as the first figure. */
    const showOverspend = sum.overspend > 0.005;
    const showLeft = !showOverspend && sum.spent >= 0.005;

    const statusLine = sum.sources === 0 ? null
      : sum.expected <= 0.005 ? i18n.t('plan.hero.allIn')
      : sum.received <= 0.005 ? i18n.t('plan.hero.noneIn')
      : i18n.t('plan.hero.partial', { received: money(sum.received), expected: money(sum.expected) });

    host.append(
      /* The two figures side by side: what you may still place, and what you
         still have. They coincide on an overspent plan — every remaining rand
         is unplaced once the buckets have been run past — and that coincidence
         is itself the reading, not a duplicate to suppress. */
      el('div', { class: 'pot-figs' },
        el('div', { class: 'pot-fig-block' },
          el('div', { class: 'pot-eyebrow' }, over ? overLabel : i18n.t('plan.hero.leftToPlace')),
          el('div', { class: `pot-fig num ${over ? 'text-danger' : 'plan-free-fig'}` },
            money(Math.abs(sum.placeable)))),
        ...(showOverspend
          ? [el('div', { class: 'pot-fig-block pot-fig-block-2' },
              el('div', { class: 'pot-eyebrow pot-eyebrow-danger' }, i18n.t('plan.split.overspent')),
              el('div', { class: 'pot-fig-2 num text-danger' }, money(sum.overspend)))]
          : showLeft
            ? [el('div', { class: 'pot-fig-block pot-fig-block-2' },
                el('div', { class: 'pot-eyebrow' }, i18n.t('plan.split.stillLeft')),
                el('div', { class: `pot-fig-2 num ${sum.left < 0 ? 'text-danger' : ''}` },
                  money(sum.left)))]
            : [])),
      el('div', { class: 'pot-sub' },
        sum.sources === 0
          ? i18n.t('plan.hero.noSources')
          : [i18n.t('plan.hero.ofPot', { pot: money(sum.pot) }), statusLine ? ` · ${statusLine}` : '']),
      /* One bar, three states of the same rand. role=img with the figures in
         the label: a screen reader gets the split as a sentence rather than
         three unlabelled divs, and the visual key below repeats it in text.
         The overspend closes the sentence when there is one — a screen-reader
         user must not have to infer it from two figures that happen to
         disagree. */
      el('div', { class: 'plan-split', role: 'img',
        'aria-label': `Of ${money(sum.pot)}: ${money(sum.spent)} already spent, ` +
          `${money(sum.committed)} allocated but unspent, ${money(sum.free)} not yet allocated. ` +
          `${money(sum.left)} still left, ${money(sum.placeable)} of it still placeable.` +
          (sum.overspend > 0.005 ? ` ${money(sum.overspend)} has been spent beyond what the buckets hold.` : '') },
        el('i', { class: 's-spent', style: `width:${pct(seg.spent)}%` }),
        el('i', { class: 's-alloc', style: `width:${pct(seg.committed)}%` }),
        el('i', { class: 's-free', style: `width:${pct(seg.free)}%` })),
      el('div', { class: 'split-key2' },
        splitRow2(i18n.t('plan.split.spokenFor'), sum.committed, 'var(--color-accent)'),
        splitRow2(i18n.t('plan.split.notSpokenFor'), sum.free, 'var(--color-gold)',
          sum.free < 0 ? 'text-danger' : 'plan-free-fig'),
        splitRow2(i18n.t('plan.split.alreadySpent'), sum.spent, 'var(--color-primary)'),
        /* THE ROW THAT WAS MISSING. Not a fourth band of the bar — there is no
           swatch — but the number that explains why "Not spoken for" above it
           is larger than the figure in the hero. Drawn only when there is one,
           per the same rule the rest of the app follows: an all-clear vault
           gets no shelf standing there saying nothing. */
        ...(sum.overspend > 0.005
          ? [el('div', { class: 'sk2-row sk2-over' },
              el('span', { class: 'sk2-label' }, i18n.t('plan.split.overspent')),
              el('span', { class: 'sk2-fig num text-danger' }, money(sum.overspend)))]
          : [])));
  }

  const splitRow2 = (label, value, swatch, cls = '') => el('div', { class: 'sk2-row' },
    el('span', { class: 'sk2-label' }, el('i', { style: `background:${swatch}` }), label),
    el('span', { class: `sk2-fig num ${cls}` }, money(value)));

  /* ---- money in: a compact read-only ledger, tap a row to edit (variant B) ----

     A source is read far more often than it is edited — the old design gave
     every row three live input fields whether or not the reader wanted to
     touch a single one. This renders each as one ~62px line (name + kind,
     date + status as ink on the same line, amount on the right) and moves
     editing behind a tap into the same field-sheet pattern editItem() below
     already uses, so a source's status can still be flipped by hand exactly
     as before — see the note in addSource() on why that stays tappable. */
  function renderSources(p, sum) {
    const host = $('#planSources');
    keepScroll(host, () => {
      host.empty();
      if (!p.sources.length) {
        host.append(el('div', { class: 'text-muted plan-empty-row' },
          'Nothing funds this plan yet. Add a payout, a refund, a salary surplus — anything.'));
        return;
      }
      const list = el('div', { class: 'src2-list' });
      for (const s of p.sources) {
        const received = s.status === 'received';
        list.append(el('div', { class: 'src2-row' },
          el('button', { class: 'src2-main', type: 'button',
            'aria-label': i18n.t('plan.source.editAria', { name: s.name }),
            onclick: () => editSource(p, s) },
            el('div', { class: 'src2-line1' },
              el('span', { class: 'src2-name' }, s.name),
              el('span', { class: 'kind' }, s.kind || 'Other')),
            el('div', { class: 'src2-line2' },
              el('span', {}, formatSrcDate(s.date)), ' · ',
              el('span', { class: received ? 'src2-status-in' : 'src2-status-exp' },
                received ? i18n.t('plan.source.inAccount') : i18n.t('plan.source.expected')))),
          el('div', { class: `src2-amt num${received ? '' : ' src2-amt-muted'}` }, money(s.amount)),
          el('button', { class: 'btn-ghost btn-ghost-sm src2-del', type: 'button',
            'aria-label': i18n.t('plan.source.removeAria', { name: s.name }),
            onclick: () => removeSource(p, s) }, '✕')));
      }
      host.append(list);
    });
  }

  const SRC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Plain char scan against an ISO date, not a lookbehind: free-text dates
  // (see dateInput's note) fall through to being shown verbatim.
  function formatSrcDate(iso) {
    const s = (iso || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || i18n.t('plan.source.noDate');
    const y = s.slice(0, 4), mi = Number(s.slice(5, 7)) - 1, d = Number(s.slice(8, 10));
    return `${d} ${SRC_MONTHS[mi] || s.slice(5, 7)} ${y}`;
  }

  function removeSource(p, s) {
    p.sources.splice(p.sources.indexOf(s), 1);
    mark(); renderPlan();
  }

  /* The edit sheet a tap on a source row opens. Status is its own field
     rather than re-derived from the date on every save, because the pill this
     replaces let a reader flip received/expected by hand independent of the
     date — "the money arrives early or late", per addSource()'s note — and
     silently recomputing it here would take that back. */
  async function editSource(p, s) {
    const r = await askFields(app, s.name, [
      { key: 'name', label: i18n.t('plan.source.fieldName'), type: 'text', value: s.name },
      { key: 'kind', label: i18n.t('plan.source.fieldKind'), type: 'select', value: s.kind || 'Other',
        options: SOURCE_KINDS, desc: i18n.t('plan.source.fieldKindDesc') },
      { key: 'amount', label: i18n.t('plan.source.fieldAmount'), type: 'number', value: (s.amount || 0).toFixed(2) },
      { key: 'date', label: i18n.t('plan.source.fieldDate'), type: 'date', value: s.date || '',
        desc: i18n.t('plan.source.fieldDateDesc') },
      { key: 'status', label: i18n.t('plan.source.fieldStatus'), type: 'select', value: s.status || 'received',
        options: [
          { value: 'received', label: i18n.t('plan.source.statusReceived') },
          { value: 'expected', label: i18n.t('plan.source.statusExpected') },
        ] },
      { key: 'notes', label: i18n.t('plan.source.fieldNotes'), type: 'text', value: s.notes || '' },
      { key: 'remove', label: i18n.t('plan.source.fieldRemove'), type: 'toggles',
        options: [{ value: 'yes', label: i18n.t('plan.source.fieldRemoveYes') }] },
    ]);
    if (!r) return;
    if ((r.remove || []).includes('yes')) return removeSource(p, s);
    const amount = normalizeAmount(r.amount);
    if (amount === null) return toast('Not a number', true);
    s.name = (r.name || '').trim() || s.name;
    s.kind = r.kind || 'Other';
    s.amount = amount;
    s.date = (r.date || '').trim();
    s.status = r.status === 'expected' ? 'expected' : 'received';
    s.notes = (r.notes || '').trim();
    mark(); renderPlan();
  }

  /* ---- the envelopes: an accordion, one bucket open at a time (variant B) ----

     Five tall cards used to mean five screens of scrolling to see the whole
     allocation at once. Every OTHER bucket collapses to a ~44px summary row
     (name, amount, share); the open one gets the full card — slider, items,
     the lot. expandedEnvelope is pure view state (declared at the top of this
     module) so switching plans or deleting the open bucket can never leave it
     pointing at something that no longer exists — the guard below resets it
     to the first bucket whenever that happens. */
  function renderEnvelopes(p, sum) {
    $('#planEnvSub').textContent = p.envelopes.length
      ? `${p.envelopes.length} spending bucket${p.envelopes.length === 1 ? '' : 's'} · ${money(sum.allocated)} placed of ${money(sum.pot)}`
      : 'Nothing placed yet — a spending bucket is one intent, and the items are what it buys.';
    const host = $('#planEnvelopes');
    host.classList.add('plan-env-accordion');
    keepScroll(host, () => {
      host.empty();
      if (!p.envelopes.length) {
        host.append(el('div', { class: 'text-muted plan-empty-row' },
          'No spending buckets yet.'));
        return;
      }
      if (expandedEnvelope && !p.envelopes.some(e => e.name === expandedEnvelope)) expandedEnvelope = null;
      if (!expandedEnvelope) expandedEnvelope = p.envelopes[0].name;
      for (const e of p.envelopes) {
        host.append(e.name === expandedEnvelope ? envelopeCard(p, e, sum) : envelopeSummaryRow(p, e, sum));
      }
    });
  }

  /* WHAT IS LEFT IN ONE BUCKET, as its collapsed row states it. The amount on
     the right is what was PLACED, and a reader scanning five collapsed rows to
     answer "have I got anything left for the dentist?" could not get there
     without opening each one — the placed figure has not moved since the day
     it was set. Remaining is placed minus gone, so it is a fact about today.

     Derived from the SAME envelopeOverState the expanded card and the live
     drag handler use (remaining is exactly −overAmt), not recomputed here: one
     bucket must never read as R 1 200 left collapsed and R 900 over expanded.

     The wording changes rather than the number alone, because three of these
     states mean genuinely different things and a bare figure conflates them —
     "R 2 000,00 left" on a bucket nothing has been spent from is just the
     placed amount restated in a second place, which is how the hero's own bug
     read on a fresh plan. */
  function envelopeRemainder(state, spent) {
    const remaining = round2(-state.overAmt);
    if (state.isOverspent) return { text: `${money(-remaining)} over`, cls: 'text-danger' };
    if (spent <= 0.005) return { text: i18n.t('plan.env.nothingSpent'), cls: 'text-muted' };
    if (remaining <= 0.005) return { text: i18n.t('plan.env.allSpent'), cls: 'text-muted' };
    return { text: i18n.t('plan.env.leftInBucket', { amount: money(remaining) }), cls: '' };
  }

  /* The collapsed row. Shares envelopeOverState with the expanded card below
     so an overspent/overcommitted bucket reads as such even collapsed — a
     reader scanning the accordion for what needs attention should not have to
     open every row to find it. Two lines now, not one: the placed amount is
     the headline figure on the right, and what is actually left sits under the
     name, where it does not have to compete with it for the same eye. */
  function envelopeSummaryRow(p, env, sum) {
    const items = p.items.filter(i => i.envelope === env.name);
    const spent = items.reduce((t, i) => t + (i.spent || 0), 0);
    const state = envelopeOverState(env.amount, items, spent);
    const rem = envelopeRemainder(state, spent);
    /* The shape of the sentence the remainder just stated. Hidden below 640px
       (styles.css) — on a phone the row has no width to spare and the words
       already carry it; on tablet and desktop the middle column is dead space
       and a reader scanning six buckets for "which one is in trouble" gets it
       from the colour without reading a figure. Never colour ALONE: every
       segment this draws has its figure in words to the left of it. */
    const bar = envelopeBar(env.amount, spent);
    const barEl = el('span', { class: 'env-sum-bar', 'aria-hidden': 'true' },
      el('i', { class: 'esb-spent', style: `width:${bar.spent}%` }),
      el('i', { class: 'esb-left', style: `width:${bar.left}%` }),
      el('i', { class: 'esb-over', style: `width:${bar.over}%` }));
    return el('button', {
      class: `env-sum${state.isOverspent ? ' is-overspent' : ''}${state.isOvercommitted ? ' is-overcommitted' : ''}`,
      type: 'button',
      style: `--tint:${env.tint || 'transparent'}`,
      'aria-label': i18n.t('plan.env.expandAria', { name: env.name }) + ` — ${rem.text}`,
      onclick: () => { expandedEnvelope = env.name; renderPlan(); },
    },
      el('span', { class: 'env-sum-swatch' }),
      el('span', { class: 'env-sum-main' },
        el('span', { class: 'env-sum-name' }, env.name),
        el('span', { class: `env-sum-rem num ${rem.cls}` }, rem.text)),
      barEl,
      el('span', { class: 'env-sum-amt num' }, money(env.amount)),
      el('span', { class: 'env-sum-pct num' }, `${sharePct(env.amount, sum.pot)}%`));
  }

  /* Right-hand side of the rail note: up to two status flags rather than one
     message, because overspent and overcommitted are independent facts and a
     card can be both at once — collapsing them into a single line would
     silently drop whichever lost the if/else. Wording carries the meaning as
     much as colour does (a11y): "over" and "over-committed" are never just a
     swatch. Takes a STATE (from envelopeOverState) rather than an envelope, so
     the drag handler below can call it with the live slider value and get
     back exactly the markup a full render would have produced — one function,
     not a copy kept in sync by hand. */
  function railFlags(state, spent) {
    const { overAmt, isOverspent, gap, isOvercommitted } = state;
    const flags = [];
    if (isOverspent) {
      flags.push(el('span', { class: 'num text-danger env-rail-flag' },
        icoEl(['alert-triangle', 'triangle-alert'], 'env-rail-flag-ico'), `${money(overAmt)} over`));
    }
    if (isOvercommitted) {
      flags.push(el('span', { class: 'num text-warning env-rail-flag' }, `${money(-gap)} over-committed`));
    }
    if (!isOverspent && !isOvercommitted) {
      flags.push(el('span', { class: `num ${gap > 0 ? 'text-warning' : ''}` },
        gap > 0 ? `${money(gap)} unassigned` : spent > 0 ? `${money(spent)} spent` : ''));
    }
    return flags;
  }

  /* The slider's own background, painted as the overshoot: a red segment
     starting exactly where the bucket's own amount sits and ending where the
     money actually stopped — clamped through pctOf so it can never run past
     the track or paint backwards. null on a healthy bucket, so the ordinary
     flat track (styles.css) is untouched: this is the ONE thing that should
     look different, not a redesign of every slider. Same function on first
     render and on every drag tick, for the same reason as railFlags above. */
  function overFillStyle(state, amount, spent, pctOf) {
    if (!state.isOverspent) return null;
    return `background:linear-gradient(90deg, rgba(127,127,127,.2) 0%, rgba(127,127,127,.2) ${pctOf(amount)}%, ` +
      `var(--color-danger) ${pctOf(amount)}%, var(--color-danger) ${pctOf(spent)}%, ` +
      `rgba(127,127,127,.2) ${pctOf(spent)}%, rgba(127,127,127,.2) 100%)`;
  }

  function envelopeCard(p, env, sum) {
    const items = p.items.filter(i => i.envelope === env.name);
    const spent = items.reduce((t, i) => t + (i.spent || 0), 0);
    const state = envelopeOverState(env.amount, items, spent);

    /* The slider's ceiling is this envelope's amount plus everything that can
       still be placed — i.e. the most it could possibly hold without the plan
       going negative. A fixed max would either stop short of what the pot
       allows or invite dragging past it.

       `placeable`, not `free`: free is blind to money already spent out of an
       overspent bucket, so on the 13 Sep 2026 vault this ceiling would have
       let a bucket be dragged R 5 377 past what the plan still had. Same
       figure as the hero, from the same place — the ceiling and the headline
       must never disagree about how much room is left. */
    const ceiling = Math.max(env.amount, env.amount + Math.max(0, sum.placeable), 100);
    const sliderMax = Math.ceil(ceiling);
    const pctOf = v => (sliderMax > 0 ? Math.max(0, Math.min(100, (v / sliderMax) * 100)) : 0);

    const amtEl = el('div', { class: 'env-amt num' }, money(env.amount));
    const shareEl = el('span', { class: 'env-share num' }, `${sharePct(env.amount, sum.pot)}%`);

    const initialFill = overFillStyle(state, env.amount, spent, pctOf);
    const slider = el('input', {
      class: 'env-slider', type: 'range', min: '0', max: String(sliderMax),
      step: '10', value: String(env.amount),
      'aria-label': `Amount allocated to ${env.name}`,
      ...(initialFill ? { style: initialFill } : {}),
    });

    /* Assigned once the elements below exist — the listener is attached now,
       but only FIRES later, by which point both closures-over are set. */
    let card, flagsHost;

    /* input repaints this card's own figures AND its overspend state — cheap,
       and it keeps the drag smooth. What it must NOT do is call renderPlan():
       that is the whole reason `change` exists as a separate, page-wide commit
       below. Before this, dragging a bucket's amount DOWN past what it had
       already spent left the card reading "healthy" until release — the exact
       moment the warning should appear is the moment the drag makes it true,
       not the moment the mouse comes up. envelopeOverState/railFlags/
       overFillStyle are the same three calls the initial render made, just
       fed the live value instead of env.amount, so drag and release can never
       disagree about what a given number means. */
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      amtEl.textContent = money(v);
      shareEl.textContent = `${sharePct(v, sum.pot)}%`;

      const liveState = envelopeOverState(v, items, spent);
      card.classList.toggle('is-overspent', liveState.isOverspent);
      card.classList.toggle('is-overcommitted', liveState.isOvercommitted);
      flagsHost.replaceChildren(...railFlags(liveState, spent));
      const fill = overFillStyle(liveState, v, spent, pctOf);
      if (fill) slider.setAttribute('style', fill); else slider.removeAttribute('style');
    });
    slider.addEventListener('change', () => {
      env.amount = Number(slider.value);
      mark(); renderPlan();
    });

    /* Tap the figure to type it. The slider is the good part of this design and
       also the fiddly part on a phone; without this, a precise amount is
       unreachable by touch and unreachable by keyboard at any sensible step. */
    const amtBtn = el('button', { class: 'env-amt-btn', type: 'button',
      'aria-label': `Set the amount for ${env.name} by typing it`,
      onclick: () => editEnvelopeAmount(env) }, amtEl);

    flagsHost = el('div', { class: 'env-rail-flags' }, ...railFlags(state, spent));

    /* A 3px accent rule stands in for the old radial-gradient tint wash on
       the expanded card only (plan-env-accordion in styles.css switches the
       wash off there) — the wash bled past its own card's rounded corner in
       the accordion's tighter layout, reading as a rendering fault rather
       than a colour cue. Collapsed rows keep the wash-free swatch dot
       instead, so the tint is legible at both sizes without the bleed. */
    const accent = el('div', { class: 'env-accent', style: `background:${env.tint || 'var(--color-primary)'}` });

    /* Delete moves out of the footer into the expanded header's own overflow
       spot — the redesign's rule that a destructive action never sits beside
       an everyday one (Save/rename here). Collapse is the header's other new
       control: tapping it (or another row) is how the accordion closes. */
    card = el('div', {
      class: `env${state.isOverspent ? ' is-overspent' : ''}${state.isOvercommitted ? ' is-overcommitted' : ''}`,
      style: `--tint:${env.tint || 'transparent'}`,
    },
      accent,
      el('div', { class: 'env-top' },
        el('button', { class: 'env-collapse', type: 'button',
          'aria-label': i18n.t('plan.env.collapseAria', { name: env.name }),
          onclick: () => { expandedEnvelope = null; renderPlan(); } },
          icoEl(['chevron-down', 'chevron-up'])),
        el('button', { class: 'env-name', type: 'button',
          'aria-label': `Rename spending bucket ${env.name}`,
          onclick: () => renameEnvelope(p, env) },
          env.name, icoEl(['pencil', 'square-pen', 'pen-line'], 'env-name-ico')),
        shareEl,
        el('button', { class: 'env-del-ico', type: 'button',
          'aria-label': i18n.t('plan.env.deleteAria', { name: env.name }),
          onclick: () => removeEnvelope(p, env) }, icoEl(['trash-2', 'trash']))),
      amtBtn,
      el('div', { class: 'env-rail' },
        slider,
        el('div', { class: 'env-rail-note' },
          el('span', {}, env.note || ''),
          flagsHost)),
      el('ul', { class: 'env-items' },
        ...items.map(i => itemRow(p, i)),
        el('li', { class: 'env-item env-item-add' },
          el('button', { class: 'env-add', type: 'button',
            onclick: () => addItem(p, env.name) }, '＋ item'))),
      el('div', { class: 'env-foot' },
        el('span', { class: 'env-count' },
          items.length
            ? `${items.filter(i => i.status === 'done').length} of ${items.length} done`
            : 'no items yet')));

    return card;
  }

  function itemRow(p, i) {
    const done = i.status === 'done';
    const part = i.status === 'part';
    const tick = el('button', {
      class: `ei-tick ${done ? 'done' : part ? 'part' : ''}`, type: 'button',
      'aria-label': `${i.name}: ${i.status} — click to advance`,
      title: 'planned → part-bought → done',
    }, done ? '✓' : part ? '·' : '');
    /* Three states cycled by tapping, the same gesture Owed and Tax use for
       their statuses. Landing on `done` with nothing recorded as spent copies
       the planned amount across, because "done" and "cost nothing" together are
       almost always a forgotten figure rather than a free purchase. */
    tick.addEventListener('click', () => {
      i.status = done ? 'planned' : part ? 'done' : 'part';
      if (i.status === 'done' && !i.spent) i.spent = i.amount;
      if (i.status === 'planned') i.spent = 0;
      mark(); renderPlan();
    });

    /* A part-bought item shows both figures because neither alone is the
       answer — "R 640" hides that R 260 is still coming, "R 900" hides that
       most of it is already gone. A slash rather than "of": it is two thirds
       the width in a card that is 280px at its narrowest. */
    const right = done || part
      ? el('span', { class: 'ei-actual num' },
          `${money(i.spent)}${part ? ` / ${money(i.amount)}` : ''}`)
      : el('span', { class: 'ei-amt num' }, money(i.amount));

    return el('li', { class: 'env-item' }, tick,
      el('button', { class: `ei-name ${done ? 'done' : ''}`, type: 'button',
        'aria-label': `Edit ${i.name}`, onclick: () => editItem(p, i) }, i.name),
      right);
  }

  /* ---- what is not spoken for: the only card that is deliberately loud ----

     THREE states, not two. It used to key off `sum.free` alone, which meant an
     overspent plan — money gone past what its buckets hold, `free` still
     comfortably positive — got the CHEERFUL card inviting the reader to place
     more. That was the loudest part of the 13 Sep 2026 report: the one card on
     the page whose whole job is to raise its voice sat there encouraging the
     reader to spend money that was already gone. */
  function renderFree(p, sum) {
    const card = $('#planFree');
    const overspent = sum.overspend > 0.005;
    const overplaced = sum.free < -0.005;
    /* A finished split makes this card disappear rather than saying "R 0.00
       left" — an all-clear vault gets no shelf standing there saying nothing,
       the same rule the Accounts deck follows. An overspend keeps it on screen
       whatever the split looks like: that is never nothing to say. */
    const show = overspent || Math.abs(sum.free) >= 0.005;
    card.classList.toggle('hidden', !show);
    if (!show) return;
    const over = overspent || overplaced;
    card.classList.toggle('is-over', over);
    card.empty();

    const heading = overspent
      ? `${money(sum.overspend)} more has been spent than these buckets hold`
      : overplaced
        ? `${money(-sum.free)} more is placed than this plan holds`
        : `${money(sum.free)} is not spoken for`;
    /* The percentage is of the figure the heading just quoted, not always of
       `free` — quoting one number and then taking a share of a different one
       is how the rest of this repo's two-figures-one-rule bugs started. */
    const shareOf = overspent ? sum.overspend : Math.abs(sum.free);
    /* "of which R 9 341,00 can still be placed" beside "that leaves R 9 341,00"
       is the same number twice in one sentence — and on an overspent plan it
       always IS the same number, because placeable collapses onto left the
       moment committed clamps to zero. So the clause changes rather than the
       figure being printed again. */
    const allUnplaced = Math.abs(sum.placeable - sum.left) < 0.005;
    const body = overspent
      ? `The buckets hold ${money(sum.allocated)} but ${money(sum.spent)} has actually gone. `
        + `That leaves ${money(sum.left)} in this plan, `
        + (allUnplaced ? 'all of it unplaced'
          : `of which ${money(Math.max(0, sum.placeable))} can still be placed`)
        + ` — not the ${money(sum.free)} the buckets alone suggest. `
        + 'Raise the bucket that ran over, or record where the extra came from.'
      : overplaced
        ? 'The spending buckets add up to more than the money coming in. Take some back out, or add the source that covers it.'
        : 'Leaving money unplaced is a decision too — but it should be one you made, not one you forgot.';

    card.append(
      el('h2', {}, heading),
      el('div', { class: 'free-fig num' }, `${sharePct(shareOf, sum.pot)}% of the plan`),
      el('p', {}, body),
      el('div', { class: 'free-acts' },
        /* The button offers `placeable`, never `free` — it was the second
           place the overstated figure reached the reader, and the one that
           would have written it into a bucket. */
        ...(over || sum.placeable <= 0.005 ? [] : [el('button', { class: 'btn-gradient', type: 'button',
          onclick: () => addEnvelope(p, sum.placeable) }, 'Put it in a new spending bucket')]),
        el('button', { class: 'btn-ghost', type: 'button',
          onclick: () => addSource(p) }, '＋ Add a source')));
  }

  /* ------------------------------ actions -------------------------------- */

  async function addSource(p = P()) {
    if (!p) return;
    const r = await askFields(app, 'New source', [
      { key: 'name', label: 'What is it?', type: 'text', placeholder: 'UIF maternity payout' },
      { key: 'kind', label: 'Kind', type: 'select', options: SOURCE_KINDS, value: 'Other',
        desc: 'A label for grouping only — it changes nothing about the arithmetic.' },
      { key: 'amount', label: 'Amount', type: 'number', value: '0' },
      { key: 'date', label: 'When does it land?', type: 'date',
        desc: 'A date in the future counts toward the plan, but not toward what you can spend today.' },
    ]);
    if (!r || !r.name.trim()) return;
    const amount = normalizeAmount(r.amount);
    if (amount === null) return toast('Not a number', true);
    /* Status is concluded from the date, not asked for separately: two ways to
       say the same thing is two ways to disagree, and the date is the one the
       arithmetic actually needs. It stays tappable afterwards for the case the
       money arrives early or late. */
    const date = (r.date || '').trim();
    const status = date && date > todayIso() ? 'expected' : 'received';
    p.sources.push({ name: r.name.trim(), kind: r.kind || 'Other', amount, date, status, notes: '' });
    mark(); renderPlan();
  }

  async function addEnvelope(p = P(), suggested = 0) {
    if (!p) return;
    const r = await askFields(app, 'New spending bucket', [
      { key: 'name', label: 'What is this money for?', type: 'text', placeholder: 'For the baby' },
      { key: 'amount', label: 'How much goes in it?', type: 'number',
        value: suggested > 0 ? suggested.toFixed(2) : '0' },
      { key: 'note', label: 'Note (optional)', type: 'text' },
    ]);
    if (!r || !r.name.trim()) return;
    const name = r.name.trim();
    if (p.envelopes.some(e => e.name === name)) return toast('That spending bucket already exists', true);
    const amount = normalizeAmount(r.amount);
    if (amount === null) return toast('Not a number', true);
    p.envelopes.push({ name, amount, note: (r.note || '').trim(), tint: nextTint(p) });
    // Open the one you just made, rather than leaving the reader to find its
    // collapsed row among the others in the accordion.
    expandedEnvelope = name;
    mark(); renderPlan();
  }

  async function renameEnvelope(p, env) {
    const r = await askFields(app, 'Rename spending bucket', [
      { key: 'name', label: 'Name', type: 'text', value: env.name },
      { key: 'note', label: 'Note', type: 'text', value: env.note || '' },
    ]);
    if (!r || !r.name.trim()) return;
    const name = r.name.trim();
    if (name !== env.name) {
      if (p.envelopes.some(e => e.name === name)) return toast('That spending bucket already exists', true);
      // Items key off the envelope NAME, so a rename that skipped this would
      // orphan every item in it — they would vanish from the page while still
      // sitting in the file.
      for (const i of p.items) if (i.envelope === env.name) i.envelope = name;
      env.name = name;
    }
    env.note = (r.note || '').trim();
    mark(); renderPlan();
  }

  async function editEnvelopeAmount(env) {
    const r = await askFields(app, env.name, [
      { key: 'amount', label: 'Amount in this spending bucket', type: 'number', value: env.amount.toFixed(2) },
    ]);
    if (!r) return;
    const amount = normalizeAmount(r.amount);
    if (amount === null) return toast('Not a number', true);
    env.amount = amount;
    mark(); renderPlan();
  }

  async function removeEnvelope(p, env) {
    const items = p.items.filter(i => i.envelope === env.name);
    const ok = await confirmModal(app, {
      title: `Remove ${env.name}?`,
      message: items.length
        ? `${items.length} item${items.length === 1 ? '' : 's'} inside it will be removed too. The money goes back to unplaced.`
        : 'The money goes back to unplaced.',
      confirmText: 'Remove',
    });
    if (!ok) return;
    p.items = p.items.filter(i => i.envelope !== env.name);
    p.envelopes.splice(p.envelopes.indexOf(env), 1);
    mark(); renderPlan();
  }

  async function addItem(p, envelope) {
    const r = await askFields(app, `New item in ${envelope}`, [
      { key: 'name', label: 'What is it?', type: 'text', placeholder: 'Pram & car seat' },
      { key: 'amount', label: 'What do you expect it to cost?', type: 'number', value: '0' },
      { key: 'category', label: 'Budget category (optional)', type: 'text',
        desc: 'Used when this lands as a real transaction.' },
    ]);
    if (!r || !r.name.trim()) return;
    const amount = normalizeAmount(r.amount);
    if (amount === null) return toast('Not a number', true);
    p.items.push({ name: r.name.trim(), envelope, amount, spent: 0,
      status: 'planned', category: (r.category || '').trim(), notes: '' });
    mark(); renderPlan();
  }

  async function editItem(p, item) {
    const r = await askFields(app, item.name, [
      { key: 'name', label: 'Item', type: 'text', value: item.name },
      { key: 'amount', label: 'Planned', type: 'number', value: item.amount.toFixed(2) },
      { key: 'spent', label: 'Actually spent', type: 'number', value: (item.spent || 0).toFixed(2),
        desc: 'Leave at 0 until the money has actually gone.' },
      { key: 'envelope', label: 'Spending bucket', type: 'select',
        options: p.envelopes.map(e => e.name), value: item.envelope },
      { key: 'category', label: 'Budget category', type: 'text', value: item.category || '' },
      { key: 'notes', label: 'Notes', type: 'text', value: item.notes || '' },
      // `toggles` resolves to an ARRAY of the values switched on — not an
      // object keyed by them. One entry here, so the array is the whole answer.
      { key: 'remove', label: 'Remove this item', type: 'toggles',
        options: [{ value: 'yes', label: 'Remove it' }] },
    ]);
    if (!r) return;
    if ((r.remove || []).includes('yes')) {
      p.items.splice(p.items.indexOf(item), 1);
      mark(); return renderPlan();
    }
    const amount = normalizeAmount(r.amount);
    const spent = normalizeAmount(r.spent);
    if (amount === null || spent === null) return toast('Not a number', true);
    item.name = (r.name || '').trim() || item.name;
    item.amount = amount;
    item.spent = spent;
    item.envelope = r.envelope || item.envelope;
    item.category = (r.category || '').trim();
    item.notes = (r.notes || '').trim();
    // Status follows the money rather than being a third thing to keep in sync.
    item.status = spent <= 0 ? 'planned' : spent + 0.005 < amount ? 'part' : 'done';
    mark(); renderPlan();
  }

  async function newPlan() {
    const r = await askFields(app, 'New plan', [
      { key: 'name', label: 'What is this money for?', type: 'text',
        placeholder: 'Baby & catch-up',
        desc: 'Becomes the filename: Plans/<name>.md' },
    ]);
    if (!r || !r.name.trim()) return;
    const name = r.name.trim();
    const key = safeSeg(name);
    if (!key) return toast('That name has nothing a filename can keep', true);
    // Already open in memory — switch to it rather than making a second one.
    if (S.plans[key]) { S.planName = key; return renderPlan(); }
    /* A file on disk that the loader did not pick up means something else owns
       that path — refuse rather than overwrite it on the first save. */
    // ISSUE 64: pathTaken, not fileAt — the filesystem is case-insensitive.
    if (pathTaken(`Plans/${key}.md`)) {
      return toast('A file with that name already exists in Plans/', true);
    }
    S.plans[key] = { file: key, name, fmRaw: '', started: todayIso(), status: 'active',
      sources: [], envelopes: [], items: [] };
    S.planName = key;
    mark(); renderPlan();
  }

  /* Delete the plan on screen.

     A plan holds no money — it is a division of money that lives in accounts,
     and every source, envelope and item in it is a statement of intent rather
     than a transaction. So this touches nothing else in the vault, and the
     dialog says so plainly: it is the one delete in this app with no
     arithmetic consequence anywhere, and a reader who has just been warned
     about orphan folders and dedup keys on the other pages is owed that.

     A plan created but never saved has no file at all — newPlan() puts it in
     S.plans and the disk has never heard of it. Deleting it is then a purely
     in-memory drop, and announcing a trip to the trash would be a claim the
     reader could go and check. */
  async function deletePlan() {
    const key = S.planName;
    const p = P();
    if (!p) return;
    // ISSUE 97 — the path this plan was READ from, not one assembled from its key.
    const file = fileAt((p && p.rel) || `Plans/${key}.md`);
    const n = (arr, word) => `${arr.length} ${word}${arr.length === 1 ? '' : 's'}`;
    const go = await confirmModal(app, {
      title: 'Delete plan',
      message: (file
        ? `Move Plans/${key}.md to your vault trash? `
        : 'This plan has never been saved, so there is no file to trash — it is dropped from the app. ')
        + `“${p.name}” holds ${n(p.sources, 'source')}, ${n(p.envelopes, 'spending bucket')} and ${n(p.items, 'item')}. `
        + 'No transaction, account or budget changes: a plan only ever described how money already '
        + 'in your accounts was meant to be divided.',
      confirmText: 'Delete plan',
    });
    if (!go) return;
    if (file) {
      try {
        await ctx.trashFile(file);
      } catch (e) {
        return toast(`Could not delete that plan: ${(e && e.message) || e}`, true);
      }
    }
    delete S.plans[key];
    /* One dirty flag for the page, and changePlan refuses to switch while it is
       set — so whatever it was tracking belonged to the plan just deleted.
       Clearing it is what puts Save back to disabled; left lit, it would offer
       to save a plan that no longer exists. */
    clearDirty();
    S.planName = Object.keys(S.plans)
      .sort((a, b) => S.plans[a].name.localeCompare(S.plans[b].name))[0] || null;
    renderPlan();
    toast(`Deleted plan “${p.name}”`);
  }

  function changePlan(key) {
    if (S.planDirty) return toast('Save this plan first', true);
    S.planName = key;
    expandedEnvelope = null; // a different plan's buckets — the accordion guard re-opens the first one
    renderPlan();
  }

  /* ----------------------------- serialize ------------------------------- */

  /* Three tables in one file rather than three files, because a plan is read as
     one thing and the tables are meaningless apart — a "Money in" table with no
     envelopes beside it is a list of deposits. Section headings are what the
     loader slices on, so their text is load-bearing: see load.js. */
  function serializePlan(key) {
    const p = S.plans[key];
    const fm = patchFrontmatter(p.fmRaw || '', {
      kind: 'plan',
      plan: yamlStr(p.name),
      started: p.started ? yamlStr(p.started) : null,
      status: p.status || 'active',
    });
    /* ISSUE 59/63. A cell nobody could read goes back exactly as it was
       typed, never as a fabricated 0.00 and never as a coerced status word.
       load.js sets `<key>Raw` only when the cell was present and unreadable —
       the same contract table-schema.js gives every other table, and both
       halves of that contract are load-bearing here for the reasons its
       money()/vocab() comments spell out.

       NOT through escMd: the raw arrives from parseMdTable still \|-escaped
       and load.js never unescapes it, so escaping it again added a backslash
       on every save — `R400 \| ish`, `R400 \\| ish`, `R400 \\\| ish` — until
       a cell that was merely unparseable became unreadable.

       And preferred only while the row still HOLDS the value that raw
       produced. The editors on this page assign `amount`/`spent`/`status` in
       place and cannot clear a sibling key they have never heard of, so an
       unconditional preference discarded the reader's own correction on the
       next save. */
    const cash = (r, key) => (r[`${key}Raw`] != null && !(r[key] || 0)
      ? r[`${key}Raw`] : Number(r[key] || 0).toFixed(2));
    const word = (r, key, fallback) => (r[`${key}Raw`] != null && r[key] === fallback
      ? r[`${key}Raw`] : r[key]);
    const lines = ['---', ...fm.split('\n'), '---', '', `# ${p.name}`, '',
      'Money that arrives once, divided on purpose.',
      'Source `status` is `received` or `expected`; item `status` is `planned`, `part` or `done`.',
      'An envelope\'s amount is what you placed in it — it need not equal the items inside.', '',
      '## Money in', '',
      '| Source | Kind | Amount | Date | Status | Notes |',
      '|--------|------|-------:|------|--------|-------|'];
    for (const s of p.sources) {
      lines.push(`| ${escMd(s.name)} | ${escMd(s.kind || 'Other')} | ${cash(s, 'amount')} | ${escMd(s.date || '')} | ${word(s, 'status', 'received')} | ${escMd(s.notes || '')} |`);
    }
    lines.push('', '## Envelopes', '',
      '| Envelope | Amount | Note | Tint |',
      '|----------|-------:|------|------|');
    for (const e of p.envelopes) {
      lines.push(`| ${escMd(e.name)} | ${cash(e, 'amount')} | ${escMd(e.note || '')} | ${escMd(e.tint || '')} |`);
    }
    lines.push('', '## Items', '',
      '| Item | Envelope | Amount | Spent | Status | Category | Notes |',
      '|------|----------|-------:|------:|--------|----------|-------|');
    for (const i of p.items) {
      lines.push(`| ${escMd(i.name)} | ${escMd(i.envelope || '')} | ${cash(i, 'amount')} | ${cash(i, 'spent')} | ${word(i, 'status', 'planned')} | ${escMd(i.category || '')} | ${escMd(i.notes || '')} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  /* Guarded for the same reason as every save on this page's Save button:
     before this, a rejected write was an unhandled rejection — no try/catch
     meant no toast and no code path to run at all, so the dirty flag was left
     exactly as it was (clearDirty() sits AFTER the write and never ran on a
     rejection) with nothing on screen to say the save had failed. The button
     stayed lit and the flag stayed dirty by ACCIDENT, not by design; the only
     bug was the silence. Now the failure toasts and the same left-dirty state
     is kept on purpose, so the same click retries. */
  async function savePlan() {
    const p = P();
    if (!p) return;
    // From `file`, never from a re-sanitised name — see the note in load.js.
    const path = `Plans/${p.file}.md`;
    try {
      await writeFile(path, serializePlan(S.planName));
    } catch (e) {
      return toast(`Could not save ${path} (${e.message || e})`, true);
    }
    clearDirty();
    toast(`Saved ${path}`);
  }

  /* ------------------------------- helpers ------------------------------- */

  const todayIso = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  /* Envelope tints cycle through the palette's own category colours, so a plan
     looks like the rest of the app rather than inventing a sixth colour scheme.
     Stored on the envelope so it survives a reload and a reorder. */
  const TINTS = ['var(--color-danger)', 'var(--color-primary)', 'var(--color-warning)',
    'var(--color-info)', 'var(--color-luxuries)', 'var(--color-giving)', 'var(--color-investment)'];
  const nextTint = p => TINTS[p.envelopes.length % TINTS.length];

  ctx.provide({ renderPlan, savePlan, newPlan, deletePlan, addSource, addEnvelope, serializePlan });
};
