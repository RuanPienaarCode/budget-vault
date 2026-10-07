'use strict';
/* Drive the Report page the way a reader does, over the REAL views.

   Several suites need the same four steps — mount every view over the real
   loader, pick a period pill, switch the JSON format on, press Create — and
   then read back what createReport() wrote into the in-memory vault. Spelled
   once here so each suite reads as the finding it guards rather than as forty
   lines of wiring, and so a change to how the page is driven is made in one
   place instead of drifting across six copies.

   Nothing here pins the clock: the caller does, around the whole mount and
   create, because createReport() reads currentPeriod() and todayIso() at the
   moment Create is pressed, not at mount time. */

const { mountFor } = require('./figures.cjs');

const kids = (n, pred, out = []) => {
  for (const c of (n && n.children) || []) {
    if (c.nodeType === 1) { if (pred(c)) out.push(c); kids(c, pred, out); }
  }
  return out;
};
const text = n => String((n && n.textContent) || '').replace(/\s+/g, ' ').trim();

/* `folder` is typed into the folder field (setReportFolder), exactly as the
   static input's handler would; `pill` is a Period pill key ('current', '3m',
   '12m'); `json` switches the second format pill on. Returns the written
   documents plus what landed in the vault that was not there before, so a
   suite can assert on a refusal ("nothing was written") as easily as on a
   success. */
async function createReport(M, { pill = 'current', detail = 'summary', json = true, folder } = {}) {
  const { ctx, nodes } = M;
  const before = new Set(ctx.vault._store.keys());
  ctx.renderReport();
  if (pill !== 'current') ctx.setReportPeriod(pill);
  if (detail !== 'summary') ctx.setReportDetail(detail);
  if (folder !== undefined) ctx.setReportFolder(folder);
  if (json) {
    const btn = kids(nodes.get('#reportFormatPills'), n => n.tagName === 'BUTTON').find(b => /JSON/i.test(text(b)));
    if (!btn) throw new Error('report-page: the JSON format pill did not render');
    btn._fire('click');
  }
  await ctx.createReport();
  const store = ctx.vault._store;
  const written = [...store.keys()].filter(k => !before.has(k) && !k.endsWith('/.folder'));
  const mdPath = written.find(k => k.endsWith(' Financial Report.md')) || null;
  const jsonPath = written.find(k => k.endsWith(' Financial Report.json')) || null;
  return {
    written, mdPath, jsonPath,
    md: mdPath ? store.get(mdPath) : null,
    json: jsonPath ? JSON.parse(store.get(jsonPath)) : null,
    toasts: ctx._toasts.map(t => t.msg),
  };
}

/* The text under one `## Heading` of a generated report, up to the next one. */
function section(md, heading) {
  const at = md.indexOf(`\n## ${heading}\n`);
  if (at < 0) return null;
  const rest = md.slice(at + 1);
  const next = rest.indexOf('\n## ', 1);
  return next < 0 ? rest : rest.slice(0, next);
}

module.exports = { mountFor, createReport, section, kids, text };
