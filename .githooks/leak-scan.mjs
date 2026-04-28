import { execFileSync } from 'node:child_process'

const staged = execFileSync('git', ['diff', '--cached', '--no-color'], { encoding: 'utf8' })

const patterns = [
  /Authorization:\s*Basic\s+[A-Za-z0-9+/=]{20,}/i,
  /couch-prod-eu-1\.budgetbakers\.com\/bb-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}.+(?:token|auth)/i,
]

for (const p of patterns) {
  const m = p.exec(staged)
  if (m) {
    console.error(`✗ Possible secret leak in staged changes: ${m[0].slice(0, 80)}...`)
    process.exit(1)
  }
}
process.exit(0)
