/**
 * BudgetBakers Wallet groups categories under "envelopes" (integer codes
 * baked into the client; not stored as separate Couch docs). The thousands
 * digit of `envelopeId` identifies the parent group — so the 9 different
 * "Others" categories the user sees in Wallet actually belong to 9 distinct
 * groups (Food: Others, Shopping: Others, Housing: Others, …).
 *
 * Mapping derived from observed envelope IDs in a live BudgetBakers DB.
 * If a future Wallet version adds new groups, they fall through to
 * "Unknown group".
 */

const GROUP_BY_RANGE: Array<{ min: number; max: number; name: string }> = [
  { min: 1000,  max: 1999,  name: 'Food & Drinks' },
  { min: 2000,  max: 2999,  name: 'Shopping' },
  { min: 3000,  max: 3999,  name: 'Housing' },
  { min: 4000,  max: 4999,  name: 'Transportation' },
  { min: 5000,  max: 5999,  name: 'Vehicle' },
  { min: 6000,  max: 6999,  name: 'Life & Entertainment' },
  { min: 7000,  max: 7999,  name: 'Communication, PC' },
  { min: 8000,  max: 8999,  name: 'Financial expenses' },
  { min: 9000,  max: 9999,  name: 'Investments' },
  { min: 10000, max: 10999, name: 'Income' },
  { min: 11000, max: 11999, name: 'Others' },
  { min: 13000, max: 13999, name: 'Unknown' },
  { min: 20000, max: 29999, name: 'System' },
]

export function envelopeGroupName(envelopeId: number | undefined | null): string {
  if (envelopeId === undefined || envelopeId === null) return 'Uncategorised'
  for (const r of GROUP_BY_RANGE) {
    if (envelopeId >= r.min && envelopeId <= r.max) return r.name
  }
  return 'Unknown group'
}
