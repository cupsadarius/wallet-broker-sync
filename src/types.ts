export type BrokerId = 'xtb' | 'ibkr' | 'tradeville'

export type CanonicalTxn = {
  externalId: string
  broker: BrokerId
  kind: 'buy' | 'sell' | 'dividend' | 'fee'
  date: string
  symbol?: string
  exchange?: string
  quantity?: number
  pricePerShare?: number
  tradeCurrency?: string
  settlementCurrency: string
  fxRate?: number
  cashAmount: number
  description: string
  feeKind?: 'withholding' | 'sales-tax' | 'other-fee' | 'commission' | 'adjustment'
  raw: Record<string, unknown>
}
