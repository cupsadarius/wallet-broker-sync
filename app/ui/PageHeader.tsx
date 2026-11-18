import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Tab = { id: string; label: string; href: string }

/** Page title; underline tabs under it, and controls on the right. */
export default function PageHeader({ title, tabs, active, right }: { title: string; tabs?: Tab[]; active?: string; right?: ReactNode }) {
  if (!tabs) {
    return (
      <header className="flex flex-wrap items-center justify-between gap-3 pt-3 lg:pt-0">
        <h1 className="text-2xl font-semibold tracking-tight lg:text-[1.75rem]">{title}</h1>
        {right}
      </header>
    )
  }
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b pt-3 lg:pt-0">
      <div className="flex min-w-0 flex-col gap-3 lg:gap-4">
        <h1 className="text-2xl font-semibold tracking-tight lg:text-[1.75rem]">{title}</h1>
        <nav aria-label={`${title} sections`} className="no-scrollbar -mb-px flex gap-6 overflow-x-auto text-[0.9375rem] lg:gap-7">
          {tabs.map(t => (
            <Link key={t.id} href={t.href} aria-current={t.id === active ? 'page' : undefined}
              className={cn('shrink-0 border-b-2 border-transparent pb-2.5 text-muted-foreground', t.id === active && 'border-primary font-semibold text-foreground')}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      {right && <div className="pb-2.5">{right}</div>}
    </header>
  )
}
