import { describe, it, expect } from 'vitest'
import { splitAnswer, answerInstructions } from '@/src/ask/answer'
import { catalog } from '@/src/ask/catalog'

const fence = (...lines: object[]) => ['```spec', ...lines.map(l => JSON.stringify(l)), '```'].join('\n')
const root = { op: 'add', path: '/root', value: 'main' }
const card = { op: 'add', path: '/elements/main', value: { type: 'Card', props: { title: 'Cash' }, children: ['chart'] } }
const chart = {
  op: 'add', path: '/elements/chart',
  value: { type: 'BarChart', props: { data: [{ m: '2026-01', ron: 5 }], xKey: 'm', series: [{ key: 'ron', label: 'RON' }] }, children: [] },
}

describe('splitAnswer', () => {
  it('returns the text and a valid spec', () => {
    const r = splitAnswer(`You spent 5 RON.\n\n${fence(root, card, chart)}`)
    expect(r.text).toBe('You spent 5 RON.')
    expect(r.spec?.root).toBe('main')
    expect(Object.keys(r.spec!.elements)).toEqual(['main', 'chart'])
  })

  it('returns text only when there is no spec', () => {
    expect(splitAnswer('Hello.')).toEqual({ text: 'Hello.', spec: null })
  })

  it('falls back to text when a prop is wrong', () => {
    const bad = { ...chart, value: { ...chart.value, props: { ...chart.value.props, series: [] } } }
    expect(splitAnswer(`Text.\n${fence(root, card, bad)}`)).toEqual({ text: 'Text.', spec: null })
  })

  it('falls back to text when a child is missing', () => {
    expect(splitAnswer(`Text.\n${fence(root, card)}`).spec).toBeNull()
  })

  it('falls back to text for an unknown component', () => {
    const other = { op: 'add', path: '/elements/main', value: { type: 'Button', props: { label: 'x' }, children: [] } }
    expect(splitAnswer(`Text.\n${fence(root, other)}`).spec).toBeNull()
  })

  it('falls back to text when a line is not JSON', () => {
    const r = splitAnswer('Text.\n```spec\n{"op":"add","path":"/root","value":"main"}\n{oops\n```')
    expect(r).toEqual({ text: 'Text.', spec: null })
  })

  it('falls back to text when a prop is a state expression', () => {
    const expr = { op: 'add', path: '/elements/main', value: { type: 'Text', props: { text: { $state: '/x' } }, children: [] } }
    expect(splitAnswer(`Text.\n${fence(root, expr)}`).spec).toBeNull()
  })

  it('keeps the text after the fence', () => {
    expect(splitAnswer(`Before.\n${fence(root, card, chart)}\nAfter.`).text).toBe('Before.\n\nAfter.')
  })
})

describe('answerInstructions', () => {
  it('lists every catalog component and no sample-data rule', () => {
    const p = answerInstructions()
    for (const name of catalog.componentNames) expect(p).toContain(`- ${name}:`)
    expect(p).not.toMatch(/realistic sample data/i)
  })
})
