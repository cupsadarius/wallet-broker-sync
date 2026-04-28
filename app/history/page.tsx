import { db, runMigrations } from '@/src/storage/db'
import { syncRun } from '@/src/storage/schema'
import { desc } from 'drizzle-orm'
import HistoryList from './HistoryList'
import Link from 'next/link'

runMigrations()

export default async function HistoryPage() {
  const runs = await db.select().from(syncRun).orderBy(desc(syncRun.startedAt))

  return (
    <main className="container mx-auto max-w-5xl py-12 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Sync history</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Audit log of all past syncs — click a row to expand per-doc detail.
          </p>
        </div>
        <Link
          href="/upload"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
        >
          Sync another file
        </Link>
      </div>
      <HistoryList runs={runs} />
    </main>
  )
}
