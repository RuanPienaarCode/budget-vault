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

const { el, dateInput, keepScroll, icoEl } = require('../dom');
const { normalizeAmount } = require('../amount');
const { escMd, patchFrontmatter, yamlStr } = require('../markdown');
const { safeSeg } = require('../vault-path');
const { askFields, confirmModal } = require('../modal');
const { planSummary, barSegments, envelopeGap, SOURCE_KINDS, sharePct } = require('../plan-math');

module.exports = function registerPlan(ctx) {
  const { S, $, app, money, toast, writeFile, fileAt } = ctx;

  const { mark, clear: clearDirty } = ctx.dirtyFlag('planDirty', '#planSave');

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

  /* ---- the pot: one number and the bar that says what happened to it ---- */
  function renderPot(p, sum) {
    const host = $('#planPot');
    host.empty();
    /* Widths come from barSegments, NOT from the summary: those three always
       sum to the pot, so the bar can never render clipped or backwards. The
       key underneath still reports the summary's honest figures, and the two
       are identical in every case except an overspent plan — which the loud
       card at the bottom of the page states in words. */
    const seg = barSegments(sum);
    const pct = v => (sum.pot > 0 ? (v / sum.pot) * 100 : 0);
    host.append(
      el('div', { class: 'pot-eyebrow' }, 'In this plan'),
      el('div', { class: 'pot-fig num' }, money(sum.pot)),
      el('div', { class: 'pot-sub' },
        sum.sources === 0
          ? 'No sources yet — add what funds this plan.'
          : `From ${sum.sources} source${sum.sources === 1 ? '' : 's'} · `,
        ...(sum.sources
          ? [el('b', {}, money(sum.received)), ' is in the account today, ',
             el('b', {}, money(sum.expected)), ' is still expected']
          : [])),
      /* One bar, three states of the same rand. role=img with the figures in
         the label: a screen reader gets the split as a sentence rather than
         three unlabelled divs, and the visual key below repeats it in text. */
      el('div', { class: 'plan-split', role: 'img',
        'aria-label': `Of ${money(sum.pot)}: ${money(sum.spent)} already spent, ` +
          `${money(sum.committed)} allocated but unspent, ${money(sum.free)} not yet allocated` },
        el('i', { class: 's-spent', style: `width:${pct(seg.spent)}%` }),
        el('i', { class: 's-alloc', style: `width:${pct(seg.committed)}%` }),
        el('i', { class: 's-free', style: `width:${pct(seg.free)}%` })),
      el('div', { class: 'split-key' },
        splitKey('Already spent', sum.spent, 'var(--color-primary)'),
        splitKey('Spoken for', sum.committed, 'var(--color-accent)'),
        splitKey('Not spoken for', sum.free, 'var(--color-gold)',
          sum.free < 0 ? 'text-danger' : 'plan-free-fig')));
  }

  const splitKey = (label, value, swatch, cls = '') => el('div', {},
    el('div', { class: 'sk-top' }, el('i', { style: `background:${swatch}` }), label),
    el('div', { class: `sk-fig num ${cls}` }, money(value)));

  /* ---- money in: any source you like, and when it actually lands ---- */
  function renderSources(p, sum) {
    const host = $('#planSources');
    keepScroll(host, () => {
      host.empty();
      for (const s of p.sources) {
        const received = s.status === 'received';
        const pill = el('button', {
          class: `status-pill status-${received ? 'paid' : 'outstanding'}`,
          type: 'button',
          'aria-label': `${s.name}: ${received ? 'in the account' : 'not yet paid'} — click to change`,
        }, icoEl(received ? ['circle-check', 'check-circle'] : ['hourglass']),
           received ? 'in the account' : 'expected');
        pill.addEventListener('click', () => {
          s.status = received ? 'expected' : 'received';
          mark(); renderPlan();
        });
        host.append(el('div', { class: 'src-row' },
          el('div', { class: 'src-main' },
            el('div', { class: 'src-name' },
              el('input', { type: 'text', class: 'src-name-input', value: s.name,
                'aria-label': `Name of source ${s.name}`,
                onchange: e => { s.name = e.target.value; mark(); } }),
              el('span', { class: 'kind' }, s.kind || 'Other')),
            el('div', { class: 'src-when' },
              dateInput(s.date, { class: 'form-control form-control-sm src-date',
                'aria-label': `Date for ${s.name}` },
                v => { s.date = v; mark(); renderPlan(); }),
              s.notes ? el('span', { class: 'src-note' }, s.notes) : '')),
          pill,
          el('div', { class: 'src-amt num' },
            el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm',
              value: s.amount || '', 'aria-label': `Amount for ${s.name}`,
              onchange: e => { s.amount = parseFloat(e.target.value) || 0; mark(); renderPlan(); } })),
          el('button', { class: 'btn-ghost btn-ghost-sm', type: 'button',
            'aria-label': `Remove source ${s.name}`,
            onclick: () => { p.sources.splice(p.sources.indexOf(s), 1); mark(); renderPlan(); } }, '✕')));
      }
      if (!p.sources.length) {
        host.append(el('div', { class: 'text-muted plan-empty-row' },
          'Nothing funds this plan yet. Add a payout, a refund, a salary surplus — anything.'));
      }
    });
  }

  /* ---- the envelopes: the act of dividing, made draggable ---- */
  function renderEnvelopes(p, sum) {
    $('#planEnvSub').textContent = p.envelopes.length
      ? `Drag a slider to move money in or out · ${p.envelopes.length} envelope${p.envelopes.length === 1 ? '' : 's'}, ${money(sum.allocated)} placed`
      : 'Nothing placed yet — an envelope is one intent, and the items are what it buys.';
    const host = $('#planEnvelopes');
    keepScroll(host, () => {
      host.empty();
      for (const e of p.envelopes) host.append(envelopeCard(p, e, sum));
      if (!p.envelopes.length) {
        host.append(el('div', { class: 'text-muted plan-empty-row' },
          'No envelopes yet.'));
      }
    });
  }

  function envelopeCard(p, env, sum) {
    const items = p.items.filter(i => i.envelope === env.name);
    const gap = envelopeGap(env, items);
    const spent = items.reduce((t, i) => t + (i.spent || 0), 0);

    /* The slider's ceiling is this envelope's amount plus everything not yet
       spoken for — i.e. the most it could possibly hold without the plan going
       negative. A fixed max would either stop short of what the pot allows or
       invite dragging past it. */
    const ceiling = Math.max(env.amount, env.amount + Math.max(0, sum.free), 100);

    const amtEl = el('div', { class: 'env-amt num' }, money(env.amount));
    const shareEl = el('span', { class: 'env-share num' }, `${sharePct(env.amount, sum.pot)}%`);

    const slider = el('input', {
      class: 'env-slider', type: 'range', min: '0', max: String(Math.ceil(ceiling)),
      step: '10', value: String(env.amount),
      'aria-label': `Amount allocated to ${env.name}`,
    });
    /* input repaints only this card's own figures — cheap, and it keeps the
       drag smooth. change commits and re-renders the page, because the pot bar
       and the free card above depend on this number too. */
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      amtEl.textContent = money(v);
      shareEl.textContent = `${sharePct(v, sum.pot)}%`;
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

    return el('div', { class: 'env', style: `--tint:${env.tint || 'transparent'}` },
      el('div', { class: 'env-top' },
        el('button', { class: 'env-name', type: 'button',
          'aria-label': `Rename envelope ${env.name}`,
          onclick: () => renameEnvelope(p, env) }, env.name),
        shareEl),
      amtBtn,
      el('div', { class: 'env-rail' },
        slider,
        el('div', { class: 'env-rail-note' },
          el('span', {}, env.note || ''),
          el('span', { class: `num ${gap ? 'text-warning' : ''}` },
            gap > 0 ? `${money(gap)} unassigned`
              : gap < 0 ? `${money(-gap)} over`
              : spent > 0 ? `${money(spent)} spent` : ''))),
      el('ul', { class: 'env-items' },
        ...items.map(i => itemRow(p, i)),
        el('li', { class: 'env-item env-item-add' },
          el('button', { class: 'env-add', type: 'button',
            onclick: () => addItem(p, env.name) }, '＋ item'))),
      el('div', { class: 'env-foot' },
        el('span', { class: 'env-count' },
          items.length
            ? `${items.filter(i => i.status === 'done').length} of ${items.length} done`
            : 'no items yet'),
        el('button', { class: 'btn-ghost btn-ghost-sm', type: 'button',
          'aria-label': `Remove envelope ${env.name}`,
          onclick: () => removeEnvelope(p, env) }, '✕')));
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

  /* ---- what is not spoken for: the only card that is deliberately loud ---- */
  function renderFree(p, sum) {
    const card = $('#planFree');
    /* A finished split makes this card disappear rather than saying "R 0.00
       left" — an all-clear vault gets no shelf standing there saying nothing,
       the same rule the Accounts deck follows. */
    const show = Math.abs(sum.free) >= 0.005;
    card.classList.toggle('hidden', !show);
    if (!show) return;
    const over = sum.free < 0;
    card.classList.toggle('is-over', over);
    card.empty();
    card.append(
      el('h2', {}, over
        ? `${money(-sum.free)} more is placed than this plan holds`
        : `${money(sum.free)} is not spoken for`),
      el('div', { class: 'free-fig num' },
        `${sharePct(Math.abs(sum.free), sum.pot)}% of the plan`),
      el('p', {}, over
        ? 'The envelopes add up to more than the money coming in. Take some back out, or add the source that covers it.'
        : 'Leaving money unplaced is a decision too — but it should be one you made, not one you forgot.'),
      el('div', { class: 'free-acts' },
        ...(over ? [] : [el('button', { class: 'btn-gradient', type: 'button',
          onclick: () => addEnvelope(p, sum.free) }, 'Put it in a new envelope')]),
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
    const r = await askFields(app, 'New envelope', [
      { key: 'name', label: 'What is this money for?', type: 'text', placeholder: 'For the baby' },
      { key: 'amount', label: 'How much goes in it?', type: 'number',
        value: suggested > 0 ? suggested.toFixed(2) : '0' },
      { key: 'note', label: 'Note (optional)', type: 'text' },
    ]);
    if (!r || !r.name.trim()) return;
    const name = r.name.trim();
    if (p.envelopes.some(e => e.name === name)) return toast('That envelope already exists', true);
    const amount = normalizeAmount(r.amount);
    if (amount === null) return toast('Not a number', true);
    p.envelopes.push({ name, amount, note: (r.note || '').trim(), tint: nextTint(p) });
    mark(); renderPlan();
  }

  async function renameEnvelope(p, env) {
    const r = await askFields(app, 'Rename envelope', [
      { key: 'name', label: 'Name', type: 'text', value: env.name },
      { key: 'note', label: 'Note', type: 'text', value: env.note || '' },
    ]);
    if (!r || !r.name.trim()) return;
    const name = r.name.trim();
    if (name !== env.name) {
      if (p.envelopes.some(e => e.name === name)) return toast('That envelope already exists', true);
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
      { key: 'amount', label: 'Amount in this envelope', type: 'number', value: env.amount.toFixed(2) },
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
      { key: 'envelope', label: 'Envelope', type: 'select',
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
    if (fileAt(`Plans/${key}.md`)) {
      return toast('A file with that name already exists in Plans/', true);
    }
    S.plans[key] = { file: key, name, fmRaw: '', started: todayIso(), status: 'active',
      sources: [], envelopes: [], items: [] };
    S.planName = key;
    mark(); renderPlan();
  }

  function changePlan(key) {
    if (S.planDirty) return toast('Save this plan first', true);
    S.planName = key;
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
    const lines = ['---', ...fm.split('\n'), '---', '', `# ${p.name}`, '',
      'Money that arrives once, divided on purpose.',
      'Source `status` is `received` or `expected`; item `status` is `planned`, `part` or `done`.',
      'An envelope\'s amount is what you placed in it — it need not equal the items inside.', '',
      '## Money in', '',
      '| Source | Kind | Amount | Date | Status | Notes |',
      '|--------|------|-------:|------|--------|-------|'];
    for (const s of p.sources) {
      lines.push(`| ${escMd(s.name)} | ${escMd(s.kind || 'Other')} | ${Number(s.amount || 0).toFixed(2)} | ${escMd(s.date || '')} | ${s.status} | ${escMd(s.notes || '')} |`);
    }
    lines.push('', '## Envelopes', '',
      '| Envelope | Amount | Note | Tint |',
      '|----------|-------:|------|------|');
    for (const e of p.envelopes) {
      lines.push(`| ${escMd(e.name)} | ${Number(e.amount || 0).toFixed(2)} | ${escMd(e.note || '')} | ${escMd(e.tint || '')} |`);
    }
    lines.push('', '## Items', '',
      '| Item | Envelope | Amount | Spent | Status | Category | Notes |',
      '|------|----------|-------:|------:|--------|----------|-------|');
    for (const i of p.items) {
      lines.push(`| ${escMd(i.name)} | ${escMd(i.envelope || '')} | ${Number(i.amount || 0).toFixed(2)} | ${Number(i.spent || 0).toFixed(2)} | ${i.status} | ${escMd(i.category || '')} | ${escMd(i.notes || '')} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  async function savePlan() {
    const p = P();
    if (!p) return;
    // From `file`, never from a re-sanitised name — see the note in load.js.
    const path = `Plans/${p.file}.md`;
    await writeFile(path, serializePlan(S.planName));
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

  ctx.provide({ renderPlan, savePlan, newPlan, addSource, addEnvelope, serializePlan });
};
