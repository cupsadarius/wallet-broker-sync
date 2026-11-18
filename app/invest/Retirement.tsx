import Link from 'next/link'
import { loadRetirement, type Retirement as RetirementData } from '@/src/retirement/load'
import { defaultYearlyContribution, inTodaysMoney, type TimelinePoint } from '@/src/retirement/chart'
import type { AccountView, Pilon1View } from '@/src/retirement/compute'
import { PROVIDER_NAME } from '@/src/retirement/types'
import { fmtDay } from '@/src/dashboards/compute/today'
import { cn } from '@/lib/utils'
import Hero from '@/app/ui/Hero'
import ListDetail from '@/app/ui/ListDetail'
import Segmented from '@/app/ui/Segmented'
import TimeChart, { type TimePoint } from '@/app/ui/TimeChart'
import Bars from '@/app/ui/Bars'
import { big, whole } from '@/app/ui/chartFormat'
import { pickSelected } from '@/app/ui/select'
import ProjectionBars from './ProjectionBars'
import { AccountEdit, Pilon1Edit, ReturnEdit } from './RetirementEdit'

const PILON1 = 'pilon1'
const VIEWS = [{ value: 'line', label: 'Line' }, { value: '5', label: 'Every 5 years' }, { value: '10', label: 'Every 10 years' }]
const href = (q: { view?: string; account?: string }) =>
  `/invest?${new URLSearchParams({ tab: 'retirement', ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)) })}`
const m = (cents: number) => whole(cents / 100)
const signed = (cents: number) => `${cents >= 0 ? '+' : '−'}${whole(Math.abs(cents) / 100)}`
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const monthYear = (d: string) => new Date(`${d.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const toPoints = (points: TimelinePoint[]): TimePoint[] =>
  points.map(p => ({ date: p.month, value: p.value === null ? null : p.value / 100, projected: p.projected === null ? null : p.projected / 100, paidIn: p.paidIn / 100 }))
const name = (a: AccountView) => a.kind === 'pilon2' ? 'Pilon 2' : a.kind === 'pilon3' ? 'Pilon 3' : 'Unit-linked policy'
const returnLabel = (a: AccountView) => a.yearly ? `${pct(a.yearly.rate)} a year` : `${a.gainPct >= 0 ? '+' : ''}${pct(a.gainPct)} total`

type Item = { id: string; account?: AccountView; pilon1?: Pilon1View }

export default async function Retirement({ view = 'line', account }: { view?: string; account?: string }) {
  const today = new Date().toISOString().slice(0, 10)
  const s = await loadRetirement(today)
  if (s.accounts.length === 0 && !s.pilon1) {
    return (
      <p className="text-sm text-muted-foreground">
        No statements yet. <Link href="/upload" className="text-primary">Upload</Link> your pension and policy PDFs to see them here.
      </p>
    )
  }
  const items: Item[] = [...s.accounts.map(a => ({ id: a.id, account: a })), ...(s.pilon1 ? [{ id: PILON1, pilon1: s.pilon1 }] : [])]
  const { selected, fromParam } = pickSelected(items, account)
  const percent = +(s.projection.rate * 100).toFixed(2)
  return (
    <div className="flex flex-col gap-6">
      <div className={cn('flex items-center justify-end gap-3 text-[0.8125rem] text-muted-foreground', fromParam && 'max-lg:hidden')}>
        Projection: {percent}% a year, current contributions
        <ReturnEdit percent={percent} />
      </div>
      <div className={cn(fromParam && 'max-lg:hidden')}><RetirementHero s={s} today={today} view={view} account={account} /></div>
      <ListDetail open={fromParam} backHref={href({ view })} backLabel="Retirement"
        list={<AccountList items={items} s={s} selected={selected?.id} view={view} />}
        detail={selected?.account ? <AccountDetail a={selected.account} s={s} percent={percent} />
          : selected?.pilon1 ? <Pilon1Detail p={selected.pilon1} /> : null} />
    </div>
  )
}

function RetirementHero({ s, today, view, account }: { s: RetirementData; today: string; view: string; account?: string }) {
  const f = s.projection.timeline.final
  const future = f && f.month > today.slice(0, 7) ? f : null
  const value = s.locked + s.available
  const paidIn = s.accounts.reduce((n, a) => n + (a.paidInBase ?? 0), 0)
  const points = s.projection.timeline.points
  const step = view === '5' ? 5 : view === '10' ? 10 : null
  return (
    <Hero
      label={future ? `At unlock, ${monthYear(future.month)}` : 'Locked until retirement'}
      value={future ? `≈ ${big(future.value / 100)}` : whole(s.locked / 100)} unit={s.base}
      sub={future && <span title="Takes off 3% inflation a year">≈ {big(inTodaysMoney(future.value, today, `${future.month}-01`) / 100)} in today&apos;s money</span>}
      subTone="plain"
      stats={[
        { label: 'Value today', value: m(value) },
        { label: 'Paid in', value: m(paidIn) },
        { label: 'Gain', value: `${signed(value - paidIn)}${paidIn > 0 ? ` (${value >= paidIn ? '+' : ''}${Math.round((value / paidIn - 1) * 100)}%)` : ''}`, tone: value >= paidIn ? 'good' : 'bad' },
        ...(s.pilon1 ? [{ label: 'Pilon 1', value: `≈ ${m(s.pilon1.pensionEstimate)} a month` }] : []),
      ]}
      chart={points.length > 1 && (
        <div className="flex flex-col gap-2">
          {future && <div className="flex justify-end"><Segmented label="Chart view" value={view} options={VIEWS.map(v => ({ ...v, href: href({ view: v.value, account }) }))} /></div>}
          {step && future
            ? <ProjectionBars points={points.filter(p => p.projected !== null)} base={s.base} step={step} />
            : <TimeChart points={toPoints(points)} today={today.slice(0, 7)} unit={s.base} label="Retirement value, paid in and projection" />}
        </div>
      )}
    />
  )
}

function AccountList({ items, s, selected, view }: { items: Item[]; s: RetirementData; selected?: string; view: string }) {
  return (
    <section aria-labelledby="accounts">
      <h2 id="accounts" className="mb-2 text-lg font-semibold">Accounts <span className="text-muted-foreground">{s.accounts.length}</span></h2>
      <ul className="flex flex-col gap-1">
        {items.map(({ id, account: a, pilon1: p }) => (
          <li key={id}>
            <Link href={href({ view, account: id })} scroll={false} aria-current={id === selected ? 'true' : undefined}
              className={cn('grid min-h-14 grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-xl px-4 py-3 tabular-nums hover:bg-accent', id === selected && 'lg:bg-secondary')}>
              {a && <>
                <b className="truncate">{name(a)}</b>
                <b className="text-right">{a.valueBase === null ? `${m(a.value)} ${a.currency}` : m(a.valueBase)}</b>
                <span className="truncate text-[0.8125rem] text-muted-foreground">
                  {PROVIDER_NAME[a.provider]}{a.currency !== s.base && `, ${a.currency}`}, {!a.locked ? 'released' : a.releaseDate ? `unlocks ${a.releaseDate.slice(0, 4)}` : 'no unlock date'}
                </span>
                <span className={cn('text-right text-[0.8125rem]', a.gain >= 0 ? 'text-muted-foreground' : 'text-down')}>{returnLabel(a)}</span>
              </>}
              {p && <>
                <b>Pilon 1</b>
                <b className="text-right">{p.points.toFixed(1)} points</b>
                <span className="text-[0.8125rem] text-muted-foreground">State pension</span>
                <span className="text-right text-[0.8125rem] text-muted-foreground">≈ {m(p.pensionEstimate)} a month</span>
              </>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

const CARD = 'flex flex-col gap-6 rounded-2xl border bg-card p-5 tabular-nums lg:p-6'
const SUMMARY = 'flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm text-primary [&::-webkit-details-marker]:hidden'

function AccountDetail({ a, s, percent }: { a: AccountView; s: RetirementData; percent: number }) {
  const atUnlock = s.projection.timeline.atRelease.get(a.id)
  const c = s.projection.contributions.get(a.id)
  const fallback = defaultYearlyContribution(a)
  const points = s.projection.byAccount.get(a.id) ?? []
  const payments = a.contributionsByYear.reduce((n, y) => n + y.items.length, 0)
  return (
    <article aria-label={name(a)} className={CARD}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{name(a)}</h2>
          <p className="text-[0.8125rem] text-muted-foreground">
            {PROVIDER_NAME[a.provider]}{a.kind === 'unit-linked' && `, ${a.product}`}. Last statement{' '}
            <span className={cn(a.stale && 'text-warn')}>{fmtDay(a.asOf)}{a.stale && ', old'}</span>.
          </p>
        </div>
        {atUnlock && (
          <div className="sm:text-right">
            <div className="text-[0.8125rem] text-muted-foreground">At unlock, {fmtDay(atUnlock.date)}</div>
            <div className="text-2xl font-bold">≈ {big(atUnlock.value / 100)}{a.currency !== s.base && ` ${a.currency}`}</div>
          </div>
        )}
        {!a.locked && <span className="text-sm text-muted-foreground">Released</span>}
      </header>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['Value', `${m(a.value)}${a.currency !== s.base ? ` ${a.currency}` : ''}`, ''],
          ['Paid in', m(a.paidIn), ''],
          ['Gain', signed(a.gain), a.gain >= 0 ? 'text-up' : 'text-down'],
          ['Return', returnLabel(a), ''],
        ].map(([label, value, tone]) => (
          <div key={label}><dt className="text-[0.8125rem] text-muted-foreground">{label}</dt><dd className={cn('text-lg font-semibold', tone)}>{value}</dd></div>
        ))}
      </dl>
      {a.currency !== s.base && (
        <p className="-mt-3 text-[0.8125rem] text-muted-foreground">{a.valueBase === null ? 'No exchange rate today.' : `≈ ${m(a.valueBase)} ${s.base} at today's rate. The chart is in ${s.base}.`}</p>
      )}
      <TimeChart points={toPoints(points)} today={new Date().toISOString().slice(0, 7)} unit={s.base} height={200} label={`${name(a)} value and projection`} />
      {payments > 0 && (
        <section aria-labelledby={`paid-${a.id}`} className="flex flex-col gap-2">
          <h3 id={`paid-${a.id}`} className="font-semibold">Paid in each year</h3>
          <Bars data={[...a.contributionsByYear].reverse().map(y => ({ label: String(y.year), value: y.gross / 100 }))} unit={a.currency} height={150} label="Paid in each year" valueName="Paid in" />
          <details>
            <summary className={SUMMARY}>Show all {payments} payments</summary>
            <ul className="text-[0.8125rem]">
              {a.contributionsByYear.flatMap(y => y.items).map((p, i) => (
                <li key={i} className="flex justify-between border-b py-1.5 last:border-0">
                  <span className="text-muted-foreground">{fmtDay(p.date)}</span>
                  <span>{m(p.gross)}{p.fee > 0 && <span className="text-muted-foreground">, fee {m(p.fee)}</span>}</span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
      <div className="flex flex-col gap-3 border-t pt-4 text-[0.8125rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        {a.locked && c ? (
          <>
            <p>
              Projection uses {percent}% a year, {m(c.yearly)} {a.currency} a year paid in{c.isDefault && ' (last 12 months)'}
              {a.releaseDate ? ` and unlock on ${fmtDay(a.releaseDate)}.` : '. Set an unlock date to see the value at unlock.'}
            </p>
            <AccountEdit id={a.id} name={name(a)} currency={a.currency} value={a.value} paidIn={a.paidIn} asOf={a.asOf}
              releaseDate={a.releaseDate} contribution={c.isDefault ? null : c.yearly} fallback={fallback} percent={percent} />
          </>
        ) : <p>This money is released. It counts as usable money on Today.</p>}
      </div>
      <details>
        <summary className={SUMMARY}>{a.statements.length} {a.statements.length === 1 ? 'statement' : 'statements'}</summary>
        <table className="w-full text-right text-[0.8125rem]">
          <thead className="text-muted-foreground">
            <tr><th className="py-1 text-left font-normal">Date</th><th className="font-normal">Value</th><th className="font-normal">Paid in</th><th className="font-normal">Gain</th></tr>
          </thead>
          <tbody>
            {a.statements.map(x => (
              <tr key={x.asOf} className="border-t">
                <td className="py-1.5 text-left">{fmtDay(x.asOf)}</td>
                <td>{m(x.value)}</td>
                <td>{m(x.paidIn)}</td>
                <td className={x.value >= x.paidIn ? 'text-up' : 'text-down'}>{signed(x.value - x.paidIn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </article>
  )
}

function Pilon1Detail({ p }: { p: Pilon1View }) {
  return (
    <article aria-label="Pilon 1" className={CARD}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Pilon 1</h2>
          <p className="text-[0.8125rem] text-muted-foreground">
            State pension, CNPP. Last statement <span className={cn(p.stale && 'text-warn')}>{fmtDay(p.asOf)}{p.stale && ', old'}</span>.
          </p>
        </div>
        <div className="sm:text-right">
          <div className="text-[0.8125rem] text-muted-foreground">Rough pension today</div>
          <div className="text-2xl font-bold">≈ {m(p.pensionEstimate)} <span className="text-base font-medium text-muted-foreground">RON a month</span></div>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['Points', p.points.toFixed(2)],
          ['This year', `+${p.pointsThisYear.toFixed(2)}`],
          ['Contributed', `${p.period.years} y ${p.period.months} m`],
          ['Point value', `${(p.vpr / 100).toFixed(2)} RON`],
        ].map(([label, value]) => (
          <div key={label}><dt className="text-[0.8125rem] text-muted-foreground">{label}</dt><dd className="text-lg font-semibold">{value}</dd></div>
        ))}
      </dl>
      <Bars data={[...p.pointsByYear].sort((x, y) => x.year - y.year).map(y => ({ label: String(y.year), value: y.points }))}
        unit="points" height={150} label="Points each year" valueName="Points" />
      <div className="flex flex-col gap-3 border-t pt-4 text-[0.8125rem] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>The estimate is {p.points.toFixed(2)} points times {(p.vpr / 100).toFixed(2)} RON. It is not in net worth.</p>
        <Pilon1Edit vpr={p.vpr} />
      </div>
    </article>
  )
}
