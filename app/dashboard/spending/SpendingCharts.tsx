'use client'

import { useMemo, useState } from 'react'
import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, Line, ComposedChart, PieChart, Pie, Cell,
} from 'recharts'
import type { SpendingBucket, CategorySlice } from '@/src/dashboards/compute/spending'

const PALETTE = [
  '#6FA8DC', '#9FC5E8', '#B4A7D6', '#A2C4C9', '#D5A6BD',
  '#FFD966', '#E69138', '#93C47D', '#76A5AF', '#8E7CC3',
  '#F6B26B', '#E06666', '#674EA7', '#45818E', '#C9DAF8',
]

export default function SpendingCharts({
  monthly,
  byCategory,
  baseCurrency,
}: {
  monthly: SpendingBucket[]
  byCategory: CategorySlice[]
  baseCurrency: string
}) {
  const [catMode, setCatMode] = useState<'expense' | 'income'>('expense')

  const monthlyData = useMemo(() => monthly.map(m => ({
    yearMonth: m.yearMonth,
    income: Number(m.income.toFixed(2)),
    expense: -Number(m.expense.toFixed(2)),  // negative for visual contrast
    transfers: Number(m.transfers.toFixed(2)),
    net: Number(m.net.toFixed(2)),
  })), [monthly])

  const catData = useMemo(() => {
    const rows = byCategory
      .filter(c => (catMode === 'expense' ? c.expense > 0 : c.income > 0))
      .slice(0, 12)
      .map(c => ({
        key: c.key,
        name: c.name,
        group: c.group,
        value: catMode === 'expense' ? c.expense : c.income,
        count: c.count,
      }))
    return rows
  }, [byCategory, catMode])

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-medium">Monthly income vs expense</h3>
        <p className="text-xs text-muted-foreground">In {baseCurrency}. Line = net.</p>
        <div className="mt-4 h-[320px]">
          {monthlyData.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              No records in window.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="yearMonth"
                  tick={{ fill: '#a3a3a3', fontSize: 11 }}
                  minTickGap={28}
                />
                <YAxis
                  tick={{ fill: '#a3a3a3', fontSize: 11 }}
                  tickFormatter={v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0, notation: 'compact' })}
                  width={56}
                />
                <Tooltip content={<MonthTip baseCurrency={baseCurrency} />} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a3a3a3' }} />
                <Bar dataKey="income" stackId="cf" fill="#5DBB9B" name="Income" />
                <Bar dataKey="expense" stackId="cf" fill="#E06666" name="Expense" />
                <Line type="monotone" dataKey="net" stroke="#B4A7D6" strokeWidth={1.5} name="Net" dot={false} />
                <Line type="monotone" dataKey="transfers" stroke="#6FA8DC" strokeWidth={1} strokeDasharray="4 3" name="Transfers" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Top categories</h3>
          <div className="flex rounded-md border bg-background p-0.5">
            <button
              className={`px-2.5 py-1 text-xs rounded ${catMode === 'expense' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
              onClick={() => setCatMode('expense')}
            >
              Expense
            </button>
            <button
              className={`px-2.5 py-1 text-xs rounded ${catMode === 'income' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
              onClick={() => setCatMode('income')}
            >
              Income
            </button>
          </div>
        </div>

        <div className="mt-3 h-[220px]">
          {catData.length === 0 ? (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              No {catMode} data.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={catData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={90}
                  paddingAngle={1}
                  stroke="rgba(0,0,0,0.2)"
                >
                  {catData.map((d, i) => <Cell key={d.key} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip content={<CatTip baseCurrency={baseCurrency} />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <ul className="mt-3 space-y-1 text-xs">
          {catData.slice(0, 8).map((d, i) => {
            const total = catData.reduce((s, x) => s + x.value, 0)
            const pct = total > 0 ? (d.value / total) * 100 : 0
            return (
              <li key={d.key} className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2 rounded-sm" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                <span className="truncate">
                  <span className="text-muted-foreground">{d.group} › </span>{d.name}
                </span>
                <span className="ml-auto text-muted-foreground tabular-nums">
                  {d.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} {baseCurrency}
                </span>
                <span className="ml-1 w-10 text-right text-muted-foreground tabular-nums">{pct.toFixed(1)}%</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

type TipProps = {
  active?: boolean
  payload?: Array<{ name?: string; value: number; color?: string; payload?: { name?: string; value?: number; count?: number } }>
  label?: string
}

function MonthTip({ baseCurrency, ...props }: { baseCurrency: string } & TipProps) {
  const { active, payload, label } = props
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-sm" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-mono">
            {Math.abs(p.value).toLocaleString(undefined, { maximumFractionDigits: 0 })} {baseCurrency}
          </span>
        </div>
      ))}
    </div>
  )
}

function CatTip({ baseCurrency, ...props }: { baseCurrency: string } & TipProps) {
  const { active, payload } = props
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  if (!d) return null
  return (
    <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{d.name}</div>
      <div className="text-muted-foreground">
        {(d.value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} {baseCurrency}
      </div>
      <div className="text-muted-foreground">{d.count} records</div>
    </div>
  )
}
