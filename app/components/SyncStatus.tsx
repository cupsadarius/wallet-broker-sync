'use client'

import { useState } from 'react'
import type { AgeEntry } from '@/src/dashboards/compute/today'
import { cn } from '@/lib/utils'

const day = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "Synced 2 h ago"; opens the list of data sources with their dates, stale ones marked. */
export default function SyncStatus({ syncedAgo }: { syncedAgo: string }) {
  const [ages, setAges] = useState<AgeEntry[] | null>(null)
  return (
    <details className="relative" onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open && !ages) fetch('/api/data-age').then(r => r.json()).then(setAges, () => setAges([])) }}>
      <summary className="cursor-pointer list-none rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent [&::-webkit-details-marker]:hidden">
        Synced {syncedAgo}
      </summary>
      <div className="absolute bottom-full left-0 z-40 mb-1 w-64 rounded-xl border bg-popover p-3 text-[13px] shadow-lg">
        <div className="mb-2 font-semibold">Data sources</div>
        {!ages && <p className="text-muted-foreground">Loading…</p>}
        {ages?.length === 0 && <p className="text-muted-foreground">Connect Wallet in Settings to see your data.</p>}
        <ul className="flex flex-col gap-1.5">
          {ages?.map(a => (
            <li key={a.label} className="flex justify-between gap-3">
              <span>{a.label}</span>
              <span className={cn('tabular-nums text-muted-foreground', a.stale && 'text-warn')}>{a.asOf ? day(a.asOf) : 'never'}{a.stale && ', old'}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
