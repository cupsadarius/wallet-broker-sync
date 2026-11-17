import type { MirrorAccount, MirrorRecord } from '@/src/dashboards/mirror'
import { isTransfer } from '@/src/dashboards/compute/spending'
import { bankGroups, bankStale } from '@/src/dashboards/compute/today'

/** Real income or spend: not a transfer leg and not one of this app's trade-fallback records. */
export function reviewable(r: MirrorRecord): boolean {
  return !isTransfer(r) && !r.isTradeFallback && (r.recordType === 0 || r.recordType === 1)
}

const TRANSFER_WINDOW_DAYS = 7

/** Banks post card payments days late; the note keeps the card date as `EPOS dd/mm/yyyy`. */
function paidOn(r: MirrorRecord): number {
  const m = r.note?.match(/EPOS (\d{2})\/(\d{2})\/(\d{4})/)
  return m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}`) : Date.parse(r.recordDate.slice(0, 10))
}
const gapDays = (a: MirrorRecord, b: MirrorRecord) => Math.abs(paidOn(a) - paidOn(b)) / 86_400_000

/** The other leg of a transfer between own accounts: opposite direction, same amount and currency, within a week. */
export function findTransferCounterparts(record: MirrorRecord, records: MirrorRecord[]): MirrorRecord[] {
  const days = (r: MirrorRecord) => gapDays(r, record)
  // Wallet's bank sync marks some legs as transfers alone: no transferId, or one no other leg shares.
  const legs = new Map<string, number>()
  for (const r of records) if (r.transferId) legs.set(r.transferId, (legs.get(r.transferId) ?? 0) + 1)
  const oneSided = (r: MirrorRecord) => r.transfer && !r.isTradeFallback && (!r.transferId || legs.get(r.transferId) === 1)
    && (r.transferAccountId === undefined || r.transferAccountId === record.accountId)
  return records
    .filter(r => (reviewable(r) || oneSided(r)) && r.accountId !== record.accountId && r.recordType !== record.recordType
      && Math.abs(r.amount) === Math.abs(record.amount) && r.currencyCode === record.currencyCode
      && days(r) <= TRANSFER_WINDOW_DAYS)
    .sort((a, b) => days(a) - days(b))
}

export const pairKey = (a: string, b: string) => [a, b].sort().join('|')

const LIKELY_DAYS = 90

/** Income and spend from the last 90 days that look like one transfer between own accounts; each pair once. */
export function likelyTransfers(records: MirrorRecord[], today: string, dismissed: Set<string>) {
  const since = new Date(Date.parse(today) - LIKELY_DAYS * 86_400_000).toISOString().slice(0, 10)
  const near = records.filter(r => r.recordDate.slice(0, 10) >= since)
  const found = near
    .filter(r => reviewable(r))
    .map(record => ({ record, candidates: findTransferCounterparts(record, near).filter(c => !dismissed.has(pairKey(record.id, c.id))) }))
    .filter(t => t.candidates.length > 0)
    // Closest pair claims a shared leg first; on a tie, a record with several matches leads.
    .sort((a, b) => gapDays(a.record, a.candidates[0]) - gapDays(b.record, b.candidates[0])
      || b.candidates.length - a.candidates.length || b.record.recordDate.localeCompare(a.record.recordDate))
  const used = new Set<string>()
  const out: typeof found = []
  for (const t of found) {
    if (used.has(t.record.id)) continue
    const candidates = t.candidates.filter(c => !used.has(c.id))
    if (candidates.length === 0) continue
    used.add(t.record.id)
    for (const c of candidates) used.add(c.id)
    out.push({ record: t.record, candidates })
  }
  return out.sort((a, b) => b.record.recordDate.localeCompare(a.record.recordDate))
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
