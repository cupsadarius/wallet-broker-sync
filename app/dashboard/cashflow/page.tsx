import Link from 'next/link'
import { ensureFreshMirror, getBaseCurrency } from '@/src/dashboards/mirror'
import { aggregateSpending } from '@/src/dashboards/compute/spending'
import CashFlowChart from './CashFlowChart'

export const dynamic = 'force-dynamic'

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams?: Promise<{ months?: string }>
}) {
  const snapshot = await ensureFreshMirror()
  if (!snapshot) {
    return (
      <div className="rounded-xl border bg-card px-5 py-8 text-sm text-muted-foreground">
        Couch not configured. Visit <Link href="/setup" className="underline">setup</Link>.
      </div>
    )
  }
  const baseCurrency = await getBaseCurrency()

  const params = (await searchParams) ?? {}
  const months = Math.max(1, Math.min(120, Number(params.months ?? 12)))
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1))
    .toISOString().slice(0, 10)

  // No account filter — Cash flow shows the full picture across cash AND
  // investment accounts (income, expense, transfers, dividends, fees).
  const accountNameById = new Map(snapshot.accounts.map(a => [a.id, a.name]))
  const cf = await aggregateSpending(snapshot.records, baseCurrency, {
    accountNameById,
    fromDate: from,
  })

  // Dividend-like income lives in the "Income" envelope group ("Interest,
  // dividends"). Build a yearly roll-up from those slices.
  const dividendSlices = cf.byCategory.filter(c =>
    c.group === 'Income' && /dividend|interest/i.test(c.name),
  )
  const yearlyDividendsMap = new Map<string, number>()
  for (const k of dividendSlices.map(c => c.key)) {
    const recs = cf.records[k] ?? []
    for (const r of recs) {
      if (r.amountBase <= 0) continue
      const year = r.date.slice(0, 4)
      yearlyDividendsMap.set(year, (yearlyDividendsMap.get(year) ?? 0) + r.amountBase)
    }
  }
  const yearlyDividends = Array.from(yearlyDividendsMap.entries())
    .map(([year, total]) => ({ year, total }))
    .sort((a, b) => a.year.localeCompare(b.year))

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Window: last {months} months · all accounts ·{' '}
          {cf.unconverted > 0 ? `${cf.unconverted} unconverted FX` : 'all converted'}
        </div>
        <div className="flex gap-1 text-xs">
          {[6, 12, 24, 60].map(n => (
            <Link
              key={n}
              href={`/dashboard/cashflow?months=${n}`}
              className={`px-2.5 py-1 rounded border ${months === n ? 'bg-muted text-foreground border-foreground/20' : 'text-muted-foreground border-border/40 hover:text-foreground'}`}
            >
              {n}m
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Income (period)" value={fmt(cf.totals.income, baseCurrency)} tone="pos" />
        <StatCard label="Expense (period)" value={fmt(cf.totals.expense, baseCurrency)} tone="neg" />
        <StatCard
          label="Net"
          value={fmtSigned(cf.totals.net, baseCurrency)}
          tone={cf.totals.net >= 0 ? 'pos' : 'neg'}
        />
        <StatCard
          label="Transfers (gross)"
          value={fmt(cf.totals.transfers, baseCurrency)}
          suffix="between your accounts"
        />
      </div>

      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-medium">Monthly cash flow</h3>
        <p className="text-xs text-muted-foreground">
          Income in green, expense in red, net as line. All accounts, {baseCurrency}.
        </p>
        <div className="mt-4 h-[340px]">
          <CashFlowChart monthly={cf.monthly} baseCurrency={baseCurrency} />
        </div>
      </div>

      {yearlyDividends.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="text-sm font-medium">Dividends &amp; interest by year</h3>
          <p className="text-xs text-muted-foreground">
            Income › Interest, dividends (across all investment + cash accounts).
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {yearlyDividends.map(y => (
              <li key={y.year} className="flex items-center justify-between rounded border bg-background px-3 py-2 text-sm">
                <span className="text-muted-foreground">{y.year}</span>
                <span className="font-mono text-emerald-400">{fmt(y.total, baseCurrency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label, value, tone, suffix,
}: { label: string; value: string; tone?: 'pos' | 'neg'; suffix?: string }) {
  const toneClass = tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : ''
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      {suffix && <p className="mt-1 text-xs text-muted-foreground">{suffix}</p>}
    </div>
  )
}

function fmt(n: number, ccy: string): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${ccy}`
}
function fmtSigned(n: number, ccy: string): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${ccy}`
}
