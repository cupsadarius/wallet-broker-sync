'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

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
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Connect to CouchDB</CardTitle>
          <CardDescription>
            Enter your BudgetBakers CouchDB credentials to get started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="couchUrl" className="text-sm font-medium text-zinc-700">
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
              <label htmlFor="login" className="text-sm font-medium text-zinc-700">
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
              <label htmlFor="token" className="text-sm font-medium text-zinc-700">
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
              <label htmlFor="dbName" className="text-sm font-medium text-zinc-700">
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
              <p className="text-xs text-zinc-500">
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
        </CardContent>
      </Card>
    </div>
  )
}
