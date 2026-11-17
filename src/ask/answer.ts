import { applySpecStreamPatch, validateSpec, type Spec } from '@json-render/core'
import { catalog } from './catalog'

const FENCE = /```spec[^\n]*\n([\s\S]*?)(?:```|$)/

const components = (() => {
  const p = catalog.prompt()
  return p.slice(p.indexOf('AVAILABLE COMPONENTS ('), p.indexOf('AVAILABLE ACTIONS')).trim()
})()

/** How the answer step writes its reply: text, then an optional spec of catalog components. */
export function answerInstructions(): string {
  return `ANSWER FORMAT
Write the answer as plain text first. Add a UI spec only when a chart or a table makes the answer clearer.
A UI spec goes after the text, in a \`\`\`spec code fence, one JSON Patch (RFC 6902) operation per line:
\`\`\`spec
{"op":"add","path":"/root","value":"main"}
{"op":"add","path":"/elements/main","value":{"type":"Card","props":{"title":"Cash by month"},"children":["chart"]}}
{"op":"add","path":"/elements/chart","value":{"type":"BarChart","props":{"data":[{"month":"2026-10","ron":1200}],"xKey":"month","series":[{"key":"ron","label":"Cash"}],"unit":"RON"},"children":[]}}
\`\`\`
Rules for the spec:
- Set /root first, then add each element under /elements/<key>.
- Every element has "type", "props" and "children" (use [] for a leaf). Every child key must exist.
- Props are literal values only: no $state, $item or other expressions, no "on", "visible", "repeat" or "state".
- Use only real numbers from your tools and the research. Never invent sample data.
${components}`
}

export type Answer = { text: string; spec: Spec | null }

/** The reply split into its text and its spec; a spec that fails validation is dropped, so the text alone shows. */
export function splitAnswer(raw: string): Answer {
  const m = FENCE.exec(raw)
  if (!m) return { text: raw.trim(), spec: null }
  const text = [raw.slice(0, m.index), raw.slice(m.index + m[0].length)].map(s => s.trim()).filter(Boolean).join('\n\n')
  return { text, spec: parseSpec(m[1]) }
}

function parseSpec(jsonl: string): Spec | null {
  const spec: Record<string, unknown> = { root: '', elements: {} }
  try {
    for (const line of jsonl.split('\n').map(l => l.trim()).filter(Boolean)) applySpecStreamPatch(spec, JSON.parse(line))
  } catch {
    return null
  }
  return validSpec(spec)
}

export function validSpec(spec: unknown): Spec | null {
  const parsed = catalog.validate(spec)
  if (!parsed.success || !validateSpec(parsed.data as Spec).valid) return null
  const s = parsed.data as Spec
  const defs = catalog.data.components as Record<string, { props: { safeParse(v: unknown): { success: boolean } } }>
  const ok = Object.values(s.elements).every(el => defs[el.type]?.props.safeParse(el.props).success)
  return ok ? s : null
}
