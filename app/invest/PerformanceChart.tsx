'use client'

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { ValuePoint } from '@/src/dashboards/compute/performance'

type Point = ValuePoint & { putInBase: number }

type TooltipProps = {
  active?: boolean
  payload?: Array<{ value: number; payload: Point }>
  label?: string
}

export default function PerformanceChart({
  series,
  baseCurrency,
}: {
  series: Point[]
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
      <AreaChart data={series} margin={{ top: 10, right: 8, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--c-accent)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--c-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--c-line)" />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--c-muted)', fontSize: 11 }}
          tickFormatter={d => d.slice(0, 7)}
          minTickGap={40}
        />
        <YAxis
          tick={{ fill: 'var(--c-muted)', fontSize: 11 }}
          tickFormatter={v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 0, notation: 'compact' })}
          width={44}
        />
        <Tooltip content={<ChartTooltip baseCurrency={baseCurrency} />} />
        <Area
          type="monotone"
          dataKey="valueBase"
          stroke="var(--c-accent)"
          strokeWidth={1.5}
          fill="url(#perfGrad)"
          isAnimationActive={false}
        />
        <Area
          type="stepAfter"
          dataKey="putInBase"
          stroke="var(--c-muted)"
          strokeDasharray="4 3"
          strokeWidth={1.5}
          fill="none"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function ChartTooltip({ baseCurrency, ...props }: { baseCurrency: string } & TooltipProps) {
  const { active, payload, label } = props
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const fmt = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${baseCurrency}`
  return (
    <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{label}</div>
      <div>Value {fmt(p.valueBase)}</div>
      <div className="text-muted-foreground">Put in {fmt(p.putInBase)}</div>
    </div>
  )
}
