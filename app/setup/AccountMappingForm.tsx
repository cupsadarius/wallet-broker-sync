'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type InvestmentAccount = {
  id: string
  name: string
  currencyCode: string
  assetTypes: number[]
}

type BrokerMapping = {
  broker: string
  accountId: string
  currencyCode: string
}

type Props = {
  existingMappings: BrokerMapping[]
}

const BROKERS: { key: 'xtb' | 'ibkr' | 'tradeville'; label: string }[] = [
  { key: 'xtb', label: 'XTB' },
  { key: 'ibkr', label: 'Interactive Brokers (IBKR)' },
  { key: 'tradeville', label: 'Tradeville' },
]

export default function AccountMappingForm({ existingMappings }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [accounts, setAccounts] = useState<InvestmentAccount[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // selections: broker key -> { accountId, currencyCode }
  const [selections, setSelections] = useState<
    Record<string, { accountId: string; currencyCode: string }>
  >(() => {
    const init: Record<string, { accountId: string; currencyCode: string }> = {}
    for (const m of existingMappings) {
      init[m.broker] = { accountId: m.accountId, currencyCode: m.currencyCode }
    }
    return init
  })

  useEffect(() => {
    let cancelled = false
    fetch('/api/couch/accounts')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.error) {
          setLoadError(data.error)
          return
        }
        const accs: InvestmentAccount[] = data.accounts ?? []
        setAccounts(accs)

        // Pre-select existing mappings once we have the account list
        setSelections(prev => {
          const updated = { ...prev }
          for (const m of existingMappings) {
            if (!updated[m.broker]) {
              const match = accs.find(a => a.id === m.accountId)
              if (match) {
                updated[m.broker] = { accountId: match.id, currencyCode: match.currencyCode }
              }
            }
          }
          return updated
        })
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load accounts')
      })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(broker: string, accountId: string) {
    if (!accounts) return
    const account = accounts.find(a => a.id === accountId)
    if (account) {
      setSelections(prev => ({
        ...prev,
        [broker]: { accountId: account.id, currencyCode: account.currencyCode },
      }))
    } else {
      // deselected / empty
      setSelections(prev => {
        const next = { ...prev }
        delete next[broker]
        return next
      })
    }
  }

  async function handleResetConnection() {
    if (!confirm('Clear saved CouchDB credentials and connection details? You will return to the setup form.')) return
    try {
      const res = await fetch('/api/config?scope=connection', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setLoadError(data.error ?? 'Reset failed')
        return
      }
      router.refresh()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Network error during reset')
    }
  }

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault()
    setSaveError(null)

    const mappings = BROKERS.filter(b => selections[b.key]).map(b => ({
      broker: b.key,
      accountId: selections[b.key].accountId,
      currencyCode: selections[b.key].currencyCode,
    }))

    startTransition(async () => {
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'mappings', mappings }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          setSaveError(data.error ?? 'Unknown error')
          return
        }
        router.push('/upload')
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Network error')
      }
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Map broker accounts</CardTitle>
          <CardDescription>
            Select which BudgetBakers account corresponds to each broker.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadError && (
            <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200">
              <p>Failed to load accounts: {loadError}</p>
              <button
                type="button"
                onClick={handleResetConnection}
                className="mt-2 underline text-red-800 hover:text-red-900"
              >
                Reset connection and re-enter credentials
              </button>
            </div>
          )}

          {!accounts && !loadError && (
            <p className="text-sm text-zinc-500">Loading accounts…</p>
          )}

          {accounts && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {BROKERS.map(({ key, label }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label htmlFor={`broker-${key}`} className="text-sm font-medium text-zinc-700">
                    {label}
                  </label>
                  <select
                    id={`broker-${key}`}
                    value={selections[key]?.accountId ?? ''}
                    onChange={e => handleSelect(key, e.target.value)}
                    disabled={isPending}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">— select account —</option>
                    {accounts.map(account => (
                      <option key={account.id} value={account.id}>
                        {account.name} ({account.currencyCode})
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              {saveError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200">
                  {saveError}
                </p>
              )}

              <div className="flex items-center gap-3 mt-1">
                <Button
                  type="submit"
                  disabled={isPending || BROKERS.some(b => !selections[b.key])}
                >
                  {isPending ? 'Saving…' : 'Save and continue'}
                </Button>
                <button
                  type="button"
                  onClick={handleResetConnection}
                  disabled={isPending}
                  className="text-sm text-zinc-500 hover:text-zinc-700 underline"
                >
                  Reset connection
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
