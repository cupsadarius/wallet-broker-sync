import Link from 'next/link'
import { redirect } from 'next/navigation'
import { loadSpending } from '@/src/spending/load'
import { isUncategorized, payeeLabel } from '@/src/spending/proposals'
import { findTransferCounterparts, pairKey } from '@/src/spending/review'
import { fmtAmount, fmtDay } from '@/src/dashboards/compute/today'
import type { MirrorRecord } from '@/src/dashboards/mirror'
import { keptShare, overBudgetMonths, type CategoryRecord, type CategorySlice } from '@/src/dashboards/compute/spending'
import type { BudgetStatus } from '@/src/dashboards/compute/budgets'
import { cn } from '@/lib/utils'
import Page from '@/app/ui/Page'
import PageHeader from '@/app/ui/PageHeader'
import Segmented from '@/app/ui/Segmented'
import Banner from '@/app/ui/Banner'
import Hero from '@/app/ui/Hero'
import ListDetail from '@/app/ui/ListDetail'
import Bars from '@/app/ui/Bars'
import { whole } from '@/app/ui/chartFormat'
import { pickSelected } from '@/app/ui/select'
import { acceptAll, acceptRecord, approveBudgetProposal, approveProposal, dismissTransfer, markAsTransfer, rejectBudgetProposal, rejectProposal } from './actions'
import { ActionForm, CategoryChip, DeleteRuleButton, TransferButton, type CategoryGroup } from './ui'
import ReviewSheet from './ReviewSheet'

const MESSAGES: Record<string, Record<string, string>> = {
  ai: {
    unavailable: 'AI proposals are not available yet.',
    invalid: 'The AI reply was not usable. Try again.',
    none: 'No new rules to propose.',
  },
  budgetAi: {
    unavailable: 'The AI is not reachable right now. Try again later.',
    invalid: 'The AI reply was not usable. Try again.',
    none: 'The AI found no budget limit to change.',
  },
  note: {
    unavailable: 'The AI is not reachable right now, so no note was written. Try again later.',
    flagged: 'The note has numbers that do not match your data, so it is marked and was not sent.',
  },
}
const PERIODS = [{ months: 1, label: 'This month' }, { months: 6, label: '6 months' }, { months: 12, label: '12 months' }, { months: 24, label: '2 years' }]
const REVIEW = [{ id: 'rules', label: 'Rules' }, { id: 'records', label: 'Records' }, { id: 'transfers', label: 'Transfers' }]

type Q = { ai?: string; budgetAi?: string; note?: string; months?: string; category?: string; mode?: string; review?: string }
type Data = NonNullable<Awaited<ReturnType<typeof loadSpending>>>
type Mode = 'expense' | 'income'
type Row = CategorySlice & { id: string }

/** A Spending link that keeps the period, category and mode, with `change` applied. */
const link = (q: Q, change: Partial<Q>) => {
  const next = { months: q.months, category: q.category, mode: q.mode, ...change }
  const params = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => !!e[1]))
  return `/spending${params.size ? `?${params}` : ''}`
}
const shortDay = (iso: string) => fmtDay(iso).replace(` ${new Date().getUTCFullYear()}`, '')
const monthShort = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
const monthLong = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
const money = (r: MirrorRecord) =>
  `${r.recordType === 1 ? '−' : '+'}${(r.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const inMode = (mode: Mode) => (r: CategoryRecord) => mode === 'expense' ? r.amountBase < 0 : r.amountBase > 0
const BUTTON = 'min-h-9 rounded-lg px-3 text-[13px] font-semibold'
const PRIMARY = cn(BUTTON, 'bg-primary text-primary-foreground')
const SECONDARY = cn(BUTTON, 'border border-line-2 text-foreground')

export default async function SpendingPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams
  const period = PERIODS.find(p => String(p.months) === q.months) ?? PERIODS[2]
  const d = await loadSpending(period.months)
  if (!d) redirect('/setup')
  const mode: Mode = q.mode === 'income' ? 'income' : 'expense'
  const rows: Row[] = d.period.byCategory.filter(c => c[mode] > 0).sort((a, b) => b[mode] - a[mode]).map(c => ({ ...c, id: c.key }))
  const { selected, fromParam } = pickSelected(rows, q.category)
  const message = (['ai', 'budgetAi', 'note'] as const).map(k => q[k] && MESSAGES[k][q[k]!]).find(Boolean)
  const label = period.label.toLowerCase()
  return (
    <Page>
      <PageHeader title="Spending" right={
        <Segmented label="Period" value={String(period.months)} options={PERIODS.map(p => ({ value: String(p.months), label: p.label, href: link(q, { months: String(p.months) }) }))} />
      } />
      {message && <p role="status" className="text-sm text-warn">{message}</p>}
      <Alerts d={d} q={q} />
      {d.period.monthly.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing was spent or earned in this period. Pick a longer period.</p>
      ) : (
        <>
          <div className={cn(fromParam && 'max-lg:hidden')}><SpendingHero d={d} label={label} /></div>
          <ListDetail open={fromParam} backHref={link(q, { category: undefined })} backLabel="Spending" listWidth="lg:grid-cols-[420px_minmax(0,1fr)]"
            list={<CategoryList rows={rows} d={d} q={q} mode={mode} selected={selected?.id} />}
            detail={selected && <CategoryDetail c={selected} d={d} q={q} mode={mode} label={label} total={rows.reduce((n, r) => n + r[mode], 0)} />} />
        </>
      )}
      {q.review && (
        <ReviewSheet active={q.review} closeHref={link(q, {})}
          tabs={REVIEW.map(t => ({ ...t, href: link(q, { review: t.id }) }))}>
          {q.review === 'records' ? <RecordsTab d={d} /> : q.review === 'transfers' ? <TransfersTab d={d} /> : <RulesTab d={d} />}
        </ReviewSheet>
      )}
    </Page>
  )
}

function Alerts({ d, q }: { d: Data; q: Q }) {
  const n = d.uncategorized.size, rules = d.proposals.length
  const review = n > 0 || rules > 0
    ? { text: `${n > 0 ? `${n} ${n === 1 ? 'record has' : 'records have'} no category.` : ''}${rules > 0 ? ` ${rules} new ${rules === 1 ? 'rule' : 'rules'} can sort ${d.sortable} of them.` : ''}`, label: 'Review rules', tab: 'rules' }
    : d.queue.items.length > 0 ? { text: `${d.queue.items.length} new records to check.`, label: 'Review', tab: 'records' }
    : d.transfers.length > 0 ? { text: `${d.transfers.length} records look like transfers.`, label: 'Review', tab: 'transfers' }
    : null
  if (!review && d.outflows.length === 0 && d.spikes.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {review && <Banner action={{ label: review.label, href: link(q, { review: review.tab }) }}>{review.text.trim()}</Banner>}
      {d.outflows.map(o => (
        <Banner key={o.provider}>
          {fmtAmount(o.total, d.base)} went to {o.provider} since {shortDay(o.since)} in {o.records.length} {o.records.length === 1 ? 'payment' : 'payments'}.{' '}
          {o.provider} sync {o.staleSince ? `is stale since ${fmtDay(o.staleSince)}` : 'never ran'}, so Wallet cannot see how this money was spent.
        </Banner>
      ))}
      {d.spikes.map(c => (
        <Banner key={c.key} action={{ label: 'Open', href: link(q, { category: c.key, mode: undefined }) }}>
          {c.name} is at {fmtAmount(c.spent, d.base)} this month, against {fmtAmount(c.average, d.base)} in an average month.
        </Banner>
      ))}
    </div>
  )
}

function SpendingHero({ d, label }: { d: Data; label: string }) {
  const t = d.period.totals
  const n = Math.max(1, d.period.monthsCovered)
  const kept = keptShare(t.income, t.expense)
  return (
    <Hero label="Spent a month, on average" value={whole(t.expense / n)} unit={d.base}
      subTone={kept === null ? 'muted' : kept >= 0 ? 'good' : 'bad'}
      sub={<>
        {kept === null ? 'No income in this period' : kept >= 0 ? `You kept ${Math.round(kept * 100)}% of your income` : `You spent ${Math.round(-kept * 100)}% more than you earned`}
        <WeeklyNote d={d} />
      </>}
      stats={[
        { label: 'Income a month', value: whole(t.income / n) },
        { label: 'Kept a month', value: `${t.income >= t.expense ? '' : '−'}${whole(Math.abs(t.income - t.expense) / n)}`, tone: t.income >= t.expense ? undefined : 'bad' },
        { label: `Spent, ${label}`, value: whole(t.expense) },
      ]}
      chart={
        <div className="flex flex-col gap-2">
          <div aria-hidden className="flex gap-4 text-xs text-fg-2">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-line-2" />Income</span>
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm bg-primary" />Spent</span>
          </div>
          <Bars data={d.period.monthly.map(m => ({ label: monthShort(m.yearMonth), value: m.expense, back: m.income }))}
            unit={d.base} height={230} label="Income and spending each month" valueName="Spent" backName="Income" />
        </div>
      } />
  )
}

/** The latest weekly note as one line; it opens to the full text, earlier notes and "Write now". */
function WeeklyNote({ d }: { d: Data }) {
  const [latest, ...earlier] = d.notes
  return (
    <details className="mt-1.5 text-[13px] font-normal text-muted-foreground">
      <summary className="line-clamp-1 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {latest ? <>Week of {shortDay(latest.week)}: {latest.text.split('\n')[0]}</> : 'The first weekly note comes on Monday morning.'}
      </summary>
      <div className="mt-2 flex flex-col gap-3 text-foreground">
        {latest && <p className="whitespace-pre-line leading-relaxed">{latest.text}</p>}
        {latest?.status === 'flagged' && <p className="text-warn" title={latest.problem ?? undefined}>The numbers in this note are not checked.</p>}
        {earlier.map(n => (
          <div key={n.id} className="border-l-2 pl-3">
            <div className="text-muted-foreground">Week of {shortDay(n.week)}{n.status === 'flagged' && ', numbers not checked'}</div>
            <p className="whitespace-pre-line leading-relaxed">{n.text}</p>
          </div>
        ))}
        <form method="post" action="/api/insights/weekly" encType="multipart/form-data">
          <button className={SECONDARY}>Write now</button>
        </form>
      </div>
    </details>
  )
}

function budgetNote(b: BudgetStatus) {
  if (b.spent === null) return null
  return b.state === 'over'
    ? <span className="text-warn">{Math.round((b.spent / b.limit - 1) * 100)}% over budget</span>
    : <span className="text-muted-foreground">on budget</span>
}

function CategoryList({ rows, d, q, mode, selected }: { rows: Row[]; d: Data; q: Q; mode: Mode; selected?: string }) {
  const n = Math.max(1, d.period.monthsCovered)
  const max = rows[0]?.[mode] ?? 1
  return (
    <section aria-labelledby="where" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id="where" className="text-lg font-semibold">Where it goes</h2>
        <Segmented label="Show" value={mode} options={[
          { value: 'expense', label: 'Spent', href: link(q, { mode: undefined, category: undefined }) },
          { value: 'income', label: 'Income', href: link(q, { mode: 'income', category: undefined }) },
        ]} />
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing in this period.</p>}
      <ul className="flex flex-col gap-1">
        {rows.map(c => {
          const note = mode === 'expense' ? d.budgetsByCategory.get(c.key)?.rowNote : null
          return (
            <li key={c.key}>
              <Link href={link(q, { category: c.key })} scroll={false} aria-current={c.key === selected ? 'true' : undefined}
                className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-xl px-4 py-3 hover:bg-accent', c.key === selected && 'lg:bg-secondary')}>
                <b className="truncate">{c.name}</b>
                <b className="text-right">{whole(c[mode])}</b>
                <span className="truncate text-[13px] text-muted-foreground">{c.group}{note && <>, {budgetNote(note)}</>}</span>
                <span className="text-right text-[13px] text-muted-foreground">{whole(c[mode] / n)} a month</span>
                <span aria-hidden className="col-span-2 mt-1 h-1.5 rounded-full bg-fill">
                  <span className={cn('block h-full rounded-full', mode === 'expense' ? 'bg-primary' : 'bg-up')} style={{ width: `${Math.max(2, (c[mode] / max) * 100)}%` }} />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function BudgetLine({ b, d }: { b: BudgetStatus; d: Data }) {
  const history = (d.budgetHistory.get(b.id) ?? []).filter(h => h.spent !== null).map(h => ({ yearMonth: h.month, amount: h.spent! }))
  const { over, underCount } = overBudgetMonths(history, b.limit)
  const spent = b.spent ?? 0
  const now = b.spent === null ? 'No exchange rate for some records this month'
    : b.state === 'over' ? `Over by ${whole(spent - b.limit)} this month`
    : b.state === 'pace' ? `On pace for ${whole(b.projected ?? 0)} this month`
    : `${whole(b.limit - spent)} left this month`
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
      <span>
        <b>{b.name}</b> budget {whole(b.limit)} {b.currency} a month{b.categoryIds === null && ', all spending'}.{' '}
        <span className={cn(b.state === 'over' ? 'text-warn' : 'text-muted-foreground')}>{now}.</span>
      </span>
      {history.length > 0 && <b className={cn(over.length > underCount && 'text-warn')}>Under in {underCount} of {history.length} months</b>}
    </div>
  )
}

function CategoryDetail({ c, d, q, mode, label, total }: { c: Row; d: Data; q: Q; mode: Mode; label: string; total: number }) {
  const info = d.categories.get(c.key)
  const covering = mode === 'expense' ? d.budgetsByCategory.get(c.key)?.covering ?? [] : []
  const rowBudget = mode === 'expense' ? d.budgetsByCategory.get(c.key)?.rowNote ?? null : null
  const budgetProposals = d.budgetProposals.filter(p => covering.some(b => b.id === p.budget.id))
  const all = (d.period.records[c.key] ?? []).filter(inMode(mode))
  const latest = (info?.latest ?? []).filter(inMode(mode))
  const lastMonth = d.months.at(-1)!
  return (
    <article aria-label={c.name} className="flex flex-col gap-6 rounded-2xl border bg-card p-5 tabular-nums lg:p-6">
      <header>
        <h2 className="text-xl font-semibold">{c.name}</h2>
        <p className="text-[13px] text-muted-foreground">
          {c.group}. {whole(c[mode])} {d.base} in {label}, {total ? Math.round((c[mode] / total) * 100) : 0}% of what you {mode === 'expense' ? 'spent' : 'earned'}.
        </p>
      </header>
      {covering.length > 0 && (
        <div className="flex flex-col gap-3">
          {covering.map(b => <BudgetLine key={b.id} b={b} d={d} />)}
          {budgetProposals.map(p => (
            <ActionForm key={p.id} action={approveBudgetProposal} className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-4 py-3 text-[13px]">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="limit" value={p.limit / 100} />
              <span className="min-w-0 flex-1"><b>Suggested limit {whole(p.limit / 100)}</b> for {p.budget.name}, now {whole(p.currentLimit / 100)}. {p.reason}</span>
              <span className="flex gap-2">
                <button className={PRIMARY}>Apply</button>
                <button formAction={rejectBudgetProposal} className={SECONDARY}>Not this</button>
              </span>
            </ActionForm>
          ))}
          {budgetProposals.length === 0 && (
            <form method="post" action="/api/spending/budget-proposals" encType="multipart/form-data">
              <button className={SECONDARY}>Suggest limits</button>
            </form>
          )}
        </div>
      )}
      {info && (
        <Bars label={`${c.name} each month`} unit={d.base} height={170} valueName={mode === 'expense' ? 'Spent' : 'Income'}
          limit={rowBudget?.limit}
          data={info.monthly.map(m => {
            const value = Math.max(0, mode === 'expense' ? m.amount : -m.amount)
            return { label: monthShort(m.yearMonth), value, over: !!rowBudget && value > rowBudget.limit, highlight: m.yearMonth === lastMonth }
          })} />
      )}
      {mode === 'expense' && info?.proposals.map(p => (
        <ActionForm key={p.id} action={approveProposal} className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-[13px]">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="categoryId" value={p.categoryId} />
          {p.matches.map(r => <input key={r.id} type="hidden" name="recordId" value={r.id} />)}
          <span className="min-w-0 flex-1">
            <b>New rule:</b> notes with {p.keywords.map(k => <code key={k} className="mx-0.5 rounded bg-fill px-1.5 py-0.5">{k}</code>)} go to {c.name}.
            Sorts {p.matches.length} {p.matches.length === 1 ? 'record' : 'records'}.
          </span>
          <span className="flex gap-2">
            <button className={PRIMARY}>Add rule</button>
            <button formAction={rejectProposal} className={SECONDARY}>Not this</button>
          </span>
        </ActionForm>
      ))}
      <section aria-labelledby={`latest-${c.id}`} className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <h3 id={`latest-${c.id}`} className="font-semibold">{monthLong(lastMonth)}</h3>
          <span className="text-[13px] text-muted-foreground">{all.length} {all.length === 1 ? 'record' : 'records'} in {label}</span>
        </div>
        {latest.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing yet this month.</p>}
        <Records records={latest} />
        {all.length > latest.length && (
          <details>
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm text-primary [&::-webkit-details-marker]:hidden">All {all.length} records</summary>
            <Records records={all} />
          </details>
        )}
      </section>
      <footer className="flex flex-wrap items-center gap-2 border-t pt-4 text-[13px] text-muted-foreground">
        {info?.rules.length ? <>Rules that sort into {c.name}: {info.rules.map(r => (
          <span key={r.id} className="rounded-md bg-fill px-2 py-0.5 text-foreground" title={r.keywords.join(', ')}>{r.name || r.keywords[0]}</span>
        ))}</> : <>No rule sorts into {c.name} yet.</>}
        <Link href={link(q, { review: 'rules' })} scroll={false} className="ml-auto font-semibold text-primary">Manage rules</Link>
      </footer>
    </article>
  )
}

function Records({ records }: { records: CategoryRecord[] }) {
  return (
    <ul className="text-[13px] tabular-nums">
      {records.map(r => (
        <li key={r.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] gap-3 border-b py-2 last:border-0 sm:grid-cols-[4.5rem_minmax(0,1fr)_9rem_5.5rem]">
          <span className="text-muted-foreground">{shortDay(r.date)}</span>
          <span className="truncate">{r.note || '(no note)'}</span>
          <span className="hidden truncate text-muted-foreground sm:block">{r.accountName}</span>
          <span className="text-right">{whole(Math.abs(r.amountBase))}</span>
        </li>
      ))}
    </ul>
  )
}

function helpers(d: Data) {
  const s = d.snapshot
  const groups: CategoryGroup[] = Object.entries(Object.groupBy(
    s.categories.filter(c => c.envelopeId !== 20001).sort((a, b) => a.name.localeCompare(b.name)),
    c => c.groupName,
  )).sort(([a], [b]) => a.localeCompare(b)).map(([group, cs]) => ({ group, options: (cs ?? []).map(c => ({ id: c.id, name: c.name })) }))
  return {
    groups,
    categoryName: (id?: string) => (id && s.byCategoryId.get(id)?.name) || 'Uncategorized',
    accountName: (id: string) => s.byAccountId.get(id)?.name ?? 'Unknown account',
  }
}

function RulesTab({ d }: { d: Data }) {
  const { groups, categoryName, accountName } = helpers(d)
  const rules = d.snapshot.rules
  const loose = d.snapshot.records.filter(r => d.uncategorized.has(r.id)).sort((a, b) => b.recordDate.localeCompare(a.recordDate))
  return (
    <>
      {loose.length > 0 && (
        <>
          <h3 className="font-semibold">No category · {loose.length}</h3>
          <ul className="mb-3">
            {loose.map(r => (
              <li key={r.id} className="flex items-center gap-2.5 border-b py-2.5 last:border-none">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{payeeLabel(r) || '(no note)'}</div>
                  <div className="truncate text-xs text-muted-foreground">{shortDay(r.recordDate)} · {accountName(r.accountId)}</div>
                  <CategoryChip recordId={r.id} categoryId={r.categoryId} label={categoryName(r.categoryId)} unknown income={r.recordType === 0} groups={groups} />
                </div>
                <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
                  {money(r)} <span className="text-xs font-normal text-muted-foreground">{r.currencyCode}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="font-semibold">Proposed rules{d.proposals.length > 0 && ` · ${d.proposals.length}`}</h3>
      {d.proposals.length === 0 && <p className="text-sm text-muted-foreground">No proposed rules.</p>}
      {d.proposals.map(p => (
        <div key={p.id} className="rounded-xl border px-4 py-3">
          <div className="font-semibold">{p.name}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">Keywords: {p.keywords.join(', ')}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Matches {p.matches.length} past record{p.matches.length === 1 ? '' : 's'}; the ticked ones get the category.
          </div>
          <ActionForm action={approveProposal} className="mt-2">
            <input type="hidden" name="id" value={p.id} />
            <label className="mb-2 flex items-center gap-2 text-[13px] text-muted-foreground">
              Category
              <select name="categoryId" defaultValue={p.categoryId} className="min-h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm text-foreground">
                {groups.map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            {p.matches.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border px-2.5">
                {p.matches.map(r => (
                  <label key={r.id} className="grid grid-cols-[auto_minmax(0,1fr)_3.5rem_5.5rem] items-center gap-2 border-b py-1.5 text-[13px] tabular-nums last:border-none sm:grid-cols-[auto_minmax(0,1fr)_8rem_3.5rem_5.5rem]">
                    <input type="checkbox" name="recordId" value={r.id} defaultChecked className="size-4 shrink-0 accent-primary" />
                    <span className="truncate">{payeeLabel(r)}</span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:block">{categoryName(r.categoryId)}</span>
                    <span className="text-xs text-muted-foreground">{shortDay(r.recordDate)}</span>
                    <span className="text-right">{money(r)}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-2.5 flex gap-2">
              <button className={PRIMARY}>Approve</button>
              <button formAction={rejectProposal} className={SECONDARY}>Reject</button>
            </div>
          </ActionForm>
        </div>
      ))}
      <form method="post" action="/api/spending/proposals" encType="multipart/form-data">
        <button className={SECONDARY}>Suggest rules</button>
      </form>
      <h3 className="mt-3 font-semibold">Rules · {rules.length}</h3>
      {rules.length === 0 && <p className="text-sm text-muted-foreground">No rules in Wallet yet.</p>}
      <ul>
        {rules.map(r => (
          <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto_9rem_auto] items-center gap-2.5 border-b py-2.5 text-sm last:border-none">
            <span className="truncate" title={r.keywords.join(', ')}>{r.name || r.keywords[0]}</span>
            <span className="text-muted-foreground">→</span>
            <b className="truncate" title={categoryName(r.categoryId)}>{categoryName(r.categoryId)}</b>
            <DeleteRuleButton id={r.id} label={r.name || r.keywords[0]} />
          </li>
        ))}
      </ul>
    </>
  )
}

function RecordsTab({ d }: { d: Data }) {
  const s = d.snapshot
  const { groups, categoryName, accountName } = helpers(d)
  const openAccounts = s.accounts.filter(a => !a.archived).sort((a, b) => a.name.localeCompare(b.name)).map(a => ({ id: a.id, name: a.name }))
  if (d.queue.items.length === 0) return <p className="text-sm text-muted-foreground">All caught up.</p>
  return (
    <>
      <ul>
        {d.queue.items.map(r => (
          <li key={r.id} className="flex items-center gap-2.5 border-b py-2.5 last:border-none">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{payeeLabel(r) || '(no note)'}</div>
              <div className="truncate text-xs text-muted-foreground">{shortDay(r.recordDate)} · {accountName(r.accountId)}</div>
              <div className="flex items-start gap-1.5">
                <CategoryChip recordId={r.id} categoryId={r.categoryId} label={categoryName(r.categoryId)} income={r.recordType === 0}
                  unknown={isUncategorized(r, s.byCategoryId)} groups={groups} />
                <TransferButton
                  recordId={r.id} incoming={r.recordType === 0}
                  summary={`${payeeLabel(r) || '(no note)'} · ${money(r)} ${r.currencyCode} · ${accountName(r.accountId)} · ${shortDay(r.recordDate)}`}
                  candidates={findTransferCounterparts(r, s.records).map(c => ({
                    id: c.id, account: accountName(c.accountId), date: shortDay(c.recordDate),
                    amount: `${money(c)} ${c.currencyCode}`, payee: payeeLabel(c),
                  }))}
                  accounts={openAccounts.filter(a => a.id !== r.accountId)} />
              </div>
            </div>
            <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
              {money(r)} <span className="text-xs font-normal text-muted-foreground">{r.currencyCode}</span>
            </div>
            <form action={acceptRecord}>
              <input type="hidden" name="id" value={r.id} />
              <button aria-label="Accept" className="grid size-9 place-items-center rounded-lg bg-up text-sm font-bold text-background">✓</button>
            </form>
          </li>
        ))}
      </ul>
      {d.queue.items.length > 1 && (
        <form action={acceptAll}>
          <input type="hidden" name="upTo" value={d.queue.upTo} />
          <button className={PRIMARY}>Accept all {d.queue.items.length}</button>
        </form>
      )}
    </>
  )
}

function TransfersTab({ d }: { d: Data }) {
  const { accountName } = helpers(d)
  if (d.transfers.length === 0) return <p className="text-sm text-muted-foreground">No likely transfers.</p>
  return d.transfers.map(({ record: r, candidates }) => (
    <div key={r.id} className="rounded-xl border px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-semibold">{accountName(r.accountId)} · {payeeLabel(r) || '(no note)'}</span>
        <span className="shrink-0 font-semibold tabular-nums">{money(r)} <span className="text-xs font-normal text-muted-foreground">{r.currencyCode}</span></span>
      </div>
      <div className="text-xs text-muted-foreground">{shortDay(r.recordDate)}</div>
      {candidates.map(c => (
        <ActionForm key={c.id} action={markAsTransfer} className="mt-2 flex items-center gap-2 border-t pt-2">
          <input type="hidden" name="recordId" value={r.id} />
          <input type="hidden" name="counterpartId" value={c.id} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm"><b>{accountName(c.accountId)}</b> {money(c)} {c.currencyCode}</div>
            <div className="truncate text-xs text-muted-foreground">{shortDay(c.recordDate)}{payeeLabel(c) ? ` · ${payeeLabel(c)}` : ''}</div>
          </div>
          <button className={PRIMARY}>Link</button>
        </ActionForm>
      ))}
      <form action={dismissTransfer} className="mt-2 text-right">
        {candidates.map(c => <input key={c.id} type="hidden" name="key" value={pairKey(r.id, c.id)} />)}
        <button className="min-h-9 text-[13px] text-muted-foreground underline">Not a transfer</button>
      </form>
    </div>
  ))
}
