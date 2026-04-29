/**
 * IBKR yearly Activity Statement parser.
 *
 * The yearly format uses multiple named sections (Trades, Corporate Actions,
 * Dividends, Withholding Tax, Fees, Deposits & Withdrawals) each with its
 * OWN header row and column layout, instead of the single Transaction History
 * section used in the shorter-period format.
 *
 * Detection: the file contains `Trades,Header,DataDiscriminator,Asset Category`
 * (the multi-section Trades header) instead of the single `Transaction History,Header` row.
 */

import type { ParseResult, UnsupportedRow } from './types'
import type { CanonicalTxn } from '@/src/types'
import { canonicalContentHash } from './canonicalize'
import { micFromIbkrSymbol } from './ibkr-venues'

// ─── Public entry point ──────────────────────────────────────────────────────

export function parseYearly(rows: string[][], baseCurrency: string): ParseResult {
  const txns: CanonicalTxn[] = []
  const unsupported: UnsupportedRow[] = []

  // Walk rows, dispatching by section name
  let section = ''
  let sectionHeaders: string[] | null = null

  for (const row of rows) {
    if (row.length < 2) continue

    const sectionName = row[0]
    const discriminator = row[1]

    if (discriminator === 'Header') {
      // Each section declares its own column layout on a Header row.
      // A section may have *multiple* Header rows (e.g. Trades has one for
      // Stocks and another for Forex). We only reset when the section name
      // changes, and we skip Forex trade headers (they have a blank col 9).
      if (sectionName !== section) {
        section = sectionName
        sectionHeaders = null
      }
      // For Trades, only accept the Stocks header (col[9] = 'C. Price').
      // The Forex header has col[9] = '' and col[10] = 'Proceeds' shifted.
      if (sectionName === 'Trades') {
        const colNine = (row[9] ?? '').trim()
        if (colNine === 'C. Price') {
          sectionHeaders = row
        }
        // else: Forex header — don't overwrite the Stocks header
      } else {
        sectionHeaders = row
      }
      continue
    }

    if (discriminator !== 'Data') continue
    if (!sectionHeaders) continue

    switch (section) {
      case 'Trades':
        parseTrade(row, sectionHeaders, baseCurrency, txns, unsupported)
        break
      case 'Corporate Actions':
        parseCorporateAction(row, sectionHeaders, baseCurrency, txns, unsupported)
        break
      case 'Dividends':
        parseDividend(row, sectionHeaders, baseCurrency, txns, unsupported)
        break
      case 'Withholding Tax':
        parseWithholding(row, sectionHeaders, baseCurrency, txns, unsupported)
        break
      case 'Fees':
        parseFee(row, sectionHeaders, baseCurrency, txns, unsupported)
        break
      // Deposits & Withdrawals, Open Positions, etc. — skip
    }
  }

  return { txns, unsupported }
}

// ─── Section parsers ─────────────────────────────────────────────────────────

function parseTrade(
  row: string[],
  headers: string[],
  baseCurrency: string,
  txns: CanonicalTxn[],
  unsupported: UnsupportedRow[],
): void {
  const colOf = makeColOf(headers)

  // Only process Order rows, not SubTotal/Total
  const dataDiscriminator = (row[colOf('DataDiscriminator')] ?? '').trim()
  if (dataDiscriminator !== 'Order') return

  const assetCategory = (row[colOf('Asset Category')] ?? '').trim()
  // Skip Forex, Options, Futures — only Stocks for v1
  if (assetCategory !== 'Stocks') return

  const symbol = (row[colOf('Symbol')] ?? '').trim()
  const dateTimeStr = (row[colOf('Date/Time')] ?? '').trim()
  const quantityStr = (row[colOf('Quantity')] ?? '').trim()
  const priceStr = (row[colOf('T. Price')] ?? '').trim()
  const proceedsStr = (row[colOf('Proceeds')] ?? '').trim()
  const commStr = (row[colOf('Comm/Fee')] ?? '').trim()
  const tradeCurrency = (row[colOf('Currency')] ?? '').trim() || 'USD'

  const date = parseYearlyDate(dateTimeStr)
  if (!date) {
    unsupported.push({ row: `${dateTimeStr ?? '?'}/Trade/${symbol || '?'}`, reason: `could not parse Date/Time: "${dateTimeStr}"`, raw: { row } })
    return
  }

  const quantity = Number(quantityStr)
  const pricePerShare = Number(priceStr)
  const proceeds = Number(proceedsStr)
  const commission = Number(commStr)

  if (!Number.isFinite(quantity) || !Number.isFinite(pricePerShare) || !Number.isFinite(proceeds)) {
    unsupported.push({ row: `${dateTimeStr}/Trade/${symbol}`, reason: `non-numeric quantity/price/proceeds: qty=${quantityStr}, price=${priceStr}, proceeds=${proceedsStr}`, raw: { row } })
    return
  }

  // Signed quantity: positive = Buy, negative = Sell
  const kind: 'buy' | 'sell' = quantity >= 0 ? 'buy' : 'sell'
  const absQuantity = Math.abs(quantity)

  // cashAmount = proceeds + commission (both signed; proceeds negative for buys, comm negative always)
  const cashAmount = Number.isFinite(commission) ? proceeds + commission : proceeds

  const exchange = micFromIbkrSymbol(symbol)
  if (!exchange) {
    unsupported.push({ row: `${dateTimeStr}/${kind}/${symbol}`, reason: `IBKR symbol "${symbol}" has no MIC mapping in ibkr-venues.ts (add it)`, raw: { symbol } })
    return
  }

  const externalId = canonicalContentHash({
    date, exchange, symbol,
    side: kind,
    quantity: absQuantity, price: pricePerShare, cashAmount,
    pricePrecision: 4, quantityPrecision: 6,
  })

  const rawObj = Object.fromEntries(headers.map((h, j) => [h, row[j]]))
  txns.push({
    externalId, broker: 'ibkr',
    kind,
    date,
    symbol, exchange,
    quantity: absQuantity, pricePerShare,
    tradeCurrency, settlementCurrency: baseCurrency,
    cashAmount,
    description: `${kind === 'buy' ? 'Buy' : 'Sell'} ${absQuantity} ${symbol} @ ${pricePerShare} ${tradeCurrency}`,
    raw: rawObj,
  })
}

function parseCorporateAction(
  row: string[],
  headers: string[],
  baseCurrency: string,
  txns: CanonicalTxn[],
  unsupported: UnsupportedRow[],
): void {
  // Skip Total/subtotal-like rows
  const assetCategory = (row[2] ?? '').trim()
  if (!assetCategory || assetCategory === 'Total' || assetCategory === 'Total in EUR') return

  const colOf = makeColOf(headers)

  const description = (row[colOf('Description')] ?? '').trim()
  const dateTimeStr = (row[colOf('Date/Time')] ?? '').trim()
  const quantityStr = (row[colOf('Quantity')] ?? '').trim()
  const tradeCurrency = (row[colOf('Currency')] ?? '').trim() || 'USD'

  // Only handle splits for v1
  const splitMatch = description.match(/Split (\d+) for (\d+)/i)
  if (!splitMatch) {
    unsupported.push({
      row: `${dateTimeStr ?? '?'}/CorporateAction`,
      reason: `unsupported corporate action (non-split) for v1: "${description}"`,
      raw: { description, dateTimeStr, quantityStr },
    })
    return
  }

  const newShares = Number(splitMatch[1])
  const oldShares = Number(splitMatch[2])

  // Extract symbol from description: "NFLX(US64110L1061) Split ..."
  const symbolMatch = description.match(/^([A-Z][A-Z0-9.]*)[ (]/)
  if (!symbolMatch) {
    unsupported.push({ row: `${dateTimeStr ?? '?'}/Split`, reason: `could not extract symbol from corporate action description: "${description}"`, raw: { description } })
    return
  }
  const symbol = symbolMatch[1]

  const date = parseYearlyDate(dateTimeStr)
  if (!date) {
    unsupported.push({ row: `${dateTimeStr ?? '?'}/Split/${symbol}`, reason: `could not parse Date/Time: "${dateTimeStr}"`, raw: { row } })
    return
  }

  const quantity = Number(quantityStr)
  if (!Number.isFinite(quantity) || quantity <= 0) {
    unsupported.push({ row: `${dateTimeStr}/Split/${symbol}`, reason: `non-positive quantity in split row: "${quantityStr}"`, raw: { row } })
    return
  }

  // Include split ratio in hash so different splits on same symbol are distinguishable
  const splitTag = `split${newShares}for${oldShares}`
  const externalId = canonicalContentHash({
    date, exchange: splitTag, symbol,
    side: 'buy',
    quantity, price: 0, cashAmount: 0,
    pricePrecision: 4, quantityPrecision: 6,
  })

  const rawObj = Object.fromEntries(headers.map((h, j) => [h, row[j]]))
  txns.push({
    externalId, broker: 'ibkr',
    kind: 'buy',
    date,
    symbol,
    exchange: micFromIbkrSymbol(symbol) ?? undefined,
    quantity,
    pricePerShare: 0,
    tradeCurrency, settlementCurrency: baseCurrency,
    cashAmount: 0,
    description: `Split ${newShares} for ${oldShares}: +${quantity} ${symbol} (net new shares)`,
    raw: rawObj,
  })
}

function parseDividend(
  row: string[],
  headers: string[],
  baseCurrency: string,
  txns: CanonicalTxn[],
  unsupported: UnsupportedRow[],
): void {
  // Skip Total rows (discriminator is 'Data' but col[2] is 'Total' or 'Total in EUR')
  const col2 = (row[2] ?? '').trim()
  if (col2 === 'Total' || col2 === 'Total in EUR') return

  const colOf = makeColOf(headers)

  const tradeCurrency = (row[colOf('Currency')] ?? '').trim() || baseCurrency
  const dateStr = (row[colOf('Date')] ?? '').trim()
  const description = (row[colOf('Description')] ?? '').trim()
  const amountStr = (row[colOf('Amount')] ?? '').trim()

  const date = parseYearlyDate(dateStr)
  if (!date) {
    unsupported.push({ row: `${dateStr ?? '?'}/Dividend`, reason: `could not parse Date: "${dateStr}"`, raw: { row } })
    return
  }

  const cashAmount = Number(amountStr)
  if (!Number.isFinite(cashAmount)) {
    unsupported.push({ row: `${dateStr}/Dividend`, reason: `non-numeric amount: "${amountStr}"`, raw: { row } })
    return
  }

  const symbol = extractSymbolFromDescription(description)

  const externalId = canonicalContentHash({
    date, exchange: '', symbol: symbol ?? '',
    side: 'buy',
    quantity: 0, price: 0, cashAmount,
    pricePrecision: 4, quantityPrecision: 6,
  })

  const rawObj = Object.fromEntries(headers.map((h, j) => [h, row[j]]))
  txns.push({
    externalId, broker: 'ibkr',
    kind: 'dividend',
    date,
    symbol: symbol ?? undefined,
    tradeCurrency, settlementCurrency: baseCurrency,
    cashAmount,
    description,
    raw: rawObj,
  })
}

function parseWithholding(
  row: string[],
  headers: string[],
  baseCurrency: string,
  txns: CanonicalTxn[],
  unsupported: UnsupportedRow[],
): void {
  // Skip Total rows
  const col2 = (row[2] ?? '').trim()
  if (col2 === 'Total' || col2 === 'Total in EUR') return

  const colOf = makeColOf(headers)

  const tradeCurrency = (row[colOf('Currency')] ?? '').trim() || baseCurrency
  const dateStr = (row[colOf('Date')] ?? '').trim()
  const description = (row[colOf('Description')] ?? '').trim()
  const amountStr = (row[colOf('Amount')] ?? '').trim()

  const date = parseYearlyDate(dateStr)
  if (!date) {
    unsupported.push({ row: `${dateStr ?? '?'}/WithholdingTax`, reason: `could not parse Date: "${dateStr}"`, raw: { row } })
    return
  }

  const cashAmount = Number(amountStr)
  if (!Number.isFinite(cashAmount)) {
    unsupported.push({ row: `${dateStr}/WithholdingTax`, reason: `non-numeric amount: "${amountStr}"`, raw: { row } })
    return
  }

  const symbol = extractSymbolFromDescription(description)

  const externalId = canonicalContentHash({
    date, exchange: '', symbol: symbol ?? '',
    side: 'fee',
    quantity: 0, price: 0, cashAmount,
    pricePrecision: 4, quantityPrecision: 6,
  })

  const rawObj = Object.fromEntries(headers.map((h, j) => [h, row[j]]))
  txns.push({
    externalId, broker: 'ibkr',
    kind: 'fee',
    feeKind: 'withholding',
    date,
    symbol: symbol ?? undefined,
    tradeCurrency, settlementCurrency: baseCurrency,
    cashAmount,
    description,
    raw: rawObj,
  })
}

function parseFee(
  row: string[],
  headers: string[],
  baseCurrency: string,
  txns: CanonicalTxn[],
  unsupported: UnsupportedRow[],
): void {
  // Skip Total rows and Notes rows
  const col2 = (row[2] ?? '').trim()
  if (col2 === 'Total' || col2 === 'Total in EUR' || row[1] === 'Notes') return

  const colOf = makeColOf(headers)

  const tradeCurrency = (row[colOf('Currency')] ?? '').trim() || baseCurrency
  const dateStr = (row[colOf('Date')] ?? '').trim()
  const description = (row[colOf('Description')] ?? '').trim()
  const amountStr = (row[colOf('Amount')] ?? '').trim()

  const date = parseYearlyDate(dateStr)
  if (!date) {
    unsupported.push({ row: `${dateStr ?? '?'}/Fee`, reason: `could not parse Date: "${dateStr}"`, raw: { row } })
    return
  }

  const cashAmount = Number(amountStr)
  if (!Number.isFinite(cashAmount)) {
    unsupported.push({ row: `${dateStr}/Fee`, reason: `non-numeric amount: "${amountStr}"`, raw: { row } })
    return
  }

  const externalId = canonicalContentHash({
    date, exchange: '', symbol: '',
    side: 'fee',
    quantity: 0, price: 0, cashAmount,
    pricePrecision: 4, quantityPrecision: 6,
  })

  const rawObj = Object.fromEntries(headers.map((h, j) => [h, row[j]]))
  txns.push({
    externalId, broker: 'ibkr',
    kind: 'fee',
    feeKind: 'other-fee',
    date,
    tradeCurrency, settlementCurrency: baseCurrency,
    cashAmount,
    description,
    raw: rawObj,
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a column-index lookup for a header row.
 * The header row starts with the section name and 'Header', so real column
 * names begin at index 2. We map trimmed column name → index.
 */
function makeColOf(headers: string[]): (name: string) => number {
  const map = new Map<string, number>()
  for (let i = 2; i < headers.length; i++) {
    const h = headers[i].trim()
    if (h) map.set(h, i)
  }
  return (name: string) => map.get(name) ?? -1
}

/**
 * Parse a yearly-format date string. Two forms:
 *   "2025-11-14, 20:25:00"  — date with time (may arrive pre-unquoted by CSV parser)
 *   "2025-04-02"            — date only
 * Returns an ISO instant string (UTC) or null if unparseable.
 */
export function parseYearlyDate(raw: string): string | null {
  if (!raw) return null
  // Form 1: "YYYY-MM-DD, HH:MM:SS" (comma+space separator)
  const withTime = raw.match(/^(\d{4}-\d{2}-\d{2}),?\s+(\d{2}:\d{2}:\d{2})$/)
  if (withTime) {
    return `${withTime[1]}T${withTime[2]}.000Z`
  }
  // Form 2: "YYYY-MM-DD" only
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})$/)
  if (dateOnly) {
    return `${dateOnly[1]}T00:00:00.000Z`
  }
  return null
}

/**
 * Extract leading symbol token from IBKR description prefixes like:
 *   "NVDA(US67066G1040) Cash Dividend ..."
 *   "NFLX(US64110L1061) Split ..."
 */
function extractSymbolFromDescription(description: string): string | null {
  const m = description.match(/^([A-Z][A-Z0-9.]*)[ (]/)
  return m ? m[1] : null
}
