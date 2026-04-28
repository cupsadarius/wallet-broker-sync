/**
 * Tradeville PDF layout constants — Task 19 phase-0 capture.
 *
 * BLOCKED: The Tradeville PDF export at sources/tradeville.pdf is an
 * image-only PDF (no text layer). Both pages consist entirely of JPEG
 * image XObjects (/I0 Do, /I1 Do) placed on a blank canvas. pdfjs-dist
 * returns 0 text items for each page, confirmed by raw stream inspection
 * (the only content streams are 107 and 124 bytes — just image placement
 * operators with no BT/ET text blocks).
 *
 * Resolution options before Task 20 can proceed:
 *   1. Re-export from Tradeville as a "true" PDF (not a print-to-PDF of
 *      a screenshot) — some brokers offer a data export separate from the
 *      print view.
 *   2. Run an OCR pass (e.g. Tesseract via pdf2image) to synthesise a
 *      text layer, then re-run pdf-dump.ts.
 *   3. Switch to a CSV/XLS export if Tradeville offers one.
 *
 * The constants below are scaffolding-only placeholders. Fill them in
 * once a PDF with a real text layer is available.
 */

/** Anchor strings that must appear at known (page, x±xTol, y±yTol) positions
 *  before parsing proceeds. If any is missing, the parser fails with a clear
 *  "layout drift" message instead of silently producing wrong data. */
export type Anchor = { text: string; page: number; x: number; y: number; xTol: number; yTol: number }

export const ANCHORS: Anchor[] = [
  // TODO: fill from pdf-dump once a text-layer PDF is available.
  // Expected Romanian headers: Simbol, Cantitate, Pret, Cumparare, Vanzare.
  // { text: 'Simbol',    page: 1, x: 110, y: 700, xTol: 20, yTol: 10 },
  // { text: 'Cantitate', page: 1, x: 240, y: 700, xTol: 20, yTol: 10 },
  // { text: 'Pret',      page: 1, x: 380, y: 700, xTol: 20, yTol: 10 },
]

/** x-coordinate centerlines (or left edges) of each column. The parser uses
 *  these to decide which column a text item belongs to based on its x. */
export const COLUMNS: Record<string, number> = {
  // TODO: fill from pdf-dump once a text-layer PDF is available.
  // type: 0,        // 'Cumparare' / 'Vanzare'
  // symbol: 110,
  // quantity: 240,
  // price: 380,
  // total: 460,
  // date: 0,
}

/** Approximate y delta between consecutive data rows. */
export const ROW_HEIGHT = 14   // placeholder — adjust from real dump

/** y-coord (or band) of the header row per page; data rows are at y < HEADER_Y. */
export const HEADER_Y = 700    // placeholder — adjust from real dump
