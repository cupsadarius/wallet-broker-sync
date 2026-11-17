import { describe, it, expect } from 'vitest'
import { maskAccountNumbers, maskDeep } from '@/src/mcp/mask'

describe('maskAccountNumbers', () => {
  it('masks a compact IBAN to its last 4 characters', () => {
    expect(maskAccountNumbers('Transfer to RO49AAAA1B31007593840000 rent')).toBe('Transfer to ****0000 rent')
  })
  it('masks an IBAN written in groups of 4', () => {
    expect(maskAccountNumbers('IBAN: DE89 3704 0044 0532 0130 00')).toBe('IBAN: ****3000')
  })
  it('masks a lower-case IBAN', () => {
    expect(maskAccountNumbers('gb29nwbk60161331926819')).toBe('****6819')
  })
  it('masks a long numeric account number, with or without separators', () => {
    expect(maskAccountNumbers('acct 1234567890123')).toBe('acct ****0123')
    expect(maskAccountNumbers('card 4111 1111 1111 1234')).toBe('card ****1234')
    expect(maskAccountNumbers('cont 251-100-123456789')).toBe('cont ****6789')
  })
  it('keeps dates, amounts, ISINs and Wallet doc ids', () => {
    const kept = [
      'Buy 10 VUAA @ 101.25 EUR on 2026-11-17',
      '2026-11-17T10:00:00.000Z',
      'US0378331005',
      '-Account_5c5c32c8-0082-8000-8000-000000000000',
      'Phone 0722 123',
    ]
    for (const s of kept) expect(maskAccountNumbers(s)).toBe(s)
  })
})

describe('maskDeep', () => {
  it('masks every string in nested objects and arrays, and keeps other values', () => {
    const out = maskDeep({ name: 'ING RO49AAAA1B31007593840000', n: 1234567890123, list: [{ note: 'x 1234567890123' }], ok: true, nil: null })
    expect(out).toEqual({ name: 'ING ****0000', n: 1234567890123, list: [{ note: 'x ****0123' }], ok: true, nil: null })
  })
})
