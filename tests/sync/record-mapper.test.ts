import { describe, it, expect } from 'vitest'
import { toRecordDoc, deterministicRecordId } from '@/src/sync/record-mapper'
import type { CanonicalTxn } from '@/src/types'

const baseDividend: CanonicalTxn = {
  externalId: 'abc123',
  broker: 'ibkr',
  kind: 'dividend',
  date: '2026-04-01T00:00:00.000Z',
  symbol: 'NVDA',
  settlementCurrency: 'EUR',
  tradeCurrency: 'USD',
  cashAmount: 0.08628,
  description: 'NVDA(US67066G1040) Cash Dividend USD 0.01 per Share (Ordinary Dividend)',
  raw: {},
}

const baseFee: CanonicalTxn = {
  externalId: 'def456',
  broker: 'ibkr',
  kind: 'fee',
  feeKind: 'withholding',
  date: '2026-04-01T00:00:00.000Z',
  symbol: 'NVDA',
  settlementCurrency: 'EUR',
  cashAmount: -0.008628,
  description: 'NVDA(US67066G1040) Cash Dividend USD 0.01 per Share - US Tax',
  raw: {},
}

const ctx = {
  accountId: '-Account_test',
  categoryId: '-Category_income',
  currencyId: '-Currency_eur',
  ownerId: 'user-uuid',
  now: '2026-04-28T10:00:00.000Z',
  toolVersion: '1.0.0',
}

describe('deterministicRecordId', () => {
  it('produces a Record_<uuid> id (no leading dash)', () => {
    const id = deterministicRecordId('ibkr', 'abc123')
    expect(id).toMatch(/^Record_[0-9a-f-]{36}$/)
    expect(id.startsWith('-')).toBe(false)
  })

  it('is stable across calls', () => {
    expect(deterministicRecordId('ibkr', 'abc123')).toBe(deterministicRecordId('ibkr', 'abc123'))
  })

  it('differs for different brokers or externalIds', () => {
    const a = deterministicRecordId('ibkr', 'abc123')
    const b = deterministicRecordId('xtb', 'abc123')
    const c = deterministicRecordId('ibkr', 'xyz999')
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('toRecordDoc — dividend', () => {
  it('produces type=0 (income) for dividend', () => {
    const doc = toRecordDoc(baseDividend, ctx)
    expect(doc.type).toBe(0)
  })

  it('sets payer to broker name uppercased', () => {
    const doc = toRecordDoc(baseDividend, ctx)
    expect(doc.payer).toBe('IBKR')
    expect(doc.payee).toBeUndefined()
  })

  it('amount is absolute value × 100 rounded to integer', () => {
    const doc = toRecordDoc(baseDividend, ctx)
    expect(doc.amount).toBe(9)  // 0.08628 * 100 = 8.628 → rounded to 9
    expect(doc.amount).toBeGreaterThan(0)
  })

  it('decimalAmount is (amount / 100).toFixed(2)', () => {
    const doc = toRecordDoc(baseDividend, ctx)
    expect(doc.decimalAmount).toBe((doc.amount / 100).toFixed(2))
  })

  it('has correct structural fields', () => {
    const doc = toRecordDoc(baseDividend, ctx)
    expect(doc._id).toMatch(/^Record_/)
    expect(doc.reservedModelType).toBe('Record')
    expect(doc.reservedSource).toBe('wallet-broker-sync')
    expect(doc.accountId).toBe(ctx.accountId)
    expect(doc.categoryId).toBe(ctx.categoryId)
    expect(doc.currencyId).toBe(ctx.currencyId)
    expect(doc.recordState).toBe(1)
    expect(doc.paymentType).toBe(3)
    expect(doc.photos).toEqual([])
    expect(doc.note).toBe(baseDividend.description)
    expect(doc.externalSource).toBe('ibkr')
    expect(doc.externalId).toBe('abc123')
  })
})

describe('toRecordDoc — fee', () => {
  it('produces type=1 (expense) for fee', () => {
    const doc = toRecordDoc(baseFee, ctx)
    expect(doc.type).toBe(1)
  })

  it('sets payee to broker name uppercased', () => {
    const doc = toRecordDoc(baseFee, ctx)
    expect(doc.payee).toBe('IBKR')
    expect(doc.payer).toBeUndefined()
  })

  it('amount is absolute value × 100 even when cashAmount is negative', () => {
    const doc = toRecordDoc(baseFee, ctx)
    // cashAmount = -0.008628, abs * 100 = 0.8628 → 1
    expect(doc.amount).toBeGreaterThan(0)
  })

  it('throws for unexpected kind', () => {
    const txn: CanonicalTxn = { ...baseDividend, kind: 'buy' }
    expect(() => toRecordDoc(txn, ctx)).toThrow(/unexpected kind/)
  })
})

describe('toRecordDoc — round-trip determinism', () => {
  it('same inputs produce identical _id', () => {
    const a = toRecordDoc(baseDividend, ctx)
    const b = toRecordDoc(baseDividend, ctx)
    expect(a._id).toBe(b._id)
  })

  it('different externalIds produce different _ids', () => {
    const a = toRecordDoc(baseDividend, ctx)
    const b = toRecordDoc({ ...baseDividend, externalId: 'different' }, ctx)
    expect(a._id).not.toBe(b._id)
  })
})
