'use strict';
/* Tax — tax-return tracking per tax year, saved to Tax/<year>.md with the
   uploaded documents stored in Tax/<year>/. Everything country-specific —
   authority name, tax-year span, deadlines, taxpayer-type labels and the
   starter checklist seeded when a year is created — comes from the country
   profile in locale.js (Settings.md `country`, default South Africa / SARS).
   Edit seeded sources to match your own banks, providers and income. */

const { el, kpiTiles, dateInput, keepScroll, icoEl } = require('../dom');
const { escMd, patchFrontmatter, yamlStr } = require('../markdown');
const { safeSeg } = require('../vault-path');
const { askFields, confirmModal } = require('../modal');

module.exports = function registerTax(ctx) {
  const { S, $, app, toast, writeFile, writeBinary, fileAt, locale, money } = ctx;

  /* The tax year we'd be dealing with today, per the country profile. */
  function currentTaxYear() {
    return locale().currentTaxYear(new Date());
  }
  const T = () => S.tax[S.taxYear];
  const { mark, clear: clearDirty } = ctx.dirtyFlag('taxDirty', '#taxSave');

  /* Shown on the empty card and in the Season card. The seeded steps, docs and
     deadline dates are country-profile defaults, not authoritative guidance. */
  function disclaimer() {
    const a = locale().authority;
    return 'This tracker is a personal checklist, not tax advice. Seeded steps, documents and ' +
      `deadline dates are editable starting points that change from year to year — confirm anything ` +
      `important with ${a === 'Tax' ? 'your tax authority' : a} or a registered tax professional.`;
  }

  /* ------------------------------ render -------------------------------- */
  function renderTax() {
    const loc = locale();
    const years = Object.keys(S.tax).sort();
    $('#taxEmptyCard').classList.toggle('hidden', years.length > 0);
    $('#taxContent').classList.toggle('hidden', !years.length);
    if (!years.length) {
      $('#taxEmptyIntro').textContent = loc.taxIntro;
      $('#taxEmptyHint').textContent =
        `Labels, tax-year dates and the starter checklist follow your country — currently ${loc.label}, ` +
        'changeable in the plugin settings. ' + disclaimer();
      $('#taxStart').textContent = `Start tracking the ${currentTaxYear()} tax year`;
      return;
    }

    const t = T();
    $('#taxSubNote').empty();
    $('#taxSubNote').append(`Tax year ${S.taxYear} (${loc.yearSpan(+S.taxYear)}) · saved to `,
      el('code', {}, `Tax/${S.taxYear}.md`));

    const sel = $('#taxYearSel'); sel.empty();
    for (const y of years) sel.append(el('option', { value: y, ...(y === S.taxYear ? { selected: '' } : {}) }, y));

    renderTaxKpis(t);
    renderSeason(t);
    renderSteps(t);
    renderFigures(t);
    renderDocs(t);
    renderOrphanYears();
  }

  /* Prior-year folders with no page behind them are invisible to the year
     picker — offer to seed a page rather than leaving the files stranded. */
  function renderOrphanYears() {
    const box = $('#taxSubNote');
    const orphans = (S.taxOrphanYears || []).filter(y => !S.tax[y]);
    if (!orphans.length) return;
    box.append(' · ');
    for (const y of orphans) {
      const b = el('button', { class: 'btn-ghost', style: 'padding:0.1rem 0.5rem;font-size:0.78rem',
        'aria-label': `Create a tax page for ${y}, which already has documents` }, `Tax/${y}/ has files — add ${y}`);
      b.addEventListener('click', async () => {
        // Through the guarded switch: seeding straight into S.taxYear would
        // save the NEW year, clear S.taxDirty and disable Save while the
        // previous year's unsaved edits were still sitting in memory —
        // unreachable, unwarned, and gone at the next reload.
        if (!await confirmDiscard()) return;
        seedTaxYear(+y);
        S.taxYear = y;
        await saveTax();
        renderTax();
      });
      box.append(b);
    }
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
    const tile = kpiTiles($('#taxKpis'));

    const d = daysTo(activeDeadline(t));
    tile('Deadline', d === null ? '—' : d < 0 ? `${-d} d overdue` : `${d} days`,
      d !== null && d < 0 ? 'text-danger' : d !== null && d <= 30 ? 'text-warning' : '');
    const steps = t.steps.filter(s => s.status !== 'n/a');
    tile('Steps done', `${steps.filter(s => s.status === 'done').length} / ${steps.length}`);
    const docs = t.docs.filter(x => x.status !== 'n/a');
    const ready = docs.filter(x => x.status === 'uploaded').length;
    tile('Documents in', `${ready} / ${docs.length}`, ready === docs.length && docs.length ? 'text-success' : '');
    tile('Figures', String((t.figures || []).length));
    const typeLabel = (locale().taxpayerTypes.find(([v]) => v === t.taxpayer_type) || [])[1];
    tile('Taxpayer', typeLabel || 'Unknown');
  }

  /* Editable fields never call renderTax(). `change` fires on blur, so on a
     phone the rebuild lands between the tap that leaves a field and the tap
     that arrives at the next one — the DOM under the finger is replaced, and
     the arriving tap hits whatever now occupies those coordinates (an "Add …"
     button opens a modal; a <select> opens the native picker).

     The rule, stated once so it can be applied elsewhere without re-deriving
     it: a handler may rebuild any subtree containing NO focusable controls; it
     must never rebuild the subtree holding the control that fired it. The three
     containers refreshDerived touches — the KPI strip, the check callouts and
     the figures totals row — are all input-free, so one call covers every field
     and no handler has to carry its own list of what reads it. That list was
     O(writers x readers) knowledge living in comments; this is one invariant. */
  let checksBox = null;
  const refreshDerived = t => { renderTaxKpis(t); renderChecks(t); renderFigureTotals(t); };

  function renderSeason(t) {
    const loc = locale();
    const b = $('#taxSeasonBody'); b.empty();
    const field = (label, control) => el('label', { class: 'tax-field' }, el('span', { class: 'l' }, label), control);
    // The two selects rebuild the whole card — taxpayer type and assessment
    // status change which fields exist and what the season message says. Safe
    // to do here: a select commits on close, with no keyboard and no next tap
    // already in flight.
    b.append(el('div', { class: 'row tax-season-row' },
      field('Taxpayer type', el('select', { class: 'form-select form-select-sm',
        onchange: e => { t.taxpayer_type = e.target.value; mark(); renderSeason(t); refreshDerived(t); } },
        ...loc.taxpayerTypes
          .map(([v, l]) => el('option', { value: v, ...(t.taxpayer_type === v ? { selected: '' } : {}) }, l)))),
      field('Assessment', el('select', { class: 'form-select form-select-sm',
        onchange: e => { t.assessment = e.target.value; mark(); renderSeason(t); refreshDerived(t); } },
        ...loc.assessments
          .map(([v, l]) => el('option', { value: v, ...(t.assessment === v ? { selected: '' } : {}) }, l)))),
      // Only the Deadline KPI tile reads these.
      field(loc.deadlineLabels[0], dateInput(t.deadline_standard, { class: 'form-control form-control-sm' },
        v => { t.deadline_standard = v; mark(); refreshDerived(t); })),
      field(loc.deadlineLabels[1], dateInput(t.deadline_provisional, { class: 'form-control form-control-sm' },
        v => { t.deadline_provisional = v; mark(); refreshDerived(t); }))));

    // Outcome fields only once there is an outcome — they are noise before it.
    if (t.assessment === 'assessed') {
      const num = (label, key, placeholder) => field(label, el('input', { type: 'text', inputmode: 'decimal',
        class: 'form-control form-control-sm', value: t[key] === null || t[key] === undefined ? '' : String(t[key]),
        placeholder, onchange: e => {
          const raw = e.target.value.trim();
          const n = Number(raw.replace(/[^\d.-]/g, ''));
          t[key] = raw === '' ? null : (Number.isFinite(n) ? n : null);
          mark(); refreshDerived(t);
        } }));
      b.append(el('div', { class: 'row tax-season-row' },
        // Nothing else displays the date or the reference — mark only.
        field('Assessment date', dateInput(t.assessment_date, { class: 'form-control form-control-sm' },
          v => { t.assessment_date = v; mark(); refreshDerived(t); })),
        field('Reference', el('input', { type: 'text', class: 'form-control form-control-sm', value: t.assessment_ref,
          placeholder: 'Notice / document no.', onchange: e => { t.assessment_ref = e.target.value.trim(); mark(); } })),
        num('Result (− = refund)', 'assessment_result', '-1250.00'),
        num('Taxable income assessed', 'assessment_income', '0.00')));
    }

    b.append(el('p', { class: 'tax-season-msg' }, loc.seasonMsgs(t).join(' ')));

    checksBox = el('div', {});
    b.append(checksBox);
    renderChecks(t);

    b.append(el('p', { class: 'text-muted', style: 'font-size:12.5px;margin:0 0 6px' }, loc.safetyNote));
    b.append(el('p', { class: 'text-muted', style: 'font-size:12.5px;margin:0' }, disclaimer()));
  }

  /* Locale-aware checks over the captured figures. The profile decides what is
     worth saying; the view only picks the callout colour. Its own container so
     an edited figure or assessed amount can refresh the callouts without
     rebuilding the field being typed in. */
  function renderChecks(t) {
    if (!checksBox) return;
    checksBox.empty();
    for (const m of locale().figureChecks(t.figures || [], +S.taxYear, t) || []) {
      checksBox.append(el('p', { class: `tax-check ${m.ok ? 'tax-check-ok' : 'tax-check-warn'}` },
        icoEl(m.ok ? ['circle-check', 'check-circle'] : ['alert-triangle', 'triangle-alert']), ' ', m.text));
    }
  }

  /* ------------------------------ figures -------------------------------- */
  function renderFigures(t) {
    const loc = locale();
    const figures = t.figures || (t.figures = []);
    $('#taxFiguresSub').textContent =
      'Amounts from your certificates, by source code — what the documents actually say, so the checks above have something to read.';

    const tbl = $('#taxFiguresTable');
    keepScroll(tbl, () => {
      tbl.empty();
      tbl.append(el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, loc.figureCodeLabel), el('th', { scope: 'col' }, 'Description'),
        el('th', { scope: 'col' }, 'Source'), el('th', { scope: 'col', class: 'num' }, 'Amount'),
        el('th', { scope: 'col' }, ''))));

      const body = el('tbody', {});
      // Free text doesn't feed the totals or the checks, so it only marks dirty —
      // same as the Steps/Docs notes fields. Code and amount refresh the totals
      // row and the callouts, but never this table's own body.
      const txt = (obj, key, width) => el('input', { type: 'text', class: 'form-control form-control-sm',
        value: obj[key], style: `min-width:${width}`, 'aria-label': `${key} for figure ${obj.code || ''}`.trim(),
        onchange: e => { obj[key] = e.target.value; mark(); } });
      const refresh = () => { mark(); refreshDerived(t); };
      for (const f of figures) {
        body.append(el('tr', {},
          el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: f.code, style: 'width:90px',
            'aria-label': `${loc.figureCodeLabel} for ${f.description || 'this figure'}`,
            onchange: e => { f.code = e.target.value.trim(); refresh(); } })),
          el('td', {}, txt(f, 'description', '180px')),
          el('td', {}, txt(f, 'source', '140px')),
          el('td', { class: 'num' }, el('input', { type: 'text', inputmode: 'decimal', class: 'form-control form-control-sm num', style: 'width:130px',
            value: f.amount === 0 ? '' : String(f.amount), placeholder: '0.00',
            'aria-label': `Amount for ${f.code || 'this figure'}`,
            onchange: e => {
              const n = Number(e.target.value.replace(/[^\d.-]/g, ''));
              f.amount = Number.isFinite(n) ? n : 0; refresh();
            } })),
          el('td', {}, el('button', { class: 'btn-ghost btn-ghost-sm',
            'aria-label': `Remove figure ${f.code}`,
            onclick: () => {
              figures.splice(figures.indexOf(f), 1);
              mark(); renderFigures(t); refreshDerived(t);
            } }, '✕'))));
      }
      if (!figures.length) {
        body.append(el('tr', {}, el('td', { colspan: '5', class: 'text-muted' },
          'No figures yet — add the amounts off your certificates to unlock the checks.')));
      }
      tbl.append(body);
      renderFigureTotals(t);
    });
  }

  /* Totals grouped by code: one row per code, which is the shape a return asks
     for (three banks' interest is one 4201 line, not three). Replaced on its
     own so a figure edit leaves the input it was typed into standing. */
  function renderFigureTotals(t) {
    const tbl = $('#taxFiguresTable');
    const old = tbl.querySelector('tfoot');
    if (old) old.remove();
    const figures = t.figures || [];
    if (!figures.length) return;
    const byCode = new Map();
    for (const f of figures) {
      const k = (f.code || '').trim() || '—';
      byCode.set(k, (byCode.get(k) || 0) + (f.amount || 0));
    }
    const foot = el('tfoot', {});
    for (const [code, total] of [...byCode].sort((a, b) => a[0].localeCompare(b[0]))) {
      foot.append(el('tr', { class: 'tax-fig-total' },
        el('td', { style: 'font-weight:600' }, code),
        el('td', { colspan: '2', class: 'text-muted' }, `Total for ${code}`),
        el('td', { class: 'num', style: 'font-weight:600' }, money(total)),
        el('td', {})));
    }
    tbl.append(foot);
  }

  const STEP_CYCLE = { todo: 'busy', busy: 'done', done: 'n/a', 'n/a': 'todo' };
  const STEP_LABEL = { todo: 'To do', busy: 'Busy', done: 'Done', 'n/a': 'N/A' };
  const STEP_ICO = { todo: ['circle'], busy: ['hourglass'], done: ['circle-check', 'check-circle'], 'n/a': ['circle-slash', 'slash'] };

  const stepOverdue = s => s.status !== 'done' && s.status !== 'n/a' && daysTo(s.due) !== null && daysTo(s.due) < 0;

  /* focusStep / focusDoc: rebuilding a table drops focus to <body>, and cycling
     a status pill is the main interaction on this page — without this a keyboard
     or screen-reader user is ejected to the top on every single click. */
  function renderSteps(t, focusStep) {
    const tbl = $('#taxStepsTable');
    keepScroll(tbl, () => {
      tbl.empty();
      tbl.append(el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Step'), el('th', { scope: 'col' }, 'Status'),
        el('th', { scope: 'col' }, 'Due'), el('th', { scope: 'col' }, 'Notes'), el('th', { scope: 'col' }, ''))));
      const body = el('tbody', {});
      for (const s of t.steps) {
        const pill = el('button', { class: `status-pill tax-${s.status.replace('/', '')}`,
          'aria-label': `Status: ${STEP_LABEL[s.status]} — click to change` },
          icoEl(STEP_ICO[s.status]), STEP_LABEL[s.status]);
        pill.addEventListener('click', () => { s.status = STEP_CYCLE[s.status]; mark(); renderSteps(t, s.step); renderTaxKpis(t); });
        body.append(el('tr', { class: s.status === 'n/a' ? 'svc-inactive' : '' },
          el('td', { style: 'font-weight:600' }, s.step),
          el('td', {}, pill),
          // A step's due date is read by nothing but its own overdue styling —
          // the Deadline KPI comes off the season card, not from here.
          el('td', {}, dateInput(s.due, { class: `form-control form-control-sm ${stepOverdue(s) ? 'tax-overdue' : ''}`,
            style: 'width:120px', 'aria-label': `Due date for ${s.step}` },
            (v, e) => { s.due = v; mark(); e.target.classList.toggle('tax-overdue', stepOverdue(s)); })),
          el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: s.notes, style: 'min-width:220px',
            'aria-label': `Notes for ${s.step}`,
            onchange: e => { s.notes = e.target.value; mark(); } })),
          el('td', {}, el('button', { class: 'btn-ghost btn-ghost-sm',
            'aria-label': `Remove step ${s.step}`,
            onclick: () => { t.steps.splice(t.steps.indexOf(s), 1); mark(); renderSteps(t); renderTaxKpis(t); } }, '✕'))));
      }
      if (!t.steps.length) body.append(el('tr', {}, el('td', { colspan: '5', class: 'text-muted' }, 'No steps yet.')));
      tbl.append(body);
    });
    if (focusStep) {
      const i = t.steps.findIndex(s => s.step === focusStep);
      const pill = tbl.querySelectorAll('.status-pill')[i];
      if (pill) pill.focus();
    }
  }

  const DOC_CYCLE = { needed: 'n/a', uploaded: 'needed', 'n/a': 'needed' };
  const DOC_LABEL = { needed: 'Needed', uploaded: 'Uploaded', 'n/a': 'N/A' };
  const DOC_ICO = { needed: ['hourglass'], uploaded: ['circle-check', 'check-circle'], 'n/a': ['circle-slash', 'slash'] };

  function renderDocs(t, focusDoc) {
    $('#taxDocsSub').empty();
    $('#taxDocsSub').append('Certificates & records for the return · files stored in ', el('code', {}, `Tax/${S.taxYear}/`));
    const tbl = $('#taxDocsTable');
    keepScroll(tbl, () => {
      tbl.empty();
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
        pill.addEventListener('click', () => { d.status = DOC_CYCLE[d.status]; mark(); renderDocs(t, d.name); renderTaxKpis(t); });

        // A row can carry several certificates — providers routinely issue an
        // IT3(b), IT3(c) and IT3(s) against what the seed treats as one row.
        const fileCell = el('div', { class: 'tax-doc-files' });
        for (const name of fileList(d)) {
          const link = el('button', { class: 'btn-ghost tax-doc-link', 'aria-label': `Open ${name}` },
            icoEl(['paperclip']), name);
          link.addEventListener('click', () => openDoc(name));
          fileCell.append(link);
        }
        const addBtn = el('button', { class: 'btn-ghost btn-ghost-sm',
          'aria-label': `${d.file ? 'Add another file to' : 'Upload file for'} ${d.name}` },
          icoEl(['cloud-upload', 'upload-cloud']), d.file ? ' Add' : ' Upload');
        addBtn.addEventListener('click', () => { pendingDocTarget = d; $('#taxFileInput').click(); });
        fileCell.append(addBtn);
        body.append(el('tr', { class: d.status === 'n/a' ? 'svc-inactive' : '' },
          el('td', { style: 'font-weight:600' }, d.name),
          el('td', { class: 'text-muted' }, d.source),
          el('td', {}, pill),
          el('td', {}, fileCell),
          el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: d.notes, style: 'min-width:180px',
            'aria-label': `Notes for ${d.name}`,
            onchange: e => { d.notes = e.target.value; mark(); } })),
          el('td', {}, el('button', { class: 'btn-ghost btn-ghost-sm',
            'aria-label': `Remove document ${d.name}`,
            onclick: async () => {
              const kept = fileList(d);
              const go = !kept.length || await confirmModal(app, {
                title: 'Remove document row',
                message: `Remove "${d.name}" from the list? ${kept.length === 1 ? `The uploaded file ${kept[0]} stays` : `The ${kept.length} uploaded files stay`} in Tax/${S.taxYear}/ — delete them from the vault yourself if you want them gone.`,
                confirmText: 'Remove row',
              });
              if (!go) return;
              t.docs.splice(t.docs.indexOf(d), 1); mark(); renderDocs(t); renderTaxKpis(t);
            } }, '✕'))));
      }
      if (!t.docs.length) body.append(el('tr', {}, el('td', { colspan: '6', class: 'text-muted' }, 'No documents yet.')));
      tbl.append(body);
    });
    if (focusDoc) {
      const i = t.docs.findIndex(d => d.name === focusDoc);
      const pill = tbl.querySelectorAll('.status-pill')[i];
      if (pill) pill.focus();
    }
  }

  /* The File cell holds a ';'-separated list. A bare filename parses as a
     one-element list, so pages written before this stay readable. safeSeg
     doesn't touch ';', so taxSeg strips it too — otherwise a filename
     containing one would split into two phantom entries on the next load. */
  const FILE_SEP = ';';
  const taxSeg = s => safeSeg(s).replace(/;/g, '-');
  const fileList = d => (d.file || '').split(FILE_SEP).map(s => s.trim()).filter(Boolean);
  const setFileList = (d, names) => { d.file = names.join(`${FILE_SEP} `); };

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
    let created = false;   // did THIS call push a new row? (rolled back on write failure)

    const buf = await file.arrayBuffer();

    // A re-sent certificate is byte-identical to the one already filed —
    // uniquifying the name would keep both. Match on content instead.
    const dupe = await findDuplicate(buf);
    if (dupe) {
      const reuse = await confirmModal(app, {
        title: 'Already in this tax year',
        message: `"${file.name}" is byte-identical to ${dupe}, already stored in Tax/${S.taxYear}/. Point the row at the existing file instead of saving a second copy?`,
        confirmText: 'Use the existing file',
      });
      if (reuse) return attachExisting(t, dupe);
    }

    if (!target) {
      const NEW = '＋ New document row';
      // Options carry the row INDEX as their value. Two rows can share a label
      // — the ZA seed ships two "IT3(b) interest certificate" rows — and both
      // indexOf and the dropdown itself collapse duplicates, so a label lookup
      // silently attaches the second bank's certificate to the first row.
      const openRows = t.docs.filter(d => !d.file);
      const options = openRows.map((d, i) => ({ value: String(i), label: `${d.name} — ${d.source}` }));
      const r = await askFields(app, `Attach "${file.name}"`, [
        { key: 'to', label: 'Attach to', type: 'select',
          options: [...options, { value: NEW, label: NEW }], value: options.length ? '0' : NEW },
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
        created = true;
      } else {
        target = openRows[Number(r.to)];
        if (!target) return;
      }
    }

    let name = taxSeg(file.name) || 'document';
    // Uniquify so a re-upload never silently overwrites an earlier certificate.
    if (fileAt(`Tax/${S.taxYear}/${name}`)) {
      const dot = name.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let i = 2;
      while (fileAt(`Tax/${S.taxYear}/${stem} (${i})${ext}`)) i++;
      name = `${stem} (${i})${ext}`;
    }
    try {
      await writeBinary(`Tax/${S.taxYear}/${name}`, buf);
    } catch (e) {
      // A row created a moment ago for this upload has nothing behind it now —
      // leaving it would show an empty "Needed" row that no save was told about.
      if (created) t.docs.splice(t.docs.indexOf(target), 1);
      return toast(e.message || String(e), true);
    }
    setFileList(target, [...fileList(target), name]);
    target.status = 'uploaded';

    // Most tax certificates ship password-protected, and Obsidian's PDF viewer
    // can't open those — say so on the row rather than letting the link fail
    // silently later. Detection only; decrypting is not the plugin's job.
    if (isEncryptedPdf(buf)) {
      const hint = 'Password-protected — open outside Obsidian.';
      if (!target.notes.includes(hint)) target.notes = target.notes ? `${target.notes} ${hint}` : hint;
      toast(`Uploaded ${name} — password-protected, so it won't preview in Obsidian.`);
    } else {
      toast(`Uploaded ${name}`);
    }
    // Show the new attachment (and the "Documents in" tile) before the write —
    // the row was only in memory until now, so nothing on screen reflected it.
    renderDocs(t); renderTaxKpis(t);
    // The binary is already on disk — save the markdown too so the two never
    // drift apart (an unsaved row pointing at a saved file, or vice versa).
    await saveTax();
  }

  /* SHA-256 over the upload, compared against everything already filed for the
     year. Re-hashing a handful of small PDFs per upload is cheaper than the
     schema change a stored-hash column would need. */
  async function findDuplicate(buf) {
    const digest = async b => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)))
      .map(x => x.toString(16).padStart(2, '0')).join('');
    let mine;
    try { mine = await digest(buf); } catch { return null; }   // no subtle crypto → skip the check
    const seen = new Set();
    for (const d of T().docs) for (const n of fileList(d)) seen.add(n);
    for (const n of seen) {
      const f = fileAt(`Tax/${S.taxYear}/${n}`);
      if (!f) continue;
      try {
        if (await digest(await app.vault.readBinary(f)) === mine) return n;
      } catch { /* unreadable — treat as not-a-match */ }
    }
    return null;
  }

  async function attachExisting(t, name) {
    const NEW = '＋ New document row';
    const options = t.docs.map((d, i) => ({ value: String(i), label: `${d.name} — ${d.source}` }));
    const r = await askFields(app, `Point a row at "${name}"`, [
      { key: 'to', label: 'Attach to', type: 'select',
        options: [...options, { value: NEW, label: NEW }], value: options.length ? '0' : NEW },
    ]);
    if (!r) return;
    let target;
    if (r.to === NEW) {
      const n = await askFields(app, 'New document', [
        { key: 'name', label: 'Document name', type: 'text', value: name.replace(/\.[^.]+$/, '') },
        { key: 'source', label: 'Source', type: 'text' },
      ]);
      if (!n || !n.name.trim()) return;
      target = { name: n.name.trim(), source: (n.source || '').trim(), status: 'needed', file: '', notes: '' };
      t.docs.push(target);
    } else {
      target = t.docs[Number(r.to)];
      if (!target) return;
    }
    if (!fileList(target).includes(name)) setFileList(target, [...fileList(target), name]);
    target.status = 'uploaded';
    await saveTax();
    renderTax();
    toast(`Linked ${name} — no second copy written.`);
  }

  /* A PDF trailer carrying /Encrypt is password-protected. Scan the tail, where
     the trailer lives, rather than the whole buffer. */
  function isEncryptedPdf(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50) return false;   // not "%P…"
    const tail = bytes.subarray(Math.max(0, bytes.length - 4096));
    const s = Array.from(tail).map(b => String.fromCharCode(b)).join('');
    return s.includes('/Encrypt');
  }

  /* ------------------------------ persist -------------------------------- */
  function serializeTax(year) {
    const t = S.tax[year];
    const fm = patchFrontmatter(t.fmRaw || '', {
      kind: 'tax', tax_year: year,
      taxpayer_type: t.taxpayer_type, assessment: t.assessment,
      // Quoted: these are free-text fields. An unquoted "ITA34: 2026/0031"
      // makes the whole block unparseable to Obsidian while this plugin's own
      // first-colon parser still reads it, so the damage stays invisible here.
      deadline_standard: t.deadline_standard ? yamlStr(t.deadline_standard) : null,
      deadline_provisional: t.deadline_provisional ? yamlStr(t.deadline_provisional) : null,
      assessment_date: t.assessment_date ? yamlStr(t.assessment_date) : null,
      assessment_ref: t.assessment_ref ? yamlStr(t.assessment_ref) : null,
      assessment_result: typeof t.assessment_result === 'number' ? t.assessment_result : null,
      assessment_income: typeof t.assessment_income === 'number' ? t.assessment_income : null,
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
    // Emit the header even when empty so the section is discoverable in the
    // raw file rather than appearing only once a figure is added.
    lines.push('', '## Figures', '',
      `| ${loc.figureCodeLabel} | Description | Source | Amount |`,
      '|------|-------------|--------|--------|');
    for (const f of (t.figures || [])) {
      lines.push(`| ${escMd(f.code)} | ${escMd(f.description)} | ${escMd(f.source)} | ${Number(f.amount || 0).toFixed(2)} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  async function saveTax() {
    if (!S.taxYear) return;
    await writeFile(`Tax/${S.taxYear}.md`, serializeTax(S.taxYear));
    clearDirty();
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

  async function addTaxFigure() {
    if (!S.taxYear) return;
    const r = await askFields(app, 'New figure', [
      { key: 'code', label: locale().figureCodeLabel, type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'source', label: 'Source (which certificate)', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'text', placeholder: '0.00' },
    ]);
    if (!r || !r.code.trim()) return;
    const n = Number((r.amount || '').replace(/[^\d.-]/g, ''));
    T().figures.push({
      code: r.code.trim(), description: (r.description || '').trim(),
      source: (r.source || '').trim(), amount: Number.isFinite(n) ? n : 0,
    });
    mark(); renderTax();
  }

  function seedTaxYear(year) {
    const loc = locale();
    S.tax[String(year)] = {
      fmRaw: '',
      taxpayer_type: loc.defaultTaxpayerType, assessment: loc.defaultAssessment,
      assessment_date: '', assessment_ref: '', assessment_result: null, assessment_income: null,
      ...loc.seedDeadlines(year),
      steps: loc.seedSteps(year).map(s => ({ status: 'todo', due: '', notes: '', ...s })),
      docs: loc.seedDocs().map(d => ({ status: 'needed', file: '', notes: '', ...d })),
      figures: [],
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
    if (S.tax[String(year)]) return changeTaxYear(String(year));
    if (!await confirmDiscard()) return;
    seedTaxYear(year);
    S.taxYear = String(year);
    await saveTax();
    renderTax();
  }

  /* Every path that changes S.taxYear goes through this first. Discarding
     re-reads the whole vault, so it uses the shared reloadFromDisk rather than
     loadVault directly — otherwise a stale budget draft survives the reset and
     unsaved Owed/Services edits vanish behind still-enabled Save buttons. */
  async function confirmDiscard() {
    if (!S.taxDirty) return true;
    const go = await confirmModal(app, {
      title: 'Unsaved tax changes',
      message: 'Switching tax year will discard your unsaved edits. Continue?',
      confirmText: 'Discard & switch',
    });
    if (!go) return false;
    await ctx.reloadFromDisk();
    return true;
  }

  async function changeTaxYear(year) {
    if (!await confirmDiscard()) { renderTax(); return; }   // re-render snaps the select back
    // The reload may have dropped the year entirely (a page deleted on another
    // device), so fall back to whatever loadVault settled on.
    S.taxYear = S.tax[year] ? year : S.taxYear;
    renderTax();
  }

  ctx.provide({ renderTax, saveTax, addTaxStep, addTaxDoc, addTaxFigure, newTaxYear, startTax, changeTaxYear, handleTaxFile, serializeTax });
};
