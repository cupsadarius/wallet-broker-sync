import type { MirrorRecord } from '../mirror'

export type IncomeKind = 'dividend' | 'coupon' | 'interest'

export function incomeKind(r: MirrorRecord): IncomeKind | null {
  if (r.recordType !== 0 || r.transfer) return null
  const note = r.note ?? ''
  if (r.isTradeFallback) {
    if (/cupon|coupon/i.test(note)) return 'coupon'
    if (/dividend/i.test(note)) return 'dividend'
    return null
  }
  return /interest/i.test(r.categoryName ?? '') ? 'interest' : null
}
