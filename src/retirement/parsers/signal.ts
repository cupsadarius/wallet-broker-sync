import type { MoneyStatement, StatementParser } from '../types'
import { need, roDate, roNumber, toCents } from '../text'

// "Componenta de protecţie anuală / conform frecvenţei de plată 1,10 / 0,28 EURO" counts the first (yearly) number.
const COST = /^(?:Cost|Componenta)\b\D*?([\d.]+,\d+)(?: \/ [\d.,]+)? EURO$/

/** Signal Iduna "101 Invest" account value: one snapshot per statement, in EUR. */
export const signal: StatementParser = {
  detect: lines => lines.some(l => l.includes('SIGNAL IDUNA')) && lines.some(l => l.startsWith('Valoarea contului')),
  parse(lines): MoneyStatement {
    const total = need(lines, /^Valoarea total\S* a conturilor .* la data de (\d{2}\.\d{2}\.\d{4}) [\d.,]+ ([\d.]+,\d+)$/, 'account value')
    return {
      kind: 'unit-linked', provider: 'signal-iduna', product: '101 Invest',
      contract: need(lines, /^Poli\S* de asigurare nr\. (\S+)/, 'policy number')[1],
      currency: 'EUR',
      asOf: roDate(total[1]),
      value: toCents(roNumber(total[2])),
      paidIn: toCents(roNumber(need(lines, /^Total prime \S+ ([\d.]+,\d+) EURO/, 'premiums paid')[1])),
      fees: lines.map(l => COST.exec(l)).reduce((sum, m) => sum + (m ? toCents(roNumber(m[1])) : 0), 0),
      contributions: null, birthDate: null,
    }
  },
}
