export type Provider = 'bt-pensia-noastra' | 'bt-pensii' | 'allianz' | 'signal-iduna' | 'cnpp'

export const PROVIDER_NAME: Record<Provider, string> = {
  'bt-pensia-noastra': 'BT Pensia Noastră', 'bt-pensii': 'BT Pensii', allianz: 'Allianz',
  'signal-iduna': 'Signal Iduna', cnpp: 'CNPP',
}

/** Money fields are integers × 100 in the account currency. */
export type Contribution = { date: string; gross: number; fee: number }

export type MoneyStatement = {
  kind: 'pilon2' | 'pilon3' | 'unit-linked'
  provider: Exclude<Provider, 'cnpp'>
  product: string
  contract: string
  currency: 'RON' | 'EUR'
  asOf: string
  value: number
  paidIn: number
  fees: number | null
  contributions: Contribution[] | null
  birthDate: string | null
}

export type Pilon1Statement = {
  kind: 'pilon1'
  provider: 'cnpp'
  asOf: string
  period: { years: number; months: number; days: number }
  points: number
  pointsByYear: { year: number; points: number }[]
  birthDate: string | null
}

export type Statement = MoneyStatement | Pilon1Statement

export type StatementParser = { detect(lines: string[]): boolean; parse(lines: string[]): Statement }
