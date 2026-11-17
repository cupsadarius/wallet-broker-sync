import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { db } from '@/src/storage/db'
import { plan } from '@/src/storage/schema'
import { readMirror, withFallbackTrades } from '@/src/dashboards/mirror'
import { loadMaturities } from '@/src/dashboards/portfolio'
import { fmtAmount, fmtDay } from '@/src/dashboards/compute/today'
import { cn } from '@/lib/utils'
import { savePlan } from './actions'

const field = 'h-11 w-full min-w-0 rounded-xl border bg-transparent px-3 text-sm outline-none focus-visible:border-primary'

export default async function PlanFormPage({ searchParams }: { searchParams: Promise<{ id?: string; type?: string }> }) {
  const q = await searchParams
  const row = q.id ? (await db.select().from(plan).where(eq(plan.id, Number(q.id))))[0] : undefined
  if (q.id && !row) notFound()
  const type = row?.type ?? (q.type === 'rollover' ? 'rollover' : 'recurring')
  const [snapshot, maturities] = await Promise.all([readMirror(), loadMaturities()])
  const accounts = (snapshot?.accounts ?? []).filter(a => !a.archived)
  const symbols = snapshot ? [...new Set([...withFallbackTrades(snapshot).byAssetId.values()].map(a => a.symbol))].sort() : []
  const today = new Date().toISOString().slice(0, 10)

  return (
    <main className="mx-auto max-w-xl px-4">
      <Link href="/invest?tab=plans" className="text-sm text-primary">‹ Plans</Link>
      <h1 className="mt-1 text-2xl font-semibold">{row ? 'Edit plan' : 'New plan'}</h1>

      {!row && (
        <nav className="my-3 flex rounded-xl border bg-card p-[3px]">
          {(['recurring', 'rollover'] as const).map(t => (
            <Link
              key={t}
              href={`/invest/plans?type=${t}`}
              className={cn('flex-1 rounded-[9px] py-1.5 text-center text-[13px] text-muted-foreground', t === type && 'bg-secondary font-semibold text-foreground')}
            >
              {t === 'recurring' ? 'Recurring' : 'Rollover'}
            </Link>
          ))}
        </nav>
      )}
      <p className="mt-2 text-sm text-muted-foreground">
        {type === 'recurring'
          ? 'Put a fixed amount into an account every week or month, and buy one asset with it.'
          : 'When a deposit or bond matures, move the money into a named product.'}
      </p>

      <form action={savePlan} className="mt-3 grid grid-cols-2 gap-2.5 rounded-2xl border bg-card p-3.5">
        <input type="hidden" name="type" value={type} />
        {row && <input type="hidden" name="id" value={row.id} />}
        <Label text="Name" wide>
          <input name="name" required maxLength={80} defaultValue={row?.name} placeholder={type === 'recurring' ? 'VUAA monthly' : 'Rollover to Fidelis'} className={field} />
        </Label>

        {type === 'rollover' && (
          <Label text="Maturity" wide>
            <select name="maturityId" required className={field} defaultValue={row?.maturityId ?? ''}>
              <option value="" disabled>Choose one</option>
              {maturities.map(m => <option key={m.id} value={m.id}>{m.name} · {fmtAmount(m.principal, m.currency)} · {fmtDay(m.maturityDate)}</option>)}
            </select>
          </Label>
        )}
        {type === 'rollover' && maturities.length === 0 && (
          <p className="col-span-2 text-xs text-muted-foreground">
            No maturities yet. <Link href="/invest/maturities" className="text-primary">Add one first</Link>.
          </p>
        )}

        <Label text={type === 'recurring' ? 'Wallet account' : 'Money goes to'} wide>
          <select name="accountId" required className={field} defaultValue={row?.accountId ?? ''}>
            <option value="" disabled>Choose one</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.currencyCode}</option>)}
          </select>
        </Label>

        {type === 'recurring' ? (
          <>
            <Label text="Amount, account currency">
              <input name="amount" required type="number" min="0.01" step="0.01" inputMode="decimal" defaultValue={row?.amount ? row.amount / 100 : undefined} className={field} />
            </Label>
            <Label text="Every">
              <select name="frequency" className={field} defaultValue={row?.frequency ?? 'monthly'}>
                <option value="monthly">Month</option>
                <option value="weekly">Week</option>
              </select>
            </Label>
          </>
        ) : (
          <Label text="Target product" wide>
            <input name="targetProduct" required maxLength={80} defaultValue={row?.targetProduct ?? ''} placeholder="Fidelis RON 2028" className={field} />
          </Label>
        )}

        <Label text="Target asset (optional)">
          <input name="targetSymbol" list="plan-symbols" maxLength={20} defaultValue={row?.targetSymbol ?? ''} placeholder={type === 'recurring' ? 'VUAA' : 'R2805A'} autoCapitalize="characters" className={field} />
        </Label>
        <Label text="Start date">
          <input name="startDate" required type="date" defaultValue={row?.startDate ?? today} className={field} />
        </Label>
        <datalist id="plan-symbols">{symbols.map(s => <option key={s} value={s} />)}</datalist>

        {type === 'recurring' && (
          <label className="col-span-2 flex h-11 items-center gap-3 text-sm">
            <input type="checkbox" name="wholeShares" defaultChecked={row?.wholeShares ?? true} className="size-5 accent-primary" />
            Buy whole shares only
          </label>
        )}
        <button className="col-span-2 mt-1 h-11 rounded-xl bg-primary font-bold text-primary-foreground">Save</button>
      </form>
    </main>
  )
}

function Label({ text, wide, children }: { text: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? 'col-span-2 grid gap-1' : 'grid min-w-0 gap-1'}>
      <span className="text-xs text-muted-foreground">{text}</span>
      {children}
    </label>
  )
}
