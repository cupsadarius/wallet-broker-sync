'use client'

import { useState, useTransition } from 'react'
import { FAMILIES, MODES, parsePref, toPref, type Mode } from '@/src/theme/themes'
import { applyPref } from '@/src/theme/apply'
import { saveTheme } from '@/app/theme/actions'
import { cn } from '@/lib/utils'

/** Mode (Auto / Light / Dark) and theme family. A choice shows at once and saves on the server. */
export default function Appearance({ pref: saved }: { pref: string }) {
  const [pref, setPref] = useState(saved)
  const [, startTransition] = useTransition()
  const { family, mode } = parsePref(pref)
  const pick = (next: string) => {
    setPref(next)
    applyPref(next)
    const form = new FormData()
    form.set('pref', next)
    startTransition(() => saveTheme(form))
  }
  return (
    <section aria-labelledby="appearance" className="flex flex-col gap-6">
      <div>
        <h2 id="appearance" className="text-xl font-semibold">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">Changes show at once and apply on all your devices.</p>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="text-sm font-semibold">Mode</div>
        <div role="radiogroup" aria-label="Mode" className="flex w-fit gap-1 rounded-[0.625rem] border bg-card p-[0.1875rem] text-sm">
          {MODES.map(m => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id}
              onClick={() => pick(toPref(family.id, m.id as Mode))}
              className={cn('min-h-9 rounded-[0.4375rem] px-4 text-muted-foreground', mode === m.id && 'bg-secondary font-semibold text-foreground')}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[0.8125rem] text-muted-foreground">
          {mode === 'system' ? 'Auto follows your device.' : `Always ${mode}.`}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="text-sm font-semibold">Theme</div>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
          {FAMILIES.map(f => {
            const on = f.id === family.id
            return (
              <button key={f.id} type="button" role="radio" aria-checked={on} onClick={() => pick(toPref(f.id, mode))}
                className={cn('rounded-xl border-2 bg-card p-2 text-left', on ? 'border-primary' : 'border-border')}>
                <span aria-hidden className="grid h-20 grid-cols-2 overflow-hidden rounded-[0.5625rem] border">
                  {[f.light, f.dark].map(id => (
                    <span key={id} data-theme={id} className="flex flex-col justify-end gap-2 bg-[var(--c-bg)] p-3">
                      <span className="h-3.5 rounded bg-[var(--c-surface)]" />
                      <span className="h-1.5 w-2/5 rounded-sm bg-[var(--c-accent)]" />
                    </span>
                  ))}
                </span>
                <span className="flex items-center justify-between px-1 pt-2.5 pb-0.5 text-sm font-medium">
                  {f.label}
                  {on && <span className="text-xs font-semibold text-primary">In use</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
