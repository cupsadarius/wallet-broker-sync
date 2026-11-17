import type { MoneyStatement, StatementParser } from '../types'
import { need, roDate, roNumber, toCents } from '../text'

/** Allianz-Țiriac "Dinamic Invest" account report: one snapshot per statement, in RON. */
export const allianz: StatementParser = {
  detect: lines => lines.some(l => l.includes('Scrisoare de Raport Cont')) && lines.some(l => l.includes('Allianz-Tiriac')),
  parse(lines): MoneyStatement {
    const fees = lines
      .map(l => /^Taxa de [^:]+: ([\d.]+,\d+) RON/.exec(l))
      .reduce((sum, m) => sum + (m ? toCents(roNumber(m[1])) : 0), 0)
    return {
      kind: 'unit-linked', provider: 'allianz', product: 'Dinamic Invest',
      contract: need(lines, /Polita dvs\. nr\. (\S+)/, 'policy number')[1],
      currency: 'RON',
      asOf: roDate(need(lines, /^Investitie, la data (\d{2}-\d{2}-\d{4})/, 'statement date')[1]),
      value: toCents(roNumber(need(lines, /^TOTAL ([\d.]+,\d+)/, 'account value')[1])),
      paidIn: toCents(roNumber(need(lines, /Total sume destinate investirii[^:]*: ([\d.]+,\d+) RON/, 'amount paid in')[1])),
      fees, contributions: null, birthDate: null,
    }
  },
}
