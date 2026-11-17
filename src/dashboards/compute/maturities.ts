export type MaturityKind = 'deposit' | 'bond'

export type Maturity = {
  id: number
  kind: MaturityKind
  name: string
  accountId: string | null   // Wallet account the deposit lives in
  symbol: string | null      // asset symbol the bond is held as
  currency: string
  principal: number          // major units
  rateBps: number | null     // annual rate or coupon; null = not entered
  startDate: string | null   // YYYY-MM-DD
  maturityDate: string       // YYYY-MM-DD
}

export type MaturityEvent = { maturity: Maturity; payout: number | null; done: boolean }

const DAY_MS = 86_400_000
const DONE_WINDOW_DAYS = 365

function days(from: string, to: string): number {
  return (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS
}

function addYears(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() + n)
  return d.toISOString().slice(0, 10)
}

// razor: annual coupons on the maturity anniversary; add a frequency column for semi-annual bonds.
function periodStart(m: Maturity, asOf: string): string {
  if (m.kind === 'deposit') return m.startDate ?? addYears(m.maturityDate, -1)
  let d = m.maturityDate
  while (d > asOf) d = addYears(d, -1)
  return m.startDate && m.startDate > d ? m.startDate : d
}

function interest(m: Maturity, from: string, to: string): number {
  if (m.rateBps === null) return 0
  return m.principal * (m.rateBps / 10_000) * Math.max(0, days(from, to)) / 365
}

/** Interest earned in the running period up to `asOf`; 0 outside the term. */
export function accrued(m: Maturity, asOf: string): number {
  if (asOf >= m.maturityDate || (m.startDate && asOf < m.startDate)) return 0
  return interest(m, periodStart(m, asOf), asOf)
}

/** Par plus accrued interest while the term runs; 0 before start and after maturity. */
export function valueAt(m: Maturity, asOf: string): number {
  if (asOf >= m.maturityDate || (m.startDate && asOf < m.startDate)) return 0
  return m.principal + accrued(m, asOf)
}

/** Principal plus the last period's interest; null when the rate is unknown. */
export function payout(m: Maturity): number | null {
  if (m.rateBps === null) return null
  const dayBefore = new Date(Date.parse(m.maturityDate + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10)
  return m.principal + interest(m, periodStart(m, dayBefore), m.maturityDate)
}

export function comingUp(maturities: Maturity[], today: string): MaturityEvent[] {
  const upcoming = maturities
    .filter(m => m.maturityDate >= today)
    .sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))
  const done = maturities
    .filter(m => m.maturityDate < today && days(m.maturityDate, today) <= DONE_WINDOW_DAYS)
    .sort((a, b) => b.maturityDate.localeCompare(a.maturityDate))
  return [
    ...upcoming.map(m => ({ maturity: m, payout: payout(m), done: false })),
    ...done.map(m => ({ maturity: m, payout: payout(m), done: true })),
  ]
}
