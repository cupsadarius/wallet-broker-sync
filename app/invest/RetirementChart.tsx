'use client'

import { Area, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TimelinePoint } from '@/src/retirement/chart'

const BLUE = '#8ab4f8'
const GREY = '#9aa0a6'
const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const units = (cents: number | null) => (cents === null ? null : cents / 100)

/** Value against money paid in; a projected value is drawn dashed. */
export default function RetirementChart({ points, base }: { points: TimelinePoint[]; base: string }) {
  const data = points.map(p => ({ month: p.month, value: units(p.value), projected: units(p.projected), paidIn: units(p.paidIn) }))
  const fmt = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${base}`
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={BLUE} stopOpacity={0.3} />
            <stop offset="95%" stopColor={BLUE} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: '#a3a3a3', fontSize: 11 }} tickFormatter={m => m.slice(0, 4)} minTickGap={36} />
        <YAxis tick={{ fill: '#a3a3a3', fontSize: 11 }} width={44}
          tickFormatter={v => Number(v).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })} />
        <Area type="monotone" dataKey="value" stroke={BLUE} strokeWidth={1.5} fill="url(#retGrad)" isAnimationActive={false} connectNulls={false} />
        <Area type="monotone" dataKey="projected" stroke={BLUE} strokeWidth={1.5} strokeDasharray="5 4" fill={BLUE} fillOpacity={0.06} isAnimationActive={false} />
        <Line type="monotone" dataKey="paidIn" stroke={GREY} strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
        <Tooltip content={({ active, payload }) => {
          const p = active && payload?.[0]?.payload as (typeof data)[number] | undefined
          if (!p) return null
          const v = p.value ?? p.projected
          return (
            <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md">
              <div className="font-medium">{label(p.month)}{p.value === null && ' · projected'}</div>
              {v !== null && <div>Value {fmt(v)}</div>}
              <div className="text-muted-foreground">Paid in {fmt(p.paidIn ?? 0)}</div>
            </div>
          )
        }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
