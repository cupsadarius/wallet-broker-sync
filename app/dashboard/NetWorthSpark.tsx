'use client'

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { NetWorthPoint } from '@/src/dashboards/compute/networth'

type TipProps = {
  active?: boolean
  payload?: Array<{ payload: NetWorthPoint }>
  label?: string
}

export default function NetWorthSpark({
  series,
  baseCurrency,
}: {
  series: NetWorthPoint[]
  baseCurrency: string
}) {
  if (series.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        Not enough data yet.
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#B4A7D6" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#B4A7D6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="invGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6FA8DC" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6FA8DC" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#a3a3a3', fontSize: 11 }}
          tickFormatter={d => d.slice(0, 7)}
          minTickGap={40}
        />
        <YAxis
          tick={{ fill: '#a3a3a3', fontSize: 11 }}
          tickFormatter={v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0, notation: 'compact' })}
          width={56}
        />
        <Tooltip content={<NWTooltip baseCurrency={baseCurrency} />} />
        <Area type="monotone" dataKey="investmentBase" stroke="#6FA8DC" strokeWidth={1.2} fill="url(#invGrad)" stackId="nw" />
        <Area type="monotone" dataKey="cashBase" stroke="#B4A7D6" strokeWidth={1.2} fill="url(#nwGrad)" stackId="nw" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function NWTooltip({ baseCurrency, ...props }: { baseCurrency: string } & TipProps) {
  const { active, payload, label } = props
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{label}</div>
      <div className="text-muted-foreground">
        Total: {d.totalBase.toLocaleString(undefined, { maximumFractionDigits: 0 })} {baseCurrency}
      </div>
      <div className="text-muted-foreground">
        Investments: {d.investmentBase.toLocaleString(undefined, { maximumFractionDigits: 0 })} {baseCurrency}
      </div>
      <div className="text-muted-foreground">
        Cash: {d.cashBase.toLocaleString(undefined, { maximumFractionDigits: 0 })} {baseCurrency}
      </div>
    </div>
  )
}
