import Link from 'next/link'
import { ensureFreshMirror, getBaseCurrency, getLastMirrorSync } from '@/src/dashboards/mirror'
import { computeHoldings } from '@/src/dashboards/compute/holdings'
import { valuateHoldings } from '@/src/dashboards/compute/valuation'
import { aggregateSpending } from '@/src/dashboards/compute/spending'
import { computeNetWorth } from '@/src/dashboards/compute/networth'
import NetWorthSpark from './NetWorthSpark'

export const dynamic = 'force-dynamic'

export default async function DashboardOverviewPage() {
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

  // Compute the four headline metrics + a sparkline.
  const accountNameById = new Map(snapshot.accounts.map(a => [a.id, a.name]))
  const [holdings, cf, netWorth] = await Promise.all([
    (async () => {
      const h = computeHoldings(snapshot.transactions, snapshot.byAssetId, { accountIds: investmentAccountIds })
      return valuateHoldings(h, baseCurrency)
    })(),
    aggregateSpending(snapshot.records, baseCurrency, { accountNameById }),
    computeNetWorth({
      baseCurrency,
      accounts: snapshot.accounts,
      txns: snapshot.transactions,
      records: snapshot.records,
      byAssetId: snapshot.byAssetId,
    }),
  ])

  const top5 = holdings.slice(0, 5)
  const totalValue = holdings.reduce((s, h: typeof holdings[number]) => s + (h.valueBase ?? 0), 0)
  const totalCost = holdings.reduce((s, h: typeof holdings[number]) => s + (h.costBase ?? 0), 0)
  const totalPnl = totalValue - totalCost
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : null

  const lastSync = await getLastMirrorSync()
  // Latest month dividend total from the "Interest, dividends" category slice.
  const divSlices = cf.byCategory.filter(c =>
    c.group === 'Income' && /dividend|interest/i.test(c.name),
  )
  const latestMonth = cf.monthly[cf.monthly.length - 1]?.yearMonth
  let mtdDiv = 0
  if (latestMonth) {
    for (const s of divSlices) {
      const recs = cf.records[s.key] ?? []
      for (const r of recs) {
        if (r.date.startsWith(latestMonth) && r.amountBase > 0) mtdDiv += r.amountBase
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Net worth"
          value={netWorth.latest
            ? fmtMoney(netWorth.latest.totalBase, baseCurrency)
            : '—'}
          suffix={netWorth.latest
            ? `${fmtMoney(netWorth.latest.cashBase, baseCurrency)} cash · ${fmtMoney(netWorth.latest.investmentBase, baseCurrency)} invested`
            : undefined}
        />
        <StatCard
          label="Portfolio P&L"
          value={totalPnlPct === null
            ? '—'
            : `${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%`}
          suffix={fmtMoneySigned(totalPnl, baseCurrency)}
          tone={totalPnl === 0 ? undefined : totalPnl > 0 ? 'pos' : 'neg'}
        />
        <StatCard
          label="Latest month dividends"
          value={fmtMoney(mtdDiv, baseCurrency)}
          suffix={latestMonth}
          tone={mtdDiv > 0 ? 'pos' : undefined}
        />
        <StatCard
          label="Last sync"
          value={lastSync ? fmtRelative(lastSync) : '—'}
        />
      </div>

      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-sm font-medium">Net worth over time</h3>
            <p className="text-xs text-muted-foreground">
              Cash + investments, month-end samples in {baseCurrency}.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">{netWorth.series.length} samples</div>
        </div>
        <div className="mt-4 h-[280px]">
          <NetWorthSpark series={netWorth.series} baseCurrency={baseCurrency} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Top positions</h3>
          <Link href="/dashboard/holdings" className="text-xs text-primary underline-offset-2 hover:underline">
            See all
          </Link>
        </div>
        {top5.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No open positions yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/40">
            {top5.map(h => (
              <li key={h.assetId} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="font-medium">{h.symbol}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {h.exchangeCode || '—'}{h.name ? ` · ${h.name}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">
                    {h.valueBase !== null ? fmtMoney(h.valueBase, baseCurrency) : '—'}
                  </div>
                  <div className={`text-xs ${h.unrealizedPnlPct === null ? 'text-muted-foreground' : h.unrealizedPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {h.unrealizedPnlPct === null
                      ? '—'
                      : `${h.unrealizedPnlPct >= 0 ? '+' : ''}${h.unrealizedPnlPct.toFixed(2)}%`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
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

function fmtRelative(d: Date): string {
  const diff = Date.now() - d.getTime()
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return d.toLocaleDateString()
}
