import { v5 as uuidv5 } from 'uuid'
import type { CanonicalTxn } from '@/src/types'
import { NAMESPACE_WALLET_SYNC } from './namespace'

export type RecordDoc = {
  _id: string
  reservedModelType: 'Record'
  reservedOwnerId: string
  reservedAuthorId: string
  reservedSource: 'wallet-broker-sync'
  reservedCreatedAt: string
  reservedUpdatedAt: string

  accountId: string
  categoryId: string
  currencyId: string

  type: 0 | 1               // 0=income, 1=expense
  paymentType: number       // we use 3 (transfer-like) consistently
  amount: number            // integer × 100, ALWAYS POSITIVE
  decimalAmount: string     // string of amount/100
  recordDate: string
  recordState: 1

  note: string
  payer?: string
  payee?: string

  photos: []

  // Custom round-trip fields (CouchDB schemaless)
  externalSource: string
  externalId: string
  syncedAt: string
  syncToolVersion: string
}

export type RecordMapperContext = {
  accountId: string
  categoryId: string
  currencyId: string
  ownerId: string
  now: string
  toolVersion: string
}

export function deterministicRecordId(broker: string, externalId: string): string {
  // Note: Record IDs use 'Record_<uuid>' (NO leading dash, per Wallet's convention).
  return `Record_${uuidv5(`record:${broker}:${externalId}`, NAMESPACE_WALLET_SYNC)}`
}

/**
 * Builds a Record doc from a buy/sell CanonicalTxn that has no asset support.
 * type=1 (expense) for buys, type=0 (income) for sells.
 * amount = abs(quantity * pricePerShare) — gross trade value, in tradeCurrency.
 * note format: "Buy 100 TLV @ 26.50 RON" or "Sell 50 TLV @ 27.10 RON".
 *   Appends observatii in parens if available.
 *
 * NOTE: The ctx.currencyId must correspond to the tradeCurrency (not settlementCurrency)
 * since the amount is expressed in the trade's price currency.
 */
export function toRecordDocFromTrade(txn: CanonicalTxn, ctx: RecordMapperContext): RecordDoc {
  if (txn.kind !== 'buy' && txn.kind !== 'sell') {
    throw new Error(`toRecordDocFromTrade: unexpected kind "${txn.kind}"; expected 'buy' or 'sell'`)
  }
  if (txn.quantity === undefined || txn.pricePerShare === undefined) {
    throw new Error(`toRecordDocFromTrade: quantity and pricePerShare are required`)
  }
  const isExpense = txn.kind === 'buy'
  const amountAbs = Math.abs(txn.quantity * txn.pricePerShare)
  const amountInt = Number((amountAbs * 100).toFixed(0))
  const sideLabel = txn.kind === 'buy' ? 'Buy' : 'Sell'
  const obs = (txn.raw['observatii'] as string | undefined) || (txn.raw['Observatii'] as string | undefined) || ''
  const note = `${sideLabel} ${txn.quantity} ${txn.symbol ?? ''} @ ${txn.pricePerShare} ${txn.tradeCurrency ?? ''}${obs ? ' (' + obs + ')' : ''}`

  return {
    _id: deterministicRecordId(txn.broker, txn.externalId),
    reservedModelType: 'Record',
    reservedOwnerId: ctx.ownerId,
    reservedAuthorId: ctx.ownerId,
    reservedSource: 'wallet-broker-sync',
    reservedCreatedAt: ctx.now,
    reservedUpdatedAt: ctx.now,
    accountId: ctx.accountId,
    categoryId: ctx.categoryId,
    currencyId: ctx.currencyId,
    type: isExpense ? 1 : 0,
    paymentType: 3,
    amount: amountInt,
    decimalAmount: (amountInt / 100).toFixed(2),
    recordDate: txn.date,
    recordState: 1,
    note,
    ...(isExpense ? { payee: txn.broker.toUpperCase() } : { payer: txn.broker.toUpperCase() }),
    photos: [],
    externalSource: txn.broker,
    externalId: txn.externalId,
    syncedAt: ctx.now,
    syncToolVersion: ctx.toolVersion,
  }
}

export function toRecordDoc(txn: CanonicalTxn, ctx: RecordMapperContext): RecordDoc {
  if (txn.kind !== 'dividend' && txn.kind !== 'fee') {
    throw new Error(`toRecordDoc: unexpected kind "${txn.kind}"; expected 'dividend' or 'fee'`)
  }
  const amountAbs = Math.abs(txn.cashAmount)
  const amountInt = Number((amountAbs * 100).toFixed(0))

  // Direction: dividend always income (cash IN). 'fee' kind always expense (cash OUT).
  // (We don't trust the sign of cashAmount for direction since Wallet's data model uses
  // type to determine direction, not signed amount.)
  const type: 0 | 1 = txn.kind === 'dividend' ? 0 : 1

  return {
    _id: deterministicRecordId(txn.broker, txn.externalId),
    reservedModelType: 'Record',
    reservedOwnerId: ctx.ownerId,
    reservedAuthorId: ctx.ownerId,
    reservedSource: 'wallet-broker-sync',
    reservedCreatedAt: ctx.now,
    reservedUpdatedAt: ctx.now,
    accountId: ctx.accountId,
    categoryId: ctx.categoryId,
    currencyId: ctx.currencyId,
    type,
    paymentType: 3,
    amount: amountInt,
    decimalAmount: (amountInt / 100).toFixed(2),
    recordDate: txn.date,
    recordState: 1,
    note: txn.description,
    ...(type === 0 ? { payer: txn.broker.toUpperCase() } : { payee: txn.broker.toUpperCase() }),
    photos: [],
    externalSource: txn.broker,
    externalId: txn.externalId,
    syncedAt: ctx.now,
    syncToolVersion: ctx.toolVersion,
  }
}
