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
import type { RecordDoc } from '@/src/sync/record-mapper'
import type { CanonicalTxn } from '@/src/types'

type PreparedDoc = { doc: AssetTransactionDoc; source: CanonicalTxn }
type PreparedRecord = { doc: RecordDoc; source: CanonicalTxn }

function Stat({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string
  value: number
  tone: 'emerald' | 'muted' | 'red'
  emphasis?: boolean
}) {
  const toneClass =
    tone === 'emerald' ? 'text-primary'
    : tone === 'red' ? 'text-destructive'
    : 'text-muted-foreground'
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <span className={`${emphasis ? 'text-3xl' : 'text-2xl'} font-semibold tabular-nums ${toneClass}`}>
        {value}
      </span>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  )
}

type SyncResult = {
  total: number
  inserted: number
  conflict: number
  recordsInserted: number
  recordsConflict: number
  errors: Array<{ id: string; reason: string }>
  needsAsset: CanonicalTxn[]
  unsupported: Array<{ row: string | number; reason: string; raw?: Record<string, unknown> }>
  preview: {
    new: PreparedDoc[]
    alreadyPresent: string[]
    newRecords?: PreparedRecord[]
    alreadyPresentRecords?: string[]
  }
}

export default function ResultView() {
  const router = useRouter()
  const { result } = useWizard()

  if (!result) return null

  const r = result as unknown as SyncResult
  const submitted = r.preview?.new ?? []
  const conflicts = r.preview?.alreadyPresent ?? []
  const submittedRecords = r.preview?.newRecords ?? []
  const recordConflicts = r.preview?.alreadyPresentRecords ?? []
  const errors = r.errors ?? []
  const inserted = (r.inserted ?? 0) + (r.recordsInserted ?? 0)
  const conflict = (r.conflict ?? 0) + (r.recordsConflict ?? 0)
  const totalWritten = inserted + conflict

  // Derive accountId from first submitted doc (trade or record) as fallback
  const accountId =
    submitted[0]?.doc?.accountId ??
    submittedRecords[0]?.doc?.accountId ??
    null

  function handleSyncAnother(e: { preventDefault: () => void }) {
    e.preventDefault()
    useWizard.getState().reset()
    router.push('/upload')
  }

  function handleHistoryLink(e: { preventDefault: () => void }) {
    e.preventDefault()
    router.push('/history')
  }

  const isNoOp =
    submitted.length === 0 &&
    submittedRecords.length === 0 &&
    (conflicts.length > 0 || recordConflicts.length > 0) &&
    errors.length === 0
  const totalConflicts = conflicts.length + recordConflicts.length

  return (
    <div className="space-y-6">
      {/* Summary hero */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 shadow-sm">
        <div className="px-6 pt-6 pb-5 border-b border-border/60 bg-gradient-to-br from-accent/40 to-transparent">
          <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            Step 3 · Done
          </p>
          {isNoOp ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Nothing to import</h1>
              <p className="mt-1 text-muted-foreground">
                All <span className="font-semibold text-foreground">{totalConflicts}</span>{' '}
                parsed entr{totalConflicts === 1 ? 'y' : 'ies'} already exist in Wallet.
                Your data is up to date.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Sync complete</h1>
              <p className="mt-1 text-muted-foreground">
                Wrote {totalWritten} document{totalWritten === 1 ? '' : 's'} to Wallet
                {errors.length > 0 ? `, with ${errors.length} error${errors.length === 1 ? '' : 's'}` : ''}.
              </p>
            </>
          )}
        </div>
        {!isNoOp && (
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border/60">
            <Stat label="Total written" value={totalWritten} tone="emerald" emphasis />
            <Stat label="Inserted" value={inserted} tone="emerald" />
            <Stat label="Already present" value={conflict} tone="muted" />
            <Stat label="Errors" value={errors.length} tone={errors.length > 0 ? 'red' : 'muted'} />
          </div>
        )}
        <button
          onClick={handleHistoryLink}
          className="block w-full border-t border-border/60 px-6 py-2.5 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
        >
          View full sync history →
        </button>
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

      {/* Submitted records (dividends, coupons, fees, record-fallback trades) */}
      {submittedRecords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="default" className="bg-green-600 text-white">
                {submittedRecords.length}
              </Badge>
              Submitted records
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs mb-3">
              Cash income/expense entries — dividends, coupons, fees, and trades on exchanges Wallet doesn&apos;t catalog.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submittedRecords.map(({ doc, source }) => {
                  const dateShort = doc.recordDate.slice(0, 10)
                  const amount = (doc.amount / 100).toFixed(2)
                  const isIncome = doc.type === 0
                  return (
                    <TableRow key={doc._id}>
                      <TableCell className="font-mono text-xs">{dateShort}</TableCell>
                      <TableCell>
                        <span className={isIncome ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                          {isIncome ? 'INCOME' : 'EXPENSE'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs truncate max-w-[280px]">{doc.note || source.description || '—'}</TableCell>
                      <TableCell className="text-right">
                        {amount} {source.settlementCurrency}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Conflicts (trades + records combined) */}
      {(conflicts.length > 0 || recordConflicts.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="secondary">{totalConflicts}</Badge>
              Already in Wallet (skipped)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm mb-3">
              These docs were already present — idempotent re-import, no duplicate created.
            </p>
            <div className="space-y-1">
              {[...conflicts, ...recordConflicts].map((id) => (
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
