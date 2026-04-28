import type { CouchClient } from './couch'

export type InvestmentAccount = {
  id: string
  name: string
  currencyCode: string
  assetTypes: number[]
}

export class LookupService {
  private accounts: InvestmentAccount[] = []
  private assetMap = new Map<string, string>()

  constructor(private readonly couch: Pick<CouchClient, 'listByModelType'>) {}

  async refresh() {
    const [accounts, currencies, assets] = await Promise.all([
      this.couch.listByModelType<{ _id: string; accountType: number; name: string; currencyId: string; investmentInfo?: { assetTypes?: number[] } }>('Account'),
      this.couch.listByModelType<{ _id: string; code: string }>('Currency'),
      this.couch.listByModelType<{ _id: string; symbol: string; exchangeCode: string }>('StocksFundsAsset'),
    ])
    const currencyMap = new Map(currencies.map(c => [c._id, c.code]))
    this.accounts = accounts.filter(a => a.accountType === 7).map(a => ({
      id: a._id, name: a.name,
      currencyCode: currencyMap.get(a.currencyId) ?? 'EUR',
      assetTypes: a.investmentInfo?.assetTypes ?? [],
    }))
    this.assetMap.clear()
    for (const a of assets) {
      this.assetMap.set(`${a.exchangeCode.toUpperCase()}:${a.symbol.toUpperCase()}`, a._id)
    }
  }

  investmentAccounts(): InvestmentAccount[] { return this.accounts }
  assetByVenueSymbol(mic: string, symbol: string): string | null {
    return this.assetMap.get(`${mic.toUpperCase()}:${symbol.toUpperCase()}`) ?? null
  }
}
