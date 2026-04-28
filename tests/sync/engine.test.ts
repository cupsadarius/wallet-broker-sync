/* eslint-disable @typescript-eslint/no-explicit-any */
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

  it('reports conflicts from bulkDocs when server rejects writes', async () => {
    const couch: any = {
      listAssetTransactions: vi.fn(async () => []),
      bulkDocs: vi.fn(async (docs: any[]) => docs.map(d => ({ id: d._id, status: 'conflict' }))),
    }
    const lookup: any = { assetByVenueSymbol: vi.fn(() => '-StocksFundsAsset_y') }
    const r = await runSync({ broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup })
    expect(r.inserted).toBe(0); expect(r.conflict).toBe(1)
  })

  it('preflight-dedups txns whose deterministic _id already exists in CouchDB (no bulkDocs call)', async () => {
    const bulkDocs = vi.fn(async () => [])
    // Compute the deterministic _id this txn will get, and pre-seed it as existing.
    const { deterministicId } = await import('@/src/sync/ids')
    const expectedId = deterministicId(baseTxn.broker, baseTxn.externalId)
    const couch: any = {
      listAssetTransactions: vi.fn(async () => [{ _id: expectedId }]),
      bulkDocs,
    }
    const lookup: any = { assetByVenueSymbol: vi.fn(() => '-StocksFundsAsset_y') }
    const r = await runSync({ broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup })
    expect(r.inserted).toBe(0)
    expect(r.conflict).toBe(0)
    expect(r.preview.alreadyPresent).toEqual([expectedId])
    expect(bulkDocs).not.toHaveBeenCalled()
  })

  it('routes missing-asset rows to needsAsset', async () => {
    const couch: any = { listAssetTransactions: vi.fn(async () => []), bulkDocs: vi.fn(async () => []) }
    const lookup: any = { assetByVenueSymbol: vi.fn(() => null) }
    const r = await runSync({ broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup })
    expect(r.inserted).toBe(0); expect(r.needsAsset).toHaveLength(1)
  })
})
