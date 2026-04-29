/**
 * Tradeville PDF parser.
 *
 * Accepts the browser-print PDF export from Tradeville's Activity report
 * (https://portal.tradeville.ro/rapoarte/raport.htm?cmd=activit).
 *
 * The PDF has a real text layer (confirmed via pdfjs-dist: 732 text items
 * across 2 pages). Each page has a header row at a known y-coordinate;
 * data rows follow below it.
 *
 * Algorithm:
 *   1. Extract all text items (x, y, text, page) via pdfjs-dist.
 *   2. Verify layout anchors; throw "layout drift" if missing.
 *   3. Filter out title, header, and footer bands.
 *   4. Cluster remaining items into logical rows by y-band (±ROW_Y_TOL).
 *   5. For each cluster, assign items to columns by x range.
 *   6. Merge multi-line rows: some transactions span 2 y-values
 *      (date on top, time 12pt below; observations may wrap).
 *   7. Call tradevilleRowToTxn() (shared with HTML parser) for each row.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { ParseResult, ParserInput } from './types'
import {
  ANCHORS, COL, COL_EDGE, ROW_Y_TOL, HEADER_BAND,
  PAGE_HEADER_Y, PAGE_FOOTER_Y, PAGE_TITLE_Y,
} from './tradeville-layout'
import { tradevilleRowToTxn } from './tradeville-shared'

type TextItem = { page: number; x: number; y: number; text: string }

export async function parseTradeville_PDF(input: ParserInput): Promise<ParseResult> {
  const items = await extractItems(input.bytes)
  verifyAnchors(items)
  const rows = buildRows(items)
  return convertRows(rows)
}

export function detectTradeville_PDF(input: ParserInput): boolean {
  if (!input.filename.toLowerCase().endsWith('.pdf')) return false
  // Quick sniff: check for the pdfjs-readable magic bytes (already guaranteed by .pdf
  // extension in most cases). We do a cheap synchronous check on the first 5 bytes.
  const header = String.fromCharCode(...input.bytes.slice(0, 5))
  return header === '%PDF-'
}

// ── Text extraction ──────────────────────────────────────────────────────────

async function extractItems(bytes: Uint8Array): Promise<TextItem[]> {
  const pdf = await getDocument({ data: bytes }).promise
  const items: TextItem[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    for (const raw of content.items as Array<{ str: string; transform: number[] }>) {
      const text = raw.str
      const x = Math.round(raw.transform[4])
      const y = Math.round(raw.transform[5])
      items.push({ page: p, x, y, text })
    }
  }
  return items
}

// ── Layout validation ────────────────────────────────────────────────────────

function verifyAnchors(items: TextItem[]): void {
  const missing: string[] = []
  for (const anchor of ANCHORS) {
    const found = items.some(
      it => it.page === anchor.page
        && it.text.trim() === anchor.text
        && Math.abs(it.x - anchor.x) <= anchor.xTol
        && Math.abs(it.y - anchor.y) <= anchor.yTol
    )
    if (!found) missing.push(anchor.text)
  }
  if (missing.length > 0) {
    throw new Error(
      'Tradeville PDF layout drift — re-inspect with pdf:dump. ' +
      'Missing anchors: ' + missing.join(', ')
    )
  }
}

// ── Row clustering ───────────────────────────────────────────────────────────

type ColKey = keyof typeof COL
type RowCluster = { page: number; topY: number; cells: Partial<Record<ColKey, string>> }

function buildRows(items: TextItem[]): RowCluster[] {
  // Step 1: discard items that fall in title / header / footer bands
  const data = items.filter(it => {
    const headerY = PAGE_HEADER_Y[it.page]
    const footerY = PAGE_FOOTER_Y[it.page]
    const titleY = PAGE_TITLE_Y[it.page]
    if (!headerY) return false                            // unknown page — skip
    if (it.y >= titleY) return false                     // page title / run date
    if (Math.abs(it.y - headerY) <= HEADER_BAND) return false  // column header row
    if (it.y <= footerY) return false                    // footer / summary
    if (!it.text.trim()) return false                    // blank
    return true
  })

  // Step 2: cluster by (page, approximate y)
  // A "primary" y is the first y seen in each cluster.
  const clusters: Array<{ page: number; ys: Set<number>; topY: number; items: TextItem[] }> = []

  for (const it of data) {
    const existing = clusters.find(
      c => c.page === it.page && [...c.ys].some(cy => Math.abs(cy - it.y) <= ROW_Y_TOL)
    )
    if (existing) {
      existing.ys.add(it.y)
      existing.items.push(it)
    } else {
      clusters.push({ page: it.page, ys: new Set([it.y]), topY: it.y, items: [it] })
    }
  }

  // Step 3: merge sub-rows that belong to the same transaction.
  // Tradeville splits each transaction across ~2 y-values:
  //   - primary y: date, oper, ticker, pret, cantitate, comision, valoare, taxa
  //   - secondary y (≈ primary - 12..14): time component of date, and wrapped observatii lines
  // We merge a cluster into the previous one if:
  //   - same page
  //   - gap between them is <= 30 pts (normal row spacing is 26 pts)
  //   - the secondary cluster has no OPER item (it's continuation lines, not a new transaction)

  // Sort clusters: page ASC, topY DESC (top of page first)
  clusters.sort((a, b) => a.page - b.page || b.topY - a.topY)

  const merged: Array<{ page: number; topY: number; items: TextItem[] }> = []
  for (const c of clusters) {
    if (merged.length === 0) { merged.push(c); continue }
    const prev = merged[merged.length - 1]
    const gap = prev.topY - c.topY
    const hasOper = c.items.some(it => assignCol(it.x) === 'OPER')
    if (prev.page === c.page && gap <= 30 && !hasOper) {
      // Continuation — merge into previous
      prev.items.push(...c.items)
      prev.topY = Math.max(prev.topY, c.topY)
    } else {
      merged.push(c)
    }
  }

  // Step 4: for each merged cluster assign items to columns
  return merged.map(c => {
    const cells: Partial<Record<ColKey, string>> = {}
    for (const it of c.items) {
      const col = assignCol(it.x)
      if (!col) continue
      const existing = cells[col]
      if (!existing) {
        cells[col] = it.text.trim()
      } else {
        // Append (e.g. multi-line observatii) with a space
        cells[col] = (existing + ' ' + it.text).trim()
      }
    }
    return { page: c.page, topY: c.topY, cells }
  })
}

function assignCol(x: number): ColKey | null {
  for (const [name, left] of Object.entries(COL) as Array<[ColKey, number]>) {
    const right = COL_EDGE[name]
    if (x >= left && x < right) return name
  }
  return null
}

// ── Row conversion ────────────────────────────────────────────────────────────

function convertRows(rows: RowCluster[]): ParseResult {
  const txns = []
  const unsupported = []
  for (const row of rows) {
    // Build date string: DATA column has date; if time was on a secondary line it
    // ends up in the same DATA cell via the append logic above.
    const dateCell = (row.cells.DATA ?? '').trim()
    const operCell = (row.cells.OPER ?? '').trim()
    if (!operCell) continue  // merged continuation lines with no oper → skip

    // Combine date + time if they were split: "01/29/25" + "10:00:47" → "01/29/25 10:00:47"
    // (the time part comes from the secondary y line, also in DATA column)
    const dateRaw = dateCell  // already merged via the append logic

    const result = tradevilleRowToTxn({
      dateRaw,
      oper: operCell,
      ticker: (row.cells.TICKER ?? '').trim(),
      pret: (row.cells.PRET ?? '').trim(),
      cantitate: (row.cells.CANTITATE ?? '').trim(),
      valoare: (row.cells.VALOARE ?? '').trim(),
      observatii: (row.cells.OBSERVATII ?? '').trim(),
    })
    if (result.ok) txns.push(result.txn)
    else unsupported.push(result.unsupported)
  }
  return { txns, unsupported }
}
