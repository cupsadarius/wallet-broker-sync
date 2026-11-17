import type { CouchClient } from '@/src/sync/couch'
import { ruleId } from './proposals'

export type Doc = Record<string, unknown> & { _id: string }
export type DocWriter = Pick<CouchClient, 'bulkDocs' | 'getDoc'>

/**
 * Writes `patch` onto existing docs, each with the `_rev` it was read with.
 * A conflicted doc is re-read and retried once; what still fails is returned in `failed`.
 */
export async function patchDocs(
  client: DocWriter, docs: Doc[], patch: Record<string, unknown>, now: string,
): Promise<{ written: Doc[]; failed: string[] }> {
  const written: Doc[] = []
  const failed: string[] = []
  const write = async (batch: Doc[], onConflict: (id: string) => void) => {
    const sent = batch.map(d => ({ ...d, ...patch, reservedUpdatedAt: now }))
    const results = new Map((await client.bulkDocs(sent)).map(r => [r.id, r]))
    for (const d of sent) {
      const r = results.get(d._id)
      if (r?.status === 'inserted') written.push({ ...d, _rev: r.rev })
      else if (r?.status === 'conflict') onConflict(d._id)
      else failed.push(d._id)
    }
  }
  const conflicted: string[] = []
  await write(docs, id => conflicted.push(id))
  if (conflicted.length) {
    const fresh: Doc[] = []
    for (const id of conflicted) {
      const d = await client.getDoc(id)
      if (d) fresh.push(d as Doc)
      else failed.push(id)
    }
    if (fresh.length) await write(fresh, id => failed.push(id))
  }
  return { written, failed }
}

export function magicRuleDoc(
  p: { name: string; keywords: string[]; categoryId: string }, ownerId: string, now: string,
): Doc {
  return {
    _id: ruleId(p.name, p.keywords),
    reservedModelType: 'MagicRule',
    reservedSource: 'wallet-broker-sync',
    reservedOwnerId: ownerId,
    reservedAuthorId: ownerId,
    reservedCreatedAt: now,
    reservedUpdatedAt: now,
    name: p.name,
    keywords: p.keywords,
    categoryId: p.categoryId,
    recordType: 1,
    sendPushNotification: false,
  }
}

/** Creates the rule; when its deterministic `_id` already exists, returns the stored doc instead. */
export async function writeRule(client: DocWriter, rule: Doc): Promise<Doc> {
  const [r] = await client.bulkDocs([rule])
  if (r?.status === 'inserted') return { ...rule, _rev: r.rev }
  const stored = r?.status === 'conflict' ? await client.getDoc(rule._id) : null
  if (!stored) throw new Error(`Wallet did not save the rule: ${r?.status === 'error' ? r.reason : 'unknown error'}`)
  return stored as Doc
}
