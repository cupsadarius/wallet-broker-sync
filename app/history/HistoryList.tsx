'use client'

import { Fragment, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type SyncRun = {
  id: number
  startedAt: number
  finishedAt: number | null
  broker: string
  accountId: string
  sourceFilename: string
  sourceSha256: string
  parsedCount: number
  insertedCount: number
  conflictCount: number
  errorCount: number
}

type SyncRunDoc = {
  id: number
  runId: number
  externalId: string | null
  docId: string | null
  status: string
  errorMessage: string | null
}

type ExpandedRun = {
  run: SyncRun
  docs: SyncRunDoc[]
}

function statusBadge(status: string) {
  if (status === 'inserted') {
    return <Badge variant="default" className="bg-green-600 text-white text-xs">inserted</Badge>
  }
  if (status === 'skipped') {
    return <Badge variant="secondary" className="text-xs">skipped</Badge>
  }
  if (status === 'error') {
    return <Badge variant="destructive" className="text-xs">error</Badge>
  }
  return <Badge variant="outline" className="text-xs">{status}</Badge>
}

export default function HistoryList({ runs }: { runs: SyncRun[] }) {
  const [expanded, setExpanded] = useState<Record<number, ExpandedRun | 'loading' | 'error'>>({})

  async function toggleRow(run: SyncRun) {
    if (expanded[run.id]) {
      setExpanded((prev) => {
        const next = { ...prev }
        delete next[run.id]
        return next
      })
      return
    }

    setExpanded((prev) => ({ ...prev, [run.id]: 'loading' }))
    try {
      const res = await fetch(`/api/history?runId=${run.id}`)
      const data = await res.json()
      if (!res.ok || data.ok === false) {
        setExpanded((prev) => ({ ...prev, [run.id]: 'error' }))
        return
      }
      setExpanded((prev) => ({ ...prev, [run.id]: { run: data.run, docs: data.docs } }))
    } catch {
      setExpanded((prev) => ({ ...prev, [run.id]: 'error' }))
    }
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border bg-card px-5 py-8 text-center text-muted-foreground text-sm">
        No sync runs yet. Upload a broker file to get started.
      </div>
    )
  }

  return (
    <div className="rounded-xl border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Broker</TableHead>
            <TableHead>File</TableHead>
            <TableHead className="text-right">Parsed</TableHead>
            <TableHead className="text-right">Inserted</TableHead>
            <TableHead className="text-right">Conflict</TableHead>
            <TableHead className="text-right">Errors</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const date = new Date(run.startedAt).toLocaleString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
            const expandedData = expanded[run.id]
            const isExpanded = !!expandedData
            const isLoading = expandedData === 'loading'
            const isError = expandedData === 'error'
            const detail = expandedData && expandedData !== 'loading' && expandedData !== 'error'
              ? expandedData
              : null

            return (
              <Fragment key={run.id}>
                <TableRow
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => { void toggleRow(run) }}
                >
                  <TableCell className="font-mono text-xs">{date}</TableCell>
                  <TableCell>
                    <span className="uppercase text-xs font-semibold">{run.broker}</span>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                    {run.sourceFilename}
                  </TableCell>
                  <TableCell className="text-right">{run.parsedCount}</TableCell>
                  <TableCell className="text-right text-green-600 font-medium">{run.insertedCount}</TableCell>
                  <TableCell className="text-right text-zinc-500">{run.conflictCount}</TableCell>
                  <TableCell className="text-right">
                    {run.errorCount > 0
                      ? <span className="text-red-600 font-medium">{run.errorCount}</span>
                      : <span className="text-muted-foreground">0</span>
                    }
                  </TableCell>
                </TableRow>

                {isExpanded && (
                  <TableRow key={`${run.id}-detail`}>
                    <TableCell colSpan={7} className="bg-muted/30 px-4 py-3">
                      {isLoading && (
                        <p className="text-sm text-muted-foreground">Loading…</p>
                      )}
                      {isError && (
                        <p className="text-sm text-destructive">Failed to load run detail.</p>
                      )}
                      {detail && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground mb-2">
                            Account: <span className="font-mono">{detail.run.accountId}</span>
                            {' · '}SHA-256: <span className="font-mono">{detail.run.sourceSha256.slice(0, 12)}…</span>
                          </p>
                          {detail.docs.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No doc records for this run.</p>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-muted-foreground border-b">
                                  <th className="pb-1 pr-4 font-medium">Status</th>
                                  <th className="pb-1 pr-4 font-medium">Doc ID</th>
                                  <th className="pb-1 pr-4 font-medium">External ID</th>
                                  <th className="pb-1 font-medium">Error</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/50">
                                {detail.docs.map((doc) => (
                                  <tr key={doc.id} className="py-0.5">
                                    <td className="py-1 pr-4">{statusBadge(doc.status)}</td>
                                    <td className="py-1 pr-4 font-mono text-muted-foreground max-w-[180px] truncate">
                                      {doc.docId ?? '—'}
                                    </td>
                                    <td className="py-1 pr-4 font-mono text-muted-foreground max-w-[140px] truncate">
                                      {doc.externalId ?? '—'}
                                    </td>
                                    <td className="py-1 text-destructive">
                                      {doc.errorMessage ?? '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
