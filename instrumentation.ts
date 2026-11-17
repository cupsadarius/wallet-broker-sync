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
  const { applyEnvConnection } = await import('./src/storage/credentials')
  await applyEnvConnection()
  const { syncMirror, getMirrorIntervalMs } = await import('./src/dashboards/mirror')

  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      await syncMirror()
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
