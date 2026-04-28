/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CouchClient } from '@/src/sync/couch'

describe('CouchClient', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  const client = () => new CouchClient({
    url: 'https://example.test', dbName: 'bb-user',
    auth: { login: 'user', token: 'secret' },
  })

  it('bulkDocs sends new_edits=true and returns per-doc result', async () => {
    ;(fetch as any).mockResolvedValueOnce(new Response(JSON.stringify([
      { id: 'a', ok: true, rev: '1-x' },
      { id: 'b', error: 'conflict', reason: 'Document update conflict.' },
    ]), { status: 201 }))
    const res = await client().bulkDocs([{ _id: 'a' }, { _id: 'b' }] as any)
    expect(res).toEqual([
      { id: 'a', status: 'inserted', rev: '1-x' },
      { id: 'b', status: 'conflict' },
    ])
    const call = (fetch as any).mock.calls[0]
    expect(call[0]).toBe('https://example.test/bb-user/_bulk_docs')
    expect(JSON.parse(call[1].body)).toMatchObject({ new_edits: true })
  })

  it('throws on 401', async () => {
    ;(fetch as any).mockResolvedValueOnce(new Response('unauth', { status: 401 }))
    await expect(client().bulkDocs([{ _id: 'a' }])).rejects.toMatchObject({ kind: 'unauthorized' })
  })

  it('bulkDocs short-circuits on empty input without calling fetch', async () => {
    const res = await client().bulkDocs([])
    expect(res).toEqual([])
    expect((fetch as any).mock.calls.length).toBe(0)
  })

  it('listAssetTransactions paginates _changes until last_seq stops moving', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: '-AssetTransaction_1', doc: { _id: '-AssetTransaction_1', reservedModelType: 'AssetTransaction', accountId: 'A' } }],
        last_seq: 100,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [], last_seq: 100 })))
    const docs = await client().listAssetTransactions('A')
    expect(docs).toHaveLength(1)
    expect(docs[0]._id).toBe('-AssetTransaction_1')
  })

  it('listAssetTransactions terminates when last_seq advances but predicate filters everything', async () => {
    ;(fetch as any)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: 'x', doc: { _id: 'x', reservedModelType: 'Other', accountId: 'A' } }],
        last_seq: 1,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: 'y', doc: { _id: 'y', reservedModelType: 'Other', accountId: 'A' } }],
        last_seq: 2,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [], last_seq: 2 })))
    const docs = await client().listAssetTransactions('A')
    expect(docs).toHaveLength(0)
    expect((fetch as any).mock.calls.length).toBeLessThanOrEqual(3)
  })
})
