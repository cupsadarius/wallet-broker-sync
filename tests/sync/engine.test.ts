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
