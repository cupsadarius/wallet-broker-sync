'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { House, ChartLine, ChartPie, Sparkles, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import Menu from './Menu'
import SyncStatus from './SyncStatus'

const TABS = [
  { href: '/', label: 'Today', icon: House },
  { href: '/invest', label: 'Invest', icon: ChartLine },
  { href: '/spending', label: 'Spending', icon: ChartPie },
  { href: '/ask', label: 'Ask', icon: Sparkles },
] as const

const MORE = [
  { href: '/settings', label: 'Settings' },
  { href: '/history', label: 'Import history' },
  { href: '/aliases', label: 'Aliases' },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export default function AppHeader({ syncedAgo }: { syncedAgo: string }) {
  const pathname = usePathname() ?? ''
  return (
    <>
      <header className="flex items-center justify-between px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <Link href="/" className="py-3 text-sm font-semibold tracking-wide text-muted-foreground">Wallet</Link>
        <div className="flex items-center">
          <Link href="/upload" aria-label="Upload statement" className="grid size-11 place-items-center text-muted-foreground">
            <Upload className="size-5" />
          </Link>
          <Menu items={MORE} icon="gear" label="Settings menu" />
        </div>
      </header>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-chrome pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] text-[0.6875rem] text-muted-foreground lg:hidden">
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}
            className={cn('flex min-w-16 flex-col items-center gap-1', isActive(pathname, href) && 'font-semibold text-primary')}>
            <Icon className="size-[1.375rem]" />
            {label}
          </Link>
        ))}
      </nav>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col gap-1 border-r bg-chrome px-3.5 py-6 text-sm lg:flex">
        <Link href="/" className="mb-4 px-3 font-semibold tracking-wide text-muted-foreground">Wallet</Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {TABS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground hover:bg-accent',
                isActive(pathname, href) && 'bg-secondary font-semibold text-foreground')}>
              <Icon className="size-[1.125rem]" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          <Link href="/upload" className="mb-2 flex items-center justify-center gap-2 rounded-[0.625rem] bg-primary px-3 py-2.5 font-semibold text-primary-foreground">
            <Upload className="size-4" />Upload statement
          </Link>
          <Link href="/settings" aria-current={isActive(pathname, '/settings') ? 'page' : undefined}
            className={cn('rounded-lg px-3 py-2 text-muted-foreground hover:bg-accent', isActive(pathname, '/settings') && 'bg-secondary font-semibold text-foreground')}>
            Settings
          </Link>
          <SyncStatus syncedAgo={syncedAgo} />
        </div>
      </aside>
    </>
  )
}
