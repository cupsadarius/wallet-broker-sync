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
    // Math.round can be off-by-one on exact half-cents due to FP (e.g.
    // 25.535 * 100 = 2553.4999... rounds down to 2553). Real broker prices
    // rarely sit on those boundaries; revisit if a parser starts feeding them.
    price: Math.round(txn.pricePerShare * 100),
    // Wallet's data model: cashAmount is the absolute amount of the trade
    // (gross + fee) in cents. The transactionType field (0=buy, 1=sell)
    // determines whether Wallet adds or subtracts from the cash balance.
    // Verified empirically: a captured live BUY had cashAmount: 11804.4998
    // (positive) for a -€118.045 outflow.
    // toFixed(4) cleans FP drift like 2.18*100 = 217.99999999999997.
    cashAmount: Number((Math.abs(txn.cashAmount) * 100).toFixed(4)),
    priceCurrencyCode: txn.tradeCurrency,
    cashAmountCurrencyCode: txn.settlementCurrency,
    externalSource: txn.broker,
    externalId: txn.externalId,
    syncedAt: ctx.now,
    syncToolVersion: ctx.toolVersion,
  }
}
