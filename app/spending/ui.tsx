'use client'

import { startTransition, useActionState, useState } from 'react'
import { ArrowLeftRight, Check, ChevronDown, ChevronLeft, ChevronRight, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { envelopeGroupName } from '@/src/dashboards/envelopes'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { changeCategory, markAsTransfer, removeRule, type ActionState } from './actions'

export type CategoryGroup = { group: string; options: { id: string; name: string }[] }

const INCOME = envelopeGroupName(10000)
const HIDDEN = new Set([envelopeGroupName(13000), envelopeGroupName(20000)])
type CategoryItem = { id: string; name: string; group: string }
const matches = (c: CategoryItem, q: string) => `${c.name} ${c.group}`.toLowerCase().includes(q.trim().toLowerCase())

/** The category chip opens groups, then their categories, with search across all; a pick writes to Wallet at once. */
export function CategoryChip({ recordId, categoryId, label, unknown, income, groups }: {
  recordId: string; categoryId?: string; label: string; unknown: boolean; income: boolean; groups: CategoryGroup[]
}) {
  const [state, action, pending] = useActionState(changeCategory, null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const shown = groups.filter(g => !HIDDEN.has(g.group) && (g.group === INCOME) === income)
  const [group, setGroup] = useState<string | null>(null)
  const current = group ?? (shown.length === 1 ? shown[0].group : null)
  const hits = query.trim() ? shown.flatMap(g => g.options.map(o => ({ ...o, group: g.group }))).filter(c => matches(c, query)) : null
  const onOpenChange = (next: boolean) => { setOpen(next); setQuery(''); setGroup(null) }
  const pick = (id: string) => {
    onOpenChange(false)
    if (id === categoryId) return
    const form = new FormData()
    form.set('recordId', recordId)
    form.set('categoryId', id)
    startTransition(() => action(form))
  }
  const row = 'flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent'
  const option = (c: { id: string; name: string; group?: string }) => (
    <button key={c.id} type="button" onClick={() => pick(c.id)} className={row}>
      <span className="min-w-0 flex-1 truncate">{c.name}{c.group && <span className="text-muted-foreground"> · {c.group}</span>}</span>
      {c.id === categoryId && !unknown && <Check aria-hidden className="size-4 shrink-0 text-primary" />}
    </button>
  )
  return (
    <div className="mt-1">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger aria-label={`Category: ${label}`} disabled={pending} className={cn(
          'inline-flex max-w-full items-center gap-1 truncate rounded-[10px] border px-2 py-0.5 text-xs',
          unknown ? 'border-warn/40 bg-warn/10 text-warn' : 'border-primary/40 bg-primary/10 text-primary',
          pending && 'opacity-60',
        )}>
          {label}<ChevronDown aria-hidden className="size-3 shrink-0" />
        </DialogTrigger>
        <DialogContent className="flex max-h-[85dvh] flex-col gap-3 top-auto bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))] translate-y-0 rounded-b-none sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-b-xl">
          <div className="flex min-h-8 items-center gap-1 pr-8">
            {!hits && current && shown.length > 1 && (
              <button type="button" aria-label="All groups" onClick={() => setGroup(null)} className="-ml-1.5 grid size-8 place-items-center rounded-lg hover:bg-accent">
                <ChevronLeft aria-hidden className="size-4" />
              </button>
            )}
            <DialogTitle>{hits ? 'Search' : current ?? 'Category'}</DialogTitle>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3">
            <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search categories"
              aria-label="Search categories"
              onKeyDown={e => { if (e.key === 'Enter' && hits?.[0]) { e.preventDefault(); pick(hits[0].id) } }}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {hits ? (
              hits.length ? hits.map(option) : <p className="px-2.5 py-3 text-sm text-muted-foreground">No category matches.</p>
            ) : current ? (
              shown.find(g => g.group === current)?.options.map(option)
            ) : shown.map(g => (
              <button key={g.group} type="button" onClick={() => setGroup(g.group)} className={row}>
                <span className="min-w-0 flex-1 truncate">{g.group}</span>
                <span className="text-xs text-muted-foreground">{g.options.length}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {state?.error && <p role="alert" className="mt-1 text-xs text-down">{state.error}</p>}
    </div>
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
