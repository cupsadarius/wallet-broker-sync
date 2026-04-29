/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import { runSync } from '@/src/sync/engine'

/** Minimal couch mock that satisfies the new SyncInput interface. */
function makeCouchMock(overrides: Partial<{
  listAssetTransactions: () => Promise<any[]>
  listRecords: () => Promise<any[]>
  bulkDocs: (docs: any[]) => Promise<any[]>
}> = {}) {
  return {
    listAssetTransactions: vi.fn(async () => []),
    listRecords: vi.fn(async () => []),
    bulkDocs: vi.fn(async (docs: any[]) => docs.map((d: any) => ({ id: d._id, status: 'inserted', rev: '1-x' }))),
    ...overrides,
  } as any
}

/** Minimal lookup mock that satisfies the new SyncInput interface. */
function makeLookupMock(overrides: Partial<{
  assetByVenueSymbol: (mic: string, sym: string, ccy?: string, broker?: string) => string | null
  assetById: (id: string) => any
  categoryByName: (name: string) => string | null
  currencyByCode: (code: string) => string | null
}> = {}) {
  return {
    assetByVenueSymbol: vi.fn(() => '-StocksFundsAsset_y'),
    assetById: vi.fn(() => null),
    categoryByName: vi.fn(() => '-Category_income'),
    currencyByCode: vi.fn(() => '-Currency_eur'),
    ...overrides,
  } as any
}

describe('runSync', () => {
  const baseTxn = { externalId: '1', broker: 'xtb', kind: 'buy', date: '2026-04-28T10:00:00.000Z',
    symbol: 'VUAA', exchange: 'XETR', quantity: 1, pricePerShare: 118.04,
    tradeCurrency: 'EUR', settlementCurrency: 'EUR', cashAmount: -118.05, description: '', raw: {} } as const

  const baseDividend = { externalId: 'div-1', broker: 'ibkr', kind: 'dividend', date: '2026-04-01T00:00:00.000Z',
    symbol: 'NVDA', settlementCurrency: 'EUR', tradeCurrency: 'USD',
    cashAmount: 0.08628, description: 'NVDA Cash Dividend', raw: {} } as const

  const baseFee = { externalId: 'fee-1', broker: 'ibkr', kind: 'fee', feeKind: 'withholding',
    date: '2026-04-01T00:00:00.000Z', symbol: 'NVDA', settlementCurrency: 'EUR',
    cashAmount: -0.008628, description: 'NVDA Withholding', raw: {} } as const

  it('inserts all-new docs', async () => {
    const couch = makeCouchMock()
    const lookup = makeLookupMock()
    const r = await runSync({
      broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    expect(r.inserted).toBe(1); expect(r.conflict).toBe(0); expect(r.needsAsset).toHaveLength(0)
  })

  it('reports conflicts from bulkDocs when server rejects writes', async () => {
    const couch = makeCouchMock({
      bulkDocs: vi.fn(async (docs: any[]) => docs.map((d: any) => ({ id: d._id, status: 'conflict' }))),
    })
    const lookup = makeLookupMock()
    const r = await runSync({ broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup })
    expect(r.inserted).toBe(0); expect(r.conflict).toBe(1)
  })

  it('commitSync writes prepared docs and aggregates per-doc results', async () => {
    const { prepareSync, commitSync } = await import('@/src/sync/engine')
    let callCount = 0
    const couch = makeCouchMock({
      bulkDocs: vi.fn(async (docs: any[]) => {
        callCount++
        if (callCount === 1) {
          return [
            { id: docs[0]._id, status: 'inserted', rev: '1-x' },
            { id: docs[1]._id, status: 'conflict' },
          ]
        }
        return []
      }),
    })
    const lookup = makeLookupMock()
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
    const couch = makeCouchMock({
      listAssetTransactions: vi.fn(async () => [{ _id: expectedId }]),
      bulkDocs,
    })
    const lookup = makeLookupMock()
    const r = await runSync({ broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup })
    expect(r.inserted).toBe(0)
    expect(r.conflict).toBe(0)
    expect(r.preview.alreadyPresent).toEqual([expectedId])
    expect(bulkDocs).not.toHaveBeenCalled()
  })

  it('routes missing-asset rows to needsAsset', async () => {
    const couch = makeCouchMock({ bulkDocs: vi.fn(async () => []) })
    const lookup = makeLookupMock({ assetByVenueSymbol: vi.fn(() => null) })
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
    const couch = makeCouchMock({
      listAssetTransactions: vi.fn(async () => [existingDoc]),
      bulkDocs: vi.fn(async () => []),
    })
    const lookup = makeLookupMock({
      assetById: vi.fn((id: string) => {
        if (id === '-StocksFundsAsset_y') return { symbol: 'VUAA', exchangeCode: 'XETR', currencyCode: 'EUR' }
        return null
      }),
    })

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
      // Enriched fields
      expect(candidates[0].assetId).toBe('-StocksFundsAsset_y')
      expect(candidates[0].transactionType).toBe(0)
      expect(candidates[0].symbol).toBe('VUAA')
      expect(candidates[0].exchange).toBe('XETR')
    }
  })

  it('returns unmatchedExisting as all-account existing docs sorted by date desc, excluding strict-matches', async () => {
    const existingDocs = [
      {
        _id: '-AssetTransaction_strict-match',  // will strict-match with baseTxn
        reservedModelType: 'AssetTransaction',
        accountId: '-Account_a',
        assetId: '-StocksFundsAsset_y',
        transactionType: 0,
        date: '2026-04-28T15:30:00.000Z',
        quantity: 1,
        price: 11804,  // matches baseTxn after × 100
      },
      {
        _id: '-AssetTransaction_unrelated-1',
        reservedModelType: 'AssetTransaction',
        accountId: '-Account_a',
        assetId: '-StocksFundsAsset_other',
        transactionType: 1,
        date: '2024-06-01T12:00:00.000Z',
        quantity: 5,
        price: 5000,
      },
      {
        _id: '-AssetTransaction_unrelated-2',
        reservedModelType: 'AssetTransaction',
        accountId: '-Account_a',
        assetId: '-StocksFundsAsset_other',
        transactionType: 0,
        date: '2025-01-15T10:00:00.000Z',
        quantity: 2,
        price: 8000,
      },
    ]
    const couch = makeCouchMock({
      listAssetTransactions: vi.fn(async () => existingDocs),
      bulkDocs: vi.fn(async () => []),
    })
    const lookup = makeLookupMock({
      assetById: vi.fn((id: string) => {
        if (id === '-StocksFundsAsset_y') return { symbol: 'VUAA', exchangeCode: 'XETR', currencyCode: 'EUR' }
        if (id === '-StocksFundsAsset_other') return { symbol: 'AMD', exchangeCode: 'XNGS', currencyCode: 'USD' }
        return null
      }),
    })
    const r = await runSync({
      broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    // baseTxn strict-matches existingDocs[0], so 0 inserted
    expect(r.inserted).toBe(0)
    // unmatchedExisting should be 2 (the strict-match is excluded), sorted by date desc
    expect(r.preview.unmatchedExisting.length).toBe(2)
    expect(r.preview.unmatchedExisting[0].docId).toBe('-AssetTransaction_unrelated-2')   // 2025-01-15
    expect(r.preview.unmatchedExisting[1].docId).toBe('-AssetTransaction_unrelated-1')   // 2024-06-01
    // Symbols and exchanges should be enriched
    expect(r.preview.unmatchedExisting[0].symbol).toBe('AMD')
    expect(r.preview.unmatchedExisting[0].exchange).toBe('XNGS')
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
    const couch = makeCouchMock({
      listAssetTransactions: vi.fn(async () => [existingManual]),
      bulkDocs: vi.fn(async () => []),
    })
    const lookup = makeLookupMock()
    const r = await runSync({
      broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    expect(r.inserted).toBe(0)
    expect(r.preview.alreadyPresent).toEqual(['-AssetTransaction_manual-uuid-1'])
    expect(couch.bulkDocs).not.toHaveBeenCalled()
  })

  it('dispatches dividend txns to Record path (not AssetTransaction path)', async () => {
    const couch = makeCouchMock()
    const lookup = makeLookupMock()
    const r = await runSync({
      broker: 'ibkr', txns: [baseDividend], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    // No AssetTransaction inserted
    expect(r.inserted).toBe(0)
    // But one Record inserted
    expect(r.recordsInserted).toBe(1)
    expect(r.preview.newRecords).toHaveLength(1)
    const doc = r.preview.newRecords[0].doc
    expect(doc._id).toMatch(/^Record_/)
    expect(doc.type).toBe(0)  // income
  })

  it('dispatches fee txns to Record path with type=1 (expense)', async () => {
    const couch = makeCouchMock()
    const lookup = makeLookupMock()
    const r = await runSync({
      broker: 'ibkr', txns: [baseFee], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    expect(r.inserted).toBe(0)
    expect(r.recordsInserted).toBe(1)
    const doc = r.preview.newRecords[0].doc
    expect(doc.type).toBe(1)  // expense
  })

  it('handles mixed buy + dividend + fee txns — writes both AssetTransactions and Records', async () => {
    const couch = makeCouchMock()
    const lookup = makeLookupMock()
    const r = await runSync({
      broker: 'ibkr', txns: [baseTxn, baseDividend, baseFee], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    expect(r.inserted).toBe(1)       // the buy
    expect(r.recordsInserted).toBe(2) // dividend + fee
    expect(r.preview.new).toHaveLength(1)
    expect(r.preview.newRecords).toHaveLength(2)
  })

  it('dedups existing Record docs by _id (skips already-present records)', async () => {
    const { deterministicRecordId } = await import('@/src/sync/record-mapper')
    const existingRecordId = deterministicRecordId(baseDividend.broker, baseDividend.externalId)
    const couch = makeCouchMock({
      listRecords: vi.fn(async () => [{ _id: existingRecordId }]),
    })
    const lookup = makeLookupMock()
    const r = await runSync({
      broker: 'ibkr', txns: [baseDividend], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    expect(r.recordsInserted).toBe(0)
    expect(r.preview.alreadyPresentRecords).toEqual([existingRecordId])
  })

  it('skips dividend/fee when category is not found', async () => {
    const couch = makeCouchMock()
    const lookup = makeLookupMock({ categoryByName: vi.fn(() => null) })
    const r = await runSync({
      broker: 'ibkr', txns: [baseDividend], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    expect(r.recordsInserted).toBe(0)
    expect(r.preview.newRecords).toHaveLength(0)
  })

  it('skips dividend/fee when currency is not found', async () => {
    const couch = makeCouchMock()
    const lookup = makeLookupMock({ currencyByCode: vi.fn(() => null) })
    const r = await runSync({
      broker: 'ibkr', txns: [baseDividend], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    expect(r.recordsInserted).toBe(0)
    expect(r.preview.newRecords).toHaveLength(0)
  })

  it('routes to Record when (broker, exchange, symbol) is in recordFallback', async () => {
    const couch = makeCouchMock({ bulkDocs: vi.fn(async (docs: any[]) => docs.map((d: any) => ({ id: d._id, status: 'inserted', rev: '1-x' }))) })
    const lookup = makeLookupMock({ assetByVenueSymbol: vi.fn(() => null) })
    const r = await runSync({
      broker: 'tradeville',
      txns: [{ ...baseTxn, broker: 'tradeville', symbol: 'TLV', exchange: 'XBSE' }],
      unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0',
      couch, lookup,
      recordFallback: new Set(['tradeville:XBSE:TLV']),
      manualLink: new Map(),
    })
    expect(r.preview.new).toHaveLength(0)          // no AssetTransaction
    expect(r.preview.newRecords).toHaveLength(1)   // built a Record instead
    expect(r.preview.newRecords[0].doc.type).toBe(1)  // buy → expense
    expect(r.preview.newRecords[0].doc.note).toMatch(/Buy.*TLV/)
    expect(r.needsAsset).toHaveLength(0)
  })

  it('routes to Record (income) for sell when (broker, exchange, symbol) is in recordFallback', async () => {
    const couch = makeCouchMock({ bulkDocs: vi.fn(async (docs: any[]) => docs.map((d: any) => ({ id: d._id, status: 'inserted', rev: '1-x' }))) })
    const lookup = makeLookupMock({ assetByVenueSymbol: vi.fn(() => null) })
    const r = await runSync({
      broker: 'tradeville',
      txns: [{ ...baseTxn, broker: 'tradeville', symbol: 'TLV', exchange: 'XBSE', kind: 'sell' as const, cashAmount: 118.05 }],
      unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0',
      couch, lookup,
      recordFallback: new Set(['tradeville:XBSE:TLV']),
      manualLink: new Map(),
    })
    expect(r.preview.newRecords).toHaveLength(1)
    expect(r.preview.newRecords[0].doc.type).toBe(0)  // sell → income
    expect(r.preview.newRecords[0].doc.note).toMatch(/Sell.*TLV/)
  })

  it('routes to alreadyPresent when (broker, externalId) is in manualLink', async () => {
    const couch = makeCouchMock({ bulkDocs: vi.fn(async () => []) })
    const lookup = makeLookupMock()
    const r = await runSync({
      broker: 'xtb',
      txns: [{ ...baseTxn, externalId: 'IBKR-XYZ' }],
      unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0',
      couch, lookup,
      manualLink: new Map([['xtb:IBKR-XYZ', ['-AssetTransaction_existing-1']]]),
      recordFallback: new Set(),
    })
    expect(r.inserted).toBe(0)
    expect(r.preview.alreadyPresent).toContain('-AssetTransaction_existing-1')
    expect(r.preview.new).toHaveLength(0)
  })

  it('defensive filter: string transactionType from CouchDB does not appear in nearMatches for a buy', async () => {
    // Simulate a CouchDB doc whose transactionType was serialized as a string '1' (SELL)
    // instead of the number 1. It shares the same assetId and date-day as baseTxn (a BUY),
    // but should NOT appear as a near-match candidate because Number('1') !== 0 (buy).
    const existingStringTyped = {
      _id: '-AssetTransaction_string-type-1',
      reservedModelType: 'AssetTransaction',
      accountId: '-Account_a',
      assetId: '-StocksFundsAsset_y',
      transactionType: '1',  // string — the serialization quirk we're guarding against
      date: '2026-04-28T09:00:00.000Z',
      quantity: 1,
      price: 11804,
    }
    const couch = makeCouchMock({
      listAssetTransactions: vi.fn(async () => [existingStringTyped]),
      bulkDocs: vi.fn(async () => []),
    })
    const lookup = makeLookupMock()
    const r = await runSync({
      broker: 'xtb', txns: [baseTxn], unsupported: [],
      accountId: '-Account_a', ownerId: 'u', toolVersion: '1.0.0', couch, lookup,
    })
    // baseTxn is a BUY (transactionType 0); the string-typed doc is SELL ('1')
    // It should NOT appear in nearMatches for baseTxn
    expect(r.preview.new).toHaveLength(1)
    const candidates = r.preview.nearMatches[r.preview.new[0].doc._id]
    expect(candidates ?? []).toHaveLength(0)
  })
})
