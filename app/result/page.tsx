'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
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
      <ResultView />
    </main>
  )
}
