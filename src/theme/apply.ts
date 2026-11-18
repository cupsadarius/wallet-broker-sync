import { resolveTheme, THEME_KEY } from './themes'

export function osDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}

/** Shows the theme for a preference slug and caches the slug for the boot script. */
export function applyPref(pref: string): void {
  const t = resolveTheme(pref, osDark())
  const root = document.documentElement
  root.dataset.theme = t.id
  root.dataset.scheme = t.scheme
  root.dataset.themePref = pref
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bar)
  try { window.localStorage.setItem(THEME_KEY, pref) } catch { /* storage blocked: the server copy still applies */ }
}
