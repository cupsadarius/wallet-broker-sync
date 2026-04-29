import type { BrokerParser, ParseResult, ParserInput, UnsupportedRow } from './types'
import type { CanonicalTxn } from '@/src/types'
import { canonicalContentHash } from './canonicalize'

const TRADEVILLE_EXCHANGE_MIC = 'XBSE'  // Bucharest Stock Exchange

export const tradeville: BrokerParser = {
  id: 'tradeville',
  displayName: 'Tradeville',
  acceptedFormats: ['html'],

  detect(input: ParserInput) {
    if (!input.filename.toLowerCase().endsWith('.html') && !input.filename.toLowerCase().endsWith('.htm')) return false
    const text = new TextDecoder('utf-8').decode(input.bytes).toLowerCase()
    // Look for the activity table header signature unique to Tradeville's export
    return text.includes('activitate') && text.includes('valoare net') && text.includes('observatii')
  },

  parse(input: ParserInput): ParseResult {
    const html = new TextDecoder('utf-8').decode(input.bytes)
    const tableHtml = findActivityTable(html)
    if (!tableHtml) throw new Error('Tradeville: activity table not found in HTML')

    const rows = extractRows(tableHtml)
    if (rows.length < 2) throw new Error('Tradeville: activity table has no data rows')

    // Header row should contain known column labels — find their indices
    const headerCells = rows[0].map(c => c.trim().toLowerCase())
    const idx = (label: string) => headerCells.findIndex(h => h.includes(label))
    const DATA = idx('data'), OPER = idx('oper'), TICKER = idx('ticker'),
          PRET = idx('pret'), CANT = idx('cantitate'),
          VALOARE = idx('valoare net'),
          OBS = idx('observatii')

    if (DATA < 0 || OPER < 0 || TICKER < 0 || PRET < 0 || CANT < 0 || VALOARE < 0) {
      throw new Error('Tradeville: activity table missing expected columns')
    }

    const txns: CanonicalTxn[] = []
    const unsupported: UnsupportedRow[] = []

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if (row.every(c => !c.trim())) continue

      const oper = (row[OPER] ?? '').trim().toLowerCase()
      const ticker = (row[TICKER] ?? '').trim()
      const obs = OBS >= 0 ? (row[OBS] ?? '').trim() : ''
      const dateRaw = (row[DATA] ?? '').trim()

      let kind: 'buy' | 'sell' | null = null
      if (oper === 'cump' || oper === 'cumparare' || oper === 'cumpărare') kind = 'buy'
      else if (oper === 'vanz' || oper === 'vânz' || oper === 'vanzare' || oper === 'vânzare') kind = 'sell'

      if (!kind) {
        unsupported.push({
          row: dateRaw || `row ${i}`,
          reason: `non-trade row (oper="${oper || 'empty'}", obs="${obs.slice(0, 80)}")`,
          raw: { oper, ticker, obs },
        })
        continue
      }

      if (!ticker) {
        unsupported.push({ row: dateRaw, reason: 'trade row missing ticker', raw: { row } })
        continue
      }

      const date = parseTradevilleDate(dateRaw)
      if (!date) {
        unsupported.push({ row: dateRaw, reason: `cannot parse date "${dateRaw}"`, raw: { dateRaw } })
        continue
      }

      const price = parseRoNumber(row[PRET])
      const quantity = parseRoNumber(row[CANT])
      const cashAmount = parseRoNumber(row[VALOARE])

      if (!Number.isFinite(price) || !Number.isFinite(quantity) || !Number.isFinite(cashAmount)) {
        unsupported.push({
          row: dateRaw,
          reason: `non-numeric price/qty/value: pret="${row[PRET]}" cant="${row[CANT]}" val="${row[VALOARE]}"`,
          raw: { row },
        })
        continue
      }

      const externalId = canonicalContentHash({
        date, exchange: TRADEVILLE_EXCHANGE_MIC, symbol: ticker, side: kind,
        quantity, price, cashAmount,
        pricePrecision: 4, quantityPrecision: 6,
      })

      txns.push({
        externalId, broker: 'tradeville', kind,
        date,
        symbol: ticker, exchange: TRADEVILLE_EXCHANGE_MIC,
        quantity, pricePerShare: price,
        tradeCurrency: 'RON', settlementCurrency: 'RON',
        cashAmount,
        description: `${oper} ${quantity} ${ticker} @ ${price}`,
        raw: Object.fromEntries(headerCells.map((h, j) => [h, row[j]])),
      })
    }

    return { txns, unsupported }
  },
}

/** Find the activity table in the HTML — the one with the Data/Oper/Ticker/Pret/Cantitate/Valoare net header. */
function findActivityTable(html: string): string | null {
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi
  let m: RegExpExecArray | null
  while ((m = tableRe.exec(html)) !== null) {
    const tableContent = m[1]
    // Cheap signature: must contain all of these column names
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

/** Extract rows (each an array of cell strings) from a <table> body HTML. */
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

/** Parse Tradeville's date format: "01/29/25 10:00:47" -> ISO UTC. */
function parseTradevilleDate(s: string): string | null {
  // MM/DD/YY HH:MM:SS - observed format. 25 means 2025; assume 20XX.
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const [, mm, dd, yy, hh, mi, ss] = m
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy)
  // Treat as Europe/Bucharest local? For now: treat as UTC. v2: timezone conversion.
  const iso = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${mi}:${ss}.000Z`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Parse Romanian-formatted number: "3,000.00" -> 3000, "26.80" -> 26.80, "-82.21" -> -82.21.
 *  Romanian display uses ',' as thousands separator and '.' as decimal - same as US in this export. */
function parseRoNumber(raw: unknown): number {
  if (raw == null) return NaN
  const s = String(raw).trim().replace(/,/g, '')
  if (!s) return NaN
  return Number(s)
}
