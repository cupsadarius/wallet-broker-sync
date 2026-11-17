import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs'

// Same server-side worker setup as src/parsers/tradeville-pdf.ts: no worker thread under Next.js.
;(globalThis as Record<string, unknown>)['pdfjsWorker'] = pdfjsWorker
GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs'

/** The PDF's text as lines, top to bottom, each page opened by a `--- page N` line. */
export async function pdfLines(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes, verbosity: 0 }).promise
  const out: string[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent()
    const rows = new Map<number, { x: number; s: string }[]>()
    for (const i of content.items as { str: string; transform: number[] }[]) {
      const y = Math.round(i.transform[5])
      rows.set(y, [...(rows.get(y) ?? []), { x: i.transform[4], s: i.str }])
    }
    out.push(`--- page ${p}`)
    for (const [, items] of [...rows].sort((a, b) => b[0] - a[0])) {
      const line = items.sort((a, b) => a.x - b.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim()
      if (line) out.push(line)
    }
  }
  return out
}
