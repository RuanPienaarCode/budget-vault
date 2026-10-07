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

/* The first segment of a typed folder that Obsidian hides, or null.

   Obsidian indexes no path with a segment that starts with a dot — app.js
   1.13.7 calls a path hidden when ANY segment startsWith(".") and reconciles
   it as deleted — so an export written to ".trash", "Notes/.archive" or
   "x/.obsidian" is a real file that the file explorer, Open and Reveal can
   never reach (2026-10-07 audit). The config folder has its own refusal and
   wording (io.js destinationProblem asks it first); this is every other dot-folder, and it
   catches ".obsidian-notes" as well, which used to pass the config check by
   design and is just as invisible. A segment of dots only is a traversal,
   destinationProblem's to refuse, and "." means nothing — both skipped here.
   Separators read the way the writers read them: "/" and "\". */
function hiddenSegment(folder) {
  const segs = String(folder ?? '').replace(/\\/g, '/').split('/').map(s => s.trim());
  return segs.find(s => s.startsWith('.') && !/^\.+$/.test(s)) || null;
}

module.exports = { safeSeg, collapsePath, hiddenSegment };
