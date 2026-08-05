'use strict';
/* Budget page — per-period category amounts, edited as a draft and saved to
   Budgets/<period>.md. */

const { el, escMd, icoEl, patchFrontmatter } = require('../util');
const { TYPE_ORDER } = require('../constants');

module.exports = function registerBudgets(ctx) {
  const { S, $, money, toast, typeBadge, writeFile, periodTitle, periodMonthName, periodSummary, periodRange, shiftPeriod, periodKeyValid, promptCreateCategory, promptDeleteCategory } = ctx;

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
    box.append(el('div', { class: 'bud-shape-note-t' }, 'Your other budgets are still here'));
    box.append(el('p', {},
      `${n} budget ${n === 1 ? 'file is' : 'files are'} saved under a different period length — ` +
      `the most recent is Budgets/${newest}.md. They stay in your vault, and they come back ` +
      `as soon as you set the period length back. Amounts start blank here because this period ` +
      `isn't the same length as those were.`));
    box.append(el('button', {
      class: 'btn btn-ghost', type: 'button',
      onclick: () => bringOverFrom(newest),
    }, `Bring over the categories and notes from ${newest}`));
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
    if (!src.length) return toast('That budget is empty', true);
    const brought = carryStructure(src, budgetDraft());
    if (brought) { budDirty = true; $('#budSave').disabled = false; }
    renderBudgets();
    toast(brought
      ? `Brought over ${brought} ${brought === 1 ? 'category' : 'categories'} — set the amounts for this period`
      : 'Every category from that budget is already here');
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

  /* Totals across the whole draft — budgeted income, budgeted spend, and the
     actual spend so far. Read off the live draft (not S.budgets) so the strips
     move as soon as an amount is edited, before the file is saved. */
  function budgetTotalsStrip() {
    const draft = budgetDraft();
    const sum = periodSummary(S.period);
    let income = 0, budgeted = 0;
    for (const d of draft) {
      if (d.type === 'income') income += d.amount || 0;
      else if (d.type !== 'transfer') budgeted += d.amount || 0;
    }
    const allocPct = income > 0 ? Math.round((budgeted / income) * 100) : null;
    const usedPct = budgeted > 0 ? Math.round((sum.spend / budgeted) * 100) : null;
    /* Income minus what's been budgeted — the number that answers "have I given
       every rand a job yet?". Negative means the plan spends more than it earns,
       which is the one figure here that deserves red. */
    const unallocated = income - budgeted;
    return [
      { label: 'Total income', value: money(income), grad: true, note: `${money(sum.income)} received so far` },
      { label: 'Total budgeted', value: money(budgeted), note: allocPct !== null ? `${allocPct}% of budgeted income` : '' },
      { label: unallocated < 0 ? 'Over-budgeted' : 'Left to budget', value: money(Math.abs(unallocated)),
        over: unallocated < 0,
        note: unallocated < 0 ? 'budgeted beyond income' : (income > 0 ? 'income not yet allocated' : '') },
      { label: 'Total spent', value: money(sum.spend), over: budgeted > 0 && sum.spend > budgeted,
        note: usedPct !== null ? `${usedPct}% of budget used` : '' },
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
      el('th', { scope: 'col' }, 'Category'), el('th', { scope: 'col' }, 'Type'),
      el('th', { scope: 'col', class: 'num' }, 'Amount'), el('th', { scope: 'col', class: 'num' }, 'Actual so far'), el('th', { scope: 'col' }, 'Notes'), el('th', { scope: 'col' }, ''))));
    const body = el('tbody', {});
    const mark = () => { budDirty = true; $('#budSave').disabled = false; };
    const rows = [...draft].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.category.localeCompare(b.category));
    let lastType = null;
    for (const d of rows) {
      if (d.type !== lastType) { lastType = d.type; body.append(el('tr', { class: 'type-row' }, el('td', { colspan: '6' }, d.type))); }
      const raw = sum.byCat[d.category] || 0;
      const actual = d.type === 'income' ? raw : -raw;
      const overActual = actual > d.amount && d.amount > 0 && d.type !== 'income';
      /* Live "remaining" line under the amount input — budget minus actual,
         red when overspent (never red for income: earning above target is fine). */
      const remainingEl = el('div', { class: 'bud-remaining' });
      const updateRemaining = () => {
        if (!d.amount) { remainingEl.textContent = ''; remainingEl.className = 'bud-remaining'; return; }
        const rem = d.amount - actual;
        const over = rem < 0 && d.type !== 'income';
        remainingEl.textContent = over ? `${money(-rem)} over` : `${money(rem)} left`;
        remainingEl.className = 'bud-remaining' + (over ? ' over' : '');
      };
      updateRemaining();
      body.append(el('tr', {},
        el('td', {}, d.category),
        el('td', {}, typeBadge(d.type)),
        el('td', { class: 'num' }, el('div', { class: 'bud-amt-wrap' },
          el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: d.amount || '',
            'aria-label': `Budget amount for ${d.category}`, onchange: e => { d.amount = parseFloat(e.target.value) || 0; d.amountRaw = null; mark(); updateRemaining(); renderBudgetTotals(); } }),
          remainingEl)),
        el('td', { class: `num${overActual ? ' text-danger' : ' text-muted'}`, style: 'white-space:nowrap' }, money(actual)),
        el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: d.notes, style: 'width:230px',
          'aria-label': `Notes for ${d.category}`, onchange: e => { d.notes = e.target.value; mark(); } })),
        el('td', { style: 'white-space:nowrap' },
          d.inFile
            ? el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Clear budget for ${d.category}`, title: 'Clear this category from the period file', onclick: () => { d.amount = 0; d.amountRaw = null; d.notes = ''; d.inFile = false; mark(); renderBudgets(); } }, '✕')
            : '',
          el('button', { class: 'btn-ghost btn-ghost-sm', 'aria-label': `Delete category ${d.category}`, title: 'Delete this category everywhere', onclick: async () => {
            if (await promptDeleteCategory(d.category)) {
              const draft = budgetDraft();
              const i = draft.indexOf(d);
              if (i !== -1 && !d.inFile) draft.splice(i, 1);
              renderBudgets();
            }
          } }, icoEl(['trash-2', 'trash'])))));
    }
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
    const n = S.settings.month_start_day;
    const meta = S.budgetMeta[S.period];
    const fm = patchFrontmatter((meta && meta.raw) || '', { period: S.period });
    // Correct English ordinal for any day (1st, 2nd, 3rd, 21st, 22nd, 23rd, …) —
    // the old hardcoded "rd"/"nd" only read right for the default day 23.
    const ordinal = d => { const v = d % 100; return d + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
    const iv = ctx.intervalDays();
    const rangeNote = iv
      ? 'With `period_days: ' + iv + '`, this period runs for ' + iv + ' days from ' +
        periodRange(S.period).start + ', counted from `period_anchor: ' +
        S.settings.period_anchor + '`.'
      : n === 1
        ? 'With `month_start_day: 1`, this period is the calendar month — the 1st to the last day of the month.'
        : 'With `month_start_day: ' + n + '`, this period runs from the ' + ordinal(n) +
          ' of the previous month to the ' + ordinal(n - 1) + ' of this month.';
    const lines = ['---', fm, '---', '', `# Budget — ${S.period}`, '',
      rangeNote, '',
      '| Category | Type | Amount | Notes |', '|----------|------|-------:|-------|'];
    const rows = [...draft].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.category.localeCompare(b.category));
    for (const d of rows) {
      const amt = d.amountRaw != null ? d.amountRaw : d.amount.toFixed(2);
      lines.push(`| ${escMd(d.category)} | ${d.type} | ${amt} | ${escMd(d.notes)} |`);
    }
    lines.push('');
    // The period name IS the filename, for both shapes — no reassembling it
    // from parts, which is what limited this to 'YYYY-MM'.
    await writeFile(`Budgets/${S.period}.md`, lines.join('\n'));
    budDirty = false;
    $('#budSave').disabled = true;
    toast(`Budget saved to Budgets/${S.period}.md`);
  }

  function copyPreviousBudget() {
    const prev = S.budgets[shiftPeriod(S.period, -1)];
    if (!prev || !prev.length) return toast('No budget found for the previous period', true);
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
    toast(copied ? `Copied ${copied} categories from the previous period` : 'Nothing to copy — every category already has a value');
  }

  async function addNewCategory() {
    const cat = await promptCreateCategory();
    if (!cat) return;
    budgetDraft().push({ category: cat.name, type: cat.type, amount: 0, notes: '', inFile: false });
    renderBudgets();
  }

  ctx.provide({ renderBudgets, saveBudget, copyPreviousBudget, addNewCategory, invalidateBudgetDraft, budgetDirty,
    otherShapeBudgets, carryStructure });
};
