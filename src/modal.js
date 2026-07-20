'use strict';
/* Input modal — replaces window.prompt(), which Electron (and therefore
   Obsidian) does not support. One modal can collect several fields at once. */

const { Modal, Setting } = require('obsidian');

class FieldModal extends Modal {
  constructor(app, title, fields, resolve) {
    super(app);
    this.fieldDefs = fields;
    this.modalTitle = title;
    this.resolve = resolve;
    this.submitted = false;
    this.values = {};
  }
  onOpen() {
    this.titleEl.setText(this.modalTitle);
    const firstInputs = [];
    for (const f of this.fieldDefs) {
      const s = new Setting(this.contentEl).setName(f.label);
      if (f.desc) s.setDesc(f.desc);
      if (f.type === 'select') {
        this.values[f.key] = f.value ?? f.options[0];
        s.addDropdown(d => {
          for (const o of f.options) d.addOption(o, o.label ?? o);
          d.setValue(this.values[f.key]);
          d.onChange(v => { this.values[f.key] = v; });
        });
      } else {
        this.values[f.key] = String(f.value ?? '');
        s.addText(t => {
          t.setValue(this.values[f.key]);
          if (f.placeholder) t.setPlaceholder(f.placeholder);
          if (f.type === 'number') { t.inputEl.type = 'number'; t.inputEl.step = '0.01'; }
          t.onChange(v => { this.values[f.key] = v; });
          firstInputs.push(t.inputEl);
        });
      }
    }
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText('OK').setCta().onClick(() => this.submit()));
    this.scope.register([], 'Enter', evt => { evt.preventDefault(); this.submit(); });
    if (firstInputs[0]) window.setTimeout(() => firstInputs[0].focus(), 10);
  }
  submit() { this.submitted = true; this.close(); }
  onClose() {
    this.contentEl.empty();
    this.resolve(this.submitted ? this.values : null);
  }
}

function askFields(app, title, fields) {
  return new Promise(res => new FieldModal(app, title, fields, res).open());
}

/* Yes/no confirmation. Resolves true only if the user clicks the confirm
   button; closing/cancelling resolves false. iOS-safe (no window.confirm). */
class ConfirmModal extends Modal {
  constructor(app, opts, resolve) {
    super(app);
    this.opts = opts;
    this.resolve = resolve;
    this.answer = false;
  }
  onOpen() {
    const { title, message, confirmText = 'Discard', cancelText = 'Cancel' } = this.opts;
    if (title) this.titleEl.setText(title);
    this.contentEl.createEl('p', { text: message });
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText(cancelText).onClick(() => this.close()))
      .addButton(b => b.setButtonText(confirmText).setWarning().onClick(() => { this.answer = true; this.close(); }));
  }
  onClose() { this.contentEl.empty(); this.resolve(this.answer); }
}
function confirmModal(app, opts) {
  return new Promise(res => new ConfirmModal(app, opts, res).open());
}

module.exports = { FieldModal, askFields, ConfirmModal, confirmModal };
