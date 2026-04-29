'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

type ImportCounts = {
  mappings: number
  aliases: number
  recordFallbacks: number
  manualLinks: number
  connection: number
}

type Status =
  | { kind: 'idle' }
  | { kind: 'importing' }
  | { kind: 'success'; counts: ImportCounts }
  | { kind: 'error'; message: string }

type Props = {
  compact?: boolean
  /** Called after a successful import with any connection details from the
   *  backup file. Used by the setup wizard to populate its form. */
  onConnectionImportedAction?: (conn: { couchUrl: string | null; dbName: string | null }) => void
}

/**
 * Backup & restore panel. Used in Settings (rich layout) and the Setup wizard
 * (compact layout, defaults to opening the import side).
 */
export default function BackupRestore({ compact = false, onConnectionImportedAction }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  function handleDownload() {
    // Triggers the browser to fetch and save the file via Content-Disposition.
    window.location.href = '/api/rules-export'
  }

  async function handleFile(file: File) {
    setStatus({ kind: 'importing' })
    try {
      const text = await file.text()
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        setStatus({ kind: 'error', message: 'File is not valid JSON.' })
        return
      }
      const res = await fetch('/api/rules-import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || data.ok === false) {
        setStatus({ kind: 'error', message: data.error ?? 'Import failed' })
        return
      }
      setStatus({ kind: 'success', counts: data.counts as ImportCounts })
      if (onConnectionImportedAction) {
        const conn = (payload as { connection?: { couchUrl?: string | null; dbName?: string | null } }).connection
        onConnectionImportedAction({
          couchUrl: conn?.couchUrl ?? null,
          dbName: conn?.dbName ?? null,
        })
      }
      router.refresh()
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Network error' })
    }
  }

  function onPick(e: { target: HTMLInputElement }) {
    const f = e.target.files?.[0]
    if (f) void handleFile(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  const summary = status.kind === 'success'
    ? `Imported: ${status.counts.mappings} mappings, ${status.counts.aliases} aliases, ${status.counts.recordFallbacks} record rules, ${status.counts.manualLinks} links${status.counts.connection > 0 ? ', + connection URL/DB' : ''}.`
    : null

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={handleDownload}>
          Download backup
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={status.kind === 'importing'}
        >
          {status.kind === 'importing' ? 'Importing…' : 'Restore from file'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          onChange={onPick}
          className="hidden"
        />
      </div>

      {!compact && (
        <p className="text-xs text-muted-foreground">
          Backups contain mappings, aliases, record-fallback rules, manual links, and your CouchDB
          URL + database name. Credentials are <span className="font-medium text-foreground">never</span>{' '}
          included — re-paste your token after restoring on a new machine. Existing rules on the
          destination are preserved (merge, not overwrite).
        </p>
      )}

      {status.kind === 'success' && summary && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700">
          ✓ {summary}
        </p>
      )}
      {status.kind === 'error' && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {status.message}
        </p>
      )}
    </div>
  )
}
