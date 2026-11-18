'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import BackupRestore from '@/app/components/BackupRestore'
import NotificationsCard from './NotificationsCard'
import Appearance from './Appearance'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ---------- Types ----------

type ConnectionInfo = {
  couchUrl: string | null
  dbName: string | null
  loginMasked: string | null
  hasCreds: boolean
  managedByEnv: boolean
}

type Mapping = {
  broker: string
  accountId: string
  currencyCode: string
}

type Alias = {
  broker: string
  fromSymbol: string
  fromExchange: string
  toSymbol: string
  toExchange: string
}

type Fallback = {
  broker: string
  exchange: string
  symbol: string
}

type ManualLink = {
  broker: string
  externalId: string
  existingDocId: string
}

type DashboardSettings = {
  baseCurrency: string
  mirrorIntervalMs: number
}

type Props = {
  connection: ConnectionInfo
  mappings: Mapping[]
  aliases: Alias[]
  fallbacks: Fallback[]
  links: ManualLink[]
  dashboard: DashboardSettings
  themePref: string
}

const BROKERS = ['ibkr', 'xtb', 'tradeville'] as const
type Broker = (typeof BROKERS)[number]

// ---------- Section: Connection ----------

function ConnectionSection({ connection }: { connection: ConnectionInfo }) {
  const router = useRouter()
  const [resetting, setResetting] = useState(false)

  async function handleReset() {
    if (!confirm('Clear saved CouchDB credentials and connection details? You will be redirected to the setup wizard.')) return
    setResetting(true)
    try {
      const res = await fetch('/api/config?scope=connection', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        alert(data.error ?? 'Reset failed')
        setResetting(false)
        return
      }
      router.push('/setup')
    } catch {
      alert('Network error during reset')
      setResetting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection</CardTitle>
        <CardDescription>CouchDB / BudgetBakers Wallet connection details.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-muted-foreground">URL</dt>
            <dd className="font-mono break-all">{connection.couchUrl ?? <span className="text-muted-foreground italic">not set</span>}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-muted-foreground">Database</dt>
            <dd className="font-mono">{connection.dbName ?? <span className="text-muted-foreground italic">not set</span>}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-muted-foreground">User ID</dt>
            <dd className="font-mono">{connection.loginMasked ?? <span className="text-muted-foreground italic">not set</span>}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-muted-foreground">Credentials</dt>
            <dd>
              {connection.hasCreds
                ? <Badge variant="outline" className="text-emerald-300 border-emerald-500/40 bg-emerald-500/10">Configured ✓</Badge>
                : <Badge variant="outline" className="text-destructive border-destructive/30">Not configured</Badge>
              }
            </dd>
          </div>
        </dl>

        {connection.managedByEnv ? (
          <p className="mt-5 text-sm text-muted-foreground">Managed by environment (WALLET_COUCH_*).</p>
        ) : (
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            variant="destructive"
            size="sm"
            disabled={resetting}
            onClick={handleReset}
          >
            {resetting ? 'Resetting…' : 'Reset connection'}
          </Button>
          <Link href="/setup">
            <Button variant="outline" size="sm">Edit connection →</Button>
          </Link>
        </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Section: Broker → Account Mappings ----------

function MappingsSection({ mappings }: { mappings: Mapping[] }) {
  const BROKER_LABELS: Record<string, string> = {
    xtb: 'XTB',
    ibkr: 'Interactive Brokers (IBKR)',
    tradeville: 'Tradeville',
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Broker → Account mappings</CardTitle>
            <CardDescription>Which BudgetBakers account each broker syncs to.</CardDescription>
          </div>
          <Link href="/setup">
            <Button variant="outline" size="sm">Edit mappings →</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {mappings.length === 0 ? (
          <p className="text-muted-foreground text-sm">No mappings configured. <Link href="/setup" className="underline underline-offset-4 hover:text-foreground">Set up mappings →</Link></p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Broker</TableHead>
                <TableHead>Account ID</TableHead>
                <TableHead>Currency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map(m => (
                <TableRow key={m.broker}>
                  <TableCell className="font-medium">{BROKER_LABELS[m.broker] ?? m.broker}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{m.accountId}</TableCell>
                  <TableCell><Badge variant="secondary">{m.currencyCode}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Section: Asset Aliases ----------

function AliasSection({ aliases: initial }: { aliases: Alias[] }) {
  const router = useRouter()
  const [isPending, start] = useTransition()
  const [broker, setBroker] = useState<Broker>('ibkr')
  const [fromSymbol, setFromSymbol] = useState('')
  const [fromExchange, setFromExchange] = useState('')
  const [toSymbol, setToSymbol] = useState('')
  const [toExchange, setToExchange] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function handleDelete(a: Alias) {
    if (!confirm(`Delete alias ${a.broker} ${a.fromSymbol}/${a.fromExchange} → ${a.toSymbol}/${a.toExchange}?`)) return
    const res = await fetch(
      `/api/aliases?broker=${encodeURIComponent(a.broker)}&fromSymbol=${encodeURIComponent(a.fromSymbol)}&fromExchange=${encodeURIComponent(a.fromExchange)}`,
      { method: 'DELETE' },
    )
    if (res.ok) router.refresh()
  }

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault()
    setErr(null)
    start(async () => {
      const res = await fetch('/api/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker, fromSymbol, fromExchange, toSymbol, toExchange }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setErr(data.error ?? 'Failed')
        return
      }
      setFromSymbol('')
      setFromExchange('')
      setToSymbol('')
      setToExchange('')
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Asset aliases</CardTitle>
        <CardDescription>
          When a broker reports a ticker your Wallet doesn&apos;t have under that exact symbol/exchange, map it here.
          The sync will substitute on lookup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {initial.length === 0 ? (
          <p className="text-muted-foreground text-sm">No aliases configured yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Broker</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initial.map(a => (
                <TableRow key={`${a.broker}:${a.fromSymbol}:${a.fromExchange}`}>
                  <TableCell className="font-mono text-xs">{a.broker}</TableCell>
                  <TableCell className="font-mono font-medium">{a.fromSymbol}<span className="text-muted-foreground">/{a.fromExchange}</span></TableCell>
                  <TableCell className="font-mono font-medium">{a.toSymbol}<span className="text-muted-foreground">/{a.toExchange}</span></TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(a)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Inline create form */}
        <div>
          <p className="text-sm font-medium mb-3">Add alias</p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-xs text-muted-foreground mb-1 block">Broker</label>
                <select
                  value={broker}
                  onChange={e => setBroker(e.target.value as Broker)}
                  className="flex h-11 w-full rounded-full border border-lead/40 bg-transparent px-5 py-2 text-sm text-foreground transition-colors hover:border-lead/60 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  {BROKERS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">From symbol</label>
                <Input value={fromSymbol} onChange={e => setFromSymbol(e.target.value)} placeholder="CNDX" required />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">From exchange</label>
                <Input value={fromExchange} onChange={e => setFromExchange(e.target.value)} placeholder="XLON" required />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">To symbol</label>
                <Input value={toSymbol} onChange={e => setToSymbol(e.target.value)} placeholder="SXRV" required />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">To exchange</label>
                <Input value={toExchange} onChange={e => setToExchange(e.target.value)} placeholder="XETR" required />
              </div>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save alias'}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- Section: Record Fallbacks ----------

function RecordFallbackSection({ fallbacks }: { fallbacks: Fallback[] }) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [isPending, start] = useTransition()
  const [broker, setBroker] = useState<Broker>('tradeville')
  const [exchange, setExchange] = useState('')
  const [symbol, setSymbol] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function handleDelete(f: Fallback) {
    if (!confirm(`Delete record fallback rule for ${f.broker} ${f.symbol}/${f.exchange}?`)) return
    const res = await fetch(
      `/api/record-fallback?broker=${encodeURIComponent(f.broker)}&exchange=${encodeURIComponent(f.exchange)}&symbol=${encodeURIComponent(f.symbol)}`,
      { method: 'DELETE' },
    )
    if (res.ok) router.refresh()
  }

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault()
    setErr(null)
    start(async () => {
      const res = await fetch('/api/record-fallback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker, exchange, symbol }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setErr(data.error ?? 'Failed')
        return
      }
      setExchange('')
      setSymbol('')
      setShowForm(false)
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record fallbacks</CardTitle>
        <CardDescription>
          Trades for these symbols will be created as cash-flow Records (expense for buys, income for sells)
          instead of investment AssetTransactions. Useful for assets Wallet doesn&apos;t have a catalog entry for
          (e.g. Bucharest exchange).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fallbacks.length === 0 ? (
          <p className="text-muted-foreground text-sm">No record fallback rules configured.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Broker</TableHead>
                <TableHead>Exchange</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fallbacks.map(f => (
                <TableRow key={`${f.broker}:${f.exchange}:${f.symbol}`}>
                  <TableCell className="font-mono text-xs">{f.broker}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{f.exchange}</TableCell>
                  <TableCell className="font-mono font-medium">{f.symbol}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(f)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!showForm ? (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>+ Add manually</Button>
        ) : (
          <div className="border rounded-md p-4 space-y-3">
            <p className="text-sm font-medium">Add record fallback rule</p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Broker</label>
                  <select
                    value={broker}
                    onChange={e => setBroker(e.target.value as Broker)}
                    className="flex h-11 w-full rounded-full border border-lead/40 bg-transparent px-5 py-2 text-sm text-foreground transition-colors hover:border-lead/60 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    {BROKERS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Exchange (MIC)</label>
                  <Input value={exchange} onChange={e => setExchange(e.target.value)} placeholder="XBSE" required />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Symbol</label>
                  <Input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="TLV" required />
                </div>
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? 'Saving…' : 'Save rule'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setShowForm(false); setErr(null) }}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Section: Manual Links ----------

function ManualLinksSection({ links }: { links: ManualLink[] }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<string | null>(null)

  async function handleDelete(l: ManualLink) {
    if (!confirm(`Unlink trade ${l.externalId.slice(0, 12)}… from ${l.existingDocId}?`)) return
    const params = new URLSearchParams({
      broker: l.broker,
      externalId: l.externalId,
      existingDocId: l.existingDocId,
    })
    const res = await fetch(`/api/manual-link?${params}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  function toggleExpand(key: string) {
    setExpanded(prev => prev === key ? null : key)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked trades</CardTitle>
        <CardDescription>
          CSV trades you&apos;ve manually linked to existing Wallet entries. Future syncs treat these as already-present.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {links.length === 0 ? (
          <p className="text-muted-foreground text-sm">No manually linked trades. Links are created from the preview screen&apos;s &quot;Link to existing&quot; action.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Broker</TableHead>
                <TableHead>External ID</TableHead>
                <TableHead>Linked to</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map(l => {
                const key = `${l.broker}:${l.externalId}:${l.existingDocId}`
                const isExpanded = expanded === key
                return (
                  <TableRow key={key}>
                    <TableCell className="font-mono text-xs">{l.broker}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <button
                        onClick={() => toggleExpand(key)}
                        className="hover:underline text-left"
                        title={l.externalId}
                      >
                        {isExpanded ? l.externalId : l.externalId.slice(0, 12) + (l.externalId.length > 12 ? '…' : '')}
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <button
                        onClick={() => toggleExpand(key)}
                        className="hover:underline text-left"
                        title={l.existingDocId}
                      >
                        {isExpanded ? l.existingDocId : l.existingDocId.slice(0, 30) + (l.existingDocId.length > 30 ? '…' : '')}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(l)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Main SettingsView ----------

export default function SettingsView({ connection, mappings, aliases, fallbacks, links, dashboard, themePref }: Props) {
  return (
    <main className="container mx-auto max-w-3xl py-4 px-4 md:py-20 md:px-6">
      <div className="mb-14">
        <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-ghost-blue/10 px-4 py-1.5 text-xs font-medium text-foreground/80 ring-1 ring-lead/30">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          <span className="uppercase tracking-[0.18em]">Configuration</span>
        </p>
        <h1 className="font-heading text-3xl font-light leading-[1.1] tracking-wide text-foreground md:text-5xl">Settings</h1>
        <p className="mt-5 max-w-xl text-[15px] text-muted-foreground">
          Manage all persistent rules for wallet-broker-sync — connection, mappings, aliases, and overrides.
        </p>
      </div>

      <div className="space-y-6">
        <Appearance pref={themePref} />
        <ConnectionSection connection={connection} />
        <NotificationsCard />
        <MappingsSection mappings={mappings} />
        <DashboardSection initial={dashboard} />
        <AliasSection aliases={aliases} />
        <RecordFallbackSection fallbacks={fallbacks} />
        <ManualLinksSection links={links} />
        <BackupRestoreSection />
      </div>
    </main>
  )
}

// ---------- Section: Dashboard ----------

function DashboardSection({ initial }: { initial: DashboardSettings }) {
  const router = useRouter()
  const [baseCurrency, setBaseCurrency] = useState(initial.baseCurrency)
  const [intervalMin, setIntervalMin] = useState(Math.round(initial.mirrorIntervalMs / 60_000))
  const [saving, startSave] = useTransition()
  const [backfilling, setBackfilling] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [backfillSummary, setBackfillSummary] = useState<string | null>(null)

  async function handleSave(e: { preventDefault: () => void }) {
    e.preventDefault()
    setErr(null)
    startSave(async () => {
      const res = await fetch('/api/dashboard/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseCurrency: baseCurrency.toUpperCase().slice(0, 3),
          mirrorIntervalMs: intervalMin * 60_000,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setErr(data.error ?? 'Save failed')
        return
      }
      setSavedAt(Date.now())
      router.refresh()
    })
  }

  async function handleBackfill() {
    setBackfilling(true)
    setBackfillSummary(null)
    try {
      const res = await fetch('/api/dashboard/backfill-prices', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setBackfillSummary(`Failed: ${data.error ?? 'unknown'}`)
      } else {
        const parts = [
          `${data.withCoverage}/${data.symbols} symbols`,
          `${data.fxPairs} FX pairs`,
          `${data.durationMs}ms`,
        ]
        if (data.unsupported?.length) parts.push(`${data.unsupported.length} unsupported`)
        setBackfillSummary(parts.join(' · '))
      }
    } catch {
      setBackfillSummary('Network error')
    } finally {
      setBackfilling(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dashboards</CardTitle>
        <CardDescription>
          Base currency for portfolio totals and how often the local Couch mirror auto-refreshes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Base currency (ISO)</label>
              <Input
                value={baseCurrency}
                onChange={e => setBaseCurrency(e.target.value.toUpperCase().slice(0, 3))}
                maxLength={3}
                placeholder="EUR"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Auto-refresh interval (minutes)
              </label>
              <Input
                type="number"
                min={1}
                max={1440}
                value={intervalMin}
                onChange={e => setIntervalMin(Number(e.target.value) || 5)}
              />
            </div>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={backfilling}
              onClick={handleBackfill}
            >
              {backfilling ? 'Fetching prices…' : 'Backfill prices now'}
            </Button>
            {savedAt && !saving && (
              <span className="text-xs text-muted-foreground">Saved</span>
            )}
            {backfillSummary && (
              <span className="text-xs text-muted-foreground">{backfillSummary}</span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------- Section: Backup & restore ----------

function BackupRestoreSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup & restore</CardTitle>
        <CardDescription>
          Export all rules to a JSON file and restore them on another machine — useful when moving
          to a new PC or sharing a setup.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BackupRestore />
      </CardContent>
    </Card>
  )
}
