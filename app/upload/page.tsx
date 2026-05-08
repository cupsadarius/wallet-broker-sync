import UploadDropzone from './UploadDropzone'

export default function UploadPage() {
  return (
    <main className="container mx-auto max-w-3xl py-20 px-6">
      <div className="mb-14">
        <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-ghost-blue/10 px-4 py-1.5 text-xs font-medium text-foreground/80 ring-1 ring-lead/30">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          <span className="uppercase tracking-[0.18em]">Step 1 · Pick a file</span>
        </p>
        <h1 className="font-heading text-5xl font-light leading-[1.1] tracking-wide text-foreground">
          Upload broker export
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Drop your CSV (IBKR), XLSX (XTB), or PDF / HTML (Tradeville) export. We&apos;ll parse it locally
          and show you a diff before anything gets written to Wallet.
        </p>
      </div>
      <UploadDropzone />
    </main>
  )
}
