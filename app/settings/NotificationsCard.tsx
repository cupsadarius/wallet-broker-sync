'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type State = 'loading' | 'unsupported' | 'off' | 'on'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

export default function NotificationsCard() {
  const [state, setState] = useState<State>('loading')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('unsupported')
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        setState((await reg.pushManager.getSubscription()) ? 'on' : 'off')
      } catch {
        setState('unsupported')
      }
    })()
  }, [])

  async function enable() {
    setMessage(null)
    try {
      if (await Notification.requestPermission() !== 'granted') { setMessage('Permission denied.'); return }
      const { publicKey } = await (await fetch('/api/push/key')).json()
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
      const res = await fetch('/api/push/subscription', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'save failed')
      setState('on')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not enable notifications.')
    }
  }

  async function disable() {
    setMessage(null)
    const reg = await navigator.serviceWorker.ready
    await (await reg.pushManager.getSubscription())?.unsubscribe()
    await fetch('/api/push/subscription', { method: 'DELETE' })
    setState('off')
  }

  async function test() {
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      if (!res.ok) throw new Error(`push failed (${res.status})`)
      const { result } = await res.json()
      setMessage(result === 'sent' ? 'Test sent.' : result === 'gone' ? 'Subscription expired. Enable again.' : 'No subscription.')
      if (result === 'gone') setState('off')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Push failed.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Push alerts on this device. On iPhone, add the app to the Home Screen first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === 'unsupported' && <p className="text-sm text-muted-foreground">This browser does not support push notifications.</p>}
        {state === 'off' && <Button size="sm" onClick={enable}>Enable</Button>}
        {state === 'on' && (
          <div className="flex gap-3">
            <Button size="sm" variant="outline" onClick={test}>Send test</Button>
            <Button size="sm" variant="destructive" onClick={disable}>Disable</Button>
          </div>
        )}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  )
}
