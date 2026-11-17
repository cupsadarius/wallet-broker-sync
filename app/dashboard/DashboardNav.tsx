'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/dashboard/spending', label: 'Spending' },
  { href: '/dashboard/categories', label: 'Categories' },
  { href: '/dashboard/cashflow', label: 'Cash flow' },
] as const

export default function DashboardNav() {
  const pathname = usePathname() ?? ''

  return (
    <nav className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-border/40">
      {TABS.map(tab => {
        const active = pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-4 py-2 text-sm transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
