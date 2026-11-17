import Link from 'next/link'
import { readMirror } from '@/src/dashboards/mirror'
import { loadMaturities } from '@/src/dashboards/portfolio'
import { fmtAmount, fmtDay } from '@/src/dashboards/compute/today'
import { payout } from '@/src/dashboards/compute/maturities'
import { addMaturity, deleteMaturity } from './actions'

const field = 'h-11 w-full min-w-0 rounded-xl border bg-transparent px-3 text-sm outline-none focus-visible:border-primary'

export default async function MaturitiesPage() {
  const [rows, snapshot] = await Promise.all([loadMaturities(), readMirror()])
  const accounts = snapshot?.accounts ?? []
  const accountName = new Map(accounts.map(a => [a.id, a.name]))
  rows.sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))

  return (
    <main className="mx-auto max-w-xl px-4">
      <Link href="/invest" className="text-sm text-primary">‹ Invest</Link>
      <h1 className="mt-1 text-2xl font-semibold">Deposits and bonds</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Wallet has no maturity or rate fields. Enter them here once; they feed Coming up and Performance.
      </p>

      <div className="mt-4 rounded-2xl border bg-card px-3.5">
        {rows.length === 0 && <p className="py-3 text-sm text-muted-foreground">Nothing entered yet.</p>}
        {rows.map(m => {
          const p = payout(m)
          return (
            <div key={m.id} className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0">
              <div className="min-w-0">
                <div className="font-semibold">{m.name} <span className="text-xs font-normal text-muted-foreground">· {m.kind}</span></div>
                <div className="text-xs text-muted-foreground">
                  {fmtDay(m.maturityDate)} · {fmtAmount(m.principal, m.currency)}
                  {m.rateBps !== null ? ` · ${m.rateBps / 100}%` : ' · rate not set'}
                  {p !== null && ` · pays ${fmtAmount(p, m.currency)}`}
                  {m.accountId && ` · ${accountName.get(m.accountId) ?? 'account'}`}
                  {m.symbol && ` · ${m.symbol}`}
                </div>
              </div>
              <form action={deleteMaturity}>
                <input type="hidden" name="id" value={m.id} />
                <button className="text-xs text-down" aria-label={`Delete ${m.name}`}>Delete</button>
              </form>
            </div>
          )
        })}
      </div>

      <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add one</h2>
      <form action={addMaturity} className="grid grid-cols-2 gap-2.5 rounded-2xl border bg-card p-3.5">
        <Label text="Type">
          <select name="kind" className={field} defaultValue="deposit">
            <option value="deposit">Deposit</option>
            <option value="bond">Bond</option>
          </select>
        </Label>
        <Label text="Name"><input name="name" required maxLength={80} placeholder="BT deposit" className={field} /></Label>
        <Label text="Wallet account (deposit)" wide>
          <select name="accountId" className={field} defaultValue="">
            <option value="">None</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.currencyCode}</option>)}
          </select>
        </Label>
        <Label text="Asset symbol (bond)"><input name="symbol" maxLength={20} placeholder="R2704A" className={field} /></Label>
        <Label text="Currency"><input name="currency" required defaultValue="RON" pattern="[A-Za-z]{3}" className={field} /></Label>
        <Label text="Principal"><input name="principal" required type="number" min="0.01" step="0.01" inputMode="decimal" className={field} /></Label>
        <Label text="Rate or coupon, %"><input name="rate" type="number" min="0" max="100" step="0.01" inputMode="decimal" className={field} /></Label>
        <Label text="Start date"><input name="startDate" type="date" className={field} /></Label>
        <Label text="Maturity date"><input name="maturityDate" required type="date" className={field} /></Label>
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
