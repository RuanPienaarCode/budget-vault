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
  const { S, $, app, toast, writeFile, writeBinary, fileAt, locale, money } = ctx;

  /* The tax year we'd be dealing with today, per the country profile. */
  function currentTaxYear() {
    return locale().currentTaxYear(new Date());
  }
  const T = () => S.tax[S.taxYear];
  const mark = () => { S.taxDirty = true; $('#taxSave').disabled = false; };

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
    $('#taxSubNote').innerHTML = '';
    $('#taxSubNote').append(`Tax year ${S.taxYear} (${loc.yearSpan(+S.taxYear)}) · saved to `,
      el('code', {}, `Tax/${S.taxYear}.md`));

    const sel = $('#taxYearSel'); sel.innerHTML = '';
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
    tile('Figures', String((t.figures || []).length));
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

    // Outcome fields only once there is an outcome — they are noise before it.
    if (t.assessment === 'assessed') {
      const num = (label, key, placeholder) => field(label, el('input', { type: 'text',
        class: 'form-control form-control-sm', value: t[key] === null || t[key] === undefined ? '' : String(t[key]),
        placeholder, onchange: e => {
          const raw = e.target.value.trim();
          const n = Number(raw.replace(/[^\d.-]/g, ''));
          t[key] = raw === '' ? null : (Number.isFinite(n) ? n : null);
          mark(); renderTax();
        } }));
      b.append(el('div', { class: 'row tax-season-row' },
        field('Assessment date', el('input', { type: 'text', class: 'form-control form-control-sm', value: t.assessment_date,
          placeholder: 'YYYY-MM-DD', onchange: e => { t.assessment_date = e.target.value.trim(); mark(); renderTax(); } })),
        field('Reference', el('input', { type: 'text', class: 'form-control form-control-sm', value: t.assessment_ref,
          placeholder: 'Notice / document no.', onchange: e => { t.assessment_ref = e.target.value.trim(); mark(); } })),
        num('Result (− = refund)', 'assessment_result', '-1250.00'),
        num('Taxable income assessed', 'assessment_income', '0.00')));
    }

    b.append(el('p', { class: 'tax-season-msg' }, loc.seasonMsgs(t).join(' ')));

    // Locale-aware checks over the captured figures. The profile decides what
    // is worth saying; the view only picks the callout colour.
    for (const m of loc.figureChecks(t.figures || [], +S.taxYear, t) || []) {
      b.append(el('p', { class: `tax-check ${m.ok ? 'tax-check-ok' : 'tax-check-warn'}` },
        icoEl(m.ok ? ['circle-check', 'check-circle'] : ['alert-triangle', 'triangle-alert']), ' ', m.text));
    }

    b.append(el('p', { class: 'text-muted', style: 'font-size:12.5px;margin:0 0 6px' }, loc.safetyNote));
    b.append(el('p', { class: 'text-muted', style: 'font-size:12.5px;margin:0' }, disclaimer()));
  }

  /* ------------------------------ figures -------------------------------- */
  function renderFigures(t) {
    const loc = locale();
    const figures = t.figures || (t.figures = []);
    $('#taxFiguresSub').textContent =
      'Amounts from your certificates, by source code — what the documents actually say, so the checks above have something to read.';

    const tbl = $('#taxFiguresTable'); tbl.innerHTML = '';
    tbl.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, loc.figureCodeLabel), el('th', { scope: 'col' }, 'Description'),
      el('th', { scope: 'col' }, 'Source'), el('th', { scope: 'col', class: 'num' }, 'Amount'),
      el('th', { scope: 'col' }, ''))));

    const body = el('tbody', {});
    // Free text doesn't feed the totals or the checks, so it only marks dirty —
    // same as the Steps/Docs notes fields. Code and amount do re-render.
    const txt = (obj, key, width) => el('input', { type: 'text', class: 'form-control form-control-sm',
      value: obj[key], style: `min-width:${width}`, onchange: e => { obj[key] = e.target.value; mark(); } });
    for (const f of figures) {
      body.append(el('tr', {},
        el('td', {}, el('input', { type: 'text', class: 'form-control form-control-sm', value: f.code, style: 'width:90px',
          onchange: e => { f.code = e.target.value.trim(); mark(); renderTax(); } })),
        el('td', {}, txt(f, 'description', '180px')),
        el('td', {}, txt(f, 'source', '140px')),
        el('td', { class: 'num' }, el('input', { type: 'text', class: 'form-control form-control-sm num', style: 'width:130px',
          value: f.amount === 0 ? '' : String(f.amount), placeholder: '0.00',
          onchange: e => {
            const n = Number(e.target.value.replace(/[^\d.-]/g, ''));
            f.amount = Number.isFinite(n) ? n : 0; mark(); renderTax();
          } })),
        el('td', {}, el('button', { class: 'btn-ghost', style: 'padding:0.2rem 0.6rem;font-size:0.78rem',
          'aria-label': `Remove figure ${f.code}`,
          onclick: () => { figures.splice(figures.indexOf(f), 1); mark(); renderTax(); } }, '✕'))));
    }
    if (!figures.length) {
      body.append(el('tr', {}, el('td', { colspan: '5', class: 'text-muted' },
        'No figures yet — add the amounts off your certificates to unlock the checks.')));
    }
    tbl.append(body);

    // Totals grouped by code: one row per code, which is the shape a return
    // asks for (three banks' interest is one 4201 line, not three).
    if (figures.length) {
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

      // A row can carry several certificates — providers routinely issue an
      // IT3(b), IT3(c) and IT3(s) against what the seed treats as one row.
      const fileCell = el('div', { class: 'tax-doc-files' });
      for (const name of fileList(d)) {
        const link = el('button', { class: 'btn-ghost tax-doc-link', 'aria-label': `Open ${name}` },
          icoEl(['paperclip']), name);
        link.addEventListener('click', () => openDoc(name));
        fileCell.append(link);
      }
      const addBtn = el('button', { class: 'btn-ghost', style: 'padding:0.2rem 0.6rem;font-size:0.78rem',
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
          onchange: e => { d.notes = e.target.value; mark(); } })),
        el('td', {}, el('button', { class: 'btn-ghost', style: 'padding:0.2rem 0.6rem;font-size:0.78rem',
          'aria-label': `Remove document ${d.name}`,
          onclick: async () => {
            const kept = fileList(d);
            const go = !kept.length || await confirmModal(app, {
              title: 'Remove document row',
              message: `Remove "${d.name}" from the list? ${kept.length === 1 ? `The uploaded file ${kept[0]} stays` : `The ${kept.length} uploaded files stay`} in Tax/${S.taxYear}/ — delete them from the vault yourself if you want them gone.`,
              confirmText: 'Remove row',
            });
            if (!go) return;
            t.docs.splice(t.docs.indexOf(d), 1); mark(); renderTax();
          } }, '✕'))));
    }
    if (!t.docs.length) body.append(el('tr', {}, el('td', { colspan: '6', class: 'text-muted' }, 'No documents yet.')));
    tbl.append(body);
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
    const rows = t.docs.map(d => `${d.name} — ${d.source}`);
    const r = await askFields(app, `Point a row at "${name}"`, [
      { key: 'to', label: 'Attach to', type: 'select', options: [...rows, NEW], value: rows[0] ?? NEW },
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
      target = t.docs[rows.indexOf(r.to)];
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
      deadline_standard: t.deadline_standard || null, deadline_provisional: t.deadline_provisional || null,
      assessment_date: t.assessment_date || null, assessment_ref: t.assessment_ref || null,
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

  Object.assign(ctx, { renderTax, saveTax, addTaxStep, addTaxDoc, addTaxFigure, newTaxYear, startTax, changeTaxYear, handleTaxFile });
};
