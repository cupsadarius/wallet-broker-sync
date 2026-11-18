import type { MoneyStatement, StatementParser } from '../types'
import { need, roDate, roNumber, toCents } from '../text'

// "Componenta de protecţie anuală / conform frecvenţei de plată 1,10 / 0,28 EURO" counts the first (yearly) number.
// Older statements say "Taxa" for "Cost" and "EUR" for "EURO".
const COST = /^(?:Cost|Componenta|Taxa)\b\D*?([\d.]+,\d+)(?: \/ [\d.,]+)? EURO?$/

/** Signal Iduna "101 Invest" account value: one snapshot per statement, in EUR. */
export const signal: StatementParser = {
  detect: lines => lines.some(l => l.includes('SIGNAL IDUNA')),
  parse(lines): MoneyStatement {
    if (!lines.some(l => l.startsWith('Valoarea contului'))) {
      throw new Error('This is a Signal Iduna anniversary letter, which has no premiums paid. Upload the "Situatie cont" statement instead.')
    }
    const costs = lines.flatMap(l => COST.exec(l)?.[1] ?? [])
    const total = need(lines, /^Valoarea total\S* a conturilor .* la data de:? (\d{2}\.\d{2}\.\d{4}) [\d.,]+ ([\d.]+,\d+)$/, 'account value')
    return {
      kind: 'unit-linked', provider: 'signal-iduna', product: '101 Invest',
      // The "/N" suffix changes between statements of the same policy.
      contract: need(lines, /^Poli\S* de asigurare nr\. (\d+)/, 'policy number')[1],
      currency: 'EUR',
      asOf: roDate(total[1]),
      value: toCents(roNumber(total[2])),
      paidIn: toCents(roNumber(need(lines, /^Total prime \S+ ([\d.]+,\d+) EURO?$/, 'premiums paid')[1])),
      fees: costs.length ? costs.reduce((sum, c) => sum + toCents(roNumber(c)), 0) : null,
      contributions: null, birthDate: null,
    }
  },
}
