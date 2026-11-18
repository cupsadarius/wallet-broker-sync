import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Desktop: the list next to the selected item's detail. Phone: the list, or (when `open`) only the detail. */
export default function ListDetail({ list, detail, open, backHref, backLabel, listWidth = 'lg:grid-cols-[25rem_minmax(0,1fr)]' }: {
  list: ReactNode; detail: ReactNode; open: boolean; backHref: string; backLabel: string; listWidth?: string
}) {
  return (
    <div className={cn('lg:grid lg:items-start lg:gap-6', listWidth)}>
      <div className={cn('min-w-0', open && 'max-lg:hidden')}>{list}</div>
      <div className={cn('min-w-0', !open && 'max-lg:hidden')}>
        <Link href={backHref} scroll={false} className="-ml-1 mb-2 flex min-h-11 w-fit items-center gap-0.5 text-[0.9375rem] text-primary lg:hidden">
          <ChevronLeft aria-hidden className="size-5" />{backLabel}
        </Link>
        {detail}
      </div>
    </div>
  )
}
