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
  if (ext === 'html' || ext === 'htm') return 'tradeville'
  if (ext === 'pdf') return 'tradeville'
  return 'ibkr'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileKey(f: File) {
  return `${f.name}:${f.size}:${f.lastModified}`
}

export default function UploadDropzone() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [broker, setBroker] = useState<BrokerId>('ibkr')
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'not_configured' | 'too_large' | 'other' | null>(null)

  function addFiles(picked: File[]) {
    if (picked.length === 0) return
    setError(null)
    setErrorKind(null)
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey))
      const merged = [...prev]
      for (const f of picked) {
        const k = fileKey(f)
        if (!seen.has(k)) {
          merged.push(f)
          seen.add(k)
        }
      }
      // First file picks the default broker; user can override.
      if (prev.length === 0 && merged.length > 0) {
        setBroker(detectBroker(merged[0].name))
      }
      return merged
    })
  }

  function removeFile(key: string) {
    setFiles((prev) => prev.filter((f) => fileKey(f) !== key))
  }

  function handleInputChange(e: { target: HTMLInputElement }) {
    const list = e.target.files
    if (!list) return
    addFiles(Array.from(list))
    // Allow re-picking the same file later by clearing the input value.
    if (inputRef.current) inputRef.current.value = ''
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
    const dropped = e.dataTransfer.files
    if (dropped) addFiles(Array.from(dropped))
  }

  async function handleParse(e: { preventDefault: () => void }) {
    e.preventDefault()
    if (files.length === 0) return
    setIsLoading(true)
    setError(null)
    setErrorKind(null)

    try {
      const form = new FormData()
      for (const f of files) form.append('file', f)
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

      useWizard.getState().set({ files, broker, dryRun: data })
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
    tradeville: 'Tradeville (.html or .pdf)',
  }

  const totalBytes = files.reduce((s, f) => s + f.size, 0)

  return (
    <Card className="shadow-sm">
      <CardContent className="p-6">
        {files.length === 0 ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={[
              'group flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-16 px-8 cursor-pointer transition-all',
              isDragging
                ? 'border-primary bg-accent ring-4 ring-primary/15 scale-[1.005]'
                : 'border-border bg-muted/40 hover:border-primary/50 hover:bg-accent/50',
            ].join(' ')}
          >
            <span
              className={[
                'flex size-12 items-center justify-center rounded-xl transition-all',
                isDragging
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'bg-card text-primary ring-1 ring-border group-hover:ring-primary/40 group-hover:text-primary group-hover:-translate-y-0.5',
              ].join(' ')}
              aria-hidden
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </span>
            <p className="text-base font-medium text-foreground">
              {isDragging ? 'Release to upload' : 'Drop one or more files, or click to browse'}
            </p>
            <p className="text-xs text-muted-foreground">
              CSV (IBKR) · XLSX (XTB) · HTML or PDF (Tradeville) — up to 10 MB each
            </p>
          </div>
        ) : (
          <form onSubmit={handleParse} className="flex flex-col gap-5">
            {/* Files list */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={[
                'rounded-lg border bg-muted/40 transition-colors',
                isDragging ? 'border-primary bg-accent ring-2 ring-primary/20' : 'border-border',
              ].join(' ')}
            >
              <ul className="divide-y divide-border">
                {files.map((f) => {
                  const k = fileKey(f)
                  return (
                    <li key={k} className="flex items-center gap-3 px-4 py-3">
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-card text-primary ring-1 ring-border"
                        aria-hidden
                      >
                        <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
                          <path
                            d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8m-5-5l5 5m-5-5v5h5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{f.name}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(f.size)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(k)}
                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={`Remove ${f.name}`}
                      >
                        Remove
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="flex items-center justify-between gap-3 border-t border-border bg-card/50 px-4 py-2 text-xs text-muted-foreground">
                <span>
                  {files.length} file{files.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
                </span>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="font-medium text-primary hover:underline"
                >
                  + Add more
                </button>
              </div>
            </div>

            {/* Broker selector */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="broker-select" className="text-sm font-medium text-foreground">
                Broker
              </label>
              <select
                id="broker-select"
                value={broker}
                onChange={(e) => setBroker(e.target.value as BrokerId)}
                disabled={isLoading}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {(Object.keys(brokerLabels) as BrokerId[]).map((b) => (
                  <option key={b} value={b}>{brokerLabels[b]}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                All selected files are parsed with this broker. Trades that appear in more than one file are merged automatically.
              </p>
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
                  <>{error} (max 10 MB per file). Please export a smaller date range.</>
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
                  files.length > 1 ? `Parse ${files.length} files` : 'Parse'
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isLoading}
                onClick={() => { setFiles([]); setError(null); setErrorKind(null) }}
              >
                Clear
              </Button>
            </div>
          </form>
        )}

        {/* Hidden file input — always in DOM so ref is always valid */}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.xlsx,.pdf,.html,.htm"
          className="hidden"
          onChange={handleInputChange}
        />
      </CardContent>
    </Card>
  )
}
