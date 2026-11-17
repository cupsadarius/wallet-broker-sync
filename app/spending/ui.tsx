'use client'

import { useActionState } from 'react'
import { cn } from '@/lib/utils'
import { changeCategory, type ActionState } from './actions'

export type CategoryGroup = { group: string; options: { id: string; name: string }[] }

/** The category chip is a native select: picking a category writes it to Wallet at once. */
export function CategoryChip({ recordId, categoryId, label, unknown, groups }: {
  recordId: string; categoryId?: string; label: string; unknown: boolean; groups: CategoryGroup[]
}) {
  const [state, action, pending] = useActionState(changeCategory, null)
  return (
    <form action={action} key={categoryId} className="mt-1">
      <input type="hidden" name="recordId" value={recordId} />
      <select
        name="categoryId"
        aria-label={`Category: ${label}`}
        defaultValue={categoryId ?? ''}
        disabled={pending}
        onChange={e => e.currentTarget.form?.requestSubmit()}
        className={cn(
          'field-sizing-content max-w-full appearance-none truncate rounded-[10px] border px-2 py-0.5 text-xs',
          unknown ? 'border-warn/40 bg-warn/10 text-warn' : 'border-primary/40 bg-primary/10 text-primary',
          pending && 'opacity-60',
        )}
      >
        {!categoryId && <option value="">{label}</option>}
        {groups.map(g => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </optgroup>
        ))}
      </select>
      {state?.error && <p role="alert" className="mt-1 text-xs text-down">{state.error}</p>}
    </form>
  )
}

/** A form for an action that can fail, with the error shown under it. */
export function ActionForm({ action, className, children }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>; className?: string; children: React.ReactNode
}) {
  const [state, formAction, pending] = useActionState(action, null)
  return (
    <form action={formAction} className={cn(className, pending && 'opacity-60')}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      {state?.error && <p role="alert" className="mt-2 text-xs text-down">{state.error}</p>}
    </form>
  )
}
