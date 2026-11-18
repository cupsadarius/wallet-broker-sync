import { describe, it, expect } from 'vitest'
import {
  buildPrompt, groupKey, parseProposals, payeeLabel, ruleId, ruleMatches, selectCandidates,
} from '@/src/spending/proposals'
import type { MirrorCategory, MirrorRecord, MirrorRule } from '@/src/dashboards/mirror'

const FOOD = '-Category_food'
const UNKNOWN = '-Category_unknown'
const PENSION = '-Category_pension'
const categories: MirrorCategory[] = [
  { id: FOOD, name: 'Restaurant, fast-food', envelopeId: 1001, groupName: 'Food & Drinks' },
  { id: UNKNOWN, name: 'Unknown Expense', envelopeId: 13001, groupName: 'Unknown' },
  { id: PENSION, name: 'Pension', envelopeId: 9003, groupName: 'Investments' },
]
const byCategoryId = new Map(categories.map(c => [c.id, c]))
const rules: MirrorRule[] = [
  { id: '-MagicRule_1', name: 'Pilon 3', keywords: ['FPF Pensia Mea, RO77BRDE450SV22586914500'], categoryId: PENSION, recordType: 1 },
]

function rec(p: Partial<MirrorRecord> & { id: string }): MirrorRecord {
  return {
    accountId: 'acc', amount: 1000, recordType: 1, currencyCode: 'RON', recordDate: '2026-11-10',
    isTradeFallback: false, transfer: false, bankSynced: true, ...p,
  }
}
const pos = (merchant: string, day: string) =>
  `Plata la POS non-BT cu card MASTERCARD;POS ${day}/11/2026 000000001 TID:00000002 ${merchant} RO 00001111 valoare tranzactie: 11.16 RON RRN:000000000003`

describe('payeeLabel and groupKey', () => {
  it('prefers the payee, else the merchant in a card payment note, else the note', () => {
    expect(payeeLabel(rec({ id: 'a', payee: 'Sbx Piatasfatului', note: 'x' }))).toBe('Sbx Piatasfatului')
    expect(payeeLabel(rec({ id: 'b', note: pos('LEROY MERLIN CLUJ C9', '14') }))).toBe('LEROY MERLIN CLUJ C9')
    expect(payeeLabel(rec({ id: 'c', note: 'Oasis Biharia M8' }))).toBe('Oasis Biharia M8')
  })

  it('groups the same merchant across dates, reference numbers and case', () => {
    expect(groupKey(rec({ id: 'a', note: pos('LEROY MERLIN CLUJ C9', '14') })))
      .toBe(groupKey(rec({ id: 'b', note: pos('Leroy Merlin Cluj C10', '02') })))
    expect(groupKey(rec({ id: 'c', note: pos('LEROY MERLIN CLUJ', '14') })))
      .not.toBe(groupKey(rec({ id: 'd', note: pos('DEDEMAN CLUJ', '14') })))
  })
})

describe('ruleMatches', () => {
  it('matches a keyword as a case-insensitive substring of the payee or the note', () => {
    expect(ruleMatches(['leroy merlin'], rec({ id: 'a', note: pos('LEROY MERLIN CLUJ', '14') }))).toBe(true)
    expect(ruleMatches(['FPF PENSIA MEA'], rec({ id: 'b', payee: 'FPF Pensia Mea, RO77BRDE450SV22586914500' }))).toBe(true)
    expect(ruleMatches(['dedeman', 'leroy'], rec({ id: 'c', note: 'LEROY' }))).toBe(true)
    expect(ruleMatches(['dedeman'], rec({ id: 'd', note: 'LEROY', payee: 'Lidl' }))).toBe(false)
    expect(ruleMatches(['  '], rec({ id: 'e', note: 'anything' }))).toBe(false)
  })
})

describe('selectCandidates', () => {
  const today = '2026-11-17'

  it('groups uncategorized and recently recategorized spend by payee, biggest group first', () => {
    const records = [
      rec({ id: '1', note: pos('LEROY MERLIN CLUJ', '14'), categoryId: UNKNOWN }),
      rec({ id: '2', note: pos('Leroy Merlin Cluj', '02') }),
      rec({ id: '3', payee: 'Sbx Piatasfatului', categoryId: FOOD, originalCategoryId: UNKNOWN }),
      rec({ id: '4', payee: 'Old swap', categoryId: FOOD, originalCategoryId: UNKNOWN, recordDate: '2026-01-01' }),
      rec({ id: '5', payee: 'Categorized', categoryId: FOOD, originalCategoryId: FOOD }),
      rec({ id: '6', payee: 'Revolut', categoryId: UNKNOWN, transfer: true }),
      rec({ id: '7', payee: 'Salary', categoryId: UNKNOWN, recordType: 0 }),
      rec({ id: '8', note: 'Buy 2 SNP @ 1.2 RON', isTradeFallback: true }),
      rec({ id: '9', payee: 'FPF Pensia Mea, RO77BRDE450SV22586914500', categoryId: UNKNOWN }),
    ]
    const out = selectCandidates(records, { byCategoryId, rules, rejected: [], today })
    expect(out.map(c => [c.label, c.count])).toEqual([['LEROY MERLIN CLUJ', 2], ['Sbx Piatasfatului', 1]])
    expect(out[1].categoryName).toBe('Restaurant, fast-food')
  })

  it('leaves out payees of a rejected proposal', () => {
    const records = [
      rec({ id: '1', note: pos('LEROY MERLIN CLUJ', '14'), categoryId: UNKNOWN }),
      rec({ id: '2', payee: 'Sbx Piatasfatului', categoryId: UNKNOWN }),
    ]
    const out = selectCandidates(records, { byCategoryId, rules, rejected: [['leroy merlin']], today })
    expect(out.map(c => c.label)).toEqual(['Sbx Piatasfatului'])
  })
})

describe('buildPrompt', () => {
  it('lists candidates, rules and categories, with account numbers masked', () => {
    const prompt = buildPrompt({
      candidates: [{ key: 'k', label: 'FPF Pensia Mea, RO77BRDE450SV22586914500', count: 3, examples: ['FPF Pensia Mea, RO77BRDE450SV22586914500'] }],
      rules, categories,
    })
    expect(prompt).toContain('Pilon 3')
    expect(prompt).toContain(FOOD)
    expect(prompt).toContain('"count":3')
    expect(prompt).not.toContain('RO77BRDE450SV22586914500')
  })
})

describe('parseProposals', () => {
  const records = [
    rec({ id: '1', note: pos('LEROY MERLIN CLUJ', '14') }),
    rec({ id: '2', note: pos('Leroy Merlin Cluj', '02'), categoryId: FOOD }),
    rec({ id: '3', payee: 'FPF Pensia Mea, RO77BRDE450SV22586914500', categoryId: PENSION }),
    rec({ id: '4', payee: 'Leroy', transfer: true }),
  ]
  const ctx = { records, rules, rejected: [] as string[][], byCategoryId }
  const reply = (proposals: unknown[]) => 'Here you go:\n```json\n' + JSON.stringify({ proposals }) + '\n```'

  it('keeps valid proposals and counts past matches locally', () => {
    const out = parseProposals(reply([
      { name: 'Leroy', keywords: ['Leroy Merlin'], categoryId: FOOD, pastMatchCount: 99, matchedExamples: ['made up'] },
    ]), ctx)
    expect(out).toEqual([{
      name: 'Leroy', keywords: ['Leroy Merlin'], categoryId: FOOD,
      pastMatchCount: 2, matchedExamples: ['LEROY MERLIN CLUJ', 'Leroy Merlin Cluj'],
    }])
  })

  it('drops unknown categories, contradictions of a rule, zero matches and malformed items', () => {
    const out = parseProposals(reply([
      { name: 'Ghost', keywords: ['Leroy'], categoryId: '-Category_nope' },
      { name: 'Pension as food', keywords: ['pensia mea'], categoryId: FOOD },
      { name: 'Same payee, other words', keywords: ['RO77BRDE'], categoryId: FOOD },
      { name: 'Nothing', keywords: ['Dedeman'], categoryId: FOOD },
      { name: 'Bad', keywords: [], categoryId: FOOD },
      { name: 'Leroy', keywords: ['leroy merlin'], categoryId: FOOD },
    ]), ctx)
    expect(out.map(p => p.name)).toEqual(['Leroy'])
  })

  it('drops a proposal that matches the payee of a rejected proposal, whatever its name or keywords', () => {
    const out = parseProposals(reply([
      { name: 'Hardware store', keywords: ['LEROY'], categoryId: FOOD },
    ]), { ...ctx, rejected: [['Leroy Merlin Cluj']] })
    expect(out).toEqual([])
  })

  it('throws when the reply has no JSON', () => {
    expect(() => parseProposals('sorry, no idea', ctx)).toThrow(/JSON/)
  })
})

describe('ruleId', () => {
  it('is the same for the same name and keywords in any order or case', () => {
    const id = ruleId('Leroy', ['Leroy Merlin', 'Dedeman'])
    expect(id).toMatch(/^-MagicRule_[0-9a-f-]{36}$/)
    expect(ruleId(' leroy ', ['dedeman', 'LEROY MERLIN'])).toBe(id)
    expect(ruleId('Leroy', ['Leroy Merlin'])).not.toBe(id)
    expect(ruleId('Hardware', ['Leroy Merlin', 'Dedeman'])).not.toBe(id)
  })
})
