import { createHash } from 'node:crypto'

export function canonicalNumber(n: number, precision: number): string {
  if (!Number.isFinite(n)) throw new Error(`canonicalNumber: not finite (${n})`)
  return n.toFixed(precision)
}

export function canonicalDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`canonicalDate: invalid (${iso})`)
  return d.toISOString()
}

export type ContentHashInput = {
  date: string; exchange: string; symbol: string
  side: 'buy' | 'sell' | 'fee'
  quantity: number; price: number; cashAmount: number
  pricePrecision: number; quantityPrecision: number
}

export function canonicalContentHash(i: ContentHashInput): string {
  const parts = [
    canonicalDate(i.date),
    i.exchange.toUpperCase(),
    i.symbol.toUpperCase(),
    i.side,
    canonicalNumber(i.quantity, i.quantityPrecision),
    canonicalNumber(i.price, i.pricePrecision),
    canonicalNumber(i.cashAmount, 4),
  ].join('|')
  return createHash('sha256').update(parts).digest('hex')
}
