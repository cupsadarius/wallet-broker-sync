'use client'

import type { ReactNode } from 'react'
import { createRenderer } from '@json-render/react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { catalog } from '@/src/ask/catalog'
import { cn } from '@/lib/utils'

const PALETTE = ['var(--c-accent)', 'var(--c-good)', 'var(--c-warn)', 'var(--c-bad)', 'var(--c-accent-soft)', 'var(--c-fg-2)', 'var(--c-neutral)', 'var(--c-accent-ink)']
const AXIS = { fill: 'var(--c-muted)', fontSize: '0.6875rem' }
const GAP = { none: 'gap-0', sm: 'gap-2', md: 'gap-3', lg: 'gap-5' }
const compact = (v: unknown) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 1, notation: 'compact' })
const full = (unit?: string | null) => (v: unknown) =>
  `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`

type XY = {
  title?: string | null; unit?: string | null; xKey: string
  data: Record<string, string | number>[]; series: { key: string; label: string }[]
}

function ChartBox({ title, children }: { title?: string | null; children: ReactNode }) {
  return (
    <figure className="min-w-0">
      {title && <figcaption className="mb-2 text-xs font-medium text-muted-foreground">{title}</figcaption>}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </figure>
  )
}

function xyParts(p: XY) {
  return [
    <CartesianGrid key="g" stroke="var(--c-line)" vertical={false} />,
    <XAxis key="x" dataKey={p.xKey} tick={AXIS} minTickGap={24} />,
    <YAxis key="y" tick={AXIS} tickFormatter={compact} width="auto" />,
    <Tooltip key="t" formatter={full(p.unit)} contentStyle={{ background: 'var(--c-surface)', border: '1px solid var(--c-line)', fontSize: '0.75rem' }} />,
    p.series.length > 1 && <Legend key="l" wrapperStyle={{ fontSize: '0.6875rem' }} />,
  ]
}

const AnswerSpec = createRenderer(catalog, {
  Card: ({ element, children }) => (
    <Card size="sm">
      {(element.props.title || element.props.description) && (
        <CardHeader>
          {element.props.title && <CardTitle>{element.props.title}</CardTitle>}
          {element.props.description && <CardDescription>{element.props.description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  ),
  Stack: ({ element, children }) => (
    <div className={cn('flex', element.props.direction === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col', GAP[element.props.gap ?? 'md'])}>
      {children}
    </div>
  ),
  Heading: ({ element }) => {
    const Tag = element.props.level ?? 'h3'
    return <Tag className="text-sm font-semibold">{element.props.text}</Tag>
  },
  Text: ({ element }) => (
    <p className={cn('text-sm', element.props.variant === 'muted' || element.props.variant === 'caption' ? 'text-xs text-muted-foreground' : '',
      element.props.variant === 'lead' && 'text-base')}>{element.props.text}</p>
  ),
  Badge: ({ element }) => <Badge variant={element.props.variant ?? 'default'}>{element.props.text}</Badge>,
  Table: ({ element }) => (
    <Table>
      {element.props.caption && <TableCaption>{element.props.caption}</TableCaption>}
      <TableHeader>
        <TableRow>{element.props.columns.map((c, i) => <TableHead key={i}>{c}</TableHead>)}</TableRow>
      </TableHeader>
      <TableBody>
        {element.props.rows.map((r, i) => (
          <TableRow key={i}>{r.map((c, j) => <TableCell key={j} className={j > 0 ? 'text-right tabular-nums' : ''}>{c}</TableCell>)}</TableRow>
        ))}
      </TableBody>
    </Table>
  ),
  LineChart: ({ element: { props: p } }) => (
    <ChartBox title={p.title}>
      <LineChart data={p.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        {xyParts(p)}
        {p.series.map((s, i) => (
          <Line key={s.key} dataKey={s.key} name={s.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ChartBox>
  ),
  AreaChart: ({ element: { props: p } }) => (
    <ChartBox title={p.title}>
      <AreaChart data={p.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        {xyParts(p)}
        {p.series.map((s, i) => (
          <Area key={s.key} dataKey={s.key} name={s.label} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]}
            fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ChartBox>
  ),
  BarChart: ({ element: { props: p } }) => (
    <ChartBox title={p.title}>
      <BarChart data={p.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        {xyParts(p)}
        {p.series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartBox>
  ),
  PieChart: ({ element: { props: p } }) => (
    <ChartBox title={p.title}>
      <PieChart>
        <Pie data={p.data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" stroke="none" isAnimationActive={false}>
          {p.data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip formatter={full(p.unit)} contentStyle={{ background: 'var(--c-surface)', border: '1px solid var(--c-line)', fontSize: '0.75rem' }} />
        <Legend wrapperStyle={{ fontSize: '0.6875rem' }} />
      </PieChart>
    </ChartBox>
  ),
})

export default AnswerSpec
