'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ValuedHolding } from '@/src/dashboards/compute/valuation'

export default function HoldingsTable({
  rows,
  baseCurrency,
}: {
  rows: ValuedHolding[]
  baseCurrency: string
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        No open positions. Once you sync broker trades, they&apos;ll show up here.
      </div>
    )
  }

  return (
    <div className="rounded-xl border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Avg cost</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Value ({baseCurrency})</TableHead>
            <TableHead className="text-right">P&L</TableHead>
            <TableHead className="text-right">P&L %</TableHead>
            <TableHead className="text-right">Alloc</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(h => (
            <TableRow key={h.assetId} className="hover:bg-muted/50">
              <TableCell>
                <div className="font-medium">{h.symbol}</div>
                <div className="text-[11px] text-muted-foreground">
                  {h.exchangeCode || '—'}
                  {h.name ? <> · <span className="truncate">{h.name}</span></> : null}
                </div>
              </TableCell>
              <TableCell className="text-right font-mono text-xs">{fmtQty(h.quantity)}</TableCell>
              <TableCell className="text-right font-mono text-xs">
                {fmtMoney(h.avgCost)} {h.currency}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {h.priceNative !== null
                  ? `${fmtMoney(h.priceNative)} ${h.currency}`
                  : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {h.valueBase !== null ? fmtMoney0(h.valueBase) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className={`text-right font-mono text-xs ${pnlClass(h.unrealizedPnlBase)}`}>
                {fmtSigned(h.unrealizedPnlBase)}
              </TableCell>
              <TableCell className={`text-right font-mono text-xs ${pnlClass(h.unrealizedPnlPct)}`}>
                {fmtPct(h.unrealizedPnlPct)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {h.allocationPct !== null ? `${h.allocationPct.toFixed(1)}%` : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function pnlClass(v: number | null): string {
  if (v === null) return ''
  return v >= 0 ? 'text-emerald-400' : 'text-red-400'
}
function fmtQty(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toLocaleString(undefined, { maximumFractionDigits: 6 })
}
function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtMoney0(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
function fmtSigned(n: number | null): string {
  if (n === null) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
function fmtPct(n: number | null): string {
  if (n === null) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toFixed(2)}%`
}
