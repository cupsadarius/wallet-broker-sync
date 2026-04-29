import UploadDropzone from './UploadDropzone'

export default function UploadPage() {
  return (
    <main className="container mx-auto max-w-3xl py-12 px-4">
      <div className="mb-8">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground ring-1 ring-accent-foreground/15">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          Step 1 · Pick a file
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Upload broker export</h1>
        <p className="mt-2 text-muted-foreground">
          Drop your CSV (IBKR), XLSX (XTB), or PDF / HTML (Tradeville) export. We&apos;ll parse it locally
          and show you a diff before anything gets written to Wallet.
        </p>
      </div>
      <UploadDropzone />
    </main>
  )
}
