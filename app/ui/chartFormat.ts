/** "5 min ago", "3 h ago", "2 days ago"; "never" without a date. */
export function ago(at: Date | null, now = Date.now()): string {
  if (!at) return 'never'
  const min = Math.round((now - at.getTime()) / 60_000)
  if (min < 60) return `${Math.max(1, min)} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`
  return `${Math.round(min / 1440)} days ago`
}
/** Short axis numbers: 600k, 1.2M. */
export const short = (n: number) =>
  n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 }).replace('K', 'k')
/** Headline numbers to 3 digits: 2.56M, 478k. */
export const big = (n: number) =>
  n.toLocaleString('en-US', { notation: 'compact', maximumSignificantDigits: 3 }).replace('K', 'k')
export const whole = (n: number) => Math.round(n).toLocaleString('en-US')

const at = (d: string) => new Date(`${d.length === 7 ? `${d}-01` : d}T00:00:00Z`)
/** Axis label for a YYYY-MM or YYYY-MM-DD date: the year on long spans, "Mar ’25" on middle spans, else the month. */
export function dateTick(d: string, spanYears: number): string {
  const month = at(d).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  const year = at(d).getUTCFullYear()
  if (spanYears > 4) return String(year)
  if (spanYears > 1.5) return `${month} ’${String(year).slice(2)}`
  return at(d).getUTCMonth() === 0 ? `${month} ${year}` : month
}
export const dateLong = (d: string) =>
  at(d).toLocaleDateString('en-GB', { ...(d.length > 7 && { day: 'numeric' }), month: 'short', year: 'numeric', timeZone: 'UTC' })
export const spanYears = (first: string, last: string) => (at(last).getTime() - at(first).getTime()) / (365.25 * 86_400_000)
