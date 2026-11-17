import type { Spec } from '@json-render/core'
import { OpencodeError, type Opencode, type OcMessage, type Rule } from './opencode'
import { answerInstructions, splitAnswer } from './answer'

export type Tools = { own: string[]; web: string[] }
export type Progress =
  | { type: 'phase'; phase: 'research' | 'answer' }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; kind: keyof Tools }
export type Turn = { sessionId: string | null; question: string; earlier: string[]; today: string }
export type TurnResult = { sessionId: string; text: string; spec: Spec | null; tools: Tools }

// Two sessions per question, so web tools and money data never meet (rules: the last match wins).
// The research step sees only the questions; the answer step sees the money data and no web.
export const RESEARCH_RULES: Rule[] = [
  { action: '*', resource: '*', effect: 'deny' },
  { action: 'websearch', resource: '*', effect: 'allow' },
  { action: 'webfetch', resource: '*', effect: 'allow' },
  { action: 'wallet_*', resource: '*', effect: 'deny' },
]
export const ANSWER_RULES: Rule[] = [
  { action: '*', resource: '*', effect: 'deny' },
  { action: 'wallet_*', resource: '*', effect: 'allow' },
]
// Defined in body-ledger's opencode.json: its rules allow wallet_* after the config-wide deny.
export const ANSWER_AGENT = 'wallet-sync'
const RUN_TIMEOUT_MS = 15 * 60_000

const research = (t: Turn) => `Someone asks a personal finance question (below). You see only their questions, none of their data.
Decide if a good answer needs facts from outside their own records: market prices, interest, inflation or exchange rates, fund, ETF or bond terms, taxes, rules, news.
- If it does: search the web (websearch), read the best pages (webfetch), then reply with the facts as short bullet points, each ending with its source URL. Prefer official and primary sources. Do not answer the question itself.
- If it does not: call no tools and reply with exactly NONE.
Today: ${t.today}.
${t.earlier.length ? `Earlier questions in this conversation:\n${t.earlier.map(q => `- ${q}`).join('\n')}\n` : ''}Question: ${t.question}`

const INTRO = `You answer questions about the user's own money in Wallet Sync, a personal finance app.
- Get the user's data with the wallet_* tools: accounts and balances, records, holdings, performance, net worth, spending, categories, rules, prices, FX. Call wallet_data_freshness when the age of the data matters.
- You have no web tools. When the question needs outside facts, they come in the "Web research" block; cite its URLs.
- Use only numbers from the tools and the web research. If data is missing, say so.
- Write in English, short: at most 4 short paragraphs of plain text, no Markdown. Give the currency of every amount.`

const answer = (t: Turn, facts: string, first: boolean) =>
  `${first ? `${INTRO}\n\n${answerInstructions()}\n\n` : ''}Today: ${t.today}.\nWeb research: ${facts || 'none'}\n\nQuestion: ${t.question}`

export async function runTurn(oc: Opencode, t: Turn, emit: (p: Progress) => void): Promise<TurnResult> {
  emit({ type: 'phase', phase: 'research' })
  const rid = await oc.createSession('wallet-sync research', RESEARCH_RULES)
  let facts: { text: string; tools: string[] }
  try {
    facts = await runPrompt(oc, rid, research(t), name => emit({ type: 'tool', name, kind: 'web' }))
  } finally {
    await oc.deleteSession(rid).catch(() => {})
  }
  const found = facts.text.trim() === 'NONE' ? '' : facts.text.trim()

  emit({ type: 'phase', phase: 'answer' })
  const sid = t.sessionId ?? await oc.createSession('wallet-sync ask', ANSWER_RULES, ANSWER_AGENT)
  const out = await runPrompt(oc, sid, answer(t, found, !t.sessionId), name => emit({ type: 'tool', name, kind: 'own' }),
    text => emit({ type: 'delta', text }))
  return { sessionId: sid, ...splitAnswer(out.text), tools: { own: out.tools, web: facts.tools } }
}

/** One tool-free prompt, for jobs that send the data in the prompt itself. */
export async function complete(oc: Opencode, text: string): Promise<string> {
  const sid = await oc.createSession('wallet-sync job', [{ action: '*', resource: '*', effect: 'deny' }])
  try {
    return (await runPrompt(oc, sid, text, () => {})).text
  } finally {
    await oc.deleteSession(sid).catch(() => {})
  }
}

/** Sends one prompt and follows the server's events until that session's run ends; the result comes from its messages. */
async function runPrompt(oc: Opencode, sid: string, text: string, onTool: (name: string) => void, onDelta?: (text: string) => void) {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), RUN_TIMEOUT_MS)
  try {
    const events = await oc.subscribe(stop.signal)
    await oc.prompt(sid, text)
    for await (const e of events) {
      if (e.data.sessionID !== sid) continue
      if (e.type === 'session.tool.input.started') onTool(String(e.data.name))
      else if (e.type === 'session.text.delta') onDelta?.(String(e.data.delta))
      else if (e.type === 'session.text.started') onDelta?.('\n\n')
      else if (e.type.startsWith('session.execution.') && e.type !== 'session.execution.started') break
    }
  } catch (err) {
    if (stop.signal.aborted) {
      await oc.interrupt(sid).catch(() => {})
      throw new OpencodeError('The answer took too long.')
    }
    throw err
  } finally {
    clearTimeout(timer)
    stop.abort()
  }
  return lastTurn(await oc.messages(sid))
}

function lastTurn(messages: OcMessage[]): { text: string; tools: string[] } {
  const end = messages.at(-1)
  if (end?.type !== 'idle' || end.outcome !== 'succeeded') throw new OpencodeError(end?.error?.message || 'The run did not finish.')
  const turn = messages.slice(messages.findLastIndex(m => m.type === 'user') + 1).filter(m => m.type === 'assistant')
  const texts = turn.map(m => (m.content ?? []).filter(p => p.type === 'text').map(p => p.text ?? '').join('')).filter(Boolean)
  const tools = turn.flatMap(m => (m.content ?? []).filter(p => p.type === 'tool').map(p => p.name ?? ''))
  return { text: texts.at(-1) ?? '', tools: [...new Set(tools)] }
}
