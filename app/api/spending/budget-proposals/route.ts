import { proposeBudgets } from '@/src/insights/jobs'

// A form posts here; 303 sends the phone back to the page with the outcome.
export async function POST() {
  const outcome = await proposeBudgets().catch(() => 'unavailable' as const)
  const query = outcome === 'stored' ? '' : `?budgetAi=${outcome}`
  return new Response(null, { status: 303, headers: { Location: `/spending${query}#budgets` } })
}
