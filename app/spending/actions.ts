'use server'

import { refresh } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/src/storage/db'
import { ruleProposal } from '@/src/storage/schema'
import { loadCouchCreds } from '@/src/storage/credentials'
import { buildCouchContext, readMirror, writeConfig } from '@/src/dashboards/mirror'
import { cacheDocs, cachedDocs } from '@/src/sync/couch-cache'
import { formatError } from '@/src/sync/format-error'
import { matchingRecords } from '@/src/spending/proposals'
import { magicRuleDoc, patchDocs, writeRule } from '@/src/spending/write'
import { readReviewState, REVIEW_ACCEPTED_KEY, REVIEW_CURSOR_KEY } from '@/src/spending/load'

export type ActionState = { error?: string } | null

export async function acceptRecord(form: FormData) {
  const id = z.string().min(1).parse(form.get('id'))
  const { accepted } = await readReviewState()
  await writeConfig(REVIEW_ACCEPTED_KEY, JSON.stringify([...new Set([...accepted, id])]))
  refresh()
}

export async function acceptAll(form: FormData) {
  const upTo = z.iso.datetime().parse(form.get('upTo'))
  await writeConfig(REVIEW_CURSOR_KEY, upTo)
  await writeConfig(REVIEW_ACCEPTED_KEY, '[]')
  refresh()
}

export async function rejectProposal(form: FormData) {
  const id = z.string().min(1).parse(form.get('id'))
  await db.update(ruleProposal).set({ status: 'rejected' }).where(eq(ruleProposal.id, id))
  refresh()
}

async function walletContext() {
  const [ctx, snapshot] = await Promise.all([buildCouchContext(), readMirror()])
  if (!ctx || !snapshot) throw new Error('Wallet is not connected')
  return { ...ctx, snapshot }
}

/** Sets one record's category in Wallet. */
export async function changeCategory(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { recordId, categoryId } = z.object({ recordId: z.string().min(1), categoryId: z.string().min(1) })
      .parse(Object.fromEntries(form))
    const { client, scope, snapshot } = await walletContext()
    if (!snapshot.byCategoryId.has(categoryId)) return { error: 'Unknown category' }
    const docs = await cachedDocs(scope, [recordId])
    if (docs.length === 0) return { error: 'Record not found' }
    const { written, failed } = await patchDocs(client, docs, { categoryId }, new Date().toISOString())
    await cacheDocs(scope, written)
    refresh()
    return failed.length ? { error: 'Wallet changed this record at the same time. Try again.' } : null
  } catch (e) {
    return { error: formatError(e).message }
  }
}

/** Writes the rule, then sets its category on exactly the ticked past records. */
export async function approveProposal(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const id = z.string().min(1).parse(form.get('id'))
    const ticked = new Set(form.getAll('recordId').map(String))
    const [p] = await db.select().from(ruleProposal).where(eq(ruleProposal.id, id))
    if (!p || p.status !== 'open') return { error: 'This proposal is gone' }
    const [{ client, scope, snapshot }, creds] = await Promise.all([walletContext(), loadCouchCreds()])
    if (!creds) throw new Error('Wallet is not connected')
    if (!snapshot.byCategoryId.has(p.categoryId)) return { error: 'The category no longer exists' }

    const now = new Date().toISOString()
    await cacheDocs(scope, [await writeRule(client, magicRuleDoc(p, creds.login, now))])
    const ids = matchingRecords(snapshot.records, p.keywords).map(r => r.id).filter(rid => ticked.has(rid))
    const { written, failed } = await patchDocs(client, await cachedDocs(scope, ids), { categoryId: p.categoryId }, now)
    await cacheDocs(scope, written)
    await db.update(ruleProposal).set({ status: 'approved' }).where(eq(ruleProposal.id, id))
    refresh()
    return failed.length ? { error: `Rule saved. ${failed.length} record(s) changed in Wallet at the same time; set them by hand.` } : null
  } catch (e) {
    return { error: formatError(e).message }
  }
}
