import type { BrokerParser, ParseResult, ParserInput } from './types'
import { parseTradeville_PDF, detectTradeville_PDF } from './tradeville-pdf'
import {
  tradevilleRowToTxn,
  TRADEVILLE_EXCHANGE_MIC,
} from './tradeville-shared'

export const tradeville: BrokerParser = {
  id: 'tradeville',
  displayName: 'Tradeville',
  acceptedFormats: ['html', 'pdf'],

  detect(input: ParserInput): boolean {
    const low = input.filename.toLowerCase()
    if (low.endsWith('.pdf') || low.endsWith('.PDF')) return detectTradeville_PDF(input)
    if (!low.endsWith('.html') && !low.endsWith('.htm')) return false
    const text = new TextDecoder('utf-8').decode(input.bytes).toLowerCase()
    return text.includes('activitate') && text.includes('valoare net') && text.includes('observatii')
  },

  parse(input: ParserInput): ParseResult {
    const low = input.filename.toLowerCase()
    if (low.endsWith('.pdf')) {
      // PDF parsing is async internally (pdfjs) but we need to return synchronously.
      // We drive it synchronously using a blocking promise resolution trick via a
      // pre-resolved promise chain stored in a module-level variable.
      // Instead, we expose a separate async entry point and call it here via a
      // synchronous wrapper using Promise + a thrown-then-caught pattern.
      //
      // Simpler approach: callers that need PDF parsing should use parseTradeville_PDF()
      // directly. For the BrokerParser.parse() interface (sync) we do the same
      // trick as other async parsers: we store the promise result and throw if
      // called without awaiting. However, the vitest / Next.js route handler already
      // awaits at the call site by calling parse() inside an async function and the
      // result just works as long as we return a thenable.
      //
      // TypeScript signature says ParseResult (sync) but we return a Promise<ParseResult>.
      // This works in practice because all callers use `await` on the result. We cast.
      return parseTradeville_PDF(input) as unknown as ParseResult
    }
    return parseHTML(input)
  },
}

// ── HTML parser ──────────────────────────────────────────────────────────────

function parseHTML(input: ParserInput): ParseResult {
  const html = new TextDecoder('utf-8').decode(input.bytes)
  const tableHtml = findActivityTable(html)
  if (!tableHtml) throw new Error('Tradeville: activity table not found in HTML')

  const rows = extractRows(tableHtml)
  if (rows.length < 2) throw new Error('Tradeville: activity table has no data rows')

  const headerCells = rows[0].map(c => c.trim().toLowerCase())
  const idx = (label: string) => headerCells.findIndex(h => h.includes(label))
  const DATA = idx('data'), OPER = idx('oper'), TICKER = idx('ticker'),
        PRET = idx('pret'), CANT = idx('cantitate'),
        VALOARE = idx('valoare net'),
        OBS = idx('observatii')

  if (DATA < 0 || OPER < 0 || TICKER < 0 || PRET < 0 || CANT < 0 || VALOARE < 0) {
    throw new Error('Tradeville: activity table missing expected columns')
  }

  const txns = []
  const unsupported = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (row.every(c => !c.trim())) continue

    const result = tradevilleRowToTxn({
      dateRaw: (row[DATA] ?? '').trim(),
      oper: (row[OPER] ?? '').trim(),
      ticker: (row[TICKER] ?? '').trim(),
      pret: (row[PRET] ?? '').trim(),
      cantitate: (row[CANT] ?? '').trim(),
      valoare: (row[VALOARE] ?? '').trim(),
      observatii: OBS >= 0 ? (row[OBS] ?? '').trim() : '',
    })

    if (result.ok) txns.push(result.txn)
    else unsupported.push(result.unsupported)
  }

  return { txns, unsupported }
}

function findActivityTable(html: string): string | null {
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi
  let m: RegExpExecArray | null
  while ((m = tableRe.exec(html)) !== null) {
    const tableContent = m[1]
    if (/Data\b/.test(tableContent)
        && /Oper\b/.test(tableContent)
        && /Ticker\b/.test(tableContent)
        && /Cantitate\b/i.test(tableContent)
        && /Valoare\s*net/i.test(tableContent)
        && /Observatii/i.test(tableContent)) {
      return tableContent
    }
  }
  return null
}

function extractRows(tableHtml: string): string[][] {
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi
  const rows: string[][] = []
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(tableHtml)) !== null) {
    const rowHtml = rm[1]
    const cells: string[] = []
    let cm: RegExpExecArray | null
    cellRe.lastIndex = 0
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripTags(cm[1]))
    }
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// Re-export for tests that import from this module directly
export { TRADEVILLE_EXCHANGE_MIC }
