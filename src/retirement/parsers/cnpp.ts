import type { Pilon1Statement, StatementParser } from '../types'
import { birthDateIn, need, roDate } from '../text'

/** CNPP report of contribution period and points (Pilon 1), from the CNPP online account. */
export const cnpp: StatementParser = {
  detect: lines => lines.some(l => l === 'RAPORT') && lines.some(l => l.includes('stagiului de cotizare si punctajului')),
  parse(lines): Pilon1Statement {
    const start = lines.findIndex(l => l.startsWith('DESFASURATOR ANUAL STAGII SI PUNCTAJE'))
    const end = lines.findIndex(l => l.startsWith('CENTRALIZATOR STAGII SI PUNCTAJE'))
    if (start < 0 || end < start) throw new Error('CNPP report has no yearly points table')
    // Year row: <year> <sum of monthly points> <yearly points> <months> ...
    const pointsByYear = lines.slice(start, end)
      .map(l => /^(\d{4}) ([\d.]+) ([\d.]+) \d+ /.exec(l))
      .filter(m => m !== null)
      .map(m => ({ year: Number(m[1]), points: Number(m[3]) }))
    const total = need(lines.slice(end), /^Total perioada (\d+) (\d+) (\d+) ([\d.]+) /, 'total period')
    return {
      kind: 'pilon1', provider: 'cnpp',
      asOf: roDate(need(lines, /^Datele au fost calculate la: (\d{2}\.\d{2}\.\d{4})/, 'calculation date')[1]),
      period: { years: Number(total[1]), months: Number(total[2]), days: Number(total[3]) },
      points: Number(total[4]),
      pointsByYear,
      birthDate: birthDateIn(lines),
    }
  },
}
