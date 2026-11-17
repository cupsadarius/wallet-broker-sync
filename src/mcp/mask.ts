// An IBAN, compact or in groups of 4 (country, check pair, then 11 to 30 more characters).
const IBAN = /\b[A-Z]{2}\d{2}(?:[A-Z0-9]{11,30}|(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,3})?)\b/gi
// 10 or more numerals, optionally split by single spaces or dashes; never a piece of a doc id.
const ACCOUNT = /(?<![\w-])\d(?:[ -]?\d){9,}(?![\w-])/g

const lastFour = (m: string) => `****${m.replace(/[ -]/g, '').slice(-4)}`

/** Hides bank account numbers and IBANs, keeping the last 4 characters. */
export function maskAccountNumbers(s: string): string {
  return s.replace(IBAN, lastFour).replace(ACCOUNT, lastFour)
}

export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') return maskAccountNumbers(value) as T
  if (Array.isArray(value)) return value.map(maskDeep) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)])) as T
  }
  return value
}
