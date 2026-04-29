// Type declaration for pdfjs-dist worker module (no bundled .d.ts for this path).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  import type { WorkerMessageHandler as WMH } from 'pdfjs-dist'
  export const WorkerMessageHandler: typeof WMH
}
