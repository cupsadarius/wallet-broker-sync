import { createClient } from '@/src/ask/opencode'
import { complete } from '@/src/ask/run'
import { v5 as uuidv5 } from 'uuid'
import { z } from 'zod'
import type { MirrorCategory, MirrorRecord, MirrorRule } from '@/src/dashboards/mirror'
import { NAMESPACE_WALLET_SYNC } from '@/src/sync/namespace'
import { maskDeep } from '@/src/mcp/mask'
import { reviewable } from './review'

export type Proposal = {
  name: string
  keywords: string[]
  categoryId: string
  matchedExamples: string[]
  pastMatchCount: number
}

export type Candidate = { key: string; label: string; count: number; categoryName?: string; examples: string[] }

const DAY_MS = 86_400_000
const UNCATEGORIZED_DAYS = 365
const RECATEGORIZED_DAYS = 90
const MAX_CANDIDATES = 40
const MAX_EXAMPLES = 3

// A card payment note from the bank: "...TID:<terminal> <MERCHANT> RO 00001111 valoare tranzactie...".
const CARD_NOTE = /TID:?\s*\S+\s+(.+?)(?:\s{2,}|\s+[A-Z]{2,3}\s+\d{6,}|\s+valoare tranzactie|;|$)/i

export function payeeLabel(r: Pick<MirrorRecord, 'payee' | 'note'>): string {
  if (r.payee?.trim()) return r.payee.trim()
  const note = r.note?.trim() ?? ''
  return note.match(CARD_NOTE)?.[1].trim() || note
}

export function groupKey(r: Pick<MirrorRecord, 'payee' | 'note'>): string {
  return payeeLabel(r).toLowerCase().split(/\s+/).filter(t => !/\d/.test(t)).join(' ')
}

// razor: assumes Wallet matches any keyword as a case-insensitive substring of payee or note; unverified.
export function ruleMatches(keywords: string[], r: Pick<MirrorRecord, 'payee' | 'note'>): boolean {
  const text = `${r.payee ?? ''}\n${r.note ?? ''}`.toLowerCase()
  return keywords.some(k => k.trim() !== '' && text.includes(k.trim().toLowerCase()))
}

const isSpend = (r: MirrorRecord) => reviewable(r) && r.recordType === 1

export function matchingRecords(records: MirrorRecord[], keywords: string[]): MirrorRecord[] {
  return records.filter(r => isSpend(r) && ruleMatches(keywords, r))
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate))
}

export function isUncategorized(r: MirrorRecord, byCategoryId: Map<string, MirrorCategory>): boolean {
  const c = r.categoryId ? byCategoryId.get(r.categoryId) : undefined
  return !c || c.groupName === 'Unknown' || c.envelopeId === 20003
}

const examples = (records: MirrorRecord[]) => [...new Set(records.map(payeeLabel))].slice(0, MAX_EXAMPLES)

export function selectCandidates(
  records: MirrorRecord[],
  ctx: { byCategoryId: Map<string, MirrorCategory>; rules: MirrorRule[]; today: string },
): Candidate[] {
  const since = (days: number) => new Date(Date.parse(ctx.today) - days * DAY_MS).toISOString().slice(0, 10)
  const groups = new Map<string, MirrorRecord[]>()
  for (const r of [...records].sort((a, b) => b.recordDate.localeCompare(a.recordDate))) {
    if (!isSpend(r) || ctx.rules.some(rule => ruleMatches(rule.keywords, r))) continue
    const uncategorized = isUncategorized(r, ctx.byCategoryId) && r.recordDate >= since(UNCATEGORIZED_DAYS)
    const recategorized = !!r.originalCategoryId && r.originalCategoryId !== r.categoryId
      && r.recordDate >= since(RECATEGORIZED_DAYS)
    if (!uncategorized && !recategorized) continue
    const key = groupKey(r)
    if (key) groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups]
    .map(([key, rs]) => ({
      key, label: payeeLabel(rs[0]), count: rs.length, examples: examples(rs),
      categoryName: rs[0].categoryId ? ctx.byCategoryId.get(rs[0].categoryId)?.name : undefined,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, MAX_CANDIDATES)
}

export function buildPrompt(input: { candidates: Candidate[]; rules: MirrorRule[]; categories: MirrorCategory[] }): string {
  const json = (v: unknown) => JSON.stringify(maskDeep(v))
  const categoryName = new Map(input.categories.map(c => [c.id, c.name]))
  return [
    'You propose BudgetBakers Wallet record rules. A rule sets a category on every expense whose payee or note',
    'contains one of its keywords (case-insensitive). Propose rules only for payees that recur or clearly belong to one',
    'category. Keywords must be literal text from the examples, without masked digits (****). Do not repeat or',
    'contradict an existing rule. Use only category ids from the list.',
    'Reply with JSON only: {"proposals":[{"name":"...","keywords":["..."],"categoryId":"..."}]}',
    '',
    'Payees without a category, or that the user recategorized recently (count = records):',
    ...input.candidates.map(c => json({ payee: c.label, count: c.count, examples: c.examples, category: c.categoryName ?? null })),
    '',
    'Existing rules:',
    ...input.rules.map(r => json({ name: r.name, keywords: r.keywords, category: r.categoryId ? categoryName.get(r.categoryId) ?? null : null })),
    '',
    'Categories:',
    ...input.categories.map(c => JSON.stringify({ id: c.id, group: c.groupName, name: c.name })),
  ].join('\n')
}

const RawProposal = z.object({
  name: z.string().trim().min(1).max(80),
  keywords: z.array(z.string().trim().min(3).max(120)).min(1).max(5),
  categoryId: z.string().min(1),
})

function contradicts(p: z.infer<typeof RawProposal>, rules: MirrorRule[], records: MirrorRecord[]): boolean {
  const lower = (s: string) => s.trim().toLowerCase()
  const overlap = rules.some(rule => rule.keywords.some(rk => p.keywords.some(k =>
    lower(rk).includes(lower(k)) || lower(k).includes(lower(rk)))))
  return overlap || records.some(r => ruleMatches(p.keywords, r)
    && rules.some(rule => rule.categoryId !== p.categoryId && ruleMatches(rule.keywords, r)))
}

/** The `proposals` array of the JSON object in a model reply. */
export function replyProposals(text: string): unknown[] {
  let body: unknown
  try { body = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch {
    throw new Error('AI reply has no JSON')
  }
  const list = z.object({ proposals: z.array(z.unknown()) }).safeParse(body)
  if (!list.success) throw new Error('AI reply JSON has no proposals list')
  return list.data.proposals
}

/** Parses the model reply; drops what Wallet would reject or what clashes with existing rules. */
export function parseProposals(
  text: string,
  ctx: { records: MirrorRecord[]; rules: MirrorRule[]; byCategoryId: Map<string, MirrorCategory> },
): Proposal[] {
  const out = new Map<string, Proposal>()
  for (const item of replyProposals(text)) {
    const p = RawProposal.safeParse(item)
    if (!p.success || !ctx.byCategoryId.has(p.data.categoryId)) continue
    if (contradicts(p.data, ctx.rules, ctx.records)) continue
    const matches = matchingRecords(ctx.records, p.data.keywords)
    if (matches.length === 0) continue
    out.set(ruleId(p.data.name, p.data.keywords), {
      ...p.data, pastMatchCount: matches.length, matchedExamples: examples(matches),
    })
  }
  return [...out.values()]
}

/** Same name and keywords give the same `_id`, so a retried approve never makes a second rule. */
export function ruleId(name: string, keywords: string[]): string {
  const norm = (s: string) => s.trim().toLowerCase()
  return `-MagicRule_${uuidv5(`magic-rule:${norm(name)}|${keywords.map(norm).sort().join('|')}`, NAMESPACE_WALLET_SYNC)}`
}

export async function requestRuleProposals(prompt: string): Promise<string> {
  return complete(createClient(), prompt)
}
