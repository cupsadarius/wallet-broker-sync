import Link from 'next/link'
import { redirect } from 'next/navigation'
import { loadCouchCreds } from '@/src/storage/credentials'
import { db } from '@/src/storage/db'
import { config, brokerAccountMap } from '@/src/storage/schema'
import { loadToday, RANGES } from '@/src/dashboards/portfolio'
import { fmtDay } from '@/src/dashboards/compute/today'
import { cn } from '@/lib/utils'
import { PlanRing, PlanTagPill } from '@/app/components/PlanBits'
import Page from '@/app/ui/Page'
import PageHeader from '@/app/ui/PageHeader'
import Hero from '@/app/ui/Hero'
import Segmented from '@/app/ui/Segmented'
import TimeChart from '@/app/ui/TimeChart'
import { big, whole } from '@/app/ui/chartFormat'

type Range = keyof typeof RANGES
type Today = NonNullable<Awaited<ReturnType<typeof loadToday>>>
const RANGE_LABEL: Record<Range, string> = { '6m': '6M', '1y': '1Y', '3y': '3Y', all: 'All' }

const shortDay = (iso: string) => fmtDay(iso).replace(` ${new Date().getUTCFullYear()}`, '')
const monthYear = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const creds = await loadCouchCreds()
  if (!creds) redirect('/setup')
  const cfgRows = await db.select().from(config)
  const cfgMap = Object.fromEntries(cfgRows.map(r => [r.key, r.value]))
  if (!cfgMap.couchUrl || !cfgMap.dbName) redirect('/setup')
  const mappings = await db.select().from(brokerAccountMap)
  if (mappings.length < 3) redirect('/setup')

  const { range: raw } = await searchParams
  const range: Range = raw && raw in RANGES ? raw as Range : '1y'
  const t = await loadToday(range)
  if (!t) redirect('/setup')
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <Page>
      <PageHeader title="Today" right={<span className="text-sm text-muted-foreground">{date}</span>} />
      <TodayHero t={t} range={range} />
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <NeedsYou t={t} />
        <div className="flex flex-col gap-8">
          <ComingUp t={t} />
          <Plans t={t} />
        </div>
      </div>
    </Page>
  )
}

function TodayHero({ t, range }: { t: Today; range: Range }) {
  const share = t.netWorth > 0 ? Math.max(0, Math.min(100, (t.invested / t.netWorth) * 100)) : 0
  return (
    <Hero label="Net worth" value={whole(t.netWorth)} unit={t.base}
      subTone={t.change30d >= 0 ? 'good' : 'bad'}
      sub={t.change30dPct !== null && `${t.change30d >= 0 ? '+' : '−'}${whole(Math.abs(t.change30d))} (${t.change30d >= 0 ? '+' : '−'}${Math.abs(t.change30dPct).toFixed(1)}%) in the last 30 days`}
      chart={
        <div className="flex flex-col gap-2">
          <div className="flex justify-end">
            <Segmented label="Chart range" value={range}
              options={(Object.keys(RANGES) as Range[]).map(r => ({ value: r, label: RANGE_LABEL[r], href: r === '1y' ? '/' : `/?range=${r}` }))} />
          </div>
          <TimeChart points={t.series} unit={t.base} label="Net worth over time" />
        </div>
      }>
      <div className="mt-5 flex flex-col gap-3 text-sm">
        <div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-line-2">
          <span className="bg-primary" style={{ width: `${share}%` }} />
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-y-2">
          <dt className="flex items-center gap-2 text-muted-foreground"><span aria-hidden className="size-2.5 rounded-sm bg-primary" />Invested</dt>
          <dd className="text-right">{whole(t.invested)}</dd>
          <dt className="flex items-center gap-2 text-muted-foreground"><span aria-hidden className="size-2.5 rounded-sm bg-line-2" />Cash</dt>
          <dd className="text-right">{whole(t.cash)}</dd>
        </dl>
        {t.retirementLocked > 0 && (
          <Link href="/invest?tab=retirement" className="text-[0.8125rem] text-muted-foreground hover:text-foreground">
            + {whole(t.retirementLocked)} locked in retirement ›
          </Link>
        )}
      </div>
    </Hero>
  )
}

function NeedsYou({ t }: { t: Today }) {
  return (
    <section aria-labelledby="needs-you" className="flex flex-col gap-2">
      <h2 id="needs-you" className="text-lg font-semibold">Needs you {t.tasks.length > 0 && <span className="text-muted-foreground">{t.tasks.length}</span>}</h2>
      {t.tasks.length === 0 && <p className="text-sm text-muted-foreground">Nothing needs you now.</p>}
      <ul className="flex flex-col gap-2">
        {t.tasks.map(task => (
          <li key={task.id} className="flex items-center gap-3 rounded-xl border border-l-[3px] border-l-warn bg-card px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{task.title}</div>
              <div className="mt-0.5 text-[0.8125rem] text-muted-foreground">{task.detail}</div>
            </div>
            {task.href && (
              <Link href={task.href} className="flex min-h-9 shrink-0 items-center rounded-lg bg-primary px-3 text-[0.8125rem] font-semibold text-primary-foreground">
                {task.action ?? 'Open'}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ComingUp({ t }: { t: Today }) {
  const rows = [
    ...t.events.map(({ maturity: m, payout, done }) => ({
      key: `m${m.id}`, date: shortDay(m.maturityDate), done,
      what: done ? `${m.name} matured` : `${m.name} matures`,
      amount: payout !== null ? `${whole(payout)} ${m.currency}` : `${whole(m.principal)} ${m.currency} + interest`,
    })),
    ...(t.nextUnlock ? [{
      key: 'unlock', date: monthYear(t.nextUnlock.date), done: false, what: `${t.nextUnlock.name} unlocks`,
      amount: t.nextUnlock.value !== null ? `≈ ${big(t.nextUnlock.value)} ${t.base}` : '',
    }] : []),
  ]
  return (
    <section aria-labelledby="coming-up" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 id="coming-up" className="text-lg font-semibold">Coming up</h2>
        <Link href="/invest/maturities" className="text-[0.8125rem] text-primary">Deposits and bonds</Link>
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No maturities on record. <Link href="/invest/maturities" className="text-primary">Add one</Link></p>
      )}
      <ul>
        {rows.map(r => (
          <li key={r.key} className={cn('grid grid-cols-[5rem_minmax(0,1fr)_auto] items-baseline gap-3 border-b py-3 last:border-0', r.done && 'text-muted-foreground')}>
            <span className="text-[0.8125rem] text-muted-foreground">{r.date}</span>
            <span className="truncate">{r.what}</span>
            <span className="text-right">{r.amount}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Plans({ t }: { t: Today }) {
  const behind = t.plans.filter(v => v.progress.tag === 'behind').length
  return (
    <section aria-labelledby="plans" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 id="plans" className="text-lg font-semibold">Plans {behind > 0 && <span className="text-warn">{behind} behind</span>}</h2>
        <Link href="/invest?tab=plans" className="text-[0.8125rem] text-primary">All plans</Link>
      </div>
      {t.plans.length === 0 && <p className="text-sm text-muted-foreground">No active plans.</p>}
      {t.plans.map(({ plan: p, accountName, progress: g }) => (
        <Link key={p.id} href="/invest?tab=plans" className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5">
          <PlanRing ring={g.ring} tag={g.tag} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{p.name} <span className="font-normal text-muted-foreground">· {accountName}</span></div>
            <div className="truncate text-xs text-muted-foreground">{g.line}</div>
          </div>
          <PlanTagPill tag={g.tag} />
        </Link>
      ))}
    </section>
  )
}
