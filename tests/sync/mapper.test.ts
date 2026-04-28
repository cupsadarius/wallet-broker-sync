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
    expect(doc.cashAmount).toBe(11805)         // absolute value (Wallet's convention; direction comes from transactionType)
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
    expect(doc.cashAmount).toBe(218)           // absolute value
  })
  it('rounds price to nearest integer × 100', () => {
    expect(toAssetTransactionDoc({ ...baseTxn, pricePerShare: 25.525 }, ctx).price).toBe(2553)
  })
})
