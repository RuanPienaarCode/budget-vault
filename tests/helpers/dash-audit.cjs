'use strict';
/* Shared scaffolding for tests/dashboard-audit-*.test.cjs: a small synthetic
   household builder and the two readers those suites use on a rendered
   Dashboard. Synthetic on purpose — the audit that produced these suites was
   run over a real vault, and none of its figures may be committed. Every
   fixture below reproduces the SHAPE of a defect the audit measured, not the
   figures. */

const { stubObsidian } = require('./harness.cjs');
stubObsidian();
const { mountFor, pinClock, leaves, ownText } = require('./figures.cjs');

const B = 'Budget';
const TX_HEAD = '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n'
  + '|---|---|---|---:|---|---|---|\n';
/* rows: [date, description, category, amount, excluded?, split?] */
const tx = rows => TX_HEAD + rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${Number(r[3]).toFixed(2)} | ${r[4] || ''} |  | ${r[5] || ''} |\n`).join('');

const settings = (extra = '') =>
  `---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n${extra}---\n`;

const cat = (type, extra = '') => `---\ntype: ${type}\ncolor: "#888888"\n${extra}---\n`;

/* A household with the categories every suite needs and nothing else. */
function base(extraSettings = '') {
  return {
    [`${B}/Settings.md`]: settings(extraSettings),
    [`${B}/Categories/Salary.md`]: cat('income'),
    [`${B}/Categories/Groceries.md`]: cat('expense'),
    [`${B}/Categories/Transfer.md`]: cat('transfer'),
    [`${B}/Categories/Car loan.md`]: cat('expense'),
    [`${B}/Categories/Phone.md`]: cat('expense'),
  };
}

const account = (name, fm) =>
  `---\ntype: ${fm.type || 'checking'}\ntx_label: "${name}"\n`
  + Object.entries(fm).filter(([k]) => k !== 'type').map(([k, v]) => `${k}: ${v}\n`).join('')
  + '---\n';

const textOf = node => (node ? leaves(node).map(ownText).filter(Boolean).join(' ') : '');

/* Depth-first search of the stub tree. */
function find(node, pred, out = []) {
  if (!node) return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) if (c.nodeType === 1) find(c, pred, out);
  return out;
}
const hasClass = (n, c) => !!(n._cls && n._cls.has(c));

/* The printed value of a `data-fig` node, as a whole-number string of digits
   and sign only (the formatter's spaces/nbsp/symbol are not the subject). */
function figNumber(node, fig) {
  const hit = find(node, n => n.attrs && n.attrs['data-fig'] === fig)[0];
  if (!hit) return null;
  const s = textOf(hit).replace(/[^\d-]/g, '');
  return s === '' ? null : Number(s);
}

/* Mount over `files` with the clock pinned to `today`, render the Dashboard,
   and hand back the tree plus a text reader. The clock is restored before
   returning: nothing here needs it once the card has been built. */
async function renderDash(files, { today, period, settingsOverride } = {}) {
  const unpin = pinClock(today);
  try {
    const M = await mountFor(files, { period, settings: settingsOverride });
    M.ctx.renderDashboard();
    return { ...M, t: sel => textOf(M.nodes.get(sel)) };
  } finally { unpin(); }
}

module.exports = { B, tx, base, account, cat, settings, textOf, find, hasClass, figNumber, renderDash, pinClock, mountFor };
