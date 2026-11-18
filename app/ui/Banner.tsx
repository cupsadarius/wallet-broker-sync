import Link from 'next/link'
import type { ReactNode } from 'react'

/** One sentence that needs attention, with one action. */
export default function Banner({ children, action }: { children: ReactNode; action?: { label: string; href: string } }) {
  return (
    <div role="status" className="flex items-center gap-3.5 rounded-xl border border-warn-line bg-warn-tint px-4 py-3 text-sm">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-warn" />
      <span className="min-w-0 flex-1">{children}</span>
      {action && <Link href={action.href} scroll={false} className="shrink-0 font-semibold text-primary">{action.label}</Link>}
    </div>
  )
}
