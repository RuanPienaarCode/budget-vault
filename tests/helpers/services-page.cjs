'use strict';
/* The Services page as a reader sees it, for the suites that check what each
   row SAYS about its charges (tests/services-*.test.cjs).

   Mounts the REAL loader and the REAL registerServices over a synthetic
   in-memory household (tests/helpers/figures.cjs mountFor, which also wires
   the real money formatter), renders the page, and reads back each service
   row: its badges with their tooltips, and the one-tap next-billing hint.
   Nothing here decides anything — it reports what the view built, so a suite
   asserts on the page and not on a mirror of the code that drew it.

   The caller pins the clock (figures.cjs pinClock): every reading on this page
   is measured from today. */

const { stubObsidian } = require('./harness.cjs');
stubObsidian();
const { mountFor } = require('./figures.cjs');

const B = 'Budget';
const TX_HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';

/* A household with one rand account ("Cheque") unless told otherwise.
     services  Services.md table rows, already pipe-formatted (nine columns:
               the last one is Currency, blank for the household's own)
     accounts  { label: 'frontmatter lines' } — added to, or replacing, Cheque
     tx        { label: { 'YYYY-MM': ['| row |', ...] } } */
function household({ services = [], accounts = {}, tx = {} } = {}) {
  const files = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Bills.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',
    [`${B}/Services.md`]: '---\nkind: services\n---\n\n'
      + '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Currency |\n'
      + '|---|---|---:|---|---|---|---|---|---|\n' + services.join('\n') + '\n',
  };
  const accts = { Cheque: 'type: checking\nbalance: 5000.00\nbalance_updated: 2026-10-01', ...accounts };
  for (const [label, fm] of Object.entries(accts)) {
    files[`${B}/Accounts/${label}.md`] = `---\n${fm}\ntx_label: "${label}"\n---\n`;
  }
  for (const [label, months] of Object.entries(tx)) {
    for (const [month, rows] of Object.entries(months)) {
      files[`${B}/Transactions/${label}/${month}.md`] = TX_HEAD + rows.join('\n') + '\n';
    }
  }
  return files;
}

const all = (n, pred, out = []) => {
  for (const c of (n && n.children) || []) {
    if (c.nodeType === 1) { if (pred(c)) out.push(c); all(c, pred, out); }
  }
  return out;
};
const txt = n => String((n && n.textContent) || '').replace(/\s+/g, ' ').trim();

/* Render and read. A throw from renderServices is RETURNED, not raised: the
   page dying half-built is itself a finding (the app has no catch around a
   render), and a suite needs to say so rather than stop. */
async function servicesPage(files, { period = '2026-10' } = {}) {
  const M = await mountFor(files, { period, budgetFolder: B });
  try { M.ctx.renderServices(); } catch (e) { return { M, error: e, rows: [], kpis: [] }; }
  const table = M.nodes.get('#svcTable');
  const kpis = all(M.nodes.get('#servicesKpis'), n => n._cls && n._cls.has('mini')).map(txt);
  const rows = all(table, n => n.tagName === 'TR' && !(n._cls && n._cls.has('type-row'))
    && n._parent && n._parent.tagName === 'TBODY').map(tr => {
    const hint = all(tr, n => n._cls && n._cls.has('svc-next-hint'))[0];
    return {
      name: txt(tr.children[0]),
      badges: all(tr, n => n._cls && n._cls.has('category-badge'))
        .map(b => ({ text: txt(b), title: b.attrs.title || '', cls: [...b._cls] })),
      hint: hint ? { text: txt(hint), title: hint.attrs.title || '', node: hint } : null,
      tr,
    };
  });
  return { M, error: null, rows, kpis };
}

const rowNamed = (page, name) => page.rows.find(r => r.name.startsWith(name));

module.exports = { B, household, servicesPage, rowNamed, txt };
