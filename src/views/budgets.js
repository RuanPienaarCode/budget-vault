'use strict';
/* Budget page — per-period category amounts, edited as a draft and saved to
   Budgets/<period>.md. */

const { el, icoEl } = require('../dom');
const { parseFrontmatter } = require('../markdown');
/* The Budgets/<period>.md format lives in one pure module, shared with the
   setup wizard — see the header of budget-file.js for why it stopped being
   inline here. */
const { serializeBudgetFile, budgetRangeNote } = require('../budget-file');
/* Row order must agree with serializeBudgetFile() and the Dashboard: a custom
   group slots in before `expense` and an undeclared type sorts LAST. Plain
   indexOf() over the built-in order cannot express that — it returns -1 for
   a custom group, which sorted it above income on this page alone. */
const { typeOrder, typeRank } = require('../groups');
const { askBudgetReslice, confirmModal } = require('../modal');
const { inferIntervalFromKeys, resliceBudget } = require('../reslice');
const { ISO_DATE, isoDayNumber } = require('../dates');
/* Namespace import — this file binds `t` as a local (`const t = $('#budTable')`),
   so a bare `t` from i18n would be shadowed inside renderBudgets(). */
const i18n = require('../i18n');

module.exports = function registerBudgets(ctx) {
  const { S, $, app, money, toast, typeBadge, writeFile, readFile, periodTitle, periodMonthName, periodSummary, periodRange, shiftPeriod, periodKeyValid, intervalDays, promptCreateCategory, promptDeleteCategory, catAssumeSpent, assumedSpend, periodDeficit, catType, currentPeriod } = ctx;

  /* Budgets saved under the OTHER period-name shape — what a vault accumulates
     when someone switches between a payday month and a pay cycle. They are not
     deleted and they are not lost; they simply cannot be addressed while the
     other length is active, and they come back on switching back. Nothing in
     the app said so, which is how a switch reads as "my budget was wiped": the
     categories all reappear from S.categories, but every amount is zero. */
  function otherShapeBudgets() {
    return Object.keys(S.budgets)
      .filter(k => !periodKeyValid(k) && (S.budgets[k] || []).length)
      .sort();
  }
  /* The note only earns its place when this period is genuinely unbudgeted AND
     there is something on the other side to explain. Shown otherwise it would
     be noise on every fresh period, and people stop reading a banner that is
     always there. */
  function renderShapeNote() {
    const box = $('#budShapeNote');
    box.empty();
    const others = otherShapeBudgets();
    const thisOne = S.budgets[S.period] || [];
    if (thisOne.length || !others.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const newest = others[others.length - 1];
    const n = others.length;
    box.append(el('div', { class: 'bud-shape-note-t' }, i18n.t('bud.shape.title')));
    box.append(el('p', {}, i18n.t('bud.shape.body', { count: n, newest })));
    box.append(el('button', {
      class: 'btn btn-ghost', type: 'button',
      onclick: () => bringOverFrom(newest),
    }, i18n.t('bud.shape.bring', { newest })));
    box.append(el('button', {
      class: 'btn btn-ghost', type: 'button',
      onclick: () => resliceFrom(newest),
    }, i18n.t('bud.shape.bringAmounts')));
  }

  /* How many days the CURRENT period runs — the denominator's partner in the
     pro-rata. An interval cycle knows its own length; a payday month has to be
     measured, because "a month" is 28 to 31 days and scaling by the wrong one
     puts every suggestion out by up to 10%. */
  function currentPeriodDays() {
    const iv = intervalDays();
    if (iv) return iv;
    const r = periodRange(S.period);
    return isoDayNumber(r.end) - isoDayNumber(r.start) + 1;
  }
  /* How many days the STRANDED periods ran.

     A month-named file can be measured the same way — periodRange falls to its
     month branch for a YYYY-MM key even while an interval is running, so it
     still describes the payday month that key names. A date-named file cannot:
     its length was the cycle in force when it was written, which nothing
     records, so it is inferred from the spacing of its siblings and comes back
     null when there is only one. periodRange is NOT asked about a date key —
     under a monthly setting it would read '2026-08-07' as August and answer
     with a month.

     `allKeys` used to be otherShapeBudgets() — the STRANDED subset alone. That
     is exactly the wrong set to infer FROM: it holds, by construction, only
     the keys the current settings cannot address, so on a 7→14 switch its
     survivors are already 14 days apart, and inferIntervalFromKeys read that
     back as "the old cycle was 14" — the new length, dressed up as the old
     one. Every ISO-named key the vault holds (phase-valid ones included) is
     the honest population to measure spacing over.

     Even over the full population, a gap that lands exactly on `dstDays` is
     indistinguishable from a real old cycle that coincidentally matches the
     new one — and on a vault with too few date-named files either side of the
     switch, the survivors ARE the whole population, so the same collision can
     still occur. Rather than let that collision silently re-emit a factor of
     1 flagged `scaled: true`, it comes back null: unknown is the honest
     answer once the two lengths cannot be told apart. */
  function strandedPeriodDays(key, allKeys, dstDays) {
    if (ISO_DATE.test(key)) {
      const inferred = inferIntervalFromKeys(allKeys);
      return (inferred !== null && inferred === dstDays) ? null : inferred;
    }
    const r = periodRange(key);
    return isoDayNumber(r.end) - isoDayNumber(r.start) + 1;
  }

  /* The amounts half of the offer above. Writes nothing to disk: accepted rows
     land in the draft and the Save button lights up, so a re-slice is still one
     more deliberate act away from the vault — and is discarded by simply
     navigating away, like any other unsaved edit. */
  async function resliceFrom(key) {
    const src = S.budgets[key] || [];
    if (!src.length) return toast(i18n.t('bud.shape.empty'), true);
    const draft = budgetDraft();
    const existingByCategory = {};
    for (const d of draft) if (d.amount) existingByCategory[d.category] = d.amount;
    const dstDays = currentPeriodDays();
    const plan = resliceBudget({
      rows: src,
      // Every ISO-named key S.budgets holds, not just the stranded subset —
      // see strandedPeriodDays above for why the stranded-only set could
      // never tell the old cycle apart from the new one.
      oldDays: strandedPeriodDays(key, Object.keys(S.budgets), dstDays),
      dstDays,
      existingByCategory,
    });
    const accepted = await askBudgetReslice(app, plan, { money, sourceLabel: key });
    if (!accepted || !accepted.length) return;
    for (const a of accepted) {
      let d = draft.find(x => x.category === a.category);
      if (!d) {
        const from = src.find(r => r.category === a.category) || {};
        d = { category: a.category, type: from.type, amount: 0, notes: '' };
        draft.push(d);
      }
      d.amount = a.amount;
      // The loader's "could not parse, write back verbatim" flag belongs to the
      // figure it was read with. This is a number we just computed.
      d.amountRaw = null;
      d.inFile = true;
      if (!(d.notes && d.notes.trim()) && a.notes) d.notes = a.notes;
    }
    budDirty = true;
    $('#budSave').disabled = false;
    renderBudgets();
    toast(i18n.t('bud.shape.broughtAmounts', { count: accepted.length }));
  }
  /* Carries structure, never amounts — kept pure and separate from the button
     so the promise in that last clause is actually testable. Halving a monthly
     figure is right for groceries and wrong for rent, and nothing on screen
     would say which line had been guessed at, so the tedious part is carried
     and the judgement is asked for. Mutates `draft`, returns the count. */
  function carryStructure(src, draft) {
    let brought = 0;
    for (const r of src) {
      const d = draft.find(x => x.category === r.category);
      if (d) {
        // Never overwrite something already set for THIS period.
        if (!d.inFile && !d.amount && !(d.notes && d.notes.trim()) && r.notes) {
          d.notes = r.notes; d.inFile = true; brought++;
        }
      } else {
        draft.push({ ...r, amount: 0, amountRaw: null, inFile: true });
        brought++;
      }
    }
    return brought;
  }
  function bringOverFrom(key) {
    const src = S.budgets[key] || [];
    if (!src.length) return toast(i18n.t('bud.shape.empty'), true);
    const brought = carryStructure(src, budgetDraft());
    if (brought) { budDirty = true; $('#budSave').disabled = false; }
    renderBudgets();
    toast(brought
      ? i18n.t('bud.shape.brought', { count: brought })
      : i18n.t('bud.shape.allHere'));
  }

  let budDraft = null, budDraftPeriod = null;
  /* This page's dirty state used to live only in the DOM, read back off
     #budSave.disabled. That gates the file watcher, and reading a button
     fails OPEN — if the button is ever missing it reports "clean" and the
     watcher reloads over unsaved edits. Back it with a real flag; the DOM
     check stays as a fallback for any path that only touches the button. */
  let budDirty = false;
  /* Like the Laravel app's Budget page, the draft covers EVERY category — rows
     present in Budgets/<period>.md carry their amounts (inFile: true); all
     other categories appear as zero rows (inFile: false) that only persist
     once the user actually sets an amount or a note. */
  function budgetDraft() {
    if (budDraftPeriod !== S.period || !budDraft) {
      budDraft = (S.budgets[S.period] || []).map(r => ({ ...r, inFile: true }));
      const have = new Set(budDraft.map(d => d.category));
      for (const c of S.categories) {
        if (!have.has(c.name)) budDraft.push({ category: c.name, type: c.type, amount: 0, notes: '', inFile: false });
      }
      budDraftPeriod = S.period;
      budDirty = false;
      $('#budSave').disabled = true;
    }
    return budDraft;
  }
  // Drop the in-memory draft so it rebuilds from S.budgets on next render.
  // Called after any reload from disk (sync / manual edit) so a stale draft
  // can never be saved over freshly-loaded data.
  function invalidateBudgetDraft() { budDraft = null; budDraftPeriod = null; budDirty = false; }
  // True when the budget view holds unsaved edits.
  function budgetDirty() { const b = $('#budSave'); return budDirty || (!!b && !b.disabled); }
  ctx.registerDirty(budgetDirty);
  /* Not ctx.dirtyFlag: this page's dirty state is a draft-vs-file comparison,
     not a boolean on S. The Save button still has to go back to disabled when
     the vault is re-read, so it registers for that half on its own. */
  ctx.registerSaveButton('#budSave');

  /* Totals across the whole draft — budgeted income, budgeted spend, and the
     actual spend so far. Read off the live draft (not S.budgets) so the strips
     move as soon as an amount is edited, before the file is saved. */
  function budgetTotalsStrip() {
    const draft = budgetDraft();
    const sum = periodSummary(S.period);
    let income = 0, budgeted = 0, assumed = 0, namedNetSpend = 0, hasIncomeRow = false;
    for (const d of draft) {
      /* The row's own stored Type cell (d.type, the Type column read out of
         Budgets/<period>.md) versus the category's CURRENT type (catType).
         There is no re-type UI — editing the category file is the supported
         correction — so a save writes the stale cell straight back and it is
         permanently wrong until then. catType is the live answer; d.type is
         kept only as the fallback for a category with no file to ask, which
         is exactly what `?? ` (not `||`) buys: catType returns null for that
         case and the row's own amount for income can legitimately be 0. */
      const type = catType(d.category) ?? d.type;
      if (type === 'income') {
        income += d.amount || 0;
        // d.inFile, not "this row exists" — budgetDraft() seeds a ZERO row
        // for every category the vault has, income-typed ones included, so
        // "exists" is true on nearly every vault regardless of whether income
        // was ever actually budgeted for THIS period. inFile is true only for
        // a row that came from the saved file (or was deliberately touched
        // this session) — an income category that has never been asked about
        // in this period's file must not silently stand in for one that was.
        if (d.inFile) hasIncomeRow = true;
        continue;
      }
      if (type === 'transfer') continue;
      budgeted += d.amount || 0;
      /* Real spend already inside sum.spend for THIS category — periodSummary
         doesn't know an assume-spent flag exists, but it knows every real
         transaction, including one in a category the flag was turned on for.
         The overlay below used to add the WHOLE budgeted amount on top of
         that, regardless: a category with real spend double-counted its own
         money (R4 000 budget, R3 000 real spend, flag on -> read R7 000, 175%
         used, on R3 000 that actually moved). The overlay is only the
         SHORTFALL beyond what already happened — clamped to zero so a
         category the assumption undershot never goes negative and pulls the
         total down. */
      const raw = sum.byCat[d.category] || 0;
      const realSpend = -raw;
      if (catAssumeSpent(d.category)) assumed += Math.max(0, (d.amount || 0) - realSpend);
      // Net per-category spend, refunds folded in — the same figure each row
      // below reads as its own Actual. Summed here so "Total spent" (gross)
      // can disclose exactly how it differs from the table under it.
      namedNetSpend += Math.max(0, realSpend);
    }
    /* Assume-spent rows have no transactions to find, so periodSummary knows
       nothing about them — and "Total spent" read R1 900 low all month while
       the row itself claimed R1 900 still to go. Added here, off the LIVE draft
       rather than the saved file, so the tile moves as the amount is typed,
       like every other figure on this strip. */
    const spent = sum.spend + assumed;
    const allocPct = income > 0 ? Math.round((budgeted / income) * 100) : null;
    const usedPct = budgeted > 0 ? Math.round((spent / budgeted) * 100) : null;

    /* "Total spent" reads GROSS: sum.spend, every outgoing row, refunds not
       netted, uncategorised and unknown-name spend counted in full. Every row
       below is NET per category (refunds folded in) and only exists for a
       category this vault actually has — namedNetSpend is that same figure,
       summed. tests/cross-page-consistency.test.cjs allows exactly this split
       on the Dashboard because its donut's "not shown" note accounts for the
       WHOLE gap; this tile carried no such disclosure, so it could not be
       reconciled to the table under it. Measured against sum.spend rather
       than derived a second way, so the note accounts for the whole
       difference by construction — same reason renderSplit's own gapNote is
       built this way (dashboard.js). Reuses the donut's own keys: the words
       fit a category-netting gap regardless of which page it's disclosed on. */
    const grossGap = Math.max(0, sum.spend - namedNetSpend);
    const gapUncat = Math.min((sum.uncatSpend || 0) + (sum.unknown.spend || 0), grossGap);
    const gapNetted = grossGap - gapUncat;
    let gapNote = '';
    if (gapUncat >= 1) gapNote += i18n.t('dash.split.uncatNote', { amount: money(gapUncat) });
    if (gapNetted >= 1) gapNote += i18n.t('dash.split.nettedNote', { amount: money(gapNetted) });

    /* Income minus what's been budgeted — the number that answers "have I given
       every rand a job yet?". Negative means the plan spends more than it earns,
       which is the one figure here that deserves red.

       Denominator problem, same shape as renderHero's incomeBase (dashboard.js):
       with no income row at all, `income` is 0 by construction, not because
       nothing was earned — and "budgeted beyond income" then fires against the
       WHOLE spend budget, in red, on a vault that never named an income figure
       to compare against. Five of this vault's eight budget files carry no
       income row, so this is the normal case, not the corner. While the period
       is still running there is no honest number to fall back to either — an
       in-progress period's actual income is a part-period figure — so the tile
       is simply omitted. Once the period is FINISHED, actual income is a whole,
       settled figure and stands in, exactly as renderHero's incomeBase does. */
    const noIncomeInfo = income === 0 && !hasIncomeRow;
    const periodFinished = S.period !== currentPeriod();
    let unallocatedTile = null;
    if (!noIncomeInfo) {
      const unallocated = income - budgeted;
      unallocatedTile = {
        label: i18n.t(unallocated < 0 ? 'bud.total.over' : 'bud.total.left'), value: money(Math.abs(unallocated)),
        over: unallocated < 0,
        note: unallocated < 0 ? i18n.t('bud.total.overNote')
          : (income > 0 ? i18n.t('bud.total.leftNote') : ''),
      };
    } else if (periodFinished) {
      const fallbackIncome = sum.income;
      const unallocated = fallbackIncome - budgeted;
      unallocatedTile = {
        label: i18n.t(unallocated < 0 ? 'bud.total.over' : 'bud.total.left'), value: money(Math.abs(unallocated)),
        over: unallocated < 0,
        note: unallocated < 0 ? i18n.t('bud.total.overNote')
          : (fallbackIncome > 0 ? i18n.t('bud.total.leftNote') : ''),
      };
    }
    return [
      { label: i18n.t('bud.total.income'), value: money(income), grad: true,
        note: i18n.t('bud.total.incomeNote', { amount: money(sum.income) }) },
      { label: i18n.t('bud.total.budgeted'), value: money(budgeted),
        note: allocPct !== null ? i18n.t('bud.total.budgetedNote', { pct: allocPct }) : '' },
      ...(unallocatedTile ? [unallocatedTile] : []),
      { label: i18n.t('bud.total.spent'), value: money(spent), over: budgeted > 0 && spent > budgeted,
        note: (assumed > 0 ? i18n.t('bud.total.spentNoteAssumed', { pct: usedPct ?? 0, amount: money(assumed) })
          : (usedPct !== null ? i18n.t('bud.total.spentNote', { pct: usedPct }) : '')) + gapNote },
    ];
  }

  // Same three tiles above and below the table, so the totals are in reach
  // from either end of a long category list.
  function renderBudgetTotals() {
    const tiles = budgetTotalsStrip();
    for (const id of ['#budTotalsTop', '#budTotalsBottom']) {
      const host = $(id);
      if (!host) continue;
      host.empty();
      for (const t of tiles) {
        host.append(el('div', { class: 'bud-total' },
          el('div', { class: 'bud-total-l' }, t.label),
          el('div', { class: `bud-total-v${t.grad ? ' grad-txt' : ''}${t.over ? ' over' : ''}` }, t.value),
          t.note ? el('div', { class: 'bud-total-n' }, t.note) : ''));
      }
    }
  }

  function renderBudgets() {
    $('#budPeriodLabel').textContent = `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
    renderShapeNote();
    const draft = budgetDraft();
    const sum = periodSummary(S.period);
    const t = $('#budTable'); t.empty();
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, i18n.t('bud.col.category')), el('th', { scope: 'col' }, i18n.t('bud.col.type')),
      el('th', { scope: 'col', class: 'num' }, i18n.t('bud.col.amount')), el('th', { scope: 'col', class: 'num' }, i18n.t('bud.col.actual')), el('th', { scope: 'col' }, i18n.t('bud.col.notes')), el('th', { scope: 'col' }, ''))));
    const body = el('tbody', {});
    const mark = () => { budDirty = true; $('#budSave').disabled = false; };
    const order = typeOrder(S.settings.groups);
    /* Group FIRST, then order the groups — building a Map<type, rows[]> and
       sorting its keys by typeRank, the way src/views/services.js already
       does. Sorting the flat row list by typeRank and emitting a bar on every
       type change used to do the opposite: typeRank returns order.length for
       EVERY unrecognised type, so two distinct unknown types tie and sort by
       category name, interleaving two group bars instead of one — and a
       blank Type cell rendered its own empty full-width bar for the same
       reason. Grouping first means every type gets exactly one bar,
       wherever typeRank puts it. */
    const groups = new Map();
    for (const d of draft) {
      /* The row's own stored Type cell vs the category's CURRENT type — see
         the comment in budgetTotalsStrip. Computed once per row and reused
         for the group it lands in, the sign of its Actual, and every other
         type-driven decision below, so all four can never disagree with each
         other about which group this row belongs to. */
      const type = catType(d.category) ?? d.type;
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(d);
    }
    const sortedTypes = [...groups.keys()].sort((a, b) => typeRank(a, order) - typeRank(b, order));
    for (const type of sortedTypes) {
      const catRows = groups.get(type).sort((a, b) => a.category.localeCompare(b.category));
      body.append(el('tr', { class: 'type-row' }, el('td', { colspan: '6' }, type)));
      for (const d of catRows) {
        /* An assume-spent row is its own actual: the money left in an earlier
           period, so no transaction in THIS one will ever match it — UNLESS a
           real transaction landed in the category anyway, which the toggle's
           own tooltip merely asserts won't happen. periodSummary counts that
           transaction like any other, inside `raw`/`realSpend` below, so it
           was already inside sum.spend once — reading it a second time here
           (the row used to just read d.amount outright) is what doubled a
           category that both transacted AND carried the flag. `actual` is now
           whichever is bigger: the assumed amount if nothing (or less than
           it) really moved, or the real spend if it overran the assumption —
           the same max() the totals strip's overlay is the complement of, so
           the two can never disagree about this category's contribution. */
        const assumed = catAssumeSpent(d.category);
        const raw = sum.byCat[d.category] || 0;
        const realSpend = -raw;
        const actual = assumed ? Math.max(d.amount || 0, realSpend) : (type === 'income' ? raw : -raw);
        const overActual = actual > d.amount && d.amount > 0 && type !== 'income';
        /* Live "remaining" line under the amount input — budget minus actual,
           red when overspent (never red for income: earning above target is
           fine). An assumed row with nothing (or less than the assumption)
           really moved still reads the static "already spent" label — that
           case has no real remaining line to show, by design, the whole
           budget stands provisioned. One that overran the assumption falls
           through to the same over/left arithmetic as an ordinary row,
           because at that point it IS one: real money moved past what was
           set aside for it. */
        const remainingEl = el('div', { class: 'bud-remaining' });
        const updateRemaining = () => {
          if (!d.amount) {
            /* Spend in a category nobody budgeted for used to leave this line
               blank — the one kind of overspend this page said nothing
               about. Mirrors dashboard.js's renderBudgetTable, which fixed
               the same "blank reads as nothing to report" gap for the same
               reason: three such rows on that vault came to R995 with
               nothing on screen to say so. */
            if (actual > 0 && type !== 'income' && !assumed) {
              remainingEl.textContent = i18n.t('bud.remaining.over', { amount: money(actual) });
              remainingEl.className = 'bud-remaining over';
            } else {
              remainingEl.textContent = ''; remainingEl.className = 'bud-remaining';
            }
            return;
          }
          if (assumed && realSpend <= d.amount) {
            remainingEl.textContent = i18n.t('bud.remaining.assumed');
            remainingEl.className = 'bud-remaining bud-remaining-assumed';
            return;
          }
          const rem = d.amount - actual;
          const over = rem < 0 && type !== 'income';
          remainingEl.textContent = over
            ? i18n.t('bud.remaining.over', { amount: money(-rem) })
            : i18n.t('bud.remaining.left', { amount: money(rem) });
          remainingEl.className = 'bud-remaining' + (over ? ' over' : '');
        };
        updateRemaining();
        /* Actual cell — kept as element references so an amount edit can
           update its text and class in place. It used to only refresh
           updateRemaining() and the totals strip on the amount input's
           onchange, leaving this cell (which for an assume-spent row IS a
           function of the amount, via the max() above) showing the FIGURE
           the row had before the edit while the totals below had already
           moved on. A full row re-render is simplest and safe here — onchange
           fires on blur, not per keystroke, so it never fights the user's
           typing. */
        const actualTd = el('td', { class: `num${overActual ? ' text-danger' : assumed ? ' bud-actual-assumed' : ' text-muted'}`, style: 'white-space:nowrap' },
          money(actual),
          assumed && realSpend <= 0 ? el('div', { class: 'bud-assumed-note' }, i18n.t('bud.assumed.note')) : '');
        body.append(el('tr', {},
          el('td', {}, d.category,
            assumed ? el('div', { class: 'bud-assumed-tag' }, i18n.t('bud.assumed.tag')) : ''),
          // Deliberately the RAW stored cell, not `type` — this is the one
          // place on the row that shows what the file actually says, so a
          // mismatch against the group this row landed in (computed from
          // catType) is the visible signal that the file's Type cell is
          // stale and the category file is where to fix it.
          el('td', {}, typeBadge(d.type)),
          el('td', { class: 'num' }, el('div', { class: 'bud-amt-wrap' },
            el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: d.amount || '',
              'aria-label': i18n.t('bud.aria.amount', { category: d.category }), onchange: e => { d.amount = parseFloat(e.target.value) || 0; d.amountRaw = null; mark(); renderBudgets(); } }),
            remainingEl,
            // Only offered where it means something. On an ordinary row the
            // figure would be written into a budget that transactions will then
            // contradict.
            assumed ? el('button', {
              class: 'btn-ghost btn-ghost-sm bud-pull', type: 'button',
              title: i18n.t('bud.pull.title', { lag: S.settings.overspend_lag }),
              onclick: () => pullPreviousOverspend(d),
            }, i18n.t('bud.pull.label')) : '')),
          actualTd,
          el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: d.notes, style: 'width:230px',
            'aria-label': i18n.t('bud.aria.notes', { category: d.category }), onchange: e => { d.notes = e.target.value; mark(); } })),
          el('td', { style: 'white-space:nowrap' },
            // Income and transfers are never "already spent" — offering the
            // toggle there would only invite a state with no meaning.
            type === 'income' || type === 'transfer' ? '' : el('button', {
              class: `btn-ghost btn-ghost-sm${assumed ? ' bud-assume-on' : ''}`, type: 'button',
              'aria-pressed': assumed ? 'true' : 'false',
              'aria-label': i18n.t('bud.aria.assume', { category: d.category }),
              title: i18n.t(assumed ? 'bud.title.assumeOff' : 'bud.title.assumeOn'),
              onclick: () => toggleAssumeSpent(d.category, !assumed),
            }, icoEl(['circle-check', 'check-circle', 'check'])),
            d.inFile
              ? el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': i18n.t('bud.aria.clear', { category: d.category }), title: i18n.t('bud.title.clear'), onclick: () => { d.amount = 0; d.amountRaw = null; d.notes = ''; d.inFile = false; mark(); renderBudgets(); } }, '✕')
              : '',
            el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': i18n.t('bud.aria.delete', { category: d.category }), title: i18n.t('bud.title.delete'), onclick: async () => {
              if (await promptDeleteCategory(d.category)) {
                const draft = budgetDraft();
                const i = draft.indexOf(d);
                if (i !== -1 && !d.inFile) draft.splice(i, 1);
                renderBudgets();
              }
            } }, icoEl(['trash-2', 'trash'])))));
      }
    }
    // Mirrors dashboard.js's renderBudgetTable: a vault with no categories at
    // all used to leave a header bar sitting over an empty <tbody>.
    if (!draft.length) body.append(el('tr', {}, el('td', { colspan: '6', class: 'text-muted' }, i18n.t('dash.table.empty'))));
    t.append(body);
    renderBudgetTotals();
  }

  async function saveBudget() {
    // Persist rows that were already in the period file (a deliberately
    // zero-budgeted category must survive) plus any virtual row the user
    // gave an amount or a note. Untouched zero rows stay display-only, so
    // the period file doesn't bloat to all 50+ categories.
    const draft = budgetDraft().filter(d => d.category && (d.inFile || d.amount || (d.notes && d.notes.trim())));
    for (const d of draft) d.inFile = true;
    S.budgets[S.period] = draft.map(d => ({ ...d }));
    const meta = S.budgetMeta[S.period];
    /* Both the range note and the file itself come out of src/budget-file.js.
       This used to be built here, inline — frontmatter patch, heading, range
       note, column header, separator and row template all as literals inside a
       function no bare-node test can call. The setup wizard now seeds a
       household's first budget as well, and two hand-built copies of one table
       format is this repo's recurring bug shape: two things derived by
       different rules, agreeing right up until one of them is edited. */
    const text = serializeBudgetFile({
      period: S.period,
      rawFrontmatter: (meta && meta.raw) || '',
      rows: draft,
      groups: S.settings.groups,
      rangeNote: budgetRangeNote({
        monthStartDay: S.settings.month_start_day,
        intervalDays: ctx.intervalDays(),
        periodStart: periodRange(S.period).start,
        periodAnchor: S.settings.period_anchor,
      }),
    });
    // The period name IS the filename, for both shapes — no reassembling it
    // from parts, which is what limited this to 'YYYY-MM'.
    /* Guarded for the same reason as every other save on this page's Save
       button: before this, a rejected write was an unhandled rejection — no
       try/catch meant no toast and no code path to run at all, so budDirty
       was left exactly as it was (it is only set false below, on success,
       never above) with nothing on screen to say the save had failed. The
       button stayed lit and budDirty stayed true by ACCIDENT, not by design;
       the only bug was the silence. Now the failure toasts and the same
       left-dirty state is kept on purpose, so the same click retries. */
    try {
      await writeFile(`Budgets/${S.period}.md`, text);
    } catch (e) {
      return toast(i18n.t('bud.err.save', { error: e.message || e }), true);
    }
    budDirty = false;
    $('#budSave').disabled = true;
    toast(i18n.t('bud.saved', { period: S.period }));
  }

  /* Flip a category's assume-spent flag and persist it to its own note.

     Writes the CATEGORY file, not the period file, because the answer belongs
     to the category — "previous month overspending" is never funded by a
     transaction in any period, not just this one. Mirrors promptCreateCategory:
     the file is written and S.categories is updated in place rather than
     triggering a full reload, so an unsaved budget draft on this page survives
     the toggle. */
  async function toggleAssumeSpent(name, on) {
    const cat = S.categories.find(c => c.name === name);
    if (!cat) return toast(i18n.t('bud.assumed.missing', { category: name }), true);
    if (!cat.rel) return toast(i18n.t('bud.assumed.noFile', { category: name }), true);
    const text = await readFile(cat.rel);
    if (text == null) return toast(i18n.t('bud.assumed.noFile', { category: name }), true);
    const { raw, body } = parseFrontmatter(text);
    // null removes the key outright rather than writing `assume_spent: false` —
    // absent is this flag's own default, so turning it off should leave the file
    // as it would have been had it never been turned on.
    await ctx.patchFile(cat.rel, raw, body, { assume_spent: on ? 'true' : null });
    cat.assumeSpent = on;
    renderBudgets();
    toast(i18n.t(on ? 'bud.assumed.on' : 'bud.assumed.off', { category: name }));
  }

  /* Write the overspend of an earlier period into this row's amount.

     The figure is that period's DEFICIT — what actually went out, less what
     actually came in — so it is the size of the hole the bank account is in,
     not the sum of the lines that broke their own budget (under-spends
     elsewhere are real money and do offset it). See periodDeficit in period.js
     for why it deliberately excludes assume-spent rows.

     How far back to look is `overspend_lag` in Settings.md, because a credit
     card settles in arrears: the hole being funded in August is often June's.
     Confirms first — this overwrites a figure that may have been typed by hand,
     and the number is worth reading before it lands. */
  async function pullPreviousOverspend(d) {
    const lag = S.settings.overspend_lag || 1;
    const src = shiftPeriod(S.period, -lag);
    const deficit = periodDeficit(src);
    const label = `${periodMonthName(src)} · ${periodTitle(src)}`;
    if (!(deficit > 0)) {
      return toast(i18n.t('bud.pull.none', { period: label, amount: money(-deficit) }), true);
    }
    const rounded = Math.round(deficit * 100) / 100;
    const ok = await confirmModal(app, {
      title: i18n.t('bud.pull.confirmTitle'),
      message: i18n.t('bud.pull.confirmBody', {
        amount: money(rounded), period: label, category: d.category, current: money(d.amount || 0),
      }),
      confirmText: i18n.t('bud.pull.confirmOk'),
      cancelText: i18n.t('bud.pull.confirmCancel'),
    });
    if (!ok) return;
    d.amount = rounded;
    // Same reason resliceFrom clears it: the "could not parse, write back
    // verbatim" flag belongs to the figure it was read with, and this is a
    // number we just computed.
    d.amountRaw = null;
    d.inFile = true;
    budDirty = true;
    $('#budSave').disabled = false;
    renderBudgets();
    toast(i18n.t('bud.pull.done', { amount: money(rounded), period: label }));
  }

  function copyPreviousBudget() {
    const prev = S.budgets[shiftPeriod(S.period, -1)];
    if (!prev || !prev.length) return toast(i18n.t('bud.copy.none'), true);
    const draft = budgetDraft();
    let copied = 0;
    for (const r of prev) {
      const d = draft.find(x => x.category === r.category);
      if (d) {
        // Fill categories the user hasn't budgeted this period; never
        // overwrite an amount already set here.
        if (!d.inFile && !d.amount && !(d.notes && d.notes.trim())) {
          d.amount = r.amount; d.amountRaw = r.amountRaw ?? null; d.notes = r.notes; d.inFile = true; copied++;
        }
      } else { draft.push({ ...r, inFile: true }); copied++; }
    }
    if (copied) $('#budSave').disabled = false;
    renderBudgets();
    toast(copied ? i18n.t('bud.copy.done', { count: copied }) : i18n.t('bud.copy.nothing'));
  }

  async function addNewCategory() {
    const cat = await promptCreateCategory();
    if (!cat) return;
    budgetDraft().push({ category: cat.name, type: cat.type, amount: 0, notes: '', inFile: false });
    renderBudgets();
  }

  ctx.provide({ renderBudgets, saveBudget, copyPreviousBudget, addNewCategory, invalidateBudgetDraft, budgetDirty,
    otherShapeBudgets, carryStructure,
    // Exposed the same way otherShapeBudgets and carryStructure already are —
    // a pure-ish helper (periodRange aside) worth pinning directly in a bare
    // node test rather than only reachable through the reslice modal's DOM.
    strandedPeriodDays });
};
