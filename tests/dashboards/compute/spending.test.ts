import { describe, it, expect } from 'vitest'
import { budgetsByCategory, categoryDetails, isTransfer, keptShare, overBudgetMonths } from '@/src/dashboards/compute/spending'
import type { BudgetStatus } from '@/src/dashboards/compute/budgets'
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

describe('keptShare', () => {
  it('is the share of income not spent', () => {
    expect(keptShare(14700, 10060)).toBeCloseTo(0.3156, 4)
  })
  it('is null without income', () => {
    expect(keptShare(0, 5)).toBeNull()
  })
})

const status = (id: string, categoryIds: string[] | null) => ({ id, categoryIds }) as BudgetStatus
const slice = (key: string, ...categoryIds: string[]) => ({ key, categoryIds })

describe('budgetsByCategory', () => {
  it('puts a one-category budget on that category row', () => {
    expect(budgetsByCategory([status('b', ['a'])], [slice('a', 'a')]).get('a')).toMatchObject({ rowNote: { id: 'b' }, covering: [{ id: 'b' }] })
  })
  it('shows a budget over two categories in both details, on no row', () => {
    const m = budgetsByCategory([status('b', ['a', 'b'])], [slice('a', 'a'), slice('b', 'b')])
    for (const k of ['a', 'b']) expect(m.get(k)).toMatchObject({ rowNote: null, covering: [{ id: 'b' }] })
  })
  it('puts no budget on the row when two budgets cover only that category', () => {
    expect(budgetsByCategory([status('x', ['a']), status('y', ['a'])], [slice('a', 'a')]).get('a')).toMatchObject({ rowNote: null, covering: [{ id: 'x' }, { id: 'y' }] })
  })
  it('counts a category key that folds several ids as one category', () => {
    expect(budgetsByCategory([status('b', ['a1', 'a2'])], [slice('a', 'a1', 'a2')]).get('a')?.rowNote).toMatchObject({ id: 'b' })
  })
  it('shows an all-spending budget in every detail, on no row', () => {
    expect(budgetsByCategory([status('all', null)], [slice('a', 'a')]).get('a')).toMatchObject({ rowNote: null, covering: [{ id: 'all' }] })
  })
})

describe('overBudgetMonths', () => {
  it('lists the months over the limit and counts the rest', () => {
    expect(overBudgetMonths([{ yearMonth: '2026-01', amount: 900 }, { yearMonth: '2026-02', amount: 1300 }], 1200)).toEqual({ over: ['2026-02'], underCount: 1 })
  })
})

describe('categoryDetails', () => {
  const rec = (id: string, date: string, amountBase: number) =>
    ({ id, date, amountBase, amountNative: amountBase, currency: 'RON', accountName: 'BT', note: '', recordType: amountBase < 0 ? 1 : 0 })
  it('gives each category its spend per month, its records this month, its rules and its proposals', () => {
    const d = categoryDetails(
      { byCategory: [{ key: 'food', categoryIds: ['groceries'] }], records: { food: [rec('r3', '2026-11-02', -50), rec('r2', '2026-10-20', 10), rec('r1', '2026-10-02', -40)] } },
      ['2026-09', '2026-10', '2026-11'],
      [{ id: 'rule', name: 'Shop', keywords: ['shop'], categoryId: 'groceries' }, { id: 'other', name: 'Fuel', keywords: ['omv'], categoryId: 'fuel' }],
      [{ id: 'p', categoryId: 'groceries' }, { id: 'q', categoryId: 'fuel' }],
    ).get('food')!
    expect(d.monthly).toEqual([{ yearMonth: '2026-09', amount: 0 }, { yearMonth: '2026-10', amount: 30 }, { yearMonth: '2026-11', amount: 50 }])
    expect(d.latest.map(r => r.id)).toEqual(['r3'])
    expect(d.rules.map(r => r.id)).toEqual(['rule'])
    expect(d.proposals.map(p => p.id)).toEqual(['p'])
  })
})
