import Link from 'next/link'
import { redirect } from 'next/navigation'
import { loadSpending } from '@/src/spending/load'
import { isUncategorized, payeeLabel } from '@/src/spending/proposals'
import { findTransferCounterparts } from '@/src/spending/review'
import { fmtAmount, fmtDay } from '@/src/dashboards/compute/today'
import type { MirrorRecord } from '@/src/dashboards/mirror'
import { acceptAll, acceptRecord, approveBudgetProposal, approveProposal, rejectBudgetProposal, rejectProposal } from './actions'
import type { BudgetStatus } from '@/src/dashboards/compute/budgets'
import { cn } from '@/lib/utils'
import { ActionForm, CategoryChip, TransferButton, type CategoryGroup } from './ui'

const AI_MESSAGE: Record<string, string> = {
  unavailable: 'AI proposals are not available yet.',
  invalid: 'The AI reply was not usable. Try again.',
  none: 'No new rules to propose.',
}

const BUDGET_AI_MESSAGE: Record<string, string> = {
  unavailable: 'The AI is not reachable right now. Try again later.',
  invalid: 'The AI reply was not usable. Try again.',
  none: 'The AI found no budget limit to change.',
}
const NOTE_MESSAGE: Record<string, string> = {
  unavailable: 'The AI is not reachable right now, so no note was written. Try again later.',
  flagged: 'The note has numbers that do not match your data, so it is marked and was not sent.',
}

const shortDay = (iso: string) => fmtDay(iso).replace(` ${new Date().getUTCFullYear()}`, '')
const money = (r: MirrorRecord) =>
  `${r.recordType === 1 ? '−' : '+'}${(r.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function SpendingPage({ searchParams }: { searchParams: Promise<{ ai?: string; budgetAi?: string; note?: string }> }) {
  const d = await loadSpending()
  if (!d) redirect('/setup')
  const { ai, budgetAi, note } = await searchParams
  const s = d.snapshot
  const categoryName = (id?: string) => (id && s.byCategoryId.get(id)?.name) || 'Uncategorized'
  const groups: CategoryGroup[] = Object.entries(Object.groupBy(
    s.categories.filter(c => c.envelopeId !== 20001).sort((a, b) => a.name.localeCompare(b.name)),
    c => c.groupName,
  )).sort(([a], [b]) => a.localeCompare(b)).map(([group, cs]) => ({ group, options: (cs ?? []).map(c => ({ id: c.id, name: c.name })) }))
  const maxCategory = d.topCategories[0]?.expense ?? 1
  const accountName = (id: string) => s.byAccountId.get(id)?.name ?? 'Unknown account'
  const openAccounts = s.accounts.filter(a => !a.archived).sort((a, b) => a.name.localeCompare(b.name)).map(a => ({ id: a.id, name: a.name }))

  return (
    <main className="mx-auto max-w-xl px-4">
      <div className="mt-1 mb-2 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Spending</h1>
        <Link href="/dashboard/spending" className="text-[13px] text-primary">Charts ›</Link>
      </div>

      {d.outflows.map(o => (
        <div key={o.provider} className="my-2 rounded-[14px] border border-down/40 bg-down/10 px-3.5 py-3">
          <div className="font-semibold">{fmtAmount(o.total, d.base)} went to {o.provider} since {shortDay(o.since)}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            {o.records.length} payment{o.records.length > 1 ? 's' : ''}: {o.records.map(r => shortDay(r.recordDate)).join(', ')}.{' '}
            {o.provider} sync {o.staleSince ? `is stale since ${fmtDay(o.staleSince)}` : 'never ran'}, so Wallet cannot see how this money was spent.
          </div>
        </div>
      ))}

      {d.spikes.map(c => (
        <div key={c.key} className="my-2 rounded-[14px] border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[13px]">
          <b>{c.name}</b> is at {fmtAmount(c.spent, d.base)} this month, against {fmtAmount(c.average, d.base)} in an average month.
        </div>
      ))}

      <Section id="budgets" title={`Budgets${d.budgets.length ? ` · ${monthName(d.today)}` : ''}`} />
      {d.budgets.length === 0 && <p className="text-sm text-muted-foreground">No monthly budgets in Wallet.</p>}
      {d.budgets.length > 0 && (
        <div className="rounded-[14px] border bg-card px-3.5 py-1">
          {d.budgets.map(b => <BudgetBar key={b.id} b={b} />)}
        </div>
      )}
      {budgetAi && BUDGET_AI_MESSAGE[budgetAi] && <p className="mt-2 text-sm text-warn">{BUDGET_AI_MESSAGE[budgetAi]}</p>}
      {d.budgetProposals.map(p => (
        <div key={p.id} className="my-2 rounded-[14px] border bg-card px-3.5 py-3">
          <div className="font-semibold">
            {p.budget.name}: {fmtAmount(p.currentLimit / 100, p.budget.currency)} <span className="text-muted-foreground">→</span> {fmtAmount(p.limit / 100, p.budget.currency)}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{p.reason}</div>
          <ActionForm action={approveBudgetProposal} className="mt-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={p.id} />
            <label className="flex items-center gap-1.5 text-[13px]">
              Limit
              <input
                name="limit" type="number" inputMode="decimal" min="1" step="1" defaultValue={p.limit / 100}
                className="w-24 rounded-lg border bg-background px-2 py-1 text-right tabular-nums"
              />
              <span className="text-muted-foreground">{p.budget.currency}/month</span>
            </label>
            <div className="flex gap-2">
              <button className="rounded-[10px] bg-primary px-3 py-1.5 text-[13px] font-bold text-primary-foreground">Approve</button>
              <button formAction={rejectBudgetProposal} className="rounded-[10px] border border-primary/40 px-3 py-1.5 text-[13px] font-bold text-primary">Reject</button>
            </div>
          </ActionForm>
        </div>
      ))}
      {d.budgets.length > 0 && (
        <form method="post" action="/api/spending/budget-proposals" encType="multipart/form-data" className="mt-2">
          <button className="rounded-[10px] border border-primary/40 px-3 py-1.5 text-[13px] font-bold text-primary">Suggest limits</button>
        </form>
      )}

      <Section id="note" title="Weekly note" />
      {note && NOTE_MESSAGE[note] && <p className="mb-2 text-sm text-warn">{NOTE_MESSAGE[note]}</p>}
      {d.notes.length === 0 && <p className="text-sm text-muted-foreground">The first note comes on Monday morning.</p>}
      {d.notes.slice(0, 1).map(n => (
        <div key={n.id} className="rounded-[14px] border bg-card px-3.5 py-3">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
            <span>Week of {shortDay(n.week)}</span>
            {n.status === 'flagged' && <span className="text-warn" title={n.problem ?? undefined}>Numbers not checked ⚠</span>}
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed">{n.text}</p>
        </div>
      ))}
      {d.notes.length > 1 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-[13px] text-primary">Earlier notes</summary>
          {d.notes.slice(1).map(n => (
            <div key={n.id} className="mt-2 border-l-2 pl-3">
              <div className="text-xs text-muted-foreground">Week of {shortDay(n.week)}{n.status === 'flagged' && ' · numbers not checked ⚠'}</div>
              <p className="whitespace-pre-line text-[13px] leading-relaxed">{n.text}</p>
            </div>
          ))}
        </details>
      )}
      <form method="post" action="/api/insights/weekly" encType="multipart/form-data" className="mt-2">
        <button className="rounded-[10px] border border-primary/40 px-3 py-1.5 text-[13px] font-bold text-primary">Write now</button>
      </form>

      <Section title={`This month · ${fmtAmount(d.monthExpense, d.base)}`} />
      {d.topCategories.length === 0 && <p className="text-sm text-muted-foreground">No spending this month yet.</p>}
      {d.topCategories.map(c => (
        <div key={c.key} className="my-1.5 flex items-center gap-2 text-[13px]">
          <span className="w-28 shrink-0 truncate">{c.name}</span>
          <span className="h-2 rounded bg-primary" style={{ width: `${Math.max(2, (c.expense / maxCategory) * 100) * 0.55}%` }} />
          <span className="ml-auto shrink-0 tabular-nums">{Math.round(c.expense).toLocaleString('en-US')}</span>
        </div>
      ))}

      <Section title={`To review · ${d.queue.items.length}`} />
      {d.queue.items.length === 0 && <p className="text-sm text-muted-foreground">All caught up.</p>}
      {d.queue.items.map(r => (
        <div key={r.id} className="flex items-center gap-2.5 border-b py-2.5 last:border-none">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{payeeLabel(r) || '(no note)'}</div>
            <div className="truncate text-xs text-muted-foreground">
              {shortDay(r.recordDate)} · {accountName(r.accountId)}
            </div>
            <div className="flex items-start gap-1.5">
              <CategoryChip
                recordId={r.id} categoryId={r.categoryId} label={categoryName(r.categoryId)}
                unknown={isUncategorized(r, s.byCategoryId)} groups={groups}
              />
              <TransferButton
                recordId={r.id} incoming={r.recordType === 0}
                summary={`${payeeLabel(r) || '(no note)'} · ${money(r)} ${r.currencyCode} · ${accountName(r.accountId)} · ${shortDay(r.recordDate)}`}
                candidates={findTransferCounterparts(r, s.records).map(c => ({
                  id: c.id, account: accountName(c.accountId), date: shortDay(c.recordDate),
                  amount: `${money(c)} ${c.currencyCode}`, payee: payeeLabel(c),
                }))}
                accounts={openAccounts.filter(a => a.id !== r.accountId)}
              />
            </div>
          </div>
          <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
            {money(r)} <span className="text-xs font-normal text-muted-foreground">{r.currencyCode}</span>
          </div>
          <form action={acceptRecord}>
            <input type="hidden" name="id" value={r.id} />
            <button aria-label="Accept" className="rounded-[9px] bg-up px-2.5 py-1 text-xs font-bold text-background">✓</button>
          </form>
        </div>
      ))}
      {d.queue.items.length > 1 && (
        <form action={acceptAll} className="mt-3 text-center">
          <input type="hidden" name="upTo" value={d.queue.upTo} />
          <button className="rounded-[10px] bg-primary px-3 py-1.5 text-[13px] font-bold text-primary-foreground">
            Accept all {d.queue.items.length}
          </button>
        </form>
      )}

      <Section id="rules" title={`Rules · ${s.rules.length}`} />
      <div className="rounded-[14px] border bg-card px-3.5 py-1">
        {s.rules.length === 0 && <p className="py-2.5 text-sm text-muted-foreground">No rules in Wallet yet.</p>}
        {s.rules.map(r => (
          <div key={r.id} className="flex items-center gap-2.5 border-b py-2.5 text-sm last:border-none">
            <span className="min-w-0 flex-1 truncate" title={r.keywords.join(', ')}>{r.name || r.keywords[0]}</span>
            <span className="text-muted-foreground">→</span>
            <b className="shrink-0">{categoryName(r.categoryId)}</b>
          </div>
        ))}
      </div>

      <Section title={`Proposed rules${d.proposals.length ? ` · ${d.proposals.length}` : ''}`} />
      {ai && AI_MESSAGE[ai] && <p className="mb-2 text-sm text-warn">{AI_MESSAGE[ai]}</p>}
      {d.proposals.map(p => (
        <div key={p.id} className="my-2 rounded-[14px] border bg-card px-3.5 py-3">
          <div className="font-semibold">{p.name} <span className="text-muted-foreground">→</span> {categoryName(p.categoryId)}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">Keywords: {p.keywords.join(', ')}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Matches {p.pastMatchCount} past record{p.pastMatchCount === 1 ? '' : 's'}; {p.toChange.length} get the new category.
          </div>
          <ActionForm action={approveProposal} className="mt-2">
            <input type="hidden" name="id" value={p.id} />
            {p.toChange.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border px-2.5">
                {p.toChange.map(r => (
                  <label key={r.id} className="flex items-center gap-2 border-b py-1.5 text-[13px] last:border-none">
                    <input type="checkbox" name="recordId" value={r.id} defaultChecked className="size-4 shrink-0 accent-primary" />
                    <span className="min-w-0 flex-1 truncate">{payeeLabel(r)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{shortDay(r.recordDate)}</span>
                    <span className="shrink-0 tabular-nums">{money(r)}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-2.5 flex gap-2">
              <button className="rounded-[10px] bg-primary px-3 py-1.5 text-[13px] font-bold text-primary-foreground">Approve</button>
              <button formAction={rejectProposal} className="rounded-[10px] border border-primary/40 px-3 py-1.5 text-[13px] font-bold text-primary">Reject</button>
            </div>
          </ActionForm>
        </div>
      ))}
      <form method="post" action="/api/spending/proposals" encType="multipart/form-data" className="mt-2">
        <button className="rounded-[10px] border border-primary/40 px-3 py-1.5 text-[13px] font-bold text-primary">Suggest rules</button>
      </form>
    </main>
  )
}

function Section({ title, id }: { title: string; id?: string }) {
  return (
    <h3 id={id} className="mt-6 mb-2 scroll-mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
  )
}

const monthName = (day: string) =>
  new Date(day.slice(0, 7) + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })

function BudgetBar({ b }: { b: BudgetStatus }) {
  const spent = b.spent ?? 0
  const tone = b.state === 'over' ? 'bg-down' : b.state === 'pace' ? 'bg-warn' : 'bg-primary'
  const line = b.spent === null ? 'No exchange rate for some records'
    : b.state === 'over' ? `Over by ${fmtAmount(spent - b.limit, b.currency)}`
    : b.state === 'pace' ? `On pace for ${fmtAmount(b.projected ?? 0, b.currency)}`
    : `${fmtAmount(b.limit - spent, b.currency)} left`
  return (
    <div className="border-b py-2.5 last:border-none">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-semibold">{b.name}</span>
        <span className="shrink-0 tabular-nums">
          {Math.round(spent).toLocaleString('en-US')} <span className="text-muted-foreground">/ {fmtAmount(b.limit, b.currency)}</span>
        </span>
      </div>
      <div className="relative my-1.5 h-[7px] overflow-hidden rounded bg-border">
        <b className={cn('absolute inset-y-0 left-0 rounded', tone)} style={{ width: `${Math.min(100, (spent / b.limit) * 100)}%` }} />
      </div>
      <div className={cn('text-xs', b.state === 'over' ? 'text-down' : b.state === 'pace' ? 'text-warn' : 'text-muted-foreground')}>{line}</div>
    </div>
  )
}
