/**
 * Spending / cash-flow aggregation across non-investment accounts.
 *
 * Where `cashflow.ts` is narrow (dividends + fees on investment accounts),
 * this module reports the user's overall money movement: monthly income vs
 * expense, breakdown by category, breakdown by account, top categories.
 *
 * Wallet's Record convention:
 *   - `amount` is a positive int*100; `type` (0=income, 1=expense, 2=transfer)
 *     determines direction.
 *   - Transfers are noise here — they move money between user accounts and
 *     net to zero. They get bucketed separately so the UI can show "movement"
 *     while keeping income/expense honest.
 */
import type { MirrorRecord } from '../mirror'
import { latestFx } from '../prices'

const TRANSFER_CATEGORY_NAMES = new Set([
  'transfer', 'transfers', 'internal transfer', 'account transfer',
])

export function isTransfer(r: MirrorRecord): boolean {
  if (r.recordType === 2) return true
  const name = (r.categoryName ?? '').trim().toLowerCase()
  return TRANSFER_CATEGORY_NAMES.has(name)
}

export type SpendingBucket = {
  yearMonth: string
  income: number    // base ccy
  expense: number   // base ccy
  net: number       // income - expense
  transfers: number // total |amount| for transfer-type records
}

export type CategorySlice = {
  key: string                 // "group||name" lowercased — distinguishes the 9 "Others"
  name: string                // category name (e.g. "Others")
  group: string               // parent envelope group (e.g. "Food & Drinks")
  categoryIds: string[]       // Wallet Category doc ids folded into this slice
  income: number
  expense: number
  net: number
  count: number
}

export type AccountSlice = {
  accountId: string
  name: string
  income: number
  expense: number
  net: number
  transfersIn: number
  transfersOut: number
  count: number
}

export type CategoryRecord = {
  id: string
  date: string
  amountBase: number          // signed: +income, -expense (base ccy)
  amountNative: number        // signed (native ccy)
  currency: string
  accountName: string
  note: string
  recordType: number | undefined  // 0 income, 1 expense
}

export type SpendingResult = {
  monthly: SpendingBucket[]
  byCategory: CategorySlice[]   // sorted by |net| desc
  byAccount: AccountSlice[]     // sorted by |net| desc
  records: Record<string, CategoryRecord[]>  // keyed by CategorySlice.key
  totals: { income: number; expense: number; net: number; transfers: number }
  unconverted: number
  monthsCovered: number
}

export async function aggregateSpending(
  records: MirrorRecord[],
  baseCurrency: string,
  opts: {
    accountIds?: Set<string>
    accountNameById?: Map<string, string>
    fromDate?: string  // inclusive, YYYY-MM-DD
    toDate?: string    // inclusive
    includeTradeFallback?: boolean  // default false; trade-fallback Records are
                                    // synthetic trade legs, not real spend/income
  } = {},
): Promise<SpendingResult> {
  const filtered = (opts.accountIds
    ? records.filter(r => opts.accountIds!.has(r.accountId))
    : records
  ).filter(r => {
    if (opts.fromDate && r.recordDate < opts.fromDate) return false
    if (opts.toDate && r.recordDate > opts.toDate) return false
    if (!opts.includeTradeFallback && r.isTradeFallback) return false
    return true
  })
  filtered.sort((a, b) => a.recordDate.localeCompare(b.recordDate))

  const monthly = new Map<string, SpendingBucket>()
  const byCat = new Map<string, CategorySlice>()
  const byAcc = new Map<string, AccountSlice>()
  const recordsByCat: Record<string, CategoryRecord[]> = {}
  const totals = { income: 0, expense: 0, net: 0, transfers: 0 }
  let unconverted = 0

  for (const r of filtered) {
    if (!r.amount) continue
    const ccy = r.currencyCode || baseCurrency
    const fx = await latestFx(ccy, baseCurrency, r.recordDate)
    if (fx === null) { unconverted++; continue }
    const amountBase = (r.amount / 100) * fx

    const ym = r.recordDate.slice(0, 7)
    let mb = monthly.get(ym)
    if (!mb) {
      mb = { yearMonth: ym, income: 0, expense: 0, net: 0, transfers: 0 }
      monthly.set(ym, mb)
    }

    const transfer = isTransfer(r)
    const isIncome = !transfer && r.recordType === 0
    const isExpense = !transfer && r.recordType === 1

    if (transfer) {
      // Transfers excluded from income/expense everywhere (portfolio AND
      // per-account) so sums reconcile. Tracked in separate transferIn/Out
      // columns per account.
      mb.transfers += amountBase
      totals.transfers += amountBase

      let asT = byAcc.get(r.accountId)
      if (!asT) {
        asT = {
          accountId: r.accountId,
          name: opts.accountNameById?.get(r.accountId) ?? r.accountId,
          income: 0, expense: 0, net: 0,
          transfersIn: 0, transfersOut: 0, count: 0,
        }
        byAcc.set(r.accountId, asT)
      }
      if (r.recordType === 0) asT.transfersIn += amountBase
      else if (r.recordType === 1) asT.transfersOut += amountBase
      asT.count++
      continue
    }

    if (isIncome) {
      mb.income += amountBase
      mb.net += amountBase
      totals.income += amountBase
      totals.net += amountBase
    } else if (isExpense) {
      mb.expense += amountBase
      mb.net -= amountBase
      totals.expense += amountBase
      totals.net -= amountBase
    } else {
      // Unknown type — skip rather than miscategorising.
      continue
    }

    // Category slice. Wallet has multiple Category docs with the same name
    // (9 "Others", 2 "Lottery, gambling") — each belongs to a different
    // envelope group (Food, Shopping, Housing, …). Key by `(group, name)`
    // so duplicates stay distinct under their parent, matching Wallet's UI.
    const displayName = (r.categoryName || 'Uncategorised').trim()
    const group = r.categoryGroupName || 'Uncategorised'
    const catKey = `${group}||${displayName}`.toLowerCase()
    let cs = byCat.get(catKey)
    if (!cs) {
      cs = {
        key: catKey,
        name: displayName,
        group,
        categoryIds: [],
        income: 0, expense: 0, net: 0, count: 0,
      }
      byCat.set(catKey, cs)
    }
    if (r.categoryId && !cs.categoryIds.includes(r.categoryId)) cs.categoryIds.push(r.categoryId)
    if (isIncome) { cs.income += amountBase; cs.net += amountBase }
    else { cs.expense += amountBase; cs.net -= amountBase }
    cs.count++

    // Per-category record list for drill-down.
    const list = recordsByCat[catKey] ?? (recordsByCat[catKey] = [])
    list.push({
      id: r.id,
      date: r.recordDate,
      amountBase: isIncome ? amountBase : -amountBase,
      amountNative: isIncome ? r.amount / 100 : -(r.amount / 100),
      currency: ccy,
      accountName: opts.accountNameById?.get(r.accountId) ?? r.accountId,
      note: r.note ?? '',
      recordType: r.recordType,
    })

    // Account slice.
    let as_ = byAcc.get(r.accountId)
    if (!as_) {
      as_ = {
        accountId: r.accountId,
        name: opts.accountNameById?.get(r.accountId) ?? r.accountId,
        income: 0, expense: 0, net: 0,
        transfersIn: 0, transfersOut: 0, count: 0,
      }
      byAcc.set(r.accountId, as_)
    }
    if (isIncome) { as_.income += amountBase; as_.net += amountBase }
    else { as_.expense += amountBase; as_.net -= amountBase }
    as_.count++
  }

  const monthlyArr = Array.from(monthly.values()).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
  const byCategory = Array.from(byCat.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
  const byAccount = Array.from(byAcc.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

  // Sort each category's records most-recent first.
  for (const k of Object.keys(recordsByCat)) {
    recordsByCat[k].sort((a, b) => b.date.localeCompare(a.date))
  }

  return {
    monthly: monthlyArr,
    byCategory,
    byAccount,
    records: recordsByCat,
    totals,
    unconverted,
    monthsCovered: monthlyArr.length,
  }
}
