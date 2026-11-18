import type { CouchClient } from '@/src/sync/couch'
import { v5 as uuidv5 } from 'uuid'
import { NAMESPACE_WALLET_SYNC } from '@/src/sync/namespace'
import { ruleId } from './proposals'

export type Doc = Record<string, unknown> & { _id: string }
export type DocWriter = Pick<CouchClient, 'bulkDocs' | 'getDoc'>

/**
 * Writes `patch` onto existing docs, each with the `_rev` it was read with.
 * A conflicted doc is re-read and retried once; what still fails is returned in `failed`.
 * A function patch is built again from the re-read doc.
 */
export async function patchDocs(
  client: DocWriter, docs: Doc[], patch: Record<string, unknown> | ((d: Doc) => Record<string, unknown>), now: string,
): Promise<{ written: Doc[]; failed: string[] }> {
  const written: Doc[] = []
  const failed: string[] = []
  const write = async (batch: Doc[], onConflict: (id: string) => void) => {
    const sent = batch.map(d => ({ ...d, ...(typeof patch === 'function' ? patch(d) : patch), reservedUpdatedAt: now }))
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

/**
 * Makes a Wallet transfer: with a counterpart doc, both legs; with an account id, a single leg to that account.
 * The transferId comes from the record ids, so a retry writes the same transfer.
 */
export function markTransfer(client: DocWriter, record: Doc, other: Doc | string, transferCategoryId: string, now: string) {
  const docs = typeof other === 'string' ? [record] : [record, other]
  const transferId = uuidv5(`transfer:${docs.map(d => d._id).sort().join('|')}`, NAMESPACE_WALLET_SYNC)
  const otherAccount = (d: Doc) =>
    typeof other === 'string' ? other : String(d._id === record._id ? other.accountId : record.accountId)
  return patchDocs(client, docs, d => ({
    transfer: true, transferId, transferAccountId: otherAccount(d),
    categoryId: transferCategoryId, categoryChanged: true, categoryConfirmReason: 3,
  }), now)
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

/** Deletes the rule in Wallet with a CouchDB tombstone; a rule changed since it was read is left alone. */
export async function deleteRule(client: DocWriter, rule: Doc): Promise<void> {
  const [r] = await client.bulkDocs([{ _id: rule._id, _rev: rule._rev, _deleted: true }])
  if (r?.status === 'inserted') return
  throw new Error(r?.status === 'conflict'
    ? 'The rule changed in Wallet since this page loaded. Reload and try again.'
    : `Wallet did not delete the rule: ${r?.status === 'error' ? r.reason : 'unknown error'}`)
}
