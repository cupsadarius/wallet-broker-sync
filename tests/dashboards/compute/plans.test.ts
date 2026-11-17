import { describe, it, expect } from 'vitest'
import { planProgress, planTasks, type Plan, type RecurringPlan, type RolloverPlan } from '@/src/dashboards/compute/plans'
import type { MirrorAsset, MirrorAssetTransaction, MirrorRecord } from '@/src/dashboards/mirror'
import type { Maturity } from '@/src/dashboards/compute/maturities'

const XTB = 'acc-xtb'
const BANK = 'acc-eur'
const TODAY = '2026-11-17'

function rec(p: Partial<MirrorRecord> & { id: string; recordDate: string }): MirrorRecord {
  return {
    accountId: BANK, amount: 10_000, recordType: 1, currencyCode: 'EUR',
    isTradeFallback: false, transfer: false, bankSynced: true, ...p,
  }
}
function buy(date: string, quantity: number, price: number, accountId = XTB, assetId = 'vuaa'): MirrorAssetTransaction {
  return { id: `${assetId}-${date}`, accountId, assetId, transactionType: 0, date, quantity, price: price * 100, priceCurrencyCode: 'EUR' }
}
const byAssetId = new Map<string, MirrorAsset>([
  ['vuaa', { id: 'vuaa', symbol: 'VUAA', exchangeCode: 'XETR', currencyCode: 'EUR' }],
  ['other', { id: 'other', symbol: 'CSPX', exchangeCode: 'XETR', currencyCode: 'EUR' }],
])

const vuaa: RecurringPlan = {
  id: 1, type: 'recurring', name: 'VUAA monthly', accountId: XTB, status: 'active',
  amount: 100, currency: 'EUR', frequency: 'monthly', startDate: '2025-07-01', targetSymbol: 'VUAA', wholeShares: true,
}

// Shaped like the real XTB history: a manual opening deposit, a synced transfer pair,
// bank-side payments only, and 11 VUAA bought for 1,274.53 EUR.
const xtbRecords: MirrorRecord[] = [
  rec({ id: 'open', accountId: XTB, recordType: 0, amount: 60_000, bankSynced: false, recordDate: '2025-11-01' }),
  rec({ id: 'p1', transfer: true, transferId: 't1', transferAccountId: XTB, amount: 10_000, recordDate: '2026-01-30', payee: 'XTB S.A' }),
  rec({ id: 'p1x', accountId: XTB, recordType: 0, transfer: true, transferId: 't1', transferAccountId: BANK, amount: 10_000, recordDate: '2026-01-30' }),
  rec({ id: 'p2', transfer: true, transferId: 't2', amount: 20_000, recordDate: '2026-03-20', payee: 'XTB S.A' }),
  rec({ id: 'p2x', accountId: XTB, recordType: 0, transfer: true, transferId: 't2', amount: 20_000, recordDate: '2026-03-20' }),
  rec({ id: 'p3', amount: 10_000, recordDate: '2026-05-31', note: '53283313 To XTB S.A' }),
  rec({ id: 'p4', amount: 10_000, recordDate: '2026-07-20', payee: 'XTB S.A' }),
  rec({ id: 'p5', amount: 10_000, recordDate: '2026-08-31', payee: 'XTB S.A' }),
  rec({ id: 'p6', amount: 10_000, recordDate: '2026-04-30', payee: 'XTB S.A' }),
  // not deposits: spending elsewhere, a dividend, a pre-plan transfer
  rec({ id: 'lidl', amount: 5_000, recordDate: '2026-02-01', payee: 'Lidl' }),
  rec({ id: 'div', accountId: XTB, recordType: 0, amount: 300, recordDate: '2026-06-01', isTradeFallback: true, note: 'dividend VUAA' }),
  rec({ id: 'old', amount: 50_000, recordDate: '2025-06-01', payee: 'XTB S.A' }),
]
const xtbBuys = [
  buy('2025-11-03', 1, 113.91), buy('2025-12-01', 2, 112.75), buy('2026-01-02', 2, 111.98),
  buy('2026-01-30', 1, 112.285), buy('2026-03-23', 2, 109.405), buy('2026-06-02', 1, 125.68),
  buy('2026-07-20', 1, 126.13), buy('2026-08-31', 1, 128.25),
]
const ctx = { broker: 'xtb' as const, records: xtbRecords, transactions: xtbBuys, byAssetId, price: 128.69, maturity: null, today: TODAY }

describe('planProgress · recurring', () => {
  it('finds the XTB plan 3 months behind with 11 VUAA held', () => {
    const p = planProgress(vuaa, ctx)
    expect(p).toMatchObject({
      tag: 'behind', expected: 1600, deposited: 1300, periodsBehind: 3, held: 11,
      action: 'Deposit 300 EUR → 2 VUAA',
      line: '3 months behind · deposit 300 EUR → 2 VUAA',
      detail: '1,300 of 1,600 EUR since Jul 2025 · 100 EUR/month · whole shares',
      holding: '11 VUAA · 25 EUR cash',
    })
    expect(p.cash).toBeCloseTo(25.475, 3)
    expect(p.ring).toBeCloseTo(1300 / 1600)
  })

  it('counts fractional units without the whole-shares flag', () => {
    const p = planProgress({ ...vuaa, wholeShares: false }, ctx)
    expect(p.action).toBe('Deposit 300 EUR → 2.52 VUAA')
    expect(p.detail).toBe('1,300 of 1,600 EUR since Jul 2025 · 100 EUR/month')
  })

  it('falls back to the last trade price when no close is known', () => {
    expect(planProgress(vuaa, { ...ctx, price: null }).action).toBe('Deposit 300 EUR → 2 VUAA')
  })

  it('names the next due date when on track, and a buy when cash covers a unit', () => {
    const extra = [rec({ id: 'x', amount: 30_000, recordDate: '2026-11-02', payee: 'XTB S.A' })]
    const p = planProgress(vuaa, { ...ctx, records: [...xtbRecords, ...extra] })
    expect(p).toMatchObject({ tag: 'on track', periodsBehind: 0, action: 'Buy 2 VUAA', line: 'On track · buy 2 VUAA', ring: 1 })
    const none = planProgress({ ...vuaa, targetSymbol: null }, { ...ctx, records: [...xtbRecords, ...extra] })
    expect(none.action).toBe('Next 100 EUR by 30 Nov 2026')
    expect(none.holding).toBe('325 EUR cash')
  })

  it('counts ended weeks for a weekly plan', () => {
    const weekly: Plan = { ...vuaa, frequency: 'weekly', startDate: '2026-11-01', amount: 50 }
    const p = planProgress(weekly, { ...ctx, records: [], transactions: [] })
    expect(p).toMatchObject({ expected: 100, deposited: 0, periodsBehind: 2, line: '2 weeks behind · deposit 100 EUR' })
  })

  it('shows a paused plan without an action', () => {
    const p = planProgress({ ...vuaa, status: 'paused' }, ctx)
    expect(p).toMatchObject({
      tag: 'paused', action: null, line: 'Paused · last buy 31 Aug 2026', ring: 1,
      detail: '100 EUR/month · whole shares · last buy 31 Aug 2026', holding: '11 VUAA',
    })
  })

  it('reads fallback-record trades for the target', () => {
    const tv: Plan = { ...vuaa, accountId: 'acc-tv', currency: 'RON', targetSymbol: 'TVBETETF', status: 'paused' }
    const transactions = [buy('2025-03-26', 7, 27.55, 'acc-tv', 'fallback:XBSE:TVBETETF')]
    const assets = new Map([['fallback:XBSE:TVBETETF', { id: 'fallback:XBSE:TVBETETF', symbol: 'TVBETETF', exchangeCode: 'XBSE', currencyCode: 'RON' }]])
    const p = planProgress(tv, { ...ctx, broker: 'tradeville', transactions, byAssetId: assets, price: null })
    expect(p).toMatchObject({ held: 7, line: 'Paused · last buy 26 Mar 2025' })
  })
})

describe('planProgress · rollover', () => {
  const bt: Maturity = {
    id: 9, kind: 'deposit', name: 'BT deposit', accountId: 'acc-bt', symbol: null, currency: 'RON',
    principal: 250_000, rateBps: null, startDate: '2026-04-17', maturityDate: '2027-04-17',
  }
  const fidelis: RolloverPlan = {
    id: 2, type: 'rollover', name: 'Rollover to Fidelis', accountId: 'acc-tv', status: 'active',
    startDate: '2026-11-17', maturityId: 9, targetProduct: 'Fidelis RON 2028', targetSymbol: 'R2805A',
  }
  const rctx = { ...ctx, broker: 'tradeville' as const, maturity: bt }

  it('counts down to the maturity', () => {
    const p = planProgress(fidelis, rctx)
    expect(p).toMatchObject({
      tag: 'on track', action: null, line: '5 months to go · 17 Apr 2027', maturityDate: '2027-04-17',
      detail: '250,000 RON BT deposit · matures 17 Apr 2027 · buy Fidelis RON 2028',
    })
    expect(p.ring).toBeCloseTo(214 / 365, 2)
  })

  it('is behind after maturity until the target is bought', () => {
    const later = { ...rctx, today: '2027-04-20' }
    expect(planProgress(fidelis, later)).toMatchObject({
      tag: 'behind', action: 'Buy Fidelis RON 2028', line: 'Matured 17 Apr 2027 · buy Fidelis RON 2028',
    })
    const bought = [{ ...buy('2027-04-19', 2500, 100, 'acc-tv', 'r28'), priceCurrencyCode: 'RON' }]
    const assets = new Map([['r28', { id: 'r28', symbol: 'R2805A', exchangeCode: 'XBSE', currencyCode: 'RON' }]])
    expect(planProgress(fidelis, { ...later, transactions: bought, byAssetId: assets })).toMatchObject({
      tag: 'done', action: null, line: 'Done · bought Fidelis RON 2028 on 19 Apr 2027',
    })
  })

  it('flags a rollover whose maturity was deleted', () => {
    expect(planProgress(fidelis, { ...rctx, maturity: null })).toMatchObject({ tag: 'behind', line: 'Maturity deleted · edit the plan' })
  })
})

describe('planTasks', () => {
  it('asks for action on active plans that are behind', () => {
    const behind = planProgress(vuaa, ctx)
    const tasks = planTasks([
      { plan: vuaa, progress: behind },
      { plan: { ...vuaa, id: 3 }, progress: { ...behind, tag: 'on track' } },
      { plan: { ...vuaa, id: 4, status: 'paused' }, progress: { ...behind, tag: 'paused' } },
    ])
    expect(tasks).toEqual([{
      id: 'plan:1:1600', kind: 'plan', title: 'VUAA monthly is 3 months behind',
      detail: 'Deposit 300 EUR → 2 VUAA.', href: '/invest?tab=plans', action: 'Open',
    }])
  })
})
