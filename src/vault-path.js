'use strict';
/* Turning a name into a path segment, safely and CONSISTENTLY.

   The consistency matters more than the safety here: a transactions file is
   looked up in memory by a key and written to a path, and if the two are
   derived differently the lookup can miss while the write still lands on the
   existing file — rebuilding that month from scratch, holding only the new
   rows. One canonicaliser, used by both sides.

   Pure — no DOM, no obsidian import. */

/* Sanitise a string for safe use as a single path segment (folder/file name):
   strip path separators and filesystem-illegal characters, and neutralise
   "../" traversal attempts (dot runs, leading dots).

   This is also the ONE canonicaliser for path segments, and that matters more
   than the sanitising. A transactions file is looked up in memory by a key and
   written to a path; if the two are derived by different functions the lookup
   can miss while the write still lands on the existing file — which rebuilds
   that month from scratch, holding only the new rows. So:
     - NFC, because Obsidian's normalizePath folds to NFC on the way to disk. A
       decomposed "ë" (what macOS/iCloud hands you) would otherwise key one way
       and write another.
     - NBSP variants folded to a plain space, for the same reason.
     - Control chars and bidi overrides removed: invisible in a filename, and
       the bidi ones let "IT3b<RLO>fdp.exe" render as "IT3bexe.pdf".
     - Trailing dots/spaces stripped and Windows device names suffixed, because
       the OS silently rewrites both and every later lookup then misses. */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function safeSeg(s) {
  const out = (s ?? '').toString()
    .normalize('NFC')
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^\.+/, '')
    .trim()
    .replace(/[. ]+$/, '');
  return WIN_RESERVED.test(out) ? `${out}-` : out;
}

/* Collapse '.' and '..' segments in a '/'-path; returns null if it escapes the
   root (more '..' than depth). Used to verify a write stays inside the folder. */
function collapsePath(p) {
  const out = [];
  for (const seg of (p || '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); }
    else out.push(seg);
  }
  return out.join('/');
}

module.exports = { safeSeg, collapsePath };
