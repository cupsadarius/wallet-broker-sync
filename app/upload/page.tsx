import UploadDropzone from './UploadDropzone'

export default function UploadPage() {
  return (
    <main className="container mx-auto max-w-3xl py-12 px-4">
      <h1 className="text-2xl font-semibold mb-2">Upload broker export</h1>
      <p className="text-muted-foreground mb-6">Drop your CSV (IBKR), XLSX (XTB), or PDF (Tradeville) export.</p>
      <UploadDropzone />
    </main>
  )
}
