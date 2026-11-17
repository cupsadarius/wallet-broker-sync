import { describe, it, expect } from 'vitest'
import { isTransfer } from '@/src/dashboards/compute/spending'
import type { MirrorRecord } from '@/src/dashboards/mirror'

const rec = (p: Partial<MirrorRecord>): MirrorRecord => ({
  id: 'r', accountId: 'bt', amount: 490_000, recordType: 0, currencyCode: 'RON', recordDate: '2026-10-30',
  isTradeFallback: false, transfer: false, bankSynced: true, ...p,
})

describe('isTransfer', () => {
  it('counts a record Wallet flags as a transfer, whatever its category', () => {
    expect(isTransfer(rec({ transfer: true, categoryName: 'Salary' }))).toBe(true)
    expect(isTransfer(rec({ categoryName: 'Transfer' }))).toBe(true)
    expect(isTransfer(rec({ categoryName: 'Salary' }))).toBe(false)
  })
})
