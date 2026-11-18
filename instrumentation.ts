/**
 * Next.js `instrumentation.ts` runs once when the server boots. We use it to
 * kick off a low-frequency background loop that keeps the local Couch mirror
 * warm — so the dashboard never has to wait on a cold _changes pull on first
 * paint.
 *
 * Notes:
 *   - This runs in the Node.js runtime only (we don't ship Edge runtime here).
 *   - For dev (`next dev`) the loop restarts on every HMR cycle; the interval
 *     handle is intentionally never cleared because we don't want gaps.
 *   - The cron is best-effort and silent: any error is logged and skipped so a
 *     transient Couch outage doesn't crash the server.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Fail at boot, not on the first request, when the access env is wrong.
  const { policyFromEnv } = await import('./src/security/access')
  policyFromEnv(process.env)

  // Defer the import: instrumentation runs early in the boot sequence and we
  // don't want to load better-sqlite3 + drizzle until after Next is ready.
  // An empty data volume has no tables until the first migration.
  const { runMigrations } = await import('./src/storage/db')
  runMigrations()
  const { applyEnvConnection } = await import('./src/storage/credentials')
  await applyEnvConnection()
  const { syncMirror, getMirrorIntervalMs } = await import('./src/dashboards/mirror')
  const { loadUploadTasks } = await import('./src/dashboards/portfolio')
  const { notifyNewTasks } = await import('./src/push/tasks')
  const { ensurePricesForHoldings } = await import('./src/dashboards/prices')
  const { maybeWriteWeeklyNote } = await import('./src/insights/jobs')

  const PRICE_REFRESH_MS = 12 * 60 * 60_000
  let lastPriceRefresh = 0
  let busy = false
  let noteBusy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const snapshot = await syncMirror()
      if (snapshot) await notifyNewTasks(await loadUploadTasks(snapshot))
      // The AI run can take minutes, so it must not hold up the next mirror sync.
      if (snapshot && !noteBusy) {
        noteBusy = true
        void maybeWriteWeeklyNote()
          .catch(err => console.warn('[insights.weekly] note failed', err instanceof Error ? err.message : err))
          .finally(() => { noteBusy = false })
      }
      if (Date.now() - lastPriceRefresh > PRICE_REFRESH_MS) {
        lastPriceRefresh = Date.now()
        await ensurePricesForHoldings()
      }
    } catch (err) {
      console.warn('[dashboard.mirror] background sync failed', err)
    } finally {
      busy = false
    }
  }

  // Initial sync ~5s after boot so we don't fight Next's startup workload.
  const initial = setTimeout(() => { void tick() }, 5000)
  initial.unref?.()

  const interval = await getMirrorIntervalMs()
  const handle = setInterval(() => { void tick() }, Math.max(60_000, interval))
  handle.unref?.()
}
