'use strict';
/* The budget-export dialog, and the small "here are your files" one after it.

   A dialog rather than a page of its own (the Report page's shape) because the
   question is asked FROM the Budget page, about the budget on it, and answered
   once: what span, which categories, what kind of file. A page would be a
   place to come back to; nobody comes back to an export.

   Its own file rather than another class in modal.js: that module's modals are
   each a question with one answer (a split, a yes/no), built once in onOpen.
   This one re-renders as it is answered — picking "Choose categories" grows a
   checklist, every change moves the preview line — and carries enough furniture
   that it would double modal.js to say so.

   THE PREVIEW LINE IS THE CONTRACT. `describe(state)` is the view's, and it
   runs the REAL period walk and the REAL path builder over the state on
   screen, so the dialog names the files it is about to write and the periods
   they cover before anything is written — and the Export button is dead
   whenever describe() reports a problem (no finished period yet, nothing
   ticked, a folder the loader would read back as vault data). Refused before
   the click, in words, rather than explained afterwards by a toast.

   Built from Obsidian's own Setting rows and toggles for the reason modal.js
   gives: they are the controls the reader already knows, and they behave on
   iOS, where a hand-rolled checkbox needs its own hit-target work. The pill
   groups are buttons with aria-pressed, the same shape views/report.js uses,
   under their OWN class names — a modal is mounted on document.body, outside
   .budget-app-root, so none of the app's scoped pill styles reach it. */

const { Modal, Setting } = require('obsidian');
const { el } = require('./dom');
const { RANGE_KEYS } = require('./budget-export');
const i18n = require('./i18n');

const FORMATS = ['pdf', 'xlsx', 'csv'];

class BudgetExportModal extends Modal {
  constructor(app, opts, resolve) {
    super(app);
    this.opts = opts;
    this.resolve = resolve;
    this.submitted = false;
    const s = opts.state || {};
    this.state = {
      range: RANGE_KEYS.includes(String(s.range)) ? String(s.range) : '3',
      includeCurrent: s.includeCurrent !== false,
      content: s.content === 'summary' ? 'summary' : 'full',
      catMode: 'all',
      /* Every category starts ticked, so switching to "Choose" is a matter of
         UNTICKING the few not wanted — the common case is "everything except
         the transfers", not "these three out of forty". */
      picked: new Set((opts.categories || []).map(c => c.name)),
      includeTx: !!s.includeTx,
      formats: new Set((Array.isArray(s.formats) ? s.formats : ['pdf']).filter(f => FORMATS.includes(f))),
      folder: String(s.folder || opts.defaultFolder || 'Exports'),
    };
    if (!this.state.formats.size) this.state.formats.add('pdf');
  }

  onOpen() {
    this.titleEl.setText(i18n.t('bx.title'));
    this.modalEl.classList.add('budget-export-modal');
    this.draw();
  }

  /* The answer handed back: plain data, the Sets flattened, and `categories`
     already in buildModel()'s vocabulary — null for "no filter", an array for
     "exactly these". */
  answer() {
    const s = this.state;
    return {
      range: s.range, includeCurrent: s.includeCurrent, content: s.content,
      /* Every box ticked IS "all categories": handing back the full list would
         stamp "(selected categories)" on the file name and a filter caveat on
         the document for an export that left nothing out. */
      categories: s.catMode === 'all' || s.picked.size === (this.opts.categories || []).length ? null : [...s.picked],
      includeTx: s.includeTx, formats: FORMATS.filter(f => s.formats.has(f)), folder: s.folder.trim(),
    };
  }

  pills(label, options, isOn, onPick) {
    const row = el('div', { class: 'budget-export-pills', role: 'group', 'aria-label': label });
    for (const o of options) {
      const on = isOn(o.key);
      row.append(el('button', {
        type: 'button', class: `budget-export-pill${on ? ' is-active' : ''}`,
        'aria-pressed': on ? 'true' : 'false',
        onclick: () => { onPick(o.key); this.draw(); },
      }, o.label));
    }
    return row;
  }

  field(label, desc, control) {
    const wrap = el('div', { class: 'budget-export-field' }, el('div', { class: 'budget-export-label' }, label));
    wrap.append(control);
    if (desc) wrap.append(el('div', { class: 'budget-export-desc' }, desc));
    return wrap;
  }

  /* Rebuilt whole on every change — except the folder input, which is created
     once and re-attached. A text field torn down under the caret loses focus
     on every keystroke; views/transactions.js's #txSearch is static in the
     shell for the same reason. */
  draw() {
    const c = this.contentEl;
    const s = this.state;
    const scroll = c.scrollTop;
    c.empty();

    c.append(this.field(i18n.t('bx.range'), null, this.pills(i18n.t('bx.range'),
      RANGE_KEYS.map(k => ({ key: k, label: i18n.t(`bx.range.${k}`) })),
      k => s.range === k, k => { s.range = k; })));
    new Setting(c).setName(i18n.t('bx.includeCurrent')).setDesc(i18n.t('bx.includeCurrent.desc'))
      .addToggle(tg => tg.setValue(s.includeCurrent).onChange(v => { s.includeCurrent = v; this.draw(); }));

    c.append(this.field(i18n.t('bx.content'), i18n.t(`bx.content.${s.content}.desc`), this.pills(i18n.t('bx.content'),
      [{ key: 'full', label: i18n.t('bx.content.full') }, { key: 'summary', label: i18n.t('bx.content.summary') }],
      k => s.content === k, k => { s.content = k; })));

    c.append(this.field(i18n.t('bx.cats'), null, this.pills(i18n.t('bx.cats'),
      [{ key: 'all', label: i18n.t('bx.cats.all') }, { key: 'pick', label: i18n.t('bx.cats.pick') }],
      k => s.catMode === k, k => { s.catMode = k; })));
    if (s.catMode === 'pick') c.append(this.checklist());

    new Setting(c).setName(i18n.t('bx.includeTx')).setDesc(i18n.t('bx.includeTx.desc'))
      .addToggle(tg => tg.setValue(s.includeTx).onChange(v => { s.includeTx = v; this.draw(); }));

    /* A multi-select: PDF for reading, a workbook for working, CSV for another
       program — wanting two at once is ordinary, and at least one must stay
       on, so the last lit pill does not switch off. */
    c.append(this.field(i18n.t('bx.format'),
      FORMATS.filter(f => s.formats.has(f)).map(f => i18n.t(`bx.format.${f}.desc`)).join(' '),
      this.pills(i18n.t('bx.format'), FORMATS.map(f => ({ key: f, label: i18n.t(`bx.format.${f}`) })),
        k => s.formats.has(k),
        k => { if (s.formats.has(k)) { if (s.formats.size > 1) s.formats.delete(k); } else s.formats.add(k); })));

    if (!this.folderInput) {
      this.folderInput = el('input', { type: 'text', class: 'budget-export-folder', placeholder: 'Exports', 'aria-label': i18n.t('bx.folder') });
      this.folderInput.value = s.folder;
      this.folderInput.addEventListener('input', () => { s.folder = this.folderInput.value; this.drawPreview(); });
    }
    c.append(this.field(i18n.t('bx.folder'), i18n.t('bx.folder.desc'), this.folderInput));

    this.previewEl = el('div', { class: 'budget-export-preview', 'aria-live': 'polite' });
    c.append(this.previewEl);
    const buttons = new Setting(c)
      .addButton(b => b.setButtonText(i18n.t('bx.cancel')).onClick(() => this.close()))
      .addButton(b => { this.goBtn = b; b.setButtonText(i18n.t('bx.go')).setCta().onClick(() => this.submit()); });
    buttons.settingEl.classList.add('budget-export-actions');
    this.drawPreview();
    c.scrollTop = scroll;
  }

  checklist() {
    const s = this.state;
    const cats = this.opts.categories || [];
    const box = el('div', { class: 'budget-export-cats' });
    const setAll = on => { s.picked = new Set(on ? cats.map(x => x.name) : []); this.draw(); };
    box.append(el('div', { class: 'budget-export-cats-bulk' },
      el('button', { type: 'button', class: 'budget-export-link', onclick: () => setAll(true) }, i18n.t('bx.cats.selectAll')),
      el('button', { type: 'button', class: 'budget-export-link', onclick: () => setAll(false) }, i18n.t('bx.cats.selectNone')),
      el('span', { class: 'budget-export-count' }, i18n.t('bx.cats.count', { count: s.picked.size, total: cats.length }))));
    let lastType = null;
    const list = el('div', { class: 'budget-export-cats-list' });
    for (const cat of cats) {
      if (cat.type !== lastType) {
        lastType = cat.type;
        list.append(el('div', { class: 'budget-export-cats-type' }, cat.type || ''));
      }
      const id = `bx-cat-${list.childElementCount}`;
      const box1 = el('input', { type: 'checkbox', id });
      box1.checked = s.picked.has(cat.name);
      /* No redraw on a tick: rebuilding the list under the reader's finger
         would reset its scroll position forty times in a row. Only the count
         and the preview move. */
      box1.addEventListener('change', () => {
        if (box1.checked) s.picked.add(cat.name); else s.picked.delete(cat.name);
        const count = box.querySelector('.budget-export-count');
        if (count) count.textContent = i18n.t('bx.cats.count', { count: s.picked.size, total: cats.length });
        this.drawPreview();
      });
      list.append(el('label', { class: 'budget-export-cat', for: id }, box1, el('span', {}, cat.name)));
    }
    box.append(list);
    return box;
  }

  drawPreview() {
    if (!this.previewEl) return;
    const d = this.opts.describe(this.answer());
    this.previewEl.empty();
    if (d.problem) {
      this.previewEl.append(el('div', { class: 'budget-export-problem' }, d.problem));
    } else {
      this.previewEl.append(
        el('div', { class: 'budget-export-what' }, d.what),
        el('div', { class: 'budget-export-files' }, d.files.join('\n')));
      /* Named, not counted: "replaces 1 file" leaves the reader to work out
         which, and the one they would mind is the one they need to see. */
      if (d.replaces && d.replaces.length) {
        this.previewEl.append(el('div', { class: 'budget-export-replaces' },
          i18n.t('bx.replaces', { count: d.replaces.length, files: d.replaces.map(p => p.split('/').pop()).join(', ') })));
      }
    }
    if (this.goBtn) this.goBtn.setDisabled(!!d.problem);
    this.blocked = !!d.problem;
  }

  submit() {
    if (this.blocked) return;
    this.submitted = true;
    this.close();
  }

  onClose() {
    const out = this.submitted ? this.answer() : null;
    this.contentEl.empty();
    this.resolve(out);
  }
}

function askBudgetExport(app, opts) {
  return new Promise(res => new BudgetExportModal(app, opts, res).open());
}

/* What was written, and the two honest ways onward. A plugin cannot raise the
   OS share sheet or a save dialog (views/report.js's header covers why), so:
   Open hands the file to Obsidian — which shows a PDF itself and passes a
   workbook to whatever the device opens workbooks with — and Reveal finds it
   in the file explorer, from where the share sheet and the desktop file
   manager both take over. */
class BudgetExportDoneModal extends Modal {
  constructor(app, opts) { super(app); this.opts = opts; }
  onOpen() {
    const { files, note, onOpen, onReveal } = this.opts;
    this.titleEl.setText(i18n.t('bx.done.title'));
    this.modalEl.classList.add('budget-export-modal');
    const c = this.contentEl;
    if (note) c.append(el('p', { class: 'budget-export-desc' }, note));
    const list = el('div', { class: 'budget-export-done' });
    for (const path of files) {
      list.append(el('div', { class: 'budget-export-done-row' },
        el('span', { class: 'budget-export-done-path' }, path),
        el('button', { type: 'button', class: 'budget-export-link', onclick: () => { onOpen(path); this.close(); } }, i18n.t('bx.done.open'))));
    }
    c.append(list);
    c.append(el('p', { class: 'budget-export-desc' }, i18n.t('bx.done.hint')));
    new Setting(c)
      .addButton(b => b.setButtonText(i18n.t('bx.done.reveal')).onClick(() => { onReveal(files[0]); this.close(); }))
      .addButton(b => b.setButtonText(i18n.t('bx.done.close')).setCta().onClick(() => this.close()));
  }
  onClose() { this.contentEl.empty(); }
}

function showBudgetExportDone(app, opts) { new BudgetExportDoneModal(app, opts).open(); }

module.exports = { askBudgetExport, showBudgetExportDone };
