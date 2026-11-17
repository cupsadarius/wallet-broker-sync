import Link from 'next/link'
import { ensureFreshMirror, getBaseCurrency } from '@/src/dashboards/mirror'
import { aggregateSpending } from '@/src/dashboards/compute/spending'
import SpendingCharts from './SpendingCharts'

export const dynamic = 'force-dynamic'

export default async function SpendingPage({
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

  // Default window: last 12 months. ?months=24 to extend.
  const params = (await searchParams) ?? {}
  const months = Math.max(1, Math.min(120, Number(params.months ?? 12)))
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1))
    .toISOString().slice(0, 10)

  // Cash accounts = anything not type 7 (investment).
  const cashAccountIds = new Set(
    snapshot.accounts.filter(a => a.accountType !== 7).map(a => a.id),
  )
  const accountNameById = new Map(snapshot.accounts.map(a => [a.id, a.name]))

  const spending = await aggregateSpending(snapshot.records, baseCurrency, {
    accountIds: cashAccountIds,
    accountNameById,
    fromDate: from,
  })

  const avgMonthlyExpense = spending.monthsCovered > 0
    ? spending.totals.expense / spending.monthsCovered : 0
  const avgMonthlyIncome = spending.monthsCovered > 0
    ? spending.totals.income / spending.monthsCovered : 0

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Window: last {months} months · {cashAccountIds.size} cash accounts · {spending.totals.income + spending.totals.expense > 0 ? '' : 'no data — '}
          {spending.unconverted > 0 ? `${spending.unconverted} unconverted FX` : ''}
        </div>
        <div className="flex gap-1 text-xs">
          {[6, 12, 24, 60].map(n => (
            <Link
              key={n}
              href={`/dashboard/spending?months=${n}`}
              className={`px-2.5 py-1 rounded border ${months === n ? 'bg-muted text-foreground border-foreground/20' : 'text-muted-foreground border-border/40 hover:text-foreground'}`}
            >
              {n}m
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Income (period)" value={fmt(spending.totals.income, baseCurrency)} tone="pos" />
        <StatCard label="Expense (period)" value={fmt(spending.totals.expense, baseCurrency)} tone="neg" />
        <StatCard label="Net" value={fmtSigned(spending.totals.net, baseCurrency)} tone={spending.totals.net >= 0 ? 'pos' : 'neg'} />
        <StatCard
          label="Avg monthly"
          value={fmtSigned(avgMonthlyIncome - avgMonthlyExpense, baseCurrency)}
          suffix={`+${fmt(avgMonthlyIncome, baseCurrency)} / -${fmt(avgMonthlyExpense, baseCurrency)}`}
        />
        <StatCard
          label="Transfers (gross)"
          value={fmt(spending.totals.transfers, baseCurrency)}
          suffix="between your accounts"
        />
      </div>

      <SpendingCharts
        monthly={spending.monthly}
        byCategory={spending.byCategory}
        baseCurrency={baseCurrency}
      />

      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-medium">By account</h3>
        <p className="text-xs text-muted-foreground">
          Income/Expense exclude transfers. Transfers in/out shown separately.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="text-left py-2">Account</th>
              <th className="text-right py-2">Income</th>
              <th className="text-right py-2">Expense</th>
              <th className="text-right py-2">Net</th>
              <th className="text-right py-2">Transfer in</th>
              <th className="text-right py-2">Transfer out</th>
              <th className="text-right py-2">Records</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {spending.byAccount.map(a => (
              <tr key={a.accountId}>
                <td className="py-2 font-medium">{a.name}</td>
                <td className="py-2 text-right font-mono text-emerald-400">{fmt(a.income, baseCurrency)}</td>
                <td className="py-2 text-right font-mono text-red-400">{fmt(a.expense, baseCurrency)}</td>
                <td className={`py-2 text-right font-mono ${a.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtSigned(a.net, baseCurrency)}
                </td>
                <td className="py-2 text-right font-mono text-muted-foreground">
                  {a.transfersIn > 0 ? fmt(a.transfersIn, baseCurrency) : '—'}
                </td>
                <td className="py-2 text-right font-mono text-muted-foreground">
                  {a.transfersOut > 0 ? fmt(a.transfersOut, baseCurrency) : '—'}
                </td>
                <td className="py-2 text-right text-muted-foreground">{a.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatCard({
  label, value, suffix, tone,
}: { label: string; value: string; suffix?: string; tone?: 'pos' | 'neg' }) {
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
