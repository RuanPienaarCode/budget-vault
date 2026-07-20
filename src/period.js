'use strict';
/* Financial-period (payday month) math + per-period summaries. A period
   'YYYY-MM' runs from month_start_day of the previous month to the day
   before it in the named month. */

const { MONTHS } = require('./constants');

module.exports = function registerPeriod(ctx) {
  const { S } = ctx;

  function periodRange(p) {
    const [y, m] = p.split('-').map(Number);
    const n = S.settings.month_start_day;
    if (n === 1) {
      return { start: `${p}-01`, end: `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
    }
    const sd = new Date(y, m - 2, n);
    const ed = new Date(y, m - 1, n - 1);
    const f = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: f(sd), end: f(ed) };
  }
  function currentPeriod() {
    const now = new Date();
    let y = now.getFullYear(), m = now.getMonth() + 1;
    if (S.settings.month_start_day > 1 && now.getDate() >= S.settings.month_start_day) {
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  function shiftPeriod(p, delta) {
    let [y, m] = p.split('-').map(Number);
    m += delta;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  /* "August 2026" — the period's display month (the month it ENDS in, i.e. the
     YYYY-MM the period is named after). Shown next to the date range so the
     payday convention ("August" = Jul 23 → Aug 22) is always explicit. */
  const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  function periodMonthName(p) {
    const [y, m] = p.split('-').map(Number);
    return `${MONTH_FULL[m - 1]} ${y}`;
  }
  function periodTitle(p) {
    const { start, end } = periodRange(p);
    const f = d => `${MONTHS[parseInt(d.slice(5, 7), 10) - 1]} ${parseInt(d.slice(8), 10)}`;
    const sy = start.slice(0, 4), ey = end.slice(0, 4);
    if (sy === ey) return `${f(start)} – ${f(end)}, ${ey}`;
    return `${f(start)}, ${sy} – ${f(end)}, ${ey}`;
  }
  function txInPeriod(p) {
    const { start, end } = periodRange(p);
    const out = [];
    for (const f of Object.values(S.txFiles)) {
      if (f.month < start.slice(0, 7) || f.month > end.slice(0, 7)) continue;
      for (const r of f.rows) if (r.date >= start && r.date <= end) out.push({ ...r, label: f.label, _file: f, _row: r });
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || a.desc.localeCompare(b.desc));
    return out;
  }

  /* ---------------------------- calculations ---------------------------- */
  function catType(name) { return S.categories.find(c => c.name === name)?.type || null; }
  function periodSummary(p) {
    const tx = txInPeriod(p).filter(t => !t.excluded);
    let income = 0, spend = 0, uncategorised = 0;
    const byCat = {};
    for (const t of tx) {
      const type = catType(t.cat);
      if (!t.cat) uncategorised++;
      if (type === 'transfer') continue;
      byCat[t.cat || ''] = (byCat[t.cat || ''] || 0) + t.amount;
      if (type === 'income') income += t.amount;
      else if (t.amount < 0) spend += -t.amount;
    }
    return { income, spend, uncategorised, byCat, count: tx.length };
  }
  function budgetTotals(p) {
    const budget = S.budgets[p] || [];
    return {
      income: budget.filter(b => b.type === 'income').reduce((a, b) => a + b.amount, 0),
      spend: budget.filter(b => b.type !== 'income' && b.type !== 'transfer').reduce((a, b) => a + b.amount, 0),
    };
  }

  Object.assign(ctx, {
    periodRange, currentPeriod, shiftPeriod, periodTitle, periodMonthName, txInPeriod,
    catType, periodSummary, budgetTotals,
  });
};
