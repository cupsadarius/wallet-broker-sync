/**
 * Shared logic for Tradeville parsers (HTML and PDF).
 *
 * Both formats expose the same column vocabulary; this module converts a
 * normalised row record (keyed by column name) into a CanonicalTxn or an
 * UnsupportedRow, so the mapping lives in exactly one place.
 */
import type { CanonicalTxn } from '@/src/types'
import type { UnsupportedRow } from './types'
import { canonicalContentHash } from './canonicalize'

export const TRADEVILLE_EXCHANGE_MIC = 'XBSE'
export const TRADEVILLE_CURRENCY = 'RON'

export type TradevilleRow = {
  dateRaw: string
  oper: string
  ticker: string
  pret: string
  cantitate: string
  valoare: string
  observatii: string
}

export type RowResult =
  | { ok: true; txn: CanonicalTxn }
  | { ok: false; unsupported: UnsupportedRow }

export function tradevilleRowToTxn(row: TradevilleRow): RowResult {
  const oper = row.oper.trim().toLowerCase()
  const ticker = row.ticker.trim()
  const dateRaw = row.dateRaw.trim()

  let kind: 'buy' | 'sell' | null = null
  if (oper === 'cump' || oper === 'cumparare' || oper === 'cumpărare') kind = 'buy'
  else if (oper === 'vanz' || oper === 'vânz' || oper === 'vanzare' || oper === 'vânzare') kind = 'sell'

  if (!kind) {
    return {
      ok: false,
      unsupported: {
        row: dateRaw || 'unknown',
        reason: 'non-trade row (oper="' + (oper || 'empty') + '", obs="' + row.observatii.slice(0, 80) + '")',
        raw: { oper, ticker, obs: row.observatii },
      },
    }
  }

  if (!ticker) {
    return {
      ok: false,
      unsupported: { row: dateRaw, reason: 'trade row missing ticker', raw: { row } },
    }
  }

  const date = parseTradevilleDate(dateRaw)
  if (!date) {
    return {
      ok: false,
      unsupported: {
        row: dateRaw,
        reason: 'cannot parse date "' + dateRaw + '"',
        raw: { dateRaw },
      },
    }
  }

  const price = parseRoNumber(row.pret)
  const quantity = parseRoNumber(row.cantitate)
  const cashAmount = parseRoNumber(row.valoare)

  if (!Number.isFinite(price) || !Number.isFinite(quantity) || !Number.isFinite(cashAmount)) {
    return {
      ok: false,
      unsupported: {
        row: dateRaw,
        reason: 'non-numeric price/qty/value: pret="' + row.pret + '" cant="' + row.cantitate + '" val="' + row.valoare + '"',
        raw: { row },
      },
    }
  }

  const externalId = canonicalContentHash({
    date, exchange: TRADEVILLE_EXCHANGE_MIC, symbol: ticker, side: kind,
    quantity, price, cashAmount,
    pricePrecision: 4, quantityPrecision: 6,
  })

  return {
    ok: true,
    txn: {
      externalId, broker: 'tradeville', kind,
      date,
      symbol: ticker, exchange: TRADEVILLE_EXCHANGE_MIC,
      quantity, pricePerShare: price,
      tradeCurrency: TRADEVILLE_CURRENCY, settlementCurrency: TRADEVILLE_CURRENCY,
      cashAmount,
      description: oper + ' ' + quantity + ' ' + ticker + ' @ ' + price,
      raw: { oper, ticker, pret: row.pret, cantitate: row.cantitate, valoare: row.valoare, observatii: row.observatii, date: dateRaw },
    },
  }
}

export function parseTradevilleDate(s: string): string | null {
  // Full: MM/DD/YY HH:MM:SS
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec(s)
  if (m) {
    const [, mm, dd, yy, hh, mi, ss] = m
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy)
    const iso = year + '-' + mm.padStart(2, '0') + '-' + dd.padStart(2, '0') + 'T' + hh.padStart(2, '0') + ':' + mi + ':' + ss + '.000Z'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  // Date-only: MM/DD/YY
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s)
  if (m) {
    const [, mm, dd, yy] = m
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy)
    const iso = year + '-' + mm.padStart(2, '0') + '-' + dd.padStart(2, '0') + 'T00:00:00.000Z'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

export function parseRoNumber(raw: unknown): number {
  if (raw == null) return NaN
  const s = String(raw).trim().replace(/,/g, '')
  if (!s) return NaN
  return Number(s)
}
