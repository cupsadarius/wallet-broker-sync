import type { Contribution, MoneyStatement, StatementParser } from '../types'
import { birthDateIn, need, roDate, roNumber, toCents } from '../text'

const NUM = '([\\d.]+,\\d+)'
const ROW = new RegExp(`^(?:Alocare contributie|Corectie alocare) (\\d{2}\\.\\d{2}\\.\\d{4}) ${NUM} ${NUM} `)

/** BT Pensia Noastră (Pilon 2) and BT Pensii "Pensia Mea" (Pilon 3): the full contribution history. */
export const bt: StatementParser = {
  detect: lines => lines.some(l => /Extras de cont Pensia (Noastra|Mea)/.test(l)),
  parse(lines): MoneyStatement {
    const pilon2 = lines.some(l => l.includes('Extras de cont Pensia Noastra'))
    const contributions: Contribution[] = []
    for (const l of lines) {
      const m = ROW.exec(l)
      // A "Corectie alocare" row that moves no money is not a contribution.
      if (m && roNumber(m[2]) !== 0) contributions.push({ date: roDate(m[1]), gross: toCents(roNumber(m[2])), fee: toCents(roNumber(m[3])) })
    }
    const paidIn = toCents(roNumber(need(lines, new RegExp(`^Valoare totala contributii brute ${NUM}`), 'total of contributions')[1]))
    if (contributions.reduce((s, c) => s + c.gross, 0) !== paidIn) {
      throw new Error('BT statement: the contributions do not add up to the footer total')
    }
    return {
      kind: pilon2 ? 'pilon2' : 'pilon3',
      provider: pilon2 ? 'bt-pensia-noastra' : 'bt-pensii',
      product: pilon2 ? 'Pensia Noastră' : 'Pensia Mea',
      contract: need(lines, /Numar act de aderare (\S+) din/, 'contract number')[1],
      currency: 'RON',
      asOf: roDate(need(lines, /^Informatii la (\d{2}\.\d{2}\.\d{4})/, 'statement date')[1]),
      value: toCents(roNumber(need(lines, new RegExp(`^Valoare cont ${NUM}`), 'account value')[1])),
      paidIn,
      fees: contributions.reduce((s, c) => s + c.fee, 0),
      contributions,
      birthDate: birthDateIn(lines),
    }
  },
}
