import type { MirrorRecord } from '@/src/dashboards/mirror'
import { isTransfer } from '@/src/dashboards/compute/spending'

/** Real income or spend: not a transfer leg and not one of this app's trade-fallback records. */
export function reviewable(r: MirrorRecord): boolean {
  return !r.transfer && !isTransfer(r) && !r.isTradeFallback && (r.recordType === 0 || r.recordType === 1)
}
