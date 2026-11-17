'use client'

import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, Line, ComposedChart,
} from 'recharts'
import type { SpendingBucket } from '@/src/dashboards/compute/spending'

export default function CashFlowChart({
  monthly,
  baseCurrency,
}: {
  monthly: SpendingBucket[]
  baseCurrency: string
}) {
  if (monthly.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        No records in window.
      </div>
    )
  }

  const data = monthly.map(m => ({
    yearMonth: m.yearMonth,
    income: Number(m.income.toFixed(2)),
    expense: -Number(m.expense.toFixed(2)),
    transfers: Number(m.transfers.toFixed(2)),
    net: Number(m.net.toFixed(2)),
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="yearMonth" tick={{ fill: '#a3a3a3', fontSize: 11 }} minTickGap={28} />
        <YAxis
          tick={{ fill: '#a3a3a3', fontSize: 11 }}
          tickFormatter={v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0, notation: 'compact' })}
          width={56}
        />
        <Tooltip content={<Tip baseCurrency={baseCurrency} />} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#a3a3a3' }} />
        <Bar dataKey="income" stackId="cf" fill="#5DBB9B" name="Income" />
        <Bar dataKey="expense" stackId="cf" fill="#E06666" name="Expense" />
        <Line type="monotone" dataKey="net" stroke="#B4A7D6" strokeWidth={1.5} name="Net" dot={false} />
        <Line type="monotone" dataKey="transfers" stroke="#6FA8DC" strokeWidth={1} strokeDasharray="4 3" name="Transfers" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

type TipProps = {
  active?: boolean
  payload?: Array<{ name?: string; value: number; color?: string }>
  label?: string
}

function Tip({ baseCurrency, ...props }: { baseCurrency: string } & TipProps) {
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
