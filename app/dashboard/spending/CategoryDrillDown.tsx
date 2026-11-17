'use client'

import { Fragment, useMemo, useState } from 'react'
import type { CategorySlice, CategoryRecord } from '@/src/dashboards/compute/spending'

type Mode = 'expense' | 'income' | 'all'

export default function CategoryDrillDown({
  byCategory,
  records,
  baseCurrency,
}: {
  byCategory: CategorySlice[]
  records: Record<string, CategoryRecord[]>
  baseCurrency: string
}) {
  const [mode, setMode] = useState<Mode>('expense')
  const [expanded, setExpanded] = useState<string | null>(null)

  const rows = useMemo(() => {
    const filtered = byCategory.filter(c => {
      if (mode === 'expense') return c.expense > 0
      if (mode === 'income') return c.income > 0
      return c.count > 0
    })
    if (mode === 'expense') filtered.sort((a, b) => b.expense - a.expense)
    else if (mode === 'income') filtered.sort((a, b) => b.income - a.income)
    return filtered
  }, [byCategory, mode])

  const totalForMode = useMemo(() => {
    if (mode === 'expense') return rows.reduce((s, c) => s + c.expense, 0)
    if (mode === 'income') return rows.reduce((s, c) => s + c.income, 0)
    return rows.reduce((s, c) => s + Math.abs(c.net), 0)
  }, [rows, mode])

  function keyFor(c: CategorySlice): string {
    return c.key
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">By category</h3>
        <div className="flex rounded-md border bg-background p-0.5">
          {(['expense', 'income', 'all'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs rounded capitalize ${mode === m ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No data for this view.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm [&_td:not(:first-child)]:whitespace-nowrap [&_td:not(:first-child)]:pl-3">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="text-left py-2">Category</th>
              <th className="text-right py-2">Records</th>
              {mode !== 'income' && <th className="text-right py-2">Expense</th>}
              {mode !== 'expense' && <th className="text-right py-2">Income</th>}
              <th className="text-right py-2">Net</th>
              <th className="text-right py-2 w-14">% of {mode}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.map(c => {
              const k = keyFor(c)
              const isOpen = expanded === k
              const value = mode === 'expense' ? c.expense
                : mode === 'income' ? c.income
                : Math.abs(c.net)
              const pct = totalForMode > 0 ? (value / totalForMode) * 100 : 0
              const list = records[k] ?? []
              return (
                <Fragment key={k}>
                  <tr
                    className="cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => setExpanded(isOpen ? null : k)}
                  >
                    <td className="py-2 font-medium">
                      <span className="inline-block w-3 text-muted-foreground">{isOpen ? '▾' : '▸'}</span>
                      {' '}
                      <span className="text-muted-foreground text-xs">{c.group}</span>
                      <span className="text-muted-foreground"> › </span>
                      <span>{c.name}</span>
                    </td>
                    <td className="py-2 text-right text-muted-foreground">{c.count}</td>
                    {mode !== 'income' && (
                      <td className="py-2 text-right font-mono text-red-400">
                        {c.expense > 0 ? fmt(c.expense, baseCurrency) : '—'}
                      </td>
                    )}
                    {mode !== 'expense' && (
                      <td className="py-2 text-right font-mono text-emerald-400">
                        {c.income > 0 ? fmt(c.income, baseCurrency) : '—'}
                      </td>
                    )}
                    <td className={`py-2 text-right font-mono ${c.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtSigned(c.net, baseCurrency)}
                    </td>
                    <td className="py-2 text-right text-muted-foreground tabular-nums">{pct.toFixed(1)}%</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="bg-muted/20 px-3 pb-3 pt-1">
                        {list.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">No records.</p>
                        ) : (
                          <div className="max-h-[320px] overflow-y-auto rounded border bg-background">
                            <table className="w-full text-xs">
                              <thead className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                                <tr>
                                  <th className="text-left px-3 py-1.5">Date</th>
                                  <th className="text-left px-3 py-1.5">Account</th>
                                  <th className="text-right px-3 py-1.5">Amount ({baseCurrency})</th>
                                  <th className="text-right px-3 py-1.5">Native</th>
                                  <th className="text-left px-3 py-1.5">Note</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/30">
                                {list.map(rec => (
                                  <tr key={rec.id}>
                                    <td className="px-3 py-1 font-mono text-muted-foreground">{rec.date}</td>
                                    <td className="px-3 py-1">{rec.accountName}</td>
                                    <td className={`px-3 py-1 text-right font-mono ${rec.amountBase >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {fmtSigned(rec.amountBase, baseCurrency)}
                                    </td>
                                    <td className="px-3 py-1 text-right font-mono text-muted-foreground">
                                      {fmtSigned(rec.amountNative, rec.currency)}
                                    </td>
                                    <td className="px-3 py-1 text-muted-foreground max-w-[400px] truncate">
                                      {rec.note || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}

function fmt(n: number, ccy: string): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${ccy}`
}
function fmtSigned(n: number, ccy: string): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${ccy}`
}
