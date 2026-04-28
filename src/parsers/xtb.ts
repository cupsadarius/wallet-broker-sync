import * as XLSX from 'xlsx'
import type { BrokerParser, ParseResult, ParserInput, UnsupportedRow } from './types'
import type { CanonicalTxn } from '@/src/types'
import { micFromXtbSymbol } from './xtb-venues'

const SHEET_CASH = 'CASH OPERATION HISTORY'
const COMMENT_RE = /^OPEN (BUY|SELL) (\d+(?:\.\d+)?) @ (\d+(?:\.\d+)?)$/

export const xtb: BrokerParser = {
  id: 'xtb',
  displayName: 'XTB',
  acceptedFormats: ['xlsx'],

  detect(input) {
    if (!input.filename.toLowerCase().endsWith('.xlsx')) return false
    try {
      const wb = XLSX.read(input.bytes, { type: 'array' })
      // Tolerate trailing/leading whitespace in sheet names — XTB has shipped variations
      // (e.g. 'PENDING ORDERS HISTORY ' with trailing space).
      return wb.SheetNames.some(n => n.trim() === SHEET_CASH)
    } catch { return false }
  },

  parse(input: ParserInput): ParseResult {
    const wb = XLSX.read(input.bytes, { type: 'array' })
    const sheetName = wb.SheetNames.find(n => n.trim() === SHEET_CASH)
    if (!sheetName) throw new Error(`XTB: sheet "${SHEET_CASH}" not found`)
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]

    let headerRow = -1
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].map(c => (c == null ? '' : String(c)).trim()).filter(Boolean)
      if (cells[0] === 'ID' && cells.includes('Type') && cells.includes('Time')) { headerRow = i; break }
    }
    if (headerRow < 0) throw new Error('XTB: header row not found')

    const headers = rows[headerRow].map(c => (c == null ? '' : String(c)).trim())
    const idx = (name: string) => headers.indexOf(name)
    const ID = idx('ID'), TYPE = idx('Type'), TIME = idx('Time'),
          COMMENT = idx('Comment'), SYMBOL = idx('Symbol'), AMOUNT = idx('Amount')

    const txns: CanonicalTxn[] = []
    const unsupported: UnsupportedRow[] = []

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every(c => c == null || c === '')) continue
      const type = String(row[TYPE] ?? '').trim()
      if (type !== 'Stock purchase' && type !== 'Stock sale') {
        unsupported.push({
          row: row[ID] != null ? String(row[ID]) : i + 1,
          reason: `unsupported XTB type for v1: "${type}"`,
          raw: Object.fromEntries(headers.map((h, j) => [h, row[j]])),
        })
        continue
      }
      const id = row[ID] != null ? String(row[ID]) : null
      if (!id) { unsupported.push({ row: i + 1, reason: 'missing ID', raw: { row } }); continue }
      const comment = String(row[COMMENT] ?? '')
      const m = COMMENT_RE.exec(comment)
      if (!m) { unsupported.push({ row: id, reason: `cannot parse Comment "${comment}"`, raw: { comment } }); continue }
      const side: 'buy' | 'sell' = m[1] === 'BUY' ? 'buy' : 'sell'
      const symbol = String(row[SYMBOL] ?? '').trim()
      const venue = micFromXtbSymbol(symbol)
      if (!venue) { unsupported.push({ row: id, reason: `unknown XTB symbol suffix: "${symbol}"`, raw: { symbol } }); continue }
      const time = row[TIME]
      const date = excelSerialToIso(typeof time === 'number' ? time : Number(time))
      if (!date) { unsupported.push({ row: id, reason: `bad time field: "${time}"`, raw: { time } }); continue }

      txns.push({
        externalId: id, broker: 'xtb', kind: side,
        date,
        symbol: venue.bareSymbol, exchange: venue.mic,
        quantity: Number(m[2]), pricePerShare: Number(m[3]),
        tradeCurrency: 'EUR', settlementCurrency: 'EUR',
        cashAmount: Number(row[AMOUNT]),
        description: comment,
        raw: Object.fromEntries(headers.map((h, j) => [h, row[j]])),
      })
    }
    return { txns, unsupported }
  },
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null
  return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString()
}
