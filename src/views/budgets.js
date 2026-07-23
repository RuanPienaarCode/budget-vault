'use strict';
/* Budget page — per-period category amounts, edited as a draft and saved to
   Budgets/<period>.md. */

const { el, escMd, icoEl, patchFrontmatter } = require('../util');
const { TYPE_ORDER } = require('../constants');

module.exports = function registerBudgets(ctx) {
  const { S, $, money, toast, typeBadge, writeFile, periodTitle, periodMonthName, periodSummary, shiftPeriod, promptCreateCategory, promptDeleteCategory } = ctx;

  let budDraft = null, budDraftPeriod = null;
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
      $('#budSave').disabled = true;
    }
    return budDraft;
  }
  // Drop the in-memory draft so it rebuilds from S.budgets on next render.
  // Called after any reload from disk (sync / manual edit) so a stale draft
  // can never be saved over freshly-loaded data.
  function invalidateBudgetDraft() { budDraft = null; budDraftPeriod = null; }
  // True when the budget view holds unsaved edits (Save button enabled).
  function budgetDirty() { const b = $('#budSave'); return !!b && !b.disabled; }

  function renderBudgets() {
    $('#budPeriodLabel').textContent = `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
    const draft = budgetDraft();
    const sum = periodSummary(S.period);
    const t = $('#budTable'); t.innerHTML = '';
    t.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Category'), el('th', { scope: 'col' }, 'Type'),
      el('th', { scope: 'col', class: 'num' }, 'Amount'), el('th', { scope: 'col', class: 'num' }, 'Actual so far'), el('th', { scope: 'col' }, 'Notes'), el('th', { scope: 'col' }, ''))));
    const body = el('tbody', {});
    const mark = () => $('#budSave').disabled = false;
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
          el('input', { type: 'number', step: '0.01', class: 'form-control form-control-sm', value: d.amount || '', onchange: e => { d.amount = parseFloat(e.target.value) || 0; d.amountRaw = null; mark(); updateRemaining(); } }),
          remainingEl)),
        el('td', { class: `num${overActual ? ' text-danger' : ' text-muted'}`, style: 'white-space:nowrap' }, money(actual)),
        el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: d.notes, style: 'width:230px', onchange: e => { d.notes = e.target.value; mark(); } })),
        el('td', { style: 'white-space:nowrap' },
          d.inFile
            ? el('button', { class: 'btn-ghost', style: 'padding:0.2rem 0.6rem;font-size:0.78rem', 'aria-label': `Clear budget for ${d.category}`, title: 'Clear this category from the period file', onclick: () => { d.amount = 0; d.amountRaw = null; d.notes = ''; d.inFile = false; mark(); renderBudgets(); } }, '✕')
            : '',
          el('button', { class: 'btn-ghost', style: 'padding:0.2rem 0.6rem;font-size:0.78rem', 'aria-label': `Delete category ${d.category}`, title: 'Delete this category everywhere', onclick: async () => {
            if (await promptDeleteCategory(d.category)) {
              const draft = budgetDraft();
              const i = draft.indexOf(d);
              if (i !== -1 && !d.inFile) draft.splice(i, 1);
              renderBudgets();
            }
          } }, icoEl(['trash-2', 'trash'])))));
    }
    t.append(body);
  }

  async function saveBudget() {
    // Persist rows that were already in the period file (a deliberately
    // zero-budgeted category must survive) plus any virtual row the user
    // gave an amount or a note. Untouched zero rows stay display-only, so
    // the period file doesn't bloat to all 50+ categories.
    const draft = budgetDraft().filter(d => d.category && (d.inFile || d.amount || (d.notes && d.notes.trim())));
    for (const d of draft) d.inFile = true;
    S.budgets[S.period] = draft.map(d => ({ ...d }));
    const [y, m] = S.period.split('-');
    const n = S.settings.month_start_day;
    const meta = S.budgetMeta[S.period];
    const fm = patchFrontmatter((meta && meta.raw) || '', { period: S.period });
    // Correct English ordinal for any day (1st, 2nd, 3rd, 21st, 22nd, 23rd, …) —
    // the old hardcoded "rd"/"nd" only read right for the default day 23.
    const ordinal = d => { const v = d % 100; return d + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
    const rangeNote = n === 1
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
    await writeFile(`Budgets/${y}-${m}.md`, lines.join('\n'));
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

  Object.assign(ctx, { renderBudgets, saveBudget, copyPreviousBudget, addNewCategory, invalidateBudgetDraft, budgetDirty });
};
