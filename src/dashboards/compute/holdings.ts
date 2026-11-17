/**
 * Pure compute: average-cost-basis holdings from raw asset transactions.
 *
 * Average cost (not FIFO) is the right choice here because:
 *   - Couch's AssetTransaction docs don't carry lot identity, so FIFO would
 *     require synthetic lot assignment.
 *   - EU tax regimes (the user's relevant set) use average cost as the
 *     default basis for non-realized-gain reporting.
 *
 * Storage convention from `src/sync/mapper.ts`:
 *   - quantity:  stored as-is (number, fractional allowed)
 *   - price:     int*100 in trade currency
 *   - cashAmount: dec*100 in settlement currency (we don't use it here —
 *     position cost is built from price*quantity in the asset's listing
 *     currency, FX comes in at the valuation step).
 */
import type {
  MirrorAsset,
  MirrorAssetTransaction,
} from '../mirror'

export type Holding = {
  assetId: string
  symbol: string
  exchangeCode: string
  name?: string
  currency: string         // asset listing currency
  quantity: number         // net shares held
  avgCost: number          // average cost per share, in listing currency
  totalCost: number        // quantity * avgCost (rounded to 4 decimals)
  buyCount: number
  sellCount: number
  firstTradeDate: string | null
  lastTradeDate: string | null
}

const EPS = 1e-9

export function computeHoldings(
  txns: MirrorAssetTransaction[],
  byAssetId: Map<string, MirrorAsset>,
  opts: { accountIds?: Set<string> } = {},
): Holding[] {
  const filtered = opts.accountIds
    ? txns.filter(t => opts.accountIds!.has(t.accountId))
    : txns

  // Group by asset, sort each group ascending by date for replay.
  const grouped = new Map<string, MirrorAssetTransaction[]>()
  for (const t of filtered) {
    const arr = grouped.get(t.assetId) ?? []
    arr.push(t)
    grouped.set(t.assetId, arr)
  }

  const holdings: Holding[] = []
  for (const [assetId, group] of grouped) {
    group.sort((a, b) => a.date.localeCompare(b.date))

    let qty = 0
    let avg = 0
    let buyCount = 0
    let sellCount = 0
    let firstDate: string | null = null
    let lastDate: string | null = null

    for (const t of group) {
      const txnQty = t.quantity
      const txnPrice = t.price / 100
      if (firstDate === null || t.date < firstDate) firstDate = t.date
      if (lastDate === null || t.date > lastDate) lastDate = t.date

      if (t.transactionType === 0) {
        // Buy: weighted-average new cost.
        const newQty = qty + txnQty
        if (newQty <= EPS) {
          // Buy of zero/negative quantity is malformed — skip but keep counters
          // honest so the UI can flag it via a follow-up sanity check.
        } else {
          avg = (qty * avg + txnQty * txnPrice) / newQty
          qty = newQty
        }
        buyCount++
      } else if (t.transactionType === 1) {
        // Sell: quantity decreases, avg cost unchanged. Don't go below 0 —
        // a short would require a different model; in practice this just
        // guards against bad data.
        qty = Math.max(0, qty - txnQty)
        sellCount++
        if (qty <= EPS) avg = 0
      }
    }

    if (qty <= EPS) continue
    const asset = byAssetId.get(assetId)
    holdings.push({
      assetId,
      symbol: asset?.symbol ?? '???',
      exchangeCode: asset?.exchangeCode ?? '',
      name: asset?.name,
      currency: asset?.currencyCode || '',
      quantity: round(qty, 6),
      avgCost: round(avg, 4),
      totalCost: round(qty * avg, 4),
      buyCount,
      sellCount,
      firstTradeDate: firstDate,
      lastTradeDate: lastDate,
    })
  }

  // Sort by total cost desc by default — biggest positions on top.
  holdings.sort((a, b) => b.totalCost - a.totalCost)
  return holdings
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}
