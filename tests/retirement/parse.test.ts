import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { birthDateFromCnp, parseStatement, roDate, roNumber } from '@/src/retirement/parse'
import type { MoneyStatement } from '@/src/retirement/types'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8').split('\n')

describe('helpers', () => {
  it('reads Romanian numbers with or without thousands dots', () => {
    expect(roNumber('2.345,00')).toBe(2345)
    expect(roNumber('12345,00')).toBe(12345)
    expect(roNumber('0,92')).toBe(0.92)
  })
  it('reads dd.mm.yyyy and dd-mm-yyyy dates', () => {
    expect(roDate('15.06.2011')).toBe('2011-06-15')
    expect(roDate('01-09-2026')).toBe('2026-09-01')
  })
  it('takes only the birth date from a CNP', () => {
    expect(birthDateFromCnp('1850101123456')).toBe('1985-01-01')
    expect(birthDateFromCnp('5030215000000')).toBe('2003-02-15')
    expect(birthDateFromCnp('9850101123456')).toBeNull()
    expect(birthDateFromCnp('1851399123456')).toBeNull()
  })
})

describe('BT statements', () => {
  it('parses a BT Pilon 2 statement with every contribution', () => {
    const s = parseStatement(fixture('bt-pilon2.txt')) as MoneyStatement
    expect(s).toMatchObject({
      kind: 'pilon2', provider: 'bt-pensia-noastra', currency: 'RON', contract: 'ABC/123456',
      asOf: '2026-09-30', value: 165040, paidIn: 140000, fees: 500, birthDate: '1985-01-01',
    })
    expect(s.contributions).toHaveLength(6)
    expect(s.contributions![0]).toEqual({ date: '2011-06-15', gross: 10000, fee: 250 })
    expect(s.contributions![5]).toEqual({ date: '2011-11-15', gross: 100000, fee: 0 })
  })

  it('parses a BT Pilon 3 statement', () => {
    expect(parseStatement(fixture('bt-pilon3.txt'))).toMatchObject({
      kind: 'pilon3', provider: 'bt-pensii', contract: '1234567', asOf: '2026-09-30',
      value: 39120, paidIn: 36000, fees: 0,
    })
  })

  it('throws when the rows do not add up to the footer total', () => {
    const lines = fixture('bt-pilon2.txt').filter(l => !l.startsWith('Alocare contributie 15.06.2011'))
    expect(() => parseStatement(lines)).toThrow(/contributions/)
  })

  it('never returns the CNP', () => {
    expect(JSON.stringify(parseStatement(fixture('bt-pilon2.txt')))).not.toContain('1850101123456')
  })
})

it('returns null for text it does not know', () => {
  expect(parseStatement(['Tradeville', 'Activity'])).toBeNull()
})

describe('unit-linked statements', () => {
  it('parses an Allianz Dinamic Invest statement', () => {
    expect(parseStatement(fixture('allianz.txt'))).toEqual({
      kind: 'unit-linked', provider: 'allianz', product: 'Dinamic Invest', contract: 'ULT0000001234', currency: 'RON',
      asOf: '2026-09-01', value: 5_000_000, paidIn: 4_000_000, fees: 300_000, contributions: null, birthDate: null,
    })
  })

  it('parses a Signal Iduna 101 Invest statement', () => {
    expect(parseStatement(fixture('signal.txt'))).toEqual({
      kind: 'unit-linked', provider: 'signal-iduna', product: '101 Invest', contract: '1000001', currency: 'EUR',
      asOf: '2026-07-14', value: 240_000, paidIn: 200_014,
      fees: 110 + 500 + 250 + 1000 + 2000 + 5000, contributions: null, birthDate: null,
    })
  })

  it('reads the older Signal Iduna layouts under the same contract', () => {
    expect(parseStatement(fixture('signal-2025.txt'))).toMatchObject({
      contract: '1000001', asOf: '2025-11-20', value: 240_000, paidIn: 200_014, fees: 110 + 500 + 250 + 1000 + 2000 + 5000,
    })
    expect(parseStatement(fixture('signal-2024.txt'))).toMatchObject({
      contract: '1000001', asOf: '2024-05-15', value: 110_000, paidIn: 100_050, fees: 100 + 500 + 200 + 3000,
    })
  })

  it('leaves Signal Iduna fees unknown when the statement has no cost section', () => {
    const lines = fixture('signal-2024.txt').filter(l => !/^(Taxa|Componenta)/.test(l))
    expect(parseStatement(lines)).toMatchObject({ asOf: '2024-05-15', fees: null })
  })

  it('rejects a Signal Iduna anniversary letter with a clear reason', () => {
    expect(() => parseStatement(fixture('signal-letter.txt'))).toThrow(/anniversary letter/)
  })
})

describe('CNPP report', () => {
  it('parses the contribution period and the points per year', () => {
    const s = parseStatement(fixture('cnpp.txt'))
    expect(s).toMatchObject({
      kind: 'pilon1', provider: 'cnpp', asOf: '2026-10-02',
      period: { years: 6, months: 2, days: 10 }, points: 7.5, birthDate: '1985-01-01',
    })
    const byYear = s!.kind === 'pilon1' ? s!.pointsByYear : []
    expect(byYear).toEqual([{ year: 2020, points: 0.9 }, { year: 2021, points: 1.6 }, { year: 2022, points: 2.5 }, { year: 2023, points: 2.5 }])
    expect(Math.abs(byYear.reduce((a, y) => a + y.points, 0) - 7.5)).toBeLessThan(0.0001)
    expect(JSON.stringify(s)).not.toContain('1850101123456')
  })
})
