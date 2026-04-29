'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

type Alias = {
  broker: string
  fromSymbol: string
  fromExchange: string
  toSymbol: string
  toExchange: string
}

const BROKERS = ['ibkr', 'xtb', 'tradeville'] as const
type Broker = (typeof BROKERS)[number]

export default function AliasForm({
  prefill,
  existing,
}: {
  prefill?: { broker?: string; fromSymbol?: string; fromExchange?: string }
  existing: Alias[]
}) {
  const router = useRouter()
  const [isPending, start] = useTransition()
  const [broker, setBroker] = useState<Broker>(
    (prefill?.broker as Broker) ?? 'ibkr',
  )
  const [fromSymbol, setFromSymbol] = useState(prefill?.fromSymbol ?? '')
  const [fromExchange, setFromExchange] = useState(prefill?.fromExchange ?? '')
  const [toSymbol, setToSymbol] = useState('')
  const [toExchange, setToExchange] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
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

  async function handleDelete(a: Alias) {
    if (
      !confirm(
        `Delete alias ${a.broker} ${a.fromSymbol}/${a.fromExchange} → ${a.toSymbol}/${a.toExchange}?`,
      )
    )
      return
    const res = await fetch(
      `/api/aliases?broker=${encodeURIComponent(a.broker)}&fromSymbol=${encodeURIComponent(a.fromSymbol)}&fromExchange=${encodeURIComponent(a.fromExchange)}`,
      { method: 'DELETE' },
    )
    if (res.ok) router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Existing aliases table */}
      <Card>
        <CardHeader>
          <CardTitle>Existing aliases</CardTitle>
        </CardHeader>
        <CardContent>
          {existing.length === 0 ? (
            <p className="text-muted-foreground text-sm">No aliases configured yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Broker</TableHead>
                  <TableHead>From symbol</TableHead>
                  <TableHead>From exchange</TableHead>
                  <TableHead>To symbol</TableHead>
                  <TableHead>To exchange</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {existing.map((a) => (
                  <TableRow key={`${a.broker}:${a.fromSymbol}:${a.fromExchange}`}>
                    <TableCell className="font-mono text-xs">{a.broker}</TableCell>
                    <TableCell className="font-mono font-medium">{a.fromSymbol}</TableCell>
                    <TableCell className="font-mono text-xs">{a.fromExchange}</TableCell>
                    <TableCell className="font-mono font-medium">{a.toSymbol}</TableCell>
                    <TableCell className="font-mono text-xs">{a.toExchange}</TableCell>
                    <TableCell>
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
        </CardContent>
      </Card>

      {/* Create form */}
      <Card>
        <CardHeader>
          <CardTitle>Add alias</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-sm font-medium mb-1 block">Broker</label>
                <select
                  value={broker}
                  onChange={(e) => setBroker(e.target.value as Broker)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {BROKERS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">From symbol</label>
                <Input
                  value={fromSymbol}
                  onChange={(e) => setFromSymbol(e.target.value)}
                  placeholder="CNDX"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">From exchange (MIC)</label>
                <Input
                  value={fromExchange}
                  onChange={(e) => setFromExchange(e.target.value)}
                  placeholder="XLON"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">To symbol</label>
                <Input
                  value={toSymbol}
                  onChange={(e) => setToSymbol(e.target.value)}
                  placeholder="SXRV"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">To exchange (MIC)</label>
                <Input
                  value={toExchange}
                  onChange={(e) => setToExchange(e.target.value)}
                  placeholder="XETR"
                  required
                />
              </div>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save alias'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
