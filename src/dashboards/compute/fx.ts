export type DirectRate = (base: string, quote: string) => number | null

function pair(base: string, quote: string, direct: DirectRate): number | null {
  if (base === quote) return 1
  const d = direct(base, quote)
  if (d !== null) return d
  const inv = direct(quote, base)
  return inv ? 1 / inv : null
}

/**
 * 1 unit of `base` in `quote`. Goes through `pivot` (the base currency, which every sync keeps fresh)
 * before a direct pair, because a direct pair can be left over from an old base currency.
 */
export function crossRate(base: string, quote: string, direct: DirectRate, pivot: string): number | null {
  const b = base.toUpperCase()
  const q = quote.toUpperCase()
  const p = pivot.toUpperCase()
  if (b === q) return 1
  // Sync stores X→pivot, so read both legs in that direction.
  const toPivot = pair(b, p, direct)
  const quoteToPivot = pair(q, p, direct)
  return toPivot !== null && quoteToPivot ? toPivot / quoteToPivot : pair(b, q, direct)
}
