import { and, eq, gt, or } from 'drizzle-orm'
import { db } from '@/src/storage/db'
import { config, retirementAccount, retirementContribution, retirementStatement } from '@/src/storage/schema'
import { writeConfig } from '@/src/dashboards/mirror'
import type { Statement } from './types'

export const BIRTH_DATE_KEY = 'retirement.birthDate'
export const VPR_KEY = 'retirement.vpr'
const RELEASE_AGE = 65

export const accountIdOf = (st: Statement) => (st.kind === 'pilon1' ? 'cnpp' : `${st.provider}:${st.contract}`)

/** The 65th birthday for a pension pillar; a policy or Pilon 1 has no default. */
export function defaultReleaseDate(kind: Statement['kind'], birthDate: string | null): string | null {
  if ((kind !== 'pilon2' && kind !== 'pilon3') || !birthDate) return null
  const [y, m, d] = birthDate.split('-').map(Number)
  return new Date(Date.UTC(y + RELEASE_AGE, m - 1, d)).toISOString().slice(0, 10)
}

/** Stores one parsed statement; the same file or a second statement for the same account and date is skipped. */
export async function saveStatement(st: Statement, fileHash: string, now = new Date()): Promise<'saved' | 'duplicate'> {
  const accountId = accountIdOf(st)
  return db.transaction(tx => {
    const dup = tx.select({ id: retirementStatement.id }).from(retirementStatement)
      .where(or(eq(retirementStatement.fileHash, fileHash),
        and(eq(retirementStatement.accountId, accountId), eq(retirementStatement.asOf, st.asOf)))).get()
    if (dup) return 'duplicate'

    let birthDate = tx.select().from(config).where(eq(config.key, BIRTH_DATE_KEY)).get()?.value ?? null
    if (!birthDate && st.birthDate) {
      birthDate = st.birthDate
      tx.insert(config).values({ key: BIRTH_DATE_KEY, value: birthDate }).run()
    }

    tx.insert(retirementAccount).values({
      id: accountId, kind: st.kind, provider: st.provider,
      product: st.kind === 'pilon1' ? 'Pilon 1' : st.product,
      contract: st.kind === 'pilon1' ? '' : st.contract,
      currency: st.kind === 'pilon1' ? 'RON' : st.currency,
      releaseDate: defaultReleaseDate(st.kind, birthDate),
      createdAt: now.toISOString(),
    }).onConflictDoNothing().run()

    const newer = tx.select({ id: retirementStatement.id }).from(retirementStatement)
      .where(and(eq(retirementStatement.accountId, accountId), gt(retirementStatement.asOf, st.asOf))).get()

    tx.insert(retirementStatement).values(st.kind === 'pilon1'
      ? { accountId, asOf: st.asOf, details: { period: st.period, points: st.points, pointsByYear: st.pointsByYear }, fileHash, uploadedAt: now.toISOString() }
      : { accountId, asOf: st.asOf, value: st.value, paidIn: st.paidIn, fees: st.fees, fileHash, uploadedAt: now.toISOString() },
    ).run()

    // Each BT statement holds the full history, so the newest one replaces the stored rows.
    if (st.kind !== 'pilon1' && st.contributions && !newer) {
      tx.delete(retirementContribution).where(eq(retirementContribution.accountId, accountId)).run()
      if (st.contributions.length) tx.insert(retirementContribution).values(st.contributions.map(c => ({ accountId, ...c }))).run()
    }
    return 'saved'
  })
}

export async function setReleaseDate(accountId: string, date: string | null): Promise<void> {
  await db.update(retirementAccount).set({ releaseDate: date }).where(eq(retirementAccount.id, accountId))
}

export async function setVpr(cents: number): Promise<void> {
  await writeConfig(VPR_KEY, String(cents))
}
