import Link from 'next/link'
import Menu from '@/app/components/Menu'
import { loadPerformance, loadPositions } from '@/src/dashboards/portfolio'
import { fmtAmount, fmtSigned } from '@/src/dashboards/compute/today'
import type { Position } from '@/src/dashboards/compute/positions'
import { cn } from '@/lib/utils'
import PerformanceChart from './PerformanceChart'

const TABS = [
  { id: 'positions', label: 'Positions' },
  { id: 'performance', label: 'Performance' },
  { id: 'plans', label: 'Plans' },
] as const
type Tab = (typeof TABS)[number]['id']

const MENU = [
  { href: '/upload', label: 'Upload statement' },
  { href: '/invest/maturities', label: 'Deposits and bonds' },
]

export default async function InvestPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: raw } = await searchParams
  const tab: Tab = TABS.find(t => t.id === raw)?.id ?? 'positions'
  return (
    <main className="mx-auto max-w-xl px-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invest</h1>
        <Menu items={MENU} label="Invest menu" />
      </div>
      <nav className="my-3 flex rounded-xl border bg-card p-[3px]">
        {TABS.map(t => (
          <Link
            key={t.id}
            href={`/invest?tab=${t.id}`}
            className={cn('flex-1 rounded-[9px] py-1.5 text-center text-[13px] text-muted-foreground', t.id === tab && 'bg-secondary font-semibold text-foreground')}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'positions' && <Positions />}
      {tab === 'performance' && <Performance />}
      {tab === 'plans' && <p className="text-sm text-muted-foreground">Investment plans come in a later update.</p>}
    </main>
  )
}

function NotConfigured() {
  return <p className="text-sm text-muted-foreground">Wallet is not connected. Open <Link href="/setup" className="text-primary">setup</Link>.</p>
}

async function Positions() {
  const d = await loadPositions()
  if (!d) return <NotConfigured />
  const gain = d.investedBase - d.costBase
  const groups = new Map<string, Position[]>()
  for (const p of d.positions) groups.set(p.group, [...(groups.get(p.group) ?? []), p])

  return (
    <>
      <div className="rounded-2xl border bg-card px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <b>{fmtAmount(d.investedBase, d.base)} invested</b>
          <span className={gain >= 0 ? 'text-up' : 'text-down'}>
            {fmtSigned(gain)}{d.costBase > 0 && ` · ${fmtSigned((gain / d.costBase) * 100, 1)}%`}
          </span>
        </div>
        <div className="text-[13px] text-muted-foreground">Cost {fmtAmount(d.costBase, d.base)} · deposits count as cash</div>
      </div>
      {[...groups].map(([group, rows]) => (
        <section key={group} className="mt-4">
          <div className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{group}</span>
            <span>{fmtAmount(rows.reduce((s, r) => s + r.valueBase, 0), d.base)}</span>
          </div>
          <div className="rounded-2xl border bg-card px-3.5">
            {rows.map(p => <PositionRow key={p.key} p={p} base={d.base} />)}
          </div>
        </section>
      ))}
    </>
  )
}

function PositionRow({ p, base }: { p: Position; base: string }) {
  const pct = p.costBase > 0 ? ((p.valueBase - p.costBase) / p.costBase) * 100 : null
  return (
    <div className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="font-semibold">{p.symbol}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[p.quantity?.toLocaleString('en-US', { maximumFractionDigits: 4 }), p.name].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm">{fmtAmount(p.valueBase, base)}</div>
        <div className="text-xs">
          {p.basis === 'market' && pct !== null && <span className={pct >= 0 ? 'text-up' : 'text-down'}>{fmtSigned(pct, 1)}%</span>}
          {p.basis === 'cost' && <span className="text-muted-foreground">at cost · no price</span>}
          {p.basis === 'par' && <span className="text-muted-foreground">par + accrued</span>}
        </div>
      </div>
    </div>
  )
}

async function Performance() {
  const d = await loadPerformance()
  if (!d) return <NotConfigured />
  const { total, base } = d
  const putIn = d.series.at(-1)?.putInBase ?? 0
  const LABEL = { dividend: 'Dividends', coupon: 'Coupons', interest: 'Deposit interest' } as const

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="Value" value={fmtAmount(total.currentValueBase, base)} sub={`put in ${fmtAmount(putIn, base)}`} />
        <Stat
          label="Return (XIRR)"
          value={pct(total.mwr)}
          sub={`${fmtSigned(total.totalReturnBase)} ${base}`}
          tone={total.totalReturnBase >= 0 ? 'up' : 'down'}
        />
      </div>

      <section className="mt-4 rounded-2xl border bg-card p-3">
        <div className="mb-1 text-xs text-muted-foreground">Value (blue) vs money put in (dashed), {base}</div>
        <div className="h-56"><PerformanceChart series={d.series} baseCurrency={base} /></div>
      </section>

      <h3 className="mt-5 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Return per broker</h3>
      <div className="rounded-2xl border bg-card px-3.5">
        {d.brokers.map(b => (
          <div key={b.name} className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0">
            <div className="min-w-0">
              <div className="font-semibold">{b.name}</div>
              <div className="text-xs text-muted-foreground">value {fmtAmount(b.perf.currentValueBase, base)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm">{pct(b.perf.mwr)} <span className="text-xs text-muted-foreground">XIRR</span></div>
              <div className={cn('text-xs', b.perf.totalReturnBase >= 0 ? 'text-up' : 'text-down')}>{fmtSigned(b.perf.totalReturnBase)} {base}</div>
            </div>
          </div>
        ))}
      </div>

      <h3 className="mt-5 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Income received</h3>
      <div className="rounded-2xl border bg-card px-3.5">
        {d.incomeTotals.map(i => (
          <div key={i.kind} className="flex items-center justify-between gap-3 border-b py-2.5 text-sm last:border-0">
            <span>{LABEL[i.kind]}</span>
            <span className="text-right">
              {fmtAmount(i.lastYear, base)} <span className="text-xs text-muted-foreground">12 mo · {fmtAmount(i.allTime, base)} total</span>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'up' | 'down' }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-lg font-bold">{value}</div>
      <div className={cn('truncate text-[13px]', tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-muted-foreground')}>{sub}</div>
    </div>
  )
}

function pct(v: number | null): string {
  return v === null ? '—' : `${fmtSigned(v * 100, 1)}%`
}
