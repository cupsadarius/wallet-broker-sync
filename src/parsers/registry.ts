import type { BrokerParser, ParserInput } from './types'
import { xtb } from './xtb'
import { ibkr } from './ibkr'
import { tradeville } from './tradeville'

export const parsers: Record<string, BrokerParser> = { xtb, ibkr, tradeville }

export function detectParser(input: ParserInput): BrokerParser | null {
  for (const p of Object.values(parsers)) {
    try { if (p.detect(input)) return p } catch {}
  }
  return null
}
