'use strict';
/* Creating a missing account, category or subcategory from inside the Add
   transaction dialog (issue #189).

   A first-time household opens Add with no account, or types an entry whose
   category does not exist yet, and today has to leave, create the thing and
   start the entry again. The dropdowns now end in a create entry. Picking one
   does NOT stack a second dialog over Add: Add closes with everything typed kept
   as a draft (the same `addDraft` a copy or a refused entry uses), the EXISTING
   creation dialog opens alone, and Add reopens pre-filled once that has
   finished saving -- with the new item selected if it landed, and with
   everything as it was if it was cancelled or failed (decided with the issue,
   2026-11-28). Closing and reopening is also what makes "Add cannot be
   confirmed while a create is saving" true by construction: there is no Add on
   screen to confirm.

   This is the part of that which can be decided without a DOM, kept out of the
   view and the modal so one guard test can run it in bare node and neither can
   read it differently. Pure: no DOM, no Obsidian, no clock. */

/* The value of the create entry's <option>. Reserved-looking on purpose: it
   shares a list with real account and category names, and the modal recognises
   a pick by it. */
const CREATE_OPTION = '__bud_create__';

/* The property askFields' resolved values carry when the reader picked a create
   entry: the KEY of the field it was picked in. A string rather than a symbol,
   so a test that scripts the dialog can say it without importing anything from
   the modal (tests fake that module wholesale). */
const CREATE_KEY = '__create';

/* Which field's create entry was picked, or null for an ordinary answer (or a
   cancel). Anything that is not a non-empty string is no pick. */
function pickedCreate(values) {
  if (!values || typeof values !== 'object') return null;
  const key = values[CREATE_KEY];
  return typeof key === 'string' && key ? key : null;
}

/* Exactly what was typed: the resolved values without the marker, as a copy
   (arrays copied too, as the modal's own cloneValues does). The marker must
   never reach a draft -- it would ride into the next dialog and, from there,
   into whatever reads the answers. */
function typedValues(values) {
  const out = {};
  if (!values || typeof values !== 'object') return out;
  for (const k of Object.keys(values)) {
    if (k === CREATE_KEY) continue;
    out[k] = Array.isArray(values[k]) ? [...values[k]] : values[k];
  }
  return out;
}

/* What a creator hands back, as the value its dropdown selects -- or null when
   nothing landed. The three creators answer in three shapes (an account object,
   a category object, a bare subcategory name), and all three answer null for a
   cancel and for a refusal, which is what keeps "did it land" a single question.

   An account is selected by its transaction label when it has one, because that
   is what Add's account list is built from (`tx_label || name`); a new account
   has none, so in practice its name. */
function createdValue(key, made) {
  if (made == null) return null;
  const text = v => (typeof v === 'string' && v ? v : null);
  if (key === 'label') return typeof made === 'object' ? text(made.tx_label) || text(made.name) : null;
  if (key === 'cat') return typeof made === 'object' ? text(made.name) : null;
  if (key === 'subcategory') return text(made);
  return null;
}

/* The draft Add reopens with. `made` is the created VALUE (createdValue), or
   null when nothing landed -- in which case the draft is exactly what was
   typed, the dropdown unchanged.

   Only what the create decides moves. A new category replaces the old one and
   takes the subcategory with it: a subcategory belongs to one category (ADR-0010
   section 1), the new category has none, and a name kept from the old one would
   be offered by nothing. Everything else, including a half-finished form, comes
   back as typed: picking a create entry is not a submit and is not validated. */
function draftAfterCreate(values, key, made) {
  const draft = typedValues(values);
  if (typeof made !== 'string' || !made) return draft;
  if (key === 'label') draft.label = made;
  else if (key === 'cat') { draft.cat = made; draft.subcategory = ''; }
  else if (key === 'subcategory') draft.subcategory = made;
  return draft;
}

module.exports = { CREATE_OPTION, CREATE_KEY, pickedCreate, typedValues, createdValue, draftAfterCreate };
