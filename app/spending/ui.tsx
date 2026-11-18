'use client'

import { useActionState } from 'react'
import { ArrowLeftRight, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { changeCategory, markAsTransfer, removeRule, type ActionState } from './actions'

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

export type TransferCandidate = { id: string; account: string; date: string; amount: string; payee: string }

/** Opens a sheet to link the record with its other leg, or with an account when Wallet has no other leg. */
export function TransferButton({ recordId, summary, incoming, candidates, accounts }: {
  recordId: string; summary: string; incoming: boolean; candidates: TransferCandidate[]; accounts: { id: string; name: string }[]
}) {
  return (
    <Dialog>
      <DialogTrigger aria-label="Mark as transfer" className="mt-1 rounded-[10px] border border-primary/40 px-1.5 py-0.5 text-primary">
        <ArrowLeftRight className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="grid-cols-[minmax(0,1fr)] top-auto bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[85dvh] translate-y-0 overflow-y-auto rounded-b-none sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-b-xl">
        <DialogTitle>Mark as transfer</DialogTitle>
        <DialogDescription>{summary}</DialogDescription>
        {candidates.length === 0 && <p className="text-[13px] text-muted-foreground">No record in your other accounts matches this amount within 4 days.</p>}
        {candidates.length > 0 && (
          <ActionForm action={markAsTransfer} className="-my-1">
            <input type="hidden" name="recordId" value={recordId} />
            {candidates.map(c => (
              <div key={c.id} className="flex items-center gap-2 border-b py-2 last:border-none">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{c.account} <span className="font-normal tabular-nums">{c.amount}</span></div>
                  <div className="truncate text-xs text-muted-foreground">{c.date} · {c.payee || '(no note)'}</div>
                </div>
                <button name="counterpartId" value={c.id} className="shrink-0 rounded-[10px] bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground">
                  Link as transfer
                </button>
              </div>
            ))}
          </ActionForm>
        )}
        <ActionForm action={markAsTransfer} className="border-t pt-3">
          <input type="hidden" name="recordId" value={recordId} />
          <label className="block text-[13px] text-muted-foreground">No match: transfer {incoming ? 'from' : 'to'}</label>
          <div className="mt-1.5 flex gap-2">
            <select name="accountId" required defaultValue="" aria-label={`Transfer ${incoming ? 'from' : 'to'} account`}
              className="min-w-0 flex-1 rounded-lg border bg-background px-2 py-1.5 text-[13px]">
              <option value="" disabled>Account</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="shrink-0 rounded-[10px] border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary">Mark</button>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}

/** Deleting reaches every Wallet device, so it asks first. */
export function DeleteRuleButton({ id, label }: { id: string; label: string }) {
  return (
    <Dialog>
      <DialogTrigger aria-label={`Delete rule ${label}`} className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-down">
        <Trash2 className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>Delete rule</DialogTitle>
        <DialogDescription>
          Wallet stops applying &ldquo;{label}&rdquo; to new records. Past records keep their category.
        </DialogDescription>
        <ActionForm action={removeRule}>
          <input type="hidden" name="id" value={id} />
          <button className="rounded-[10px] bg-down px-3 py-1.5 text-[13px] font-bold text-white">Delete rule</button>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}
