import Link from 'next/link'
import { redirect } from 'next/navigation'
import { loadCouchCreds } from '@/src/storage/credentials'
import { db } from '@/src/storage/db'
import { config, brokerAccountMap } from '@/src/storage/schema'
import { loadToday } from '@/src/dashboards/portfolio'
import { fmtAmount, fmtDay, fmtSigned } from '@/src/dashboards/compute/today'
import { cn } from '@/lib/utils'
import { PlanRing, PlanTagPill } from '@/app/components/PlanBits'

export default async function TodayPage() {
  const creds = await loadCouchCreds()
  if (!creds) redirect('/setup')
  const cfgRows = await db.select().from(config)
  const cfgMap = Object.fromEntries(cfgRows.map(r => [r.key, r.value]))
  if (!cfgMap.couchUrl || !cfgMap.dbName) redirect('/setup')
  const mappings = await db.select().from(brokerAccountMap)
  if (mappings.length < 3) redirect('/setup')

  const t = await loadToday()
  if (!t) redirect('/setup')
  const { base } = t
  const gainPct = t.invested.cost > 0 ? (t.invested.gain / t.invested.cost) * 100 : null
  const behind = t.plans.filter(v => v.progress.tag === 'behind').length
  const topShare = t.cash.top && t.cash.total > 0 ? Math.round((t.cash.top.base / t.cash.total) * 100) : null

  return (
    <main className="mx-auto max-w-xl px-4">
      <div className="mt-1 mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Net worth</div>
          <div className="text-3xl font-bold tracking-tight">
            {t.netWorth.toLocaleString('en-US', { maximumFractionDigits: 0 })}<span className="ml-1 text-[15px] font-normal text-muted-foreground">{base}</span>
          </div>
          {t.retirementLocked > 0 && (
            <Link href="/invest?tab=retirement" className="text-xs text-muted-foreground">
              + {fmtAmount(t.retirementLocked, base)} locked until retirement ›
            </Link>
          )}
        </div>
        {t.change30dPct !== null && (
          <div className={cn('shrink-0 font-semibold', t.change30dPct >= 0 ? 'text-up' : 'text-down')}>
            {fmtSigned(t.change30dPct, 1)}% <span className="text-xs font-normal text-muted-foreground">30d</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Card label="Invested" value={fmtAmount(t.invested.value, base)}>
          <span className={t.invested.gain >= 0 ? 'text-up' : 'text-down'}>
            {fmtSigned(t.invested.gain, 0)}{gainPct !== null && ` · ${fmtSigned(gainPct, 1)}%`}
          </span>
        </Card>
        <Card label="Cash" value={fmtAmount(t.cash.total, base)}>
          {t.cash.top && topShare !== null && <span className="text-muted-foreground">{topShare}% in {t.cash.top.name}</span>}
        </Card>
      </div>

      <Section title={`What needs you${t.tasks.length ? ` · ${t.tasks.length}` : ''}`} />
      {t.tasks.length === 0 && <p className="text-sm text-muted-foreground">Nothing needs you now.</p>}
      {t.tasks.map(task => (
        <div key={task.id} className="my-2 flex items-start gap-3 rounded-xl border border-l-[3px] border-l-warn bg-card px-3.5 py-3">
          <div className="min-w-0">
            <div className="font-semibold">{task.title}</div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">{task.detail}</div>
          </div>
          {task.href && (
            <Link href={task.href} className="ml-auto shrink-0 self-center rounded-lg bg-primary px-3 py-1.5 text-[13px] font-bold text-primary-foreground">
              {task.action}
            </Link>
          )}
        </div>
      ))}

      <Section
        title={`Investment plans${behind ? ` · ${behind} behind` : ''}`}
        link={{ href: '/invest?tab=plans', label: 'All plans ›' }}
      />
      {t.plans.length === 0 && <p className="text-sm text-muted-foreground">No active plans.</p>}
      {t.plans.map(({ plan: p, accountName, progress: g }) => (
        <Link key={p.id} href="/invest?tab=plans" className="my-1.5 flex items-center gap-2.5 rounded-[14px] border bg-card px-3 py-2.5">
          <PlanRing ring={g.ring} tag={g.tag} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{p.name} <span className="font-normal text-muted-foreground">· {accountName}</span></div>
            <div className="truncate text-xs text-muted-foreground">{g.line}</div>
          </div>
          <PlanTagPill tag={g.tag} />
        </Link>
      ))}

      <Section title="Coming up" link={{ href: '/invest/maturities', label: 'Maturities ›' }} />
      {t.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No maturities on record. <Link href="/invest/maturities" className="text-primary">Add one</Link>
        </p>
      ) : (
        <div className="ml-[7px] border-l-2 border-[#2f3440] pl-4">
          {t.events.map(({ maturity: m, payout, done }) => (
            <div key={m.id} className="relative my-3.5">
              <span className={cn('absolute -left-[22px] top-[5px] size-2.5 rounded-full', done ? 'bg-up' : 'bg-primary')} />
              <div className="font-semibold">{done ? `Done · ${m.name} matured` : `${fmtDay(m.maturityDate)} · ${m.name} matures`}</div>
              <div className="text-[13px] text-muted-foreground">
                {done && `${fmtDay(m.maturityDate)} · `}
                {payout !== null
                  ? `${fmtAmount(payout, m.currency)} incl. ${fmtAmount(payout - m.principal, m.currency)} interest`
                  : `${fmtAmount(m.principal, m.currency)} + interest (rate not set)`}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 mb-2 text-xs leading-relaxed text-muted-foreground">
        Data age:{' '}
        {t.age.map((a, i) => (
          <span key={a.label}>
            {i > 0 && ' · '}
            {a.label}{' '}
            <span className={cn(a.stale && 'text-warn')}>{a.asOf ? shortDay(a.asOf) : 'never'}{a.stale && ' ⚠'}</span>
          </span>
        ))}
      </p>
    </main>
  )
}

function Card({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-lg font-bold">{value}</div>
      <div className="truncate text-[13px]">{children}</div>
    </div>
  )
}

function Section({ title, link }: { title: string; link?: { href: string; label: string } }) {
  return (
    <div className="mt-6 mb-2 flex items-baseline justify-between">
      <h3 className="font-sans text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {link && <Link href={link.href} className="text-[13px] text-primary">{link.label}</Link>}
    </div>
  )
}

function shortDay(iso: string): string {
  const d = fmtDay(iso)
  return d.endsWith(String(new Date().getUTCFullYear())) ? d.slice(0, -5) : d
}
