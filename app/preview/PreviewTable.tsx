'use client'

import { useTransition, useState } from 'react'
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
import type { CanonicalTxn } from '@/src/types'

type UnsupportedRow = { row: string | number; reason: string; raw?: Record<string, unknown> }

type PreparedDoc = { doc: AssetTransactionDoc; source: CanonicalTxn }

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
  }
}

export default function PreviewTable() {
  const router = useRouter()
  const { file, broker, dryRun } = useWizard()
  const [isPending, startTransition] = useTransition()
  const [syncError, setSyncError] = useState<string | null>(null)

  if (!dryRun || !file || !broker) return null

  const result = dryRun as unknown as SyncResult
  const newTxns = result.preview?.new ?? []
  const alreadyPresent = result.preview?.alreadyPresent ?? []
  const needsAsset = result.needsAsset ?? []
  const unsupported = result.unsupported ?? []

  const newCount = newTxns.length
  const alreadyCount = alreadyPresent.length
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
          <span className="text-muted-foreground">new</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold text-zinc-500">{alreadyCount}</span>
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
            disabled={newCount === 0 || isPending}
            size="lg"
          >
            {isPending ? 'Syncing…' : `Sync ${newCount} transaction${newCount === 1 ? '' : 's'}`}
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
          {newCount === 0 ? (
            <p className="text-muted-foreground text-sm">No new transactions to insert.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Exchange</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {newTxns.map(({ doc, source }) => {
                  const side = doc.transactionType === 0 ? 'BUY' : 'SELL'
                  const price = (doc.price / 100).toFixed(2)
                  const total = (doc.cashAmount / 100).toFixed(2)
                  const dateShort = doc.date.slice(0, 10)
                  return (
                    <TableRow key={doc._id}>
                      <TableCell className="font-mono text-xs">{dateShort}</TableCell>
                      <TableCell>
                        <span className={doc.transactionType === 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
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
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Already in Wallet */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge variant="secondary">{alreadyCount}</Badge>
            Already in Wallet
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {alreadyCount === 0
              ? 'No duplicate transactions detected.'
              : `${alreadyCount} transaction${alreadyCount === 1 ? '' : 's'} already exist in Wallet and will be skipped.`}
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
                  <TableHead>Exchange</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {needsAssetUnique.map((txn) => {
                  const aliasHref = `/aliases?broker=${encodeURIComponent(broker ?? '')}&fromSymbol=${encodeURIComponent(txn.symbol ?? '')}&fromExchange=${encodeURIComponent(txn.exchange ?? '')}`
                  return (
                    <TableRow key={`${txn.exchange ?? ''}:${txn.symbol ?? ''}`}>
                      <TableCell>{txn.exchange ?? '—'}</TableCell>
                      <TableCell className="font-mono font-medium">{txn.symbol ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{txn.description}</TableCell>
                      <TableCell>
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
                  <TableHead>Row</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Raw preview</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unsupported.map((u, i) => {
                  const rawPreview = u.raw
                    ? JSON.stringify(u.raw).slice(0, 50) + (JSON.stringify(u.raw).length > 50 ? '…' : '')
                    : '—'
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{String(u.row)}</TableCell>
                      <TableCell>{u.reason}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-xs truncate">
                        {rawPreview}
                      </TableCell>
                    </TableRow>
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
