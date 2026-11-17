import { describe, it, expect, vi } from 'vitest'

vi.mock('@/src/storage/db', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
  const db = drizzle(new Database(':memory:'))
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
  return { db, runMigrations: () => {} }
})
// A test "PDF" is the name of a fixture; anything else reads as an unknown layout.
const { pdfLines } = vi.hoisted(() => ({
  pdfLines: vi.fn(async (bytes: Uint8Array) => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const text = new TextDecoder().decode(bytes)
    // "broken:<fixture>" drops the first contribution row, so the footer total no longer matches.
    if (text.startsWith('broken:')) {
      const lines = readFileSync(join(__dirname, 'fixtures', text.slice(7)), 'utf8').split('\n')
      return lines.filter((l, i) => i !== lines.findIndex(x => x.startsWith('Alocare contributie')))
    }
    return text.startsWith('fixture:')
      ? readFileSync(join(__dirname, 'fixtures', text.slice(8)), 'utf8').split('\n')
      : ['Tradeville', 'Activity report']
  }),
}))
vi.mock('@/src/retirement/pdf', () => ({ pdfLines }))

import { POST } from '@/app/api/retirement/upload/route'

const upload = (files: [name: string, content: string][]) => {
  const form = new FormData()
  for (const [name, content] of files) form.append('file', new File([content], name))
  return POST(new Request('http://localhost/api/retirement/upload', { method: 'POST', body: form }))
}

describe('POST /api/retirement/upload', () => {
  it('saves a statement, skips the same file again, and leaves other PDFs to the broker flow', async () => {
    const res = await upload([['bt.pdf', 'fixture:bt-pilon2.txt'], ['bt copy.pdf', 'fixture:bt-pilon2.txt'], ['activity.pdf', 'x']])
    expect((await res.json()).results).toEqual([
      { file: 'bt.pdf', status: 'saved', kind: 'pilon2', provider: 'bt-pensia-noastra', asOf: '2026-09-30' },
      { file: 'bt copy.pdf', status: 'duplicate', kind: 'pilon2', provider: 'bt-pensia-noastra', asOf: '2026-09-30' },
      { file: 'activity.pdf', status: 'unsupported' },
    ])
  })

  it('never reads a file that is not a PDF', async () => {
    pdfLines.mockClear()
    const res = await upload([['statement.csv', 'fixture:bt-pilon3.txt']])
    expect((await res.json()).results).toEqual([])
    expect(pdfLines).not.toHaveBeenCalled()
  })

  it('reports a PDF it cannot read as unsupported, with the reason', async () => {
    const res = await upload([['unreadable.pdf', 'fixture:missing.txt']])
    expect((await res.json()).results[0]).toMatchObject({ file: 'unreadable.pdf', status: 'unsupported', error: expect.any(String) })
  })

  it('reports a recognized statement that fails its checks as failed, with the reason', async () => {
    const res = await upload([['bt broken.pdf', 'broken:bt-pilon2.txt']])
    expect((await res.json()).results[0]).toEqual({
      file: 'bt broken.pdf', status: 'failed', error: expect.stringMatching(/do not add up/),
    })
  })
})
