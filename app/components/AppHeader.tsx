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
    <header className="sticky top-0 z-30 w-full border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto max-w-5xl flex h-14 items-center justify-between px-4">
        <Link href="/upload" className="flex items-center gap-2.5 group">
          <span
            aria-hidden
            className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20 transition-transform group-hover:-rotate-3"
          >
            {/* arrow-into-vault glyph */}
            <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
              <path
                d="M12 3v10m0 0l-4-4m4 4l4-4M5 17h14M5 21h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight">Wallet Sync</span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
                  'relative px-3 py-1.5 text-sm rounded-md transition-colors',
                  active
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                )}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                  />
                )}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
