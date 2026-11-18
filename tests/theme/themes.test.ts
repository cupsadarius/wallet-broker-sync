import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DERIVED, FAMILIES, parsePref, resolveTheme, safePref, THEME_KEY, THEMES, toPref, TOKENS } from '@/src/theme/themes'

describe('parsePref / toPref', () => {
  it('reads a fixed variant and a family on Auto', () => {
    expect(parsePref('gruvbox-dark')).toMatchObject({ family: { id: 'gruvbox' }, mode: 'dark' })
    expect(parsePref('system-optura')).toMatchObject({ family: { id: 'optura' }, mode: 'system' })
  })
  it('treats unknown and empty slugs as Default on Auto', () => {
    for (const p of ['nonsense', '', 'system-gone']) expect(parsePref(p)).toMatchObject({ family: { id: 'default' }, mode: 'system' })
  })
  it('round-trips every family and mode', () => {
    for (const f of FAMILIES) for (const mode of ['system', 'light', 'dark'] as const) {
      expect(parsePref(toPref(f.id, mode))).toMatchObject({ family: { id: f.id }, mode })
    }
    expect(toPref('default', 'system')).toBe('system')
    expect(toPref('catppuccin', 'light')).toBe('catppuccin-latte')
  })
  it('keeps known slugs and maps the rest to system', () => {
    expect(safePref('wallet-light')).toBe('wallet-light')
    expect(safePref('system-rose-pine')).toBe('system-rose-pine')
    expect(safePref('bogus')).toBe('system')
  })
})

describe('resolveTheme', () => {
  it('follows the OS for system, inside the family', () => {
    expect(resolveTheme('system', true).id).toBe('wallet-dark')
    expect(resolveTheme('system', false).id).toBe('wallet-light')
    expect(resolveTheme('system-rose-pine', false).id).toBe('rose-pine-dawn')
    expect(resolveTheme('gruvbox-light', true).id).toBe('gruvbox-light')
  })
})

describe('families', () => {
  it('hold every theme once, light and dark in the right slots', () => {
    expect(FAMILIES.flatMap(f => [f.light, f.dark]).sort()).toEqual(THEMES.map(t => t.id).sort())
    for (const f of FAMILIES) {
      expect(THEMES.find(t => t.id === f.light)?.scheme).toBe('light')
      expect(THEMES.find(t => t.id === f.dark)?.scheme).toBe('dark')
    }
  })
})

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const PAIRS: [string, string][] = [
  ...['fg', 'fg-2', 'muted', 'good', 'warn', 'bad', 'accent', 'accent-ink'].flatMap(fg =>
    ['bg', 'surface', 'surface-2'].map((bg): [string, string] => [fg, bg])),
  ['on-accent', 'accent'],
]

describe('app/themes.css', () => {
  const css = readFileSync('app/themes.css', 'utf8')
  const matches = [...css.matchAll(/(?:^|\n)\[data-theme="([a-z0-9-]+)"\]\s*\{([^}]*)\}/g)]
  const blocks = new Map(matches.map(m => [m[1], m[2]] as const))

  it('has exactly one block per theme', () => {
    expect(matches.map(m => m[1]).sort()).toEqual(THEMES.map(t => t.id).sort())
  })
  it.each(THEMES.map(t => [t.id, t] as const))('%s sets every token and its color-scheme', (id, t) => {
    const body = blocks.get(id) ?? ''
    const names = new Set([...body.matchAll(/--c-([a-z0-9-]+)\s*:/g)].map(m => m[1]))
    for (const token of TOKENS) expect(names).toContain(token)
    for (const n of names) expect([...TOKENS, ...DERIVED]).toContain(n)
    expect(body).toMatch(new RegExp(`color-scheme:\\s*${t.scheme}\\s*;`))
  })
  it.each(THEMES.map(t => [t.id] as const))('%s keeps text readable (WCAG AA)', id => {
    const color = Object.fromEntries([...(blocks.get(id) ?? '').matchAll(/--c-([a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]))
    const low = PAIRS.map(([fg, bg]) => [fg, bg, contrast(color[fg], color[bg])] as const)
      .filter(([, , r]) => !(r >= 4.5)).map(([fg, bg, r]) => `${fg} on ${bg}: ${r.toFixed(2)}`)
    expect(low).toEqual([])
  })
  it('derives every DERIVED token once for all themes', () => {
    const generic = /(?:^|\n)\[data-theme\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    for (const d of DERIVED) expect(generic).toMatch(new RegExp(`--c-${d}\\s*:`))
  })
})

describe('public/theme-boot.js', () => {
  const boot = readFileSync('public/theme-boot.js', 'utf8')
  it('knows every theme and its bar color', () => {
    const map = /var THEMES = (\{[^}]*\});/.exec(boot)?.[1]
    expect(map && JSON.parse(map)).toEqual(Object.fromEntries(THEMES.map(t => [t.id, t.bar])))
  })
  it('knows every family', () => {
    const map = /var FAMILIES = (\{[^}]*\});/.exec(boot)?.[1]
    expect(map && JSON.parse(map)).toEqual(Object.fromEntries(FAMILIES.map(f => [f.id, [f.light, f.dark]])))
  })
  it('reads the same storage key', () => {
    expect(boot).toContain(`"${THEME_KEY}"`)
  })
})
