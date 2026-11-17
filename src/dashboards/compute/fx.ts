export type DirectRate = (base: string, quote: string) => number | null

const PIVOT = 'EUR'

function pair(base: string, quote: string, direct: DirectRate): number | null {
  if (base === quote) return 1
  const d = direct(base, quote)
  if (d !== null) return d
  const inv = direct(quote, base)
  return inv ? 1 / inv : null
}

/** 1 unit of `base` in `quote`: stored pair, its inverse, or a cross through EUR. */
export function crossRate(base: string, quote: string, direct: DirectRate): number | null {
  const b = base.toUpperCase()
  const q = quote.toUpperCase()
  const p = pair(b, q, direct)
  if (p !== null) return p
  const toPivot = pair(b, PIVOT, direct)
  const fromPivot = pair(PIVOT, q, direct)
  return toPivot !== null && fromPivot !== null ? toPivot * fromPivot : null
}
