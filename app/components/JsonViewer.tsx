'use client'

import { useState } from 'react'

type JsonViewerProps = {
  data: unknown
  /** Initial collapse state for objects/arrays. Default: open at depth 0, collapsed at depth >= 1 */
  initialOpenDepth?: number
}

export default function JsonViewer({ data, initialOpenDepth = 1 }: JsonViewerProps) {
  return (
    <div className="font-mono text-xs leading-relaxed text-foreground">
      <Node value={data} depth={0} initialOpenDepth={initialOpenDepth} />
    </div>
  )
}

function Node({ value, depth, initialOpenDepth, label }: {
  value: unknown
  depth: number
  initialOpenDepth: number
  label?: string
}) {
  const labelEl = label !== undefined ? (
    <span className="text-zinc-500">&quot;{label}&quot;</span>
  ) : null

  if (value === null) {
    return (
      <span>
        {labelEl}{label !== undefined && <span className="text-muted-foreground">: </span>}
        <span className="text-orange-600">null</span>
      </span>
    )
  }
  if (value === undefined) {
    return (
      <span>
        {labelEl}{label !== undefined && <span className="text-muted-foreground">: </span>}
        <span className="text-orange-600">undefined</span>
      </span>
    )
  }
  if (typeof value === 'string') {
    return (
      <span>
        {labelEl}{label !== undefined && <span className="text-muted-foreground">: </span>}
        <span className="text-green-700 dark:text-green-400">&quot;{value}&quot;</span>
      </span>
    )
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return (
      <span>
        {labelEl}{label !== undefined && <span className="text-muted-foreground">: </span>}
        <span className="text-blue-700 dark:text-blue-400">{String(value)}</span>
      </span>
    )
  }
  if (typeof value === 'boolean') {
    return (
      <span>
        {labelEl}{label !== undefined && <span className="text-muted-foreground">: </span>}
        <span className="text-orange-600">{String(value)}</span>
      </span>
    )
  }

  if (Array.isArray(value)) {
    return <Collapsible label={label} value={value} depth={depth} initialOpenDepth={initialOpenDepth} kind="array" />
  }
  if (typeof value === 'object') {
    return <Collapsible label={label} value={value as Record<string, unknown>} depth={depth} initialOpenDepth={initialOpenDepth} kind="object" />
  }

  return (
    <span className="text-muted-foreground">{String(value)}</span>
  )
}

function Collapsible({ label, value, depth, initialOpenDepth, kind }: {
  label?: string
  value: Record<string, unknown> | unknown[]
  depth: number
  initialOpenDepth: number
  kind: 'array' | 'object'
}) {
  const [open, setOpen] = useState(depth < initialOpenDepth)
  const entries = kind === 'array'
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)

  const opener = kind === 'array' ? '[' : '{'
  const closer = kind === 'array' ? ']' : '}'

  if (entries.length === 0) {
    return (
      <span>
        {label !== undefined && <span className="text-zinc-500">&quot;{label}&quot;</span>}
        {label !== undefined && <span className="text-muted-foreground">: </span>}
        <span className="text-muted-foreground">{opener}{closer}</span>
      </span>
    )
  }

  return (
    <span>
      {label !== undefined && <span className="text-zinc-500">&quot;{label}&quot;</span>}
      {label !== undefined && <span className="text-muted-foreground">: </span>}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-muted-foreground hover:text-foreground transition-colors select-none"
        aria-expanded={open}
      >
        {opener}{open ? '' : ` ${entries.length} ${kind === 'array' ? 'item' : 'key'}${entries.length === 1 ? '' : 's'} `}{!open && closer}
      </button>
      {open && (
        <div className="ml-4 border-l border-border/40 pl-3">
          {entries.map(([k, v], i) => (
            <div key={k} className="break-all">
              <Node
                value={v}
                depth={depth + 1}
                initialOpenDepth={initialOpenDepth}
                label={kind === 'object' ? k : undefined}
              />
              {i < entries.length - 1 && <span className="text-muted-foreground">,</span>}
            </div>
          ))}
        </div>
      )}
      {open && <span className="text-muted-foreground">{closer}</span>}
    </span>
  )
}
