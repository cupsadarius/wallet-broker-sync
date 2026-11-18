/** Themes are color sets only. Each id needs a `:root[data-theme="<id>"]` block in app/themes.css that sets
 * `color-scheme` and every `--c-<token>` in TOKENS, and an entry in public/theme-boot.js (themes.test.ts checks
 * both, and the text contrast). Palettes other than Default come from body-ledger. */
export interface Theme { id: string; label: string; scheme: 'light' | 'dark'; /** browser bar color */ bar: string }

export const THEMES: readonly Theme[] = [
  { id: 'wallet-light', label: 'Light', scheme: 'light', bar: '#f2f4f7' },
  { id: 'wallet-dark', label: 'Dark', scheme: 'dark', bar: '#0f1115' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', scheme: 'dark', bar: '#11111b' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', scheme: 'light', bar: '#dce0e8' },
  { id: 'rose-pine-moon', label: 'Rosé Pine Moon', scheme: 'dark', bar: '#232136' },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', scheme: 'light', bar: '#f2e9e1' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', scheme: 'dark', bar: '#1d2021' },
  { id: 'gruvbox-light', label: 'Gruvbox Light', scheme: 'light', bar: '#f2e5bc' },
  { id: 'cyberdream', label: 'Cyberdream', scheme: 'dark', bar: '#16181a' },
  { id: 'cyberdream-light', label: 'Cyberdream Light', scheme: 'light', bar: '#eaeaea' },
  { id: 'optura', label: 'Optura', scheme: 'dark', bar: '#1a1616' },
  { id: 'optura-light', label: 'Optura Light', scheme: 'light', bar: '#e6e3d6' },
]

/** A theme family: one light and one dark variant. Mode picks the variant; Auto follows the OS. */
export interface Family { id: string; label: string; light: string; dark: string }

export const FAMILIES: readonly Family[] = [
  { id: 'default', label: 'Default', light: 'wallet-light', dark: 'wallet-dark' },
  { id: 'catppuccin', label: 'Catppuccin', light: 'catppuccin-latte', dark: 'catppuccin-mocha' },
  { id: 'rose-pine', label: 'Rosé Pine', light: 'rose-pine-dawn', dark: 'rose-pine-moon' },
  { id: 'gruvbox', label: 'Gruvbox', light: 'gruvbox-light', dark: 'gruvbox-dark' },
  { id: 'cyberdream', label: 'Cyberdream', light: 'cyberdream-light', dark: 'cyberdream' },
  { id: 'optura', label: 'Optura', light: 'optura-light', dark: 'optura' },
]

export type Mode = 'system' | 'light' | 'dark'

export const MODES: readonly { id: Mode; label: string }[] = [
  { id: 'system', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

/** Color tokens every theme block sets, as `--c-<name>`. */
export const TOKENS = [
  'bg', 'surface', 'surface-2', 'line', 'fg', 'fg-2', 'muted',
  'good', 'warn', 'bad', 'accent', 'accent-ink', 'on-accent',
] as const

/** Tokens derived from TOKENS once for all themes; a theme block may pin them. */
export const DERIVED = [
  'chrome', 'line-2', 'neutral', 'accent-soft', 'fill', 'fill-2', 'good-fill', 'warn-tint', 'warn-line',
] as const

/** Also read by public/theme-boot.js. */
export const THEME_KEY = 'wallet-theme'
/** `config` table key that holds the preference slug. */
export const CONFIG_KEY = 'ui.theme'

const byId = (id: string) => THEMES.find(t => t.id === id)
const familyById = (id: string) => FAMILIES.find(f => f.id === id)

/** The preference is one slug: a theme id (fixed variant), "system" (Default, Auto) or "system-<family>".
 * Anything else counts as "system". */
export function parsePref(pref: string): { family: Family; mode: Mode } {
  const auto = pref === 'system' ? FAMILIES[0] : pref.startsWith('system-') ? familyById(pref.slice(7)) : undefined
  if (auto) return { family: auto, mode: 'system' }
  const fixed = FAMILIES.find(f => f.light === pref || f.dark === pref)
  if (fixed) return { family: fixed, mode: fixed.light === pref ? 'light' : 'dark' }
  return { family: FAMILIES[0], mode: 'system' }
}

export function toPref(family: string, mode: Mode): string {
  const f = familyById(family) ?? FAMILIES[0]
  if (mode !== 'system') return f[mode]
  return f === FAMILIES[0] ? 'system' : `system-${f.id}`
}

export function resolveTheme(pref: string, osDark: boolean): Theme {
  const { family, mode } = parsePref(pref)
  return byId(family[mode === 'system' ? (osDark ? 'dark' : 'light') : mode])!
}

export const safePref = (pref: string) => {
  const { family, mode } = parsePref(pref)
  return toPref(family.id, mode)
}
