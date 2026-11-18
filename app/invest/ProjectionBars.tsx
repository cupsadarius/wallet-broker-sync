'use client'

import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TimelinePoint } from '@/src/retirement/chart'
import { cn } from '@/lib/utils'

const STEPS = [5, 10] as const
const compact = (n: number) => n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** Projected value every 5 or 10 years and at the end, split into money paid in and gain. */
export default function ProjectionBars({ points, base }: { points: TimelinePoint[]; base: string }) {
  const [step, setStep] = useState<(typeof STEPS)[number]>(5)
  const last = points.length - 1
  // A step less than 2 years before the end crowds the end bar, so the end bar replaces it.
  const picked = points.filter((_, i) => i === last || (i > 0 && i % (step * 12) === 0 && last - i >= 24))
  const data = picked.map(p => {
    const value = (p.projected ?? 0) / 100, paidIn = p.paidIn / 100
    return { year: p.month.slice(0, 4), paidIn, gain: Math.max(0, value - paidIn), value }
  })
  const fmt = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${base}`
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex justify-end gap-1 text-[11px]">
        {STEPS.map(s => (
          <button key={s} type="button" onClick={() => setStep(s)}
            className={cn('rounded-md px-2 py-0.5 text-muted-foreground', s === step && 'bg-secondary font-semibold text-foreground')}>
            {s} years
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--c-line)" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: 'var(--c-muted)', fontSize: 11 }} />
            <YAxis tick={{ fill: 'var(--c-muted)', fontSize: 11 }} width={44} tickFormatter={v => compact(Number(v))} />
            <Bar dataKey="paidIn" stackId="v" fill="var(--c-neutral)" fillOpacity={0.45} isAnimationActive={false} />
            <Bar dataKey="gain" stackId="v" fill="var(--c-accent)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="value" position="top" fill="var(--c-fg-2)" fontSize={11} formatter={(v: unknown) => compact(Number(v))} />
            </Bar>
            <Tooltip cursor={{ fill: 'var(--c-fill-2)' }} content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload as (typeof data)[number] | undefined
              if (!p) return null
              return (
                <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md">
                  <div className="font-medium">{p.year}</div>
                  <div>Value {fmt(p.value)}</div>
                  <div className="text-muted-foreground">Paid in {fmt(p.paidIn)}</div>
                  <div className="text-up">Gain {fmt(p.value - p.paidIn)}</div>
                </div>
              )
            }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
