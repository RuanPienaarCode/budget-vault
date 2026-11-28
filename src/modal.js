'use strict';
/* Input modal — replaces window.prompt(), which Electron (and therefore
   Obsidian) does not support. One modal can collect several fields at once. */

const { Modal, Setting } = require('obsidian');
const { el } = require('./dom');
const { normalizeAmount } = require('./amount');
// Namespaced, as everywhere in src/ — `t` is a local in half these files.
const i18n = require('./i18n');
const { amountCents } = require('./tx-role');
const { checkSubcategoryName } = require('./subcategories');

/* Does Enter, pressed with focus on `target`, mean "I am done with this form"?

   Only where Enter has no meaning of its own. The handler this serves is on the
   dialog's SCOPE, which Obsidian runs from a keydown listener on `window` in
   the capture phase — before the focused control sees the key. It used to let
   a <textarea> off and take the key from everything else, so:

     - Enter on Cancel SAVED the form. The button's own activation never ran,
       and the one control whose whole meaning is "do not do this" did it
       (audit of 11 Nov 2026, task 14).
     - Enter on a dropdown submitted, where Enter is how an open list is
       committed on Windows and Linux.
     - Enter on a toggle flipped it AND closed the dialog: Obsidian's toggle is
       a <label class="checkbox-container" tabindex="0"> whose own keydown
       turns Enter and Space into a flip (read out of app.js, same date).

   The <textarea> exception is the original one and stays: Enter there is the
   only way to start a new paragraph, and without it a note was saved holding
   the one sentence typed so far.

   The input types named below are the ones a value is not typed into. Listed
   as the exceptions, not the rule, so a text-like type nobody thought of here
   (search, tel, month) keeps submitting like the text field it is. Anything
   that is not a control at all — the dialog's own padding, or no target —
   submits as it always did, so a reader who clicked beside a field is not left
   with a dead key. */
const ENTER_OWN_TAGS = new Set(['TEXTAREA', 'BUTTON', 'SELECT', 'A', 'SUMMARY']);
const ENTER_OWN_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image']);
const ENTER_OWN_ROLES = new Set(['button', 'switch', 'checkbox', 'link', 'menuitem', 'option', 'tab']);
function enterSubmits(target) {
  if (!target || !target.tagName) return true;
  if (ENTER_OWN_TAGS.has(target.tagName)) return false;
  if (target.tagName === 'INPUT') return !ENTER_OWN_INPUTS.has(String(target.type || 'text').toLowerCase());
  if (target.isContentEditable) return false;
  if (typeof target.getAttribute === 'function' && ENTER_OWN_ROLES.has(target.getAttribute('role'))) return false;
  // The toggle's tab stop is a <label>, which no tag or type test above names.
  if (typeof target.closest === 'function' && target.closest('.checkbox-container')) return false;
  return true;
}

/* ---- a field's accessible name, bound to the label on screen -------------
   Obsidian's Setting prints the label through setName() as a <div
   class="setting-item-name"> BESIDE the control — a sibling, not a <label
   for> — so nothing tied the words to the field, and a screen reader
   announced "edit text" with no name on every dialog behind askFields (audit
   of 11 Nov 2026, task 15). The wizard's fields never had the gap:
   src/onboarding.js names each of its own.

   Bound by REFERENCE (aria-labelledby onto the name element, aria-describedby
   onto the hint), not by copying the string into an aria-label: the label a
   sighted reader sees and the one a screen reader speaks are then one node,
   so they cannot drift, and a caller that already translated its label has
   nothing further to translate. aria-label is kept only as the fallback for a
   Setting that exposes no name element.

   The hint is referenced only when the field HAS one. Setting always creates
   the description element, so pointing at it unconditionally would describe
   every field by an empty node.

   One counter for the whole session, never reset: two dialogs can be on
   screen at once (a confirmation over a form), and ids must not repeat
   between them. */
let fieldSeq = 0;
function refIds(setting, hasDesc) {
  const n = ++fieldSeq;
  const ids = { name: '', desc: '' };
  if (setting.nameEl) { ids.name = `bud-field-${n}-name`; setting.nameEl.setAttribute('id', ids.name); }
  if (hasDesc && setting.descEl) { ids.desc = `bud-field-${n}-desc`; setting.descEl.setAttribute('id', ids.desc); }
  return ids;
}
function nameControl(control, label, names, descs) {
  if (!control) return;
  const by = names.filter(Boolean).join(' ');
  if (by) control.setAttribute('aria-labelledby', by);
  else control.setAttribute('aria-label', label);
  const described = descs.filter(Boolean).join(' ');
  if (described) control.setAttribute('aria-describedby', described);
}

/* A toggle needs more than a name, because of what Obsidian's is made of
   (app.js, read 11 Nov 2026): a <label class="checkbox-container"
   tabindex="0"> around an <input type="checkbox" tabindex="-1">. The LABEL is
   the tab stop, and a label has no role, so focus landed on an element that
   was neither named nor anything. Its state lives in `on` and an `is-enabled`
   class: setValue() never touches the checkbox's `checked`, so the one
   element that does have a role reported "unchecked" about a toggle that was
   on.

   So the tab stop is made a switch, with its state written by the same
   callback that records the value; and the checkbox underneath is named and
   kept in step too, since it is what a pointer click focuses. Two elements
   that say the same thing, rather than one hidden — hiding an element that
   can take focus is its own defect.

   Older builds put the tab stop on the checkbox itself, inside a plain <div>.
   There the checkbox takes the name and the container is left alone, so
   whichever element is in the tab order is the one that is named.

   Returns the function that publishes a new state. */
function nameToggle(tg, label, names, descs) {
  const box = tg.toggleEl;
  if (!box) return () => {};
  const inner = typeof box.querySelector === 'function' ? box.querySelector('input') : null;
  const stop = box.getAttribute('tabindex');
  const boxIsTabStop = (stop !== null && Number(stop) >= 0) || !inner;
  if (boxIsTabStop) {
    box.setAttribute('role', 'switch');
    nameControl(box, label, names, descs);
  }
  nameControl(inner, label, names, descs);
  return on => {
    if (boxIsTabStop) box.setAttribute('aria-checked', on ? 'true' : 'false');
    if (inner) inner.checked = !!on;
  };
}

/* ---- a form that says what is wrong and stays open ----------------------
   Every caller used to validate AFTER the dialog had closed, so a missing
   description, title or name closed the form with a toast and threw away
   everything else typed — a long note body included (2026-11-25 audit,
   FUN-1). The check has to run while the form is still on screen, which only
   the dialog can arrange; so askFields takes an optional `validate(values)`.

   It returns nothing when the values are fine, a message string when they are
   not, or `{ field, message }` to also name the field at fault. On a message
   the dialog stays OPEN with every value as typed, prints the message in the
   dialog itself (a toast would sit behind the overlay on a phone), and moves
   focus to that field. The promise settles only when validation passes or the
   reader cancels, so a caller's own checks after `await askFields` can never
   be reached with a value the hook refused. A caller that passes no hook gets
   exactly the dialog it always had.

   `validate` is handed a COPY of the values: a hook that tidies its argument
   cannot change what the reader sees or what resolves.

   The message is drawn with the split dialog's foot classes
   (`budget-split-foot is-off`), which are unscoped like every dialog rule here
   (a Modal renders outside the plugin root) and already carry the error
   colour of this stylesheet — a rule of its own would be a second red. */
function cloneValues(values) {
  const out = {};
  for (const k of Object.keys(values)) out[k] = Array.isArray(values[k]) ? [...values[k]] : values[k];
  return out;
}
function readVerdict(verdict) {
  if (!verdict) return null;
  if (typeof verdict === 'string') return { field: null, message: verdict };
  if (typeof verdict.message === 'string' && verdict.message) return { field: verdict.field ?? null, message: verdict.message };
  return null;
}

class FieldModal extends Modal {
  constructor(app, title, fields, resolve, opts) {
    super(app);
    this.fieldDefs = fields;
    this.modalTitle = title;
    this.resolve = resolve;
    this.submitted = false;
    this.values = {};
    this.validate = opts && typeof opts.validate === 'function' ? opts.validate : null;
    // key -> the control the reader types into, for putting focus on it, and
    // the row it sits in, for putting the message under it.
    this.controls = {};
    this.rows = {};
    /* key -> what to run when that select changes, for the dropdowns that
       follow it (a field with `follows`). Filled as the followers are built, so
       the field they follow only has to be earlier in the form. */
    this.followers = {};
    this.errEl = null;
    this.badKey = null;
  }
  /* Called from every control's change handler. The message is about a value
     the reader is now changing, so it goes — rather than sitting red over a
     field that has since been fixed. A message that names no field goes on any
     edit; one that names a field goes when that field is edited. */
  touched(key) {
    if (!this.errEl || !this.errEl.textContent) return;
    if (this.badKey !== null && this.badKey !== key) return;
    this.clearError();
  }
  clearError() {
    if (this.errEl) this.errEl.textContent = '';
    const c = this.badKey !== null ? this.controls[this.badKey] : null;
    if (c && typeof c.removeAttribute === 'function') c.removeAttribute('aria-invalid');
    this.badKey = null;
  }
  showError(bad) {
    this.clearError();
    this.errEl.textContent = bad.message;
    const c = bad.field != null ? this.controls[bad.field] : null;
    if (bad.field != null) this.badKey = bad.field;
    /* Under the field it is about when one is named: in a form taller than the
       window, focus scrolls to the field, and a message left above the buttons
       would be out of sight at the other end. A message about the form as a
       whole stays above the buttons. */
    const row = bad.field != null ? this.rows[bad.field] : null;
    if (row && typeof row.after === 'function') row.after(this.errEl);
    if (c) {
      if (typeof c.setAttribute === 'function') c.setAttribute('aria-invalid', 'true');
      if (typeof c.focus === 'function') c.focus();
    }
  }
  onOpen() {
    // Body-mounted, so outside the plugin root and its `lang` (i18n.js followLanguage).
    i18n.followLanguage(this.modalEl);
    this.titleEl.setText(this.modalTitle);
    const firstInputs = [];
    for (const f of this.fieldDefs) {
      const s = new Setting(this.contentEl).setName(f.label);
      if (f.desc) s.setDesc(f.desc);
      // The field's label and hint, as ids every branch below binds to its
      // control (refIds, above).
      const ids = refIds(s, !!f.desc);
      this.rows[f.key] = s.settingEl;
      if (f.type === 'toggles') {
        /* A set of independent yes/no choices under one heading — for
           "which of these do you want off", where a dropdown would force the
           answers into a single mutually-exclusive list they are not.
           Resolves to an ARRAY of the values switched on.

           Obsidian's own toggle rather than a bare <input type=checkbox>: it
           is the control the reader already knows, it is keyboard-reachable,
           and it behaves on iOS, where a hand-rolled checkbox row would need
           its own hit-target work. */
        this.values[f.key] = [...(f.value || [])];
        s.setHeading();
        for (const o of f.options) {
          const row = new Setting(this.contentEl).setName(o.label);
          if (o.desc) row.setDesc(o.desc);
          /* Named by the heading AND the row. "Low balance" under "Mute
             warnings" is a complete thought on screen and half of one when
             the row is read alone, which is how a screen reader reaches it. */
          const own = refIds(row, !!o.desc);
          row.addToggle(tg => {
            const on = this.values[f.key].includes(o.value);
            tg.setValue(on);
            const publish = nameToggle(tg, o.label, [ids.name, own.name], [ids.desc, own.desc]);
            publish(on);
            tg.onChange(now => {
              const cur = this.values[f.key].filter(v => v !== o.value);
              if (now) cur.push(o.value);
              this.values[f.key] = cur;
              publish(now);
              this.touched(f.key);
            });
          });
        }
      } else if (f.type === 'textarea') {
        /* Prose, not a value. The single-line addText below is right for a
           name or an amount and wrong for the first paragraph of a note: on a
           phone it scrolls a whole sentence sideways through a 200px slot,
           with no way to see what you already typed.

           Deliberately NOT pushed onto firstInputs — autofocusing a textarea
           raises the iOS keyboard over the fields above it before the reader
           has even seen them, and this is never the first field in a form. */
        this.values[f.key] = String(f.value ?? '');
        s.setClass('bud-field-tall');
        s.addTextArea(t => {
          t.setValue(this.values[f.key]);
          if (f.placeholder) t.setPlaceholder(f.placeholder);
          t.inputEl.rows = f.rows || 5;
          nameControl(t.inputEl, f.label, [ids.name], [ids.desc]);
          this.controls[f.key] = t.inputEl;
          t.onChange(v => { this.values[f.key] = v; this.touched(f.key); });
        });
      } else if (f.type === 'select' && f.follows && typeof f.optionsFor === 'function') {
        /* A dropdown whose choices depend on another field's value — Add
           transaction's Subcategory under Category (ADR-0010). `optionsFor(
           value)` returns the {value, label} list for the followed field's
           current value, the first entry being "none". It is rebuilt whenever
           that field changes, the chosen value goes back to none (a
           subcategory belongs to one category, so it must not follow the row
           to another), and the control is disabled while only "none" is on
           offer: empty and unreachable until there is something to choose.

           A value the form opens with (a kept draft) is shown only if the
           category on screen offers it. */
        const offered = () => f.optionsFor(this.values[f.follows]);
        const first = offered();
        this.values[f.key] = first.some(o => o.value === f.value) ? f.value : '';
        s.addDropdown(d => {
          const fill = () => {
            const opts = offered();
            d.selectEl.empty();
            for (const o of opts) d.addOption(o.value, o.label);
            d.selectEl.disabled = opts.length <= 1;
          };
          fill();
          d.setValue(this.values[f.key]);
          nameControl(d.selectEl, f.label, [ids.name], [ids.desc]);
          this.controls[f.key] = d.selectEl;
          d.onChange(v => { this.values[f.key] = v; this.touched(f.key); });
          (this.followers[f.follows] = this.followers[f.follows] || []).push(() => {
            this.values[f.key] = '';
            fill();
            d.setValue('');
          });
        });
      } else if (f.type === 'select') {
        this.values[f.key] = f.value ?? f.options[0];
        s.addDropdown(d => {
          for (const o of f.options) d.addOption(o.value ?? o, o.label ?? o);
          d.setValue(this.values[f.key]);
          nameControl(d.selectEl, f.label, [ids.name], [ids.desc]);
          this.controls[f.key] = d.selectEl;
          d.onChange(v => {
            this.values[f.key] = v;
            for (const follow of this.followers[f.key] || []) follow();
            this.touched(f.key);
          });
        });
      } else {
        this.values[f.key] = String(f.value ?? '');
        s.addText(t => {
          t.setValue(this.values[f.key]);
          if (f.placeholder) t.setPlaceholder(f.placeholder);
          if (f.type === 'number') { t.inputEl.type = 'number'; t.inputEl.step = '0.01'; }
          if (f.type === 'date') t.inputEl.type = 'date';
          nameControl(t.inputEl, f.label, [ids.name], [ids.desc]);
          this.controls[f.key] = t.inputEl;
          t.onChange(v => { this.values[f.key] = v; this.touched(f.key); });
          firstInputs.push(t.inputEl);
        });
      }
    }
    /* Only a form that has a hook can refuse, so only that form gets the
       element; role=alert has the refusal read out when it appears. Above the
       buttons, where the eye is when it has just pressed one. */
    if (this.validate) {
      this.errEl = el('div', { class: 'budget-split-foot is-off', role: 'alert' });
      this.contentEl.append(this.errEl);
    }
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText(i18n.t('bx.cancel')).onClick(() => this.close()))
      .addButton(b => b.setButtonText(i18n.t('modal.ok')).setCta().onClick(() => this.submit()));
    /* Enter submits from a field you type a value into, and is left alone
       everywhere it already means something (enterSubmits, above).

       Returning without preventDefault is what hands the key back: Obsidian
       runs this from a capture-phase listener on `window`, ahead of the
       focused control, and only an explicit preventDefault (or a `false`
       return) takes the key away from it. */
    this.scope.register([], 'Enter', evt => {
      if (!enterSubmits(evt.target)) return;
      evt.preventDefault();
      this.submit();
    });
    if (firstInputs[0]) window.setTimeout(() => firstInputs[0].focus(), 10);
  }
  submit() {
    if (this.validate) {
      const bad = readVerdict(this.validate(cloneValues(this.values)));
      if (bad) { this.showError(bad); return; }
    }
    this.submitted = true;
    this.close();
  }
  onClose() {
    this.contentEl.empty();
    this.resolve(this.submitted ? this.values : null);
  }
}

/* `opts.validate(values)` — see "a form that says what is wrong" above. */
function askFields(app, title, fields, opts) {
  return new Promise(res => new FieldModal(app, title, fields, res, opts).open());
}

/* Yes/no confirmation. Resolves true only if the user clicks the confirm
   button; closing/cancelling resolves false. iOS-safe (no window.confirm).

   `primary` says which answer the dialog offers as the one to press. The
   default, 'confirm', is the shape every caller had: the confirm button drawn
   as a warning, because confirming is the risky act and declining is just
   leaving. 'cancel' is for the question whose SAFE answer is the one the
   reader should reach for — the Transactions page's "Update the matching rule
   too?", where "Just this row" keeps the rule and "Update the rule" refiles
   every future import of that merchant. There the cancel button carries
   Obsidian's call-to-action style and the confirm button is plain: neither
   the default nor dressed as a warning, just the deliberate second choice.
   Which answer resolves true never changes — only the confirm button does
   (2026-10-07 audit, RULEFIX carry-over). */
class ConfirmModal extends Modal {
  constructor(app, opts, resolve) {
    super(app);
    this.opts = opts;
    this.resolve = resolve;
    this.answer = false;
  }
  onOpen() {
    // Body-mounted, so outside the plugin root and its `lang` (i18n.js followLanguage).
    i18n.followLanguage(this.modalEl);
    const { title, message, confirmText = 'Discard', cancelText = i18n.t('bx.cancel'), primary = 'confirm' } = this.opts;
    const safeFirst = primary === 'cancel';
    if (title) this.titleEl.setText(title);
    this.contentEl.createEl('p', { text: message });
    new Setting(this.contentEl)
      .addButton(b => {
        b.setButtonText(cancelText).onClick(() => this.close());
        if (safeFirst) b.setCta();
      })
      .addButton(b => {
        b.setButtonText(confirmText).onClick(() => { this.answer = true; this.close(); });
        if (!safeFirst) b.setWarning();
      });
  }
  onClose() { this.contentEl.empty(); this.resolve(this.answer); }
}
function confirmModal(app, opts) {
  return new Promise(res => new ConfirmModal(app, opts, res).open());
}

/* Split modal — carve one bank line into several category lines.
   `opts`: { tx: {date, desc, label, amount}, categories: [name], money }
   Resolves to [{ amount, cat, note }, …] (already signed like the original)
   or null on cancel.

   Two decisions baked into the UI, both worth stating plainly:

   • Parts are typed as POSITIVE magnitudes and the original's direction is
     applied on the way out — the same idiom as Add transaction's "always
     positive, direction sets the sign". A split can then never accidentally
     flip a spend into income, which no amount of sign-checking after the
     fact makes as safe.
   • The parts must sum to the original EXACTLY. There is no "close enough":
     the whole point is that the period totals are unchanged by splitting,
     so the OK button stays disabled until the remainder is zero. */
class SplitModal extends Modal {
  constructor(app, opts, resolve) {
    super(app);
    this.opts = opts;
    this.resolve = resolve;
    this.result = null;
    // Work in magnitudes; sign is re-applied in submit().
    this.sign = opts.tx.amount < 0 ? -1 : 1;
    /* In whole cents, rounded by the SAME rule the row's chip uses for the
       parent (tx-role.js amountCents, via splitShortfall). The stored amount
       can carry three decimals (a fuel slip: -912.345); the parts are cents, so
       against the raw figure two different cent totals both read as balanced
       and one of them then showed a shortfall on the chip, while 58.125 had no
       cent total at all and the Split button never enabled. Rounded here there
       is exactly one total, it is reachable by typing cents, and what the dialog
       accepts is what the chip calls complete. The magnitude is taken AFTER the
       signed rounding, never before: Math.round(-912.345 * 100) and
       Math.round(912.345 * 100) differ by a cent. The row's own amount is not
       touched. */
    this.totalCents = Math.abs(amountCents(opts.tx.amount));
    this.total = this.totalCents / 100;
    this.parts = [
      { mag: this.total, cat: opts.tx.cat || '', note: '' },
      { mag: 0, cat: '', note: '' },
    ];
  }

  onOpen() {
    // Body-mounted, so outside the plugin root and its `lang` (i18n.js followLanguage).
    i18n.followLanguage(this.modalEl);
    const { tx, money } = this.opts;
    this.titleEl.setText(i18n.t('tx.split.title'));
    const c = this.contentEl;

    c.append(el('div', { class: 'budget-split-head' },
      el('div', { class: 'budget-split-desc' }, tx.desc),
      el('div', { class: 'budget-split-meta' },
        [tx.date, tx.label, money(tx.amount)].filter(Boolean).join(' · '))));

    this.partsEl = el('div', { class: 'budget-split-parts' });
    c.append(this.partsEl);

    const addBtn = el('button', { type: 'button', class: 'budget-split-add' }, i18n.t('tx.split.addPart'));
    // Seed the new part with what's still unallocated: adding a part is nearly
    // always "and the rest goes here", so this usually balances in one click.
    addBtn.addEventListener('click', () => {
      this.parts.push({ mag: Math.max(0, this.remainder()), cat: '', note: '' });
      this.renderParts();
      this.refresh();
    });
    c.append(addBtn);

    this.footEl = el('div', { class: 'budget-split-foot', role: 'status' });
    c.append(this.footEl);
    c.append(el('div', { class: 'budget-split-hint' }, i18n.t('tx.split.hint')));

    const foot = new Setting(c);
    foot.addButton(b => b.setButtonText(i18n.t('bx.cancel')).onClick(() => this.close()));
    foot.addButton(b => {
      this.okBtn = b;
      b.setButtonText(i18n.t('tx.split.submit')).setCta().onClick(() => this.submit());
    });

    this.renderParts();
    this.refresh();
  }

  /* The cents a part will actually be WRITTEN as.

     Everything that judges a part goes through here — the balance, the
     positivity check, and the rows submit() hands back — because the gate has
     to weigh the values it is about to write, not the ones that were typed. It
     used to round the SUM of the raw magnitudes while submit() rounded each
     part on its way out, so anything below a cent was measured one way and
     written another: 33.333 three times sums to 99.999, rounds to 100.00, and
     reported balanced while writing 99.99. tx-role.js re-checks none of this by
     design ("the modal is the gate"), and the parent is excluded on the way
     out, so the difference simply left the budget. */
  partMag(p) { return Math.round(((p && p.mag) || 0) * 100) / 100; }

  /* Rounded to cents at every step: comparing raw float sums against the
     original is how a 0.004 remainder ends up permanently un-zeroable. */
  allocated() {
    return Math.round(this.parts.reduce((a, p) => a + this.partMag(p), 0) * 100) / 100;
  }
  remainder() { return Math.round((this.total - this.allocated()) * 100) / 100; }

  renderParts() {
    this.partsEl.replaceChildren();
    this.parts.forEach((p, i) => {
      const amt = el('input', {
        type: 'text', class: 'budget-split-amt', inputmode: 'decimal',
        autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
        value: p.mag ? p.mag.toFixed(2) : '',
        placeholder: '0.00', 'aria-label': i18n.t('tx.split.aria.amount', { n: i + 1 }),
      });
      amt.addEventListener('input', () => {
        p.mag = Math.abs(normalizeAmount(amt.value) ?? 0);
        this.refresh();
      });

      const cat = el('select', { class: 'budget-split-cat', 'aria-label': i18n.t('tx.split.aria.category', { n: i + 1 }) });
      cat.append(el('option', { value: '' }, i18n.t('tx.field.none')));
      for (const name of this.opts.categories) cat.append(el('option', { value: name }, name));
      cat.value = p.cat;
      cat.addEventListener('change', () => { p.cat = cat.value; });

      const note = el('input', {
        type: 'text', class: 'budget-split-note', value: p.note,
        placeholder: i18n.t('tx.split.notePlaceholder'), 'aria-label': i18n.t('tx.split.aria.note', { n: i + 1 }),
      });
      note.addEventListener('input', () => { p.note = note.value; });

      const row = el('div', { class: 'budget-split-part' }, amt, cat, note);
      // Two parts is the floor — below that it isn't a split.
      if (this.parts.length > 2) {
        const del = el('button', {
          type: 'button', class: 'budget-split-del', 'aria-label': i18n.t('tx.split.aria.remove', { n: i + 1 }),
        }, '✕');
        del.addEventListener('click', () => {
          this.parts.splice(i, 1);
          this.renderParts();
          this.refresh();
        });
        row.append(del);
      }
      this.partsEl.append(row);
    });
  }

  refresh() {
    const { money } = this.opts;
    const rem = this.remainder();
    const balanced = rem === 0;
    // The written value, not the typed one: 0.004 is a number the reader typed
    // and not an amount the file can hold, so it must read as missing here
    // rather than balance the split and then land as a 0.00 row.
    const allPositive = this.parts.every(p => this.partMag(p) > 0);
    /* The message names the actual blocker. "Balanced" while the Split button
       sits disabled (the seeded second part is still 0) reads as a bug. */
    this.footEl.textContent = !balanced
      ? i18n.t('tx.split.unallocated', { amount: money(this.sign * rem) })
      : allPositive
        ? i18n.t('tx.split.balanced', { amount: money(this.sign * this.total) })
        : i18n.t('tx.split.needAmount');
    this.footEl.classList.toggle('is-balanced', balanced && allPositive);
    this.footEl.classList.toggle('is-off', !(balanced && allPositive));
    if (this.okBtn) this.okBtn.setDisabled(!(balanced && allPositive));
  }

  submit() {
    // Same rounded magnitudes the gate weighed, reused rather than recomputed —
    // one rule, so what was approved is exactly what is written.
    const mags = this.parts.map(p => this.partMag(p));
    if (this.remainder() !== 0 || !mags.every(m => m > 0)) return;
    this.result = this.parts.map((p, i) => ({
      amount: parseFloat((this.sign * mags[i]).toFixed(2)),
      cat: p.cat,
      note: p.note.trim(),
    }));
    this.close();
  }

  onClose() { this.contentEl.empty(); this.resolve(this.result); }
}

function askSplit(app, opts) {
  return new Promise(res => new SplitModal(app, opts, res).open());
}

/* Rules cleanup preview — show exactly which rules a tidy would delete, and
   why each one is safe, BEFORE anything is written.

   `opts`: the report from rule-cleanup.js analyseRules(), plus { money } is
   not needed. Resolves true only if the user clicks the remove button.

   The preview is the feature, not a courtesy wrapper around it. This is a bulk
   delete against a file the user owns and can hand-edit, so "trust me, 832 of
   these do nothing" is not something the plugin gets to assert — it has to
   show its work, name the surviving rule that covers each deletion, and let
   the user close the box without doing anything. Deleting nothing is a
   perfectly good outcome here.

   The preview is still not the whole safety story: nobody audits eight hundred
   lines in a dialog. cleanupRules() writes the pre-delete set beside the live
   file before touching it, so agreeing here is recoverable.

   Every deletion is listed, not a sample: a truncated list would mean the one
   rule the user cared about is the one they could not see.

   Conflicts are listed too, though nothing is ever removed for one. Two rules
   with the same pattern and different categories are not a duplicate: the later
   one is already dead, but which of the two the household MEANT is theirs to
   say, so the app names the pair, says which one wins today, and says that it
   will not choose (2026-11-25 audit, RUL-11 follow-up). Before this the dialog
   could open on "all 40 rules earn their place" over a file that contradicted
   itself. Like the rest of this dialog the wording is English-only: the
   preview was never keyed, and one keyed sentence among forty plain ones would
   read as a half-translated dialog rather than a finished one. (Its Cancel and
   Close buttons are the exception: the generic ones every dialog shares.) */
class RulesCleanupModal extends Modal {
  constructor(app, report, resolve) {
    super(app);
    this.report = report;
    this.resolve = resolve;
    this.answer = false;
  }

  onOpen() {
    // Body-mounted, so outside the plugin root and its `lang` (i18n.js followLanguage).
    i18n.followLanguage(this.modalEl);
    const { remove, redundant, blank, dormant, kept, checked, total } = this.report;
    // Absent on a report from before conflicts were reported: none to show.
    const conflicts = this.report.conflicts || [];
    this.titleEl.setText('Tidy categorisation rules');
    const c = this.contentEl;

    if (!remove.length) {
      /* "All N rules earn their place" is a claim about every rule, and a
         conflict is two rules that cannot both be right — so with any, the
         sentence is not printed at all, not printed with a caveat after it. */
      c.append(el('p', { class: 'budget-tidy-lead' },
        total === 0
          ? 'There are no categorisation rules yet. They get written as you categorise imported transactions.'
          : conflicts.length
            ? `Nothing to remove, but ${conflicts.length} ${conflicts.length === 1 ? 'pattern is' : 'patterns are'} given more than one category — see below.`
            : `Nothing to remove — all ${total} rules earn their place against the ${checked} descriptions in your vault.`));
      this.renderConflicts(c, conflicts);
      new Setting(c).addButton(b => b.setButtonText(i18n.t('modal.close')).setCta().onClick(() => this.close()));
      return;
    }

    c.append(el('p', { class: 'budget-tidy-lead' },
      `${remove.length} of ${total} rules can go, leaving ${kept}. `
      + `Every one was removed and re-checked against all ${checked} transaction descriptions `
      + 'in your vault: each still came out with exactly the category it has now. '
      + 'Each rule below is a longer version of one that stays, so future statements '
      + 'match it the same way too.'));

    const list = el('div', { class: 'budget-tidy-list' });
    for (const r of redundant) {
      list.append(el('div', { class: 'budget-tidy-row' },
        el('div', { class: 'budget-tidy-pattern' }, r.pattern),
        el('div', { class: 'budget-tidy-why' },
          `→ ${r.category || '(no category)'} · already covered by “${r.coveredBy}”`)));
    }
    for (const r of blank) {
      list.append(el('div', { class: 'budget-tidy-row' },
        el('div', { class: 'budget-tidy-pattern budget-tidy-empty' }, '(blank pattern)'),
        el('div', { class: 'budget-tidy-why' },
          `→ ${r.category || '(no category)'} · matches nothing, already ignored on import`)));
    }
    c.append(list);

    // Dormant rules are the ones this cannot vouch for, so they are named as
    // kept rather than quietly folded into the count.
    if (dormant.length) {
      c.append(el('p', { class: 'budget-tidy-hint' },
        `${dormant.length} other ${dormant.length === 1 ? 'rule matches' : 'rules match'} nothing in your history yet. `
        + 'Those are being kept — a rule with no transactions behind it may simply be waiting '
        + 'for one, and this cannot tell that apart from a rule you have finished with.'));
    }

    this.renderConflicts(c, conflicts);

    new Setting(c)
      .addButton(b => b.setButtonText(i18n.t('bx.cancel')).onClick(() => this.close()))
      .addButton(b => b
        .setButtonText(`Remove ${remove.length} ${remove.length === 1 ? 'rule' : 'rules'}`)
        .setWarning()
        .onClick(() => { this.answer = true; this.close(); }));
  }

  /* One row per pattern the file answers with more than one category. The
     winner is the FIRST category listed: both rules match the same text, and
     matchRule takes the earlier line (rules.js), so the first category in
     `categories` — they come in file order — is the one every statement is
     filed under today. Said plainly, since a reader who has not seen the file
     in months cannot be expected to know which line comes first. */
  renderConflicts(c, conflicts) {
    if (!conflicts.length) return;
    c.append(el('p', { class: 'budget-tidy-hint' },
      `${conflicts.length === 1 ? 'This pattern is' : 'These patterns are'} given more than one category. `
      + 'The earlier line wins today. The app will not choose between them, and nothing here removes them: '
      + 'open Data/Categorisation Rules.csv and keep the line you mean.'));
    const list = el('div', { class: 'budget-tidy-list' });
    for (const k of conflicts) {
      list.append(el('div', { class: 'budget-tidy-row' },
        el('div', { class: 'budget-tidy-pattern' }, k.pattern),
        el('div', { class: 'budget-tidy-why' },
          `→ ${k.categories.map(n => n || '(no category)').join(' · ')} · “${k.categories[0] || '(no category)'}” comes first, so it wins today`)));
    }
    c.append(list);
  }

  onClose() { this.contentEl.empty(); this.resolve(this.answer); }
}

function askRulesCleanup(app, report) {
  return new Promise(res => new RulesCleanupModal(app, report, res).open());
}

/* Bring a stranded budget's AMOUNTS across, one accepted line at a time.

   The sibling of the "bring over the categories and notes" button, and the
   reason that button says "categories and notes": a scaled figure is a guess,
   and a guess that arrives without anyone looking at it is indistinguishable
   from a number the user chose. So every row starts UNTICKED and shows its
   arithmetic — old amount, the naive pro-rata, and the factor in the lead — and
   the button counts what has actually been accepted.

   "Accept all" exists because thirty categories is a lot of clicking, and it is
   not the thing the issue warned against: every figure it ticks is already on
   screen next to the old one. What must never exist is a path that writes them
   without showing them. */
class BudgetResliceModal extends Modal {
  constructor(app, plan, opts, resolve) {
    super(app);
    this.plan = plan;
    this.money = opts.money || (n => String(n));
    this.sourceLabel = opts.sourceLabel || '';
    this.resolve = resolve;
    this.answer = null;
    this.accepted = new Set();
  }

  onOpen() {
    // Body-mounted, so outside the plugin root and its `lang` (i18n.js followLanguage).
    i18n.followLanguage(this.modalEl);
    const { rows, oldDays, dstDays, factor } = this.plan;
    this.titleEl.setText('Bring the amounts across');
    const c = this.contentEl;

    if (!rows.length) {
      c.append(el('p', { class: 'budget-tidy-lead' }, 'That budget has no amounts to bring across.'));
      new Setting(c).addButton(b => b.setButtonText(i18n.t('modal.close')).setCta().onClick(() => this.close()));
      return;
    }

    c.append(el('p', { class: 'budget-tidy-lead' }, factor
      ? `Budgets/${this.sourceLabel}.md ran ${oldDays} days; this period runs ${dstDays}. `
        + `Each suggestion below is the old amount × ${dstDays}/${oldDays} — a flat pro-rata, `
        + 'which is right for something like groceries and wrong for a rent or a subscription '
        + 'that costs the same whatever the period length. Tick the lines where scaling is the '
        + 'right answer; set the others yourself afterwards.'
      : `Budgets/${this.sourceLabel}.md is the only budget saved under its length, so how long `
        + 'its periods ran cannot be worked out from their names — and nothing in the file '
        + 'records it. These are the old amounts UNCHANGED, not re-sliced. Tick any that happen '
        + 'to be right for this period.'));

    const list = el('div', { class: 'budget-tidy-list budget-reslice-list' });
    const boxes = [];
    for (const r of rows) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = false;
      cb.addEventListener('change', () => {
        if (cb.checked) this.accepted.add(r.category); else this.accepted.delete(r.category);
        sync();
      });
      boxes.push({ cb, row: r });
      const to = r.scaled ? r.suggested : r.oldAmount;
      list.append(el('label', { class: 'budget-tidy-row budget-reslice-row' },
        cb,
        el('div', { class: 'budget-reslice-cat' }, r.category),
        el('div', { class: 'budget-reslice-nums' },
          el('span', { class: 'budget-reslice-old' }, this.money(r.oldAmount)),
          el('span', { class: 'budget-reslice-arrow' }, ' → '),
          el('span', { class: 'budget-reslice-new' }, this.money(to))),
        r.hasExisting
          ? el('div', { class: 'budget-tidy-why' },
            `already set to ${this.money(r.existing)} for this period — ticking this replaces it`)
          : null));
    }
    c.append(list);

    const all = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Accept all');
    all.addEventListener('click', () => {
      const turnOn = this.accepted.size < rows.length;
      for (const { cb, row } of boxes) {
        cb.checked = turnOn;
        if (turnOn) this.accepted.add(row.category); else this.accepted.delete(row.category);
      }
      sync();
    });
    c.append(el('div', { class: 'budget-reslice-bulk' }, all));

    let applyBtn = null;
    const sync = () => {
      const n = this.accepted.size;
      all.textContent = n === rows.length ? 'Clear all' : 'Accept all';
      if (applyBtn) {
        applyBtn.setDisabled(n === 0);
        applyBtn.setButtonText(n ? `Bring ${n} ${n === 1 ? 'amount' : 'amounts'} across` : 'Nothing accepted yet');
      }
    };

    new Setting(c)
      .addButton(b => b.setButtonText(i18n.t('bx.cancel')).onClick(() => this.close()))
      .addButton(b => {
        applyBtn = b;
        b.setCta().onClick(() => {
          if (!this.accepted.size) return;
          this.answer = rows
            .filter(r => this.accepted.has(r.category))
            .map(r => ({ category: r.category, amount: r.scaled ? r.suggested : r.oldAmount, notes: r.notes }));
          this.close();
        });
        sync();
      });
  }

  onClose() { this.contentEl.empty(); this.resolve(this.answer); }
}

function askBudgetReslice(app, plan, opts) {
  return new Promise(res => new BudgetResliceModal(app, plan, opts || {}, res).open());
}

/* The Budget page's Subcategories dialog for one category (ADR-0010 §3): the
   names a transaction may carry under it, added and removed here.

   `opts`: { category, names, inUse, save }.
     names   the list on the category's note, in the order written
     inUse   every name transactions carry under this category, listed or not —
             so the dialog can say which ones are not on the list, and keep
             saying so after a name is removed from it
     save    async (names) => boolean — writes the note and resolves true only
             if it landed. The dialog shows what the note says: a name appears
             or disappears only once save has answered true.

   Nothing here touches a transaction. A removed name stops being OFFERED and
   nothing else (a row that carries it still shows it), which the dialog says
   in words because the other reading — that removing a name edits every row
   that uses it — is the one a reader would otherwise assume. Added and removed
   one at a time and saved at once, the way "＋ New subcategory…" is, so the
   list in the dialog and the list in the file cannot disagree. One save at a
   time: a second press while one is in flight is ignored, not queued. */
class SubcategoriesModal extends Modal {
  constructor(app, opts, resolve) {
    super(app);
    this.opts = opts;
    this.resolve = resolve;
    this.names = [...(opts.names || [])];
    this.used = [...(opts.inUse || [])];
    this.typed = '';
    this.busy = false;
    this.inputEl = null;
  }
  onOpen() {
    // Body-mounted, so outside the plugin root and its `lang` (i18n.js followLanguage).
    i18n.followLanguage(this.modalEl);
    const { category } = this.opts;
    this.titleEl.setText(i18n.t('bud.subcat.title', { category }));
    this.contentEl.createEl('p', { text: i18n.t('bud.subcat.help') });
    this.listEl = this.contentEl.createDiv();
    this.noteEl = this.contentEl.createEl('p', { cls: 'setting-item-description' });
    new Setting(this.contentEl)
      .setName(i18n.t('bud.subcat.addLabel'))
      .addText(t => {
        this.inputEl = t.inputEl;
        t.setPlaceholder(i18n.t('bud.subcat.placeholder'));
        t.inputEl.setAttribute('aria-label', i18n.t('bud.subcat.addLabel'));
        t.onChange(v => { this.typed = v; });
      })
      .addButton(b => b.setButtonText(i18n.t('bud.subcat.add')).setCta().onClick(() => this.add()));
    this.errEl = el('div', { class: 'budget-split-foot is-off', role: 'alert' });
    this.contentEl.append(this.errEl);
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText(i18n.t('bud.subcat.done')).onClick(() => this.close()));
    /* Enter in the name field adds it; on a button it is the button's own. */
    this.scope.register([], 'Enter', evt => {
      if (!this.inputEl || evt.target !== this.inputEl) return;
      evt.preventDefault();
      this.add();
    });
    this.render();
    window.setTimeout(() => { if (this.inputEl) this.inputEl.focus(); }, 10);
  }
  render() {
    this.listEl.empty();
    if (!this.names.length) {
      this.listEl.createEl('p', { text: i18n.t('bud.subcat.empty'), cls: 'setting-item-description' });
    }
    for (const name of this.names) {
      new Setting(this.listEl).setName(name).addButton(b => {
        b.setButtonText(i18n.t('bud.subcat.removeBtn'));
        b.buttonEl.setAttribute('aria-label', i18n.t('bud.subcat.remove', { name }));
        b.onClick(() => this.remove(name));
      });
    }
    const unlisted = this.used.filter(n => !this.names.includes(n));
    this.noteEl.setText(unlisted.length ? i18n.t('bud.subcat.unlisted', { names: unlisted.join(', ') }) : '');
  }
  /* `is-off` is the error colour (styles.css .budget-split-foot), set once at
     build like FieldModal's own message line; an empty line shows nothing. */
  setError(message) { this.errEl.textContent = message; }
  /* Saves `next` and shows it only if the save landed. */
  async attempt(next) {
    if (this.busy) return false;
    this.busy = true;
    let landed = false;
    try { landed = (await this.opts.save(next)) === true; } catch (e) { landed = false; }
    this.busy = false;
    if (landed) { this.names = next; this.render(); }
    return landed;
  }
  async add() {
    const check = checkSubcategoryName(this.typed, this.names);
    if (check.error) { this.setError(i18n.t('subcat.err.' + check.error)); return; }
    this.setError('');
    if (await this.attempt([...this.names, check.name])) {
      this.typed = '';
      if (this.inputEl) this.inputEl.value = '';
    }
  }
  async remove(name) {
    this.setError('');
    await this.attempt(this.names.filter(n => n !== name));
  }
  onClose() { this.contentEl.empty(); this.resolve(); }
}
function askSubcategories(app, opts) {
  return new Promise(res => new SubcategoriesModal(app, opts, res).open());
}

/* The ask* wrappers are the interface: each opens its Modal and resolves with
   the reader's answer, so a caller never has to remember to .open() one or to
   hand it a callback. FieldModal and ConfirmModal had no caller outside this
   file — SplitModal and RulesCleanupModal stay exported because their tests
   drive the class directly. */
module.exports = {
  askFields, confirmModal, SplitModal, askSplit, RulesCleanupModal, askRulesCleanup,
  BudgetResliceModal, askBudgetReslice, SubcategoriesModal, askSubcategories,
};
