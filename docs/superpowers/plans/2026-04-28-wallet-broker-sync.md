# Wallet Broker Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js app that ingests broker export files (XTB XLSX, IBKR CSV, Tradeville PDF) and idempotently writes the trades into the corresponding investment accounts in Wallet by BudgetBakers via direct CouchDB writes.

**Architecture:** Three hard layers — parsers (per broker, format-aware) → canonical model → sync engine (deterministic UUIDv5 `_id`s for dedup, direct CouchDB `_bulk_docs` writes). Local SQLite is audit-only; CouchDB stays the source of truth. See `docs/superpowers/specs/2026-04-28-wallet-broker-sync-design.md`.

**Tech Stack:**
- Next.js 16 (App Router) + TypeScript, runs on `localhost:3000`
- Tailwind CSS + shadcn/ui for UI primitives
- `xlsx` (SheetJS) for XTB; `pdfjs-dist` for Tradeville; native CSV parsing for IBKR
- `uuid` (v5) for deterministic `_id`s
- `better-sqlite3` + Drizzle for the audit log
- `keytar` for credential storage in OS keychain
- `vitest` for unit tests
- `husky` + a custom git hook script for token-leak prevention

**Spec reference:** `docs/superpowers/specs/2026-04-28-wallet-broker-sync-design.md`

**Sources:**
- `sources/xtb.xlsx` — real XTB export (gitignored)
- `sources/ibkr.csv` — real IBKR Activity Statement (gitignored)
- `sources/tradeville.pdf` — real Tradeville PDF (gitignored)

---

## File structure

```
investment-wallet-sync/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                            # / → redirect to /setup if not configured, else /upload
│   ├── setup/page.tsx
│   ├── upload/page.tsx
│   ├── preview/page.tsx
│   ├── result/page.tsx
│   ├── history/page.tsx
│   ├── api/
│   │   ├── couch/route.ts                  # Authenticated CouchDB proxy
│   │   ├── sync/route.ts                   # POST: parse + diff + write
│   │   └── config/route.ts
│   └── globals.css
├── src/
│   ├── parsers/
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── canonicalize.ts
│   │   ├── xtb.ts
│   │   ├── xtb-venues.ts
│   │   ├── ibkr.ts
│   │   ├── ibkr-venues.ts
│   │   ├── tradeville.ts
│   │   └── tradeville-layout.ts
│   ├── sync/
│   │   ├── namespace.ts
│   │   ├── ids.ts
│   │   ├── mapper.ts
│   │   ├── couch.ts
│   │   ├── engine.ts
│   │   └── lookup.ts
│   ├── storage/
│   │   ├── credentials.ts
│   │   ├── db.ts
│   │   └── schema.ts
│   ├── ui/components/
│   └── types.ts
├── tests/
│   ├── parsers/
│   │   ├── xtb.test.ts
│   │   ├── ibkr.test.ts
│   │   ├── tradeville.test.ts
│   │   └── fixtures/
│   ├── sync/
│   │   ├── ids.test.ts
│   │   ├── mapper.test.ts
│   │   ├── canonicalize.test.ts
│   │   ├── couch.test.ts
│   │   ├── lookup.test.ts
│   │   └── engine.test.ts
│   └── e2e-smoke.test.ts
├── scripts/
│   ├── pdf-dump.ts                         # Tradeville layout discovery
│   └── couch-probe.ts                      # phase-0 capture #12
├── .githooks/leak-scan.mjs                 # token-leak scanner (called by .husky/pre-commit)
├── docs/superpowers/{specs,plans,captures}
├── sources/                                # gitignored
├── .env.local                              # gitignored
├── package.json, tsconfig.json, next.config.mjs, tailwind.config.ts,
├── components.json, drizzle.config.ts, vitest.config.ts
```

---

## Task 1: Scaffold Next.js + tooling

**Files:** `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `vitest.config.ts`, `.gitignore`

- [ ] **Step 1.1: Init Next.js with TypeScript**

```bash
cd /Users/darius/Personal/investment-wallet-sync
npx --yes create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-npm --turbopack --eslint --skip-install
```

- [ ] **Step 1.2: Install runtime + dev deps**

```bash
npm install --save uuid xlsx pdfjs-dist keytar better-sqlite3 drizzle-orm zod
npm install --save-dev @types/uuid @types/better-sqlite3 drizzle-kit vitest @vitest/ui husky tsx
```

- [ ] **Step 1.3: Configure shadcn/ui**

```bash
npx --yes shadcn@latest init -y --base-color slate --css-variables
npx --yes shadcn@latest add button input table card badge dialog toast
```

- [ ] **Step 1.4: Add vitest config**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
```

- [ ] **Step 1.5: Verify scaffolding**

```bash
npm run lint
npm run build
npx vitest run --reporter=basic
```

Expected: lint clean, build succeeds, vitest reports "no test files found" (passes).

- [ ] **Step 1.6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js + TypeScript + Tailwind + shadcn"
```

---

## Task 2: Core types + namespace constant

**Files:** Create `src/sync/namespace.ts`, `src/parsers/types.ts`, `src/types.ts`

- [ ] **Step 2.1: Pinned namespace constant**

`src/sync/namespace.ts`:
```ts
// PINNED FOR THE LIFETIME OF THIS TOOL.
// Changing this orphans every previously-synced doc.
export const NAMESPACE_WALLET_SYNC = 'dda5a242-7458-4066-9b2b-5c551d9753e3'
```

- [ ] **Step 2.2: Cross-cutting types**

`src/types.ts`:
```ts
export type BrokerId = 'xtb' | 'ibkr' | 'tradeville'

export type CanonicalTxn = {
  externalId: string
  broker: BrokerId
  kind: 'buy' | 'sell' | 'fee'
  date: string
  symbol?: string
  exchange?: string
  quantity?: number
  pricePerShare?: number
  tradeCurrency?: string
  settlementCurrency: string
  fxRate?: number
  cashAmount: number
  description: string
  raw: Record<string, unknown>
}
```

- [ ] **Step 2.3: Parser interface**

`src/parsers/types.ts`:
```ts
import type { BrokerId, CanonicalTxn } from '@/src/types'

export type ParserInput = { bytes: Uint8Array; filename: string; mimeHint?: string }
export type UnsupportedRow = { row: string | number; reason: string; raw: Record<string, unknown> }
export type ParseResult = { txns: CanonicalTxn[]; unsupported: UnsupportedRow[] }
export type ParserFormat = 'csv' | 'xlsx' | 'pdf'

export interface BrokerParser {
  id: BrokerId
  displayName: string
  acceptedFormats: ParserFormat[]
  detect(input: ParserInput): boolean
  parse(input: ParserInput): ParseResult
}
```

- [ ] **Step 2.4: Commit**

```bash
git add src/ && git commit -m "feat: namespace constant and core type definitions"
```

---

## Task 3: Deterministic id + content hash utilities (TDD)

**Files:** `src/sync/ids.ts`, `src/parsers/canonicalize.ts`, `tests/sync/ids.test.ts`, `tests/sync/canonicalize.test.ts`

- [ ] **Step 3.1: Write failing test for `deterministicId()`**

`tests/sync/ids.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { deterministicId } from '@/src/sync/ids'

describe('deterministicId', () => {
  it('returns "-AssetTransaction_<uuid>"', () => {
    expect(deterministicId('xtb', '999840114')).toMatch(/^-AssetTransaction_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
  it('is stable', () => {
    expect(deterministicId('xtb', '999840114')).toBe(deterministicId('xtb', '999840114'))
  })
  it('differs across brokers', () => {
    expect(deterministicId('xtb', '42')).not.toBe(deterministicId('ibkr', '42'))
  })
  it('differs across externalIds within the same broker', () => {
    expect(deterministicId('xtb', '42')).not.toBe(deterministicId('xtb', '43'))
  })
})
```

- [ ] **Step 3.2: Run — verify fail**

```bash
npx vitest run tests/sync/ids.test.ts
```

- [ ] **Step 3.3: Implement**

`src/sync/ids.ts`:
```ts
import { v5 as uuidv5 } from 'uuid'
import type { BrokerId } from '@/src/types'
import { NAMESPACE_WALLET_SYNC } from './namespace'

export function deterministicId(broker: BrokerId, externalId: string): string {
  return `-AssetTransaction_${uuidv5(`${broker}:${externalId}`, NAMESPACE_WALLET_SYNC)}`
}

// Fallback if phase-0 capture #12 reveals a v4-shaped _id is required.
// Swap by changing the export above.
export function deterministicIdV4Looking(broker: BrokerId, externalId: string): string {
  const v5 = uuidv5(`${broker}:${externalId}`, NAMESPACE_WALLET_SYNC)
  return `-AssetTransaction_${v5.substring(0, 14)}4${v5.substring(15)}`
}
```

- [ ] **Step 3.4: Verify ids tests**

```bash
npx vitest run tests/sync/ids.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 3.5: Failing test for canonicalize**

`tests/sync/canonicalize.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { canonicalContentHash, canonicalNumber, canonicalDate } from '@/src/parsers/canonicalize'

describe('canonicalNumber', () => {
  it('formats with fixed precision', () => {
    expect(canonicalNumber(1234.5, 4)).toBe('1234.5000')
    expect(canonicalNumber(0.1, 6)).toBe('0.100000')
  })
  it('throws on NaN/Infinity', () => {
    expect(() => canonicalNumber(NaN, 2)).toThrow()
    expect(() => canonicalNumber(Infinity, 2)).toThrow()
  })
})

describe('canonicalDate', () => {
  it('normalizes to UTC ms-precision Z-suffixed ISO', () => {
    expect(canonicalDate('2026-04-28T10:09:20.103Z')).toBe('2026-04-28T10:09:20.103Z')
    expect(canonicalDate('2026-04-28T12:09:20.103+02:00')).toBe('2026-04-28T10:09:20.103Z')
  })
})

describe('canonicalContentHash', () => {
  const base = {
    date: '2026-04-28T10:09:20.103Z', exchange: 'XETR', symbol: 'VUAA',
    side: 'buy' as const, quantity: 0.1, price: 25.52, cashAmount: -2.18,
    pricePrecision: 4, quantityPrecision: 6,
  }
  it('is stable across input variations that produce the same canonical form', () => {
    // case-insensitive symbol, exchange casing, equal-but-trailing-zero numbers, timezone-equivalent date
    expect(canonicalContentHash(base)).toBe(canonicalContentHash({
      ...base, symbol: 'vuaa', exchange: 'xetr',
      quantity: 0.10000000, price: 25.520,
      date: '2026-04-28T12:09:20.103+02:00',  // same instant
    }))
  })
  it('differs when side, cashAmount, symbol, exchange, date, quantity, or price differ', () => {
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, side: 'sell' }))
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, cashAmount: -2.19 }))
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, symbol: 'VUAB' }))
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, exchange: 'XLON' }))
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, quantity: 0.2 }))
    expect(canonicalContentHash(base)).not.toBe(canonicalContentHash({ ...base, price: 25.53 }))
  })
  it('different precision parameters produce different hashes when they affect the formatted output', () => {
    // 25.5249 → at precision 2 = "25.52"; at precision 4 = "25.5249"
    expect(canonicalContentHash({ ...base, price: 25.5249, pricePrecision: 2 }))
      .not.toBe(canonicalContentHash({ ...base, price: 25.5249, pricePrecision: 4 }))
  })
})
```

- [ ] **Step 3.6: Implement canonicalize**

`src/parsers/canonicalize.ts`:
```ts
import { createHash } from 'node:crypto'

export function canonicalNumber(n: number, precision: number): string {
  if (!Number.isFinite(n)) throw new Error(`canonicalNumber: not finite (${n})`)
  return n.toFixed(precision)
}

export function canonicalDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`canonicalDate: invalid (${iso})`)
  return d.toISOString()
}

export type ContentHashInput = {
  date: string; exchange: string; symbol: string
  side: 'buy' | 'sell' | 'fee'
  quantity: number; price: number; cashAmount: number
  pricePrecision: number; quantityPrecision: number
}

export function canonicalContentHash(i: ContentHashInput): string {
  const parts = [
    canonicalDate(i.date),
    i.exchange.toUpperCase(),
    i.symbol.toUpperCase(),
    i.side,
    canonicalNumber(i.quantity, i.quantityPrecision),
    canonicalNumber(i.price, i.pricePrecision),
    canonicalNumber(i.cashAmount, 4),
  ].join('|')
  return createHash('sha256').update(parts).digest('hex')
}
```

- [ ] **Step 3.7: Run all sync tests**

```bash
npx vitest run tests/sync/
```
Expected: PASS, 8 tests across 2 files.

- [ ] **Step 3.8: Commit**

```bash
git add src/ tests/ && git commit -m "feat: deterministic _id and canonical content hash with tests"
```

---

## Task 4: AssetTransaction mapper (TDD)

**Files:** `src/sync/mapper.ts`, `tests/sync/mapper.test.ts`

- [ ] **Step 4.1: Write failing test for mapper**

`tests/sync/mapper.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toAssetTransactionDoc } from '@/src/sync/mapper'
import type { CanonicalTxn } from '@/src/types'

const baseTxn: CanonicalTxn = {
  externalId: '999840114', broker: 'xtb', kind: 'buy',
  date: '2026-04-28T10:11:20.382Z',
  symbol: 'VUAA', exchange: 'XETR',
  quantity: 1, pricePerShare: 118.04,
  tradeCurrency: 'EUR', settlementCurrency: 'EUR',
  cashAmount: -118.05, description: 'OPEN BUY 1 @ 118.04', raw: {},
}

describe('toAssetTransactionDoc', () => {
  const ctx = {
    accountId: '-Account_xxx', assetId: '-StocksFundsAsset_yyy',
    ownerId: 'user-uuid', now: '2026-04-28T11:00:00.000Z', toolVersion: '1.0.0',
  }
  it('produces a doc with the expected shape', () => {
    const doc = toAssetTransactionDoc(baseTxn, ctx)
    expect(doc._id).toMatch(/^-AssetTransaction_/)
    expect(doc.reservedModelType).toBe('AssetTransaction')
    expect(doc.reservedSource).toBe('wallet-broker-sync')
    expect(doc.assetType).toBe(1)
    expect(doc.transactionType).toBe(0)
    expect(doc.price).toBe(11804)
    expect(doc.cashAmount).toBe(-11805)        // exact, no float drift
    expect(doc.priceCurrencyCode).toBe('EUR')
    expect(doc.cashAmountCurrencyCode).toBe('EUR')
    expect(doc.externalSource).toBe('xtb')
    expect(doc.externalId).toBe('999840114')
  })
  it('maps sell to transactionType 1', () => {
    expect(toAssetTransactionDoc({ ...baseTxn, kind: 'sell' }, ctx).transactionType).toBe(1)
  })
  it('preserves FX trade currencies', () => {
    const fx: CanonicalTxn = { ...baseTxn, symbol: 'FLTR', exchange: 'ARCX',
      pricePerShare: 25.52, tradeCurrency: 'USD', cashAmount: -2.18, settlementCurrency: 'EUR' }
    const doc = toAssetTransactionDoc(fx, ctx)
    expect(doc.priceCurrencyCode).toBe('USD')
    expect(doc.cashAmountCurrencyCode).toBe('EUR')
    expect(doc.price).toBe(2552)
    expect(doc.cashAmount).toBe(-218)
  })
  it('rounds price to nearest integer × 100', () => {
    expect(toAssetTransactionDoc({ ...baseTxn, pricePerShare: 25.525 }, ctx).price).toBe(2553)
  })
})
```

- [ ] **Step 4.2: Run — verify fail**

- [ ] **Step 4.3: Implement mapper**

`src/sync/mapper.ts`:
```ts
import type { CanonicalTxn } from '@/src/types'
import { deterministicId } from './ids'

export type MapperContext = {
  accountId: string; assetId: string
  ownerId: string; now: string; toolVersion: string
}

export type AssetTransactionDoc = {
  _id: string
  reservedModelType: 'AssetTransaction'
  reservedOwnerId: string
  reservedAuthorId: string
  reservedSource: 'wallet-broker-sync'
  reservedCreatedAt: string
  reservedUpdatedAt: string
  assetId: string
  accountId: string
  assetType: 1
  transactionType: 0 | 1
  date: string
  quantity: number
  price: number
  cashAmount: number
  cashAmountCurrencyCode: string
  priceCurrencyCode: string
  externalSource: string
  externalId: string
  syncedAt: string
  syncToolVersion: string
}

export function toAssetTransactionDoc(txn: CanonicalTxn, ctx: MapperContext): AssetTransactionDoc {
  if (txn.kind === 'fee') throw new Error('fee txns are not AssetTransactions')
  if (txn.pricePerShare === undefined) throw new Error('pricePerShare required')
  if (txn.quantity === undefined) throw new Error('quantity required')
  if (!txn.tradeCurrency) throw new Error('tradeCurrency required')

  return {
    _id: deterministicId(txn.broker, txn.externalId),
    reservedModelType: 'AssetTransaction',
    reservedOwnerId: ctx.ownerId,
    reservedAuthorId: ctx.ownerId,
    reservedSource: 'wallet-broker-sync',
    reservedCreatedAt: ctx.now,
    reservedUpdatedAt: ctx.now,
    assetId: ctx.assetId,
    accountId: ctx.accountId,
    assetType: 1,
    transactionType: txn.kind === 'buy' ? 0 : 1,
    date: txn.date,
    quantity: txn.quantity,
    price: Math.round(txn.pricePerShare * 100),
    // Round to 4 decimals (sub-cent precision) to avoid float drift like
    // -2.18 * 100 = -217.99999999999997. Spec encoding is "decimal × 100".
    cashAmount: Number((txn.cashAmount * 100).toFixed(4)),
    priceCurrencyCode: txn.tradeCurrency,
    cashAmountCurrencyCode: txn.settlementCurrency,
    externalSource: txn.broker,
    externalId: txn.externalId,
    syncedAt: ctx.now,
    syncToolVersion: ctx.toolVersion,
  }
}
```

- [ ] **Step 4.4: Verify**

```bash
npx vitest run tests/sync/mapper.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 4.5: Commit**

```bash
git add src/sync/mapper.ts tests/sync/mapper.test.ts && git commit -m "feat: CanonicalTxn → AssetTransaction mapper with × 100 encoding"
```

---

## Task 5: CouchDB client (read existing + bulk write)

**Files:** `src/sync/couch.ts`, `tests/sync/couch.test.ts`

- [ ] **Step 5.1: Failing test with mocked fetch**

`tests/sync/couch.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CouchClient } from '@/src/sync/couch'

describe('CouchClient', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  const client = () => new CouchClient({
    url: 'https://example.test', dbName: 'bb-user',
    auth: { login: 'user', token: 'secret' },
  })

  it('bulkDocs sends new_edits=true and returns per-doc result', async () => {
    ;(fetch as any).mockResolvedValueOnce(new Response(JSON.stringify([
      { id: 'a', ok: true, rev: '1-x' },
      { id: 'b', error: 'conflict', reason: 'Document update conflict.' },
    ]), { status: 201 }))
    const res = await client().bulkDocs([{ _id: 'a' }, { _id: 'b' }] as any)
    expect(res).toEqual([
      { id: 'a', status: 'inserted', rev: '1-x' },
      { id: 'b', status: 'conflict' },
    ])
    const call = (fetch as any).mock.calls[0]
    expect(call[0]).toBe('https://example.test/bb-user/_bulk_docs')
    expect(JSON.parse(call[1].body)).toMatchObject({ new_edits: true })
  })

  it('throws on 401', async () => {
    ;(fetch as any).mockResolvedValueOnce(new Response('unauth', { status: 401 }))
    await expect(client().bulkDocs([])).rejects.toMatchObject({ kind: 'unauthorized' })
  })

  it('listAssetTransactions paginates _changes until last_seq stops moving', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: '-AssetTransaction_1', doc: { _id: '-AssetTransaction_1', reservedModelType: 'AssetTransaction', accountId: 'A' } }],
        last_seq: 100,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [], last_seq: 100 })))
    const docs = await client().listAssetTransactions('A')
    expect(docs).toHaveLength(1)
    expect(docs[0]._id).toBe('-AssetTransaction_1')
  })

  it('listAssetTransactions terminates when last_seq advances but predicate filters everything', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: 'x', doc: { _id: 'x', reservedModelType: 'Other', accountId: 'A' } }],
        last_seq: 1,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: 'y', doc: { _id: 'y', reservedModelType: 'Other', accountId: 'A' } }],
        last_seq: 2,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [], last_seq: 2 })))
    const docs = await client().listAssetTransactions('A')
    expect(docs).toHaveLength(0)
    // terminates after at most 3 calls (no infinite loop)
    expect((fetch as any).mock.calls.length).toBeLessThanOrEqual(3)
  })
})
```

- [ ] **Step 5.2: Implement**

`src/sync/couch.ts`:
```ts
type Auth = { login: string; token: string }

export type CouchError =
  | { kind: 'unauthorized'; status: number }
  | { kind: 'rate_limited'; status: 429; retryAfter?: number }
  | { kind: 'http'; status: number; body: string }
  | { kind: 'network'; cause: unknown }

export type BulkDocResult =
  | { id: string; status: 'inserted'; rev: string }
  | { id: string; status: 'conflict' }
  | { id: string; status: 'error'; reason: string }

export class CouchClient {
  constructor(private readonly cfg: { url: string; dbName: string; auth: Auth }) {}

  private get authHeader(): string {
    return `Basic ${Buffer.from(`${this.cfg.auth.login}:${this.cfg.auth.token}`).toString('base64')}`
  }

  private url(path: string): string { return `${this.cfg.url}/${this.cfg.dbName}${path}` }

  private async req(path: string, init?: RequestInit): Promise<Response> {
    let res: Response
    try {
      res = await fetch(this.url(path), {
        ...init,
        headers: {
          'authorization': this.authHeader,
          'content-type': 'application/json',
          'accept': 'application/json',
          ...init?.headers,
        },
      })
    } catch (cause) { throw { kind: 'network', cause } satisfies CouchError }
    if (res.status === 401 || res.status === 403) throw { kind: 'unauthorized', status: res.status } satisfies CouchError
    if (res.status === 429) {
      const ra = res.headers.get('retry-after')
      throw { kind: 'rate_limited', status: 429, retryAfter: ra ? Number(ra) : undefined } satisfies CouchError
    }
    if (!res.ok) throw { kind: 'http', status: res.status, body: await res.text() } satisfies CouchError
    return res
  }

  async bulkDocs(docs: Array<Record<string, unknown>>): Promise<BulkDocResult[]> {
    const res = await this.req('/_bulk_docs', { method: 'POST', body: JSON.stringify({ docs, new_edits: true }) })
    const arr = (await res.json()) as Array<{ id: string; ok?: boolean; rev?: string; error?: string; reason?: string }>
    return arr.map(r => {
      if (r.ok) return { id: r.id, status: 'inserted', rev: r.rev! }
      if (r.error === 'conflict') return { id: r.id, status: 'conflict' }
      return { id: r.id, status: 'error', reason: r.reason ?? r.error ?? 'unknown' }
    })
  }

  async listAssetTransactions(accountId: string): Promise<Array<Record<string, unknown>>> {
    return this.list(d => d.reservedModelType === 'AssetTransaction' && d.accountId === accountId)
  }

  async listByModelType<T = Record<string, unknown>>(modelType: string): Promise<T[]> {
    return this.list(d => d.reservedModelType === modelType) as Promise<T[]>
  }

  private async list(predicate: (doc: any) => boolean): Promise<any[]> {
    const out: any[] = []
    let since: number | string = 0
    while (true) {
      const params = new URLSearchParams({ include_docs: 'true', style: 'main_only', since: String(since), limit: '500' })
      const res = await this.req(`/_changes?${params}`)
      const data = (await res.json()) as { results: Array<{ id: string; doc?: any }>; last_seq: number | string }
      for (const r of data.results) {
        if (r.doc && !r.doc._deleted && predicate(r.doc)) out.push(r.doc)
      }
      if (data.last_seq === since || data.results.length === 0) break
      since = data.last_seq
    }
    return out
  }
}
```

- [ ] **Step 5.3: Verify**

```bash
npx vitest run tests/sync/couch.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5.4: Commit**

```bash
git add src/sync/couch.ts tests/sync/couch.test.ts && git commit -m "feat: CouchDB client with bulkDocs and _changes-paginated reads"
```

---

## Task 6: Phase-0 capture #12 — write+read+delete a synthetic AssetTransaction

The load-bearing architectural test. Confirms `validate_doc_update` accepts our deterministic `_id` AND confirms `transactionType: 1 = sell`.

**Files:** `scripts/couch-probe.ts`

- [ ] **Step 6.1: Implement probe**

`scripts/couch-probe.ts`:
```ts
import { CouchClient } from '@/src/sync/couch'
import { deterministicId } from '@/src/sync/ids'

function must(k: string): string {
  const v = process.env[k]
  if (!v) { console.error(`missing env var: ${k}`); process.exit(1) }
  return v
}

async function main() {
  const cfg = {
    url: must('COUCH_URL'), dbName: must('COUCH_DB'),
    auth: { login: must('COUCH_LOGIN'), token: must('COUCH_TOKEN') },
  }
  const accountId = must('COUCH_TEST_ACCOUNT')
  const assetId = must('COUCH_TEST_ASSET')
  const ownerId = cfg.auth.login

  const client = new CouchClient(cfg)
  const now = new Date().toISOString()
  const probeIdBuy = `wallet-broker-sync-probe-${Date.now()}-buy`
  const probeIdSell = `wallet-broker-sync-probe-${Date.now()}-sell`

  const buyDoc = {
    _id: deterministicId('xtb', probeIdBuy),
    reservedModelType: 'AssetTransaction', reservedOwnerId: ownerId, reservedAuthorId: ownerId,
    reservedSource: 'wallet-broker-sync', reservedCreatedAt: now, reservedUpdatedAt: now,
    assetId, accountId, assetType: 1, transactionType: 0,
    date: now, quantity: 0.0001, price: 100, cashAmount: 0.01,
    priceCurrencyCode: 'EUR', cashAmountCurrencyCode: 'EUR',
    externalSource: 'wallet-broker-sync-probe', externalId: probeIdBuy,
  }
  const sellDoc = { ...buyDoc, _id: deterministicId('xtb', probeIdSell), transactionType: 1, externalId: probeIdSell }

  console.log('Writing probe buy + sell with deterministic v5 _ids...')
  const writeRes = await client.bulkDocs([buyDoc, sellDoc])
  console.log('bulkDocs response:', JSON.stringify(writeRes, null, 2))
  if (!writeRes.every(r => r.status === 'inserted')) {
    console.error('At least one doc was not inserted. _id format may need to change to v4-flip.')
    process.exit(2)
  }

  console.log('Reading back via _changes...')
  const docs = await client.listAssetTransactions(accountId)
  const buyMatch = docs.find(d => d._id === buyDoc._id)
  const sellMatch = docs.find(d => d._id === sellDoc._id)
  if (!buyMatch || !sellMatch) { console.error('Probe docs not round-tripped.'); process.exit(3) }

  console.log('Both probe docs round-tripped. Deleting...')
  await client.bulkDocs([
    { ...buyMatch, _deleted: true },
    { ...sellMatch, _deleted: true },
  ])
  console.log('Done. transactionType: 0=buy, 1=sell confirmed. Deterministic _id accepted.')
}

main().catch(err => { console.error(err); process.exit(99) })
```

- [ ] **Step 6.2: Add npm script**

In `package.json` `"scripts"`: `"probe:couch": "tsx scripts/couch-probe.ts"`

- [ ] **Step 6.3: Discover the test account and asset IDs (if not already known)**

If the user doesn't already know which `-Account_<uuid>` and `-StocksFundsAsset_<uuid>` to use, run a one-off list against their CouchDB:

```bash
COUCH_URL=https://couch-prod-eu-1.budgetbakers.com \
COUCH_DB=bb-<userId> \
COUCH_LOGIN=<userId> \
COUCH_TOKEN=<token> \
npx tsx -e "
import { CouchClient } from './src/sync/couch'
const c = new CouchClient({ url: process.env.COUCH_URL!, dbName: process.env.COUCH_DB!,
  auth: { login: process.env.COUCH_LOGIN!, token: process.env.COUCH_TOKEN! } })
const accounts = await c.listByModelType('Account')
const assets = await c.listByModelType('StocksFundsAsset')
console.log('Investment accounts:', accounts.filter((a: any) => a.accountType === 7).map((a: any) => ({ id: a._id, name: a.name })))
console.log('Assets:', assets.slice(0, 5).map((a: any) => ({ id: a._id, symbol: a.symbol, exchange: a.exchangeCode })))
console.log('Currency field name on first Account:', accounts[0])
"
```

**Resolved (post-probe):** the `Currency` doc field is `code` (NOT `currencyCode`). `LookupService` reads `c.code` from CouchDB and exposes it as `currencyCode` in our local `InvestmentAccount` shape — see Task 8.

- [ ] **Step 6.4: Run probe with creds (user, manual)**

Set env vars (NOT committed):
```
COUCH_URL=https://couch-prod-eu-1.budgetbakers.com
COUCH_DB=bb-<userId>
COUCH_LOGIN=<userId>
COUCH_TOKEN=<token>
COUCH_TEST_ACCOUNT=-Account_<from step 6.3>
COUCH_TEST_ASSET=-StocksFundsAsset_<from step 6.3>
```

Run: `npm run probe:couch`

Expected: "Both probe docs round-tripped" + the buy/sell `_rev` values.

**If status is not `inserted` for any doc:** the only required change is swapping the export in `src/sync/ids.ts` from `deterministicId` to `deterministicIdV4Looking`, then re-running the probe. Tasks 7–21 are unaffected by which `_id` shape is in use — the rest of the architecture is decoupled from the version nibble.

- [ ] **Step 6.5: Update spec with the resolved unknowns**

Edit the spec — mark phase-0 capture #2 (sell type), #6 (Currency field name), and #12 (validate acceptance) as ✅ Confirmed; note which `_id` shape is in use.

- [ ] **Step 6.6: Commit**

```bash
git add scripts/couch-probe.ts package.json package-lock.json docs/ && git commit -m "feat: phase-0 capture #12 probe + spec update with resolved unknowns"
```

---

## Task 7: XTB parser (TDD)

**Files:** `src/parsers/xtb.ts`, `src/parsers/xtb-venues.ts`, `src/parsers/registry.ts`, `tests/parsers/xtb.test.ts`, `tests/parsers/fixtures/xtb-2026.xlsx`

- [ ] **Step 7.1: Build a redacted XTB fixture from `sources/xtb.xlsx`**

```bash
mkdir -p tests/parsers/fixtures
node -e "
const XLSX = require('xlsx');
const wb = XLSX.readFile('sources/xtb.xlsx');
for (const name of wb.SheetNames) {
  const sh = wb.Sheets[name];
  for (const k of Object.keys(sh)) {
    if (k.startsWith('!')) continue;
    const c = sh[k];
    if (c && typeof c.v === 'string') {
      c.v = c.v.replace(/DARIUS-OVIDIU CUPSA/g, 'TEST USER').replace(/\b\d{8}\b/g, '00000000');
    }
  }
}
XLSX.writeFile(wb, 'tests/parsers/fixtures/xtb-2026.xlsx');
console.log('redacted fixture written');
"
```

- [ ] **Step 7.2: Failing test**

`tests/parsers/xtb.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { xtb } from '@/src/parsers/xtb'

const fixture = (name: string) => ({
  bytes: new Uint8Array(readFileSync(resolve('tests/parsers/fixtures', name))),
  filename: name,
})

describe('xtb parser', () => {
  it('detect() accepts xlsx', () => {
    expect(xtb.detect(fixture('xtb-2026.xlsx'))).toBe(true)
  })
  it('parses real XTB export into CanonicalTxn[]', () => {
    const result = xtb.parse(fixture('xtb-2026.xlsx'))
    expect(result.txns.length).toBeGreaterThan(0)
    const buy = result.txns.find(t => t.kind === 'buy')
    expect(buy).toBeTruthy()
    expect(buy!.broker).toBe('xtb')
    expect(buy!.symbol).toBeTruthy()
    expect(buy!.exchange).toBeTruthy()
    expect(buy!.quantity).toBeGreaterThan(0)
    expect(buy!.pricePerShare).toBeGreaterThan(0)
    expect(buy!.tradeCurrency).toBe('EUR')
    expect(buy!.settlementCurrency).toBe('EUR')
    expect(buy!.externalId).toMatch(/^\d+$/)
    expect(buy!.date).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
  it('emits unsupported rows for non-stock-purchase types', () => {
    const result = xtb.parse(fixture('xtb-2026.xlsx'))
    expect(result.unsupported.some(u => /deposit|withdrawal|dividend/i.test(u.reason))).toBe(true)
  })
})
```

- [ ] **Step 7.3: Implement xtb-venues**

`src/parsers/xtb-venues.ts`:
```ts
const SUFFIX_TO_MIC: Record<string, string> = {
  '.DE': 'XETR', '.UK': 'XLON', '.US': 'XNYS',
  '.PL': 'XWAR', '.NL': 'XAMS', '.IT': 'MTAA',
  '.FR': 'XPAR', '.ES': 'XMAD', '.PT': 'XLIS',
}

export function micFromXtbSymbol(symbol: string): { mic: string; bareSymbol: string } | null {
  for (const [suffix, mic] of Object.entries(SUFFIX_TO_MIC)) {
    if (symbol.endsWith(suffix)) return { mic, bareSymbol: symbol.slice(0, -suffix.length) }
  }
  return null
}
```

- [ ] **Step 7.4: Implement xtb parser**

`src/parsers/xtb.ts`:
```ts
import * as XLSX from 'xlsx'
import type { BrokerParser, ParseResult, ParserInput, UnsupportedRow } from './types'
import type { CanonicalTxn } from '@/src/types'
import { micFromXtbSymbol } from './xtb-venues'

const SHEET_CASH = 'CASH OPERATION HISTORY'
const COMMENT_RE = /^OPEN (BUY|SELL) (\d+(?:\.\d+)?) @ (\d+(?:\.\d+)?)$/

export const xtb: BrokerParser = {
  id: 'xtb',
  displayName: 'XTB',
  acceptedFormats: ['xlsx'],

  detect(input) {
    if (!input.filename.toLowerCase().endsWith('.xlsx')) return false
    try {
      const wb = XLSX.read(input.bytes, { type: 'array' })
      // Tolerate trailing/leading whitespace in sheet names — XTB has shipped variations
      // (e.g. 'PENDING ORDERS HISTORY ' with trailing space).
      return wb.SheetNames.some(n => n.trim() === SHEET_CASH)
    } catch { return false }
  },

  parse(input): ParseResult {
    const wb = XLSX.read(input.bytes, { type: 'array' })
    const sheetName = wb.SheetNames.find(n => n.trim() === SHEET_CASH)
    if (!sheetName) throw new Error(`XTB: sheet "${SHEET_CASH}" not found`)
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]

    let headerRow = -1
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].map(c => (c == null ? '' : String(c)).trim()).filter(Boolean)
      if (cells[0] === 'ID' && cells.includes('Type') && cells.includes('Time')) { headerRow = i; break }
    }
    if (headerRow < 0) throw new Error('XTB: header row not found')

    const headers = rows[headerRow].map(c => (c == null ? '' : String(c)).trim())
    const idx = (name: string) => headers.indexOf(name)
    const ID = idx('ID'), TYPE = idx('Type'), TIME = idx('Time'),
          COMMENT = idx('Comment'), SYMBOL = idx('Symbol'), AMOUNT = idx('Amount')

    const txns: CanonicalTxn[] = []
    const unsupported: UnsupportedRow[] = []

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every(c => c == null || c === '')) continue
      const type = String(row[TYPE] ?? '').trim()
      if (type !== 'Stock purchase' && type !== 'Stock sale') {
        unsupported.push({
          row: row[ID] != null ? String(row[ID]) : i + 1,
          reason: `unsupported XTB type for v1: "${type}"`,
          raw: Object.fromEntries(headers.map((h, j) => [h, row[j]])),
        })
        continue
      }
      const id = row[ID] != null ? String(row[ID]) : null
      if (!id) { unsupported.push({ row: i + 1, reason: 'missing ID', raw: { row } }); continue }
      const comment = String(row[COMMENT] ?? '')
      const m = COMMENT_RE.exec(comment)
      if (!m) { unsupported.push({ row: id, reason: `cannot parse Comment "${comment}"`, raw: { comment } }); continue }
      const side: 'buy' | 'sell' = m[1] === 'BUY' ? 'buy' : 'sell'
      const symbol = String(row[SYMBOL] ?? '').trim()
      const venue = micFromXtbSymbol(symbol)
      if (!venue) { unsupported.push({ row: id, reason: `unknown XTB symbol suffix: "${symbol}"`, raw: { symbol } }); continue }
      const time = row[TIME]
      const date = excelSerialToIso(typeof time === 'number' ? time : Number(time))
      if (!date) { unsupported.push({ row: id, reason: `bad time field: "${time}"`, raw: { time } }); continue }

      txns.push({
        externalId: id, broker: 'xtb', kind: side,
        date,
        symbol: venue.bareSymbol, exchange: venue.mic,
        quantity: Number(m[2]), pricePerShare: Number(m[3]),
        tradeCurrency: 'EUR', settlementCurrency: 'EUR',
        cashAmount: Number(row[AMOUNT]),
        description: comment,
        raw: Object.fromEntries(headers.map((h, j) => [h, row[j]])),
      })
    }
    return { txns, unsupported }
  },
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null
  return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString()
}
```

- [ ] **Step 7.5: Verify**

```bash
npx vitest run tests/parsers/xtb.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 7.6: Register parser**

`src/parsers/registry.ts`:
```ts
import type { BrokerParser, ParserInput } from './types'
import { xtb } from './xtb'

export const parsers: Record<string, BrokerParser> = { xtb }

export function detectParser(input: ParserInput): BrokerParser | null {
  for (const p of Object.values(parsers)) {
    try { if (p.detect(input)) return p } catch {}
  }
  return null
}
```

- [ ] **Step 7.7: Commit**

```bash
git add src/parsers/ tests/parsers/ && git commit -m "feat: XTB parser (XLSX, CASH OPERATION HISTORY sheet)"
```

---

## Task 8: Account/Asset/Currency lookup

**Files:** `src/sync/lookup.ts`, `tests/sync/lookup.test.ts`

- [ ] **Step 8.1: Failing test**

`tests/sync/lookup.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { LookupService } from '@/src/sync/lookup'

const couchOf = (docs: any[]) => ({
  listByModelType: vi.fn(async (t: string) => docs.filter(d => d.reservedModelType === t)),
}) as any

describe('LookupService', () => {
  it('resolves accountId → currencyCode via Currency indirection', async () => {
    const svc = new LookupService(couchOf([
      { _id: '-Account_a', reservedModelType: 'Account', accountType: 7, name: 'XTB', currencyId: '-Currency_eur' },
      { _id: '-Currency_eur', reservedModelType: 'Currency', code: 'EUR' },
    ]))
    await svc.refresh()
    expect(svc.investmentAccounts()[0]).toMatchObject({ id: '-Account_a', name: 'XTB', currencyCode: 'EUR' })
  })
  it('resolves (exchange, symbol) → assetId', async () => {
    const svc = new LookupService(couchOf([
      { _id: '-StocksFundsAsset_v', reservedModelType: 'StocksFundsAsset', symbol: 'VUAA', exchangeCode: 'XETR', currencyCode: 'EUR' },
    ]))
    await svc.refresh()
    expect(svc.assetByVenueSymbol('XETR', 'VUAA')).toBe('-StocksFundsAsset_v')
    expect(svc.assetByVenueSymbol('XETR', 'NOPE')).toBe(null)
  })
})
```

- [ ] **Step 8.2: Implement**

`src/sync/lookup.ts`:
```ts
import type { CouchClient } from './couch'

export type InvestmentAccount = {
  id: string
  name: string
  currencyCode: string
  assetTypes: number[]
}

export class LookupService {
  private accounts: InvestmentAccount[] = []
  private assetMap = new Map<string, string>()

  constructor(private readonly couch: Pick<CouchClient, 'listByModelType'>) {}

  async refresh() {
    const [accounts, currencies, assets] = await Promise.all([
      this.couch.listByModelType<{ _id: string; accountType: number; name: string; currencyId: string; investmentInfo?: { assetTypes?: number[] } }>('Account'),
      this.couch.listByModelType<{ _id: string; code: string }>('Currency'),
      this.couch.listByModelType<{ _id: string; symbol: string; exchangeCode: string }>('StocksFundsAsset'),
    ])
    const currencyMap = new Map(currencies.map(c => [c._id, c.code]))
    this.accounts = accounts.filter(a => a.accountType === 7).map(a => ({
      id: a._id, name: a.name,
      currencyCode: currencyMap.get(a.currencyId) ?? 'EUR',
      assetTypes: a.investmentInfo?.assetTypes ?? [],
    }))
    this.assetMap.clear()
    for (const a of assets) {
      this.assetMap.set(`${a.exchangeCode.toUpperCase()}:${a.symbol.toUpperCase()}`, a._id)
    }
  }

  investmentAccounts(): InvestmentAccount[] { return this.accounts }
  assetByVenueSymbol(mic: string, symbol: string): string | null {
    return this.assetMap.get(`${mic.toUpperCase()}:${symbol.toUpperCase()}`) ?? null
  }
}
```

- [ ] **Step 8.3: Verify + commit**

```bash
npx vitest run tests/sync/lookup.test.ts
git add src/sync/lookup.ts tests/sync/lookup.test.ts && git commit -m "feat: LookupService for investment accounts and assets"
```

---

## Task 9: Sync engine (parse → resolve → diff → write)

**Files:** `src/sync/engine.ts`, `tests/sync/engine.test.ts`

- [ ] **Step 9.1: Failing test (mocked CouchClient + LookupService)**

Test cases: all-new (3 inserts), all-existing (0 inserts, 3 conflicts), needs-asset (asset missing → row in `needsAsset`).

```ts
import { describe, it, expect, vi } from 'vitest'
import { runSync } from '@/src/sync/engine'

describe('runSync', () => {
  const baseTxn = { externalId: '1', broker: 'xtb', kind: 'buy', date: '2026-04-28T10:00:00.000Z',
    symbol: 'VUAA', exchange: 'XETR', quantity: 1, pricePerShare: 118.04,
    tradeCurrency: 'EUR', settlementCurrency: 'EUR', cashAmount: -118.05, description: '', raw: {} } as const

  it('inserts all-new docs', async () => {
    const couch: any = {
      listAssetTransactions: vi.fn(async () => []),
      bulkDocs: vi.fn(async (docs: any[]) => docs.map(d => ({ id: d._id, status: 'inserted', rev: '1-x' }))),
    }
    const lookup: any = { assetByVenueSymbol: vi.fn(() => '-StocksFundsAsset_y') }
    const r = await runSync({
      broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    expect(r.inserted).toBe(1); expect(r.conflict).toBe(0); expect(r.needsAsset).toHaveLength(0)
  })

  it('reports conflicts when docs already exist', async () => {
    const couch: any = {
      listAssetTransactions: vi.fn(async () => []),
      bulkDocs: vi.fn(async (docs: any[]) => docs.map(d => ({ id: d._id, status: 'conflict' }))),
    }
    const lookup: any = { assetByVenueSymbol: vi.fn(() => '-StocksFundsAsset_y') }
    const r = await runSync({ broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup })
    expect(r.inserted).toBe(0); expect(r.conflict).toBe(1)
  })

  it('routes missing-asset rows to needsAsset', async () => {
    const couch: any = { listAssetTransactions: vi.fn(async () => []), bulkDocs: vi.fn(async () => []) }
    const lookup: any = { assetByVenueSymbol: vi.fn(() => null) }
    const r = await runSync({ broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup })
    expect(r.inserted).toBe(0); expect(r.needsAsset).toHaveLength(1)
  })
})
```

- [ ] **Step 9.2: Implement engine**

`src/sync/engine.ts`:
```ts
import type { CanonicalTxn } from '@/src/types'
import type { CouchClient } from './couch'
import type { LookupService } from './lookup'
import type { UnsupportedRow } from '@/src/parsers/types'
import { toAssetTransactionDoc, type AssetTransactionDoc } from './mapper'

export type SyncInput = {
  broker: string; txns: CanonicalTxn[]; unsupported: UnsupportedRow[]
  accountId: string; ownerId: string; toolVersion: string
  couch: Pick<CouchClient, 'listAssetTransactions' | 'bulkDocs'>
  lookup: Pick<LookupService, 'assetByVenueSymbol'>
}

export type SyncResult = {
  total: number; inserted: number; conflict: number
  errors: Array<{ id: string; reason: string }>
  needsAsset: CanonicalTxn[]
  unsupported: UnsupportedRow[]
  preview: { new: AssetTransactionDoc[]; alreadyPresent: string[] }
}

export async function runSync(input: SyncInput): Promise<SyncResult> {
  const existing = await input.couch.listAssetTransactions(input.accountId)
  const existingIds = new Set(existing.map((d: any) => d._id))
  const now = new Date().toISOString()

  const toInsert: AssetTransactionDoc[] = []
  const alreadyPresent: string[] = []
  const needsAsset: CanonicalTxn[] = []

  for (const t of input.txns) {
    if (t.kind === 'fee') continue
    if (!t.exchange || !t.symbol) { needsAsset.push(t); continue }
    const assetId = input.lookup.assetByVenueSymbol(t.exchange, t.symbol)
    if (!assetId) { needsAsset.push(t); continue }
    const doc = toAssetTransactionDoc(t, {
      accountId: input.accountId, assetId,
      ownerId: input.ownerId, now, toolVersion: input.toolVersion,
    })
    if (existingIds.has(doc._id)) alreadyPresent.push(doc._id)
    else toInsert.push(doc)
  }

  let inserted = 0, conflict = 0
  const errors: SyncResult['errors'] = []
  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50)
    const res = await input.couch.bulkDocs(batch)
    for (const r of res) {
      if (r.status === 'inserted') inserted++
      else if (r.status === 'conflict') conflict++
      else errors.push({ id: r.id, reason: r.reason })
    }
  }

  return {
    total: input.txns.length,
    inserted, conflict, errors,
    needsAsset, unsupported: input.unsupported,
    preview: { new: toInsert, alreadyPresent },
  }
}
```

- [ ] **Step 9.3: Verify + commit**

```bash
npx vitest run tests/sync/engine.test.ts
git add src/sync/engine.ts tests/sync/engine.test.ts && git commit -m "feat: sync engine with diff and batched bulk writes"
```

---

## Task 10: Credentials (keychain)

**Files:** `src/storage/credentials.ts`, `tests/storage/credentials.test.ts`

- [ ] **Step 10.1: Failing test (keytar mocked)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('keytar', () => ({ default: { setPassword: vi.fn(), getPassword: vi.fn(), deletePassword: vi.fn() } }))
import keytar from 'keytar'
import { saveCouchCreds, loadCouchCreds } from '@/src/storage/credentials'

describe('credentials', () => {
  beforeEach(() => { vi.resetAllMocks() })
  it('saves and loads creds', async () => {
    await saveCouchCreds({ login: 'u', token: 't' })
    expect(keytar.setPassword).toHaveBeenCalledWith('wallet-broker-sync', 'couch-basic-auth', JSON.stringify({ login: 'u', token: 't' }))
    ;(keytar.getPassword as any).mockResolvedValueOnce(JSON.stringify({ login: 'u', token: 't' }))
    expect(await loadCouchCreds()).toEqual({ login: 'u', token: 't' })
  })
})
```

- [ ] **Step 10.2: Implement**

`src/storage/credentials.ts`:
```ts
import keytar from 'keytar'
const SERVICE = 'wallet-broker-sync', ACCOUNT = 'couch-basic-auth'
export type CouchCreds = { login: string; token: string }
export async function saveCouchCreds(c: CouchCreds): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(c))
}
export async function loadCouchCreds(): Promise<CouchCreds | null> {
  const v = await keytar.getPassword(SERVICE, ACCOUNT)
  return v ? JSON.parse(v) : null
}
export async function deleteCouchCreds(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT)
}
```

- [ ] **Step 10.3: Verify + commit**

```bash
npx vitest run tests/storage/credentials.test.ts
git add src/storage/credentials.ts tests/storage/credentials.test.ts && git commit -m "feat: keychain-backed credential storage"
```

---

## Task 11: SQLite audit log

**Files:** `src/storage/db.ts`, `src/storage/schema.ts`, `drizzle.config.ts`

- [ ] **Step 11.1: Drizzle schema**

`src/storage/schema.ts`:
```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const brokerAccountMap = sqliteTable('broker_account_map', {
  broker: text('broker').primaryKey(),
  accountId: text('account_id').notNull(),
  currencyCode: text('currency_code').notNull(),
})

export const syncRun = sqliteTable('sync_run', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  broker: text('broker').notNull(),
  accountId: text('account_id').notNull(),
  sourceFilename: text('source_filename').notNull(),
  sourceSha256: text('source_sha256').notNull(),
  parsedCount: integer('parsed_count').notNull(),
  insertedCount: integer('inserted_count').notNull(),
  conflictCount: integer('conflict_count').notNull(),
  errorCount: integer('error_count').notNull(),
})

export const syncRunDoc = sqliteTable('sync_run_doc', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull(),
  externalId: text('external_id'),
  docId: text('doc_id'),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
})
```

- [ ] **Step 11.2: DB init + migrations runner**

`src/storage/db.ts`:
```ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'

const dataDir = join(homedir(), '.wallet-broker-sync')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const sqlite = new Database(join(dataDir, 'audit.sqlite'))
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite)

export function runMigrations() {
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
}
```

`drizzle.config.ts`:
```ts
import type { Config } from 'drizzle-kit'
export default {
  schema: 'src/storage/schema.ts',
  out: 'src/storage/migrations',
  dialect: 'sqlite',
} satisfies Config
```

- [ ] **Step 11.3: Generate migration**

```bash
npx drizzle-kit generate
```

- [ ] **Step 11.4: Round-trip test**

`tests/storage/db.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { syncRun, syncRunDoc } from '@/src/storage/schema'
import { eq } from 'drizzle-orm'

describe('audit log schema', () => {
  // In-memory DB so the test never touches the user's real audit DB
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)

  beforeAll(() => { migrate(db, { migrationsFolder: 'src/storage/migrations' }) })

  it('inserts and reads a sync_run with detail rows', async () => {
    const ins = await db.insert(syncRun).values({
      startedAt: 1000, finishedAt: 2000, broker: 'xtb',
      accountId: '-Account_a', sourceFilename: 'xtb.xlsx', sourceSha256: 'abc',
      parsedCount: 3, insertedCount: 2, conflictCount: 1, errorCount: 0,
    }).returning()
    expect(ins[0].id).toBeGreaterThan(0)
    await db.insert(syncRunDoc).values([
      { runId: ins[0].id, externalId: 'x1', docId: '-AssetTransaction_d1', status: 'inserted' },
      { runId: ins[0].id, externalId: 'x2', docId: '-AssetTransaction_d2', status: 'conflict' },
    ])
    const detail = await db.select().from(syncRunDoc).where(eq(syncRunDoc.runId, ins[0].id))
    expect(detail).toHaveLength(2)
  })
})
```

Run: `npx vitest run tests/storage/db.test.ts`. Expected: PASS.

- [ ] **Step 11.5: Commit**

```bash
git add src/storage/ drizzle.config.ts tests/storage/ && git commit -m "feat: SQLite audit log via Drizzle with round-trip test"
```

---

## Task 12: API routes — config, accounts, sync

**Files:** `app/api/config/route.ts`, `app/api/couch/accounts/route.ts`, `app/api/sync/route.ts`

These run server-side; credentials never touch the browser. The browser calls these routes which then call CouchDB.

- [ ] **Step 12.1: `/api/config` GET/POST**

GET reads setup state (configured? broker→account mappings?). POST saves CouchDB connection details (URL, dbName) to SQLite config table; saves creds to keychain; saves broker→account mappings.

- [ ] **Step 12.2: `/api/couch/accounts` GET**

Loads creds from keychain, builds `CouchClient`, calls `LookupService.refresh()`, returns the investment-account list.

- [ ] **Step 12.3: `/api/sync` POST**

Body: multipart with `file` + `broker`. Server-side:
1. Read bytes, hash sha256 (for audit).
2. Run `parsers[broker].parse({bytes, filename})`.
3. Look up `accountId` from `broker_account_map`.
4. Build `CouchClient` + `LookupService`; refresh lookup.
5. Call `runSync(...)`.
6. Persist run summary to SQLite.
7. Return `SyncResult` (sans full doc bodies — just summary, counts, needsAsset list, preview ids).

Add a `dryRun=true` query param: when set, run only through `runSync`'s diff phase (skip `bulkDocs`); used by the upload-preview screen.

- [ ] **Step 12.4: Smoke-test the routes**

Manual: start dev server, test setup flow with curl, confirm 200s.

- [ ] **Step 12.5: Commit**

```bash
git add app/api/ && git commit -m "feat: server routes for config, accounts, sync"
```

---

## Task 13: UI — Setup screen

**Files:** `app/setup/page.tsx` (server component), `app/setup/SetupForm.tsx` (client component), `app/setup/AccountMappingForm.tsx` (client component)

State flow: client form → POST `/api/config` → GET `/api/couch/accounts` → mapping form → POST `/api/config` (mappings) → `router.push('/upload')`.

- [ ] **Step 13.1: Build the route shell**

`app/setup/page.tsx` — server component. Reads existing config via `/api/config` (or directly from SQLite) and decides whether to render the connection form or the mapping form. Returns the appropriate client component.

- [ ] **Step 13.2: Connection form (client component)**

`app/setup/SetupForm.tsx`. Fields: CouchDB URL (default `https://couch-prod-eu-1.budgetbakers.com`), userId/login, token (password input), dbName. shadcn `Input` + `Button`. On submit: POST `/api/config` with body. On success: trigger `router.refresh()` so the parent re-renders into the mapping form.

- [ ] **Step 13.3: Connection-form error states**

Display server errors (`401 unauthorized` → "Invalid credentials"; `network` → "Could not reach CouchDB"). Prevent double-submit while in flight.

- [ ] **Step 13.4: Account mapping form**

`app/setup/AccountMappingForm.tsx`. Loads investment accounts via `fetch('/api/couch/accounts')` on mount. Renders three labeled selects — XTB, IBKR, Tradeville — each populated with `(account.name, account.currencyCode)` options. Submit POSTs the selected mappings to `/api/config`.

- [ ] **Step 13.5: Redirect on completion**

After mappings save, `router.push('/upload')`.

- [ ] **Step 13.6: Manual end-to-end against real Wallet**

Start dev server (`npm run dev`), open `http://localhost:3000/setup`, paste real CouchDB credentials, verify the mapping form populates with the user's three investment accounts, save mappings, verify redirect to `/upload`.

- [ ] **Step 13.7: Commit**

```bash
git add app/setup/ && git commit -m "feat: setup screen for CouchDB credentials and broker→account mapping"
```

---

## Task 14: UI — Upload + parser detection

**Files:** `app/upload/page.tsx`, `app/upload/UploadDropzone.tsx`, `src/ui/store.ts`

**Cross-screen state:** the upload → preview → result flow needs to keep the original `File` bytes available for the confirm step (the preview screen must POST the *same* file to `/api/sync` without `dryRun`). `sessionStorage` only holds strings and JSON-encoding `Uint8Array` for an XLSX/PDF is awkward. We use a tiny in-memory store via Zustand instead, scoped to the client root layout.

`src/ui/store.ts`:
```ts
import { create } from 'zustand'
import type { BrokerId } from '@/src/types'

type Wizard = {
  file: File | null
  broker: BrokerId | null
  dryRun: any | null            // SyncResult preview
  result: any | null            // SyncResult final
  set: (v: Partial<Omit<Wizard, 'set'>>) => void
  reset: () => void
}

export const useWizard = create<Wizard>((set) => ({
  file: null, broker: null, dryRun: null, result: null,
  set: (v) => set(v),
  reset: () => set({ file: null, broker: null, dryRun: null, result: null }),
}))
```

Add `zustand` to deps:
```bash
npm install --save zustand
```

State flow: drop file → store `File` + suggested `broker` in Zustand → POST `/api/sync?dryRun=true` (multipart) → store result in Zustand as `dryRun` → navigate to `/preview`.

- [ ] **Step 14.1: Dropzone component (client)**

`app/upload/UploadDropzone.tsx`. Accepts `.csv`, `.xlsx`, `.pdf`. Renders a drop area. On drop: read `File`, compute `extension`, suggest broker via simple table (`xlsx → xtb`, `csv → ibkr`, `pdf → tradeville`).

- [ ] **Step 14.2: Manual broker override**

shadcn `Select` populated with all three brokers. Pre-selects the auto-detected one. User can change it.

- [ ] **Step 14.3: Submit handler**

On "Parse" click: build `FormData` with `file` + `broker`, POST `/api/sync?dryRun=true`. Show loading state.

- [ ] **Step 14.4: Persist result in Zustand store and navigate**

On 200: `useWizard.getState().set({ file, broker, dryRun: result })`. Then `router.push('/preview')`. The `File` object is held in memory; preview consumes it for the confirm step.

- [ ] **Step 14.5: Error states**

`401` → "Re-paste credentials" link to `/setup`. Other errors → toast with the structured error message.

- [ ] **Step 14.6: Manual smoke**

Drop `sources/xtb.xlsx` → verify navigation to `/preview` with the wizard store populated (`useWizard.getState().dryRun` non-null).

**Caveat:** Zustand state is lost on hard refresh of `/preview`. If the user reloads, redirect them back to `/upload`. This is acceptable for a personal tool; alternative would be IndexedDB persistence, deferred to v2.

- [ ] **Step 14.7: Commit**

```bash
git add app/upload/ && git commit -m "feat: upload screen with parser detection and dry-run preview hand-off"
```

---

## Task 15: UI — Preview screen

**Files:** `app/preview/page.tsx`, `app/preview/PreviewTable.tsx`

- [ ] **Step 15.1: Preview page shell (client)**

`app/preview/page.tsx`. Reads `useWizard()` for `{ file, broker, dryRun }`. If `dryRun` is null (e.g. user hard-refreshed and lost in-memory state), `router.push('/upload')`.

- [ ] **Step 15.2: Preview table component**

`app/preview/PreviewTable.tsx`. Renders three sections:
1. **Will insert** — green badge, table of `(date, symbol, side, quantity, price, total)`.
2. **Needs asset** — yellow badge — list of unique `(exchange, symbol)` pairs with a "create in Wallet" link to `web.budgetbakers.com`.
3. **Unsupported / parse errors** — red badge, table of reason + raw row.

- [ ] **Step 15.3: Summary header**

Top of page: "X new, Y already in Wallet, Z unsupported". Disabled "Sync" button if `X === 0`.

- [ ] **Step 15.4: Confirm action**

On "Sync" click: read `{ file, broker }` from the wizard store, POST `/api/sync` (without `dryRun`) with the same `FormData`. Show loading state; disable the button.

- [ ] **Step 15.5: Hand off to /result**

On 200: `useWizard.getState().set({ result })`; `router.push('/result')`. The result page reads from the store same as preview.

- [ ] **Step 15.6: Commit**

```bash
git add app/preview/ && git commit -m "feat: preview screen with diff table and confirm action"
```

---

## Task 16: UI — Result + History

**Files:** `app/result/page.tsx`, `app/history/page.tsx`, `app/api/history/route.ts`

- [ ] **Step 16.1: Result page**

Reads `result` from the wizard store. Renders summary counts + per-doc table from `result.preview.new` joined with the per-doc results. Link to Wallet web UI for the synced account. If `result` is null (hard-refresh), redirect to `/upload`.

- [ ] **Step 16.2: History API**

`app/api/history/route.ts` — GET returns rows from `sync_run` (newest first) and a per-run detail endpoint.

- [ ] **Step 16.3: History page**

`app/history/page.tsx` — server-rendered table of past runs. Click expands inline to show `sync_run_doc` rows for that run.

- [ ] **Step 16.4: Wire result → "Sync another" CTA back to /upload**

- [ ] **Step 16.5: Commit**

```bash
git add app/result/ app/history/ app/api/history/ && git commit -m "feat: result and history screens"
```

---

## Task 17: Pre-commit hook for token leaks

**Files:** `.githooks/leak-scan.mjs`, `.husky/pre-commit`

- [ ] **Step 17.1: Implement leak scanner using execFileSync**

`.githooks/leak-scan.mjs`:
```js
import { execFileSync } from 'node:child_process'

const staged = execFileSync('git', ['diff', '--cached', '--no-color'], { encoding: 'utf8' })

const patterns = [
  /Authorization:\s*Basic\s+[A-Za-z0-9+/=]{20,}/i,
  /couch-prod-eu-1\.budgetbakers\.com\/bb-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}.+(?:token|auth)/i,
]

for (const p of patterns) {
  const m = p.exec(staged)
  if (m) {
    console.error(`✗ Possible secret leak in staged changes: ${m[0].slice(0, 80)}...`)
    process.exit(1)
  }
}
process.exit(0)
```

- [ ] **Step 17.2: Wire husky**

```bash
npx husky init
printf '#!/usr/bin/env sh\nnode .githooks/leak-scan.mjs\n' > .husky/pre-commit
chmod +x .husky/pre-commit
```

- [ ] **Step 17.3: Test the hook**

Try staging a file containing `Authorization: Basic AAAAAAAAAAAAAAAAAAAAAAAAAA` — verify the commit aborts. Unstage.

- [ ] **Step 17.4: Commit (the hook should pass)**

```bash
git add .githooks/ .husky/ package.json && git commit -m "chore: pre-commit hook scans staged diffs for token leaks"
```

---

## Task 18: IBKR parser (TDD)

**Files:** `src/parsers/ibkr.ts`, `src/parsers/ibkr-venues.ts`, `tests/parsers/ibkr.test.ts`, `tests/parsers/fixtures/ibkr-2026.csv`

- [ ] **Step 18.1: Redact IBKR fixture (`U***22945` → `U***00000`, etc.) and copy from `sources/ibkr.csv`**
- [ ] **Step 18.2: Failing test**

Asserts: detect, parses Buy/Sell rows, skips Forex Trade Component / Dividend / Foreign Tax Withholding / Adjustment as `unsupported`, populates `tradeCurrency`/`settlementCurrency`/`exchange`/`externalId` (content hash), folds Commission into `cashAmount`.

- [ ] **Step 18.3: Implement IBKR parser**

Multi-section CSV: read `Summary` → `Base Currency` for settlement; filter `Transaction History` data rows; only `Transaction Type ∈ {Buy, Sell}`; venue from `ibkr-venues.ts` symbol→MIC table; `externalId = canonicalContentHash({ ...fields, pricePrecision: 4, quantityPrecision: 6 })`; `tradeCurrency = Price Currency`; `settlementCurrency = base`; `cashAmount = Net Amount` (in base, signed). IBKR Statement CSV uses `.` as decimal and `,` as field separator with quoted strings — standard CSV. Numbers may appear in scientific notation (`5.0E-4`); `Number()`/`parseFloat()` handle this. Skip `Forex Trade Component`, `Dividend`, `Foreign Tax Withholding`, `Adjustment` to `unsupported`.

- [ ] **Step 18.4: Register in `parsers/registry.ts`**
- [ ] **Step 18.5: Dry-run against `sources/ibkr.csv`**
- [ ] **Step 18.6: Commit**

---

## Task 19: Tradeville PDF layout discovery (Phase 0 capture #10)

**Files:** `scripts/pdf-dump.ts`, `src/parsers/tradeville-layout.ts`

- [ ] **Step 19.1: Implement pdf-dump script**

`scripts/pdf-dump.ts`:
```ts
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

async function main() {
  const path = process.argv[2]
  const buf = readFileSync(path)
  const pdf = await getDocument({ data: new Uint8Array(buf) }).promise
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    for (const item of content.items as any[]) {
      const [, , , , x, y] = item.transform
      console.log(JSON.stringify({ page: p, x: Math.round(x), y: Math.round(y), text: item.str }))
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 19.2: Run on real Tradeville PDF, write output to `docs/superpowers/captures/tradeville-text-dump.jsonl` (gitignored)**

```bash
npx tsx scripts/pdf-dump.ts sources/tradeville.pdf > docs/superpowers/captures/tradeville-text-dump.jsonl
```

- [ ] **Step 19.3: Identify column x-positions, header y-positions, anchor strings (e.g. "Simbol", "Cantitate", "Pret"); write `src/parsers/tradeville-layout.ts`**

```ts
// src/parsers/tradeville-layout.ts
export type Anchor = { text: string; page: number; x: number; y: number; xTol: number; yTol: number }
export const ANCHORS: Anchor[] = [
  // populate from text-dump inspection
]
export const COLUMNS = {
  // x-positions for symbol/qty/price/total etc.
}
```

- [ ] **Step 19.4: Commit at least one ANCHOR before Task 20 starts**

Task 20's tripwire test asserts on `ANCHORS`. The file must contain at least one valid anchor before the test can be written.

```bash
git add src/parsers/tradeville-layout.ts && git commit -m "feat: tradeville PDF layout constants from phase-0 capture"
```

---

## Task 20: Tradeville parser (TDD)

**Files:** `src/parsers/tradeville.ts`, `tests/parsers/tradeville.test.ts`, `tests/parsers/fixtures/tradeville-2026.pdf`

- [ ] **Step 20.1: Build a synthetic PDF fixture** with `pdf-lib` matching the layout but anonymized rows; document procedure in `tests/parsers/fixtures/tradeville-2026.pdf.README.md`.

- [ ] **Step 20.2: Failing test**

Asserts: detect, parse buys/sells, **layout-tripwire** triggers when an anchor is missing/displaced (test by mutating a fixture).

- [ ] **Step 20.3: Implement Tradeville parser**

Open PDF with `pdfjs-dist`, collect text items per page; assert `ANCHORS` are at expected `(x±tol, y±tol)` — fail with `"Tradeville layout drift — re-run capture #10"` otherwise; cluster items into rows (by y), columns (by x); extract trade rows; `externalId` from content hash; if PDF has no text layer (image-only), fail with `"image-only PDF, OCR not supported"`.

- [ ] **Step 20.4: Register in `parsers/registry.ts`**
- [ ] **Step 20.5: Dry-run against `sources/tradeville.pdf`**
- [ ] **Step 20.6: Commit**

---

## Task 21: End-to-end smoke test (against pouchdb-server)

**Files:** `tests/e2e-smoke.test.ts`; dev dep `pouchdb-server`

- [ ] **Step 21.1: Add `pouchdb-server` as a dev dep; spin up in test setup, tear down in teardown**
- [ ] **Step 21.2: Seed a few `Account`, `Currency`, `StocksFundsAsset` docs**
- [ ] **Step 21.3: Run `parsers.xtb.parse(fixture) → runSync(...)` and assert docs land in pouchdb-server**
- [ ] **Step 21.4: Re-run, assert zero new inserts (idempotency)**
- [ ] **Step 21.5: Commit**

---

## Definition of done

- All tests pass (`npx vitest run`).
- `npm run build` passes; `npm run lint` is clean.
- Phase-0 capture #12 succeeded against the real Wallet CouchDB; spec is updated noting which `_id` shape is in use.
- One end-to-end run with the real `sources/xtb.xlsx` in the browser: drag-and-drop, preview shows correct counts, confirm, trades appear in Wallet's Portfolio tab. (Manual verification.)
- Pre-commit hook actively blocks staged commits containing token-shaped strings.
- README explains: setup, daily use, what to do if BudgetBakers schema changes (re-run phase 0; bump `syncToolVersion`), where the audit DB lives.
