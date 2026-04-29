'use client'

import { Fragment, useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWizard } from '@/src/ui/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AssetTransactionDoc } from '@/src/sync/mapper'
import type { RecordDoc } from '@/src/sync/record-mapper'
import type { CanonicalTxn } from '@/src/types'
import JsonViewer from '@/app/components/JsonViewer'

type UnsupportedRow = { row: string | number; reason: string; raw?: Record<string, unknown> }

type PreparedDoc = { doc: AssetTransactionDoc; source: CanonicalTxn }
type PreparedRecord = { doc: RecordDoc; source: CanonicalTxn }

type NearMatch = {
  docId: string
  date: string
  assetId: string
  symbol?: string
  exchange?: string
  transactionType: number
  quantity: number
  price: number
  priceCurrencyCode?: string
  cashAmount?: number
  cashAmountCurrencyCode?: string
}

type SyncResult = {
  total: number
  inserted: number
  conflict: number
  errors: Array<{ id: string; reason: string }>
  needsAsset: CanonicalTxn[]
  unsupported: UnsupportedRow[]
  preview: {
    new: PreparedDoc[]
    alreadyPresent: string[]
    nearMatches?: Record<string, NearMatch[]>
    unmatchedExisting?: NearMatch[]
    newRecords?: PreparedRecord[]
    alreadyPresentRecords?: string[]
  }
}

export default function PreviewTable() {
  const router = useRouter()
  const { file, broker, dryRun } = useWizard()
  const [isPending, startTransition] = useTransition()
  const [syncError, setSyncError] = useState<string | null>(null)
  // docId → existingDocId (user linked) or 'insert' (default)
  const [linkSelections, setLinkSelections] = useState<Record<string, string>>({})
  // Shared expanded set across all sections — keys are namespaced
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  if (!dryRun || !file || !broker) return null

  const result = dryRun as unknown as SyncResult
  const newTxns = result.preview?.new ?? []
  const alreadyPresent = result.preview?.alreadyPresent ?? []
  const nearMatches = result.preview?.nearMatches ?? {}
  const unmatchedExisting = result.preview?.unmatchedExisting ?? []
  const newRecords = result.preview?.newRecords ?? []
  const alreadyPresentRecords = result.preview?.alreadyPresentRecords ?? []
  const needsAsset = result.needsAsset ?? []
  const unsupported = result.unsupported ?? []

  // Count how many rows the user has chosen to link (not insert)
  const linkedCount = Object.values(linkSelections).filter(v => v !== 'insert').length
  const newCount = newTxns.length - linkedCount
  const alreadyCount = alreadyPresent.length + linkedCount
  const recordsNewCount = newRecords.length
  const recordsAlreadyCount = alreadyPresentRecords.length
  const needsAssetCount = needsAsset.length
  const unsupportedCount = unsupported.length

  // Deduplicate needsAsset by (exchange, symbol)
  const needsAssetUnique = needsAsset.reduce<CanonicalTxn[]>((acc, txn) => {
    const key = `${txn.exchange ?? ''}:${txn.symbol ?? ''}`
    if (!acc.some((t) => `${t.exchange ?? ''}:${t.symbol ?? ''}` === key)) {
      acc.push(txn)
    }
    return acc
  }, [])

  async function handleConfirm() {
    if (!file || !broker) return
    setSyncError(null)
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('broker', broker)
        // Build skip map: ourDocId → existingDocId for user-linked rows
        const skipMap: Record<string, string> = {}
        for (const [docId, selection] of Object.entries(linkSelections)) {
          if (selection !== 'insert') skipMap[docId] = selection
        }
        if (Object.keys(skipMap).length > 0) {
          fd.append('skip', JSON.stringify(skipMap))
        }
        const res = await fetch('/api/sync', { method: 'POST', body: fd })
        const data = await res.json()
        if (!res.ok || data.ok === false) {
          setSyncError(data.error ?? 'Sync failed')
          return
        }
        useWizard.getState().set({ result: data })
        router.push('/result')
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : 'Network error')
      }
    })
  }

  function handleBack() {
    useWizard.getState().reset()
    router.push('/upload')
  }

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-5 py-4 text-sm ring-1 ring-foreground/10">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-green-600">{newCount}</span>
          <span className="text-muted-foreground">new trades</span>
        </div>
        {recordsNewCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-blue-600">{recordsNewCount}</span>
            <span className="text-muted-foreground">dividends/fees</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold text-zinc-500">{alreadyCount + recordsAlreadyCount}</span>
          <span className="text-muted-foreground">already in Wallet</span>
        </div>
        {needsAssetCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xl font-semibold text-yellow-600">{needsAssetCount}</span>
            <span className="text-muted-foreground">need asset</span>
          </div>
        )}
        {unsupportedCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xl font-semibold text-red-600">{unsupportedCount}</span>
            <span className="text-muted-foreground">parse errors</span>
          </div>
        )}
        <div className="ml-auto flex flex-col items-end gap-1">
          <Button
            onClick={handleConfirm}
            disabled={(newCount === 0 && recordsNewCount === 0) || isPending}
            size="lg"
          >
            {isPending ? 'Syncing…' : `Sync ${newCount + recordsNewCount} item${newCount + recordsNewCount === 1 ? '' : 's'}`}
          </Button>
          {syncError && (
            <p className="text-xs text-destructive">{syncError}</p>
          )}
        </div>
      </div>

      {/* Section 1: Will insert */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge variant="default" className="bg-green-600 text-white">
              {newCount}
            </Badge>
            Will insert
          </CardTitle>
        </CardHeader>
        <CardContent>
          {newTxns.length === 0 ? (
            <p className="text-muted-foreground text-sm">No new transactions to insert.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" />
                  <TableHead>Date</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Link to existing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {newTxns.map(({ doc, source }) => {
                  const side = doc.transactionType === 0 ? 'BUY' : doc.transactionType === 1 ? 'SELL' : '?'
                  const price = (doc.price / 100).toFixed(2)
                  const total = (doc.cashAmount / 100).toFixed(2)
                  const dateShort = doc.date.slice(0, 10)
                  const nearCandidates = nearMatches[doc._id] ?? []
                  const nearCandidateIds = new Set(nearCandidates.map(c => c.docId))
                  const otherCandidates = unmatchedExisting.filter(c => !nearCandidateIds.has(c.docId))
                  const selection = linkSelections[doc._id] ?? 'insert'
                  const isLinked = selection !== 'insert'
                  const key = `ins-${doc._id}`
                  const isOpen = expanded.has(key)

                  const formatMatchLabel = (c: NearMatch) => {
                    const sym = c.symbol ?? '?'
                    const exch = c.exchange ?? '?'
                    const cDate = c.date.slice(0, 10)
                    const cSide = c.transactionType === 0 ? 'BUY' : c.transactionType === 1 ? 'SELL' : '?'
                    const cPrice = (c.price / 100).toFixed(2)
                    const currency = c.priceCurrencyCode ?? ''
                    return `${sym} ${exch} · ${cDate} · ${cSide} · ${c.quantity} @ ${currency}${cPrice}`
                  }

                  return (
                    <Fragment key={doc._id}>
                      <TableRow
                        className={`cursor-pointer hover:bg-muted/50 ${isLinked ? 'opacity-50 line-through text-zinc-400' : ''}`}
                        onClick={() => toggle(key)}
                      >
                        <TableCell className="w-6 text-muted-foreground select-none">{isOpen ? '▼' : '▶'}</TableCell>
                        <TableCell className="font-mono text-xs">{dateShort}</TableCell>
                        <TableCell>
                          <span className={doc.transactionType === 0 ? 'text-green-600 font-medium' : doc.transactionType === 1 ? 'text-red-600 font-medium' : 'text-zinc-400 font-medium'}>
                            {side}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono font-medium">{source.symbol ?? '—'}</TableCell>
                        <TableCell className="text-xs">{source.exchange ?? '—'}</TableCell>
                        <TableCell className="text-right">{doc.quantity}</TableCell>
                        <TableCell className="text-right">
                          {price} {doc.priceCurrencyCode}
                        </TableCell>
                        <TableCell className="text-right">
                          {total} {doc.cashAmountCurrencyCode}
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <select
                            value={selection}
                            onChange={(e: { preventDefault: () => void; target: { value: string } }) => {
                              const val = (e as unknown as React.ChangeEvent<HTMLSelectElement>).target.value
                              setLinkSelections(prev => ({ ...prev, [doc._id]: val }))
                            }}
                            className="text-xs rounded border border-input bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="insert">— Insert as new —</option>
                            {nearCandidates.length > 0 && (
                              <optgroup label="Most likely (same asset, side, day)">
                                {nearCandidates.map(c => (
                                  <option key={c.docId} value={c.docId}>
                                    {formatMatchLabel(c)}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {otherCandidates.length > 0 && (
                              <optgroup label="Other unmatched trades">
                                {otherCandidates.map(c => (
                                  <option key={c.docId} value={c.docId}>
                                    {formatMatchLabel(c)}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={9} className="bg-muted/30 p-4 space-y-4">
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">Source (parsed CanonicalTxn):</p>
                              <JsonViewer data={source} initialOpenDepth={3} />
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">Wire doc (will be sent to CouchDB):</p>
                              <JsonViewer data={doc} initialOpenDepth={3} />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Dividends & fees */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge variant="default" className="bg-blue-600 text-white">
              {recordsNewCount}
            </Badge>
            Dividends &amp; fees
          </CardTitle>
        </CardHeader>
        <CardContent>
          {newRecords.length === 0 ? (
            <p className="text-muted-foreground text-sm">No dividends or fees to insert.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" />
                  <TableHead>Date</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Direction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {newRecords.map(({ doc, source }) => {
                  const isIncome = doc.type === 0
                  const amount = (doc.amount / 100).toFixed(2)
                  const dateShort = doc.recordDate.slice(0, 10)
                  const key = `rec-${doc._id}`
                  const isOpen = expanded.has(key)
                  return (
                    <Fragment key={doc._id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggle(key)}
                      >
                        <TableCell className="w-6 text-muted-foreground select-none">{isOpen ? '▼' : '▶'}</TableCell>
                        <TableCell className="font-mono text-xs">{dateShort}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${isIncome ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>
                            {source.kind}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono font-medium">{source.symbol ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground text-xs max-w-xs truncate">{doc.note}</TableCell>
                        <TableCell className="text-right font-mono">
                          {amount}
                        </TableCell>
                        <TableCell>
                          <span className={isIncome ? 'text-blue-600 font-medium' : 'text-red-600 font-medium'}>
                            {isIncome ? 'IN' : 'OUT'}
                          </span>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30 p-4 space-y-4">
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">Source (parsed CanonicalTxn):</p>
                              <JsonViewer data={source} initialOpenDepth={3} />
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">Wire doc (will be sent to CouchDB as Record):</p>
                              <JsonViewer data={doc} initialOpenDepth={3} />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Already in Wallet (trades + records combined) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge variant="secondary">{alreadyCount + recordsAlreadyCount}</Badge>
            Already in Wallet
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {alreadyCount + recordsAlreadyCount === 0
              ? 'No duplicate transactions detected.'
              : `${alreadyCount + recordsAlreadyCount} item${alreadyCount + recordsAlreadyCount === 1 ? '' : 's'} already exist in Wallet and will be skipped.`}
          </p>
        </CardContent>
      </Card>

      {/* Section 3: Needs asset created */}
      {needsAssetCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-yellow-100 text-yellow-800 border border-yellow-300">
                {needsAssetCount}
              </span>
              Needs asset created
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm mb-3">
              These transactions reference assets not found in Wallet. Create them at{' '}
              <a
                href="https://web.budgetbakers.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-4"
              >
                web.budgetbakers.com
              </a>{' '}
              before syncing.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" />
                  <TableHead>Exchange</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {needsAssetUnique.map((txn) => {
                  const aliasHref = `/aliases?broker=${encodeURIComponent(broker ?? '')}&fromSymbol=${encodeURIComponent(txn.symbol ?? '')}&fromExchange=${encodeURIComponent(txn.exchange ?? '')}`
                  const key = `asset-${txn.exchange ?? ''}:${txn.symbol ?? ''}`
                  const isOpen = expanded.has(key)
                  return (
                    <Fragment key={`${txn.exchange ?? ''}:${txn.symbol ?? ''}`}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggle(key)}
                      >
                        <TableCell className="w-6 text-muted-foreground select-none">{isOpen ? '▼' : '▶'}</TableCell>
                        <TableCell>{txn.exchange ?? '—'}</TableCell>
                        <TableCell className="font-mono font-medium">{txn.symbol ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{txn.description}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-3">
                            <a
                              href={`https://web.budgetbakers.com/investments/assets`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline underline-offset-4 text-xs"
                            >
                              Create →
                            </a>
                            <a
                              href={aliasHref}
                              className="text-muted-foreground underline underline-offset-4 text-xs hover:text-foreground transition-colors"
                            >
                              Use existing →
                            </a>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={5} className="bg-muted/30 p-4">
                            <p className="text-xs font-semibold text-muted-foreground mb-1">CanonicalTxn:</p>
                            <JsonViewer data={txn} initialOpenDepth={3} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Section 4: Unsupported / parse errors */}
      {unsupportedCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="destructive">{unsupportedCount}</Badge>
              Unsupported / parse errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" />
                  <TableHead>Row</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Raw preview</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unsupported.map((u, i) => {
                  const key = `unsup-${i}`
                  const isOpen = expanded.has(key)
                  const rawPreview = u.raw
                    ? JSON.stringify(u.raw).slice(0, 50) + (JSON.stringify(u.raw).length > 50 ? '…' : '')
                    : '—'
                  return (
                    <Fragment key={i}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggle(key)}
                      >
                        <TableCell className="w-6 text-muted-foreground select-none">{isOpen ? '▼' : '▶'}</TableCell>
                        <TableCell className="font-mono text-xs">{String(u.row)}</TableCell>
                        <TableCell>{u.reason}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground max-w-xs truncate">
                          {rawPreview}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={4} className="bg-muted/30 p-4 space-y-2">
                            <JsonViewer data={u.raw ?? {}} initialOpenDepth={3} />
                            <p className="text-xs text-muted-foreground pt-1">
                              <span className="font-semibold">Reason:</span> {u.reason}
                            </p>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Back escape hatch */}
      <div className="pt-2">
        <button
          onClick={handleBack}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
        >
          ← Back to upload
        </button>
      </div>
    </div>
  )
}
