import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

async function main() {
  const path = process.argv[2]
  if (!path) { console.error('usage: tsx scripts/pdf-dump.ts <pdf-path>'); process.exit(1) }
  const buf = readFileSync(path)
  const pdf = await getDocument({ data: new Uint8Array(buf) }).promise
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const x = Math.round(item.transform[4])
      const y = Math.round(item.transform[5])
      console.log(JSON.stringify({ page: p, x, y, text: item.str }))
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
