import type { BrokerParser, ParserInput } from './types'
import { xtb } from './xtb'

export const parsers: Record<string, BrokerParser> = { xtb }

export function detectParser(input: ParserInput): BrokerParser | null {
  for (const p of Object.values(parsers)) {
    try { if (p.detect(input)) return p } catch {}
  }
  return null
}
