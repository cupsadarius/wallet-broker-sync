import type { PlanTag } from '@/src/dashboards/compute/plans'
import { cn } from '@/lib/utils'

const STROKE: Record<PlanTag, string> = {
  behind: 'var(--color-warn)', 'on track': 'var(--color-up)', done: 'var(--color-up)', paused: 'var(--c-neutral)', archived: 'var(--c-neutral)',
}
const C = 2 * Math.PI * 15

export function PlanRing({ ring, tag }: { ring: number; tag: PlanTag }) {
  return (
    <svg viewBox="0 0 36 36" className="size-[34px] shrink-0" aria-hidden>
      <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="4" />
      <circle cx="18" cy="18" r="15" fill="none" stroke={STROKE[tag]} strokeWidth="4" strokeDasharray={`${ring * C} ${C}`} transform="rotate(-90 18 18)" />
    </svg>
  )
}

export function PlanTagPill({ tag, label }: { tag: PlanTag; label?: string }) {
  return (
    <span className={cn(
      'shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-semibold',
      tag === 'behind' ? 'bg-warn/15 text-warn' : tag === 'on track' || tag === 'done' ? 'bg-up/15 text-up' : 'bg-secondary text-muted-foreground',
    )}>
      {label ?? tag}
    </span>
  )
}
