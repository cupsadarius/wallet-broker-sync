import Link from 'next/link'
import { db } from '@/src/storage/db'
import { brokerAccountMap } from '@/src/storage/schema'
import { ensureFreshMirror } from '@/src/dashboards/mirror'
import { loadMaturities, loadPerformance, loadPlans, loadPositions } from '@/src/dashboards/portfolio'
import { SUGGESTED_PLANS } from '@/src/dashboards/compute/plans'
import type { Position } from '@/src/dashboards/compute/positions'
import { fmtAmount } from '@/src/dashboards/compute/today'
import { PlanTagPill } from '@/app/components/PlanBits'
import { cn } from '@/lib/utils'
import Page from '@/app/ui/Page'
import PageHeader from '@/app/ui/PageHeader'
import Hero from '@/app/ui/Hero'
import Segmented from '@/app/ui/Segmented'
import TimeChart from '@/app/ui/TimeChart'
import { whole } from '@/app/ui/chartFormat'
import { addSuggestedPlan, setPlanStatus } from './plans/actions'
import Retirement from './Retirement'

const TABS = [
  { id: 'positions', label: 'Positions' },
  { id: 'performance', label: 'Performance' },
  { id: 'plans', label: 'Plans' },
  { id: 'retirement', label: 'Retirement' },
] as const
type Tab = (typeof TABS)[number]['id']
type Q = { tab?: string; view?: string; account?: string; range?: string }
const RANGES = [{ value: '1y', label: '1Y', years: 1 }, { value: '3y', label: '3Y', years: 3 }, { value: 'all', label: 'All', years: null }] as const

const since = (years: number | null) => years === null ? '' : new Date(Date.now() - years * 365.25 * 86_400_000).toISOString().slice(0, 10)
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${whole(Math.abs(n))}`
const pct = (v: number | null, digits = 1) => v === null ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(digits)}%`
const href = (q: Q, change: Partial<Q>) => {
  const next = { tab: q.tab, account: q.account, range: q.range, ...change }
  const params = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => !!e[1] && !(e[0] === 'tab' && e[1] === 'positions')))
  return `/invest${params.size ? `?${params}` : ''}`
}

export default async function InvestPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams
  const tab: Tab = TABS.find(t => t.id === q.tab)?.id ?? 'positions'
  return (
    <Page>
      <PageHeader title="Invest" active={tab} tabs={TABS.map(t => ({ ...t, href: t.id === 'positions' ? '/invest' : `/invest?tab=${t.id}` }))} />
      {tab === 'positions' && <Positions q={q} />}
      {tab === 'performance' && <Performance q={q} />}
      {tab === 'plans' && <Plans />}
      {tab === 'retirement' && <Retirement view={q.view} account={q.account} />}
    </Page>
  )
}

function NotConfigured() {
  return <p className="text-sm text-muted-foreground">Wallet is not connected. Open <Link href="/setup" className="text-primary">setup</Link>.</p>
}

/** Value against money paid in, cut to the `?range=`. */
function ValueChart({ q, series, base, label }: { q: Q; series: { date: string; valueBase: number; putInBase: number }[]; base: string; label: string }) {
  const range = RANGES.find(r => r.value === q.range) ?? RANGES[1]
  const from = since(range.years)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Segmented label="Chart range" value={range.value} options={RANGES.map(r => ({ value: r.value, label: r.label, href: href(q, { range: r.value === '3y' ? undefined : r.value }) }))} />
      </div>
      <TimeChart unit={base} label={label} points={series.filter(p => p.date >= from).map(p => ({ date: p.date, value: p.valueBase, paidIn: p.putInBase }))} />
    </div>
  )
}

async function Positions({ q }: { q: Q }) {
  const [d, perf] = await Promise.all([loadPositions(), loadPerformance()])
  if (!d || !perf) return <NotConfigured />
  const brokers = perf.brokers.map(b => b.name)
  const account = brokers.find(b => b === q.account)
  const broker = account ? perf.brokers.find(b => b.name === account) : undefined
  const holdings = d.positions.filter(p => p.kind === 'holding' && (!account || p.group === account)).sort((a, b) => b.valueBase - a.valueBase)
  const fixed = d.positions.filter(p => p.kind !== 'holding')
  const bonds = account ? 0 : d.positions.filter(p => p.kind === 'bond').reduce((n, p) => n + p.valueBase, 0)
  const value = account ? holdings.reduce((n, p) => n + p.valueBase, 0) : d.investedBase
  const cost = account ? holdings.reduce((n, p) => n + p.costBase, 0) : d.costBase
  const gain = value - cost
  const total = holdings.reduce((n, p) => n + p.valueBase, 0)
  return (
    <>
      <Segmented label="Account" value={account ?? ''} options={[
        { value: '', label: 'All accounts', href: href(q, { account: undefined }) },
        ...brokers.map(b => ({ value: b, label: b, href: href(q, { account: b }) })),
      ]} />
      <Hero label="Portfolio value" value={whole(value)} unit={d.base}
        sub={`${signed(gain)}${cost > 0 ? ` (${pct(gain / cost)})` : ''} gain`} subTone={gain >= 0 ? 'good' : 'bad'}
        stats={[
          { label: 'Paid in', value: whole(cost) },
          { label: 'Return a year', value: pct((broker?.perf ?? perf.total).mwr) },
          ...(bonds > 0 ? [{ label: 'Of which bonds', value: whole(bonds) }] : []),
        ]}
        chart={<ValueChart q={q} series={broker?.series ?? perf.series} base={d.base} label="Portfolio value against money paid in" />} />
      <section aria-labelledby="positions" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 id="positions" className="text-lg font-semibold">Positions <span className="text-muted-foreground">{holdings.length}</span></h2>
          <span className="text-[0.8125rem] text-muted-foreground">Sorted by value</span>
        </div>
        {holdings.length === 0 && <p className="text-sm text-muted-foreground">No holdings. <Link href="/upload" className="text-primary">Upload a statement</Link> to see them.</p>}
        {holdings.length > 0 && <PositionTable rows={holdings} total={total} showAccount={!account} />}
      </section>
      {!account && fixed.length > 0 && (
        <section aria-labelledby="fixed" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 id="fixed" className="text-lg font-semibold">Deposits and bonds</h2>
            <Link href="/invest/maturities" className="text-[0.8125rem] text-primary">Manage</Link>
          </div>
          <ul>
            {fixed.map(p => (
              <li key={p.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b py-3 last:border-0">
                <b className="truncate">{p.name ?? p.symbol}</b>
                <b className="text-right">{whole(p.valueBase)}</b>
                <span className="text-[0.8125rem] text-muted-foreground">{p.kind === 'deposit' ? 'Deposit, counted as cash' : 'Bond, par and accrued interest'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function PositionTable({ rows, total, showAccount }: { rows: Position[]; total: number; showAccount: boolean }) {
  const ret = (p: Position) => p.basis === 'market' && p.costBase > 0 ? (p.valueBase - p.costBase) / p.costBase : null
  return (
    <>
      <table className="hidden w-full text-right text-sm lg:table">
        <thead className="text-[0.8125rem] text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 text-left font-normal">Holding</th>
            {showAccount && <th className="text-left font-normal">Account</th>}
            <th className="font-normal">Value</th><th className="font-normal">Gain</th><th className="font-normal">Return</th>
            <th className="w-48 pl-6 text-left font-normal">Share of portfolio</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.key} className="border-b last:border-0">
              <td className="max-w-80 truncate py-3 text-left"><b>{p.symbol}</b> <span className="text-muted-foreground">{p.name}</span></td>
              {showAccount && <td className="text-left text-muted-foreground">{p.group}</td>}
              <td>{whole(p.valueBase)}</td>
              <td className={p.basis === 'market' ? (p.valueBase >= p.costBase ? 'text-up' : 'text-down') : 'text-muted-foreground'}>
                {p.basis === 'market' ? signed(p.valueBase - p.costBase) : 'at cost'}
              </td>
              <td className="text-muted-foreground">{pct(ret(p))}</td>
              <td className="pl-6">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="h-1.5 flex-1 rounded-full bg-fill"><span className="block h-full rounded-full bg-primary" style={{ width: `${(p.valueBase / total) * 100}%` }} /></span>
                  <span className="w-10 text-[0.8125rem] text-muted-foreground">{Math.round((p.valueBase / total) * 100)}%</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="lg:hidden">
        {rows.map(p => (
          <li key={p.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b py-3 last:border-0">
            <b className="truncate">{p.symbol} <span className="font-normal text-muted-foreground">{p.name}</span></b>
            <b className="text-right">{whole(p.valueBase)}</b>
            <span className="truncate text-[0.8125rem] text-muted-foreground">{showAccount ? p.group : `${Math.round((p.valueBase / total) * 100)}% of portfolio`}</span>
            <span className={cn('text-right text-[0.8125rem]', p.basis !== 'market' ? 'text-muted-foreground' : p.valueBase >= p.costBase ? 'text-up' : 'text-down')}>
              {p.basis === 'market' ? `${signed(p.valueBase - p.costBase)} (${pct(ret(p))})` : 'at cost'}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

async function Performance({ q }: { q: Q }) {
  const d = await loadPerformance()
  if (!d) return <NotConfigured />
  const { total, base } = d
  const putIn = d.series.at(-1)?.putInBase ?? 0
  const LABEL = { dividend: 'Dividends', coupon: 'Coupons', interest: 'Deposit interest' } as const
  return (
    <>
      <Hero label="Total return" value={signed(total.totalReturnBase)} unit={base}
        sub={`${pct(total.mwr)} a year (XIRR)`} subTone={total.totalReturnBase >= 0 ? 'good' : 'bad'}
        stats={[
          { label: 'Value', value: whole(total.currentValueBase) },
          { label: 'Money put in', value: whole(putIn) },
          ...(total.twr !== null ? [{ label: 'Time-weighted return', value: `${pct(total.twr)} a year` }] : []),
        ]}
        chart={<ValueChart q={q} series={d.series} base={base} label="Value against money put in" />} />
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <section aria-labelledby="per-broker" className="flex flex-col gap-2">
          <h2 id="per-broker" className="text-lg font-semibold">Return per broker</h2>
          <ul>
            {d.brokers.map(b => (
              <li key={b.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b py-3 last:border-0">
                <b>{b.name}</b>
                <b className="text-right">{pct(b.perf.mwr)} a year</b>
                <span className="text-[0.8125rem] text-muted-foreground">Value {fmtAmount(b.perf.currentValueBase, base)}</span>
                <span className={cn('text-right text-[0.8125rem]', b.perf.totalReturnBase >= 0 ? 'text-up' : 'text-down')}>{signed(b.perf.totalReturnBase)} {base}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="income" className="flex flex-col gap-2">
          <h2 id="income" className="text-lg font-semibold">Income received</h2>
          <ul>
            {d.incomeTotals.map(i => (
              <li key={i.kind} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b py-3 last:border-0">
                <b>{LABEL[i.kind]}</b>
                <b className="text-right">{whole(i.lastYear)}</b>
                <span className="text-[0.8125rem] text-muted-foreground">Last 12 months</span>
                <span className="text-right text-[0.8125rem] text-muted-foreground">{whole(i.allTime)} in total</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}

async function Plans() {
  const s = await ensureFreshMirror(5 * 60_000)
  if (!s) return <NotConfigured />
  const views = await loadPlans(s, await loadMaturities())
  const active = views.filter(v => v.plan.status === 'active')
  const behind = active.filter(v => v.progress.tag === 'behind').length
  const mapped = new Map((await db.select().from(brokerAccountMap)).map(r => [r.broker, r.accountId]))
  const suggestions = views.length ? [] : SUGGESTED_PLANS.filter(p => mapped.has(p.broker))
  return (
    <>
      {views.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">No plans yet. Add one, or start from a suggestion below.</p>
          <Link href="/invest/plans" className="flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">New plan</Link>
        </div>
      ) : (
      <Hero label="Active plans" value={String(active.length)}
        sub={behind ? `${behind} behind` : 'All on track'} subTone={behind ? 'bad' : 'good'}
        stats={[
          { label: 'Paused', value: String(views.filter(v => v.plan.status === 'paused').length) },
          { label: 'Archived', value: String(views.filter(v => v.plan.status === 'archived').length) },
        ]}>
        <Link href="/invest/plans" className="mt-5 flex min-h-11 w-fit items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">New plan</Link>
      </Hero>
      )}
      <ul className="grid gap-3 lg:grid-cols-2">
        {views.map(({ plan: p, accountName, progress: g }) => (
          <li key={p.id} className={cn('rounded-2xl border bg-card px-4 py-3', p.status === 'archived' && 'opacity-60')}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 font-semibold">{p.name} <span className="font-normal text-muted-foreground">· {accountName}</span></span>
              <PlanTagPill tag={g.tag} label={g.tag === 'behind' && g.periodsBehind ? `${g.periodsBehind} behind` : undefined} />
            </div>
            <div aria-hidden className="mt-2.5 mb-1.5 h-[0.4375rem] overflow-hidden rounded-full bg-fill">
              <span className={cn('block h-full rounded-full', p.status === 'active' ? 'bg-primary' : 'bg-neutral')} style={{ width: `${Math.round(g.ring * 100)}%` }} />
            </div>
            <div className="text-[0.8125rem] text-muted-foreground">{g.detail}</div>
            {(g.holding || g.action) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="min-w-0 text-[0.8125rem] text-muted-foreground">{g.holding}</span>
                {g.action && <span className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[0.8125rem] font-semibold text-primary-foreground">{g.action}</span>}
              </div>
            )}
            <div className="mt-2 flex gap-4 border-t pt-2 text-[0.8125rem]">
              <Link href={`/invest/plans?id=${p.id}`} className="flex min-h-9 items-center text-primary">Edit</Link>
              {p.status === 'active' && <StatusButton id={p.id} status="paused" label="Pause" />}
              {p.status !== 'active' && <StatusButton id={p.id} status="active" label="Resume" />}
              {p.status !== 'archived' && <StatusButton id={p.id} status="archived" label="Archive" />}
            </div>
          </li>
        ))}
      </ul>
      {suggestions.length > 0 && (
        <section aria-labelledby="suggested" className="flex flex-col gap-2">
          <h2 id="suggested" className="text-lg font-semibold">Suggested from your history</h2>
          {suggestions.map(sg => (
            <form key={sg.key} action={addSuggestedPlan} className="flex items-center gap-3 rounded-2xl border border-dashed bg-card px-4 py-3">
              <input type="hidden" name="key" value={sg.key} />
              <div className="min-w-0">
                <div className="font-semibold">{sg.name} {sg.status === 'paused' && <span className="text-xs font-normal text-muted-foreground">· paused</span>}</div>
                <div className="text-[0.8125rem] text-muted-foreground">{sg.why}</div>
              </div>
              <button className="ml-auto min-h-9 shrink-0 rounded-lg border border-line-2 px-3 text-[0.8125rem] font-semibold">Add</button>
            </form>
          ))}
        </section>
      )}
    </>
  )
}

function StatusButton({ id, status, label }: { id: number; status: 'active' | 'paused' | 'archived'; label: string }) {
  return (
    <form action={setPlanStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className="min-h-9 text-primary">{label}</button>
    </form>
  )
}
