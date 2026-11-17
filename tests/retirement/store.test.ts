import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/src/storage/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
  return { db, runMigrations: () => {} }
})

import { db } from '@/src/storage/db'
import { config, retirementAccount, retirementContribution, retirementStatement } from '@/src/storage/schema'
import { defaultReleaseDate, saveStatement, setReleaseDate } from '@/src/retirement/store'
import type { MoneyStatement, Pilon1Statement } from '@/src/retirement/types'

const pilon2 = (p: Partial<MoneyStatement> = {}): MoneyStatement => ({
  kind: 'pilon2', provider: 'bt-pensia-noastra', product: 'Pensia Noastră', contract: 'ABC/1', currency: 'RON',
  asOf: '2026-09-30', value: 165040, paidIn: 140000, fees: 500, birthDate: '1985-01-01',
  contributions: [{ date: '2011-06-15', gross: 100000, fee: 500 }, { date: '2011-07-15', gross: 40000, fee: 0 }], ...p,
})
const policy = (p: Partial<MoneyStatement> = {}): MoneyStatement => ({
  kind: 'unit-linked', provider: 'allianz', product: 'Dinamic Invest', contract: 'ULT1', currency: 'RON',
  asOf: '2026-09-01', value: 5_000_000, paidIn: 4_000_000, fees: 300_000, contributions: null, birthDate: null, ...p,
})
const pilon1: Pilon1Statement = {
  kind: 'pilon1', provider: 'cnpp', asOf: '2026-10-02', period: { years: 6, months: 2, days: 10 },
  points: 7.5, pointsByYear: [{ year: 2025, points: 7.5 }], birthDate: '1985-01-01',
}

beforeEach(async () => {
  for (const t of [retirementContribution, retirementStatement, retirementAccount, config]) await db.delete(t)
})

describe('saveStatement', () => {
  it('creates the account with the 65th birthday as release date for a pilon', async () => {
    expect(await saveStatement(pilon2(), 'h1')).toBe('saved')
    expect(await db.select().from(retirementAccount)).toEqual([expect.objectContaining({
      id: 'bt-pensia-noastra:ABC/1', kind: 'pilon2', currency: 'RON', releaseDate: '2050-01-01',
    })])
    expect(await db.select().from(retirementContribution)).toHaveLength(2)
  })

  it('leaves the release date blank for a unit-linked policy and for Pilon 1', async () => {
    await saveStatement(policy(), 'h1')
    await saveStatement(pilon1, 'h2')
    const rows = await db.select().from(retirementAccount)
    expect(rows.map(r => [r.id, r.releaseDate])).toEqual([['allianz:ULT1', null], ['cnpp', null]])
    const p1 = (await db.select().from(retirementStatement)).find(s => s.accountId === 'cnpp')!
    expect(p1).toMatchObject({ value: null, details: { period: pilon1.period, points: 7.5, pointsByYear: pilon1.pointsByYear } })
  })

  it('skips a file it already has, and a second statement for the same account and date', async () => {
    await saveStatement(policy(), 'h1')
    expect(await saveStatement(policy(), 'h1')).toBe('duplicate')
    expect(await saveStatement(policy({ value: 1 }), 'h2')).toBe('duplicate')
    expect(await db.select().from(retirementStatement)).toHaveLength(1)
  })

  it('replaces the contributions only when the statement is the newest', async () => {
    await saveStatement(pilon2(), 'new')
    await saveStatement(pilon2({ asOf: '2025-01-01', contributions: [{ date: '2011-06-15', gross: 100000, fee: 500 }] }), 'old')
    expect(await db.select().from(retirementContribution)).toHaveLength(2)
    await saveStatement(pilon2({ asOf: '2026-12-16', contributions: [
      { date: '2011-06-15', gross: 100000, fee: 500 }, { date: '2011-07-15', gross: 40000, fee: 0 }, { date: '2026-12-01', gross: 10000, fee: 0 },
    ] }), 'newer')
    expect(await db.select().from(retirementContribution)).toHaveLength(3)
  })

  it('stores the birth date once and never overwrites a release date the user set', async () => {
    await saveStatement(pilon2(), 'h1')
    await setReleaseDate('bt-pensia-noastra:ABC/1', '2052-06-30')
    await saveStatement(pilon2({ asOf: '2026-12-16', birthDate: '1990-05-05' }), 'h2')
    expect((await db.select().from(retirementAccount))[0].releaseDate).toBe('2052-06-30')
    expect(await db.select().from(config)).toEqual([{ key: 'retirement.birthDate', value: '1985-01-01' }])
  })
})

describe('defaultReleaseDate', () => {
  it('is the 65th birthday for a pilon, none otherwise', () => {
    expect(defaultReleaseDate('pilon3', '1985-01-01')).toBe('2050-01-01')
    expect(defaultReleaseDate('unit-linked', '1985-01-01')).toBeNull()
    expect(defaultReleaseDate('pilon2', null)).toBeNull()
  })
})
