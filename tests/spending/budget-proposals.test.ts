import { describe, it, expect } from 'vitest'
import { buildBudgetPrompt, parseBudgetProposals, type BudgetInput } from '@/src/spending/budget-proposals'

const budgets: BudgetInput[] = [
  { id: '-Budget_g', name: 'Groceries', currency: 'RON', limit: 500, months: [{ month: '2026-09', spent: 820.4 }, { month: '2026-10', spent: 760 }] },
  { id: '-Budget_t', name: 'Transport', currency: 'RON', limit: 100, months: [{ month: '2026-09', spent: 40 }, { month: '2026-10', spent: null }] },
]

describe('buildBudgetPrompt', () => {
  it('sends each budget with its limit and monthly spend, and asks for JSON', () => {
    const p = buildBudgetPrompt(budgets)
    expect(p).toContain('{"budgetId":"-Budget_g","name":"Groceries","currency":"RON","limit":500,"spent":{"2026-09":820,"2026-10":760}}')
    expect(p).toContain('"2026-10":null')
    expect(p).toContain('{"proposals":[{"budgetId":"...","limit":0,"reason":"..."}]}')
  })
})

describe('parseBudgetProposals', () => {
  it('keeps valid proposals for known budgets, rounded to whole units', () => {
    const reply = 'Here you go: {"proposals":[{"budgetId":"-Budget_g","limit":799.6,"reason":"You spent 790 a month on average."}]}'
    expect(parseBudgetProposals(reply, budgets)).toEqual([
      { budgetId: '-Budget_g', limit: 800, reason: 'You spent 790 a month on average.' },
    ])
  })

  it('drops unknown budgets, unchanged limits, bad limits and repeats', () => {
    const reply = JSON.stringify({ proposals: [
      { budgetId: '-Budget_x', limit: 300, reason: 'x' },
      { budgetId: '-Budget_t', limit: 100, reason: 'same' },
      { budgetId: '-Budget_t', limit: -5, reason: 'negative' },
      { budgetId: '-Budget_g', limit: 700, reason: 'first' },
      { budgetId: '-Budget_g', limit: 750, reason: 'second' },
    ] })
    expect(parseBudgetProposals(reply, budgets)).toEqual([{ budgetId: '-Budget_g', limit: 700, reason: 'first' }])
  })

  it('throws when the reply has no proposals list', () => {
    expect(() => parseBudgetProposals('no idea', budgets)).toThrow('AI reply has no JSON')
    expect(() => parseBudgetProposals('{"ideas":[]}', budgets)).toThrow('no proposals list')
  })
})
