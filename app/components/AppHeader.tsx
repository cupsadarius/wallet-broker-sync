'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { House, ChartLine, ChartPie, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import Menu from './Menu'

const TABS = [
  { href: '/', label: 'Today', icon: House },
  { href: '/invest', label: 'Invest', icon: ChartLine },
  { href: '/spending', label: 'Spending', icon: ChartPie },
  { href: '/ask', label: 'Ask', icon: Sparkles },
] as const

const SETTINGS = [
  { href: '/settings', label: 'Settings' },
  { href: '/history', label: 'Import history' },
  { href: '/aliases', label: 'Aliases' },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export default function AppHeader() {
  const pathname = usePathname() ?? ''
  return (
    <>
      <header className="flex items-center justify-between px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <Link href="/" className="py-3 text-sm font-semibold tracking-wide text-muted-foreground">Wallet</Link>
        <Menu items={SETTINGS} icon="gear" label="Settings menu" />
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around lg:hidden border-t bg-[#12151b] pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] text-[11px] text-muted-foreground">
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn('flex min-w-16 flex-col items-center gap-1', isActive(pathname, href) && 'font-semibold text-primary')}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        ))}
      </nav>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-[#12151b] px-3 py-5 text-sm lg:flex">
        <Link href="/" className="mb-5 px-3 font-semibold tracking-wide text-muted-foreground">Wallet</Link>
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground hover:bg-accent',
              isActive(pathname, href) && 'bg-secondary font-semibold text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
        <div className="mt-auto border-t pt-3">
          {SETTINGS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn('block rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-accent', isActive(pathname, href) && 'text-foreground')}
            >
              {label}
            </Link>
          ))}
        </div>
      </aside>
    </>
  )
}
