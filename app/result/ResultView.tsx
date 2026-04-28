'use client'

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

type PreparedDoc = { doc: AssetTransactionDoc; source: CanonicalTxn }

type SyncResult = {
  total: number
  inserted: number
  conflict: number
  errors: Array<{ id: string; reason: string }>
  needsAsset: CanonicalTxn[]
  unsupported: Array<{ row: string | number; reason: string; raw?: Record<string, unknown> }>
  preview: {
    new: PreparedDoc[]
    alreadyPresent: string[]
  }
}

export default function ResultView() {
  const router = useRouter()
  const { result } = useWizard()

  if (!result) return null

  const r = result as unknown as SyncResult
  const submitted = r.preview?.new ?? []
  const conflicts = r.preview?.alreadyPresent ?? []
  const errors = r.errors ?? []
  const inserted = r.inserted ?? 0
  const conflict = r.conflict ?? 0
  const totalWritten = inserted + conflict

  // Derive accountId from first submitted doc as fallback
  const accountId = submitted[0]?.doc?.accountId ?? null

  function handleSyncAnother(e: { preventDefault: () => void }) {
    e.preventDefault()
    useWizard.getState().reset()
    router.push('/upload')
  }

  function handleHistoryLink(e: { preventDefault: () => void }) {
    e.preventDefault()
    router.push('/history')
  }

  return (
    <div className="space-y-6">
      {/* Nav */}
      <div className="flex items-center justify-between text-sm">
        <button
          onClick={handleHistoryLink}
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
        >
          View history
        </button>
      </div>

      {/* Summary header card */}
      <div className="rounded-xl border bg-card px-5 py-6 ring-1 ring-foreground/10">
        {submitted.length === 0 && conflicts.length > 0 && errors.length === 0 ? (
          <>
            <h1 className="text-2xl font-semibold mb-2">Nothing to import</h1>
            <p className="text-muted-foreground">
              All <span className="font-semibold text-foreground">{conflicts.length}</span>{' '}
              parsed transaction{conflicts.length === 1 ? '' : 's'} already exist in Wallet.
              Your data is up to date.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold mb-4">Sync complete</h1>
            <div className="flex flex-wrap gap-8">
              <div className="flex flex-col gap-1">
                <span className="text-4xl font-bold text-green-600">{totalWritten}</span>
                <span className="text-sm text-muted-foreground">total written</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-3xl font-semibold text-green-600">{inserted}</span>
                <span className="text-sm text-muted-foreground">inserted</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-3xl font-semibold text-zinc-500">{conflict}</span>
                <span className="text-sm text-muted-foreground">already present (idempotent)</span>
              </div>
              {errors.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-3xl font-semibold text-red-600">{errors.length}</span>
                  <span className="text-sm text-muted-foreground">errors</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Submitted transactions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Badge variant="default" className="bg-green-600 text-white">
              {submitted.length}
            </Badge>
            Submitted transactions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {submitted.length === 0 ? (
            <p className="text-muted-foreground text-sm">No new transactions were submitted.</p>
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
                {submitted.map(({ doc, source }) => {
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

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary">{conflicts.length}</Badge>
              Already in Wallet (skipped)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm mb-3">
              These docs were already present — idempotent re-import, no duplicate created.
            </p>
            <div className="space-y-1">
              {conflicts.map((id) => (
                <p key={id} className="font-mono text-xs text-muted-foreground">{id}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Badge variant="destructive">{errors.length}</Badge>
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {errors.map((e) => (
                <div key={e.id} className="flex gap-3 text-sm">
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{e.id}</span>
                  <span className="text-destructive">{e.reason}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-4 pt-2">
        {accountId && (
          <a
            href={`https://web.budgetbakers.com/accounts/${accountId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary underline underline-offset-4 hover:opacity-80 transition-opacity"
          >
            Open account in Wallet →
          </a>
        )}
        <Button onClick={handleSyncAnother}>
          Sync another file
        </Button>
      </div>
    </div>
  )
}
