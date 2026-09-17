# File formats are written by hand, not by a library

Status: accepted

Until this decision the app wrote two kinds of file: Markdown and CSV. The header
of `src/exporter.js` records why there was no PDF — *"main.js is 410KB and the
smallest credible PDF engine is ~350KB, an 85% bundle increase to draw a table"* —
and `src/report.js` repeats it. Both pointed the reader at Obsidian's own
**Export to PDF** instead.

That argument was sound and is not overturned. It was an argument against
**bundling a PDF library**, and it quietly became a refusal of **PDF**. The two
are different things, and the second one had a cost nobody was counting:

- Obsidian's Export to PDF is **desktop only**. This plugin ships with
  `isDesktopOnly: false`, and the household member most likely to be asked for
  "the budget for the last three months" is as likely to be holding a phone.
- A Markdown table of fifteen columns is not something anyone sends a bank, a
  landlord or an accountant, and a CSV is not something most people can open
  with confidence. "Excel or PDF" is what people actually ask each other for.

## The decision

The budget export (`src/budget-export.js`, `src/views/budget-export.js`) writes
**PDF, XLSX and CSV**, and the first two are produced by code in this repository:

| Module | What it is | Size |
|---|---|---|
| `src/zip.js` | STORE-only ZIP writer + CRC-32 | ~240 lines |
| `src/xlsx.js` | Minimal SpreadsheetML workbook: inline strings, numeric cells, seven styles, frozen header | ~400 lines |
| `src/pdf.js` | Layout engine + two PDF serialisers | see below |
| `src/pdf-raster.js` | Canvas painter for the image fallback | ~110 lines |

No npm dependency is added. `package.json` still lists `esbuild` and nothing else,
which keeps the community scorecard's rebuild-and-compare verification exactly as
simple as it was.

This is feasible because both formats are, at the size this app needs them,
small:

- An `.xlsx` is a ZIP of XML. ZIP permits **uncompressed** entries, so no deflate
  implementation is needed — and none exists on the engine floor anyway
  (`CompressionStream` arrived in iOS 16.4; the floor is iOS 15).
- A PDF that names only the fourteen built-in fonts embeds no font program. What
  remains is a page tree, uncompressed content streams and a byte-exact xref
  table.

## The consequence that had to be designed for: text the built-in fonts cannot draw

The built-in fonts are WinAnsi — Latin script. This app ships in twelve languages
including Chinese, Japanese and Hindi, and a category name is whatever the
household typed. A "Latin only" PDF would print `食费` as question marks inside a
document that otherwise looks finished, which is the worst kind of wrong: nothing
announces it.

So `pdf.js` separates **layout** from **painting**:

- `layoutDocument(doc, { measure })` places every string, rule and band, and
  takes its text measurement as an injected function. It never reaches for a
  font metric itself.
- If `docEncodable(doc)` is true, layout is measured with Helvetica's AFM widths
  and `renderVectorPdf()` writes real, selectable text. This is the ordinary
  path and the file is a few kilobytes.
- If not, the **same layout** is measured with the canvas's own font and painted
  by `pdf-raster.js`; each page goes in as one JPEG (`canvas.toBlob('image/jpeg')`
  output *is* a valid `/DCTDecode` stream, so nothing re-encodes it). The reader
  is told, in the dialog that follows, that this PDF's text cannot be selected
  or searched. The workbook and the CSV are unaffected — both are UTF-8.

`normalizeText()` runs before the encodability check, because locale formatters
emit U+00A0 and U+202F as thousands separators; without it every export in a
non-English locale would take the image path for the sake of a space.

## Rules this creates

1. **A new output format is a new hand-written module with a guard test that
   parses its own output back**, not a dependency. `tests/zip.test.cjs`,
   `tests/xlsx.test.cjs` and `tests/pdf.test.cjs` each carry a small reader and
   assert structure (CRCs and offsets; well-formed XML parts; every xref offset
   landing on its object and every `/Length` matching its stream), and each runs
   an external validator when the machine has one.
2. **Binary output is bytes end to end.** `io.js` gains `writeVaultBinary()`
   because `vault.modify()` UTF-8-encodes: every byte above 0x7F becomes two,
   which shifts every offset a PDF's xref and a ZIP's central directory depend
   on. The file would exist, have a plausible size, and open nowhere.
3. **Output is deterministic.** No clock inside the writers — `created` is
   injected — so the same model produces the same bytes and a golden test is
   possible.
4. **One model, every rendering.** PDF, workbook and CSV are arrangements of the
   single object `buildModel()` returns; none of them derives a figure. This is
   ADR-0006's discipline applied to documents.
5. **Amounts are numbers wherever the format has numbers.** XLSX cells are
   numeric with a money style; CSV amounts bypass `csvCell`. A figure written as
   text looks identical and sums to zero — `exporter.js`'s `amountCell` documents
   the release that taught this.

## What this does not change

`exporter.js` (transactions as CSV + Markdown) and the Report page (Markdown +
JSON) are untouched, and their headers' reasoning stands for what it was about.
Exports still land **in the vault**, never as a browser download: a blob
download is unreliable in Obsidian's iOS WebView, and once a file is in the vault
the share sheet and the desktop file manager can both take it from there.

## Considered and not done

- **Bundling `pdf-lib` / `jspdf` / `exceljs` / `SheetJS`.** Each is several
  hundred kilobytes against a feature that draws tables, and each would be the
  first runtime dependency in the project.
- **SpreadsheetML 2003 (`.xls` XML).** One file, no ZIP — but Excel opens it
  behind a format warning, and Numbers and Google Sheets do not open it at all.
- **`window.print()` to the OS PDF printer.** Not available in Obsidian's mobile
  WebView, and on desktop it prints the app chrome's cascade rather than a
  document.
- **Image pages only.** One code path for every script, but no export would ever
  have selectable text, files would be a hundred times larger, and nothing about
  the PDF could be tested in bare node.
