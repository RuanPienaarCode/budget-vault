/* The host APIs a pure module may lean on — read by tests/pure-types.test.cjs.

   "Pure" in this repo means "runs in bare node under a guard test AND parses on
   iOS 15 WebKit". The checker sees only ES2021 by default, which is narrower
   than that: a global present on BOTH hosts is fair game, and belongs here.
   One that exists on only one of them (document, window, Buffer, process) does
   not — adding it here would let a module pass this test and then throw on the
   host that lacks it.

   Keep each entry to the surface actually used, so the declaration cannot
   quietly bless more than it was added for. */

/* statement.js decodes UTF-16 and BOM-prefixed UTF-8 bank exports.
   Node 11+, Safari 10.1+. */
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}

/* exporter.js and zip.js encode the text they write into .xlsx/.zip bytes.
   Node 11+, Safari 10.1+. */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
