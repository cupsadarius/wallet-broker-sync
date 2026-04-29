import type { BrokerParser, ParseResult, UnsupportedRow } from './types'
import type { CanonicalTxn } from '@/src/types'
import { canonicalContentHash } from './canonicalize'
import { micFromIbkrSymbol } from './ibkr-venues'
import { parseYearly } from './ibkr-yearly'

/** True if the CSV has the multi-section yearly format (Trades,Header,DataDiscriminator,...) */
function isYearlyFormat(text: string): boolean {
  return /^Trades,Header,DataDiscriminator,Asset Category/m.test(text)
}

export const ibkr: BrokerParser = {
  id: 'ibkr',
  displayName: 'Interactive Brokers',
  acceptedFormats: ['csv'],

  detect(input) {
    if (!input.filename.toLowerCase().endsWith('.csv')) return false
    const text = new TextDecoder('utf-8').decode(input.bytes)
    // Accept both the multi-section yearly format and the shorter Transaction History format.
    if (isYearlyFormat(text)) return true
    // IBKR Activity Statement CSVs have a 'Statement,Data,Title,Transaction History' marker
    // and a 'Transaction History,Header,Date,Account,Description,...' header row.
    return /^Statement,(?:Header|Data)/m.test(text)
        && /^Transaction History,Header,Date,Account,Description,Transaction Type/m.test(text)
  },

  parse(input): ParseResult {
    const text = new TextDecoder('utf-8').decode(input.bytes)
    const rows = parseCsvLines(text)

    // Find base currency (common to both formats)
    const baseCurrencyRow = rows.find(r =>
      (r[0] === 'Summary' || r[0] === 'Account Information') && r[1] === 'Data' && r[2] === 'Base Currency'
    )
    const baseCurrency = baseCurrencyRow?.[3] ?? 'EUR'

    if (isYearlyFormat(text)) {
      return parseYearly(rows, baseCurrency)
    }

    return parseTransactionHistory(rows, baseCurrency)
  },
}

function parseTransactionHistory(rows: string[][], baseCurrency: string): ParseResult {
    // Find Transaction History header row to get column indices (defensive — column order has shifted across IBKR versions)
    const txnHeaderIdx = rows.findIndex(r => r[0] === 'Transaction History' && r[1] === 'Header' && r[2] === 'Date')
    if (txnHeaderIdx < 0) throw new Error('IBKR: Transaction History header row not found')

    const headers = rows[txnHeaderIdx]
    // Column indices are offset by 2 (section + Header/Data prefix)
    const colOf = (name: string) => headers.findIndex((h, i) => i >= 2 && h.trim() === name)
    const DATE = colOf('Date'), DESC = colOf('Description'),
          TYPE = colOf('Transaction Type'), SYMBOL = colOf('Symbol'),
          QTY = colOf('Quantity'), PRICE = colOf('Price'),
          PRICE_CCY = colOf('Price Currency'), NET = colOf('Net Amount')

    const txns: CanonicalTxn[] = []
    const unsupported: UnsupportedRow[] = []

    for (let i = txnHeaderIdx + 1; i < rows.length; i++) {
      const row = rows[i]
      if (row[0] !== 'Transaction History' || row[1] !== 'Data') continue

      const type = (row[TYPE] ?? '').trim()
      const symbol = (row[SYMBOL] ?? '').trim()
      const description = (row[DESC] ?? '').trim()
      const dateStr = (row[DATE] ?? '').trim()

      // Skip internal IBKR bookkeeping entries entirely (no canonical representation)
      if (type === 'Adjustment' || type === 'Forex Trade Component') {
        unsupported.push({
          row: `${dateStr ?? '?'}/${type}/${symbol || '?'}`,
          reason: `skipped IBKR Transaction Type (internal bookkeeping): "${type}"`,
          raw: { type, symbol, description },
        })
        continue
      }

      // IBKR date is "2026-04-02" — append T00:00:00.000Z to make it a valid ISO instant
      const date = dateStr ? `${dateStr}T00:00:00.000Z` : null
      if (!date) { unsupported.push({ row: i + 1, reason: 'missing Date', raw: { row } }); continue }

      const rawObj = Object.fromEntries(headers.map((h, j) => [h, row[j]]))

      // ── Dividend ─────────────────────────────────────────────────────────────
      if (type === 'Dividend') {
        const cashAmount = Number((row[NET] ?? '').trim())
        const tradeCurrency = (row[PRICE_CCY] ?? '').trim() || baseCurrency
        if (!Number.isFinite(cashAmount)) {
          unsupported.push({ row: `${dateStr}/Dividend/${symbol}`, reason: `IBKR Dividend row has non-numeric net amount: ${row[NET]}`, raw: rawObj })
          continue
        }
        const externalId = canonicalContentHash({
          date, exchange: '', symbol: symbol || '',
          side: 'buy',  // 'buy' as a stand-in; dividends are always inflows
          quantity: 0, price: 0, cashAmount,
          pricePrecision: 4, quantityPrecision: 6,
        })
        txns.push({
          externalId, broker: 'ibkr',
          kind: 'dividend',
          date,
          symbol: symbol || undefined,
          tradeCurrency: tradeCurrency || baseCurrency,
          settlementCurrency: baseCurrency,
          cashAmount,
          description,
          raw: rawObj,
        })
        continue
      }

      // ── Fees / withholdings / taxes ───────────────────────────────────────────
      if (type === 'Foreign Tax Withholding' || type === 'Other Fee' || type === 'Sales Tax') {
        const cashAmount = Number((row[NET] ?? '').trim())
        if (!Number.isFinite(cashAmount)) {
          unsupported.push({ row: `${dateStr}/${type}/${symbol}`, reason: `IBKR fee row has non-numeric net amount: ${row[NET]}`, raw: rawObj })
          continue
        }
        const feeKind =
          type === 'Foreign Tax Withholding' ? 'withholding' as const :
          type === 'Sales Tax' ? 'sales-tax' as const :
          'other-fee' as const
        const externalId = canonicalContentHash({
          date, exchange: '', symbol: symbol || '',
          side: 'fee',
          quantity: 0, price: 0, cashAmount,
          pricePrecision: 4, quantityPrecision: 6,
        })
        txns.push({
          externalId, broker: 'ibkr',
          kind: 'fee',
          feeKind,
          date,
          symbol: symbol || undefined,
          settlementCurrency: baseCurrency,
          cashAmount,
          description,
          raw: rawObj,
        })
        continue
      }

      // ── Buy / Sell ────────────────────────────────────────────────────────────
      if (type !== 'Buy' && type !== 'Sell') {
        unsupported.push({
          row: `${dateStr}/${type || '?'}/${symbol || '?'}`,
          reason: `unsupported IBKR Transaction Type for v1: "${type}"`,
          raw: { type, symbol, description },
        })
        continue
      }

      const quantity = Number((row[QTY] ?? '').trim())
      const pricePerShare = Number((row[PRICE] ?? '').trim())
      const tradeCurrency = (row[PRICE_CCY] ?? '').trim() || 'USD'
      const cashAmount = Number((row[NET] ?? '').trim())

      if (!Number.isFinite(quantity) || !Number.isFinite(pricePerShare) || !Number.isFinite(cashAmount)) {
        unsupported.push({
          row: `${dateStr}/${type}/${symbol}`,
          reason: `IBKR row has non-numeric quantity/price/net: qty=${row[QTY]}, price=${row[PRICE]}, net=${row[NET]}`,
          raw: { row },
        })
        continue
      }

      const exchange = micFromIbkrSymbol(symbol)
      if (!exchange) {
        unsupported.push({
          row: `${dateStr}/${type}/${symbol}`,
          reason: `IBKR symbol "${symbol}" has no MIC mapping in ibkr-venues.ts (add it)`,
          raw: { symbol },
        })
        continue
      }

      // Stable content hash since IBKR Statement CSV has no broker txn id.
      const externalId = canonicalContentHash({
        date, exchange, symbol,
        side: type === 'Buy' ? 'buy' : 'sell',
        quantity, price: pricePerShare, cashAmount,
        pricePrecision: 4, quantityPrecision: 6,
      })

      txns.push({
        externalId, broker: 'ibkr',
        kind: type === 'Buy' ? 'buy' : 'sell',
        date,
        symbol, exchange,
        quantity, pricePerShare,
        tradeCurrency, settlementCurrency: baseCurrency,
        cashAmount,  // Net Amount is in base currency per IBKR Activity Statement
        description,
        raw: rawObj,
      })
    }

    return { txns, unsupported }
}

/**
 * Minimal CSV parser handling: quoted fields with embedded commas/newlines,
 * escaped quotes ("" → "), CRLF/LF line endings.
 * IBKR's CSV has quoted strings with commas (e.g. dates, descriptions).
 */
function parseCsvLines(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') {
        row.push(field); field = ''
        if (row.length > 1 || row[0] !== '') out.push(row)
        row = []
      } else if (c === '\r') {
        // ignore; \n will close the row
      } else field += c
    }
  }
  // last field/row if no trailing newline
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') out.push(row)
  }
  return out
}
