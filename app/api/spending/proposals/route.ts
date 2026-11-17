import { eq } from 'drizzle-orm'
import { readMirror } from '@/src/dashboards/mirror'
import { db } from '@/src/storage/db'
import { ruleProposal } from '@/src/storage/schema'
import { buildPrompt, parseProposals, requestRuleProposals, ruleId, selectCandidates } from '@/src/spending/proposals'

// A form posts here; 303 sends the phone back to the page with the outcome.
const back = (ai?: 'unavailable' | 'invalid' | 'none') =>
  new Response(null, { status: 303, headers: { Location: `/spending${ai ? `?ai=${ai}` : ''}#rules` } })

export async function POST() {
  const s = await readMirror()
  if (!s) return back('unavailable')
  const ctx = { records: s.records, rules: s.rules, byCategoryId: s.byCategoryId }
  const candidates = selectCandidates(s.records, { ...ctx, today: new Date().toISOString().slice(0, 10) })
  if (candidates.length === 0) return back('none')

  let reply: string
  try {
    reply = await requestRuleProposals(buildPrompt({ candidates, rules: s.rules, categories: s.categories }))
  } catch (e) {
    console.warn('[api/spending/proposals]', e instanceof Error ? e.message : e)
    return back('unavailable')
  }
  let proposals
  try { proposals = parseProposals(reply, ctx) } catch { return back('invalid') }

  const createdAt = new Date().toISOString()
  // A new run replaces the open proposals, so repeated runs do not stack near-copies.
  await db.delete(ruleProposal).where(eq(ruleProposal.status, 'open'))
  for (const p of proposals) {
    await db.insert(ruleProposal)
      .values({ id: ruleId(p.name, p.keywords), name: p.name, keywords: p.keywords, categoryId: p.categoryId, createdAt })
      .onConflictDoNothing()
  }
  return back(proposals.length ? undefined : 'none')
}
