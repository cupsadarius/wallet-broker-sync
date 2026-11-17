import Link from 'next/link'
import { ensureFreshMirror, getBaseCurrency } from '@/src/dashboards/mirror'
import { computePerformance } from '@/src/dashboards/compute/performance'
import PerformanceChart from './PerformanceChart'

export const dynamic = 'force-dynamic'

export default async function PerformancePage() {
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
  const perf = await computePerformance({
    baseCurrency,
    txns: snapshot.transactions,
    byAssetId: snapshot.byAssetId,
    accountIds: investmentAccountIds,
  })

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="MWR (XIRR)" value={fmtPct(perf.mwr)} tone={tone(perf.mwr)} />
        <StatCard label="TWR (annualized)" value={fmtPct(perf.twr)} tone={tone(perf.twr)} />
        <StatCard
          label="Total return"
          value={fmtMoneySigned(perf.totalReturnBase, baseCurrency)}
          tone={perf.totalReturnBase >= 0 ? 'pos' : 'neg'}
        />
        <StatCard
          label="Total return %"
          value={perf.totalReturnPct === null
            ? '—'
            : `${perf.totalReturnPct >= 0 ? '+' : ''}${perf.totalReturnPct.toFixed(2)}%`}
          tone={perf.totalReturnPct === null ? undefined : perf.totalReturnPct >= 0 ? 'pos' : 'neg'}
        />
      </div>

      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Portfolio value over time</h3>
            <p className="text-xs text-muted-foreground">
              Month-end samples in {baseCurrency}. Live close used for the most recent point.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            {perf.series.length} samples · {perf.cashFlows.length} cash flows
          </div>
        </div>
        <div className="mt-4 h-[340px]">
          <PerformanceChart series={perf.series} baseCurrency={baseCurrency} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5 text-sm">
        <h3 className="text-sm font-medium">Contributions</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat label="Capital invested" value={fmtMoney(perf.totalContributedBase, baseCurrency)} />
          <Stat label="Cash realized (sells)" value={fmtMoney(perf.totalRealizedBase, baseCurrency)} />
          <Stat label="Current market value" value={fmtMoney(perf.currentValueBase, baseCurrency)} />
        </dl>
      </div>
    </div>
  )
}

function StatCard({
  label, value, tone,
}: {
  label: string; value: string; tone?: 'pos' | 'neg'
}) {
  const toneClass = tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : ''
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono">{value}</dd>
    </div>
  )
}

function fmtPct(v: number | null): string {
  if (v === null) return 'N/A'
  const pct = v * 100
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${sign}${Math.abs(pct).toFixed(2)}%`
}

function tone(v: number | null): 'pos' | 'neg' | undefined {
  if (v === null) return undefined
  return v >= 0 ? 'pos' : 'neg'
}

function fmtMoney(n: number, ccy: string): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${ccy}`
}

function fmtMoneySigned(n: number, ccy: string): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${ccy}`
}
