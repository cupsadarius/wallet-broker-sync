import type { BrokerId } from '@/src/types'
import type { MirrorAccount, MirrorAssetTransaction, MirrorRecord } from '../mirror'
import type { Maturity } from './maturities'

export type Task = {
  id: string                 // stable: a push goes out once per id
  kind: 'upload' | 'bank' | 'maturity' | 'plan'
  title: string
  detail: string
  href?: string
  action?: string
}

export type AgeEntry = { label: string; asOf: string | null; stale: boolean }

export const BROKER_LABEL: Record<BrokerId, string> = { xtb: 'XTB', ibkr: 'IBKR', tradeville: 'Tradeville' }
const BROKER_PAYEE: Record<BrokerId, RegExp> = {
  xtb: /\bxtb\b/i,
  ibkr: /\bibkr\b|interactive brokers/i,
  tradeville: /tradeville/i,
}

const DAY_MS = 86_400_000
export const STALE_MS = {
  mirror: 15 * 60_000,
  bank: 3 * DAY_MS,
  broker: 45 * DAY_MS,
  prices: 4 * DAY_MS,
}
const MATURITY_TASK_DAYS = 14

export function fmtDay(date: string): string {
  return new Date(date.slice(0, 10) + 'T00:00:00Z')
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function fmtAmount(n: number, ccy: string): string {
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${ccy}`
}

export function fmtSigned(n: number, digits = 0): string {
  const s = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
  return `${n >= 0 ? '+' : '−'}${s}`
}

function maxDate(dates: (string | undefined | null)[]): string | null {
  let best: string | null = null
  for (const d of dates) if (d && (best === null || d > best)) best = d
  return best
}

/** Balance per account in major units: opening balance plus signed records up to `asOf`. */
export function accountBalances(
  accounts: MirrorAccount[], records: MirrorRecord[], asOf: string,
): Map<string, number> {
  const cents = new Map(accounts.map(a => [a.id, a.initAmount]))
  for (const r of records) {
    if (r.recordDate > asOf || !cents.has(r.accountId)) continue
    cents.set(r.accountId, cents.get(r.accountId)! + (r.recordType === 1 ? -r.amount : r.amount))
  }
  return new Map([...cents].map(([id, c]) => [id, c / 100]))
}

/** An outgoing record on another account that pays into `accountId`, by link or by broker payee. */
export function paysInto(r: MirrorRecord, accountId: string, broker: BrokerId | null): boolean {
  return r.accountId !== accountId && r.recordType === 1 && (r.transferAccountId === accountId
    || (broker !== null && BROKER_PAYEE[broker].test(`${r.payee ?? ''} ${r.note ?? ''}`)))
}

function isDepositTo(r: MirrorRecord, broker: BrokerId, accountId: string): boolean {
  if (!r.bankSynced) return false
  if (r.accountId === accountId) return r.recordType === 0 && r.transfer
  return paysInto(r, accountId, broker)
}

/**
 * "Upload statement": a bank-synced transfer into a broker account that is newer than
 * the newest trade, imported record, or statement import for that account.
 */
export function uploadTasks(input: {
  brokers: { broker: BrokerId; accountId: string }[]
  records: MirrorRecord[]
  transactions: Pick<MirrorAssetTransaction, 'accountId' | 'date'>[]
  lastImport: Partial<Record<BrokerId, string>>
}): Task[] {
  const tasks: Task[] = []
  for (const { broker, accountId } of input.brokers) {
    const covered = maxDate([
      ...input.transactions.filter(t => t.accountId === accountId).map(t => t.date),
      ...input.records.filter(r => r.accountId === accountId && r.isTradeFallback).map(r => r.recordDate),
      input.lastImport[broker]?.slice(0, 10),
    ]) ?? ''
    const deposit = input.records
      .filter(r => r.recordDate > covered && isDepositTo(r, broker, accountId))
      .sort((a, b) => b.recordDate.localeCompare(a.recordDate))[0]
    if (!deposit) continue
    const label = BROKER_LABEL[broker]
    tasks.push({
      id: `upload:${broker}:${deposit.id}`,
      kind: 'upload',
      title: `Upload ${label} statement`,
      detail: `Transfer of ${fmtAmount(deposit.amount / 100, deposit.currencyCode)} on ${fmtDay(deposit.recordDate)}. No newer ${label} activity imported.`,
      href: `/upload?broker=${broker}`,
      action: 'Upload',
    })
  }
  return tasks
}

type BankGroup = { provider: string; accountIds: string[]; active: boolean; asOf: string | null }

export function bankGroups(accounts: MirrorAccount[], records: MirrorRecord[]): BankGroup[] {
  const groups = new Map<string, MirrorAccount[]>()
  for (const a of accounts) {
    if (!a.bank) continue
    groups.set(a.bank.provider, [...(groups.get(a.bank.provider) ?? []), a])
  }
  return [...groups].map(([provider, accs]) => {
    const ids = new Set(accs.map(a => a.id))
    return {
      provider,
      accountIds: [...ids],
      active: accs.some(a => a.bank!.active),
      asOf: maxDate(accs.map(a => a.bank!.lastRefresh))
        ?? maxDate(records.filter(r => ids.has(r.accountId) && r.bankSynced).map(r => r.recordDate)),
    }
  })
}

export function bankTasks(accounts: MirrorAccount[], records: MirrorRecord[]): Task[] {
  return bankGroups(accounts, records).filter(g => !g.active).map(g => ({
    id: `bank:${g.provider}`,
    kind: 'bank',
    title: `Reconnect ${g.provider}`,
    detail: `Bank sync stopped.${g.asOf ? ` Newest data ${fmtDay(g.asOf)}.` : ''} Reconnect it in the Wallet app.`,
  }))
}

export function maturityTasks(maturities: Maturity[], today: string): Task[] {
  const limit = new Date(Date.parse(today + 'T00:00:00Z') + MATURITY_TASK_DAYS * DAY_MS).toISOString().slice(0, 10)
  return maturities
    .filter(m => m.maturityDate >= today && m.maturityDate <= limit)
    .map(m => ({
      id: `maturity:${m.id}`,
      kind: 'maturity',
      title: `${m.name} matures ${fmtDay(m.maturityDate)}`,
      detail: `Decide where ${fmtAmount(m.principal, m.currency)} goes next.`,
      href: '/invest/maturities',
      action: 'Open',
    }))
}

export function bankStale(g: BankGroup, now: Date): boolean {
  return !g.active || g.asOf === null || now.getTime() - Date.parse(g.asOf) > STALE_MS.bank
}

export function dataAge(input: {
  accounts: MirrorAccount[]
  records: MirrorRecord[]
  lastImport: Partial<Record<BrokerId, string>>
  pricesAsOf: string | null
  mirrorAsOf: string | null
  now: Date
}): AgeEntry[] {
  const age = (asOf: string | null, limit: number) =>
    asOf === null || input.now.getTime() - Date.parse(asOf.length === 10 ? asOf + 'T00:00:00Z' : asOf) > limit
  return [
    { label: 'Wallet', asOf: input.mirrorAsOf, stale: age(input.mirrorAsOf, STALE_MS.mirror) },
    ...bankGroups(input.accounts, input.records).map(g => ({
      label: g.provider, asOf: g.asOf, stale: bankStale(g, input.now),
    })),
    ...(Object.keys(BROKER_LABEL) as BrokerId[]).map(b => ({
      label: BROKER_LABEL[b], asOf: input.lastImport[b] ?? null, stale: age(input.lastImport[b] ?? null, STALE_MS.broker),
    })),
    { label: 'Prices', asOf: input.pricesAsOf, stale: age(input.pricesAsOf, STALE_MS.prices) },
  ]
}
