'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type Tab = { href: string; label: string; exact?: boolean }
const TABS: readonly Tab[] = [
  { href: '/dashboard', label: 'Overview', exact: true },
  { href: '/dashboard/holdings', label: 'Holdings' },
  { href: '/dashboard/performance', label: 'Performance' },
  { href: '/dashboard/spending', label: 'Spending' },
  { href: '/dashboard/categories', label: 'Categories' },
  { href: '/dashboard/cashflow', label: 'Cash flow' },
]

export default function DashboardNav() {
  const pathname = usePathname() ?? ''

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-border/40">
      {TABS.map(tab => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm transition-colors',
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
