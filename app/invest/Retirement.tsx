import Link from 'next/link'
import { loadRetirement, type Retirement as RetirementData } from '@/src/retirement/load'
import type { TimelinePoint } from '@/src/retirement/chart'
import RetirementChart from './RetirementChart'
import ProjectionBars from './ProjectionBars'
import type { AccountView, Pilon1View } from '@/src/retirement/compute'
import { PROVIDER_NAME } from '@/src/retirement/types'
import { fmtAmount, fmtDay } from '@/src/dashboards/compute/today'
import { cn } from '@/lib/utils'
import { saveContribution, saveReleaseDate, saveReturn, saveVpr } from './retirement/actions'

const SHARE_COLORS = ['bg-primary', 'bg-violet-300', 'bg-up', 'bg-warn', 'bg-sky-300']
const pct = (x: number, digits = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`
const money = (cents: number, ccy: string) => fmtAmount(cents / 100, ccy)
const history = (points: TimelinePoint[]) => points.filter(p => p.value !== null)
const future = (points: TimelinePoint[]) => points.filter(p => p.projected !== null)
const monthLabel = (date: string) => new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
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
        <div className="rounded-[14px] border bg-card px-3.5 py-3 lg:px-5 lg:py-4">
          <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
            Locked until retirement
            <Link href="/upload" className="text-[13px] font-semibold text-primary">Upload statement</Link>
          </div>
          <div className="text-2xl font-bold tabular-nums lg:text-3xl">{money(s.locked, s.base)}</div>
          <div className="text-xs text-muted-foreground">
            Paid in {money(s.paidInLocked, s.base)} · Gain{' '}
            <span className={s.locked >= s.paidInLocked ? 'text-up' : 'text-down'}>{money(s.locked - s.paidInLocked, s.base)}</span>
            {s.available > 0 && <> · Released {money(s.available, s.base)}</>}
          </div>
          {s.projection.timeline.points.length > 1 && (
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div>
                <div className="text-xs text-muted-foreground">Value against money paid in</div>
                <div className="mt-1 h-44 lg:h-60"><RetirementChart points={history(s.projection.timeline.points)} base={s.base} /></div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Projected to unlock</div>
                <div className="mt-1 h-48 lg:h-64"><ProjectionBars points={future(s.projection.timeline.points)} base={s.base} /></div>
                <ProjectionLine s={s} />
              </div>
            </div>
          )}
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

      <div className="lg:hidden">
        {s.accounts.length > 0 && <Section title="Accounts" />}
        {s.accounts.map(a => <AccountCard key={a.id} a={a} s={s} today={today} />)}
        {s.pilon1 && <Section title="State pension · Pilon 1" />}
        {s.pilon1 && <Pilon1Card p={s.pilon1} />}
      </div>

      {(s.accounts.length > 0 || s.pilon1) && <AccountsTable s={s} today={today} />}
    </>
  )
}

function ReleaseForm({ a, today }: { a: AccountView; today: string }) {
  const years = a.releaseDate ? (Date.parse(a.releaseDate) - Date.parse(today)) / (365.25 * 86_400_000) : null
  return (
    <form action={saveReleaseDate} className="mt-2.5 flex flex-wrap items-center gap-2 self-start text-xs lg:mt-0">
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
  )
}

function AccountCard({ a, s, today }: { a: AccountView; s: RetirementData; today: string }) {
  const base = s.base
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
      <ReleaseForm a={a} today={today} />
      <ContributionForm a={a} s={s} />
      <AtUnlock a={a} s={s} />
      <History a={a} points={s.projection.byAccount.get(a.id) ?? []} base={base} />
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
      <VprForm p={p} />
      <Pilon1History p={p} />
    </div>
  )
}

const SMALL_INPUT = 'rounded-md border bg-background px-1.5 py-1 text-right text-foreground tabular-nums'
const SAVE = 'rounded-md border border-primary/40 px-2 py-1 font-semibold text-primary'

function ProjectionLine({ s }: { s: RetirementData }) {
  const f = s.projection.timeline.final
  return (
    <form action={saveReturn} className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {f && f.month > new Date().toISOString().slice(0, 7) && (
        <span>
          By {monthLabel(f.month)} ≈ <b className="text-foreground">{money(f.value, s.base)}</b>, of which {money(f.paidIn, s.base)} paid in,
        </span>
      )}
      <label className="flex items-center gap-1.5">
        if every account earns
        <input name="rate" type="number" inputMode="decimal" step="0.1" min="-10" max="30" defaultValue={+(s.projection.rate * 100).toFixed(2)} className={cn(SMALL_INPUT, 'w-14')} />
        % a year, before inflation.
      </label>
      <button className={SAVE}>Save</button>
    </form>
  )
}

function ContributionForm({ a, s }: { a: AccountView; s: RetirementData }) {
  const c = s.projection.contributions.get(a.id)
  if (!c || !a.locked) return null
  return (
    <form action={saveContribution} className="mt-2 flex flex-wrap lg:mt-0 items-center gap-2 self-start text-xs">
      <input type="hidden" name="accountId" value={a.id} />
      <label className="flex items-center gap-1.5 text-muted-foreground">
        Pays in
        <input name="amount" type="number" inputMode="decimal" min="0" step="1" defaultValue={c.isDefault ? '' : c.yearly / 100}
          placeholder={String(Math.round(c.yearly / 100))} className={cn(SMALL_INPUT, 'w-24')} />
        {a.currency} a year
      </label>
      <button className={SAVE}>Save</button>
      {c.isDefault && <span className="text-muted-foreground">from the last 12 months</span>}
    </form>
  )
}

function AtUnlock({ a, s }: { a: AccountView; s: RetirementData }) {
  const r = s.projection.timeline.atRelease.get(a.id)
  if (!r) return null
  return (
    <p className="mt-2 text-xs text-muted-foreground lg:mt-0">
      At unlock in {monthLabel(r.date)} ≈ <b className="text-foreground">{money(r.value, a.currency)}</b>, of which {money(r.paidIn, a.currency)} paid in.
    </p>
  )
}

function VprForm({ p }: { p: Pilon1View }) {
  return (
    <form action={saveVpr} className="mt-2 flex items-center gap-2 self-start text-xs lg:mt-0">
      <label className="flex items-center gap-1.5 text-muted-foreground">
        Point value
        <input name="vpr" type="number" inputMode="decimal" min="1" step="0.01" defaultValue={p.vpr / 100}
          className="w-20 rounded-md border bg-background px-1.5 py-1 text-right text-foreground tabular-nums" />
        RON
      </label>
      <button className="rounded-md border border-primary/40 px-2 py-1 font-semibold text-primary">Save</button>
    </form>
  )
}

const SUMMARY = 'flex cursor-pointer list-none justify-between gap-2 [&::-webkit-details-marker]:hidden'

const contributionCount = (a: AccountView) => a.contributionsByYear.reduce((n, y) => n + y.items.length, 0)

function History({ a, points, base }: { a: AccountView; points: TimelinePoint[]; base: string }) {
  const count = contributionCount(a)
  return (
    <details className="group/h mt-2.5 border-t pt-2 text-xs">
      <summary className={cn(SUMMARY, 'text-primary')}>
        <span>History · {count > 0 ? `${count} contributions` : `${a.statements.length} ${a.statements.length === 1 ? 'statement' : 'statements'}`}</span>
        <span className="transition-transform group-open/h:rotate-90">›</span>
      </summary>
      <HistoryBody a={a} points={points} base={base} />
    </details>
  )
}

function HistoryBody({ a, points, base }: { a: AccountView; points: TimelinePoint[]; base: string }) {
  const m = (cents: number) => money(cents, a.currency)
  return (
    <>
      {history(points).length > 1 && <div className="mt-2 mb-3 h-40 lg:h-52"><RetirementChart points={history(points)} base={base} /></div>}
      {contributionCount(a) > 0 && (
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
    </>
  )
}

function Pilon1History({ p }: { p: Pilon1View }) {
  return (
    <details className="group/h mt-2.5 border-t pt-2 text-xs">
      <summary className={cn(SUMMARY, 'text-primary')}>
        <span>Points per year · {p.pointsByYear.length} years</span>
        <span className="transition-transform group-open/h:rotate-90">›</span>
      </summary>
      <PointsByYear p={p} />
    </details>
  )
}

function PointsByYear({ p }: { p: Pilon1View }) {
  return (
    <div className="mt-1.5">
      {[...p.pointsByYear].sort((x, y) => y.year - x.year).map(y => (
        <div key={y.year} className="flex justify-between border-b py-1 tabular-nums last:border-0">
          <span>{y.year}</span><b>{y.points.toFixed(2)}</b>
        </div>
      ))}
    </div>
  )
}

const COLS = 'grid grid-cols-[minmax(0,2.4fr)_repeat(3,minmax(0,1.2fr))_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_1rem] items-baseline gap-x-4 px-5'
const ROW = cn(COLS, 'cursor-pointer list-none py-3 hover:bg-accent/40 [&::-webkit-details-marker]:hidden')
const unlockLabel = (a: AccountView) =>
  !a.locked ? 'Released' : a.releaseDate ? new Date(`${a.releaseDate}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Not set'

/** Desktop: one row per account; a row opens to its history and its unlock date. */
function AccountsTable({ s, today }: { s: RetirementData; today: string }) {
  const base = (cents: number | null) => (cents === null ? '–' : money(cents, s.base))
  const paidIn = s.accounts.reduce((n, a) => n + (a.paidInBase ?? 0), 0)
  const value = s.locked + s.available
  return (
    <div className="mt-5 hidden overflow-hidden rounded-[14px] border bg-card text-sm lg:block">
      <div className={cn(COLS, 'border-b py-2 text-xs text-muted-foreground [&>span]:text-right [&>span:first-child]:text-left')}>
        <span>Account</span><span>Value</span><span>Paid in</span><span>Gain</span><span>Return</span><span>Fees</span><span>Unlocks</span><span>Statement</span><span />
      </div>
      {s.accounts.map(a => {
        const gain = a.valueBase !== null && a.paidInBase !== null ? a.valueBase - a.paidInBase : null
        return (
          <details key={a.id} className="group/r border-b">
            <summary className={cn(ROW, 'tabular-nums [&>span]:text-right [&>span]:whitespace-nowrap')}>
              <b className="truncate font-semibold">{title(a)}</b>
              <span>
                {base(a.valueBase)}
                {a.currency !== s.base && <span className="block text-xs text-muted-foreground">{money(a.value, a.currency)}</span>}
              </span>
              <span>{base(a.paidInBase)}</span>
              <span className={gain === null ? '' : gain >= 0 ? 'text-up' : 'text-down'}>{base(gain)}</span>
              <span className={a.gain >= 0 ? 'text-up' : 'text-down'}>{a.yearly ? `${pct(a.yearly.rate)}/yr` : `${pct(a.gainPct, 0)} total`}</span>
              <span className="text-warn">{a.fees === null ? '–' : money(a.fees, a.currency)}</span>
              <span className={cn(!a.releaseDate && a.locked && 'text-muted-foreground')}>{unlockLabel(a)}</span>
              <span className={a.stale ? 'text-warn' : 'text-muted-foreground'}>{fmtDay(a.asOf)}</span>
              <span className="text-muted-foreground transition-transform group-open/r:rotate-90">›</span>
            </summary>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-8 border-t bg-background/40 px-5 py-4 text-xs">
              <div>
                <div className="mb-1 text-muted-foreground">
                  {contributionCount(a) > 0 ? `${contributionCount(a)} contributions by year` : `${a.statements.length} ${a.statements.length === 1 ? 'statement' : 'statements'}`}
                  {a.yearly && ` · return ${a.yearly.basis === 'contributions' ? 'from every contribution' : `since ${fmtDay(a.yearly.since)}`}`}
                  {a.yearly && a.yearly.months < 24 && ` (${a.yearly.months} months only)`}
                </div>
                <HistoryBody a={a} points={s.projection.byAccount.get(a.id) ?? []} base={s.base} />
              </div>
              <div className="flex flex-col gap-3">
                <ReleaseForm a={a} today={today} />
                <ContributionForm a={a} s={s} />
                <AtUnlock a={a} s={s} />
              </div>
            </div>
          </details>
        )
      })}
      {s.accounts.length > 0 && (
        <div className={cn(COLS, 'border-b py-3 font-semibold tabular-nums [&>span]:text-right')}>
          <span className="!text-left">Total</span>
          <span>{base(value)}</span>
          <span>{base(paidIn)}</span>
          <span className={value >= paidIn ? 'text-up' : 'text-down'}>{base(value - paidIn)}</span>
          <span /><span /><span /><span /><span />
        </div>
      )}
      {s.pilon1 && (
        <details className="group/r">
          <summary className={cn(SUMMARY, 'items-baseline px-5 py-3 hover:bg-accent/40')}>
            <span>
              <b className="font-semibold">State pension</b>
              <span className="ml-3 text-muted-foreground tabular-nums">
                {s.pilon1.points.toFixed(2)} points, +{s.pilon1.pointsThisYear.toFixed(2)} this year, {s.pilon1.period.years} y {s.pilon1.period.months} m contributed.
                Rough pension today ≈ <b className="text-foreground">{money(s.pilon1.pensionEstimate, 'RON')}/month</b>, not counted in net worth.
              </span>
            </span>
            <span className="flex gap-4">
              <span className={s.pilon1.stale ? 'text-warn' : 'text-muted-foreground'}>{fmtDay(s.pilon1.asOf)}</span>
              <span className="text-muted-foreground transition-transform group-open/r:rotate-90">›</span>
            </span>
          </summary>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-8 border-t bg-background/40 px-5 py-4 text-xs">
            <div><div className="mb-1 text-muted-foreground">Points per year</div><PointsByYear p={s.pilon1} /></div>
            <VprForm p={s.pilon1} />
          </div>
        </details>
      )}
    </div>
  )
}

function Section({ title }: { title: string }) {
  return <h3 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
}
