'use client'

import Link from 'next/link'
import { Ellipsis, Settings } from 'lucide-react'

export type MenuItem = { href: string; label: string }

export default function Menu({ items, icon = 'more', label }: { items: MenuItem[]; icon?: 'more' | 'gear'; label: string }) {
  const Icon = icon === 'gear' ? Settings : Ellipsis
  return (
    <details className="relative">
      <summary
        aria-label={label}
        className="grid size-9 cursor-pointer list-none place-items-center rounded-full text-muted-foreground hover:bg-accent [&::-webkit-details-marker]:hidden"
      >
        <Icon className="size-5" />
      </summary>
      {/* Client navigation keeps the layout mounted, so close the menu by hand. */}
      <div
        className="absolute right-0 z-40 mt-1 w-48 rounded-xl border bg-popover p-1 shadow-lg"
        onClick={e => { (e.currentTarget.parentElement as HTMLDetailsElement).open = false }}
      >
        {items.map(i => (
          <Link key={i.href} href={i.href} className="block rounded-lg px-3 py-2.5 text-sm hover:bg-accent">
            {i.label}
          </Link>
        ))}
      </div>
    </details>
  )
}
