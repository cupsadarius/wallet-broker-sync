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
  if (href === '/spending') return pathname.startsWith('/spending') || pathname.startsWith('/dashboard')
  return pathname.startsWith(href)
}

export default function AppHeader() {
  const pathname = usePathname() ?? ''
  return (
    <>
      <header className="flex items-center justify-between px-4 pt-[env(safe-area-inset-top)]">
        <Link href="/" className="py-3 text-sm font-semibold tracking-wide text-muted-foreground">Wallet</Link>
        <Menu items={SETTINGS} icon="gear" label="Settings menu" />
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-[#12151b] pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] text-[11px] text-muted-foreground">
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
    </>
  )
}
