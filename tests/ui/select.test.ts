import { describe, it, expect } from 'vitest'
import { pickSelected } from '@/app/ui/select'

const items = [{ id: 'a' }, { id: 'b' }]

describe('pickSelected', () => {
  it('picks the item the param names', () => {
    expect(pickSelected(items, 'b')).toEqual({ selected: items[1], fromParam: true })
  })
  it('falls back to the first item for an unknown or missing param', () => {
    expect(pickSelected(items, 'zz')).toEqual({ selected: items[0], fromParam: false })
    expect(pickSelected(items, undefined)).toEqual({ selected: items[0], fromParam: false })
  })
  it('has nothing to pick in an empty list', () => {
    expect(pickSelected([], 'a')).toEqual({ selected: null, fromParam: false })
  })
})
