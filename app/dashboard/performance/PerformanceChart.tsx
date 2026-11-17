'use client'

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { ValuePoint } from '@/src/dashboards/compute/performance'

type TooltipProps = {
  active?: boolean
  payload?: Array<{ value: number; payload: ValuePoint }>
  label?: string
}

export default function PerformanceChart({
  series,
  baseCurrency,
}: {
  series: ValuePoint[]
  baseCurrency: string
}) {
  if (series.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        Not enough data yet. Run a price backfill, then revisit.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 10, right: 16, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6FA8DC" stopOpacity={0.35} />
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
        <Tooltip content={<ChartTooltip baseCurrency={baseCurrency} />} />
        <Area
          type="monotone"
          dataKey="valueBase"
          stroke="#6FA8DC"
          strokeWidth={1.5}
          fill="url(#perfGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function ChartTooltip({ baseCurrency, ...props }: { baseCurrency: string } & TooltipProps) {
  const { active, payload, label } = props
  if (!active || !payload?.length) return null
  const v = payload[0].value
  return (
    <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{label}</div>
      <div className="text-muted-foreground">
        {v.toLocaleString(undefined, { maximumFractionDigits: 0 })} {baseCurrency}
      </div>
    </div>
  )
}
