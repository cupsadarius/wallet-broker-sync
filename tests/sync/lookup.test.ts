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

  it('falls back to symbol-only when (MIC, symbol) misses', async () => {
    const svc = new LookupService(couchOf([
      { _id: '-StocksFundsAsset_x', reservedModelType: 'StocksFundsAsset', symbol: 'NVDA', exchangeCode: 'XNAS', currencyCode: 'USD' },
    ]))
    await svc.refresh()
    expect(svc.assetByVenueSymbol('XNGS', 'NVDA')).toBe('-StocksFundsAsset_x')        // fallback to bare symbol
    expect(svc.assetByVenueSymbol('XNGS', 'NVDA', 'USD')).toBe('-StocksFundsAsset_x') // same with currency hint
  })

  it('disambiguates by currency when multiple bare-symbol matches', async () => {
    const svc = new LookupService(couchOf([
      { _id: '-StocksFundsAsset_xetr', reservedModelType: 'StocksFundsAsset', symbol: 'VUAA', exchangeCode: 'XETR', currencyCode: 'EUR' },
      { _id: '-StocksFundsAsset_xlon', reservedModelType: 'StocksFundsAsset', symbol: 'VUAA', exchangeCode: 'XLON', currencyCode: 'USD' },
    ]))
    await svc.refresh()
    expect(svc.assetByVenueSymbol('XETR', 'VUAA')).toBe('-StocksFundsAsset_xetr')        // exact MIC match
    expect(svc.assetByVenueSymbol('NOPE', 'VUAA', 'USD')).toBe('-StocksFundsAsset_xlon') // fallback + currency match
  })

  it('applies alias when broker context provided', async () => {
    const svc = new LookupService(couchOf([
      { _id: '-StocksFundsAsset_sxrv', reservedModelType: 'StocksFundsAsset', symbol: 'SXRV', exchangeCode: 'XETR', currencyCode: 'EUR' },
    ]))
    await svc.refresh()
    // Without alias, CNDX/XLON misses (not in CouchDB)
    expect(svc.assetByVenueSymbol('XLON', 'CNDX', 'USD', 'ibkr')).toBe(null)
    // Set alias: ibkr CNDX/XLON → SXRV/XETR
    svc.setAliases([{ broker: 'ibkr', fromSymbol: 'CNDX', fromExchange: 'XLON', toSymbol: 'SXRV', toExchange: 'XETR' }])
    // Now it resolves
    expect(svc.assetByVenueSymbol('XLON', 'CNDX', 'USD', 'ibkr')).toBe('-StocksFundsAsset_sxrv')
    // Aliases are broker-scoped — XTB calls don't apply IBKR's alias
    expect(svc.assetByVenueSymbol('XLON', 'CNDX', 'USD', 'xtb')).toBe(null)
  })
})
