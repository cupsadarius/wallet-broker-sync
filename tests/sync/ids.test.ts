import { describe, it, expect } from 'vitest'
import { deterministicId } from '@/src/sync/ids'

describe('deterministicId', () => {
  it('returns "-AssetTransaction_<uuid>"', () => {
    expect(deterministicId('xtb', '999840114')).toMatch(/^-AssetTransaction_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
  it('is stable', () => {
    expect(deterministicId('xtb', '999840114')).toBe(deterministicId('xtb', '999840114'))
  })
  it('differs across brokers', () => {
    expect(deterministicId('xtb', '42')).not.toBe(deterministicId('ibkr', '42'))
  })
  it('differs across externalIds within the same broker', () => {
    expect(deterministicId('xtb', '42')).not.toBe(deterministicId('xtb', '43'))
  })
})
