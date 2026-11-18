'use client'

import { useEffect } from 'react'
import { applyPref } from '@/src/theme/apply'

/** Applies the saved theme and, on Auto, follows OS light/dark changes while the app is open. */
export default function ThemeSync({ pref }: { pref: string }) {
  useEffect(() => {
    applyPref(pref)
    let mq: MediaQueryList
    try { mq = window.matchMedia('(prefers-color-scheme: dark)') } catch { return }
    const onChange = () => applyPref(document.documentElement.dataset.themePref ?? pref)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])
  return null
}
