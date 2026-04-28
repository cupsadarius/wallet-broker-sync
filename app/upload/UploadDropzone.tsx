'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useWizard } from '@/src/ui/store'
import type { BrokerId } from '@/src/types'

function detectBroker(filename: string): BrokerId {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'xlsx') return 'xtb'
  if (ext === 'csv') return 'ibkr'
  return 'tradeville'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function UploadDropzone() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [broker, setBroker] = useState<BrokerId>('ibkr')
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'not_configured' | 'too_large' | 'other' | null>(null)

  function pickFile(picked: File) {
    setFile(picked)
    setBroker(detectBroker(picked.name))
    setError(null)
    setErrorKind(null)
  }

  function handleInputChange(e: { target: HTMLInputElement }) {
    const picked = e.target.files?.[0]
    if (picked) pickFile(picked)
  }

  function handleDragOver(e: { preventDefault: () => void }) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave() {
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) pickFile(dropped)
  }

  async function handleParse(e: { preventDefault: () => void }) {
    e.preventDefault()
    if (!file) return
    setIsLoading(true)
    setError(null)
    setErrorKind(null)

    try {
      const form = new FormData()
      form.append('file', file)
      form.append('broker', broker)

      const res = await fetch('/api/sync?dryRun=true', {
        method: 'POST',
        body: form,
      })

      const data = await res.json()

      if (res.status === 413) {
        setErrorKind('too_large')
        setError(data.error ?? 'File is too large.')
        return
      }

      if (!res.ok || data.ok === false) {
        const msg: string = data.error ?? 'Unknown error'
        if (msg === 'not_configured') {
          setErrorKind('not_configured')
          setError('CouchDB is not configured.')
        } else {
          setErrorKind('other')
          setError(msg)
        }
        return
      }

      useWizard.getState().set({ file, broker, dryRun: data })
      router.push('/preview')
    } catch (err) {
      setErrorKind('other')
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setIsLoading(false)
    }
  }

  const brokerLabels: Record<BrokerId, string> = {
    xtb: 'XTB (.xlsx)',
    ibkr: 'IBKR / Interactive Brokers (.csv)',
    tradeville: 'Tradeville (.pdf)',
  }

  return (
    <Card>
      <CardContent className="p-6">
        {!file ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={[
              'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-14 px-8 cursor-pointer transition-colors',
              isDragging
                ? 'border-zinc-500 bg-zinc-100'
                : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100',
            ].join(' ')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm font-medium text-zinc-700">
              {isDragging ? 'Release to upload' : 'Drop your file here, or click to browse'}
            </p>
            <p className="text-xs text-zinc-500">CSV (IBKR), XLSX (XTB), PDF (Tradeville) — up to 10 MB</p>
          </div>
        ) : (
          <form onSubmit={handleParse} className="flex flex-col gap-5">
            {/* File info row */}
            <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-zinc-800">{file.name}</p>
                <p className="text-xs text-zinc-500">{formatBytes(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => { setFile(null); setError(null); setErrorKind(null) }}
                className="shrink-0 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                aria-label="Remove file"
              >
                Remove
              </button>
            </div>

            {/* Broker selector */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="broker-select" className="text-sm font-medium text-zinc-700">
                Broker
              </label>
              <select
                id="broker-select"
                value={broker}
                onChange={(e) => setBroker(e.target.value as BrokerId)}
                disabled={isLoading}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-xs focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50"
              >
                {(Object.keys(brokerLabels) as BrokerId[]).map((b) => (
                  <option key={b} value={b}>{brokerLabels[b]}</option>
                ))}
              </select>
              <p className="text-xs text-zinc-500">Auto-detected from file extension. Override if needed.</p>
            </div>

            {/* Error display */}
            {error && (
              <div className="rounded-md border px-3 py-2 text-sm bg-red-50 border-red-200 text-red-700">
                {errorKind === 'not_configured' ? (
                  <>
                    CouchDB is not configured.{' '}
                    <a href="/setup" className="underline font-medium">Re-paste credentials</a>.
                  </>
                ) : errorKind === 'too_large' ? (
                  <>File is too large (max 10 MB). Please export a smaller date range.</>
                ) : (
                  error
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Parsing…
                  </span>
                ) : (
                  'Parse'
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isLoading}
                onClick={() => { setFile(null); setError(null); setErrorKind(null) }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/* Hidden file input — always in DOM so ref is always valid */}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.pdf"
          className="hidden"
          onChange={handleInputChange}
        />
      </CardContent>
    </Card>
  )
}
