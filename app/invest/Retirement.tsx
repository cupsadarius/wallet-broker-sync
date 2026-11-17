import Link from 'next/link'
import { loadRetirement } from '@/src/retirement/load'
import type { AccountView, Pilon1View } from '@/src/retirement/compute'
import { PROVIDER_NAME } from '@/src/retirement/types'
import { fmtAmount, fmtDay } from '@/src/dashboards/compute/today'
import { cn } from '@/lib/utils'
import { saveReleaseDate, saveVpr } from './retirement/actions'

const SHARE_COLORS = ['bg-primary', 'bg-violet-300', 'bg-up', 'bg-warn', 'bg-sky-300']
const pct = (x: number, digits = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`
const money = (cents: number, ccy: string) => fmtAmount(cents / 100, ccy)
const title = (a: AccountView) =>
  `${a.kind === 'pilon2' ? 'Pilon 2' : a.kind === 'pilon3' ? 'Pilon 3' : PROVIDER_NAME[a.provider]} · ${a.kind === 'unit-linked' ? a.product : PROVIDER_NAME[a.provider]}`

export default async function Retirement() {
  const today = new Date().toISOString().slice(0, 10)
  const s = await loadRetirement(today)
  const lockedAccounts = s.accounts.filter(a => a.locked && a.valueBase !== null)

  return (
    <>

      {s.accounts.length === 0 && !s.pilon1 && (
        <p className="text-sm text-muted-foreground">
          No statements yet. <Link href="/upload" className="text-primary">Upload</Link> your pension and policy PDFs.
        </p>
      )}

      {s.accounts.length > 0 && (
        <div className="rounded-[14px] border bg-card px-3.5 py-3">
          <div className="text-xs text-muted-foreground">Locked until retirement</div>
          <div className="text-2xl font-bold tabular-nums">{money(s.locked, s.base)}</div>
          <div className="text-xs text-muted-foreground">
            Paid in {money(s.paidInLocked, s.base)} · Gain{' '}
            <span className={s.locked >= s.paidInLocked ? 'text-up' : 'text-down'}>{money(s.locked - s.paidInLocked, s.base)}</span>
            {s.available > 0 && <> · Released {money(s.available, s.base)}</>}
          </div>
          {s.locked > 0 && (
            <>
              <div className="my-2 flex h-2 overflow-hidden rounded bg-border">
                {lockedAccounts.map((a, i) => (
                  <b key={a.id} className={SHARE_COLORS[i % SHARE_COLORS.length]} style={{ width: `${(a.valueBase! / s.locked) * 100}%` }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                {lockedAccounts.map((a, i) => (
                  <span key={a.id}><span className={cn('mr-1 inline-block size-2 rounded-sm', SHARE_COLORS[i % SHARE_COLORS.length])} />{title(a).split(' · ')[0]}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {s.accounts.length > 0 && <Section title="Accounts" />}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-4">
        {s.accounts.map(a => <AccountCard key={a.id} a={a} base={s.base} today={today} />)}
      </div>

      {s.pilon1 && <Section title="State pension · Pilon 1" />}
      {s.pilon1 && <div className="lg:grid lg:grid-cols-2 lg:gap-x-4"><Pilon1Card p={s.pilon1} /></div>}

      <div className="my-5 text-center">
        <Link href="/upload" className="rounded-[10px] bg-primary px-3.5 py-2 text-[13px] font-bold text-primary-foreground">Upload statement</Link>
      </div>
    </>
  )
}

function AccountCard({ a, base, today }: { a: AccountView; base: string; today: string }) {
  const years = a.releaseDate ? (Date.parse(a.releaseDate) - Date.parse(today)) / (365.25 * 86_400_000) : null
  return (
    <div className="my-2 rounded-[14px] border bg-card px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <b className="min-w-0 truncate text-sm">{title(a)}</b>
        <span className={cn('shrink-0 rounded-md border px-1.5 text-[11px]', a.stale ? 'border-warn/50 text-warn' : 'text-muted-foreground')}>
          {fmtDay(a.asOf)}{a.stale && ' · old'}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xl font-bold tabular-nums">{money(a.value, a.currency)}</span>
        <span className={a.gain >= 0 ? 'text-up' : 'text-down'}>
          {a.yearly ? `${pct(a.yearly.rate)}/yr` : `${pct(a.gainPct, 0)} total`}
        </span>
      </div>
      {a.currency !== base && (
        <div className="text-xs text-muted-foreground">
          {a.valueBase === null ? 'No exchange rate today' : `≈ ${money(a.valueBase, base)} at today's rate`}
        </div>
      )}
      {a.yearly && (
        <div className="text-xs text-muted-foreground">
          {a.yearly.basis === 'contributions' ? 'From every contribution' : `Since ${fmtDay(a.yearly.since)}`}
          {a.yearly.months < 24 && ` (${a.yearly.months} months only)`}
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs text-muted-foreground">
        <div>Paid in<b className="block text-[13px] text-foreground">{money(a.paidIn, a.currency)}</b></div>
        <div>Gain<b className={cn('block text-[13px]', a.gain >= 0 ? 'text-up' : 'text-down')}>{money(a.gain, a.currency)}</b></div>
        {a.fees !== null && <div>Fees so far<b className="block text-[13px] text-warn">{money(a.fees, a.currency)}</b></div>}
      </div>
      <form action={saveReleaseDate} className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
        <input type="hidden" name="accountId" value={a.id} />
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Unlocks
          <input type="date" name="date" defaultValue={a.releaseDate ?? ''} className="rounded-md border bg-background px-1.5 py-1 text-foreground" />
        </label>
        <button className="rounded-md border border-primary/40 px-2 py-1 font-semibold text-primary">Save</button>
        <span className="text-muted-foreground">
          {!a.locked ? 'Released' : years === null ? 'No date set' : `in ${years.toFixed(years < 2 ? 1 : 0)} years`}
        </span>
      </form>
      <History a={a} />
    </div>
  )
}

function Pilon1Card({ p }: { p: Pilon1View }) {
  return (
    <div className="my-2 rounded-[14px] border bg-card px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-sm">CNPP</b>
        <span className={cn('rounded-md border px-1.5 text-[11px]', p.stale ? 'border-warn/50 text-warn' : 'text-muted-foreground')}>
          {fmtDay(p.asOf)}{p.stale && ' · old'}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1.5 text-xs text-muted-foreground">
        <div>Contributed<b className="block text-[13px] text-foreground">{p.period.years} y {p.period.months} m</b></div>
        <div>Points<b className="block text-[13px] text-foreground">{p.points.toFixed(2)}</b></div>
        <div>This year<b className="block text-[13px] text-up">+{p.pointsThisYear.toFixed(2)}</b></div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Rough pension today: ≈ <b className="text-foreground">{money(p.pensionEstimate, 'RON')}/month</b> ({p.points.toFixed(2)} × {money(p.vpr, 'RON')}).
        Not counted in net worth.
      </p>
      <form action={saveVpr} className="mt-2 flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 text-muted-foreground">
          Point value
          <input name="vpr" type="number" inputMode="decimal" min="1" step="0.01" defaultValue={p.vpr / 100}
            className="w-20 rounded-md border bg-background px-1.5 py-1 text-right text-foreground tabular-nums" />
          RON
        </label>
        <button className="rounded-md border border-primary/40 px-2 py-1 font-semibold text-primary">Save</button>
      </form>
      <Pilon1History p={p} />
    </div>
  )
}

const SUMMARY = 'flex cursor-pointer list-none justify-between gap-2 [&::-webkit-details-marker]:hidden'

function History({ a }: { a: AccountView }) {
  const count = a.contributionsByYear.reduce((n, y) => n + y.items.length, 0)
  const m = (cents: number) => money(cents, a.currency)
  return (
    <details className="group/h mt-2.5 border-t pt-2 text-xs">
      <summary className={cn(SUMMARY, 'text-primary')}>
        <span>History · {count > 0 ? `${count} contributions` : `${a.statements.length} ${a.statements.length === 1 ? 'statement' : 'statements'}`}</span>
        <span className="transition-transform group-open/h:rotate-90">›</span>
      </summary>
      {count > 0 && (
        <div className="mt-1.5">
          {a.contributionsByYear.map(y => (
            <details key={y.year} className="group/y border-b last:border-0">
              <summary className={cn(SUMMARY, 'py-1.5')}>
                <span><span className="inline-block w-3 text-muted-foreground transition-transform group-open/y:rotate-90">›</span>{y.year} · {y.items.length}</span>
                <span className="tabular-nums">
                  <b>{m(y.gross)}</b>{y.fee > 0 && <span className="text-muted-foreground"> · fees {m(y.fee)}</span>}
                </span>
              </summary>
              {y.items.map((c, i) => (
                <div key={i} className="flex justify-between py-0.5 pl-3 text-muted-foreground tabular-nums">
                  <span>{fmtDay(c.date)}</span>
                  <span>{m(c.gross)}{c.fee > 0 && ` · fee ${m(c.fee)}`}</span>
                </div>
              ))}
            </details>
          ))}
        </div>
      )}
      <table className="mt-2 w-full text-right tabular-nums">
        <thead className="text-muted-foreground">
          <tr><th className="text-left font-normal">Statement</th><th className="font-normal">Value</th><th className="font-normal">Paid in</th><th className="font-normal">Gain</th></tr>
        </thead>
        <tbody>
          {a.statements.map(x => (
            <tr key={x.asOf}>
              <td className="py-0.5 text-left">{fmtDay(x.asOf)}</td>
              <td>{m(x.value)}</td>
              <td>{m(x.paidIn)}</td>
              <td className={x.value >= x.paidIn ? 'text-up' : 'text-down'}>{m(x.value - x.paidIn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function Pilon1History({ p }: { p: Pilon1View }) {
  return (
    <details className="group/h mt-2.5 border-t pt-2 text-xs">
      <summary className={cn(SUMMARY, 'text-primary')}>
        <span>Points per year · {p.pointsByYear.length} years</span>
        <span className="transition-transform group-open/h:rotate-90">›</span>
      </summary>
      <div className="mt-1.5">
        {[...p.pointsByYear].sort((x, y) => y.year - x.year).map(y => (
          <div key={y.year} className="flex justify-between border-b py-1 tabular-nums last:border-0">
            <span>{y.year}</span><b>{y.points.toFixed(2)}</b>
          </div>
        ))}
      </div>
    </details>
  )
}

function Section({ title }: { title: string }) {
  return <h3 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
}
