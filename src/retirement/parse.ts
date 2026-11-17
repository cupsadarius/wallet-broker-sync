import type { Statement, StatementParser } from './types'
import { bt } from './parsers/bt'
import { allianz } from './parsers/allianz'
import { signal } from './parsers/signal'
import { cnpp } from './parsers/cnpp'

export { birthDateFromCnp, roDate, roNumber, toCents } from './text'

const PARSERS: StatementParser[] = [bt, allianz, signal, cnpp]

/** The statement in these lines, or null when no parser knows the layout. Throws on a known but broken layout. */
export function parseStatement(lines: string[]): Statement | null {
  const p = PARSERS.find(p => p.detect(lines))
  return p ? p.parse(lines) : null
}
