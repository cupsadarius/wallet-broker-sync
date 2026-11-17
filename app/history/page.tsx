import { db } from '@/src/storage/db'
import { syncRun } from '@/src/storage/schema'
import { desc } from 'drizzle-orm'
import HistoryList from './HistoryList'
import Link from 'next/link'


export default async function HistoryPage() {
  const runs = await db.select().from(syncRun).orderBy(desc(syncRun.startedAt))

  return (
    <main className="container mx-auto max-w-5xl py-4 px-4 md:py-12">
      <div className="flex items-end justify-between gap-4 mb-8">
        <div>
          <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground ring-1 ring-accent-foreground/15">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            Audit log
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Sync history</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every past sync, persisted locally. Click a row to expand per-doc detail.
          </p>
        </div>
        <Link
          href="/upload"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm ring-1 ring-primary/20 hover:bg-primary/90 transition-colors"
        >
          Sync another file
        </Link>
      </div>
      <HistoryList runs={runs} />
    </main>
  )
}
