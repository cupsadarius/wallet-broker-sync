import { create } from 'zustand'
import type { BrokerId } from '@/src/types'

// Mirrors the shape returned by /api/sync (dryRun and full result)
type SyncResultLike = Record<string, unknown>

type Wizard = {
  file: File | null
  broker: BrokerId | null
  dryRun: SyncResultLike | null
  result: SyncResultLike | null
  set: (v: Partial<Omit<Wizard, 'set' | 'reset'>>) => void
  reset: () => void
}

export const useWizard = create<Wizard>((set) => ({
  file: null,
  broker: null,
  dryRun: null,
  result: null,
  set: (v) => set(v),
  reset: () => set({ file: null, broker: null, dryRun: null, result: null }),
}))
