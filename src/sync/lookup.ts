import type { CouchClient } from './couch'

export type InvestmentAccount = {
  id: string
  name: string
  currencyCode: string
  assetTypes: number[]
}

type AliasMap = Map<string, { symbol: string; exchange: string }>  // 'broker:fromSymbol:fromExchange' → target

export class LookupService {
  private accounts: InvestmentAccount[] = []
  private assetMap = new Map<string, string>()                                         // 'XNGS:NVDA' → assetId
  private bareSymbolMap = new Map<string, Array<{ assetId: string; currencyCode: string }>>()  // 'NVDA' → [{...}, ...]
  private assetByIdMap = new Map<string, { symbol: string; exchangeCode: string; currencyCode: string; name?: string }>()
  private aliases: AliasMap = new Map()
  private categoryByIdMap = new Map<string, { name: string }>()
  private categoryByNameMap = new Map<string, string>()  // lowercased name → categoryId
  private currencyByCodeMap = new Map<string, string>()  // ISO code → '-Currency_<uuid>'

  constructor(private readonly couch: Pick<CouchClient, 'listByModelType'>) {}

  /** Populate from a pre-bucketed snapshot (e.g. the local cache). */
  populateFromBuckets(buckets: Map<string, Record<string, unknown>[]>): void {
    const accounts = (buckets.get('Account') ?? []) as Array<{ _id: string; accountType: number; name: string; currencyId: string; investmentInfo?: { assetTypes?: number[] } }>
    const currencies = (buckets.get('Currency') ?? []) as Array<{ _id: string; code: string }>
    const assets = (buckets.get('StocksFundsAsset') ?? []) as Array<{ _id: string; symbol: string; exchangeCode: string; currencyCode?: string; name?: string }>
    const categories = (buckets.get('Category') ?? []) as Array<{ _id: string; name: string }>
    this.populate({ accounts, currencies, assets, categories })
  }

  async refresh() {
    const [accounts, currencies, assets, categories] = await Promise.all([
      this.couch.listByModelType<{ _id: string; accountType: number; name: string; currencyId: string; investmentInfo?: { assetTypes?: number[] } }>('Account'),
      this.couch.listByModelType<{ _id: string; code: string }>('Currency'),
      this.couch.listByModelType<{ _id: string; symbol: string; exchangeCode: string; currencyCode?: string }>('StocksFundsAsset'),
      this.couch.listByModelType<{ _id: string; name: string }>('Category'),
    ])
    this.populate({ accounts, currencies, assets, categories })
  }

  private populate(input: {
    accounts: Array<{ _id: string; accountType: number; name: string; currencyId: string; investmentInfo?: { assetTypes?: number[] } }>
    currencies: Array<{ _id: string; code: string }>
    assets: Array<{ _id: string; symbol: string; exchangeCode: string; currencyCode?: string; name?: string }>
    categories: Array<{ _id: string; name: string }>
  }) {
    const { accounts, currencies, assets, categories } = input
    const currencyMap = new Map(currencies.map(c => [c._id, c.code]))
    this.accounts = accounts.filter(a => a.accountType === 7).map(a => ({
      id: a._id, name: a.name,
      currencyCode: currencyMap.get(a.currencyId) ?? 'EUR',
      assetTypes: a.investmentInfo?.assetTypes ?? [],
    }))
    this.assetMap.clear()
    this.bareSymbolMap.clear()
    this.assetByIdMap.clear()
    for (const a of assets) {
      const key = `${a.exchangeCode.toUpperCase()}:${a.symbol.toUpperCase()}`
      this.assetMap.set(key, a._id)
      const sym = a.symbol.toUpperCase()
      const entry = { assetId: a._id, currencyCode: a.currencyCode ?? '' }
      const existing = this.bareSymbolMap.get(sym)
      if (existing) existing.push(entry)
      else this.bareSymbolMap.set(sym, [entry])
      this.assetByIdMap.set(a._id, {
        symbol: a.symbol,
        exchangeCode: a.exchangeCode,
        currencyCode: (a as Record<string, unknown>)['currencyCode'] as string ?? '',
        name: (a as Record<string, unknown>)['name'] as string | undefined,
      })
    }
    this.categoryByIdMap.clear()
    this.categoryByNameMap.clear()
    for (const c of categories) {
      this.categoryByIdMap.set(c._id, { name: c.name })
      this.categoryByNameMap.set(c.name.toLowerCase(), c._id)
    }
    this.currencyByCodeMap.clear()
    for (const c of currencies) {
      this.currencyByCodeMap.set(c.code, c._id)
    }
  }

  setAliases(aliasRows: Array<{ broker: string; fromSymbol: string; fromExchange: string; toSymbol: string; toExchange: string }>) {
    this.aliases.clear()
    for (const a of aliasRows) {
      this.aliases.set(`${a.broker}:${a.fromSymbol.toUpperCase()}:${a.fromExchange.toUpperCase()}`, {
        symbol: a.toSymbol.toUpperCase(),
        exchange: a.toExchange.toUpperCase(),
      })
    }
  }

  investmentAccounts(): InvestmentAccount[] { return this.accounts }

  categoryByName(name: string): string | null {
    return this.categoryByNameMap.get(name.toLowerCase()) ?? null
  }

  categoryById(id: string): { name: string } | null {
    return this.categoryByIdMap.get(id) ?? null
  }

  currencyByCode(code: string): string | null {
    return this.currencyByCodeMap.get(code) ?? null
  }

  assetById(id: string): { symbol: string; exchangeCode: string; currencyCode: string; name?: string } | null {
    return this.assetByIdMap.get(id) ?? null
  }

  /**
   * Look up an asset by (MIC, symbol). If exact MIC match misses, falls back to
   * symbol-only lookup. With multiple matches, prefers the one whose currencyCode
   * matches the hint. Returns null only if no symbol match at all.
   *
   * When broker is provided, an alias for (broker, fromSymbol, fromExchange) is
   * applied first, substituting the target symbol/exchange before lookup.
   *
   * Note: bare-symbol fallback can pick the wrong cross-listed instrument when
   * multiple venues list the same ticker. The diff preview is the user's
   * safety net.
   */
  assetByVenueSymbol(mic: string, symbol: string, expectedCurrency?: string, broker?: string): string | null {
    let lookupMic = mic.toUpperCase()
    let lookupSymbol = symbol.toUpperCase()

    if (broker) {
      const alias = this.aliases.get(`${broker}:${lookupSymbol}:${lookupMic}`)
      if (alias) {
        lookupMic = alias.exchange
        lookupSymbol = alias.symbol
      }
    }

    const exact = this.assetMap.get(`${lookupMic}:${lookupSymbol}`)
    if (exact) return exact

    const candidates = this.bareSymbolMap.get(lookupSymbol)
    if (!candidates || candidates.length === 0) return null
    if (candidates.length === 1) return candidates[0].assetId

    if (expectedCurrency) {
      const ccyMatch = candidates.find(c => c.currencyCode === expectedCurrency)
      if (ccyMatch) return ccyMatch.assetId
    }
    // Multiple matches without currency hint or no currency match: pick first.
    return candidates[0].assetId
  }
}
