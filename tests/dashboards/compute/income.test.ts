import { describe, it, expect } from 'vitest'
import { incomeKind } from '@/src/dashboards/compute/income'
import type { MirrorRecord } from '@/src/dashboards/mirror'

function rec(p: Partial<MirrorRecord>): MirrorRecord {
  return {
    id: 'r', accountId: 'a', amount: 100, recordType: 0, currencyCode: 'RON', recordDate: '2026-01-01',
    isTradeFallback: false, transfer: false, bankSynced: false, ...p,
  }
}

describe('incomeKind', () => {
  it('reads coupons and dividends from imported broker records', () => {
    expect(incomeKind(rec({ isTradeFallback: true, note: 'plata cupon R2604B Pret dirty:' }))).toBe('coupon')
    expect(incomeKind(rec({ isTradeFallback: true, note: 'dividend TLV Pret dirty:' }))).toBe('dividend')
    expect(incomeKind(rec({ isTradeFallback: true, note: 'T(US00206R1023) Cash Dividend USD 0.2775 per Share (Ordinary Dividend)' }))).toBe('dividend')
  })
  it('reads deposit interest from the Wallet category', () => {
    expect(incomeKind(rec({ categoryName: 'Interest, dividends', note: 'Dobanda depozit' }))).toBe('interest')
  })
  it('skips expenses, transfers, trades and other income', () => {
    expect(incomeKind(rec({ isTradeFallback: true, recordType: 1, note: 'Cash Dividend - US Tax' }))).toBeNull()
    expect(incomeKind(rec({ categoryName: 'Interest, dividends', transfer: true }))).toBeNull()
    expect(incomeKind(rec({ isTradeFallback: true, note: 'Sell 1000 R2604B @ 100 RON (x)' }))).toBeNull()
    expect(incomeKind(rec({ categoryName: 'Wage, invoices' }))).toBeNull()
  })
})
