import { writeNoteNow } from '@/src/insights/jobs'

// "Write now" posts here; 303 sends the phone back to the note with the outcome.
export async function POST() {
  let query = ''
  try {
    if ((await writeNoteNow()).status === 'flagged') query = '?note=flagged'
  } catch (e) {
    console.warn('[api/insights/weekly]', e instanceof Error ? e.message : e)
    query = '?note=unavailable'
  }
  return new Response(null, { status: 303, headers: { Location: `/spending${query}#note` } })
}
