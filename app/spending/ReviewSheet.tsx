'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { SHEET } from '@/app/ui/EditSheet'
import { cn } from '@/lib/utils'

export type ReviewTab = { id: string; label: string; href: string }

/** The review sheet the URL opens (`?review=`); closing it goes to `closeHref`. */
export default function ReviewSheet({ tabs, active, closeHref, children }: {
  tabs: ReviewTab[]; active: string; closeHref: string; children: ReactNode
}) {
  const router = useRouter()
  return (
    <Dialog open onOpenChange={open => { if (!open) router.push(closeHref, { scroll: false }) }}>
      <DialogContent className={cn(SHEET, 'lg:max-w-2xl')}>
        <span aria-hidden className="mx-auto -mt-1 h-1 w-10 rounded-full bg-line-2 lg:hidden" />
        <div>
          <DialogTitle className="text-lg font-semibold">Review</DialogTitle>
          <DialogDescription className="mt-1 text-[0.8125rem] text-muted-foreground">Sort records, approve rules and link transfers.</DialogDescription>
        </div>
        <nav aria-label="Review sections" className="flex gap-6 border-b text-[0.9375rem]">
          {tabs.map(t => (
            <Link key={t.id} href={t.href} scroll={false} replace aria-current={t.id === active ? 'page' : undefined}
              className={cn('-mb-px border-b-2 border-transparent pb-2.5 text-muted-foreground', t.id === active && 'border-primary font-semibold text-foreground')}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-3">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
