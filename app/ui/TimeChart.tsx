'use client'

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { dateLong, dateTick, short, spanYears, whole } from './chartFormat'

export type TimePoint = { date: string; value: number | null; projected?: number | null; paidIn?: number | null }

/** Value as a solid line over a light area, a projection dashed, money paid in as a grey dashed line, and a Today
 * marker. Dates are YYYY-MM or YYYY-MM-DD. */
export default function TimeChart({ points, today, unit, height = 230, label }: {
  points: TimePoint[]; today?: string; unit: string; height?: number; label: string
}) {
  if (points.length < 2) return <p className="text-sm text-muted-foreground">Not enough history to draw a chart yet.</p>
  const span = spanYears(points[0].date, points.at(-1)!.date)
  const hasProjection = points.some(p => p.projected != null)
  const hasPaidIn = points.some(p => p.paidIn != null)
  return (
    <figure aria-label={label} className="m-0 flex flex-col gap-2">
      {(hasProjection || hasPaidIn) && (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
          <span className="flex items-center gap-2"><span aria-hidden className="h-[0.1875rem] w-4 rounded bg-primary" />Value</span>
          {hasProjection && <span className="flex items-center gap-2"><span aria-hidden className="w-4 border-t-2 border-dashed border-primary" />Projected</span>}
          {hasPaidIn && <span className="flex items-center gap-2"><span aria-hidden className="w-4 border-t-2 border-dashed border-muted-foreground" />Paid in</span>}
        </figcaption>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 10, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--c-line)" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: 'var(--c-muted)', fontSize: '0.6875rem' }} tickFormatter={d => dateTick(d, span)}
              minTickGap={28} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--c-muted)', fontSize: '0.6875rem' }} width="auto" tickFormatter={v => short(Number(v))}
              axisLine={false} tickLine={false} />
            <Area type="monotone" dataKey="value" stroke="var(--c-accent)" strokeWidth={2.2} fill="var(--c-fill)" fillOpacity={1}
              isAnimationActive={false} connectNulls={false} />
            {hasProjection && <Area type="monotone" dataKey="projected" stroke="var(--c-accent)" strokeWidth={2} strokeDasharray="7 5"
              fill="var(--c-fill-2)" fillOpacity={1} isAnimationActive={false} />}
            {hasPaidIn && <Line type="monotone" dataKey="paidIn" stroke="var(--c-muted)" strokeWidth={1.5} strokeDasharray="5 4"
              dot={false} isAnimationActive={false} />}
            {today && <ReferenceLine x={today} stroke="var(--c-neutral)" label={{ value: 'Today', position: 'insideTopLeft', fill: 'var(--c-muted)', fontSize: '0.6875rem' }} />}
            <Tooltip cursor={{ stroke: 'var(--c-line-2)' }} content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload as TimePoint | undefined
              if (!p) return null
              const v = p.value ?? p.projected
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs tabular-nums shadow-md">
                  <div className="font-medium">{dateLong(p.date)}{p.value == null && p.projected != null && ', projected'}</div>
                  {v != null && <div>Value {whole(v)} {unit}</div>}
                  {p.paidIn != null && <div className="text-muted-foreground">Paid in {whole(p.paidIn)} {unit}</div>}
                </div>
              )
            }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
