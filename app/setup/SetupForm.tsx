'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import BackupRestore from '@/app/components/BackupRestore'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function SetupForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [couchUrl, setCouchUrl] = useState('https://couch-prod-eu-1.budgetbakers.com')
  const [login, setLogin] = useState('')
  const [token, setToken] = useState('')
  const [dbName, setDbName] = useState('')

  function handleLoginChange(val: string) {
    setLogin(val)
    if (UUID_RE.test(val.trim())) {
      setDbName(`bb-${val.trim()}`)
    }
  }

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'connection',
            couchUrl: couchUrl.trim(),
            dbName: dbName.trim(),
            login: login.trim(),
            token: token.trim(),
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          setError(data.error ?? 'Unknown error')
          return
        }
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error')
      }
    })
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" className="size-4">
                <path d="M12 11c0-2 2-4 4-4s4 2 4 4-2 4-4 4M4 17h12a4 4 0 000-8H4v8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <CardTitle>Connect to CouchDB</CardTitle>
              <CardDescription className="mt-0.5">
                Enter your BudgetBakers CouchDB credentials to get started.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="couchUrl" className="text-sm font-medium text-foreground">
                CouchDB URL
              </label>
              <Input
                id="couchUrl"
                type="url"
                value={couchUrl}
                onChange={e => setCouchUrl(e.target.value)}
                placeholder="https://couch-prod-eu-1.budgetbakers.com"
                required
                disabled={isPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="login" className="text-sm font-medium text-foreground">
                User ID (login)
              </label>
              <Input
                id="login"
                type="text"
                value={login}
                onChange={e => handleLoginChange(e.target.value)}
                placeholder="c8a279bc-28b5-4edc-9c35-346e8c60af56"
                required
                disabled={isPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="token" className="text-sm font-medium text-foreground">
                Token (password)
              </label>
              <Input
                id="token"
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="Your API token"
                required
                disabled={isPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="dbName" className="text-sm font-medium text-foreground">
                Database name
              </label>
              <Input
                id="dbName"
                type="text"
                value={dbName}
                onChange={e => setDbName(e.target.value)}
                placeholder="bb-<your-user-id>"
                required
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Auto-filled when login looks like a UUID.
              </p>
            </div>

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200">
                {error}
              </p>
            )}

            <Button type="submit" disabled={isPending} className="mt-1">
              {isPending ? 'Connecting…' : 'Connect'}
            </Button>
          </form>

          {/* Restore-from-backup shortcut for new-PC setup. */}
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs font-medium text-foreground mb-1">Moving from another machine?</p>
            <p className="text-xs text-muted-foreground mb-3">
              Import a backup to pre-fill the connection URL/DB and restore mappings, aliases, and links.
              You&apos;ll still need to paste your token above.
            </p>
            <BackupRestore
              compact
              onConnectionImportedAction={({ couchUrl: cu, dbName: dn }) => {
                if (cu) setCouchUrl(cu)
                if (dn) setDbName(dn)
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
