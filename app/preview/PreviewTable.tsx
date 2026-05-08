'use client'

import { Fragment, useTransition, useState, useEffect, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
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
    alreadyPresentDetails?: NearMatch[]
    nearMatches?: Record<string, NearMatch[]>
    unmatchedExisting?: NearMatch[]
    newRecords?: PreparedRecord[]
    alreadyPresentRecords?: string[]
  }
}

export default function PreviewTable() {
  const router = useRouter()
  const { files, broker, dryRun } = useWizard()
  const [isPending, startTransition] = useTransition()
  const [syncError, setSyncError] = useState<string | null>(null)
  // ourDocId → existingDocId[] (user linked, possibly multiple); empty array = insert
  const [linkSelections, setLinkSelections] = useState<Record<string, string[]>>({})
  // Which row's link picker popover is open
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  // 'broker:exchange:symbol' keys that have been POSTed to record-fallback and await re-dry-run
  const [pendingFallbacks, setPendingFallbacks] = useState<Set<string>>(new Set())
  // Shared expanded set across all sections — keys are namespaced
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // Picker popover renders via a portal to escape the table's stacking context.
  // We track the trigger button (to scope click-outside) and the popover root
  // (to allow clicks inside the popover without closing it).
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pickerCoords, setPickerCoords] = useState<{ top: number; left: number } | null>(null)

  function setTriggerRef(docId: string, el: HTMLButtonElement | null) {
    if (el) triggerRefs.current.set(docId, el)
    else triggerRefs.current.delete(docId)
  }

  // Compute popover position from the active trigger's bounding rect, and
  // recompute on scroll/resize so it stays anchored. setState inside the
  // effect is the standard popper pattern (we measure after layout, then
  // place); the rule misses this case.
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (!openPicker) { setPickerCoords(null); return }
    function place() {
      const trig = openPicker ? triggerRefs.current.get(openPicker) : null
      if (!trig) return
      const r = trig.getBoundingClientRect()
      const POPOVER_W = 420
      // Right-align to trigger, drop down 4px below it.
      const left = Math.max(8, Math.min(window.innerWidth - POPOVER_W - 8, r.right - POPOVER_W))
      const top = r.bottom + 4
      setPickerCoords({ top, left })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [openPicker])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Close on click outside (trigger + popover) and on Escape.
  useEffect(() => {
    if (!openPicker) return
    function onDown(e: MouseEvent) {
      const trig = triggerRefs.current.get(openPicker!)
      const pop = popoverRef.current
      const target = e.target as Node
      if (trig && trig.contains(target)) return
      if (pop && pop.contains(target)) return
      setOpenPicker(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenPicker(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openPicker])

  function toggleLink(ourDocId: string, existingDocId: string) {
    setLinkSelections(prev => {
      const cur = prev[ourDocId] ?? []
      const next = cur.includes(existingDocId)
        ? cur.filter(id => id !== existingDocId)
        : [...cur, existingDocId]
      return { ...prev, [ourDocId]: next }
    })
  }

  if (!dryRun || files.length === 0 || !broker) return null

  const result = dryRun as unknown as SyncResult
  const newTxns = result.preview?.new ?? []
  const alreadyPresent = result.preview?.alreadyPresent ?? []
  const alreadyPresentDetails = result.preview?.alreadyPresentDetails ?? []
  const nearMatches = result.preview?.nearMatches ?? {}
  const unmatchedExisting = result.preview?.unmatchedExisting ?? []
  const newRecords = result.preview?.newRecords ?? []
  const alreadyPresentRecords = result.preview?.alreadyPresentRecords ?? []
  const needsAsset = result.needsAsset ?? []
  const unsupported = result.unsupported ?? []

  // Count how many rows the user has chosen to link (any selection > 0)
  const linkedRowCount = Object.values(linkSelections).filter(arr => arr.length > 0).length
  // Total individual links (a single broker row may link to several manual entries)
  const linkedTotal = Object.values(linkSelections).reduce((s, arr) => s + arr.length, 0)
  const newCount = newTxns.length - linkedRowCount
  const alreadyCount = alreadyPresent.length + linkedTotal
  const recordsNewCount = newRecords.length
  const recordsAlreadyCount = alreadyPresentRecords.length
  const needsAssetCount = needsAsset.length
  const unsupportedCount = unsupported.length

  const hasLinkSelections = linkedRowCount > 0
  const hasPendingFallbacks = pendingFallbacks.size > 0
  const syncEnabled = !isPending && (newCount > 0 || recordsNewCount > 0 || hasLinkSelections || hasPendingFallbacks)

  function syncLabel(): string {
    const parts: string[] = []
    if (newCount > 0) parts.push(`${newCount} trade${newCount === 1 ? '' : 's'}`)
    if (recordsNewCount > 0) parts.push(`${recordsNewCount} record${recordsNewCount === 1 ? '' : 's'}`)
    if (linkedRowCount > 0) parts.push(`${linkedRowCount} link${linkedRowCount === 1 ? '' : 's'}`)
    return parts.length ? `Sync ${parts.join(' + ')}` : 'Nothing to sync'
  }

  // Deduplicate needsAsset by (exchange, symbol)
  const needsAssetUnique = needsAsset.reduce<CanonicalTxn[]>((acc, txn) => {
    const key = `${txn.exchange ?? ''}:${txn.symbol ?? ''}`
    if (!acc.some((t) => `${t.exchange ?? ''}:${t.symbol ?? ''}` === key)) {
      acc.push(txn)
    }
    return acc
  }, [])

  async function handleConfirm() {
    if (files.length === 0 || !broker) return
    setSyncError(null)
    startTransition(async () => {
      try {
        const fd = new FormData()
        for (const f of files) fd.append('file', f)
        fd.append('broker', broker)
        // Build skip map: ourDocId → existingDocId[] for user-linked rows
        const skipMap: Record<string, string[]> = {}
        for (const [docId, selection] of Object.entries(linkSelections)) {
          if (selection.length > 0) skipMap[docId] = selection
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

  async function handleCreateAsRecord(txn: CanonicalTxn) {
    if (!broker) return
    const exchange = (txn.exchange ?? '').toUpperCase()
    const symbol = (txn.symbol ?? '').toUpperCase()
    const fallbackKey = `${broker}:${exchange}:${symbol}`
    try {
      await fetch('/api/record-fallback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker, exchange, symbol }),
      })
      // Mark as pending and re-issue dry run so the row re-classifies
      setPendingFallbacks(prev => new Set(prev).add(fallbackKey))
      if (files.length > 0) {
        const fd = new FormData()
        for (const f of files) fd.append('file', f)
        fd.append('broker', broker)
        const res = await fetch('/api/sync?dryRun=true', { method: 'POST', body: fd })
        if (res.ok) {
          const data = await res.json()
          useWizard.getState().set({ dryRun: data })
          setPendingFallbacks(new Set())
        }
      }
    } catch {
      // Silently fail — user can refresh manually
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-6 rounded-sm border border-lead/25 bg-card px-6 py-5 text-sm">
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
          <span className="text-xl font-semibold text-muted-foreground">{alreadyCount + recordsAlreadyCount}</span>
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
            disabled={!syncEnabled}
            size="lg"
          >
            {isPending ? 'Syncing…' : syncLabel()}
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
                  const selection = linkSelections[doc._id] ?? []
                  const isLinked = selection.length > 0
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

                  const triggerLabel = selection.length === 0
                    ? '— Insert as new —'
                    : selection.length === 1
                      ? `Linked: ${formatMatchLabel((nearCandidates.find(c => c.docId === selection[0]) ?? unmatchedExisting.find(c => c.docId === selection[0]))!)}`
                      : `Linked to ${selection.length} entries`

                  return (
                    <Fragment key={doc._id}>
                      <TableRow
                        className={`cursor-pointer hover:bg-muted/50 ${isLinked ? 'opacity-50 line-through text-muted-foreground' : ''}`}
                        onClick={() => toggle(key)}
                      >
                        <TableCell className="w-6 text-muted-foreground select-none">{isOpen ? '▼' : '▶'}</TableCell>
                        <TableCell className="font-mono text-xs">{dateShort}</TableCell>
                        <TableCell>
                          <span className={doc.transactionType === 0 ? 'text-emerald-600 font-medium' : doc.transactionType === 1 ? 'text-red-600 font-medium' : 'text-muted-foreground font-medium'}>
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
                          <button
                            type="button"
                            ref={el => setTriggerRef(doc._id, el)}
                            onClick={() => setOpenPicker(prev => prev === doc._id ? null : doc._id)}
                            className={[
                              'inline-flex items-center gap-1.5 text-xs rounded border bg-background px-2 py-1 text-foreground transition-colors hover:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-ring',
                              isLinked ? 'border-primary/40 text-primary' : 'border-input',
                              'max-w-[260px] truncate',
                            ].join(' ')}
                            title={triggerLabel}
                          >
                            <span className="truncate">{triggerLabel}</span>
                            <span aria-hidden className="text-muted-foreground">▾</span>
                          </button>
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
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${isIncome ? 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30' : 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30'}`}>
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
      {(() => {
        // Build the list of trades that will be skipped: auto-matched +
        // user-linked existing entries. We dedupe by docId so a row that the
        // user explicitly linked doesn't appear twice.
        const userLinkedIds = new Set(Object.values(linkSelections).flat())
        const userLinkedDetails: NearMatch[] = unmatchedExisting.filter(c => userLinkedIds.has(c.docId))
        const seen = new Set<string>()
        const skippedTrades: Array<NearMatch & { source: 'auto' | 'manual' }> = []
        for (const m of alreadyPresentDetails) {
          if (seen.has(m.docId)) continue
          seen.add(m.docId)
          skippedTrades.push({ ...m, source: 'auto' })
        }
        for (const m of userLinkedDetails) {
          if (seen.has(m.docId)) continue
          seen.add(m.docId)
          skippedTrades.push({ ...m, source: 'manual' })
        }
        const skippedTotal = skippedTrades.length + recordsAlreadyCount

        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant="secondary">{skippedTotal}</Badge>
                Already in Wallet
              </CardTitle>
            </CardHeader>
            <CardContent>
              {skippedTotal === 0 ? (
                <p className="text-muted-foreground text-sm">No duplicate transactions detected.</p>
              ) : (
                <>
                  <p className="text-muted-foreground text-xs mb-3">
                    These will be skipped on sync — auto-matched by content hash, or manually linked above.
                  </p>
                  {skippedTrades.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Side</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Exchange</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead>Match</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {skippedTrades.map(c => {
                          const dateShort = (c.date ?? '').slice(0, 10)
                          const cSide = c.transactionType === 0 ? 'BUY' : c.transactionType === 1 ? 'SELL' : '?'
                          const cPrice = (c.price / 100).toFixed(2)
                          return (
                            <TableRow key={c.docId} className="text-muted-foreground">
                              <TableCell className="font-mono text-xs">{dateShort}</TableCell>
                              <TableCell>
                                <span className={c.transactionType === 0 ? 'text-emerald-600/70 font-medium' : c.transactionType === 1 ? 'text-red-600/70 font-medium' : ''}>
                                  {cSide}
                                </span>
                              </TableCell>
                              <TableCell className="font-mono font-medium">{c.symbol ?? '—'}</TableCell>
                              <TableCell className="text-xs">{c.exchange ?? '—'}</TableCell>
                              <TableCell className="text-right tabular-nums">{c.quantity}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {cPrice} {c.priceCurrencyCode ?? ''}
                              </TableCell>
                              <TableCell>
                                {c.source === 'manual'
                                  ? <Badge variant="outline" className="text-primary border-primary/30">manual link</Badge>
                                  : <Badge variant="secondary">auto</Badge>}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  )}
                  {recordsAlreadyCount > 0 && (
                    <p className="text-xs text-muted-foreground mt-3">
                      + {recordsAlreadyCount} record{recordsAlreadyCount === 1 ? '' : 's'} (dividends/fees) already in Wallet
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )
      })()}

      {/* Section 3: Needs asset created */}
      {needsAssetCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30">
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
                          <div className="flex items-center gap-3 flex-wrap">
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
                            {(() => {
                              const exchange = (txn.exchange ?? '').toUpperCase()
                              const symbol = (txn.symbol ?? '').toUpperCase()
                              const fallbackKey = `${broker}:${exchange}:${symbol}`
                              const isMarked = pendingFallbacks.has(fallbackKey)
                              return (
                                <button
                                  onClick={() => handleCreateAsRecord(txn)}
                                  disabled={isMarked}
                                  className="text-primary underline underline-offset-4 text-xs ml-2 disabled:opacity-50 disabled:cursor-default"
                                >
                                  {isMarked ? '✓ marked' : 'Create as record →'}
                                </button>
                              )
                            })()}
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

      {/* Link picker popover (portaled to escape table stacking context) */}
      {openPicker && pickerCoords && typeof window !== 'undefined' && createPortal(
        (() => {
          const docId = openPicker
          const sel = linkSelections[docId] ?? []
          const selSet = new Set(sel)
          const near = nearMatches[docId] ?? []
          const nearIds = new Set(near.map(c => c.docId))
          const others = unmatchedExisting.filter(c => !nearIds.has(c.docId))
          const fmt = (c: NearMatch) => {
            const sym = c.symbol ?? '?'
            const exch = c.exchange ?? '?'
            const cDate = c.date.slice(0, 10)
            const cSide = c.transactionType === 0 ? 'BUY' : c.transactionType === 1 ? 'SELL' : '?'
            const cPrice = (c.price / 100).toFixed(2)
            const currency = c.priceCurrencyCode ?? ''
            return `${sym} ${exch} · ${cDate} · ${cSide} · ${c.quantity} @ ${currency}${cPrice}`
          }
          return (
            <div
              ref={popoverRef}
              role="dialog"
              style={{ position: 'fixed', top: pickerCoords.top, left: pickerCoords.left, width: 420 }}
              className="z-50 max-h-[360px] overflow-auto rounded-sm border border-lead/40 bg-card text-card-foreground"
            >
              <div className="sticky top-0 z-10 bg-card border-b border-border px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-medium">
                  {sel.length === 0 ? 'Pick existing entries to link' : `${sel.length} selected`}
                </span>
                <div className="flex items-center gap-3">
                  {sel.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setLinkSelections(prev => ({ ...prev, [docId]: [] }))}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpenPicker(null)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Done
                  </button>
                </div>
              </div>
              {near.length === 0 && others.length === 0 && (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  No existing trades to link to. This row will be inserted as new.
                </p>
              )}
              {near.length > 0 && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Most likely (same asset, side, day)
                  </p>
                  {near.map(c => {
                    const checked = selSet.has(c.docId)
                    return (
                      <label
                        key={c.docId}
                        className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/60 ${checked ? 'bg-accent/40' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLink(docId, c.docId)}
                          className="size-3.5 accent-primary"
                        />
                        <span className="font-mono truncate">{fmt(c)}</span>
                      </label>
                    )
                  })}
                </div>
              )}
              {others.length > 0 && (
                <div className="border-t border-border">
                  <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Other unmatched trades
                  </p>
                  {others.map(c => {
                    const checked = selSet.has(c.docId)
                    return (
                      <label
                        key={c.docId}
                        className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-muted/60 ${checked ? 'bg-accent/40' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLink(docId, c.docId)}
                          className="size-3.5 accent-primary"
                        />
                        <span className="font-mono truncate">{fmt(c)}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })(),
        document.body,
      )}
    </div>
  )
}
