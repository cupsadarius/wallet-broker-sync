'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useWizard } from '@/src/ui/store'
import PreviewTable from './PreviewTable'

export default function PreviewPage() {
  const router = useRouter()
  const { files, broker, dryRun } = useWizard()

  useEffect(() => {
    if (!dryRun || files.length === 0 || !broker) router.replace('/upload')
  }, [dryRun, files, broker, router])

  if (!dryRun || files.length === 0 || !broker) {
    return (
      <main className="container mx-auto max-w-3xl py-4 px-4 md:py-12">
        <p className="text-muted-foreground">Redirecting to /upload…</p>
      </main>
    )
  }

  const summary =
    files.length === 1
      ? <code className="break-all px-1.5 py-0.5 rounded bg-muted font-mono text-xs">{files[0].name}</code>
      : <span className="font-medium text-foreground">{files.length} files</span>

  return (
    <main className="container mx-auto max-w-5xl py-4 px-4 md:py-12">
      <div className="mb-6">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground ring-1 ring-accent-foreground/15">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          Step 2 · Review
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Review changes</h1>
        <p className="mt-2 text-muted-foreground">
          Parsed {summary} as{' '}
          <span className="font-medium text-foreground">{broker.toUpperCase()}</span>. Nothing is written
          until you confirm.
        </p>
        {files.length > 1 && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground select-none">Show file list</summary>
            <ul className="mt-1.5 space-y-0.5 pl-4 list-disc">
              {files.map((f, i) => <li key={i} className="font-mono">{f.name}</li>)}
            </ul>
          </details>
        )}
      </div>
      <PreviewTable />
    </main>
  )
}
