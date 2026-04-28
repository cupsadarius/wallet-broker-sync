/* eslint-disable @typescript-eslint/no-explicit-any */
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
