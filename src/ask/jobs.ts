import { sendPush } from '@/src/push/push'
import { createClient } from './opencode'
import { runTurn, type Progress, type Tools } from './run'
import { finishMessage, getChat, getMessage, setChatSession, type AskMessage } from './store'

export type Snapshot = { type: 'snapshot'; phase: 'research' | 'answer'; text: string; tools: Tools }
export type JobEvent = Progress | Snapshot | { type: 'done'; message: AskMessage }
type Job = Omit<Snapshot, 'type'> & { listeners: Set<(e: JobEvent) => void> }

// Route handlers may load this module more than once; the running jobs live on globalThis.
const g = globalThis as typeof globalThis & { askJobs?: Map<number, Job> }
const jobs = (g.askJobs ??= new Map<number, Job>())

/** Runs one question to the end, whoever listens; the answer lands in the DB and a push says it is ready. */
export async function runJob(chatId: number, messageId: number, question: string): Promise<void> {
  const job: Job = { phase: 'research', text: '', tools: { own: [], web: [] }, listeners: new Set() }
  jobs.set(messageId, job)
  const emit = (e: Progress) => {
    if (e.type === 'phase') job.phase = e.phase
    else if (e.type === 'delta') job.text += e.text
    else if (!job.tools[e.kind].includes(e.name)) job.tools[e.kind].push(e.name)
    job.listeners.forEach(l => l(e))
  }
  let ok = false
  try {
    const chat = await getChat(chatId)
    if (!chat) throw new Error(`No chat ${chatId}`)
    const earlier = chat.messages.filter(m => m.role === 'user' && m.id < messageId).map(m => m.text).slice(0, -1)
    const r = await runTurn(createClient(), { sessionId: chat.sessionId, question, earlier, today: new Date().toISOString().slice(0, 10) }, emit)
    if (!chat.sessionId) await setChatSession(chatId, r.sessionId)
    await finishMessage(messageId, { status: 'done', text: r.text, spec: r.spec, tools: r.tools })
    ok = true
  } catch (err) {
    console.error('[ask]', err)
    await finishMessage(messageId, { status: 'failed', text: `The answer failed: ${(err as Error).message}`, spec: null, tools: job.tools })
  } finally {
    jobs.delete(messageId)
  }
  const message = await getMessage(messageId)
  if (message) job.listeners.forEach(l => l({ type: 'done', message }))
  await sendPush({ title: ok ? 'Answer ready' : 'Answer failed', body: question.slice(0, 120), url: `/ask?chat=${chatId}` })
    .catch(err => console.error('[ask] push', err))
}

/** Sends the job's state so far, then each event; null when no job runs for this message. */
export function watch(messageId: number, listener: (e: JobEvent) => void): (() => void) | null {
  const job = jobs.get(messageId)
  if (!job) return null
  listener({ type: 'snapshot', phase: job.phase, text: job.text, tools: { own: [...job.tools.own], web: [...job.tools.web] } })
  job.listeners.add(listener)
  return () => job.listeners.delete(listener)
}
