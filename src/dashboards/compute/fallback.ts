import type { MirrorAsset, MirrorAssetTransaction, MirrorRecord } from '../mirror'

export type TradeNote = {
  side: 'buy' | 'sell'
  quantity: number
  symbol: string
  price: number
  currency: string
}

// Format written by toRecordDocFromTrade in src/sync/record-mapper.ts; keep both in step.
const NOTE = /^(Buy|Sell) (\d+(?:\.\d+)?) (\S+) @ (\d+(?:\.\d+)?) ([A-Z]{3})\b/

export function parseTradeNote(note: string): TradeNote | null {
  const m = NOTE.exec(note)
  if (!m) return null
  return {
    side: m[1] === 'Buy' ? 'buy' : 'sell',
    quantity: Number(m[2]),
    symbol: m[3],
    price: Number(m[4]),
    currency: m[5],
  }
}

/**
 * Synthetic asset transactions for trades that Wallet holds as Records
 * (e.g. Tradeville XBSE), so computeHoldings and computePerformance cover them.
 */
export function fallbackTrades(
  records: MirrorRecord[],
  exchangeOf: (symbol: string) => string,
): { transactions: MirrorAssetTransaction[]; assets: MirrorAsset[] } {
  const transactions: MirrorAssetTransaction[] = []
  const assets = new Map<string, MirrorAsset>()
  for (const r of records) {
    if (!r.isTradeFallback || !r.note) continue
    const t = parseTradeNote(r.note)
    if (!t) continue
    const exchangeCode = exchangeOf(t.symbol)
    const assetId = `fallback:${exchangeCode}:${t.symbol}`
    assets.set(assetId, { id: assetId, symbol: t.symbol, exchangeCode, currencyCode: t.currency })
    transactions.push({
      id: r.id,
      accountId: r.accountId,
      assetId,
      transactionType: t.side === 'buy' ? 0 : 1,
      date: r.recordDate,
      quantity: t.quantity,
      price: t.price * 100,
      priceCurrencyCode: t.currency,
    })
  }
  return { transactions, assets: [...assets.values()] }
}
