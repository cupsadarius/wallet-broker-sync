import { createHash } from 'node:crypto'
import { pdfLines } from '@/src/retirement/pdf'
import { parseStatement } from '@/src/retirement/parse'
import { saveStatement } from '@/src/retirement/store'

export type RetirementUploadResult = {
  file: string
  status: 'saved' | 'duplicate' | 'unsupported' | 'failed'
  kind?: string; provider?: string; asOf?: string; error?: string
}

/**
 * Pension and policy PDFs: each one is parsed and stored at once. A PDF no parser knows comes back `unsupported`;
 * a known statement that fails its checks comes back `failed` with the reason.
 */
export async function POST(req: Request) {
  const results: RetirementUploadResult[] = []
  for (const f of (await req.formData()).getAll('file')) {
    if (!(f instanceof File) || !f.name.toLowerCase().endsWith('.pdf')) continue
    const bytes = new Uint8Array(await f.arrayBuffer())
    // Hash first: pdfjs takes over the buffer it reads.
    const fileHash = createHash('sha256').update(bytes).digest('hex')
    const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))
    let lines: string[]
    try {
      lines = await pdfLines(bytes)
    } catch (e) {
      results.push({ file: f.name, status: 'unsupported', error: reason(e) })
      continue
    }
    try {
      const st = parseStatement(lines)
      if (!st) { results.push({ file: f.name, status: 'unsupported' }); continue }
      results.push({ file: f.name, status: await saveStatement(st, fileHash), kind: st.kind, provider: st.provider, asOf: st.asOf })
    } catch (e) {
      results.push({ file: f.name, status: 'failed', error: reason(e) })
    }
  }
  return Response.json({ results })
}
