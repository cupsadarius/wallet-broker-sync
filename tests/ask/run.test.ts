import { describe, it, expect } from 'vitest'
import { runTurn } from '@/src/ask/run'
import type { Opencode, Rule, OcEvent, OcMessage } from '@/src/ask/opencode'

// opencode's rule: the last matching rule wins; with no match, its base policy allows.
function allowed(rules: Rule[], action: string): boolean {
  const hit = rules.findLast(r => new RegExp(`^${r.action.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(action))
  return (hit?.effect ?? 'allow') === 'allow'
}

type Reply = { text: string; tools: string[]; fail?: boolean }

function fakeOpencode(research: Reply, answer: Reply) {
  const sessions: { id: string; rules: Rule[]; agent?: string }[] = []
  const prompts: { sid: string; text: string }[] = []
  const deleted: string[] = []
  let prompted: (sid: string) => void = () => {}
  const replyFor = (sid: string) => allowed(sessions.find(s => s.id === sid)?.rules ?? [], 'websearch') ? research : answer
  const oc: Opencode = {
    async createSession(_title, rules, agent) {
      const id = `ses_${sessions.length + 1}`
      sessions.push({ id, rules, agent })
      return id
    },
    async prompt(sid, text) { prompts.push({ sid, text }); prompted(sid) },
    async subscribe() {
      const next = new Promise<string>(r => { prompted = r })
      async function* gen(): AsyncGenerator<OcEvent> {
        const sid = await next
        const reply = replyFor(sid)
        yield { type: 'session.text.delta', data: { sessionID: 'other', delta: 'not mine' } }
        for (const name of reply.tools) yield { type: 'session.tool.input.started', data: { sessionID: sid, name } }
        yield { type: 'session.text.delta', data: { sessionID: sid, delta: reply.text } }
        yield { type: reply.fail ? 'session.execution.failed' : 'session.execution.succeeded', data: { sessionID: sid } }
      }
      return gen()
    },
    async messages(sid): Promise<OcMessage[]> {
      const reply = replyFor(sid)
      return [
        { type: 'user', text: 'old' },
        { type: 'assistant', content: [{ type: 'text', text: 'an older answer' }] },
        { type: 'user', text: 'q' },
        { type: 'assistant', content: reply.tools.map(name => ({ type: 'tool', name })) },
        { type: 'assistant', content: [{ type: 'text', text: reply.text }] },
        reply.fail ? { type: 'idle', outcome: 'failed', error: { message: 'usage limit' } } : { type: 'idle', outcome: 'succeeded' },
      ]
    },
    async deleteSession(sid) { deleted.push(sid) },
    async interrupt() {},
  }
  return { oc, sessions, prompts, deleted }
}

const WEB = { text: '- ECB rate 2% https://ecb.europa.eu', tools: ['websearch', 'webfetch'] }
const ANSWER = { text: 'Your cash earns 1.5 %.', tools: ['wallet_list_accounts'] }
const input = { sessionId: null, question: 'Does my cash beat the ECB rate?', earlier: [], today: '2026-11-17' }

describe('runTurn', () => {
  it('never puts web tools and wallet tools in one session', async () => {
    const f = fakeOpencode(WEB, ANSWER)
    await runTurn(f.oc, input, () => {})
    expect(f.sessions).toHaveLength(2)
    for (const s of f.sessions) {
      const web = allowed(s.rules, 'websearch') || allowed(s.rules, 'webfetch')
      expect(web && allowed(s.rules, 'wallet_list_accounts')).toBe(false)
    }
    const [research, answer] = f.sessions
    expect([allowed(research.rules, 'websearch'), allowed(research.rules, 'webfetch')]).toEqual([true, true])
    expect(['wallet_holdings', 'shell', 'execute', 'read'].some(a => allowed(research.rules, a))).toBe(false)
    expect(research.agent).toBeUndefined()
    expect(allowed(answer.rules, 'wallet_holdings')).toBe(true)
    expect(['websearch', 'webfetch', 'shell', 'execute', 'subagent'].some(a => allowed(answer.rules, a))).toBe(false)
    expect(answer.agent).toBe('wallet-sync')
  })

  it('gives the research session only the questions, then the answer session the research', async () => {
    const f = fakeOpencode(WEB, ANSWER)
    await runTurn(f.oc, { ...input, earlier: ['How much cash do I have?'] }, () => {})
    const [r, a] = f.prompts
    expect(r.sid).toBe('ses_1')
    expect(r.text).toContain(input.question)
    expect(r.text).toContain('How much cash do I have?')
    expect(a.sid).toBe('ses_2')
    expect(a.text).toContain(WEB.text)
    expect(a.text).toContain(input.question)
    expect(f.deleted).toEqual(['ses_1'])
  })

  it('returns the answer, the new session and the tools split by source', async () => {
    const f = fakeOpencode(WEB, ANSWER)
    const progress: unknown[] = []
    const r = await runTurn(f.oc, input, p => progress.push(p))
    expect(r).toEqual({
      sessionId: 'ses_2', text: ANSWER.text, spec: null,
      tools: { own: ['wallet_list_accounts'], web: ['websearch', 'webfetch'] },
    })
    expect(progress).toContainEqual({ type: 'tool', name: 'websearch', kind: 'web' })
    expect(progress).toContainEqual({ type: 'tool', name: 'wallet_list_accounts', kind: 'own' })
    expect(progress).toContainEqual({ type: 'delta', text: ANSWER.text })
    expect(progress).not.toContainEqual({ type: 'delta', text: WEB.text })
    expect(progress).not.toContainEqual({ type: 'delta', text: 'not mine' })
  })

  it('tells the answer step there is no research when the research step replies NONE', async () => {
    const f = fakeOpencode({ text: 'NONE', tools: [] }, ANSWER)
    const r = await runTurn(f.oc, input, () => {})
    expect(f.prompts[1].text).toMatch(/Web research: none/)
    expect(r.tools.web).toEqual([])
  })

  it('reuses the chat session for a follow-up and sends the instructions only once', async () => {
    const f = fakeOpencode({ text: 'NONE', tools: [] }, ANSWER)
    const first = await runTurn(f.oc, input, () => {})
    const second = await runTurn(f.oc, { ...input, sessionId: first.sessionId }, () => {})
    expect(second.sessionId).toBe(first.sessionId)
    const answerPrompts = f.prompts.filter(p => p.sid === first.sessionId)
    expect(answerPrompts).toHaveLength(2)
    expect(answerPrompts[0].text).toContain('wallet_')
    expect(answerPrompts[1].text).not.toContain('AVAILABLE COMPONENTS')
    expect(f.sessions.filter(s => s.agent === 'wallet-sync')).toHaveLength(1)
  })

  it('throws the run error when the answer step fails', async () => {
    const f = fakeOpencode({ text: 'NONE', tools: [] }, { ...ANSWER, fail: true })
    await expect(runTurn(f.oc, input, () => {})).rejects.toThrow('usage limit')
  })
})
