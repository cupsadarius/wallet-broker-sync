import Link from 'next/link'
import { ensureFreshMirror, getBaseCurrency } from '@/src/dashboards/mirror'
import { computeHoldings } from '@/src/dashboards/compute/holdings'
import { valuateHoldings } from '@/src/dashboards/compute/valuation'
import HoldingsTable from './HoldingsTable'
import AllocationChart from './AllocationChart'

export const dynamic = 'force-dynamic'

export default async function HoldingsPage() {
  const snapshot = await ensureFreshMirror()
  if (!snapshot) {
    return (
      <div className="rounded-xl border bg-card px-5 py-8 text-sm text-muted-foreground">
        Couch is not configured yet. Visit <Link href="/setup" className="underline">setup</Link> first.
      </div>
    )
  }
  const baseCurrency = await getBaseCurrency()
  const investmentAccountIds = new Set(
    snapshot.accounts.filter(a => a.accountType === 7).map(a => a.id),
  )
  const holdings = computeHoldings(snapshot.transactions, snapshot.byAssetId, {
    accountIds: investmentAccountIds,
  })
  const valued = await valuateHoldings(holdings, baseCurrency)

  const totalValueBase = valued.reduce((s, v) => s + (v.valueBase ?? 0), 0)
  const totalCostBase = valued.reduce((s, v) => s + (v.costBase ?? 0), 0)
  const totalPnl = totalValueBase - totalCostBase
  const totalPnlPct = totalCostBase > 0 ? (totalPnl / totalCostBase) * 100 : null
  const pricedCount = valued.filter(v => v.valueBase !== null).length
  const unpricedCount = valued.length - pricedCount

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Portfolio value"
          value={fmtMoney(totalValueBase, baseCurrency)}
          suffix={`${pricedCount} priced${unpricedCount ? ` · ${unpricedCount} unpriced` : ''}`}
        />
        <StatCard
          label="Cost basis"
          value={fmtMoney(totalCostBase, baseCurrency)}
        />
        <StatCard
          label="Unrealized P&L"
          value={fmtMoneySigned(totalPnl, baseCurrency)}
          tone={totalPnl >= 0 ? 'pos' : 'neg'}
        />
        <StatCard
          label="P&L %"
          value={totalPnlPct === null ? '—' : `${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%`}
          tone={totalPnlPct === null ? undefined : totalPnlPct >= 0 ? 'pos' : 'neg'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <HoldingsTable rows={valued} baseCurrency={baseCurrency} />
        <AllocationChart rows={valued} baseCurrency={baseCurrency} />
      </div>
    </div>
  )
}

function StatCard({
  label, value, suffix, tone,
}: {
  label: string; value: string; suffix?: string; tone?: 'pos' | 'neg'
}) {
  const toneClass = tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : ''
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      {suffix && <p className="mt-1 text-xs text-muted-foreground">{suffix}</p>}
    </div>
  )
}

function fmtMoney(n: number, ccy: string): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${ccy}`
}

function fmtMoneySigned(n: number, ccy: string): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${ccy}`
}
