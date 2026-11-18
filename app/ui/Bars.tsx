'use client'

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { short, whole } from './chartFormat'

export type BarDatum = { label: string; value: number; back?: number; over?: boolean; highlight?: boolean }

/** Bars per month or year. `back` draws a wider bar behind (income behind spending); `over` bars use the warn
 * color; `limit` draws a dashed budget line. */
export default function Bars({ data, unit, limit, height = 200, label, valueName = 'Value', backName = 'Total' }: {
  data: BarDatum[]; unit: string; limit?: number; height?: number; label: string; valueName?: string; backName?: string
}) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">Nothing to show for this period.</p>
  const hasBack = data.some(d => d.back != null)
  const fill = (d: BarDatum) => d.over ? 'var(--c-warn)' : d.highlight || hasBack ? 'var(--c-accent)' : 'var(--c-neutral)'
  return (
    <figure aria-label={label} className="m-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%">
          <CartesianGrid stroke="var(--c-line)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--c-muted)', fontSize: '0.6875rem' }} axisLine={false} tickLine={false} minTickGap={4} />
          {hasBack && <XAxis dataKey="label" xAxisId="back" hide />}
          <YAxis tick={{ fill: 'var(--c-muted)', fontSize: '0.6875rem' }} width="auto" tickFormatter={v => short(Number(v))} axisLine={false} tickLine={false} />
          {hasBack && <Bar dataKey="back" xAxisId="back" fill="var(--c-line-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />}
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false} {...(hasBack && { barSize: 12 })}>
            {data.map((d, i) => <Cell key={i} fill={fill(d)} />)}
          </Bar>
          {limit != null && <ReferenceLine y={limit} stroke="var(--c-fg)" strokeDasharray="4 4" />}
          <Tooltip cursor={{ fill: 'var(--c-fill-2)' }} content={({ active, payload }) => {
            const d = active && payload?.[0]?.payload as BarDatum | undefined
            if (!d) return null
            return (
              <div className="rounded-md border bg-popover px-3 py-2 text-xs tabular-nums shadow-md">
                <div className="font-medium">{d.label}</div>
                {d.back != null && <div className="text-muted-foreground">{backName} {whole(d.back)} {unit}</div>}
                <div>{valueName} {whole(d.value)} {unit}</div>
                {limit != null && <div className="text-muted-foreground">Limit {whole(limit)} {unit}</div>}
              </div>
            )
          }} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  )
}
