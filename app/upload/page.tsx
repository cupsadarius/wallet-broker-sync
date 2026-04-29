import Link from 'next/link'
import UploadDropzone from './UploadDropzone'

export default function UploadPage() {
  return (
    <main className="container mx-auto max-w-3xl py-12 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Upload broker export</h1>
          <p className="text-muted-foreground">Drop your CSV (IBKR), XLSX (XTB), or PDF (Tradeville) export.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/history"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
          >
            View history
          </Link>
          <Link
            href="/settings"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
          >
            Settings
          </Link>
        </div>
      </div>
      <UploadDropzone />
    </main>
  )
}
