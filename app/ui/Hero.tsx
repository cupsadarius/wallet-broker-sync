import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type HeroStat = { label: string; value: ReactNode; tone?: 'good' | 'bad' }

const TONE = { good: 'text-up', bad: 'text-down', muted: 'text-muted-foreground', plain: 'text-fg-2' } as const

/** The screen's answer: one big number, its sub line, a few stats, and the chart that explains it. */
export default function Hero({ label, value, unit, sub, subTone = 'good', stats, chart, children }: {
  label: string; value: string; unit?: string; sub?: ReactNode; subTone?: keyof typeof TONE
  stats?: HeroStat[]; chart?: ReactNode; children?: ReactNode
}) {
  return (
    <section aria-label={label} className="grid gap-6 rounded-2xl border bg-card p-5 tabular-nums lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-11 lg:p-7">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-4xl font-bold leading-none tracking-tight lg:text-[44px]">
          {value}{unit && <span className="ml-1.5 text-base font-medium text-muted-foreground lg:text-lg">{unit}</span>}
        </div>
        {sub && <div className={cn('text-sm font-medium lg:text-[15px]', TONE[subTone])}>{sub}</div>}
        {stats && stats.length > 0 && (
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-3 text-sm lg:mt-5">
            {stats.map(s => (
              <div key={s.label} className="contents">
                <dt className="text-muted-foreground">{s.label}</dt>
                <dd className={cn('text-right', s.tone && TONE[s.tone])}>{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </div>
      {chart && <div className="min-w-0">{chart}</div>}
    </section>
  )
}
