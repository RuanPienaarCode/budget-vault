'use strict';
/* Tax — tax-return tracking per tax year, saved to Tax/<year>.md with the
   uploaded documents stored in Tax/<year>/. Everything country-specific —
   authority name, tax-year span, deadlines, taxpayer-type labels and the
   starter checklist seeded when a year is created — comes from the country
   profile in locale.js (Settings.md `country`, default South Africa / SARS).
   Edit seeded sources to match your own banks, providers and income. */

const { el, escMd, icoEl, safeSeg, patchFrontmatter } = require('../util');
const { askFields, confirmModal } = require('../modal');

module.exports = function registerTax(ctx) {
  const { S, $, app, toast, writeFile, writeBinary, fileAt, locale } = ctx;

  /* The tax year we'd be dealing with today, per the country profile. */
  function currentTaxYear() {
    return locale().currentTaxYear(new Date());
  }
  const T = () => S.tax[S.taxYear];
  const mark = () => { S.taxDirty = true; $('#taxSave').disabled = false; };

  /* ------------------------------ render -------------------------------- */
  function renderTax() {
    const loc = locale();
    const years = Object.keys(S.tax).sort();
    $('#taxEmptyCard').classList.toggle('hidden', years.length > 0);
    $('#taxContent').classList.toggle('hidden', !years.length);
    if (!years.length) {
      $('#taxEmptyIntro').textContent = loc.taxIntro;
      $('#taxStart').textContent = `Start tracking the ${currentTaxYear()} tax year`;
      return;
    }

    const t = T();
    $('#taxSubNote').innerHTML = '';
    $('#taxSubNote').append(`Tax year ${S.taxYear} (${loc.yearSpan(+S.taxYear)}) · saved to `,
      el('code', {}, `Tax/${S.taxYear}.md`));

    const sel = $('#taxYearSel'); sel.innerHTML = '';
    for (const y of years) sel.append(el('option', { value: y, ...(y === S.taxYear ? { selected: '' } : {}) }, y));

    renderTaxKpis(t);
    renderSeason(t);
    renderSteps(t);
    renderDocs(t);
  }

  function activeDeadline(t) {
    return locale().activeDeadline(t);
  }
  function daysTo(iso) {
    const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - today) / 86400000);
  }

  function renderTaxKpis(t) {
    const kpis = $('#taxKpis'); kpis.innerHTML = '';
    const tile = (l, v, cls) => kpis.append(el('div', { class: 'mini' },
      el('div', { class: 'l' }, l), el('div', { class: `v num ${cls || ''}` }, v)));

    const d = daysTo(activeDeadline(t));
    tile('Deadline', d === null ? '—' : d < 0 ? `${-d} d overdue` : `${d} days`,
      d !== null && d < 0 ? 'text-danger' : d !== null && d <= 30 ? 'text-warning' : '');
    const steps = t.steps.filter(s => s.status !== 'n/a');
    tile('Steps done', `${steps.filter(s => s.status === 'done').length} / ${steps.length}`);
    const docs = t.docs.filter(x => x.status !== 'n/a');
    const ready = docs.filter(x => x.status === 'uploaded').length;
    tile('Documents in', `${ready} / ${docs.length}`, ready === docs.length && docs.length ? 'text-success' : '');
    const typeLabel = (locale().taxpayerTypes.find(([v]) => v === t.taxpayer_type) || [])[1];
    tile('Taxpayer', typeLabel || 'Unknown');
  }

  function renderSeason(t) {
    const loc = locale();
    const b = $('#taxSeasonBody'); b.innerHTML = '';
    const field = (label, control) => el('label', { class: 'tax-field' }, el('span', { class: 'l' }, label), control);
    b.append(el('div', { class: 'row tax-season-row' },
      field('Taxpayer type', el('select', { class: 'form-select form-select-sm',
        onchange: e => { t.taxpayer_type = e.target.value; mark(); renderTax(); } },
        ...loc.taxpayerTypes
          .map(([v, l]) => el('option', { value: v, ...(t.taxpayer_type === v ? { selected: '' } : {}) }, l)))),
      field('Assessment', el('select', { class: 'form-select form-select-sm',
        onchange: e => { t.assessment = e.target.value; mark(); renderTax(); } },
        ...loc.assessments
          .map(([v, l]) => el('option', { value: v, ...(t.assessment === v ? { selected: '' } : {}) }, l)))),
      field(loc.deadlineLabels[0], el('input', { type: 'text', class: 'form-control form-control-sm', value: t.deadline_standard,
        placeholder: 'YYYY-MM-DD', onchange: e => { t.deadline_standard = e.target.value.trim(); mark(); renderTax(); } })),
      field(loc.deadlineLabels[1], el('input', { type: 'text', class: 'form-control form-control-sm', value: t.deadline_provisional,
        placeholder: 'YYYY-MM-DD', onchange: e => { t.deadline_provisional = e.target.value.trim(); mark(); renderTax(); } }))));

    b.append(el('p', { class: 'tax-season-msg' }, loc.seasonMsgs(t).join(' ')));
    b.append(el('p', { class: 'text-muted', style: 'font-size:12.5px;margin:0' }, loc.safetyNote));
  }

  const STEP_CYCLE = { todo: 'busy', busy: 'done', done: 'n/a', 'n/a': 'todo' };
  const STEP_LABEL = { todo: 'To do', busy: 'Busy', done: 'Done', 'n/a': 'N/A' };
  const STEP_ICO = { todo: ['circle'], busy: ['hourglass'], done: ['circle-check', 'check-circle'], 'n/a': ['circle-slash', 'slash'] };

  function renderSteps(t) {
    const tbl = $('#taxStepsTable'); tbl.innerHTML = '';
    tbl.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Step'), el('th', { scope: 'col' }, 'Status'),
      el('th', { scope: 'col' }, 'Due'), el('th', { scope: 'col' }, 'Notes'), el('th', { scope: 'col' }, ''))));
    const body = el('tbody', {});
    for (const s of t.steps) {
      const overdue = s.status !== 'done' && s.status !== 'n/a' && daysTo(s.due) !== null && daysTo(s.due) < 0;
      const pill = el('button', { class: `status-pill tax-${s.status.replace('/', '')}`,
        'aria-label': `Status: ${STEP_LABEL[s.status]} — click to change` },
        icoEl(STEP_ICO[s.status]), STEP_LABEL[s.status]);
      pill.addEventListener('click', () => { s.status = STEP_CYCLE[s.status]; mark(); renderTax(); });
      body.append(el('tr', { class: s.status === 'n/a' ? 'svc-inactive' : '' },
        el('td', { style: 'font-weight:600' }, s.step),
        el('td', {}, pill),
        el('td', {}, el('input', { type: 'text', class: `form-control form-control-sm ${overdue ? 'tax-overdue' : ''}`, value: s.due,
          placeholder: 'YYYY-MM-DD', style: 'width:120px', onchange: e => { s.due = e.target.value.trim(); mark(); renderTax(); } })),
        el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: s.notes, style: 'min-width:220px',
          onchange: e => { s.notes = e.target.value; mark(); } })),
        el('td', {}, el('button', { class: 'btn-ghost', style: 'padding:0.2rem 0.6rem;font-size:0.78rem',
          'aria-label': `Remove step ${s.step}`,
          onclick: () => { t.steps.splice(t.steps.indexOf(s), 1); mark(); renderTax(); } }, '✕'))));
    }
    if (!t.steps.length) body.append(el('tr', {}, el('td', { colspan: '5', class: 'text-muted' }, 'No steps yet.')));
    tbl.append(body);
  }

  const DOC_CYCLE = { needed: 'n/a', uploaded: 'needed', 'n/a': 'needed' };
  const DOC_LABEL = { needed: 'Needed', uploaded: 'Uploaded', 'n/a': 'N/A' };
  const DOC_ICO = { needed: ['hourglass'], uploaded: ['circle-check', 'check-circle'], 'n/a': ['circle-slash', 'slash'] };

  function renderDocs(t) {
    $('#taxDocsSub').innerHTML = '';
    $('#taxDocsSub').append('Certificates & records for the return · files stored in ', el('code', {}, `Tax/${S.taxYear}/`));
    const tbl = $('#taxDocsTable'); tbl.innerHTML = '';
    tbl.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Document'), el('th', { scope: 'col' }, 'Source'), el('th', { scope: 'col' }, 'Status'),
      el('th', { scope: 'col' }, 'File'), el('th', { scope: 'col' }, 'Notes'), el('th', { scope: 'col' }, ''))));
    const body = el('tbody', {});
    for (const d of t.docs) {
      const pill = el('button', { class: `status-pill tax-${d.status.replace('/', '')}`,
        'aria-label': `Status: ${DOC_LABEL[d.status]} — click to change` },
        icoEl(DOC_ICO[d.status]), DOC_LABEL[d.status]);
      // Cycling away from "uploaded" only changes the status — the file link
      // (and the file itself) stays.
      pill.addEventListener('click', () => { d.status = DOC_CYCLE[d.status]; mark(); renderTax(); });

      let fileCell;
      if (d.file) {
        fileCell = el('button', { class: 'btn-ghost tax-doc-link', 'aria-label': `Open ${d.file}` },
          icoEl(['paperclip']), d.file);
        fileCell.addEventListener('click', () => openDoc(d.file));
      } else {
        fileCell = el('button', { class: 'btn-ghost', style: 'padding:0.2rem 0.6rem;font-size:0.78rem',
          'aria-label': `Upload file for ${d.name}` }, icoEl(['cloud-upload', 'upload-cloud']), ' Upload');
        fileCell.addEventListener('click', () => { pendingDocTarget = d; $('#taxFileInput').click(); });
      }
      body.append(el('tr', { class: d.status === 'n/a' ? 'svc-inactive' : '' },
        el('td', { style: 'font-weight:600' }, d.name),
        el('td', { class: 'text-muted' }, d.source),
        el('td', {}, pill),
        el('td', {}, fileCell),
        el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: d.notes, style: 'min-width:180px',
          onchange: e => { d.notes = e.target.value; mark(); } })),
        el('td', {}, el('button', { class: 'btn-ghost', style: 'padding:0.2rem 0.6rem;font-size:0.78rem',
          'aria-label': `Remove document ${d.name}`,
          onclick: async () => {
            const go = !d.file || await confirmModal(app, {
              title: 'Remove document row',
              message: `Remove "${d.name}" from the list? The uploaded file ${d.file} stays in Tax/${S.taxYear}/ — delete it from the vault yourself if you want it gone.`,
              confirmText: 'Remove row',
            });
            if (!go) return;
            t.docs.splice(t.docs.indexOf(d), 1); mark(); renderTax();
          } }, '✕'))));
    }
    if (!t.docs.length) body.append(el('tr', {}, el('td', { colspan: '6', class: 'text-muted' }, 'No documents yet.')));
    tbl.append(body);
  }

  function openDoc(name) {
    const f = fileAt(`Tax/${S.taxYear}/${name}`);
    if (!f) return toast(`File not found: Tax/${S.taxYear}/${name}`, true);
    app.workspace.getLeaf('tab').openFile(f);
  }

  /* ------------------------------ uploads -------------------------------- */
  let pendingDocTarget = null;   // doc row whose Upload button opened the picker

  async function handleTaxFile(file) {
    if (!S.taxYear) return;
    const t = T();
    let target = pendingDocTarget && t.docs.includes(pendingDocTarget) ? pendingDocTarget : null;
    pendingDocTarget = null;

    if (!target) {
      const NEW = '＋ New document row';
      const open = t.docs.filter(d => !d.file).map(d => `${d.name} — ${d.source}`);
      const r = await askFields(app, `Attach "${file.name}"`, [
        { key: 'to', label: 'Attach to', type: 'select', options: [...open, NEW], value: open[0] ?? NEW },
      ]);
      if (!r) return;
      if (r.to === NEW) {
        const n = await askFields(app, 'New document', [
          { key: 'name', label: 'Document name', type: 'text', value: file.name.replace(/\.[^.]+$/, '') },
          { key: 'source', label: 'Source', type: 'text' },
        ]);
        if (!n || !n.name.trim()) return;
        target = { name: n.name.trim(), source: (n.source || '').trim(), status: 'needed', file: '', notes: '' };
        t.docs.push(target);
      } else {
        target = t.docs.filter(d => !d.file)[open.indexOf(r.to)];
      }
    }

    let name = safeSeg(file.name) || 'document';
    // Uniquify so a re-upload never silently overwrites an earlier certificate.
    if (fileAt(`Tax/${S.taxYear}/${name}`)) {
      const dot = name.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let i = 2;
      while (fileAt(`Tax/${S.taxYear}/${stem} (${i})${ext}`)) i++;
      name = `${stem} (${i})${ext}`;
    }
    try {
      await writeBinary(`Tax/${S.taxYear}/${name}`, await file.arrayBuffer());
    } catch (e) {
      return toast(e.message || String(e), true);
    }
    target.file = name;
    target.status = 'uploaded';
    // The binary is already on disk — save the markdown too so the two never
    // drift apart (an unsaved row pointing at a saved file, or vice versa).
    await saveTax();
    toast(`Uploaded ${name}`);
  }

  /* ------------------------------ persist -------------------------------- */
  function serializeTax(year) {
    const t = S.tax[year];
    const fm = patchFrontmatter(t.fmRaw || '', {
      kind: 'tax', tax_year: year,
      taxpayer_type: t.taxpayer_type, assessment: t.assessment,
      deadline_standard: t.deadline_standard || null, deadline_provisional: t.deadline_provisional || null,
    });
    const loc = locale();
    const lines = ['---', ...fm.split('\n'), '---', '', `# Tax Year ${year}`, '',
      `${loc.authority === 'Tax' ? 'Tax' : loc.authority} return tracking for the ${year} tax year (${loc.yearSpan(+year)}).`,
      'Step `status` is `todo`, `busy`, `done` or `n/a`; document `status` is `needed`, `uploaded` or `n/a`.',
      `Uploaded files live in \`Tax/${year}/\`.`, '',
      '## Progress', '',
      '| Step | Status | Due | Notes |',
      '|------|--------|-----|-------|'];
    for (const s of t.steps) lines.push(`| ${escMd(s.step)} | ${s.status} | ${escMd(s.due)} | ${escMd(s.notes)} |`);
    lines.push('', '## Documents', '',
      '| Document | Source | Status | File | Notes |',
      '|----------|--------|--------|------|-------|');
    for (const d of t.docs) lines.push(`| ${escMd(d.name)} | ${escMd(d.source)} | ${d.status} | ${escMd(d.file)} | ${escMd(d.notes)} |`);
    lines.push('');
    return lines.join('\n');
  }

  async function saveTax() {
    if (!S.taxYear) return;
    await writeFile(`Tax/${S.taxYear}.md`, serializeTax(S.taxYear));
    S.taxDirty = false; $('#taxSave').disabled = true;
    toast(`Saved Tax/${S.taxYear}.md`);
  }

  /* ------------------------------ actions -------------------------------- */
  async function addTaxStep() {
    const r = await askFields(app, 'New step', [
      { key: 'step', label: 'Step', type: 'text' },
      { key: 'due', label: 'Due (optional)', type: 'text', placeholder: 'YYYY-MM-DD' },
    ]);
    if (!r || !r.step.trim()) return;
    T().steps.push({ step: r.step.trim(), status: 'todo', due: (r.due || '').trim(), notes: '' });
    mark(); renderTax();
  }

  async function addTaxDoc() {
    const r = await askFields(app, 'New document', [
      { key: 'name', label: 'Document name', type: 'text' },
      { key: 'source', label: 'Source (who issues it)', type: 'text' },
    ]);
    if (!r || !r.name.trim()) return;
    T().docs.push({ name: r.name.trim(), source: (r.source || '').trim(), status: 'needed', file: '', notes: '' });
    mark(); renderTax();
  }

  function seedTaxYear(year) {
    const loc = locale();
    S.tax[String(year)] = {
      fmRaw: '',
      taxpayer_type: loc.defaultTaxpayerType, assessment: loc.defaultAssessment,
      ...loc.seedDeadlines(year),
      steps: loc.seedSteps(year).map(s => ({ status: 'todo', due: '', notes: '', ...s })),
      docs: loc.seedDocs().map(d => ({ status: 'needed', file: '', notes: '', ...d })),
    };
  }

  async function startTax() {
    const year = currentTaxYear();
    seedTaxYear(year);
    S.taxYear = String(year);
    await saveTax();
    renderTax();
  }

  async function newTaxYear() {
    const years = Object.keys(S.tax).map(Number);
    const suggested = years.length ? Math.max(...years) + 1 : currentTaxYear();
    const r = await askFields(app, 'New tax year', [
      { key: 'year', label: locale().yearHint, type: 'number', value: String(suggested) },
    ]);
    if (!r) return;
    const year = parseInt(r.year, 10);
    if (!year || year < 2000 || year > 2100) return toast('Not a valid year', true);
    if (S.tax[String(year)]) { S.taxYear = String(year); return renderTax(); }
    seedTaxYear(year);
    S.taxYear = String(year);
    await saveTax();
    renderTax();
  }

  async function changeTaxYear(year) {
    if (S.taxDirty) {
      const go = await confirmModal(app, {
        title: 'Unsaved tax changes',
        message: 'Switching tax year will discard your unsaved edits. Continue?',
        confirmText: 'Discard & switch',
      });
      if (!go) { renderTax(); return; }   // re-render to snap the select back
      await ctx.loadVault();
      $('#taxSave').disabled = true;      // edits discarded — nothing left to save
    }
    S.taxYear = year;
    renderTax();
  }

  Object.assign(ctx, { renderTax, saveTax, addTaxStep, addTaxDoc, newTaxYear, startTax, changeTaxYear, handleTaxFile });
};
