import { describe, it, expect } from 'vitest'
import { categorySpikes, categoryTotals, idleBrokerCash, type SpendContext } from '@/src/insights/cards'
import type { MirrorAssetTransaction, MirrorCategory, MirrorRecord } from '@/src/dashboards/mirror'

const categories: MirrorCategory[] = [
  { id: 'groceries', name: 'Groceries', envelopeId: 1000, groupName: 'Food & Drinks' },
  { id: 'fuel', name: 'Fuel', envelopeId: 5000, groupName: 'Vehicle' },
  { id: 'salary', name: 'Salary', envelopeId: 10000, groupName: 'Income' },
  { id: 'savings', name: 'Savings', envelopeId: 9000, groupName: 'Investments' },
]

function rec(p: Partial<MirrorRecord> & { id: string; recordDate: string }): MirrorRecord {
  return {
    accountId: 'bt', categoryId: 'groceries', amount: 10_000, recordType: 1, currencyCode: 'RON',
    isTradeFallback: false, transfer: false, bankSynced: true, ...p,
  }
}

const ctx: SpendContext = { byCategoryId: new Map(categories.map(c => [c.id, c])), amount: r => r.amount / 100 }

describe('categoryTotals', () => {
  it('nets refunds per category and leaves out transfers, trade records, income and investments', () => {
    const t = categoryTotals([
      rec({ id: 'a', recordDate: '2026-11-02', amount: 30_000 }),
      rec({ id: 'refund', recordDate: '2026-11-03', amount: 5_000, recordType: 0 }),
      rec({ id: 'fuel', recordDate: '2026-11-04', categoryId: 'fuel', amount: 20_000 }),
      rec({ id: 'transfer', recordDate: '2026-11-04', amount: 90_000, transfer: true }),
      rec({ id: 'trade', recordDate: '2026-11-04', amount: 90_000, isTradeFallback: true }),
      rec({ id: 'salary', recordDate: '2026-11-04', categoryId: 'salary', recordType: 0, amount: 900_000 }),
      rec({ id: 'old', recordDate: '2026-10-31', amount: 90_000 }),
      rec({ id: 'savings', recordDate: '2026-11-04', categoryId: 'savings', amount: 90_000 }),
    ], ctx, '2026-11-01', '2026-11-30')
    expect(t).toEqual([
      { key: 'food & drinks||groceries', name: 'Groceries', spent: 250 },
      { key: 'vehicle||fuel', name: 'Fuel', spent: 200 },
    ])
  })
})

describe('categorySpikes', () => {
  // Six full months of 300 RON groceries and 200 RON fuel before November.
  const history = ['05', '06', '07', '08', '09', '10'].flatMap(m => [
    rec({ id: `g${m}`, recordDate: `2026-${m}-10`, amount: 30_000 }),
    rec({ id: `f${m}`, recordDate: `2026-${m}-10`, categoryId: 'fuel', amount: 20_000 }),
  ])

  it('flags a category whose month so far is 1.5 times its 6-month average and at least 200 above it', () => {
    const spikes = categorySpikes([
      ...history,
      rec({ id: 'g', recordDate: '2026-11-12', amount: 60_000 }),
      rec({ id: 'f', recordDate: '2026-11-12', categoryId: 'fuel', amount: 35_000 }),
    ], ctx, '2026-11-17')
    expect(spikes).toEqual([{ key: 'food & drinks||groceries', name: 'Groceries', spent: 600, average: 300 }])
  })

  it('says nothing in a normal month', () => {
    expect(categorySpikes([...history, rec({ id: 'g', recordDate: '2026-11-12', amount: 30_000 })], ctx, '2026-11-17')).toEqual([])
  })
})

describe('idleBrokerCash', () => {
  const xtb = { accountId: 'xtb', name: 'XTB', broker: 'xtb' as const, currency: 'EUR' }
  const trade = (date: string, cash: number): MirrorAssetTransaction => ({
    id: `t${date}`, accountId: 'xtb', assetId: 'vuaa', transactionType: 0, date, quantity: 1, price: cash * 100,
    priceCurrencyCode: 'EUR', cashAmount: cash * 100, cashAmountCurrencyCode: 'EUR',
  })
  const deposit = (id: string, date: string, eur: number) =>
    rec({ id, recordDate: date, accountId: 'bank', currencyCode: 'EUR', amount: eur * 100, payee: 'XTB S.A', categoryId: undefined })
  const rate = (ccy: string) => (ccy === 'EUR' ? 5 : null)

  it('reports cash at or above 1,000 RON that has sat for more than 14 days, with the day it got there', () => {
    const idle = idleBrokerCash([xtb], [deposit('d1', '2026-09-01', 500), deposit('d2', '2026-10-20', 300)], [trade('2026-09-02', 480)], rate, '2026-11-17')
    expect(idle).toEqual([{ accountId: 'xtb', name: 'XTB', currency: 'EUR', cash: 320, since: '2026-10-20' }])
  })

  it('ignores cash that arrived in the last 14 days or that is below the threshold', () => {
    expect(idleBrokerCash([xtb], [deposit('d1', '2026-11-10', 900)], [], rate, '2026-11-17')).toEqual([])
    expect(idleBrokerCash([xtb], [deposit('d1', '2026-09-01', 150)], [], rate, '2026-11-17')).toEqual([])
  })

  it('counts records on the broker account itself, each transfer once', () => {
    const records = [
      rec({ id: 'out', recordDate: '2026-09-01', accountId: 'bank', currencyCode: 'EUR', amount: 40_000, transfer: true, transferId: 'x', transferAccountId: 'xtb' }),
      rec({ id: 'in', recordDate: '2026-09-01', accountId: 'xtb', currencyCode: 'EUR', amount: 40_000, recordType: 0, transfer: true, transferId: 'x' }),
      rec({ id: 'fee', recordDate: '2026-09-05', accountId: 'xtb', currencyCode: 'EUR', amount: 1_000, categoryId: undefined }),
    ]
    expect(idleBrokerCash([xtb], records, [], rate, '2026-11-17')).toEqual([
      { accountId: 'xtb', name: 'XTB', currency: 'EUR', cash: 390, since: '2026-09-01' },
    ])
  })
})
