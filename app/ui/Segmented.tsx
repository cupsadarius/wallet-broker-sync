import Link from 'next/link'
import { cn } from '@/lib/utils'

export type SegmentOption = { value: string; label: string; href: string }

/** A row of links where one is current; for periods, ranges and chart views. */
export default function Segmented({ options, value, label, boxed }: { options: SegmentOption[]; value: string; label: string; boxed?: boolean }) {
  return (
    <nav aria-label={label} className={cn('flex w-fit flex-wrap gap-1 text-[0.8125rem]', boxed && 'rounded-[0.625rem] border bg-card p-[0.1875rem]')}>
      {options.map(o => (
        <Link key={o.value} href={o.href} scroll={false} aria-current={o.value === value ? 'true' : undefined}
          className={cn('rounded-md px-2.5 py-1.5 text-muted-foreground', o.value === value && 'bg-secondary font-semibold text-foreground')}>
          {o.label}
        </Link>
      ))}
    </nav>
  )
}
