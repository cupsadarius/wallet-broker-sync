'use client'

import { useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CategoryRecord, CategorySlice, SpendingBucket } from '@/src/dashboards/compute/spending'
import { cn } from '@/lib/utils'

const GREEN = '#81c995'
const RED = '#f28b82'
const compact = (n: number) => n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const whole = (n: number) => Math.round(n).toLocaleString('en-US')
const monthLabel = (ym: string, year = false) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', ...(year && { year: 'numeric' }), timeZone: 'UTC' })

/** Income and spending per month as bars, net as a line. */
export function MonthlyChart({ monthly, base }: { monthly: SpendingBucket[]; base: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={monthly} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="yearMonth" tick={{ fill: '#a3a3a3', fontSize: 11 }} tickFormatter={m => monthLabel(m)} minTickGap={8} />
        <YAxis tick={{ fill: '#a3a3a3', fontSize: 11 }} width={44} tickFormatter={v => compact(Number(v))} />
        <Bar dataKey="income" fill={GREEN} fillOpacity={0.8} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="expense" fill={RED} fillOpacity={0.8} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Line dataKey="net" stroke="#e8eaed" strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={({ active, payload }) => {
          const p = active && payload?.[0]?.payload as SpendingBucket | undefined
          if (!p) return null
          return (
            <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md tabular-nums">
              <div className="font-medium">{monthLabel(p.yearMonth, true)}</div>
              <div className="text-up">Income {whole(p.income)} {base}</div>
              <div className="text-down">Spent {whole(p.expense)} {base}</div>
              <div>Net {p.net >= 0 ? '+' : '−'}{whole(Math.abs(p.net))} {base}</div>
            </div>
          )
        }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

const SHOWN = 10
const RECORDS_SHOWN = 30

/** Categories by amount for the period; a row opens to its records. */
export function CategoryBreakdown({ byCategory, records, base }: {
  byCategory: CategorySlice[]; records: Record<string, CategoryRecord[]>; base: string
}) {
  const [mode, setMode] = useState<'expense' | 'income'>('expense')
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const rows = byCategory.filter(c => c[mode] > 0).sort((a, b) => b[mode] - a[mode])
  const total = rows.reduce((n, c) => n + c[mode], 0)
  const max = rows[0]?.[mode] ?? 1
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 text-[13px]">
        <span className="text-muted-foreground tabular-nums">{whole(total)} {base} in {rows.length} categories</span>
        <span className="flex gap-1 text-xs">
          {(['expense', 'income'] as const).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setOpen(null) }}
              className={cn('rounded-md px-2 py-0.5 text-muted-foreground', m === mode && 'bg-secondary font-semibold text-foreground')}>
              {m === 'expense' ? 'Spending' : 'Income'}
            </button>
          ))}
        </span>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing in this period.</p>}
      <div className="rounded-[14px] border bg-card px-3.5">
        {(all ? rows : rows.slice(0, SHOWN)).map(c => (
          <div key={c.key} className="border-b last:border-none">
            <button type="button" onClick={() => setOpen(open === c.key ? null : c.key)}
              className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] items-center gap-3 py-2 text-left text-[13px]">
              <span className="truncate"><span className="text-muted-foreground">{c.group} › </span>{c.name}</span>
              <span className="h-1.5 rounded bg-border">
                <span className={cn('block h-full rounded', mode === 'expense' ? 'bg-primary' : 'bg-up')} style={{ width: `${Math.max(2, (c[mode] / max) * 100)}%` }} />
              </span>
              <span className="w-28 text-right tabular-nums">
                {whole(c[mode])} <span className="text-xs text-muted-foreground">{total ? Math.round((c[mode] / total) * 100) : 0}%</span>
              </span>
            </button>
            {open === c.key && (
              <div className="mb-2 max-h-64 overflow-y-auto rounded-lg border px-2.5">
                {[...(records[c.key] ?? [])].sort((x, y) => y.date.localeCompare(x.date)).filter(r => (mode === 'expense' ? r.amountBase < 0 : r.amountBase > 0)).slice(0, RECORDS_SHOWN).map(r => (
                  <div key={r.id} className="flex items-center gap-2 border-b py-1.5 text-xs last:border-none">
                    <span className="w-20 shrink-0 text-muted-foreground">{new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
                    <span className="min-w-0 flex-1 truncate">{r.note || '(no note)'}</span>
                    <span className="hidden shrink-0 text-muted-foreground sm:inline">{r.accountName}</span>
                    <span className="shrink-0 tabular-nums">{whole(Math.abs(r.amountBase))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {rows.length > SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-[13px] text-primary">
          {all ? 'Show top 10' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  )
}
