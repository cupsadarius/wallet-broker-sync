import UploadDropzone from './UploadDropzone'
import type { BrokerId } from '@/src/types'

const BROKERS: BrokerId[] = ['xtb', 'ibkr', 'tradeville']

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ broker?: string }> }) {
  const { broker } = await searchParams
  const initialBroker = BROKERS.find(b => b === broker)
  return (
    <main className="container mx-auto max-w-3xl py-6 px-4 md:py-20 md:px-6">
      <div className="mb-8 md:mb-14">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-ghost-blue/10 px-4 py-1.5 text-xs font-medium text-foreground/80 ring-1 ring-lead/30">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          <span className="uppercase tracking-[0.18em]">Step 1 · Pick a file</span>
        </p>
        <h1 className="font-heading text-3xl font-light leading-[1.1] tracking-wide text-foreground md:text-5xl">
          Upload broker export
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground md:text-[17px]">
          Drop your CSV (IBKR), XLSX (XTB), or PDF / HTML (Tradeville) export. We&apos;ll parse it locally
          and show you a diff before anything gets written to Wallet.
          Pension and policy PDFs (BT, Allianz, Signal Iduna, CNPP) save to Retirement as soon as you drop them.
        </p>
      </div>
      <UploadDropzone initialBroker={initialBroker} />
    </main>
  )
}
