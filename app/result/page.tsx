'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useWizard } from '@/src/ui/store'
import ResultView from './ResultView'

export default function ResultPage() {
  const router = useRouter()
  const { result } = useWizard()

  useEffect(() => {
    if (!result) router.replace('/upload')
  }, [result, router])

  if (!result) {
    return (
      <main className="container mx-auto max-w-3xl py-12 px-4">
        <p className="text-muted-foreground">Redirecting to /upload…</p>
      </main>
    )
  }

  return (
    <main className="container mx-auto max-w-5xl py-12 px-4">
      <div className="flex justify-end mb-4">
        <Link
          href="/settings"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
        >
          Settings
        </Link>
      </div>
      <ResultView />
    </main>
  )
}
