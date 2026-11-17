import { describe, it, expect } from 'vitest'
import {
  budgetHistory, budgetStatus, budgetTasks, effectiveLimit, limitChanges, type BudgetContext,
} from '@/src/dashboards/compute/budgets'
import type { MirrorBudget, MirrorCategory, MirrorRecord } from '@/src/dashboards/mirror'

const categories: MirrorCategory[] = [
  { id: 'groceries', name: 'Groceries', envelopeId: 1000, groupName: 'Food & Drinks' },
  { id: 'restaurant', name: 'Restaurant', envelopeId: 1001, groupName: 'Food & Drinks' },
  { id: 'fuel', name: 'Fuel', envelopeId: 5000, groupName: 'Vehicle' },
  { id: 'salary', name: 'Salary', envelopeId: 10000, groupName: 'Income' },
  { id: 'custom', name: 'Market', envelopeId: undefined, groupName: 'Uncategorised' },
]

function rec(p: Partial<MirrorRecord> & { id: string }): MirrorRecord {
  return {
    accountId: 'bt', categoryId: 'groceries', amount: 10_000, recordType: 1, currencyCode: 'RON', recordDate: '2026-11-05',
    isTradeFallback: false, transfer: false, bankSynced: true, ...p,
  }
}

function budget(p: Partial<MirrorBudget> = {}): MirrorBudget {
  return {
    id: '-Budget_g', name: 'Groceries', currencyCode: 'RON', amount: 50_000, changes: [], type: 1,
    envelopes: [1000], categoryIds: [], accountIds: [], labelIds: [], closed: false, ...p,
  }
}

const ctx: BudgetContext = {
  today: '2026-11-15',
  currency: 'RON',
  byCategoryId: new Map(categories.map(c => [c.id, c])),
  amount: r => r.amount / 100,
}

describe('effectiveLimit', () => {
  it('uses the base amount when no change applies', () => {
    expect(effectiveLimit(budget(), '2026-11')).toBe(500)
  })

  it('applies a change from the month of its date onward, the latest one winning', () => {
    const b = budget({ amount: 150_000, changes: [{ amount: 250_000, date: '2020-11-16T10:00:00.000Z' }, { amount: 300_000, date: '2026-12-02T08:00:00.000Z' }] })
    expect(effectiveLimit(b, '2020-10')).toBe(1500)
    expect(effectiveLimit(b, '2020-11')).toBe(2500)
    expect(effectiveLimit(b, '2026-11')).toBe(2500)
    expect(effectiveLimit(b, '2027-01')).toBe(3000)
  })
})

describe('budgetStatus', () => {
  it('nets incomes against expenses in scope for the current month', () => {
    const s = budgetStatus(budget(), [
      rec({ id: 'a', amount: 30_000 }),
      rec({ id: 'refund', amount: 5_000, recordType: 0 }),
      rec({ id: 'last-month', amount: 99_900, recordDate: '2026-10-31' }),
      rec({ id: 'other-category', categoryId: 'fuel', amount: 99_900 }),
      rec({ id: 'transfer', amount: 99_900, transfer: true }),
    ], ctx)
    expect(s).toMatchObject({ periodStart: '2026-11-01', periodEnd: '2026-11-30', limit: 500, spent: 250, expenses: 300, incomes: 50 })
  })

  it('floors spent at zero when incomes exceed expenses', () => {
    const s = budgetStatus(budget(), [rec({ id: 'a', amount: 1_000 }), rec({ id: 'b', amount: 5_000, recordType: 0 })], ctx)
    expect(s.spent).toBe(0)
  })

  it('marks a passed limit as over and a high run rate as on pace to pass', () => {
    expect(budgetStatus(budget(), [rec({ id: 'a', amount: 60_000 })], ctx)).toMatchObject({ state: 'over', projected: 1200 })
    expect(budgetStatus(budget(), [rec({ id: 'a', amount: 30_000 })], ctx)).toMatchObject({ state: 'pace', projected: 600 })
    expect(budgetStatus(budget(), [rec({ id: 'a', amount: 20_000 })], ctx)).toMatchObject({ state: 'ok', projected: 400 })
  })

  it('limits scope by custom categories, accounts and labels together', () => {
    const b = budget({ envelopes: [], categoryIds: ['custom'], accountIds: ['bt'], labelIds: ['trip'] })
    const s = budgetStatus(b, [
      rec({ id: 'in', categoryId: 'custom', labels: ['trip'], amount: 10_000 }),
      rec({ id: 'no-label', categoryId: 'custom', amount: 10_000 }),
      rec({ id: 'other-account', categoryId: 'custom', labels: ['trip'], accountId: 'rev', amount: 10_000 }),
    ], ctx)
    expect(s.spent).toBe(100)
  })

  it('counts every expense category when the budget names none, but not income or unknown categories', () => {
    const s = budgetStatus(budget({ envelopes: [] }), [
      rec({ id: 'g', amount: 10_000 }),
      rec({ id: 'f', categoryId: 'fuel', amount: 20_000 }),
      rec({ id: 'salary', categoryId: 'salary', recordType: 0, amount: 500_000 }),
      rec({ id: 'none', categoryId: undefined, amount: 40_000 }),
    ], ctx)
    expect(s.spent).toBe(300)
  })

  it('reports nothing rather than a wrong number when a record has no rate', () => {
    const s = budgetStatus(budget(), [rec({ id: 'a' }), rec({ id: 'usd', currencyCode: 'USD' })],
      { ...ctx, amount: r => (r.currencyCode === 'USD' ? null : r.amount / 100) })
    expect(s.spent).toBeNull()
    expect(s.state).toBe('ok')
  })
})

describe('budgetHistory', () => {
  it('gives the netted spend of each full month before the current one, oldest first', () => {
    const h = budgetHistory(budget(), [
      rec({ id: 'sep', recordDate: '2026-09-03', amount: 40_000 }),
      rec({ id: 'oct', recordDate: '2026-10-20', amount: 70_000 }),
      rec({ id: 'oct-refund', recordDate: '2026-10-21', amount: 10_000, recordType: 0 }),
      rec({ id: 'nov', recordDate: '2026-11-02', amount: 10_000 }),
    ], ctx, 3)
    expect(h).toEqual([
      { month: '2026-08', spent: 0, limit: 500 },
      { month: '2026-09', spent: 400, limit: 500 },
      { month: '2026-10', spent: 600, limit: 500 },
    ])
  })
})

describe('limitChanges', () => {
  it('keeps changes from earlier months and sets the new limit from this month on', () => {
    const changes = [
      { amount: 250_000, date: '2020-11-16T10:00:00.000Z' },
      { amount: 260_000, date: '2026-11-02T10:00:00.000Z' },
      { amount: 270_000, date: '2027-01-02T10:00:00.000Z' },
    ]
    expect(limitChanges(changes, 650, '2026-11-17T09:00:00.000Z')).toEqual([
      { amount: 250_000, date: '2020-11-16T10:00:00.000Z' },
      { amount: 65_000, date: '2026-11-17T09:00:00.000Z' },
    ])
    expect(limitChanges(undefined, 99.5, '2026-11-17T09:00:00.000Z')).toEqual([{ amount: 9_950, date: '2026-11-17T09:00:00.000Z' }])
  })
})

describe('budgetTasks', () => {
  it('makes one Today task for the budgets past their limit, new when the set or the month changes', () => {
    const over = budgetStatus(budget(), [rec({ id: 'a', amount: 62_000 })], ctx)
    const car = budgetStatus(budget({ id: '-Budget_c', name: 'Car', envelopes: [5000], amount: 60_000 }), [rec({ id: 'f', categoryId: 'fuel', amount: 518_998 })], ctx)
    const ok = budgetStatus(budget({ id: '-Budget_t', name: 'Transport' }), [], ctx)
    expect(budgetTasks([ok])).toEqual([])
    expect(budgetTasks([over, ok])).toEqual([{
      id: 'budget:2026-11:-Budget_g', kind: 'budget', title: 'Groceries budget passed',
      detail: 'Groceries 620 of 500 RON.', href: '/spending#budgets', action: 'Open',
    }])
    expect(budgetTasks([over, car, ok])).toMatchObject([{
      id: 'budget:2026-11:-Budget_c,-Budget_g', title: '2 budgets passed', detail: 'Groceries 620 of 500 RON · Car 5,190 of 600 RON.',
    }])
  })
})
