'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useWizard } from '@/src/ui/store'
import PreviewTable from './PreviewTable'

export default function PreviewPage() {
  const router = useRouter()
  const { file, broker, dryRun } = useWizard()

  useEffect(() => {
    if (!dryRun || !file || !broker) router.replace('/upload')
  }, [dryRun, file, broker, router])

  if (!dryRun || !file || !broker) {
    return (
      <main className="container mx-auto max-w-3xl py-12 px-4">
        <p className="text-muted-foreground">Redirecting to /upload…</p>
      </main>
    )
  }

  return (
    <main className="container mx-auto max-w-5xl py-12 px-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold mb-2">Review changes</h1>
          <p className="text-muted-foreground">
            Parsed <code className="px-1 py-0.5 rounded bg-zinc-100 text-xs">{file.name}</code> as {broker.toUpperCase()}.
          </p>
        </div>
        <Link
          href="/settings"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors shrink-0"
        >
          Settings
        </Link>
      </div>
      <PreviewTable />
    </main>
  )
}
