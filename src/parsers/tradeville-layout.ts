/**
 * Tradeville PDF layout constants — derived from pdf-dump of sources/tradeville.pdf
 * (732 text items extracted via pdfjs-dist).
 *
 * The PDF is a 2-page browser-print export from
 * https://portal.tradeville.ro/rapoarte/raport.htm?cmd=activit
 *
 * Column geometry was read from the header row at y≈662 (page 1) / y≈791 (page 2).
 * Each column's x is the left edge of its header text item.
 *
 * Data rows share the same x alignment as the headers. A single logical
 * transaction occupies two y-values ~12 pts apart: the top line has the date
 * and main row data; the bottom line carries the time (at the DATA x).
 */

/** Anchor strings that must appear at known (page, x±xTol, y±yTol) positions
 *  before parsing proceeds. If any is missing the parser throws a clear
 *  "layout drift" error instead of silently producing wrong data. */
export type Anchor = { text: string; page: number; x: number; y: number; xTol: number; yTol: number }

export const ANCHORS: Anchor[] = [
  // Page 1 header row anchors (y=662 on page 1)
  { text: 'Activitate', page: 1, x: 48, y: 727, xTol: 10, yTol: 8 },
  { text: 'Cantitate',  page: 1, x: 235, y: 662, xTol: 10, yTol: 8 },
  { text: 'Comision',   page: 1, x: 279, y: 662, xTol: 10, yTol: 8 },
]

/**
 * Left-edge x-coordinates of each column, read from the PDF header row.
 * The column assignment uses a threshold: a text item at x belongs to the
 * column whose left edge is closest to x from the left (x >= col.x - tolerance).
 *
 * Column boundaries (midpoints between headers):
 *   DATA      x=47   → up to ~90
 *   OPER      x=93   → up to ~135
 *   TICKER    x=138  → up to ~193  (values right-justified, ending ~190; pret starts ~195)
 *   PRET      x=209  → up to ~232  (values right-justify to ~226; min observed x=195)
 *   CANTITATE x=235  → up to ~277
 *   COMISION  x=279  → up to ~329
 *   VALOARE   x=332  → up to ~363
 *   PROFITLOSS x=366 → up to ~421
 *   IMPOZIT   x=424  → up to ~476
 *   TAXA_PIATA x=478 → up to ~500
 *   OBSERVATII x=503 → end
 */
export const COL = {
  DATA:        47,
  OPER:        93,
  TICKER:     138,
  PRET:       194,  // header 'Pret' at x=209 but values right-justify to x≈195-226
  CANTITATE:  235,
  COMISION:   279,
  VALOARE:    318,  // header 'Valoare' at x=332 but values start at x≈320 (right-justified)
  PROFITLOSS: 366,
  IMPOZIT:    424,
  TAXA_PIATA: 478,
  OBSERVATII: 503,
} as const

/**
 * Column boundary edges (right edge of each column's region).
 * An item at x is assigned to column C if COL[C] <= x < COL_EDGE[C].
 */
export const COL_EDGE: Record<keyof typeof COL, number> = {
  DATA:        90,
  OPER:       135,
  TICKER:     194,  // real ticker values end by x≈190; pret values start at x≈195
  PRET:       233,
  CANTITATE:  277,
  COMISION:   318,  // comision values always at x=297; valoare starts at x≈320
  VALOARE:    364,
  PROFITLOSS: 422,
  IMPOZIT:    476,
  TAXA_PIATA: 501,
  OBSERVATII: 9999,
}

/** y-tolerance for grouping text items into the same logical row (pts). */
export const ROW_Y_TOL = 3

/** y-band around a header row — items at abs(y - headerY) <= this are part of the header. */
export const HEADER_BAND = 12

/** Known header y-values per page (top y of the header band). */
export const PAGE_HEADER_Y: Record<number, number> = {
  1: 662,
  2: 791,
}

/** Footer / summary rows appear below this y on their respective pages. */
export const PAGE_FOOTER_Y: Record<number, number> = {
  1: 40,
  2: 230,
}

/** Top margin above which items are page headers / titles (not data). */
export const PAGE_TITLE_Y: Record<number, number> = {
  1: 680,
  2: 810,
}
