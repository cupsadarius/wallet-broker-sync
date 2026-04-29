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

  it('commitSync writes prepared docs and aggregates per-doc results', async () => {
    const { prepareSync, commitSync } = await import('@/src/sync/engine')
    const couch: any = {
      listAssetTransactions: vi.fn(async () => []),
      bulkDocs: vi.fn(async (docs: any[]) => [
        { id: docs[0]._id, status: 'inserted', rev: '1-x' },
        { id: docs[1]._id, status: 'conflict' },
      ]),
    }
    const lookup: any = { assetByVenueSymbol: vi.fn(() => '-StocksFundsAsset_y') }
    const prepared = await prepareSync({
      broker: 'xtb',
      txns: [baseTxn, { ...baseTxn, externalId: '2' }],
      unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    expect(prepared.toInsert).toHaveLength(2)
    const r = await commitSync(prepared, couch)
    expect(r.inserted).toBe(1)
    expect(r.conflict).toBe(1)
    expect(r.errors).toHaveLength(0)
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

  it('exposes nearMatches for inserts that share day+asset+side with an existing doc', async () => {
    const existingDoc = {
      _id: '-AssetTransaction_aggregate-1',
      reservedModelType: 'AssetTransaction',
      accountId: '-Account_a',
      assetId: '-StocksFundsAsset_y',
      transactionType: 0,
      date: '2026-04-28T15:30:00.000Z',
      quantity: 4.04,        // aggregate of the user's two CSV rows
      price: 11804,
    }
    const couch: any = {
      listAssetTransactions: vi.fn(async () => [existingDoc]),
      bulkDocs: vi.fn(async () => []),
    }
    const lookup: any = { assetByVenueSymbol: vi.fn(() => '-StocksFundsAsset_y') }

    const splitRow1 = { ...baseTxn, externalId: 'a', quantity: 0.04 }
    const splitRow2 = { ...baseTxn, externalId: 'b', quantity: 4 }
    const r = await runSync({
      broker: 'xtb', txns: [splitRow1, splitRow2], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })

    // Both rows are different qty from the existing 4.04 — won't strict-match
    expect(r.preview.new.length).toBe(2)
    // But both should have a near-match candidate pointing at the aggregate doc
    for (const p of r.preview.new) {
      const candidates = r.preview.nearMatches[p.doc._id]
      expect(candidates).toBeTruthy()
      expect(candidates.length).toBe(1)
      expect(candidates[0].docId).toBe('-AssetTransaction_aggregate-1')
      expect(candidates[0].quantity).toBe(4.04)
    }
  })

  it('content-matches manually-entered existing docs (different _id, same trade)', async () => {
    // A manually-entered entry with a random _id but the same trade content as baseTxn.
    // baseTxn: kind=buy → transactionType=0, date day='2026-04-28', qty=1,
    //          pricePerShare=118.04 → price=11804
    // The time-of-day differs to verify day-only matching works.
    const existingManual = {
      _id: '-AssetTransaction_manual-uuid-1',
      reservedModelType: 'AssetTransaction',
      accountId: '-Account_a',
      assetId: '-StocksFundsAsset_y',
      transactionType: 0,
      date: '2026-04-28T15:30:00.000Z',
      quantity: 1,
      price: 11804,
    }
    const couch: any = {
      listAssetTransactions: vi.fn(async () => [existingManual]),
      bulkDocs: vi.fn(async () => []),
    }
    const lookup: any = { assetByVenueSymbol: vi.fn(() => '-StocksFundsAsset_y') }
    const r = await runSync({
      broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    expect(r.inserted).toBe(0)
    expect(r.preview.alreadyPresent).toEqual(['-AssetTransaction_manual-uuid-1'])
    expect(couch.bulkDocs).not.toHaveBeenCalled()
  })
})
