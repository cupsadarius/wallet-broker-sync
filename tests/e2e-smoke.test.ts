/**
 * End-to-end smoke test: spins up pouchdb-server as a child process
 * (CouchDB-compatible, in-memory), seeds it with the minimal Wallet-shaped
 * docs, then runs the full parser → engine → bulk-write pipeline against it.
 *
 * Demonstrates idempotency: two runs produce 5 inserts on the first and
 * 0 inserts / 5 conflicts on the second (engine pre-dedupes via _changes).
 *
 * Real HTTP server via subprocess (not network-mocked).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { xtb } from '@/src/parsers/xtb'
import { CouchClient } from '@/src/sync/couch'
import { LookupService } from '@/src/sync/lookup'
import { runSync } from '@/src/sync/engine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick a random port in the ephemeral range, away from 5984 (real CouchDB). */
function randomPort(): number {
  return 15900 + Math.floor(Math.random() * 200)
}

/** Spawn pouchdb-server CLI as a subprocess and wait until it responds to HTTP. */
async function startPouchServer(port: number, configDir: string): Promise<ChildProcess> {
  const bin = new URL('../node_modules/pouchdb-server/bin/pouchdb-server', import.meta.url).pathname
  const configPath = join(configDir, 'pouchdb-config.json')

  // pouchdb-server writes logs to a file, not stdout — detect readiness via HTTP polling.
  // --config points to an isolated temp dir so it never picks up a stale config.json
  // from the project root (which may have leftover admin hashes from prior runs).
  const proc = spawn(bin, ['--port', String(port), '--in-memory', '--config', configPath], {
    stdio: 'ignore',
    env: { ...process.env },
  })

  await new Promise<void>((resolve, reject) => {
    proc.on('error', reject)
    proc.on('exit', (code) => reject(new Error(`pouchdb-server exited early with code ${code}`)))

    const deadline = Date.now() + 10_000
    const poll = async () => {
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`)
          if (res.ok) { resolve(); return }
        } catch {
          // not ready yet
        }
        await new Promise(r => setTimeout(r, 150))
      }
      proc.kill()
      reject(new Error('pouchdb-server did not become ready within 10s'))
    }
    poll().catch(reject)
  })

  return proc
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('e2e smoke against pouchdb-server', () => {
  let pouchProc: ChildProcess
  let port: number
  let configDir: string
  const dbName = 'bb-test'

  beforeAll(async () => {
    port = randomPort()
    // Isolated temp dir for pouchdb config — prevents picking up stale config.json
    // from project root (pouchdb-server defaults to ./config.json).
    configDir = join(tmpdir(), `pouchdb-e2e-${port}`)
    mkdirSync(configDir, { recursive: true })
    pouchProc = await startPouchServer(port, configDir)

    const baseUrl = `http://127.0.0.1:${port}`
    const authHeader = `Basic ${Buffer.from('test-user:test-token').toString('base64')}`

    // Register test-user as a CouchDB admin (server is in "admin party" mode initially —
    // PUT /_config/admins/<name> with a plain-text value sets the hashed password).
    // This must be done BEFORE any CouchClient call, since CouchClient always sends auth.
    const adminRes = await fetch(`${baseUrl}/_config/admins/test-user`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify('test-token'),
    })
    if (!adminRes.ok) {
      throw new Error(`Failed to register admin: ${adminRes.status} ${await adminRes.text()}`)
    }

    // Create database (now with auth)
    const createRes = await fetch(`${baseUrl}/${dbName}`, {
      method: 'PUT',
      headers: { authorization: authHeader },
    })
    if (!createRes.ok && createRes.status !== 412) {
      throw new Error(`Failed to create db: ${createRes.status} ${await createRes.text()}`)
    }

    // Seed: Currency, Account, StocksFundsAsset
    // These mirror what real Wallet has; LookupService.refresh() reads them.
    const seedDocs = [
      {
        _id: '-Currency_eur',
        reservedModelType: 'Currency',
        code: 'EUR',
      },
      {
        _id: '-Account_test',
        reservedModelType: 'Account',
        accountType: 7,
        name: 'Test',
        currencyId: '-Currency_eur',
      },
      {
        _id: '-StocksFundsAsset_vuaa_xetr',
        reservedModelType: 'StocksFundsAsset',
        symbol: 'VUAA',
        exchangeCode: 'XETR',
        currencyCode: 'EUR',
      },
    ]

    const seedRes = await fetch(`${baseUrl}/${dbName}/_bulk_docs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authHeader },
      body: JSON.stringify({ docs: seedDocs }),
    })
    if (!seedRes.ok) {
      throw new Error(`Failed to seed docs: ${seedRes.status} ${await seedRes.text()}`)
    }
    const seedResult = (await seedRes.json()) as Array<{ id: string; ok?: boolean; error?: string }>
    const failed = seedResult.filter(r => !r.ok)
    if (failed.length > 0) throw new Error(`Seed failed for: ${JSON.stringify(failed)}`)
  }, 30_000)

  afterAll(() => {
    pouchProc?.kill('SIGTERM')
    try { rmSync(configDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('round-trips XTB buys end-to-end and is idempotent', async () => {
    const url = `http://127.0.0.1:${port}`
    // pouchdb-server runs without auth; CouchClient sends Basic header (server ignores it)
    const auth = { login: 'test-user', token: 'test-token' }
    const couch = new CouchClient({ url, dbName, auth })

    const lookup = new LookupService(couch)
    await lookup.refresh()

    // Verify lookup found what we seeded
    const accounts = lookup.investmentAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0].id).toBe('-Account_test')

    const assetId = lookup.assetByVenueSymbol('XETR', 'VUAA')
    expect(assetId).toBe('-StocksFundsAsset_vuaa_xetr')

    const fixturePath = resolve('tests/parsers/fixtures/xtb-2026.xlsx')
    const bytes = new Uint8Array(readFileSync(fixturePath))
    const parsed = await xtb.parse({ bytes, filename: 'xtb-2026.xlsx' })

    // Fixture has exactly 5 stock purchases (all VUAA.DE on XETR)
    expect(parsed.txns.filter(t => t.kind === 'buy' || t.kind === 'sell')).toHaveLength(5)

    // --- First run: all 5 are new ---
    const result1 = await runSync({
      broker: 'xtb',
      txns: parsed.txns,
      unsupported: parsed.unsupported,
      accountId: '-Account_test',
      ownerId: 'test-user',
      toolVersion: 'e2e',
      couch,
      lookup,
    })

    expect(result1.inserted).toBe(5)
    expect(result1.conflict).toBe(0)
    expect(result1.errors).toHaveLength(0)
    expect(result1.needsAsset).toHaveLength(0)

    // --- Second run: all 5 already present (pre-deduped via _changes) ---
    const result2 = await runSync({
      broker: 'xtb',
      txns: parsed.txns,
      unsupported: parsed.unsupported,
      accountId: '-Account_test',
      ownerId: 'test-user',
      toolVersion: 'e2e',
      couch,
      lookup,
    })

    // The engine reads existing docs via _changes before calling bulkDocs.
    // Since all 5 _ids are already present, it short-circuits and never calls
    // bulkDocs — so there are zero inserts AND zero server-side conflicts.
    expect(result2.inserted).toBe(0)
    expect(result2.conflict).toBe(0)
    expect(result2.preview.alreadyPresent).toHaveLength(5)
  }, 30_000)
})
