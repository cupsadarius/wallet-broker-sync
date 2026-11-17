import { describe, it, expect, vi } from 'vitest'
import {
  badNumbers, buildFigures, buildNotePrompt, composeNote, localParts, weeklyDue, type Figures,
} from '@/src/insights/weekly'
import type { MirrorCategory, MirrorRecord } from '@/src/dashboards/mirror'

describe('localParts', () => {
  it('reads the day, weekday and hour in Bucharest, summer and winter', () => {
    expect(localParts(new Date('2026-11-15T22:30:00Z'))).toEqual({ day: '2026-11-16', weekday: 1, hour: 0 })
    expect(localParts(new Date('2026-06-14T21:30:00Z'))).toEqual({ day: '2026-06-15', weekday: 1, hour: 0 })
  })
})

describe('weeklyDue', () => {
  const none = { doneWeek: null, lastAttempt: null }

  it('is due from Monday 08:00 Bucharest time, keyed by that Monday', () => {
    expect(weeklyDue(new Date('2026-11-16T05:59:00Z'), none)).toBeNull()
    expect(weeklyDue(new Date('2026-11-16T06:00:00Z'), none)).toBe('2026-11-16')
    expect(weeklyDue(new Date('2026-06-15T05:30:00Z'), none)).toBe('2026-06-15')
  })

  it('runs once a week, catching up later in the week when Monday was missed', () => {
    expect(weeklyDue(new Date('2026-11-16T09:00:00Z'), { doneWeek: '2026-11-16', lastAttempt: null })).toBeNull()
    expect(weeklyDue(new Date('2026-11-18T09:00:00Z'), { doneWeek: '2026-11-09', lastAttempt: null })).toBe('2026-11-16')
    expect(weeklyDue(new Date('2026-11-22T21:00:00Z'), { doneWeek: '2026-11-09', lastAttempt: null })).toBe('2026-11-16')
  })

  it('waits an hour after a failed attempt', () => {
    expect(weeklyDue(new Date('2026-11-16T09:00:00Z'), { doneWeek: null, lastAttempt: '2026-11-16T08:30:00Z' })).toBeNull()
    expect(weeklyDue(new Date('2026-11-16T09:00:00Z'), { doneWeek: null, lastAttempt: '2026-11-16T07:59:00Z' })).toBe('2026-11-16')
  })
})

const categories: MirrorCategory[] = [
  { id: 'groceries', name: 'Groceries', envelopeId: 1000, groupName: 'Food & Drinks' },
  { id: 'fuel', name: 'Fuel', envelopeId: 5000, groupName: 'Vehicle' },
]
const rec = (id: string, recordDate: string, amount: number, categoryId = 'groceries'): MirrorRecord => ({
  id, accountId: 'bt', categoryId, amount: amount * 100, recordType: 1, currencyCode: 'RON', recordDate,
  isTradeFallback: false, transfer: false, bankSynced: true,
})
// Six full months before November: groceries 300 a month, fuel 200 a month; October groceries 600.
const records = [
  ...['05', '06', '07', '08', '09'].flatMap(m => [rec(`g${m}`, `2026-${m}-10`, 300), rec(`f${m}`, `2026-${m}-10`, 200, 'fuel')]),
  rec('g10', '2026-10-10', 600), rec('f10', '2026-10-10', 200, 'fuel'),
  rec('week', '2026-11-12', 120.4), rec('this-week', '2026-11-16', 999),
]
const figures = buildFigures({
  records, today: '2026-11-17', currency: 'RON',
  ctx: { byCategoryId: new Map(categories.map(c => [c.id, c])), amount: r => r.amount / 100 },
  budgets: [{ name: 'Groceries', limit: 500, spent: 1119.4, lastMonthSpent: 600, lastMonthLimit: 500 }],
})

describe('buildFigures', () => {
  it('sums last week and last month by category against the 6-month average, in whole units', () => {
    expect(figures).toEqual({
      currency: 'RON', averageMonths: 6,
      lastWeek: { from: '2026-11-09', to: '2026-11-15', total: 120, categories: [{ name: 'Groceries', spent: 120, usualWeek: 81 }] },
      lastMonth: {
        month: '2026-10', total: 800, average: 550,
        categories: [{ name: 'Groceries', spent: 600, average: 350 }, { name: 'Fuel', spent: 200, average: 200 }],
      },
      budgets: [{ name: 'Groceries', limit: 500, spentThisMonth: 1119, spentLastMonth: 600, limitLastMonth: 500 }],
      changes: [{ name: 'Groceries', lastMonth: 600, average: 350, change: 250, changePct: 71 }],
    } satisfies Figures)
  })
})

describe('badNumbers', () => {
  it('passes numbers from the figures, also with fewer decimals or thousand separators', () => {
    const f = { ...figures, lastWeek: { ...figures.lastWeek, total: 1234 } }
    expect(badNumbers('You spent 1,234 RON last week, 120 on Groceries; 0 or 1 is fine; 6-month average 350.', f)).toEqual([])
  })

  it('lists numbers that are not in the figures, and number words', () => {
    expect(badNumbers('Groceries cost 610 RON, about twenty percent more, 71.4% up.', figures)).toEqual(['610', '71.4', 'twenty'])
  })
})

describe('composeNote', () => {
  it('keeps a note whose numbers all check', async () => {
    const text = 'Groceries: 600 RON last month, against 350 on average (+71%). Cook at home more often.'
    const ask = vi.fn().mockResolvedValue(`  ${text}\n`)
    expect(await composeNote(figures, ask)).toEqual({ text, status: 'ok', problem: null })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('retries once with the bad numbers named, and keeps the fixed note', async () => {
    const ask = vi.fn().mockResolvedValueOnce('Groceries rose to 610 RON.').mockResolvedValueOnce('Groceries rose to 600 RON.')
    expect(await composeNote(figures, ask)).toEqual({ text: 'Groceries rose to 600 RON.', status: 'ok', problem: null })
    expect(ask.mock.calls[1][0]).toContain('not in FIGURES: 610')
  })

  it('flags the note when the retry still has a bad number', async () => {
    const ask = vi.fn().mockResolvedValue('Groceries rose to 610 RON.')
    expect(await composeNote(figures, ask)).toMatchObject({ status: 'flagged', problem: 'Numbers not in the figures: 610' })
    expect(ask).toHaveBeenCalledTimes(2)
  })
})

describe('buildNotePrompt', () => {
  it('sends the figures and the number rule', () => {
    const p = buildNotePrompt(figures)
    expect(p).toContain(JSON.stringify(figures))
    expect(p).toContain('Write every number as digits, exactly as in FIGURES')
  })
})
