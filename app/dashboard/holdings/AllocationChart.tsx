'use client'

import { useMemo, useState } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Treemap,
} from 'recharts'
import type { ValuedHolding } from '@/src/dashboards/compute/valuation'

const PALETTE = [
  '#6FA8DC', '#9FC5E8', '#B4A7D6', '#C9DAF8', '#A2C4C9',
  '#D5A6BD', '#FFD966', '#E69138', '#93C47D', '#76A5AF',
  '#8E7CC3', '#F6B26B', '#E06666', '#674EA7', '#45818E',
]

type Datum = { name: string; value: number; pct: number; assetId: string }

export default function AllocationChart({
  rows,
  baseCurrency,
}: {
  rows: ValuedHolding[]
  baseCurrency: string
}) {
  const [mode, setMode] = useState<'pie' | 'treemap'>('pie')

  const data: Datum[] = useMemo(() => {
    return rows
      .filter(h => h.valueBase !== null && h.valueBase > 0)
      .map(h => ({
        name: h.symbol,
        value: h.valueBase!,
        pct: h.allocationPct ?? 0,
        assetId: h.assetId,
      }))
  }, [rows])

  if (data.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        <h3 className="font-medium text-foreground">Allocation</h3>
        <p className="mt-2">
          No priced positions yet. Run a price backfill to populate the chart.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Allocation</h3>
        <div className="flex rounded-md border bg-background p-0.5">
          <button
            className={`px-2.5 py-1 text-xs rounded ${mode === 'pie' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
            onClick={() => setMode('pie')}
          >
            Pie
          </button>
          <button
            className={`px-2.5 py-1 text-xs rounded ${mode === 'treemap' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
            onClick={() => setMode('treemap')}
          >
            Treemap
          </button>
        </div>
      </div>

      <div className="mt-3 h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {mode === 'pie' ? (
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={110}
                paddingAngle={1}
                stroke="rgba(0,0,0,0.2)"
              >
                {data.map((d, i) => (
                  <Cell key={d.assetId} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip content={<AllocationTooltip baseCurrency={baseCurrency} />} />
            </PieChart>
          ) : (
            <Treemap
              data={data}
              dataKey="value"
              nameKey="name"
              stroke="#0a0a0a"
              fill="#6FA8DC"
              content={<TreemapCell />}
            >
              <Tooltip content={<AllocationTooltip baseCurrency={baseCurrency} />} />
            </Treemap>
          )}
        </ResponsiveContainer>
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {data.slice(0, 10).map((d, i) => (
          <li key={d.assetId} className="flex items-center gap-1.5 truncate">
            <span
              aria-hidden
              className="inline-block size-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
            />
            <span className="truncate">{d.name}</span>
            <span className="ml-auto text-muted-foreground tabular-nums">{d.pct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

type RechartsTooltipProps = {
  active?: boolean
  payload?: Array<{ payload?: Datum }>
}

function AllocationTooltip({
  baseCurrency,
  ...props
}: { baseCurrency: string } & RechartsTooltipProps) {
  const { active, payload } = props
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  if (!d) return null
  return (
    <div className="rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{d.name}</div>
      <div className="text-muted-foreground">
        {d.value.toLocaleString(undefined, { maximumFractionDigits: 0 })} {baseCurrency}
      </div>
      <div className="text-muted-foreground">{d.pct.toFixed(2)}%</div>
    </div>
  )
}

type TreemapCellProps = {
  x?: number; y?: number; width?: number; height?: number;
  index?: number; name?: string;
}

function TreemapCell(props: TreemapCellProps) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, name = '' } = props
  const color = PALETTE[index % PALETTE.length]
  const showLabel = width > 50 && height > 30
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={color} stroke="#0a0a0a" strokeWidth={1} />
      {showLabel && (
        <text x={x + 6} y={y + 16} fill="#0a0a0a" fontSize={11} fontWeight={600}>
          {name}
        </text>
      )}
    </g>
  )
}
