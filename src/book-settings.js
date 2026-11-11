'use strict';
/* Settings → Books: the two small dialogs behind its buttons (ADR 0009 §5,
   issue #168).

   WHY THESE LIVE OUTSIDE settings-tab.js. That file describes every setting
   twice — display() for Obsidian below 1.13, getSettingDefinitions() for 1.13
   and later — and tests/settings-parity.test.cjs holds the two halves to the
   same set of names by scanning it for `.setName(…)`. A dialog's fields are
   not settings; written into that file they would read to the scan as
   settings present on one side only. Here they are what they are: two
   modals the tab opens, the same on both versions.

   Neither dialog decides anything. Whether a folder may become a book is
   src/books.js validateNewBook (through plugin.bookProblem), and every change
   to the list goes through main.js addBook / relabelBook / removeBook, which
   apply src/books.js's rules once. The dialogs gather two strings and say
   back, in the reader's language, what the rule answered.

   Obsidian Modal + Setting only — no innerHTML, no regex lookbehind — so it
   runs on the iOS 15 floor like the rest of the app. */

const { Modal, Setting, Notice } = require('obsidian');
const i18n = require('./i18n');
const { OnboardingWizard } = require('./onboarding');

/* The sentence for a refusal from validateNewBook / addBook. `folder` is the
   book it collides with (or the hidden segment); a book at the vault root has
   no name to print, so it is shown as "/" — the way the vault root is written
   everywhere else in this app's messages. */
function bookProblemText(problem) {
  return i18n.t(`books.problem.${problem.reason}`, { folder: problem.folder || '/' });
}

/* Folder suggestions under a text field, the way the 1.13 settings tab's own
   `type: 'folder'` control offers them — so typing a book's folder here feels
   like typing the home book's folder one section up.

   Feature-detected twice over. AbstractInputSuggest and vault.getAllFolders
   are both newer than some hosts this build still loads on, and the bare-node
   guard tests load this file under an obsidian stub that has neither; in any
   of those cases the field is simply a text field, which is all the
   pre-1.13 folder setting has ever been. The suggestion only fills the box:
   whatever is in it when the reader presses Continue is what gets validated,
   chosen or typed. */
function attachFolderSuggest(app, inputEl) {
  let Base;
  try { Base = require('obsidian').AbstractInputSuggest; } catch (e) { Base = null; }
  const vault = app && app.vault;
  if (typeof Base !== 'function' || !vault || typeof vault.getAllFolders !== 'function' || !inputEl) return null;
  class FolderSuggest extends Base {
    getSuggestions(query) {
      const want = String(query || '').toLowerCase();
      return vault.getAllFolders(false)
        .map(f => f.path)
        .filter(p => p.toLowerCase().includes(want))
        .sort()
        .slice(0, 50);
    }
    renderSuggestion(path, el) { el.setText(path); }
    selectSuggestion(path) {
      this.setValue(path);
      this.close();
    }
  }
  try { return new FolderSuggest(app, inputEl); } catch (e) { return null; }
}

/* Add a book: a folder and a label, checked, then the setup wizard.

   The check runs HERE, before the wizard opens, so a folder that would share
   files with another book is refused while the reader is still looking at the
   field they typed it in — not three screens of questions later. The wizard
   checks again before it writes anything (the list syncs), and addBook()
   once more as it appends; three asks of one pure rule, never three rules.

   `onAdded` is called by the wizard once the book is in the list, so the
   settings tab behind it can redraw its rows. */
class AddBookModal extends Modal {
  constructor(app, plugin, onAdded) {
    super(app);
    this.plugin = plugin;
    this.onAdded = onAdded;
    this.errEl = null;
  }
  onOpen() {
    // Body-mounted, so outside the plugin root and its `lang` (i18n.js followLanguage).
    i18n.followLanguage(this.modalEl);
    const c = this.contentEl;
    c.empty();
    this.titleEl.setText(i18n.t('books.add.title'));
    c.createEl('p', { text: i18n.t('books.add.lead') });
    let folderEl = null;
    let label = '';
    new Setting(c)
      .setName(i18n.t('books.add.folder'))
      .setDesc(i18n.t('books.add.folderDesc'))
      .addText(t => {
        t.setPlaceholder(i18n.t('books.add.folderPlaceholder'));
        folderEl = t.inputEl;
        attachFolderSuggest(this.app, t.inputEl);
      });
    new Setting(c)
      .setName(i18n.t('books.add.label'))
      .setDesc(i18n.t('books.add.labelDesc'))
      .addText(t => t
        .setPlaceholder(i18n.t('books.add.labelPlaceholder'))
        .onChange(v => { label = v; }));
    const nav = new Setting(c);
    nav.addButton(b => b.setButtonText(i18n.t('wiz.cancel')).onClick(() => this.close()));
    nav.addButton(b => b
      .setButtonText(i18n.t('books.add.continue'))
      .setCta()
      .onClick(() => this.submit(folderEl ? folderEl.value : '', label)));
  }
  /* Returns the problem it refused with, or null when it handed over to the
     wizard — so a guard test can drive it without a click. */
  submit(folder, label) {
    const problem = this.plugin.bookProblem(folder);
    if (problem) {
      /* Inline, under the fields, like the wizard's own errors: a corner
         Notice can land behind the modal and never says which field it
         means. Created on the first refusal rather than up front, so an
         empty red box is never on screen. */
      if (!this.errEl) this.errEl = this.contentEl.createDiv({ cls: 'budget-onb-error' });
      this.errEl.setText(bookProblemText(problem));
      return problem;
    }
    this.close();
    new OnboardingWizard(this.app, this.plugin, {
      book: { folder: String(folder).trim(), label: String(label || '').trim() },
      onAdded: this.onAdded,
    }).open();
    return null;
  }
  onClose() { this.contentEl.empty(); }
}

/* Relabel a book: the label only. The folder is shown and is not editable —
   it is the book's identity, and this device's open book is stored by it. A
   blank label is allowed and means "call it by its folder's name", which is
   what src/books.js cleanLabel stores in its place. */
class BookLabelModal extends Modal {
  constructor(app, plugin, { folder, label }, onDone) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
    this.label = label || '';
    this.onDone = onDone;
  }
  onOpen() {
    // Body-mounted, so outside the plugin root and its `lang` (i18n.js followLanguage).
    i18n.followLanguage(this.modalEl);
    const c = this.contentEl;
    c.empty();
    this.titleEl.setText(i18n.t('books.relabel.title'));
    let label = this.label;
    new Setting(c)
      .setName(i18n.t('books.add.label'))
      .setDesc(i18n.t('books.relabel.desc', { folder: this.folder || '/' }))
      .addText(t => t.setValue(label).onChange(v => { label = v; }));
    const nav = new Setting(c);
    nav.addButton(b => b.setButtonText(i18n.t('wiz.cancel')).onClick(() => this.close()));
    nav.addButton(b => b
      .setButtonText(i18n.t('books.relabel.save'))
      .setCta()
      .onClick(async () => {
        await this.save(label);
        this.close();
      }));
  }
  async save(label) {
    let r;
    try {
      r = await this.plugin.relabelBook(this.folder, label);
    } catch (e) {
      new Notice(i18n.t('settings.err.save', { error: e.message || e }), 6000);
      return { ok: false, reason: 'save' };
    }
    if (!r.ok) new Notice(i18n.t(`books.switch.${r.reason}`), 6000);
    if (typeof this.onDone === 'function') this.onDone();
    return r;
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { AddBookModal, BookLabelModal, bookProblemText, attachFolderSuggest };
