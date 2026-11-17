import Link from 'next/link'
import { ensureFreshMirror, getBaseCurrency } from '@/src/dashboards/mirror'
import { aggregateSpending } from '@/src/dashboards/compute/spending'
import CategoryDrillDown from '../spending/CategoryDrillDown'

export const dynamic = 'force-dynamic'

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams?: Promise<{ months?: string; scope?: 'cash' | 'all' | 'investment' }>
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
  const scope = params.scope ?? 'cash'

  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1))
    .toISOString().slice(0, 10)

  let accountIds: Set<string> | undefined
  if (scope === 'cash') {
    accountIds = new Set(snapshot.accounts.filter(a => a.accountType !== 7).map(a => a.id))
  } else if (scope === 'investment') {
    accountIds = new Set(snapshot.accounts.filter(a => a.accountType === 7).map(a => a.id))
  }
  const accountNameById = new Map(snapshot.accounts.map(a => [a.id, a.name]))

  const spending = await aggregateSpending(snapshot.records, baseCurrency, {
    accountIds,
    accountNameById,
    fromDate: from,
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Scope: {scope} accounts · last {months} months · {spending.byCategory.length} categories ·{' '}
          {spending.unconverted > 0 ? `${spending.unconverted} unconverted FX` : 'all converted'}
        </div>
        <div className="flex gap-2 text-xs">
          <div className="flex gap-1">
            {(['cash', 'investment', 'all'] as const).map(s => (
              <Link
                key={s}
                href={`/dashboard/categories?months=${months}&scope=${s}`}
                className={`px-2.5 py-1 rounded border capitalize ${scope === s ? 'bg-muted text-foreground border-foreground/20' : 'text-muted-foreground border-border/40 hover:text-foreground'}`}
              >
                {s}
              </Link>
            ))}
          </div>
          <div className="flex gap-1">
            {[6, 12, 24, 60].map(n => (
              <Link
                key={n}
                href={`/dashboard/categories?months=${n}&scope=${scope}`}
                className={`px-2.5 py-1 rounded border ${months === n ? 'bg-muted text-foreground border-foreground/20' : 'text-muted-foreground border-border/40 hover:text-foreground'}`}
              >
                {n}m
              </Link>
            ))}
          </div>
        </div>
      </div>

      <CategoryDrillDown
        byCategory={spending.byCategory}
        records={spending.records}
        baseCurrency={baseCurrency}
      />
    </div>
  )
}
