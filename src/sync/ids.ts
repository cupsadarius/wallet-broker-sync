import { v5 as uuidv5 } from 'uuid'
import type { BrokerId } from '@/src/types'
import { NAMESPACE_WALLET_SYNC } from './namespace'

export function deterministicId(broker: BrokerId, externalId: string): string {
  return `-AssetTransaction_${uuidv5(`${broker}:${externalId}`, NAMESPACE_WALLET_SYNC)}`
}

// Fallback if phase-0 capture #12 reveals a v4-shaped _id is required.
// Swap by changing the export above.
export function deterministicIdV4Looking(broker: BrokerId, externalId: string): string {
  const v5 = uuidv5(`${broker}:${externalId}`, NAMESPACE_WALLET_SYNC)
  return `-AssetTransaction_${v5.substring(0, 14)}4${v5.substring(15)}`
}
