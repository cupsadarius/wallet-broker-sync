'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/upload', label: 'Upload' },
  { href: '/history', label: 'History' },
  { href: '/settings', label: 'Settings' },
] as const

export default function AppHeader() {
  const pathname = usePathname() ?? ''

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/40 bg-background/70 backdrop-blur-md supports-[backdrop-filter]:bg-background/50">
      <div className="container mx-auto max-w-6xl flex h-16 items-center justify-between px-6">
        <Link href="/upload" className="flex items-center gap-3 group">
          <span
            aria-hidden
            className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground ring-1 ring-primary/30 transition-transform group-hover:-rotate-6"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
              <path
                d="M12 3v10m0 0l-4-4m4 4l4-4M5 17h14M5 21h14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-heading text-[15px] font-light tracking-wide text-foreground">
              Wallet Sync
            </span>
            <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              broker → wallet
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== '/upload' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative px-5 py-2 text-sm rounded-full transition-colors',
                  active
                    ? 'bg-ghost-blue/15 text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-graphite/60',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
