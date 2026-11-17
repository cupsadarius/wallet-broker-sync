import type { MirrorAccount, MirrorRecord } from '@/src/dashboards/mirror'
import { isTransfer } from '@/src/dashboards/compute/spending'
import { bankGroups, bankStale } from '@/src/dashboards/compute/today'

/** Real income or spend: not a transfer leg and not one of this app's trade-fallback records. */
export function reviewable(r: MirrorRecord): boolean {
  return !isTransfer(r) && !r.isTradeFallback && (r.recordType === 0 || r.recordType === 1)
}

const TRANSFER_WINDOW_DAYS = 4

/** The other leg of a transfer between own accounts: opposite direction, same amount and currency, within 4 days. */
export function findTransferCounterparts(record: MirrorRecord, records: MirrorRecord[]): MirrorRecord[] {
  const days = (r: MirrorRecord) => Math.abs(Date.parse(r.recordDate) - Date.parse(record.recordDate)) / 86_400_000
  return records
    .filter(r => reviewable(r) && r.accountId !== record.accountId && r.recordType !== record.recordType
      && Math.abs(r.amount) === Math.abs(record.amount) && r.currencyCode === record.currencyCode
      && days(r) <= TRANSFER_WINDOW_DAYS)
    .sort((a, b) => days(a) - days(b))
}

export type ReviewState ={ cursor: string; accepted: string[] }

const reachedWallet = (r: MirrorRecord) => Date.parse(r.createdAt ?? r.recordDate)

/** Records that reached Wallet after the cursor and are not accepted yet; `upTo` is the cursor after "Accept all". */
export function reviewQueue(records: MirrorRecord[], state: ReviewState): { items: MirrorRecord[]; upTo: string } {
  const cursor = Date.parse(state.cursor)
  const accepted = new Set(state.accepted)
  const items = records
    .filter(r => reviewable(r) && reachedWallet(r) > cursor && !accepted.has(r.id))
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate) || reachedWallet(b) - reachedWallet(a))
  const last = Math.max(cursor, ...items.map(reachedWallet))
  return { items, upTo: last === cursor ? state.cursor : new Date(last).toISOString() }
}

const OUTFLOW_DAYS = 42
const LARGE_OUTFLOW = 10_000 // int*100: 100 units of the record currency

/**
 * Large outgoing payments into a bank whose sync is stale: Wallet sees the money leave but not
 * how it was spent. Looks back from when the sync went stale, at most 6 weeks.
 */
export function unexplainedOutflows(accounts: MirrorAccount[], records: MirrorRecord[], now: Date) {
  const windowStart = new Date(now.getTime() - OUTFLOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  return bankGroups(accounts, records).filter(g => bankStale(g, now)).map(g => {
    const ids = new Set(g.accountIds)
    const name = new RegExp(g.provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const staleSince = g.asOf?.slice(0, 10) ?? null
    const since = staleSince && staleSince > windowStart ? staleSince : windowStart
    return {
      provider: g.provider, staleSince, since,
      records: records
        .filter(r => r.recordType === 1 && !ids.has(r.accountId) && r.amount >= LARGE_OUTFLOW && r.recordDate >= since
          && ((r.transferAccountId !== undefined && ids.has(r.transferAccountId)) || name.test(`${r.payee ?? ''} ${r.note ?? ''}`)))
        .sort((a, b) => b.recordDate.localeCompare(a.recordDate)),
    }
  }).filter(o => o.records.length > 0)
}
